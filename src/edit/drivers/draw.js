// @ts-check
// draw driver — at dragstart locks a mode in the session: 'edit' near an existing
// line (that series), else 'draw' (a new or continued series). The draw edits
// read it from ctx.session.

import { nearestSeries, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const drawDriver = {
    name: 'draw',
    cursor: 'crosshair',
    // `drawIndex` is geo draw's row for this stroke; cleared so the next stroke starts fresh.
    sessionKeys: ['mode', 'drawSeries', 'drawContinue', 'drawIndex', 'lastDomain', 'lastX', 'lastY', 'px', 'py'],
    onEvent({ feature, event, edits, marks, data, session, runEdit }) {
        const threshold = pickThreshold(edits[0]);
        let changed = false;

        if (event.type === 'dragstart') {
            // Near a line: edit it. `into: 'new'` always draws.
            const near = edits[0].into === 'new'
                ? null
                : nearestSeries(marks, event.x, event.y, threshold);
            if (near != null) {
                session.set({ mode: 'edit', drawSeries: near, px: event.x, py: event.y });
            } else {
                // Freehand (connect: 'sequence') continues the existing line; the edit
                // resolves which series on its first tick.
                const continueLine = feature.connect === 'sequence'
                    && data.length > 0
                    && edits[0].into !== 'new';
                session.set({ mode: 'draw', drawSeries: null, drawContinue: continueLine, lastDomain: null, lastX: null, lastY: null, px: event.x, py: event.y });
            }
            edits.forEach((edit) => { if (runEdit(edit, null)) changed = true; });
            changed = true;
        } else if (event.type === 'drag') {
            const info = session.get();
            if (info) { info.px = event.x; info.py = event.y; }
            edits.forEach((edit) => { if (runEdit(edit, null)) changed = true; });
            changed = true;
        } else if (event.type === 'dragend') {
            session.clear();
            changed = true;
        }
        return changed;
    }
};
