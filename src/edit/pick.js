// @ts-check
// pick.js — target selection for edits. `pick: 'direct'` uses the mark the
// gesture landed on (handled by the renderer's node events); `pick: 'nearest'`
// resolves the closest mark to the pointer within a pixel threshold, so small
// marks are grabbable from nearby empty space (bars from anywhere in their
// column, dots from adjacent space). This folds the old proximityDrag interactor
// into the edit model — proximity is just how an edit picks its target.
//
// Every geometry test below runs on the mark's UNROTATED coordinates, with the
// pointer brought into the mark's own frame first (`unrotate`). That keeps one set of
// axis-aligned tests for shapes the renderers draw through a rotate transform.

import { markCenter } from './shared.js';

/**
 * Distance from pointer to a mark, per mark type:
 *   circle -> euclidean distance to the centre.
 *   rect   -> distance to the bar's band interval (its category slot), measured
 *             along the band axis, so any point in the column/row selects the bar
 *             regardless of its length. `bandAxis` is set by the bar mark.
 *   line   -> true point-to-segment distance to the tick. Along the span you can
 *             still grab it from anywhere (distance 0 on the segment), but two
 *             ticks stacked in the SAME band are disambiguated by the pointer's
 *             distance to each one's value position — the band-interval shortcut
 *             (used for rects) can't, since it ties every tick in the column at 0.
 * @param {any} mark
 * @param {number} px
 * @param {number} py
 * @returns {number}
 */
export function distanceToMark(mark, px, py) {
    // Rotation is undone once, up front: the pointer moves into the mark's own frame
    // and every test below stays the axis-aligned one it always was. A circle is
    // rotation-invariant about its own centre, so this is a no-op there.
    const p = unrotate(mark, px, py);
    if (mark.type === 'circle') {
        return Math.hypot(px - mark.cx, py - mark.cy);
    }
    if (mark.type === 'ellipse') {
        // Distance to the CENTRE, like a circle — proximity ranks candidates, and an
        // ellipse's centre is what a pointer is nearest to. Whether the pointer is
        // INSIDE it is containsPoint's question, and that one is elliptical.
        return Math.hypot(p.x - mark.cx, p.y - mark.cy);
    }
    if (mark.type === 'rect') {
        if (mark.bandAxis === 'y') {
            const top = mark.y;
            const bottom = mark.y + mark.height;
            if (p.y < top) return top - p.y;
            if (p.y > bottom) return p.y - bottom;
            return 0;
        }
        const left = mark.x;
        const right = mark.x + mark.width;
        if (p.x < left) return left - p.x;
        if (p.x > right) return p.x - right;
        return 0;
    }
    if (mark.type === 'line') {
        return segDist(p.x, p.y, mark.x1, mark.y1, mark.x2, mark.y2);
    }
    if (mark.type === 'path') {
        // Distance to the polyline: the min over its consecutive segments, so a
        // click anywhere ALONG a connected line (not just at a vertex) is "on" it.
        // A path bakes any rotation into its own points, so `p` is the raw pointer
        // here (no path mark carries `angle` — see plot/curve.js).
        const pts = mark.points || [];
        let best = Infinity;
        for (let i = 1; i < pts.length; i++) {
            const d = segDist(p.x, p.y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
            if (d < best) best = d;
        }
        return best;
    }
    return Infinity;
}

/**
 * The pointer in a rotated node's OWN frame — undo `node.angle` about its centre,
 * so an axis-aligned geometry test still holds for a rotated shape. (The SVG
 * renderer gets this from the DOM's own transform; canvas hit-testing has to do
 * it here, or a tilted mark would be grabbable only where it used to be. Proximity
 * picking has to do it under BOTH renderers — `nearestMark` measures geometry, not
 * DOM.)
 *
 * The pivot is `markCenter`, the same function both renderers rotate about, so where
 * a mark is PICKED and where it is PAINTED cannot drift apart. This used to demand
 * `cx`/`cy` on the node and bail otherwise, which made it a structural no-op for
 * every `rect`, `line` and `text` — i.e. for a rotated square point, a tilted tick
 * and a face's brow, all of which were grabbable only at their unrotated position.
 * @param {any} mark @param {number} px @param {number} py
 * @returns {{ x: number, y: number }}
 */
function unrotate(mark, px, py) {
    if (!mark.angle) return { x: px, y: py };
    const c = markCenter(mark);
    if (!c) return { x: px, y: py };
    // The renderer draws with rotate(-angle); undoing it rotates by +angle.
    const rad = (-mark.angle * Math.PI) / 180;
    const dx = px - c.cx;
    const dy = py - c.cy;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: c.cx + dx * cos + dy * sin, y: c.cy - dx * sin + dy * cos };
}

