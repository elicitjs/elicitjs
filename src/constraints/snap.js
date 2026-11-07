// @ts-check
import { defineConstraint, constraintOptions, changedCells } from './define.js';

// snap: quantizes a field's value to a discrete grid — a data invariant.
//
// Every cell the proposal changed in `field` is rounded to the nearest multiple
// of `step`, measured from `origin` (default 0). This is how a waffle picker lands
// on whole cells and a stepped slider lands on ticks: the gesture inverts to a
// continuous value in the edit's apply(), then this invariant snaps it — pure
// data, no pixels. `field` names the column(s) it governs; omitted, it is the
// column the dispatching edit writes.
//
// It snaps CELLS, not "the value": a stack edge moves two rows, an `ordering` push
// moves a sibling column, and a rule that read only the active datum left those
// off the grid (and broke a stack's total). A temporal cell stays a Date — the
// grid is in milliseconds, and the rounded time is re-wrapped.
//
// Its guide (edit/guide.js) is a tick per stop along the value axis: a snap has no
// single boundary line to draw, but it does have a grid, and showing it is what
// tells you WHY the handle you're dragging keeps landing between your fingers.

/**
 * @param {{ step?: number, origin?: number, field?: string | string[] }} [options]
 * @returns {import('../types').Constraint}
 */
export function snap(options = {}) {
    const { step = 1, origin = 0, field } = constraintOptions('snap', options);
    const originMs = /** @type {any} */ (origin) instanceof Date ? /** @type {any} */ (origin).getTime() : origin;

    return defineConstraint(
        (ctx) => {
            if (!(step > 0)) return undefined;
            const cells = changedCells(ctx);
            if (!cells.length) return undefined;
            let out = ctx.data;
            let touched = false;
            for (const { i, field: f } of cells) {
                const v = out[i][f];
                if (v == null) continue;
                const n = v instanceof Date ? v.getTime() : v;
                if (typeof n !== 'number' || !Number.isFinite(n)) continue;
                const snapped = originMs + Math.round((n - originMs) / step) * step;
                if (snapped === n) continue;
                const stored = v instanceof Date ? new Date(snapped) : snapped;
                if (!touched) { out = out.slice(); touched = true; }
                out[i] = { ...out[i], [f]: stored };
            }
            return touched ? out : undefined;
        },
        { type: 'snap', options: { step, origin }, field }
    );
}
