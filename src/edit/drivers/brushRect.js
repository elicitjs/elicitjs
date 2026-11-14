// @ts-check
// brushRect driver — edge / corner / body editing of a rect's x1/x2 and y1/y2.
// Classifies the grab once at dragstart and locks it in the session; at dragend
// re-runs the edit with `zone: 'canonicalize'`. Reads the edit's `resize` and
// `move` options; a disabled resize zone falls back to `body`.

import { edgeInsetOf, rectAt } from '../pick.js';
import { brushDrag, brushRelease } from './brush.js';
import { encodeChannel } from '../../plot/mark.js';

/**
 * Which field currently sits at the low- and high-pixel edge of one axis's span.
 * Resolved from pixels, since x1 may hold the larger value after a crossover.
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
 * Classify a grab against the rect node's bounds, honouring resize/move. Returns
 * the zone and the field(s) it locks (1 for an edge, 2 for a corner, none for body).
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
    // Writes hoverIndex/activeIndex (no threshold, so no catchment ring is drawn).
    selects: true,
    onEvent({ feature, event, edits, marks, data, scales, session, runEdit }) {
        const edit = edits[0];
        const edgeInset = edgeInsetOf(edit);
        const resize = /** @type {any} */ (edit).resize || 'both';
        const move = /** @type {any} */ (edit).move !== false;
        let changed = false;

        if (event.type === 'hover') {
            const hit = rectAt(marks, event.x, event.y, edgeInset);
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
            const hit = rectAt(marks, event.x, event.y, edgeInset);
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
            brushDrag(session, event, edit, runEdit);
            changed = true;
        } else if (event.type === 'dragend') {
            const info = brushRelease(session, edit, runEdit);
            if (info) info.cursor = 'default';
            changed = true;
        }
        return changed;
    }
};