/**
 * Distance from a point to the segment (ax,ay)-(bx,by): project the point onto the
 * segment, clamp to its ends, measure to that closest point.
 * @param {number} px @param {number} py
 * @param {number} ax @param {number} ay @param {number} bx @param {number} by
 * @returns {number}
 */
function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The nearest mark within `threshold` (or null). Returns the mark's DATUM index so
 * the edit can address the datum. An optional `series` scopes the search to one
 * line's handles (used by a series-locked 2D sweep).
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {any} [series] restrict to marks with this `series` key
 * @returns {number | null}
 */
export function nearestMark(marks, px, py, threshold, series) {
    let best = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark) => {
        if (mark.index == null) return; // datum-bearing marks only (skip a line's path)
        if (mark.locked) return;        // a read-only row is not a target (spec.lock)
        if (series !== undefined && mark.series !== series) return;
        const d = distanceToMark(mark, px, py);
        // Address the DATUM (mark.index), not the array slot — a feature may emit
        // extra nodes (a line's connecting path) that offset handle positions.
        if (d < bestDist) { bestDist = d; best = mark.index; }
    });
    return best != null && bestDist <= threshold ? best : null;
}

/**
 * The `series` key of the line closest to the pointer within `threshold` (or
 * null) — measured to the LINE ITSELF (its connecting path's segments), not just
 * its vertices, so a click anywhere along a sparse line still resolves to it. Falls
 * back to handle distance for a one-point series (which has no path yet). This is
 * how a gesture decides WHICH line it means: a sweep locks onto it, an `anchor`
 * attaches to it, and being far from every line (null) starts a new one.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @returns {any | null}
 */
export function nearestSeries(marks, px, py, threshold) {
    let bestSeries = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark) => {
        if (mark.series === undefined) return;
        // A fully locked line is not there as far as a gesture is concerned, so a
        // drag beside it draws a new line instead of grabbing a frozen one.
        if (mark.locked) return;
        // Prefer the drawn line (path); fall back to a handle's centre.
        let d;
        if (mark.type === 'path') d = distanceToMark(mark, px, py);
        else if (mark.cx != null) d = Math.hypot(px - mark.cx, py - mark.cy);
        else return;
        if (d < bestDist) { bestDist = d; bestSeries = mark.series; }
    });
    return bestSeries != null && bestDist <= threshold ? bestSeries : null;
}

/**
 * The nearest mark measured ALONG ONE AXIS only (the you-draw-it sweep target):
 * distance is |px - cx| on 'x' or |py - cy| on 'y', so the pointer's position on
 * the other axis is ignored and a horizontal sweep always selects the point in
 * the column it is over. Only handle nodes with a centre (circles) are eligible.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {'x' | 'y'} axis
 * @param {any} [series] restrict to marks with this `series` key (series-locked sweep)
 * @returns {number | null}
 */
export function nearestMarkOnAxis(marks, px, py, threshold, axis, series) {
    let best = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark, i) => {
        if (mark.locked) return;        // a read-only row is not a target (spec.lock)
        if (series !== undefined && mark.series !== series) return;
        const center = axis === 'x' ? mark.cx : mark.cy;
        if (center == null) return; // not a point handle
        const d = Math.abs((axis === 'x' ? px : py) - center);
        // Return the datum index, not the array slot (see nearestMark): a line's
        // connecting path precedes its handles, so positions are offset by one.
        if (d < bestDist) { bestDist = d; best = mark.index != null ? mark.index : i; }
    });
    return best != null && bestDist <= threshold ? best : null;
}

