// @ts-check
// stack.js — the shared layout behind every mark that partitions a GROUP of rows
// into a whole: a stacked bar's segments, a pie's slices.
//
// Those two look nothing alike and are the same structure. A group of rows divides
// one total along a 1-D parameter — data units up the value axis for a bar,
// degrees around the span for an arc — and each row owns one interval of it. Which
// rows form a group, what each one's share is, and where the boundaries between
// them fall are the same three questions in both cases, so they are answered once
// here rather than in each mark.
//
// Three exports, in the order a mark uses them:
//   groupByPosition   which rows form one group        (the ENCODING is the grouping)
//   stackLayout       shares + cumulative bounds       (in DATA units, not pixels)
//   stackDescriptor   what to stamp on a node          (so an edit can invert it)
//
// What is deliberately NOT here: pixels. This module never touches a scale or a
// coordinate. A bar turns a cumulative bound into a pixel with `encodeValue`, an
// arc with its own angular cursor — each through the path its own geometry already
// uses. Centralizing the *layout* while leaving the *encoding* to the mark is what
// keeps "one positional-resolution path" true.

import { categoryOf } from './mark.js';

/**
 * Which rows form one group.
 *
 * The grouping is the ENCODING: whichever of the named positional channels carry a
 * field partitions the dataset, so a `bar` stacks the rows that share a band and an
 * `arc` puts one donut in each x/y slot. Bind none of them and every row lands in a
 * single group — the classic one-stack / one-pie case, which is the same code path
 * rather than a special case. There is no `groupBy` option anywhere in this library
 * and this is why: declaring the position already says it.
 *
 * Keys resolve through `categoryOf`, so a `{ fn }` or `{ datum }` channel groups the
 * way it draws. Reading `datum[key]` raw here instead — which is what bar's old
 * private `stackOffsets` did — silently ignored both forms on the very axis that
 * decides the grouping.
 *
 * Each group keeps its rows' GLOBAL indices (their addresses in the engine's one
 * dataset) in first-seen order, so a node, a handle and an edit all still address
 * that one dataset.
 *
 * @param {any[]} data the chart's dataset
 * @param {Record<string, any>} channels the mark's channel map
 * @param {string[]} keys positional channels that may group (e.g. ['x'] or ['x','y'])
 * @param {Record<string, string | undefined>} [fallbackKeys] each channel's xKey/yKey fallback
 * @returns {{ key: string, rep: any, members: number[] }[]} groups, in first-seen order
 */
export function groupByPosition(data, channels, keys, fallbackKeys = {}) {
    // Only a channel bound to a FIELD groups: a constant or an absent one is the
    // same for every row and would make one group of everything, which is already
    // the no-field answer.
    const grouping = keys.filter((c) => channels && channels[c] && channels[c].field != null);

    /** @type {Map<string, { key: string, rep: any, members: number[] }>} */
    const groups = new Map();
    data.forEach((d, i) => {
        // NUL joins a multi-channel key because it cannot occur in a field value, so
        // two different pairs can never collide. Write it as the ESCAPE, never as a
        // literal NUL byte: a raw one makes git classify the whole file as binary,
        // which silently costs you diffs, line-level review and merges.
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
 * One group's shares and cumulative bounds, in the magnitude field's own DATA units.
 *
 * `bounds[local]` is `[lo, hi]`: the running total before this row, and after it. A
 * bar reads those as the segment's two ends on the value axis; an arc scales them
 * into its angular span. Both then encode them through their own scale — the numbers
 * here are data, never pixels.
 *
 * Non-finite and negative magnitudes count as 0. A stack is a part-to-whole
 * statement, and a negative part has no interval to occupy — silently flipping one
 * would put a segment behind its own baseline and make the boundaries between it and
 * its neighbours cross.
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
 * What a mark stamps on a segment node or a boundary handle so an edit can invert
 * the layout that produced it.
 *
 * This is the `node.frame` idea from `composite`, applied to a stack: the mark that
 * ENCODED the layout carries the means to invert it, so `edit.stack.*` needs no
 * second layout implementation and no knowledge of which mark it is on. Everything
 * here is pure DATA — no closures, no scales. A commit re-renders and the node an
 * in-flight gesture is holding goes stale, so every edit re-derives magnitudes from
 * the live dataset each tick and reads only `members`/`geometry` from the stamp.
 *
 * `geometry` says how a pointer becomes a position along the stack, and it names a
 * CAPABILITY rather than a mark:
 *   { kind: 'linear',  axis }                          value axis, through its scale
 *   { kind: 'angular', cx, cy, spanStart, spanEnd, pad } around a ring
 * `edit/stack.js` holds one small table keyed by `kind`; a third geometry is a row
 * in it, not a branch in a mark.
 *
 * @param {{ members: number[], local?: number, field: string | undefined, geometry: any }} spec
 * @returns {{ members: number[], local: number | undefined, field: string | undefined, geometry: any }}
 */
export function stackDescriptor({ members, local, field, geometry }) {
    return { members, local, field, geometry };
}
