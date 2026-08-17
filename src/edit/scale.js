// @ts-check
// scale.js — the edits that reshape a SCALE'S DOMAIN, from whichever chart element
// draws that scale.
//
// A chart element (`views: 'scale'` — axis, grid, legend) draws a scale rather than
// columns, and a domain is a property of the scale. So a domain edit is the one kind
// that is NATIVE to an element: `edit.legend.category()` writes a row and only
// borrows the legend as a surface, but `edit.scale.categories()` writes the thing
// the element is already showing.
//
// It used to live under `edit.axis.*` and check `isAxis`, so the identical gesture
// was unavailable on a legend — you could rename a category on a categorical x-axis
// but not on the colour key beside it, though a legend swatch already carries the
// `node.category` the rename reads. `scope: 'scale'` is the capability both share.
// `edit.axis.scale()` stays axis-only: it drags a positional RANGE, which a legend
// has no equivalent of.
//
// Unlike every other edit these carry `target: 'domain'` and return
// { domains, data?, tables?, resize? } for the engine's domain-commit path. The
// domain is the data's own property, so reshaping it IS the edit — grids, guides
// and marks then reflow from it on the next render.

import { makeEdit, andWhen } from './shared.js';
import { axisOf } from '../core/encoding.js';

/**
 * The (table, field) pairs a domain edit writes.
 *
 * A field NAME is not unique across tables — a network chart can put `kind` on both
 * `nodes` and `links` with one `fill` scale over the pair — so renaming a category
 * by name alone writes one schema and leaves the other on the old value, splitting
 * one vocabulary in two. `scale.fieldRefs` (stamped by resolveScales) is the list
 * qualified by table; `scale.fields` is the same names flat, kept for readers that
 * only need names.
 *
 * An explicit `field` pins the column but not the table, so it still resolves
 * against the refs — a pinned name that appears in two tables is written in both,
 * which is the same "one vocabulary" rule.
 * @param {any} scale
 * @param {string | undefined} field
 * @param {string} fallbackTable the element's own table, for a scale with no refs
 * @returns {{ table: string, field: string }[]}
 */
function targetRefs(scale, field, fallbackTable) {
    const refs = (scale && scale.fieldRefs) || [];
    if (field) {
        const hits = refs.filter((/** @type {any} */ r) => r.field === field);
        return hits.length ? hits : [{ table: fallbackTable, field }];
    }
    if (refs.length) return refs;
    return ((scale && scale.fields) || []).map((/** @type {string} */ f) => ({ table: fallbackTable, field: f }));
}

/**
 * Split a flat list of (table, field) writes into the DomainEditResult shape: the
 * edit's OWN table flat, every other table under `tables`.
 * @param {{ table: string, field: string }[]} refs
 * @param {(ref: { table: string, field: string }) => any[]} domainFor
 * @param {(ref: { table: string, field: string }, rows: any[]) => any[] | null} rowsFor
 * @param {string} ownTable
 * @param {Record<string, any[]>} tables
 * @returns {import('../types').DomainEditResult}
 */
function splitByTable(refs, domainFor, rowsFor, ownTable, tables) {
    /** @type {any} */
    const out = { domains: {} };
    /** @type {Record<string, any>} */
    const others = {};
    // Group first, so a table with two fields on the scale gets ONE row pass that
    // sees both — rewriting rows once per field would drop all but the last.
    /** @type {Record<string, string[]>} */
    const byTable = {};
    for (const r of refs) (byTable[r.table] || (byTable[r.table] = [])).push(r.field);

    for (const [table, fields] of Object.entries(byTable)) {
        /** @type {Record<string, any[]>} */
        const domains = {};
        let rows = tables[table] || [];
        let touched = false;
        for (const field of fields) {
            domains[field] = domainFor({ table, field });
            const next = rowsFor({ table, field }, rows);
            if (next) { rows = next; touched = true; }
        }
        if (table === ownTable) {
            out.domains = domains;
            if (touched) out.data = rows;
        } else {
            others[table] = touched ? { domains, data: rows } : { domains };
        }
    }
    if (Object.keys(others).length) out.tables = others;
    return out;
}

/**
 * Grow-mode resize for a category count change: keep each band the same pixel size
 * and let the chart grow/shrink by whole steps instead. For a band/point scale the
 * padding terms are constant, so adding one category adds exactly one `step()` of
 * axis length. Returns undefined when the scale has no step (not discrete), when the
 * axis would collapse, or when the channel is NON-POSITIONAL — growing the chart to
 * fit one more colour swatch is meaningless, and reading `axisOf('fill')` as an
 * x-axis would resize the width for a legend edit.
 * @param {import('../types').EditContext} ctx @param {number} delta signed count change
 * @returns {{ width?: number, height?: number } | undefined}
 */
function stepResize(ctx, delta) {
    const ch = ctx.channels[0];
    const axis = ch && axisOf(ch.name);
    if (!axis) return undefined;
    const scale = /** @type {any} */ (ch && ch.scale);
    const step = scale && typeof scale.step === 'function' ? scale.step() : null;
    if (!step) return undefined;
    const m = ctx.margins || { top: 20, right: 20, bottom: 30, left: 40 };
    if (axis === 'y') {
        const inner = (ctx.height || 0) + delta * step;
        return inner > step ? { height: inner + m.top + m.bottom } : undefined;
    }
    const inner = (ctx.width || 0) + delta * step;
    return inner > step ? { width: inner + m.left + m.right } : undefined;
}