// How far outside a thin mark's outline still counts as "on" it, in px. A stroked
// line or path has no area, so a bare containment test would be unhittable; this is
// the grab tolerance the SVG hit-tester effectively grants via the stroke width.
const HIT_TOLERANCE = 4;

// Minimum grabbable thickness for a rect, in px. A bar whose value collapses to the
// baseline has height 0 (or width 0, horizontal) — no area to hit under DIRECT pick,
// so the bar becomes ungrabbable exactly when you want to drag it back up. Floor the
// *hit* geometry (never the drawn geometry) to this so a degenerate rect keeps a
// finger-sized target. Shared with the SVG renderer, which lays a transparent hit
// rect of this box over each editable degenerate bar (a zero-area <rect> takes no
// pointer events), so both backends grab an emptied bar identically.
export const MIN_GRAB = 12;

/**
 * The floored HIT box of a rect node: its drawn box, but each dimension expanded
 * symmetrically to at least MIN_GRAB so a collapsed bar stays grabbable. Visual-only
 * geometry (`x`/`y`/`width`/`height`) is untouched; this is purely the target area.
 * @param {any} mark
 * @returns {{ x: number, y: number, w: number, h: number }}
 */
export function rectHitBox(mark) {
    const w = mark.width || 0;
    const h = mark.height || 0;
    const gw = Math.max(w, MIN_GRAB);
    const gh = Math.max(h, MIN_GRAB);
    return {
        x: mark.x - (gw - w) / 2,
        y: mark.y - (gh - h) / 2,
        w: gw,
        h: gh
    };
}

/**
 * The topmost mark the pointer is actually ON (containment), or null — the geometric
 * replacement for the browser's SVG hit-test, used by renderers with no DOM elements
 * to hit (the canvas renderer). Distinct from `nearestMark`: `direct` pick means "the
 * mark under the pointer", not "the closest mark within 40px", so this tests real
 * containment and walks the scene BACK-TO-FRONT (last drawn wins, matching paint /
 * z-order).
 *
 * It also honours what SVG enforced for free: a node is only a target if its feature
 * has a direct-pick edit (`editable`) and it isn't locked, a guide, background, or
 * explicitly `pointerEvents:'none'` — the pointer-transparency invariant, which the
 * DOM hit-tester applied via CSS and a geometric hit-test must apply itself.
 *
 * Reuses `distanceToMark` for the genuine distance cases (circle centre, line/path
 * segments); a rect is a real point-in-bounds test rather than `distanceToMark`'s
 * band-proximity shortcut, because "anywhere in the column" is what NEAREST wants,
 * not what a direct hit is.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @returns {any | null} the hit node object (not its index), or null
 */
export function hitTest(marks, px, py) {
    const list = marks || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const mark = list[i];
        if (!mark || !mark.editable) continue;
        if (mark.locked || mark.guide || mark.background) continue;
        if (mark.pointerEvents === 'none') continue;
        if (containsPoint(mark, px, py)) return mark;
    }
    return null;
}

/**
 * @param {any} mark @param {number} px @param {number} py @returns {boolean}
 */
