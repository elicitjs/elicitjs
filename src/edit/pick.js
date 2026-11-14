// @ts-check
// pick.js — target selection and hit geometry for edits: nearest-mark
// searches, containment hit tests, and pick thresholds.
//
// Geometry tests run in the mark's unrotated frame (`unrotate` about `markCenter`).

import { markCenter } from './shared.js';

/**
 * Distance from pointer to a mark, per mark type:
 *   circle -> euclidean distance to the centre.
 *   ellipse -> distance to the centre.
 *   rect   -> distance to the bar's band interval along `bandAxis`, so any point
 *             in the column selects the bar.
 *   line   -> point-to-segment distance.
 *   path   -> 0 inside a filled polygon, else distance to the polyline.
 * @param {any} mark
 * @param {number} px
 * @param {number} py
 * @returns {number}
 */
export function distanceToMark(mark, px, py) {
    const p = unrotate(mark, px, py);
    if (mark.type === 'circle') {
        return Math.hypot(p.x - mark.cx, p.y - mark.cy);
    }
    if (mark.type === 'ellipse') {
        // Centre distance ranks candidates; containsPoint does the elliptical test.
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
        // A filled shape: inside its outline polygon is distance 0.
        if (mark.polygon && pointInPolygon(mark.points || [], p.x, p.y)) return 0;
        // Min distance over the polyline's segments. Paths bake rotation into points.
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
 * The pointer in a rotated node's own frame: undo `node.angle` about `markCenter`,
 * the same pivot the renderers rotate about.
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
 * Is a point inside a polygon (ray casting, even-odd)?
 * @param {[number, number][]} pts
 * @param {number} px @param {number} py
 * @returns {boolean}
 */
export function pointInPolygon(pts, px, py) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * Distance from a point to the segment (ax,ay)-(bx,by).
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
 * The datum index of the nearest mark within `threshold`, or null. `series`
 * restricts the search to one line's handles.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {any} [series] restrict to marks with this `series` key
 * @returns {number | null}
 */
export function nearestMark(marks, px, py, threshold, series) {
    const node = nearestNode(marks, px, py, threshold, series);
    return node ? node.index : null;
}

/**
 * The `series` key of the line closest to the pointer within `threshold`, or null.
 * Measured to the line's path, falling back to handle centres for a one-point series.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {{ includeLocked?: boolean }} [options] `includeLocked`: also consider
 *   locked lines (for append-only edits like anchor).
 * @returns {any | null}
 */
export function nearestSeries(marks, px, py, threshold, options = {}) {
    let bestSeries = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark) => {
        if (mark.series === undefined) return;
        if (mark.locked && !options.includeLocked) return;
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
 * The nearest datum-bearing node within `threshold`, for callers that need the
 * node's tags (e.g. which edge a handle belongs to), not just its row.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {any} [series] restrict to marks with this `series` key
 * @returns {any | null}
 */
export function nearestNode(marks, px, py, threshold, series) {
    let best = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark) => {
        // Datum-bearing nodes only (skip a line's path); a locked row is not a target.
        if (mark.index == null || mark.locked) return;
        if (series !== undefined && mark.series !== series) return;
        const d = distanceToMark(mark, px, py);
        if (d < bestDist) { bestDist = d; best = mark; }
    });
    return best != null && bestDist <= threshold ? best : null;
}

/**
 * The datum index of the nearest mark measured along one axis only (the sweep
 * target). Any datum-bearing node with a `markCenter` is eligible.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {'x' | 'y'} axis
 * @param {any} [series] restrict to marks with this `series` key (series-locked sweep)
 * @param {(mark: any) => boolean} [accept] a further filter (e.g. one edge's handles)
 * @returns {number | null}
 */
export function nearestMarkOnAxis(marks, px, py, threshold, axis, series, accept) {
    let best = null;
    let bestDist = Infinity;
    (marks || []).forEach((mark) => {
        if (mark.locked) return;        // a read-only row is not a target (spec.lock)
        if (series !== undefined && mark.series !== series) return;
        if (mark.index == null) return; // datum-bearing marks only (skip a line's path)
        if (accept && !accept(mark)) return;
        const c = markCenter(mark);
        if (!c) return;
        const center = axis === 'x' ? c.cx : c.cy;
        if (center == null) return;
        const d = Math.abs((axis === 'x' ? px : py) - center);
        if (d < bestDist) { bestDist = d; best = mark.index; }
    });
    return best != null && bestDist <= threshold ? best : null;
}

/**
 * The topmost rect node whose bounds (grown by `inset`) contain the pointer, by
 * datum index, or null. The last match wins: it is drawn on top.
 * @param {any[]} marks
 * @param {number} px @param {number} py
 * @param {number} inset
 * @returns {number | null}
 */
export function rectAt(marks, px, py, inset) {
    /** @type {number | null} */
    let hit = null;
    for (const m of marks || []) {
        if (m.type !== 'rect' || m.index == null) continue;
        if (m.x == null || m.y == null || m.width == null || m.height == null) continue;
        if (px >= m.x - inset && px <= m.x + m.width + inset
            && py >= m.y - inset && py <= m.y + m.height + inset) hit = m.index;
    }
    return hit;
}

// How far outside a mark's outline still counts as on it, in px.
export const HIT_TOLERANCE = 4;

// Minimum grabbable rect thickness, in px, so a zero-height bar stays grabbable.
// Floors only the hit box, never the drawn geometry. The SVG renderer uses it too.
export const MIN_GRAB = 12;

/**
 * A rect node's hit box: its drawn box, each dimension grown symmetrically to at
 * least MIN_GRAB.
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
 * The topmost editable mark containing the pointer, or null. The geometric
 * hit test for renderers without DOM hit-testing (canvas). Walks the scene
 * back to front, and skips nodes that are not `editable` (or `hoverable` on
 * hover), locked, guides, backgrounds, or `pointerEvents: 'none'`.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {boolean} [hover] also accept a `hoverable` node (what a hover reports, not what a press grabs)
 * @returns {any | null} the hit node object (not its index), or null
 */
export function hitTest(marks, px, py, hover = false) {
    const list = marks || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const mark = list[i];
        if (!mark || !(mark.editable || (hover && mark.hoverable))) continue;
        if (mark.locked || mark.guide || mark.background) continue;
        if (mark.pointerEvents === 'none') continue;
        if (containsPoint(mark, px, py)) return mark;
    }
    return null;
}

