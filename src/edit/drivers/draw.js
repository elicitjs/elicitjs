// @ts-check
// draw driver — author-lines-by-dragging, edit-aware. On dragstart it resolves
// proximity to existing lines and locks a MODE for the whole drag: near an
// existing line -> 'edit' (sweep that series); empty space (or into:'new') ->
// 'draw' (a fresh series, points laid down as the pointer moves). The lock (mode
// + series + pointer/domain trail) lives in the feature's session; the draw
// edit's apply() reads it via ctx.session. So one gesture both reshapes drawn
// lines and draws new ones.

import { nearestSeries, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const drawDriver = {
    name: 'draw',
    // `drawIndex` is geo draw's (edit/geo.js): the row whose coordinate list this
    // stroke is authoring. It is cleared with the rest, or the NEXT stroke keeps
    // appending to the row the last one made.
    sessionKeys: ['mode', 'drawSeries', 'drawContinue', 'drawIndex', 'lastDomain', 'lastX', 'lastY', 'px', 'py'],
    onEvent({ feature, event, edits, marks, data, session, runEdit }) {
        const threshold = pickThreshold(edits[0]);
        let changed = false;

        if (event.type === 'dragstart') {
            // Near an existing line? Edit it. Otherwise start a new series. `into:
            // 'new'` forces always-draw (never grabs a neighbour).
            const near = edits[0].into === 'new'
                ? null
                : nearestSeries(marks, event.x, event.y, threshold);
            if (near != null) {
                session.set({ mode: 'edit', drawSeries: near, px: event.x, py: event.y });
            } else {
                // Freehand lines (connect: 'sequence') stay ONE path: a far drag
                // continues the existing line — appending in draw order — instead of
                // spawning a new series. `into: 'new'` opts back into a fresh line;
                // domain lines still start a new series per drag. WHICH series that
                // is (the last unlocked one, or a key minted from the schema's
                // declared domain) is the edit's to resolve on its first tick: it
                // sees the schema and the lock, and this driver sees neither.
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