/**
 * edit.scale.categories — reshape a categorical/ordinal scale's domain (its ordered
 * category list) by direct gestures on the element's affordance nodes, reusing the
 * renderer's inline-typing lifecycle. Three edits, arbitrated by `when` on the node
 * the gesture landed on:
 *   add    (commit on the "+" node)      — append the typed name to the domain
 *   rename (commit on a label / swatch)  — relabel the category AND rewrite matching rows
 *   remove (click on a "×" node)         — drop the category AND delete matching rows
 * Add/rename come in as a `commit` gesture (double-click a node -> inline input ->
 * Enter), carrying the typed string in ctx.value. All three are direct-pick so the
 * plane isn't raised over the labels.
 *
 * Rename and remove write EVERY field on the scale, in every table it spans — the
 * domain and the rows together. A category is one vocabulary however many columns
 * share it, so renaming it in the schema and in only one column's rows would leave
 * the rest pointing at a value that no longer exists.
 *
 * `mode` mirrors edit.axis.scale(): 'rescale' (default) keeps the chart size, so the
 * bands re-divide it (thinner as you add); 'grow' keeps each band the same pixel
 * size and grows/shrinks the CHART by a step per category — the right feel for
 * extending a Likert scale from 5 points to 7. Positional scales only.
 * Options other than `field`/`mode` (`stage`, `guide`, `name`, `constrain`, `when`)
 * are forwarded to all three edits. Each keeps its own structural guard — which node
 * kind it fires on — and an author `when` narrows rather than replaces it (andWhen).
 * @param {any} [options]
 * @returns {import('../types').Edit[]}
 */
export function categories(options = {}) {
    const { field, mode = 'rescale', when: userWhen, ...rest } = options;
    const grow = mode === 'grow';

    /** @param {import('../types').EditContext} ctx @returns {{ table: string, field: string }[]} */
    const refsOf = (ctx) => targetRefs(
        ctx.channels[0] && ctx.channels[0].scale,
        field,
        /** @type {any} */ (ctx).table || 'data'
    );
    /** @param {import('../types').EditContext} ctx @returns {any[]} */
    const domainOf = (ctx) => {
        const ch = ctx.channels[0];
        return (ch && ch.scale && typeof ch.scale.domain === 'function') ? [...ch.scale.domain()] : [];
    };
    /** @param {import('../types').EditContext} ctx @returns {Record<string, any[]>} */
    const tablesOf = (ctx) => /** @type {any} */ (ctx).tables || { [/** @type {any} */ (ctx).table]: ctx.data };

    const add = makeEdit({
        type: 'scaleAddCategory',
        gesture: 'commit',
        pick: 'direct',
        scope: 'scale',
        target: 'domain',
        ...rest,
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) => !!(ctx.node && ctx.node.addCategory), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const name = ctx.value != null ? String(ctx.value).trim() : '';
            if (!name) return undefined;
            const domain = domainOf(ctx);
            if (domain.includes(name)) return undefined; // no duplicate categories
            const refs = refsOf(ctx);
            if (!refs.length) return undefined;
            // Adding a category creates no rows, so no table's data changes.
            const result = splitByTable(
                refs, () => [...domain, name], () => null,
                /** @type {any} */ (ctx).table, tablesOf(ctx)
            );
            if (grow) { const r = stepResize(ctx, +1); if (r) result.resize = r; }
            return result;
        }
    });

    const rename = makeEdit({
        type: 'scaleRenameCategory',
        gesture: 'commit',
        pick: 'direct',
        scope: 'scale',
        target: 'domain',
        ...rest,
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) => !!(ctx.node && ctx.node.category != null), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const from = ctx.node && ctx.node.category;
            const to = ctx.value != null ? String(ctx.value).trim() : '';
            if (from == null || !to || to === from) return undefined;
            const domain = domainOf(ctx);
            if (domain.includes(to)) return undefined; // would collide with a sibling
            const refs = refsOf(ctx);
            if (!refs.length) return undefined;
            const renamed = domain.map((c) => (c === from ? to : c));
            return splitByTable(
                refs,
                () => renamed,
                // Relabel every row on the renamed category so data + schema stay in
                // step — for THIS field, over rows a previous field may already have
                // rewritten (splitByTable threads them).
                ({ field: f }, rows) => rows.map((/** @type {any} */ d) => (d[f] === from ? { ...d, [f]: to } : d)),
                /** @type {any} */ (ctx).table, tablesOf(ctx)
            );
        }
    });

    const remove = makeEdit({
        type: 'scaleRemoveCategory',
        gesture: 'click',
        pick: 'direct',
        scope: 'scale',
        target: 'domain',
        ...rest,
        when: andWhen((/** @type {import('../types').EditContext} */ ctx) => !!(ctx.node && ctx.node.removeCategory != null), userWhen),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const cat = ctx.node && ctx.node.removeCategory;
            if (cat == null) return undefined;
            const domain = domainOf(ctx);
            if (!domain.includes(cat)) return undefined;
            const refs = refsOf(ctx);
            if (!refs.length) return undefined;
            const kept = domain.filter((/** @type {any} */ c) => c !== cat);
            const result = splitByTable(
                refs,
                () => kept,
                // Removing a category also deletes its rows (the user's choice), so no
                // datum is left orphaned at an undefined band position.
                ({ field: f }, rows) => rows.filter((/** @type {any} */ d) => d[f] !== cat),
                /** @type {any} */ (ctx).table, tablesOf(ctx)
            );
            if (grow) { const r = stepResize(ctx, -1); if (r) result.resize = r; }
            return result;
        }
    });

    return [add, rename, remove];
}
