// @ts-check
// axisDrag driver — the drag lifecycle for `edit.axis.scale`, claimed by type so
// the plane stays down. At dragstart it copies the grabbed end-handle's geometry
// into the session; the edit turns that plus the pointer into the new domain.

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
 * Copy a handle's drag geometry into the session at dragstart, so the anchor and
 * slope stay fixed while the handle moves.
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
    wants: (e) => e.type === 'axis.scale',
    onEvent({ event, edits, marks, session, runEdit }) {
        const edit = edits[0];
        const threshold = pickThreshold(edit, HANDLE_THRESHOLD);
        let changed = false;

        if (event.type === 'dragstart') {
            // Lock onto the grabbed handle; no handle means a no-op drag.
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
