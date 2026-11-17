// @ts-check
// stack.js — edits on a stacked bar or arc/pie/donut (scope 'stack'):
//   edit.stack.cut()    click a segment  → divide it in two at the pointer
//   edit.stack.edge()   drag a boundary  → move value across it
//   edit.stack.merge()  dblclick one     → fuse the two segments back into one
//
// They invert through the mark's `node.stack` stamp (plot/stack.js). Totals are
// preserved by arithmetic, not `maintainSum`. Magnitudes are re-derived from the
// live `ctx.data` each tick, since the node is a frame behind.

import { makeEdit, andWhen, schemaDefaults, nextCategory } from './shared.js';
import { stackLayout, stackFieldOf, stackOrder } from '../plot/stack.js';
import { pointerDegrees } from '../core/encoding.js';
import { warn } from '../core/dev.js';

/**
 * @typedef {Object} StackWindow the span of the stack a gesture may land in
 * @property {number} lo cumulative magnitude at the window's start
 * @property {number} hi cumulative magnitude at its end
 * @property {number} local local index of the slice the window starts on
 * @property {number} n how many slices the group has
 * @property {number} total the group's total magnitude
 */

/**
 * Pointer → cumulative magnitude, keyed by `geometry.kind`. Each result is
 * clamped into the window.
 * @type {Record<string, (geometry: any, ctx: import('../types').EditContext, win: StackWindow) => number | undefined>}
 */
const INVERTERS = {
    // Baseline 0, so the cumulative total is the value-axis value.
    linear: (geometry, ctx, win) => {
        const scale = ctx.scales && /** @type {any} */ (ctx.scales)[geometry.axis];
        if (!scale || !scale.invertible) return undefined;
        const px = geometry.axis === 'x' ? ctx.pointer.x : ctx.pointer.y;
        const v = Number(scale.invertValue(px));
        if (!Number.isFinite(v)) return undefined;
        return Math.max(win.lo, Math.min(win.hi, v));
    },

    // Angle from the window's leading edge in the sweep direction, mod 360.
    // Outside the window resolves to the nearer end.
    angular: (geometry, ctx, win) => {
        const { cx, cy, spanStart, spanEnd, pad } = geometry;
        // Signed, as plot/arc.js lays it out.
        const span = spanEnd - spanStart;
        const dir = Math.sign(span) || 1;
        const usable = span - dir * pad * win.n;
        if (!Number.isFinite(usable) || dir * usable <= 0 || !(win.total > 0)) return undefined;
        // Leading edge of the window: the start angle of slice `local`.
        const base = spanStart + dir * pad / 2 + dir * win.local * pad + usable * (win.lo / win.total);
        const theta = pointerDegrees(ctx.pointer, { cx, cy });
        const raw = (((theta - base) * dir % 360) + 360) % 360;   // [0, 360)
        const windowDeg = Math.abs(usable) * ((win.hi - win.lo) / win.total);
        if (windowDeg < 1e-9) return win.lo;
        if (raw <= windowDeg) return win.lo + (raw / Math.abs(usable)) * win.total;
        return (raw - windowDeg) < (360 - raw) ? win.hi : win.lo;
    },
};

/**
 * Where along the stack the pointer is, in the magnitude field's own units.
 * @param {any} geometry @param {import('../types').EditContext} ctx @param {StackWindow} win
 * @returns {number | undefined}
 */
function cumulativeAt(geometry, ctx, win) {
    const invert = geometry && INVERTERS[geometry.kind];
    return invert ? invert(geometry, ctx, win) : undefined;
}

/**
 * The live layout of the node's group, recomputed from ctx.data.
 * @param {any} node @param {import('../types').EditContext} ctx
 * @returns {{ st: any, members: number[], local: number, field: string, mags: number[], total: number, bounds: [number, number][] } | null}
 */
function groupOf(node, ctx) {
    const st = node && node.stack;
    if (!st || !Array.isArray(st.members) || st.local == null || !st.field) return null;
    if (!Array.isArray(ctx.data) || !ctx.data.length) return null;
    const { mags, total, bounds } = stackLayout(st.members, ctx.data, st.field);
    return { st, members: st.members, local: st.local, field: st.field, mags, total, bounds };
}

/**
 * The mark's `stack` field, with its category order and openness. A declared
 * domain is the order; an undeclared field orders by first appearance and is open.
 * @param {import('../types').EditContext} ctx
 * @returns {{ field: string, order: any[], open: boolean, declared: boolean } | null}
 */
