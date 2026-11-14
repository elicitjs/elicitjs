// @ts-check
// nearest driver — edit the closest mark within a threshold, locked for the drag.
// Writes px/py/threshold and hover/active index for the catchment ring.

import { nearestMark, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const nearestDriver = {
    name: 'nearest',
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex'],
    selects: true,
    // The edit's apply is an ordinary per-row write; this driver only finds the row.
    targetsRow: true,
    onEvent({ event, edits, marks, session, runEdit }) {
        const threshold = pickThreshold(edits[0]);
        let changed = false;

        if (event.type === 'hover') {
            const hit = nearestMark(marks, event.x, event.y, threshold);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit });
            changed = true; // redraw ring only
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            const hit = nearestMark(marks, event.x, event.y, threshold);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit, activeIndex: hit });
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            if (info) info.activeIndex = null;
            changed = true;
        } else {
            // Drag uses the dragstart lock; click/dblclick resolves the nearest mark.
            const info = session.get();
            if (info) { info.px = event.x; info.py = event.y; }
            const matching = edits.filter((e) => e.gesture === event.type);
            if (matching.length > 0) {
                let index = info ? info.activeIndex : null;
                if (index == null) index = nearestMark(marks, event.x, event.y, threshold);
                if (index != null) {
                    matching.forEach((edit) => { if (runEdit(edit, index)) changed = true; });
                }
            } else if (info) {
                changed = true; // nothing to run; still redraw the ring
            }
        }
        return changed;
    }
};