function containsPoint(mark, px, py) {
    if (mark.type === 'circle') {
        const r = mark.r != null ? mark.r : 5;
        return distanceToMark(mark, px, py) <= r + HIT_TOLERANCE;
    }
    if (mark.type === 'ellipse') {
        // Normalized elliptical test in the mark's own (un-rotated) frame: the
        // tolerance is granted in each radius' own units, so a thin squinting eye
        // stays as grabbable as a round one.
        const c = unrotate(mark, px, py);
        const rx = Math.max(1e-6, (mark.rx != null ? mark.rx : 5) + HIT_TOLERANCE);
        const ry = Math.max(1e-6, (mark.ry != null ? mark.ry : 5) + HIT_TOLERANCE);
        return Math.hypot((c.x - mark.cx) / rx, (c.y - mark.cy) / ry) <= 1;
    }
    if (mark.type === 'rect') {
        // Floor the hit box to MIN_GRAB first, THEN grant the outline tolerance, so a
        // zero-height/zero-width bar (value at the baseline) keeps a grabbable target.
        // The box is the mark's UNROTATED one, so test the pointer in that frame.
        const box = rectHitBox(mark);
        const p = unrotate(mark, px, py);
        return p.x >= box.x - HIT_TOLERANCE && p.x <= box.x + box.w + HIT_TOLERANCE
            && p.y >= box.y - HIT_TOLERANCE && p.y <= box.y + box.h + HIT_TOLERANCE;
    }
    // An annular sector (a pie/donut slice) is the one FILLED region the renderers
    // draw as a bare `d` string, which the polyline test below cannot see at all —
    // it measures to `points`, and a slice has none. Under SVG that never showed,
    // because the DOM hit-tests the filled shape itself; under canvas it meant a
    // slice body was unclickable and only its rim handle could be grabbed. The mark
    // stamps the sector it drew, so both renderers agree on where a slice IS.
    if (mark.sector) {
        const { cx, cy, r0, r1, a0, a1 } = mark.sector;
        const d = Math.hypot(px - cx, py - cy);
        if (d < Math.max(0, r0) - HIT_TOLERANCE || d > r1 + HIT_TOLERANCE) return false;
        // Sweep direction is the layout's, not the compass's — compare the pointer's
        // offset from a0 against the sweep, both measured the same way round, so a
        // slice that crosses the ±180° seam is not two pieces.
        const sweep = a1 - a0;
        const dir = Math.sign(sweep) || 1;
        const theta = Math.atan2(-(py - cy), px - cx) * 180 / Math.PI;
        const from = ((((theta - a0) * dir) % 360) + 360) % 360;
        return from <= Math.abs(sweep);
    }
    if (mark.type === 'line' || mark.type === 'path') {
        const half = (mark.strokeWidth || 1) / 2;
        return distanceToMark(mark, px, py) <= half + HIT_TOLERANCE;
    }
    if (mark.type === 'text') {
        // A text mark's box is unknown to geometry; treat a small radius about its
        // anchor as the hit area (enough to grab a label handle).
        return Math.hypot(px - mark.x, py - mark.y) <= (mark.fontSize || 10) + HIT_TOLERANCE;
    }
    return false;
}

// A nearest edit needs a usable snap radius; 0 (makeEdit's default) would mean
// "exact hit only", which defeats the purpose, so fall back to a sane default.
export const DEFAULT_PICK_THRESHOLD = 40;

/**
 * An explicit positive threshold, else the fallback. The ONE place "did the author
 * set a threshold?" is decided, so a driver or edit that wants a different default
 * says so by passing one rather than re-implementing the test.
 * @param {number | undefined | null} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveThreshold(value, fallback = DEFAULT_PICK_THRESHOLD) {
    return value && value > 0 ? value : fallback;
}

/**
 * The snap radius for an edit, with an optional driver-specific default.
 *
 * `fallback` matters: a driver whose grab target is a small fixed handle wants a
 * tighter radius than a free proximity pick. axisDrag and slide each declared one
 * and then wrote `pickThreshold(edit) || THEIRS` — which can never reach the `||`,
 * because pickThreshold always returns at least 40. Both constants were dead, and
 * an axis handle was being grabbed from 40px away instead of 14.
 * @param {import('../types').Edit} edit
 * @param {number} [fallback]
 * @returns {number}
 */
export function pickThreshold(edit, fallback = DEFAULT_PICK_THRESHOLD) {
    return resolveThreshold(edit.threshold, fallback);
}

// A brush's edge zone needs a usable px radius; 0 would mean "the exact pixel
// only", making the edge essentially ungrabbable.
export const DEFAULT_EDGE_INSET = 8;

/**
 * @param {import('../types').Edit} edit
 * @returns {number}
 */
export function edgeInsetOf(edit) {
    const inset = /** @type {any} */ (edit).edgeInset;
    return inset && inset > 0 ? inset : DEFAULT_EDGE_INSET;
}

