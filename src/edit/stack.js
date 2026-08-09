// @ts-check
// stack.js — the STACK-scoped edits (scope 'stack'): the three things you can do to
// a whole that is divided among rows.
//
//   edit.stack.cut()    click a segment  → divide it in two at the pointer
//   edit.stack.edge()   drag a boundary  → move value across it
//   edit.stack.merge()  dblclick one     → fuse the two segments back into one
//
// All three work on a stacked `bar` AND on `arc`/`pie`/`donut`, because those two
// marks are the same structure: a group of rows partitioning one total along a 1-D
// parameter — data units up the value axis, degrees around a ring. Neither edit
// knows which mark it is on. The mark stamps `node.stack` (plot/stack.js) with the
// group's members and a GEOMETRY descriptor, and these invert through it — the same
// arrangement as a composite's `node.frame`, where the thing that encoded a layout
// carries the means to reverse it.
//
// ── The total is preserved by CONSTRUCTION ───────────────────────────────────
// Every apply here is a redistribution: a cut divides one segment's magnitude into
// two that sum to it, an edge drag moves value from one row to its neighbour, a
// merge adds two into one. No `maintainSum` constraint is involved, and none would
// help — its modes all sum over the WHOLE dataset, with no notion of the group a
// gesture landed in, so on a grid of donuts or a chart of several bands it would
// enforce the wrong invariant. Arithmetic that cannot break beats a rule that has
// to be checked.
//
// ── Staleness ────────────────────────────────────────────────────────────────
// A commit re-renders, so the node an in-flight gesture is holding describes the
// PREVIOUS frame. Everything here therefore re-derives magnitudes from the live
// `ctx.data` each tick and reads only the durable parts of the stamp (`members`,
// `local`, `geometry`), never a cached share. That is also why `geometry` is plain
// data rather than a closure over the layout.

import { makeEdit, andWhen, schemaDefaults, nextCategory } from './shared.js';
import { stackLayout } from '../plot/stack.js';
import { pointerDegrees } from '../core/encoding.js';
import { warn } from '../core/dev.js';

/**
 * @typedef {Object} StackWindow the span of the stack a gesture may land in
 * @property {number} lo cumulative magnitude at the window's start
 * @property {number} hi cumulative magnitude at its end
 * @property {number} local local index of the slice the window STARTS on
 * @property {number} n how many slices the group has
 * @property {number} total the group's total magnitude
 */

/**
 * Pointer → cumulative magnitude, one entry per stack GEOMETRY.
 *
 * A table rather than a switch inside each edit, and keyed by a capability the mark
 * declares rather than by a mark name — the same shape as the engine's
 * KIND_SATISFIES. A third kind of stack (a treemap row, a linear gauge) is a row
 * here and no change anywhere else.
 *
 * Each returns a value CLAMPED into the window, so "the pointer left the segment"
 * resolves to whichever end it is nearer instead of to a wild number.
 * @type {Record<string, (geometry: any, ctx: import('../types').EditContext, win: StackWindow) => number | undefined>}
 */
