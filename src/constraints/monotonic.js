// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// monotonic: a field may only ever go one way along a series — a data invariant.
//
//   monotonic({ field: 'p', along: 'x' })              // non-decreasing in x
//   monotonic({ field: 'p', along: 'x', dir: 'down' }) // non-increasing
//
// The rule behind a cumulative curve: a CDF, a survival function, a budget burning
// down, a dose-response. Someone drawing one is not free to dip — a dip means
// negative probability mass — but the gesture has no idea, so a you-draw-it stroke
// happily authors one. Where `ordering` keeps FIELDS of one row in order, this
// keeps ROWS in order along an axis.
//
// It repairs by pushing the rows the moved point would have crossed: drag a point
// of a CDF up past its right-hand neighbours and they rise to meet it, which is
// what "I think it reaches this level by here" actually means. The alternative —
// rejecting — would make the curve feel jammed against its own history.
//
// `series` scopes it per line (a chart of several curves), matching the mark's
// series field. Rows are ordered by `along`, not by their position in the array,
// so an appended anchor lands in the right place.

/**
 * @param {{ field?: string, along?: string, dir?: 'up' | 'down',
 *   series?: string | null }} [options]
 *   field   the value that must not reverse (default 'y').
 *   along   the axis it runs along (default 'x').
 *   dir     'up' = non-decreasing (default), 'down' = non-increasing.
 *   series  group rows by this field first, so each line is judged on its own.
 * @returns {import('../types').Constraint}
 */
export function monotonic(options = {}) {
    const { field, along = 'x', dir = 'up', series = null } = constraintOptions('monotonic', options);
    const up = dir !== 'down';

    return defineConstraint(
        ({ data, activeIndex, field }) => {
            if (!data || data.length < 2 || field == null) return undefined;

            // Group into series, each judged on its own. One unkeyed group is the
            // single-line case, so there's one code path.
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
                // Order by the domain axis: a row's place in the array is authoring
                // history, not position on the chart.
                const run = indices
                    .filter((i) => Number.isFinite(Number(next[i][field])))
                    .sort((a, b) => numberOf(next[a][along]) - numberOf(next[b][along]));
                if (run.length < 2) continue;

                // Sweep out from the moved point so it keeps the value it was given
                // and its neighbours give way. When this edit touched no row of this
                // series (or none at all), sweep from the start: the invariant still
                // has to hold, it just has nothing to hold FIXED.
                const at = run.indexOf(/** @type {number} */(activeIndex));
                const pivot = at >= 0 ? at : 0;

                for (let k = pivot + 1; k < run.length; k++) {
                    const prev = Number(next[run[k - 1]][field]);
                    const cur = Number(next[run[k]][field]);
                    const fixed = up ? Math.max(cur, prev) : Math.min(cur, prev);
                    if (fixed !== cur) { next[run[k]][field] = fixed; touched = true; }
                }
                for (let k = pivot - 1; k >= 0; k--) {
                    const ahead = Number(next[run[k + 1]][field]);
                    const cur = Number(next[run[k]][field]);
                    const fixed = up ? Math.min(cur, ahead) : Math.max(cur, ahead);
                    if (fixed !== cur) { next[run[k]][field] = fixed; touched = true; }
                }
            }

            return touched ? next : undefined;
        },
        { type: 'monotonic', options: { dir, along, series }, field }
    );
}

/** A domain position as a number (a Date sorts by its timestamp). @param {any} v */
function numberOf(v) {
    return v instanceof Date ? v.getTime() : Number(v);
}
