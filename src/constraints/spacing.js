// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// spacing: adjacent values along a field must stay at least `min` apart — a data
// invariant.
//
//   spacing({ field: 'x', min: 5 })    // no two points closer than 5 in x
//
// For elicitations where "distinct" is part of the claim: thresholds of a scale,
// breakpoints of a piecewise curve, tiers of a rubric. Two coincident points may
// be a genuine belief, but more often they're a slip of the hand that reads as one
// point and can never be separated again — the topmost one takes every subsequent
// grab.
//
// It repairs by pushing neighbours away from the moved row (which is the one the
// person meant), the same way `ordering` and `monotonic` do. `min` is in DATA
// units, not pixels: a constraint never sees the scale, and a rule that changed
// meaning when the chart was resized wouldn't be an invariant at all.
//
// Note this also implies an order (pushing apart preserves the sort), so a field
// with `spacing` doesn't need `ordering` as well.

/**
 * @param {{ field?: string, min?: number, series?: string | null }} [options]
 *   field   the field whose values must stay apart (default 'x').
 *   min     the smallest allowed gap, in data units (default 1).
 *   series  group rows by this field first, so each line is judged on its own.
 * @returns {import('../types').Constraint}
 */
export function spacing(options = {}) {
    const { field, min = 1, series = null } = constraintOptions('spacing', options);

    return defineConstraint(
        ({ data, activeIndex, field }) => {
            if (!data || data.length < 2 || !(min > 0) || field == null) return undefined;

            /** @type {Map<any, number[]>} */
            const groups = new Map();
            data.forEach((d, i) => {
                const key = series ? d[series] : null;
                if (!groups.has(key)) groups.set(key, []);
                /** @type {number[]} */ (groups.get(key)).push(i);
            });

            const next = data.map((d) => ({ ...d }));
            let touched = false;

            for (const indices of groups.values()) {
                const run = indices
                    .filter((i) => Number.isFinite(Number(next[i][field])))
                    .sort((a, b) => Number(next[a][field]) - Number(next[b][field]));
                if (run.length < 2) continue;

                // Push out from the moved row so it keeps the value it was given;
                // with nothing moved, settle the run from its low end.
                const at = run.indexOf(/** @type {number} */(activeIndex));
                const pivot = at >= 0 ? at : 0;

                for (let k = pivot + 1; k < run.length; k++) {
                    const floor = Number(next[run[k - 1]][field]) + min;
                    if (Number(next[run[k]][field]) < floor) { next[run[k]][field] = floor; touched = true; }
                }
                for (let k = pivot - 1; k >= 0; k--) {
                    const ceil = Number(next[run[k + 1]][field]) - min;
                    if (Number(next[run[k]][field]) > ceil) { next[run[k]][field] = ceil; touched = true; }
                }
            }

            return touched ? next : undefined;
        },
        { type: 'spacing', options: { min, series }, field }
    );
}
