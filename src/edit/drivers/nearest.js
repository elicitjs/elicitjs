// @ts-check
// nearest driver — proximity editing from the plane: resolve the closest mark to
// the pointer within a threshold and edit it, holding a lock across a drag so a
// mark stays grabbed even as the pointer leaves it. Also maintains the transient
// session selection (px/py/threshold + hover/active index) that the edit's guide
// draws as a snap ring + highlight.

import { nearestMark, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const nearestDriver = {
    name: 'nearest',
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex'],
    selects: true,
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
            // Any other gesture a nearest edit declares — a drag (uses the lock set
            // on dragstart) or a discrete click/dblclick delete (resolve a fresh
            // nearest target). Keep the ring at the pointer either way.
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