function stackCategory(ctx) {
    const field = stackFieldOf(/** @type {any} */ (ctx.markChannels) || {});
    if (!field) return null;
    const spec = ctx.schema && /** @type {any} */ (ctx.schema)[field];
    if (spec && Array.isArray(spec.domain)) return { field, order: spec.domain, open: !!spec.open, declared: true };
    return { field, order: stackOrder(ctx.data, field, undefined), open: true, declared: false };
}

/**
 * The new segment's category, chosen so the segments don't reorder. It takes the
 * upper part when its category sorts between the cut segment and the next one, or
 * the lower part when it sorts between the previous one and the cut segment. An
 * open domain mints a new category just after the cut one. A closed domain with
 * no free category in either gap uses any free one, and the segment moves to its
 * place in the order.
 * @param {{ field: string, order: any[], open: boolean }} cat
 * @param {any[]} values the group's stack values, in stack order
 * @param {number} local the cut segment
 * @param {any} label
 * @returns {{ value: any, upper: boolean, order: any[] } | undefined}
 */
function newCategory(cat, values, local, label) {
    const { field, order } = cat;
    const used = new Set(values);
    const rank = (/** @type {any} */ v) => { const r = order.indexOf(v); return r < 0 ? order.length : r; };
    const cur = rank(values[local]);
    const next = local + 1 < values.length ? rank(values[local + 1]) : Infinity;
    const prev = local > 0 ? rank(values[local - 1]) : -1;
    const free = (/** @type {number} */ lo, /** @type {number} */ hi) =>
        order.find((v, i) => i > lo && i < hi && !used.has(v));

    const after = free(cur, next);
    if (after !== undefined) return { value: after, upper: true, order };
    const before = free(prev, cur);
    if (before !== undefined) return { value: before, upper: false, order };

    if (cat.open) {
        // Every listed category counts as taken, so this mints a fresh name.
        const taken = [...values, ...order].map((v) => ({ [field]: v }));
        const value = nextCategory(taken, field, order, { open: true, label });
        if (value === undefined) return undefined;
        const at = Math.min(cur + 1, order.length);
        return { value, upper: true, order: [...order.slice(0, at), value, ...order.slice(at)] };
    }
    const any = free(-1, Infinity);
    return any === undefined ? undefined : { value: any, upper: true, order };
}

/**
 * edit.stack.cut — click inside a segment to divide it there.
 *
 * The magnitude splits at the pointer, keeping the total. The new row's category
 * goes in the mark's `stack` field (`newCategory`); an open domain grows, so this
 * is a `target: 'domain'` edit that commits schema and rows together. With no
 * `stack` channel there is no field to name the new segment, so the cut warns and
 * does nothing.
 *
 * @param {any} [options] `defaults` seeds the new row, `label` names an open-domain
 *   placeholder
 * @returns {import('../types').Edit}
 */
