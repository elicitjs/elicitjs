// @ts-check
// axisDrag driver — the drag lifecycle for an EDITABLE numeric/temporal axis.
//
// The axis mark (plot/axis.js) emits draggable end-handles, one per domain extreme,
// each carrying the FROZEN drag geometry it was drawn with (which end, the axis it
// runs along, the anchored extreme's pixel+value, this extreme's pixel+value, and
// the pixels-per-unit). At dragstart this driver locks the grabbed handle's geometry
// into the feature session (mirrors brush.js's dragstart zone lock), then runs the
// edit each tick so the domain rescales live. The edit itself (edit.axis.scale)
// turns the locked snapshot + the pointer into the new domain — the driver owns only
// target selection and the multi-event lifecycle, never the domain math.

import { pickThreshold } from '../pick.js';

const HANDLE_THRESHOLD = 14;

/**
 * The nearest axis end-handle node to the pointer, within threshold.
 * @param {any[]} marks @param {number} px @param {number} py @param {number} threshold
 * @returns {any | null}
 */
function nearestHandle(marks, px, py, threshold) {
    let best = null;
    let bestDist = threshold;
    for (const m of marks || []) {
        if (!m || !m.axisHandle) continue;
        const cx = m.cx != null ? m.cx : m.x;
        const cy = m.cy != null ? m.cy : m.y;
        const d = Math.hypot(px - cx, py - cy);
        if (d <= bestDist) { bestDist = d; best = m; }
    }
    return best;
}

/**
 * Copy a handle node's frozen drag geometry into the session lock. Snapshotting at
 * dragstart (not re-reading the live node) is what lets the domain grow smoothly:
 * the handle moves under the pointer every tick, but the anchor + slope it rescales
 * against stay the values it started from.
 * @param {any} handle
 * @returns {import('../../types').Session}
 */
function lockFrom(handle) {
    return {
        axis: handle.axis,
        grabEnd: handle.handle,
        anchorPixel: handle.anchorPixel,
        anchorValue: handle.anchorValue,
        grabPixel: handle.grabPixel,
        grabValue: handle.grabValue,
        pxPerUnit: handle.pxPerUnit,
        cursor: handle.axis === 'x' ? 'ew-resize' : 'ns-resize'
    };
}

/** @type {import('./index.js').Driver} */
export const axisDragDriver = {
    name: 'axisDrag',
    sessionKeys: ['axis', 'grabEnd', 'anchorPixel', 'anchorValue', 'grabPixel', 'grabValue', 'pxPerUnit', 'cursor'],
    onEvent({ event, edits, marks, session, runEdit }) {
        const edit = edits[0];
        const threshold = pickThreshold(edit, HANDLE_THRESHOLD);
        let changed = false;

        if (event.type === 'hover') {
            // Show the resize cursor only when a handle is under the pointer; only
            // re-render when that state flips (the plane reads session.cursor).
            const hit = nearestHandle(marks, event.x, event.y, threshold);
            const cursor = hit ? (hit.axis === 'x' ? 'ew-resize' : 'ns-resize') : null;
            const cur = session.get();
            if ((cur && cur.cursor) !== cursor) { session.set({ cursor }); changed = true; }
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            // Lock onto the grabbed handle for the whole gesture (or nothing, if the
            // press didn't start on a handle — then the axis drag is a no-op).
            const hit = nearestHandle(marks, event.x, event.y, threshold);
            if (hit) { session.set(lockFrom(hit)); changed = true; }
        } else if (event.type === 'drag') {
            const lock = session.get();
            if (lock && lock.grabEnd && runEdit(edit, null)) changed = true;
        } else if (event.type === 'dragend') {
            session.clear();
            changed = true;
        }
        return changed;
    }
};
