// @ts-check
// probe.js — preview / settle lifecycle. Hover and drag preview the edit as a
// ghost (`previewEdit`); click or dragend commits it (`runEdit`). Both share one
// `computeEdit`, so the ghost is exactly what a commit writes.
//
//   angle:  { field: 'r',      edit: rotate({ pick: 'probe', stage: 0 }) }
//   spread: { field: 'spread', edit: rotate({ pick: 'probe', stage: 1, relativeTo: 'angle' }) }
//
// Committing a staged edit advances the stage, unless it sets `advance: false`.

import { nearestMark, pickThreshold } from '../pick.js';

/**
 * The datum a probe targets: the nearest mark, else row 0 of a single-row table.
 * @param {any} ctx
 * @param {import('../../types').Edit} edit
 * @returns {number | null}
 */
function targetIndex(ctx, edit) {
    const { marks, data, event } = ctx;
    if (event.x != null && event.y != null) {
        const hit = nearestMark(marks, event.x, event.y, pickThreshold(edit));
        if (hit != null) return hit;
    }
    return data.length === 1 ? 0 : null;
}

/** @type {import('./index.js').Driver} */
export const probeDriver = {
    name: 'probe',
    sessionKeys: [],
    onEvent: (ctx) => {
        const { event, edits, preview, stage, runEdit, previewEdit } = ctx;
        if (!edits.length) return false;
        const type = event.type;

        // Preview; if nothing proposes, clear the stale ghost.
        if (type === 'hover' || type === 'dragstart' || type === 'drag') {
            let any = false;
            for (const edit of edits) {
                if (previewEdit(edit, targetIndex(ctx, edit))) any = true;
            }
            return any || preview.clear();
        }

        // Leaving the plane drops the proposal — the ghost vanishes.
        if (type === 'hoverout') return preview.clear();

        // Settle: commit, then advance the stage. The renderer drops the click after
        // a drag, so a drag settles once.
        if (type === 'click' || type === 'dragend') {
            let changed = false;
            let advance = false;
            for (const edit of edits) {
                if (!runEdit(edit, targetIndex(ctx, edit))) continue;
                changed = true;
                if (edit.stage != null && edit.advance !== false) advance = true;
            }
            if (advance) stage.next();
            return changed;
        }

        return false;
    }
};