const INVERTERS = {
    // A stack's baseline is 0, so its cumulative total IS the value-axis value —
    // the inversion is just the axis scale run backwards, with no bespoke pixel
    // track to keep in step with the encoding.
    linear: (geometry, ctx, win) => {
        const scale = ctx.scales && /** @type {any} */ (ctx.scales)[geometry.axis];
        if (!scale || !scale.invertible) return undefined;
        const px = geometry.axis === 'x' ? ctx.pointer.x : ctx.pointer.y;
        const v = Number(scale.invertValue(px));
        if (!Number.isFinite(v)) return undefined;
        return Math.max(win.lo, Math.min(win.hi, v));
    },

    // Around a ring: measure the angle from the window's leading edge, in the
    // layout's own sweep direction, modulo a turn. The modulo is what keeps a drag
    // from tearing at the ±180° branch cut; the "outside the window" branch then
    // resolves to the nearer end, because a pointer 350° round is just behind the
    // start, not far past the end.
    angular: (geometry, ctx, win) => {
        const { cx, cy, spanStart, spanEnd, pad } = geometry;
        const usable = (spanEnd - spanStart) - pad * win.n;
        if (!Number.isFinite(usable) || usable === 0 || !(win.total > 0)) return undefined;
        const dir = Math.sign(usable) || 1;
        // Leading edge of the window: the start angle of slice `local`. Stable
        // through a drag, because every edit here holds the cumulative total BEFORE
        // the window fixed, so it re-derives identically each tick.
        const base = spanStart + pad / 2 + win.local * pad + usable * (win.lo / win.total);
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
 * The live layout of the group a node belongs to. Recomputed per tick from ctx.data
 * — never read off the node, which is a frame behind.
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
 * Which column carries the segment's identity, and what its domain permits.
 *
 * The identity is the mark's colour field — a stack is read by colour, so the thing
 * that tells two segments apart IS `fill` (or `stroke`). The domain and its
 * openness come from the SCHEMA, which owns both; the resolved scale is only a
 * fallback for a field the author left undeclared, and such a field is open by
 * nature because there is no declared vocabulary to exceed.
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

    // Undeclared: fall back to whatever scale the field ended up on, so a cut still
    // avoids colliding with a category already in play.
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
 * The segment's magnitude splits into the part below the pointer and the part
 * above, so the group's total is untouched: cutting adds a category without
 * changing what is being divided. The new row is SPLICED in beside the one it came
 * from rather than appended, because a stack's order is its data order — appending
 * would send the new segment to the top of the stack (or the end of the pie),
 * nowhere near the cut.
 *
 * Its category comes from the schema's domain (see nextCategory), so building a
 * chart needs no keyboard: a closed domain hands out its next unused value and
 * refuses when they run out; an open one mints a placeholder to be renamed later.
 * This is a `target: 'domain'` edit for that reason — an open cut writes the schema
 * and the dataset together, and the engine commits both or neither.
 *
 * @param {any} [options] `defaults` seeds the new row, `label` names an open-domain
 *   placeholder, `categoryField` overrides which column carries the identity
 * @returns {import('../types').Edit}
 */
export function cut(options = {}) {
    const { defaults = {}, label, categoryField, when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'cut',
        gesture: 'click',
        pick: 'direct',
        scope: 'stack',
        // Writes the schema's domain as well as the rows. The engine runs the
        // dataset's constraints over the coupled `data` before committing either, so
        // a `count({ max })` still caps how many segments a cut may create.
        target: 'domain',
        ...rest,
        // A segment BODY triggers a cut; a boundary handle does not (that is edge /
        // merge). An author `when` narrows this, it can't replace it.
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) =>
            !!(ctx.node && ctx.node.stack && !ctx.node.edge), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const node = /** @type {any} */ (ctx.node);
            const g = groupOf(node, ctx);
            if (!g) return undefined;
            const { members, local, field, mags, total, bounds } = g;

            const [lo, hi] = bounds[local];
            if (!(hi > lo)) return undefined;   // nothing to divide

            const at = cumulativeAt(g.st.geometry, ctx, { lo, hi, local, n: members.length, total });
            if (at === undefined) return undefined;

            const gi = members[local];
            const sibling = ctx.data[gi];

            // "Which category is free" is a question about THIS GROUP, not the whole
            // dataset: every band of a stacked bar holds its own copy of the same
            // vocabulary, so cutting in 2024 should offer the categories 2024 lacks —
            // never skip one because a different year already uses it. (An open
            // domain's placeholder is still globally unique: it is numbered off the
            // domain, which is shared.)
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

            // The grouping keys must carry over or the new row leaves the stack it was
            // cut from — it is the POSITION that says which group a row belongs to.
            /** @type {Record<string, any>} */
            const groupKeys = {};
            for (const c of ['x', 'y']) {
                const f = /** @type {any} */ (ctx.markChannels)[c] && /** @type {any} */ (ctx.markChannels)[c].field;
                if (f) groupKeys[f] = sibling[f];
            }

            // Everything else starts at the schema's default (else null) rather than
            // being copied: the new segment is a NEW category, not a duplicate of its
            // sibling. Deliberately not mintDatum — the magnitude comes from the cut
            // and the category from the domain, so there is no pointer to invert.
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

            // An OPEN domain grows to hold the new category; a closed one is written
            // back unchanged, so both regimes take one code path and the commit is
            // atomic either way. No category field → nothing to widen.
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
 * Only those two change: one grows by exactly what the other loses, so the pair sum
 * — and therefore the group's total — is preserved. The pair's OUTER edges stay put
 * for the whole drag, which is what makes the boundary track the pointer instead of
 * sliding out from under it.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function edge(options = {}) {
    const { when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'edge',
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
 * edit.stack.merge — dblclick a boundary to fuse the two segments it separates back
 * into one. The inverse of `cut`, and preserving the same total: the surviving row
 * takes the pair's whole magnitude, and the other is dropped.
 *
 * The LOWER segment survives, so the merged block keeps the identity that was
 * already beneath it and the stack's order is unchanged.
 *
 * Note it removes a row, not a category: the domain is left alone, so merging away
 * the last segment of a category and cutting a new one gets that category back.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function merge(options = {}) {
    const { when: userWhen, ...rest } = options;
    return makeEdit({
        type: 'merge',
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
