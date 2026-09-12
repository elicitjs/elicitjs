// @ts-check
// brushRect driver — the 2-D sibling of the brush driver: composable edge / corner
// / body editing of a rect's four extents (x1/x2 AND y1/y2). Like brush.js it
// classifies the grab ONCE at dragstart and locks it in the feature's session for
// the whole gesture (so a continuous drag never re-decides zone mid-drag, which
// matters because endpoint fields can cross — rect.js always renders min/max, so it
// never cares which field holds which value). At dragend the same edit is
// re-invoked once with the zone forced to 'canonicalize' to swap any inverted
// pair's values (both axes) — an invisible, one-time data cleanup.
//
// The interaction is opt-in and composable via the edit's `resize` ('both' | 'x' |
// 'y' | 'none') and `move` (bool) options, read directly off the edit here (as the
// brush driver reads edit.edgeInset). A disabled resize zone degrades to `body`
// (when move is on), so one driver covers move-only, resize-only, single-axis, and
// full edges+corners.

import { edgeInsetOf } from '../pick.js';
import { encodeChannel } from '../../plot/mark.js';

/**
 * Which datum field currently sits at the low-pixel and high-pixel edge of one
 * axis's span. Resolved fresh (not assumed from the channel name) because a prior
 * crossover can leave x1 holding the larger value — mirrors brush.js's classifyZone.
 * @param {any} feature
 * @param {import('../../types').ScaleMap} scales
 * @param {any} datum
 * @param {'x' | 'y'} axis
 * @returns {{ loField: string, hiField: string } | null}
 */
function edgeFields(feature, scales, datum, axis) {
    const ch = feature.channels || {};
    const s1 = ch[axis + '1'];
    const s2 = ch[axis + '2'];
    if (!s1 || !s2 || !s1.field || !s2.field || !datum) return null;
    const p1 = encodeChannel(scales, ch, axis + '1', datum);
    const p2 = encodeChannel(scales, ch, axis + '2', datum);
    if (p1 == null || p2 == null) return null;
    const loField = p1 <= p2 ? s1.field : s2.field;
    const hiField = p1 <= p2 ? s2.field : s1.field;
    return { loField, hiField };
}

/**
 * Classify a grab against a rect's CURRENT rendered bounds (its scene node's
 * x/y/width/height), honoring the edit's resize/move gates. Returns the zone and
 * the field(s) it locks (1 for an edge, 2 for a corner, none for a body move).
 * @param {any} feature
 * @param {import('../../types').ScaleMap} scales
 * @param {any} datum
 * @param {any} node the rect's scene node
 * @param {number} px @param {number} py
 * @param {number} edgeInset
 * @param {'both' | 'x' | 'y' | 'none'} resize
 * @param {boolean} move
 * @returns {{ zone: 'corner' | 'edgeX' | 'edgeY' | 'body', fields: string[] } | null}
 */
function classifyZone2D(feature, scales, datum, node, px, py, edgeInset, resize, move) {
    const left = node.x, right = node.x + node.width;
    const top = node.y, bottom = node.y + node.height;

    const allowX = (resize === 'both' || resize === 'x');
    const allowY = (resize === 'both' || resize === 'y');
    const xf = allowX ? edgeFields(feature, scales, datum, 'x') : null;
    const yf = allowY ? edgeFields(feature, scales, datum, 'y') : null;

    /** @type {string | null} */
    let xEdge = null;
    if (xf) {
        const dl = Math.abs(px - left), dr = Math.abs(px - right);
        if (Math.min(dl, dr) <= edgeInset) xEdge = dl <= dr ? xf.loField : xf.hiField;
    }
    /** @type {string | null} */
    let yEdge = null;
    if (yf) {
        const dt = Math.abs(py - top), db = Math.abs(py - bottom);
        if (Math.min(dt, db) <= edgeInset) yEdge = dt <= db ? yf.loField : yf.hiField;
    }

    if (xEdge && yEdge) return { zone: 'corner', fields: [xEdge, yEdge] };
    if (xEdge) return { zone: 'edgeX', fields: [xEdge] };
    if (yEdge) return { zone: 'edgeY', fields: [yEdge] };
    if (move) return { zone: 'body', fields: [] };
    return null;
}

/**
 * The topmost rect whose bounds (grown by `inset`) contain the pointer, addressed
 * by its DATUM index. Iterates all rects and keeps the last match (drawn on top).
 * @param {any[]} marks
 * @param {number} px @param {number} py
 * @param {number} inset
 * @returns {number | null}
 */
function hitRect(marks, px, py, inset) {
    let hit = null;
    (marks || []).forEach((m) => {
        if (m.type !== 'rect' || m.index == null || m.width == null) return;
        if (px >= m.x - inset && px <= m.x + m.width + inset &&
            py >= m.y - inset && py <= m.y + m.height + inset) {
            hit = m.index;
        }
    });
    return hit;
}

/**
 * CSS cursor for a classified brushRect zone.
 * @param {'corner' | 'edgeX' | 'edgeY' | 'body' | null} zone
 * @returns {string}
 */
function cursorForZone(zone) {
    if (zone === 'corner') return 'nwse-resize';
    if (zone === 'edgeX') return 'ew-resize';
    if (zone === 'edgeY') return 'ns-resize';
    if (zone === 'body') return 'move';
    return 'default';
}

/** @type {import('./index.js').Driver} */
export const brushRectDriver = {
    name: 'brushRect',
    options: ['edgeInset', 'resize', 'move'],
    sessionKeys: ['px', 'py', 'hoverIndex', 'activeIndex', 'zone', 'fields', 'cursor'],
    // Writes hoverIndex/activeIndex (no radial threshold — a rect brush has edge
    // zones, not a snap radius), so the select effect draws the mark highlight.
    selects: true,
    onEvent({ feature, event, edits, marks, data, scales, session, runEdit }) {
        const edit = edits[0];
        const edgeInset = edgeInsetOf(edit);
        const resize = /** @type {any} */ (edit).resize || 'both';
        const move = /** @type {any} */ (edit).move !== false;
        let changed = false;

        if (event.type === 'hover') {
            const hit = hitRect(marks, event.x, event.y, edgeInset);
            const node = hit != null ? marks.find((m) => m.index === hit) : null;
            const zone = (hit != null && node)
                ? classifyZone2D(feature, scales, data[hit], node, event.x, event.y, edgeInset, resize, move)
                : null;
            session.set({
                px: event.x, py: event.y,
                hoverIndex: hit,
                cursor: cursorForZone(zone ? zone.zone : null)
            });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            const hit = hitRect(marks, event.x, event.y, edgeInset);
            const node = hit != null ? marks.find((m) => m.index === hit) : null;
            const zone = (hit != null && node)
                ? classifyZone2D(feature, scales, data[hit], node, event.x, event.y, edgeInset, resize, move)
                : null;
            session.set({
                px: event.x, py: event.y,
                hoverIndex: hit, activeIndex: hit,
                zone: zone ? zone.zone : null,
                fields: zone ? zone.fields : null,
                cursor: cursorForZone(zone ? zone.zone : null)
            });
            changed = true;
        } else if (event.type === 'drag') {
            const info = session.get();
            if (info) { info.px = event.x; info.py = event.y; }
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                if (runEdit(edit, index)) changed = true;
            }
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                // One-time cleanup tick: canonicalize both pairs, then commit.
                info.zone = 'canonicalize';
                runEdit(edit, index);
            }
            if (info) {
                info.activeIndex = null;
                info.cursor = 'default';
            }
            changed = true;
        }
        return changed;
    }
};