/**
 * The nodes a pointer can reach under the clip rect (from `clipRect`): all of
 * them inside it, only `unclipped` ones outside. With no clip, every node.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {{ x?: number, y?: number, width: number, height: number } | null | undefined} clip
 * @returns {any[]}
 */
export function clipVisible(marks, px, py, clip) {
    const x0 = clip ? clip.x || 0 : 0;
    const y0 = clip ? clip.y || 0 : 0;
    if (!clip || (px >= x0 && py >= y0 && px <= x0 + clip.width && py <= y0 + clip.height)) return marks || [];
    return (marks || []).filter((m) => m && m.unclipped);
}

/**
 * The topmost datum-bearing node under the pointer, editable or not (for tooltips
 * and readouts). Skips guides, backgrounds, effect overlays, invisible `hit`
 * overlays, and nodes that carry no row.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @returns {any | null}
 */
export function hitTestAny(marks, px, py) {
    const list = marks || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const mark = list[i];
        if (!mark || mark.guide || mark.background || mark.effect || mark.hit) continue;
        if (mark.index == null && mark.data == null && !Array.isArray(mark.pointRows)) continue;
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
        // Normalized elliptical test, with the tolerance added to each radius.
        const c = unrotate(mark, px, py);
        const rx = Math.max(1e-6, (mark.rx != null ? mark.rx : 5) + HIT_TOLERANCE);
        const ry = Math.max(1e-6, (mark.ry != null ? mark.ry : 5) + HIT_TOLERANCE);
        return Math.hypot((c.x - mark.cx) / rx, (c.y - mark.cy) / ry) <= 1;
    }
    if (mark.type === 'rect') {
        // Floor to MIN_GRAB, then add the tolerance; test in the unrotated frame.
        const box = rectHitBox(mark);
        const p = unrotate(mark, px, py);
        return p.x >= box.x - HIT_TOLERANCE && p.x <= box.x + box.w + HIT_TOLERANCE
            && p.y >= box.y - HIT_TOLERANCE && p.y <= box.y + box.h + HIT_TOLERANCE;
    }
    // An annular sector (pie/donut slice), stamped by the mark; it has no `points`.
    if (mark.sector) {
        const { cx, cy, r0, r1, a0, a1 } = mark.sector;
        const d = Math.hypot(px - cx, py - cy);
        if (d < Math.max(0, r0) - HIT_TOLERANCE || d > r1 + HIT_TOLERANCE) return false;
        // Measure the pointer's angle from a0 in the sweep's direction, so a slice
        // crossing ±180° stays one piece.
        const sweep = a1 - a0;
        const dir = Math.sign(sweep) || 1;
        const theta = Math.atan2(-(py - cy), px - cx) * 180 / Math.PI;
        const from = ((((theta - a0) * dir) % 360) + 360) % 360;
        return from <= Math.abs(sweep);
    }
    if (mark.type === 'path' && mark.polygon) {
        // A filled shape: anywhere inside its outline, or within the tolerance of it.
        return distanceToMark(mark, px, py) <= HIT_TOLERANCE;
    }
    if (mark.type === 'line' || mark.type === 'path') {
        const half = (mark.strokeWidth || 1) / 2;
        return distanceToMark(mark, px, py) <= half + HIT_TOLERANCE;
    }
    if (mark.type === 'text') {
        // No text box is known here; use a radius about the anchor.
        return Math.hypot(px - mark.x, py - mark.y) <= (mark.fontSize || 10) + HIT_TOLERANCE;
    }
    return false;
}

// Snap radius in px when an edit sets no positive `threshold`.
export const DEFAULT_PICK_THRESHOLD = 40;

/**
 * An explicit positive threshold, else the fallback.
 * @param {number | undefined | null} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveThreshold(value, fallback = DEFAULT_PICK_THRESHOLD) {
    return value && value > 0 ? value : fallback;
}

/**
 * The snap radius for an edit: its `threshold`, else `fallback` (a driver may
 * pass a tighter default).
 * @param {import('../types').Edit | null | undefined} edit
 * @param {number} [fallback]
 * @returns {number}
 */
export function pickThreshold(edit, fallback = DEFAULT_PICK_THRESHOLD) {
    return resolveThreshold(edit ? edit.threshold : undefined, fallback);
}

// Default px width of a brush's edge zone.
const DEFAULT_EDGE_INSET = 8;

/**
 * @param {import('../types').Edit} edit
 * @returns {number}
 */
export function edgeInsetOf(edit) {
    const inset = /** @type {any} */ (edit).edgeInset;
    return inset && inset > 0 ? inset : DEFAULT_EDGE_INSET;
}

