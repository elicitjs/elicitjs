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
import { stackLayout } from '../plot/stack.js';
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
 * The segment's category field (`fill`, else `stroke`) with its domain and
 * openness from the schema. An undeclared field uses the scale's domain and is open.
 * @param {import('../types').EditContext} ctx @param {string | undefined} override
 * @returns {{ field: string | null, domain: any[], open: boolean }}
 */
function categoryOfStack(ctx, override) {
    const mc = /** @type {any} */ (ctx.markChannels) || {};
    const field = override
        || (mc.fill && mc.fill.field)
        || (mc.stroke && mc.stroke.field)
        || null;
    if (!field) return { field: null, domain: [], open: true };

    const spec = ctx.schema && /** @type {any} */ (ctx.schema)[field];
    const declared = spec && Array.isArray(spec.domain) ? spec.domain : null;
    if (declared) return { field, domain: declared, open: !!spec.open };

    // Undeclared: use the scale's domain, so a cut avoids categories in play.
    for (const name of ['fill', 'stroke']) {
        const ch = mc[name];
        if (!ch || ch.field !== field) continue;
        const scale = /** @type {any} */ (ctx.scales)[name];
        const dom = scale && Array.isArray(scale.domainConfig) ? scale.domainConfig : null;
        if (dom) return { field, domain: dom, open: true };
    }
    return { field, domain: [], open: true };
}

/**
 * edit.stack.cut — click inside a segment to divide it there.
 *
 * The magnitude splits at the pointer, keeping the total. The new row is spliced in
 * after the original, since stack order is data order. Its category is the group's
 * next unused one (`nextCategory`); an open domain grows, so this is a
 * `target: 'domain'` edit that commits schema and rows together.
 *
 * @param {any} [options] `defaults` seeds the new row, `label` names an open-domain
 *   placeholder, `categoryField` overrides which column carries the identity
 * @returns {import('../types').Edit}
 */
export function cut(options = {}) {
    const { defaults = {}, label, categoryField, when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'stack.cut',
        gesture: 'click',
        pick: 'direct',
        scope: 'stack',
        // Writes domain and rows; constraints still run over the rows.
        target: 'domain',
        ...rest,
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

            // The free category is per group, not per dataset.
            const cat = categoryOfStack(ctx, categoryField);
            const groupRows = members.map((mi) => ctx.data[mi]);
            const minted = nextCategory(groupRows, cat.field, cat.domain, { open: cat.open, label });
            if (cat.field && minted === undefined) {
                warn(
                    `stack:domainfull:${cat.field}`,
                    `edit.stack.cut() has no category left to give a new segment: this stack already ` +
                    `uses every value in schema.${cat.field}'s domain (${JSON.stringify(cat.domain)}). ` +
                    `A declared domain is the whole vocabulary, so the cut is refused. Declare more ` +
                    `categories, or set schema.${cat.field}.open = true to let a cut add one.`
                );
                return undefined;
            }

            // Copy the positional keys so the new row stays in this group.
            /** @type {Record<string, any>} */
            const groupKeys = {};
            for (const c of ['x', 'y']) {
                const f = /** @type {any} */ (ctx.markChannels)[c] && /** @type {any} */ (ctx.markChannels)[c].field;
                if (f) groupKeys[f] = sibling[f];
            }

            // Other fields start at schema defaults. Not mintDatum: no pointer to invert.
            const newRow = {
                ...schemaDefaults(ctx.schema),
                ...groupKeys,
                ...(cat.field ? { [cat.field]: minted } : {}),
                [field]: hi - at,
                ...defaults,
            };

            const rows = ctx.data.slice();          // never mutates ctx.data
            rows[gi] = { ...sibling, [field]: at - lo };
            rows.splice(gi + 1, 0, newRow);

            // An open domain grows to hold the new category.
            /** @type {Record<string, any[]>} */
            const domains = {};
            if (cat.field && cat.open && !cat.domain.includes(minted)) {
                domains[cat.field] = [...cat.domain, minted];
            }
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
