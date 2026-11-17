// @ts-check
// stack.js — the shared layout for marks that divide a group of rows into a
// whole: a stacked bar's segments, a pie's slices.
//   groupByPosition   which rows form one group
//   stackFieldOf      the field that names each part (the `stack` channel)
//   stackOrder        that field's category order
//   orderMembers      a group's rows in stack order
//   stackLayout       shares and cumulative bounds, in data units
//   stackDescriptor   what to stamp on a node so an edit can invert it
// No pixels here: each mark encodes the bounds through its own scale.

import { categoryOf } from './mark.js';
import { fieldsOf } from '../core/schema.js';
import { warn } from '../core/dev.js';

/**
 * The field that names each part of a whole: the `stack` channel's field, or null.
 * `stack` is a raw channel, so marks list it in `Mark.rawChannels`.
 * @param {Record<string, any>} [channels]
 * @returns {string | null}
 */
export function stackFieldOf(channels = {}) {
    return (channels.stack && channels.stack.field) || null;
}

/**
 * The stack field's schema entry, from the build context (the mark's own table),
 * else the primary table's fields on the scale map.
 * @param {string | null} field
 * @param {any} scales
 * @param {any} [ctx] build()'s fifth argument
 * @returns {import('../types').FieldSchema | undefined}
 */
export function stackFieldSchema(field, scales, ctx) {
    if (!field) return undefined;
    const fields = ctx && ctx.schema ? fieldsOf(ctx.schema, ctx.table) : scales && scales.schema;
    return fields ? fields[field] : undefined;
}

/**
 * Warn when the `stack` channel can't name the parts: no field, or a field
 * that isn't categorical or ordinal.
 * @param {string} mark the mark's name, for the message
 * @param {Record<string, any>} channels
 * @param {import('../types').FieldSchema | undefined} fieldSchema
 */
export function checkStackChannel(mark, channels, fieldSchema) {
    if (!channels.stack) return;
    const field = stackFieldOf(channels);
    if (!field) {
        warn(`${mark}:stack:field`,
            `${mark}(): the \`stack\` channel needs a field, e.g. stack: { field: 'party' }. ` +
            `It names each part of the stack, so a constant or a function has nothing to name.`);
        return;
    }
    const type = fieldSchema && fieldSchema.type;
    if (type && type !== 'categorical' && type !== 'ordinal') {
        warn(`${mark}:stack:type:${field}`,
            `${mark}(): the \`stack\` field "${field}" is ${type}. A stack's parts are categories, ` +
            `so declare schema.${field} as categorical or ordinal.`);
    }
}

/**
 * The stack field's category order: its schema domain when declared, else its
 * values in first-seen order across the data.
 * @param {any[]} data
 * @param {string} field
 * @param {import('../types').FieldSchema | undefined} fieldSchema
 * @returns {any[]}
 */
export function stackOrder(data, field, fieldSchema) {
    if (fieldSchema && Array.isArray(fieldSchema.domain)) return fieldSchema.domain;
    const seen = new Set();
    for (const d of data) if (d) seen.add(d[field]);
    return [...seen];
}

/**
 * A group's members sorted by their stack value's place in `order`, so a part sits
 * at the same place in every group. Ties keep data order; a value outside `order`
 * sorts last. With no field, data order.
 * @param {number[]} members global row indices, in data order
 * @param {any[]} data
 * @param {string | null} field
 * @param {any[]} order
 * @returns {number[]}
 */
export function orderMembers(members, data, field, order) {
    if (!field) return members;
    const rank = new Map(order.map((v, i) => [v, i]));
    const at = (/** @type {number} */ gi) => {
        const r = rank.get(data[gi] && data[gi][field]);
        return r === undefined ? order.length : r;
    };
    return [...members].sort((a, b) => at(a) - at(b));
}

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