export function cut(options = {}) {
    const { defaults = {}, label, when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'stack.cut',
        gesture: 'click',
        pick: 'direct',
        scope: 'stack',
        // Writes domain and rows; constraints still run over the rows.
        target: 'domain',
        ...rest,
        grabs: (/** @type {any} */ node) => !!(node.stack && !node.edge),
        // A segment body, not a boundary handle.
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) =>
            !!(ctx.node && ctx.node.stack && !ctx.node.edge), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const node = /** @type {any} */ (ctx.node);
            const g = groupOf(node, ctx);
            if (!g) return undefined;
            const { members, local, field, total, bounds } = g;

            const [lo, hi] = bounds[local];
            if (!(hi > lo)) return undefined;   // nothing to divide

            const at = cumulativeAt(g.st.geometry, ctx, { lo, hi, local, n: members.length, total });
            if (at === undefined) return undefined;

            const gi = members[local];
            const sibling = ctx.data[gi];

            const cat = stackCategory(ctx);
            if (!cat) {
                warn(
                    'stack:cut:field',
                    'edit.stack.cut() needs a `stack` channel on the mark: it names the new segment ' +
                    'in that field. Without it the new row would have no category, so the cut is refused.'
                );
                return undefined;
            }

            // The free category is per group, not per dataset.
            const values = members.map((mi) => ctx.data[mi] && ctx.data[mi][cat.field]);
            const minted = newCategory(cat, values, local, label);
            if (minted === undefined) {
                warn(
                    `stack:domainfull:${cat.field}`,
                    `edit.stack.cut() has no category left to give a new segment: this stack already ` +
                    `uses every value in schema.${cat.field}'s domain (${JSON.stringify(cat.order)}). ` +
                    `A declared domain is the whole vocabulary, so the cut is refused. Declare more ` +
                    `categories, or set schema.${cat.field}.open = true to let a cut add one.`
                );
                return undefined;
            }

            // Copy the position (and nested offset) so the new row stays in this group.
            /** @type {Record<string, any>} */
            const groupKeys = {};
            for (const c of ['x', 'y', 'xOffset', 'yOffset']) {
                const f = /** @type {any} */ (ctx.markChannels)[c] && /** @type {any} */ (ctx.markChannels)[c].field;
                if (f) groupKeys[f] = sibling[f];
            }

            // The new segment takes the part on its side of the cut.
            const [mine, theirs] = minted.upper ? [at - lo, hi - at] : [hi - at, at - lo];
            // Other fields start at schema defaults. Not mintDatum: no pointer to invert.
            const newRow = {
                ...schemaDefaults(ctx.schema),
                ...groupKeys,
                [cat.field]: minted.value,
                [field]: theirs,
                ...defaults,
            };

            let insertAt = minted.upper ? gi + 1 : gi;
            // Undeclared order is first appearance, so a fresh category must appear
            // before the next segment's category does.
            if (!cat.declared && minted.upper && !cat.order.includes(minted.value) && local + 1 < members.length) {
                const firstNext = ctx.data.findIndex((d) => d && d[cat.field] === values[local + 1]);
                if (firstNext >= 0) insertAt = Math.min(insertAt, firstNext);
            }

            const rows = ctx.data.slice();          // never mutates ctx.data
            rows[gi] = { ...sibling, [field]: mine };
            rows.splice(insertAt, 0, newRow);

            // A declared open domain grows to hold the new category, in its place.
            /** @type {Record<string, any[]>} */
            const domains = {};
            if (cat.declared && minted.order !== cat.order) domains[cat.field] = minted.order;
            return { domains, data: rows };
        },
    });
}

/**
 * edit.stack.edge — drag a boundary to move value between the two segments it
 * separates.
 *
 * One grows by what the other loses, so the total is kept. The pair's outer
 * edges stay fixed during the drag.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function edge(options = {}) {
    const { when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'stack.edge',
        // Not `inverts`: it inverts through `node.stack`, not a channel's scale.
        gesture: 'drag',
        pick: 'direct',
        scope: 'stack',
        ...rest,
        grabs: (/** @type {any} */ node) => !!(node.edge && node.stack),
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) =>
            !!(ctx.node && ctx.node.edge && ctx.node.stack), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const g = groupOf(/** @type {any} */ (ctx.node), ctx);
            if (!g) return undefined;
            const { members, local, field, mags, total, bounds } = g;
            const hiLocal = local + 1;
            if (hiLocal >= members.length) return undefined;

            const pairSum = mags[local] + mags[hiLocal];
            if (!(pairSum > 0)) return undefined;

            const lo = bounds[local][0];
            const hi = bounds[hiLocal][1];
            const at = cumulativeAt(g.st.geometry, ctx, { lo, hi, local, n: members.length, total });
            if (at === undefined) return undefined;

            const newLo = at - lo;
            const newHi = pairSum - newLo;
            const loGi = members[local];
            const hiGi = members[hiLocal];
            return ctx.data.map((/** @type {any} */ d, /** @type {number} */ i) => {
                if (i === loGi) return { ...d, [field]: newLo };
                if (i === hiGi) return { ...d, [field]: newHi };
                return d;
            });
        },
    });
}

/**
 * edit.stack.merge — dblclick a boundary to fuse its two segments. The lower row
 * keeps the pair's total and the upper row is dropped. The domain is unchanged.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function merge(options = {}) {
    const { when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'stack.merge',
        gesture: 'dblclick',
        pick: 'direct',
        scope: 'stack',
        cardinality: 'delete',
        ...rest,
        grabs: (/** @type {any} */ node) => !!(node.edge && node.stack),
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) =>
            !!(ctx.node && ctx.node.edge && ctx.node.stack), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const g = groupOf(/** @type {any} */ (ctx.node), ctx);
            if (!g) return undefined;
            const { members, local, field, mags } = g;
            const hiLocal = local + 1;
            if (hiLocal >= members.length) return undefined;

            const loGi = members[local];
            const hiGi = members[hiLocal];
            const sum = mags[local] + mags[hiLocal];
            return ctx.data
                .map((/** @type {any} */ d, /** @type {number} */ i) => (i === loGi ? { ...d, [field]: sum } : d))
                .filter((/** @type {any} */ _d, /** @type {number} */ i) => i !== hiGi);
        },
    });
}
