// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { groupRows, numOf, rewrap } from './shared.js';

// monotonic: a field only goes one way along `along`, per series.
//
//   monotonic({ field: 'p', along: 'x' })              // non-decreasing in x
//   monotonic({ field: 'p', along: 'x', dir: 'down' }) // non-increasing
//
// Repairs by pushing the rows the moved point crossed. Rows are ordered by
// `along`, not array position.

/**
 * @param {{ field?: string, along?: string, dir?: 'up' | 'down',
 *   series?: string | null }} [options]
 *   field   the value that must not reverse (default: the column the edit writes).
 *   along   the axis it runs along (default 'x').
 *   dir     'up' = non-decreasing (default), 'down' = non-increasing.
 *   series  group rows by this field first, so each line is judged on its own.
 * @returns {import('../types').Constraint}
 */
export function monotonic(options = {}) {
    const { field, along = 'x', dir = 'up', series = null } = constraintOptions('monotonic', options);
    const up = dir !== 'down';

    return defineConstraint(
        ({ data, activeIndex, field, locked }) => {
            if (!data || data.length < 2 || field == null) return undefined;

            // One group per series; a single unkeyed group when there is none.
            const groups = groupRows(data, (d) => (series ? d[series] : null));

            const next = data.map((d) => ({ ...d }));
            let touched = false;

            for (const indices of groups.values()) {
                // Order by `along`, not array position.
                const run = indices
                    .filter((i) => Number.isFinite(Number(next[i][field])))
                    .sort((a, b) => numOf(next[a][along]) - numOf(next[b][along]));
                if (run.length < 2) continue;

                // Sweep out from the moved point so it keeps its value; with no
                // moved point in this series, sweep from the start.
                const at = run.indexOf(/** @type {number} */(activeIndex));
                const pivot = at >= 0 ? at : 0;

                // Locked rows don't move (the lock runs last), so cap the active
                // value by the nearest locked row on each side instead of pushing it.
                if (at >= 0 && locked) {
                    let v = Number(next[run[at]][field]);
                    for (let k = at + 1; k < run.length; k++) {
                        if (!locked(next[run[k]], run[k])) continue;
                        const bound = Number(next[run[k]][field]);
                        v = up ? Math.min(v, bound) : Math.max(v, bound);
                        break;
                    }
                    for (let k = at - 1; k >= 0; k--) {
                        if (!locked(next[run[k]], run[k])) continue;
                        const bound = Number(next[run[k]][field]);
                        v = up ? Math.max(v, bound) : Math.min(v, bound);
                        break;
                    }
                    if (v !== Number(next[run[at]][field])) { next[run[at]][field] = rewrap(next[run[at]][field], v); touched = true; }
                }

                for (let k = pivot + 1; k < run.length; k++) {
                    const prev = Number(next[run[k - 1]][field]);
                    const cur = Number(next[run[k]][field]);
                    const fixed = up ? Math.max(cur, prev) : Math.min(cur, prev);
                    if (fixed !== cur) { next[run[k]][field] = rewrap(next[run[k]][field], fixed); touched = true; }
                }
                for (let k = pivot - 1; k >= 0; k--) {
                    const ahead = Number(next[run[k + 1]][field]);
                    const cur = Number(next[run[k]][field]);
                    const fixed = up ? Math.min(cur, ahead) : Math.max(cur, ahead);
                    if (fixed !== cur) { next[run[k]][field] = rewrap(next[run[k]][field], fixed); touched = true; }
                }
            }

            return touched ? next : undefined;
        },
        { type: 'monotonic', options: { dir, along, series }, field }
    );
}
