// @ts-check
// probe.js — the ghost-preview / settle lifecycle. The pointer PROBES a value: the
// proposal follows the cursor as an inert GHOST mark (the committed mark stays put),
// and a commit SETTLES it — writing the datum and advancing any stage. Two gestures
// settle, so both natural expectations work:
//   · move-then-click — no button held; the ghost tracks the pointer, a click
//     settles it. The classic multi-step elicitation ("move the line, click to set
//     it; now open the cone, click to set that too") and the dot plot's tentative dot.
//   · grab-and-drag  — press on the mark, drag (the ghost tracks the drag), release
//     to settle. This is what a slider/thermometer expects; before, a probe ignored
//     drag entirely and the renderer swallowed the trailing click, so a dragged
//     probe committed NOTHING. Now dragend settles.
//
//   angle:  { field: 'r',      edit: rotate({ pick: 'probe', stage: 0 }) }
//   spread: { field: 'spread', edit: rotate({ pick: 'probe', stage: 1, relativeTo: 'angle' }) }
//
// It runs the SAME edit twice through two engine entry points that share one
// `computeEdit` (apply + invariants): `previewEdit` on hover/drag (parked in the
// transient per-feature preview store, rendered as a ghost, never seen by
// onChange/getData) and `runEdit` on click/dragend (committed). So the ghost is
// guaranteed to be exactly what a commit writes — there is no second, drifting
// "preview" code path. A hover that lands on an invalid spot (no proposal) clears
// the stale ghost so it snaps back to the committed mark.
//
// Stage advance: an edit that carries a `stage` settles that stage on commit, so
// the driver calls `stage.next()` and the engine's stage gate deactivates it —
// the field is frozen and the next stage's edit takes over. An unstaged probe
// edit (the dot plot's `create`) just commits, over and over. `advance: false`
// opts a staged edit out.

import { nearestMark, pickThreshold } from '../pick.js';

/**
 * The datum a probe gesture targets. Whole-dataset edits (rotate, create) ignore
 * it; a per-datum edit (drag) needs one, so resolve the nearest mark — and treat
 * a single-datum feature (a trend line, a face) as always being the target, since
 * its glyph is drawn from that one belief and carries no pickable node.
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

        // PREVIEW — a hover (no button) or a drag-move (button held) both propose the
        // value at the pointer without committing; the engine renders it as a ghost.
        // dragstart previews too, so the ghost appears the instant the press lands.
        // If NOTHING proposed (an invalid spot — outside a band, a rejected value),
        // clear any stale ghost so it snaps back to the committed mark.
        if (type === 'hover' || type === 'dragstart' || type === 'drag') {
            let any = false;
            for (const edit of edits) {
                if (previewEdit(edit, targetIndex(ctx, edit))) any = true;
            }
            return any || preview.clear();
        }

        // Leaving the plane drops the proposal — the ghost vanishes.
        if (type === 'hoverout') return preview.clear();

        // SETTLE — a click (move-then-click) or a drag release (grab-and-drag) commits
        // the same proposal, then advances past any stage the committed edits belong
        // to (the gate then deactivates them). The renderer suppresses the click that
        // trails a real drag, so a drag settles exactly once via dragend.
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
