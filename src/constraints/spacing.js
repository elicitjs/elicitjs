// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { groupRows, rewrap } from './shared.js';

// spacing: adjacent values of a field stay at least `min` apart (in data units).
//
//   spacing({ field: 'x', min: 5 })    // no two points closer than 5 in x
//
// Repairs by pushing neighbours away from the moved row.

/**
 * @param {{ field?: string, min?: number, series?: string | null }} [options]
 *   field   the field whose values must stay apart (default: the column the edit writes).
 *   min     the smallest allowed gap, in data units (default 1).
 *   series  group rows by this field first, so each line is judged on its own.
 * @returns {import('../types').Constraint}
 */
export function spacing(options = {}) {
    const { field, min = 1, series = null } = constraintOptions('spacing', options);

    return defineConstraint(
        ({ data, activeIndex, field, domain }) => {
            if (!data || data.length < 2 || !(min > 0) || field == null) return undefined;
            const bounds = Array.isArray(domain) && domain.length >= 2
                ? [Math.min(...domain.map(Number)), Math.max(...domain.map(Number))]
                : null;

            const groups = groupRows(data, (d) => (series ? d[series] : null));

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

                // Cap the dragged value k·min inside each domain wall (k = rows
                // beyond it), so the push never carries a neighbour past the wall.
                if (at >= 0 && bounds) {
                    const [lo, hi] = bounds;
                    const v = Number(next[run[at]][field]);
                    const capped = Math.max(lo + at * min, Math.min(hi - (run.length - 1 - at) * min, v));
                    if (Number.isFinite(capped) && capped !== v) { next[run[at]][field] = rewrap(next[run[at]][field], capped); touched = true; }
                }

                for (let k = pivot + 1; k < run.length; k++) {
                    const floor = Number(next[run[k - 1]][field]) + min;
                    if (Number(next[run[k]][field]) < floor) { next[run[k]][field] = rewrap(next[run[k]][field], floor); touched = true; }
                }
                for (let k = pivot - 1; k >= 0; k--) {
                    const ceil = Number(next[run[k + 1]][field]) - min;
                    if (Number(next[run[k]][field]) > ceil) { next[run[k]][field] = rewrap(next[run[k]][field], ceil); touched = true; }
                }
            }

            return touched ? next : undefined;
        },
        { type: 'spacing', options: { min, series }, field }
    );
}
