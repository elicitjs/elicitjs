// @ts-check
// stack.js — the shared layout for marks that divide a group of rows into a
// whole: a stacked bar's segments, a pie's slices.
//   groupByPosition   which rows form one group
//   stackLayout       shares and cumulative bounds, in data units
//   stackDescriptor   what to stamp on a node so an edit can invert it
// No pixels here: each mark encodes the bounds through its own scale.

import { categoryOf } from './mark.js';

/**
 * Which rows form one group. The positional channels in `keys` that carry a field
 * partition the dataset; with none bound, every row is one group. Keys resolve
 * through `categoryOf`, so `{ fn }` and `{ datum }` channels group the way they
 * draw. Each group keeps its rows' global indices in first-seen order.
 *
 * @param {any[]} data the chart's dataset
 * @param {Record<string, any>} channels the mark's channel map
 * @param {string[]} keys positional channels that may group (e.g. ['x'] or ['x','y'])
 * @param {Record<string, string | undefined>} [fallbackKeys] each channel's xKey/yKey fallback
 * @returns {{ key: string, rep: any, members: number[] }[]} groups, in first-seen order
 */
export function groupByPosition(data, channels, keys, fallbackKeys = {}) {
    // Only a field-bound channel groups; a constant is the same for every row.
    const grouping = keys.filter((c) => channels && channels[c] && channels[c].field != null);

    /** @type {Map<string, { key: string, rep: any, members: number[] }>} */
    const groups = new Map();
    data.forEach((d, i) => {
        // NUL joins a multi-channel key. Write it as the escape, never a raw byte:
        // a raw NUL makes git treat the file as binary.
        const k = grouping.length
            ? grouping.map((c) => String(categoryOf(channels, c, d, fallbackKeys[c], i, data))).join('\u0000')
            : '__all__';
        let g = groups.get(k);
        if (!g) { g = { key: k, rep: d, members: [] }; groups.set(k, g); }
        g.members.push(i);
    });
    return [...groups.values()];
}

/**
 * One group's shares and cumulative bounds, in the magnitude field's data units.
 * `bounds[local]` is `[lo, hi]`: the running total before and after this row.
 * Non-finite and negative magnitudes count as 0.
 *
 * @param {number[]} members global row indices, in stack order
 * @param {any[]} data the chart's dataset
 * @param {string | undefined} field the magnitude column
 * @returns {{ mags: number[], total: number, bounds: [number, number][] }}
 */
export function stackLayout(members, data, field) {
    const mags = members.map((gi) => {
        const row = data[gi];
        const v = field != null && row ? Number(row[field]) : NaN;
        return Number.isFinite(v) && v > 0 ? v : 0;
    });
    /** @type {[number, number][]} */
    const bounds = [];
    let cursor = 0;
    for (const m of mags) {
        bounds.push([cursor, cursor + m]);
        cursor += m;
    }
    return { mags, total: cursor, bounds };
}

/**
 * What a mark stamps on a segment node or boundary handle so `edit.stack.*` can
 * invert the layout. Pure data, no closures or scales: edits re-derive magnitudes
 * from the live dataset each tick and read only `members`/`geometry` from it.
 *
 * `geometry` says how a pointer becomes a position along the stack:
 *   { kind: 'linear',  axis }                            value axis, through its scale
 *   { kind: 'angular', cx, cy, spanStart, spanEnd, pad } around a ring
 *
 * @param {{ members: number[], local?: number, field: string | undefined, geometry: any }} spec
 * @returns {{ members: number[], local: number | undefined, field: string | undefined, geometry: any }}
 */
export function stackDescriptor({ members, local, field, geometry }) {
    return { members, local, field, geometry };
}
