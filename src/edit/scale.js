// @ts-check
// scale.js — edits that reshape the domain of the scale an axis or legend draws
// (scope 'scale'). They carry `target: 'domain'` and return
// { domains, data?, tables?, resize? } for the engine's domain commit.

import { makeEdit, andWhen } from './shared.js';
import { axisOf } from '../core/encoding.js';
import { DEFAULT_MARGINS } from '../core/scene.js';

/**
 * The (table, field) pairs a domain edit writes, from `scale.fieldRefs`. A pinned
 * `field` still matches every table that has it.
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
    // Group by table so each table's rows are threaded through every field.
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
 * Grow-mode resize: change the chart size by `delta` steps so bands keep their
 * pixel size. Undefined for a non-positional channel, a scale with no step, or an
 * axis that would collapse.
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
    const m = ctx.margins || DEFAULT_MARGINS;
    if (axis === 'y') {
        const inner = (ctx.height || 0) + delta * step;
        return inner > step ? { height: inner + m.top + m.bottom } : undefined;
    }
    const inner = (ctx.width || 0) + delta * step;
    return inner > step ? { width: inner + m.left + m.right } : undefined;
}

/**
 * edit.scale.categories — edit a categorical scale's domain through the element's
 * affordance nodes. Returns three direct-pick edits, each guarded by node kind:
 *   add    (commit on the "+" node)      — append the typed name to the domain
 *   rename (commit on a label / swatch)  — relabel the category and matching rows
 *   remove (click on a "×" node)         — drop the category and delete matching rows
 * Rename and remove write every field on the scale, in every table it spans.
 *
 * `mode`: 'rescale' (default) keeps the chart size; 'grow' keeps band size and
 * resizes the chart by a step per category (positional scales only).
 * Other options are forwarded to all three edits; `when` narrows each guard.
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
        type: 'scale.addCategory',
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
        type: 'scale.renameCategory',
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
                // Relabel matching rows for this field.
                ({ field: f }, rows) => rows.map((/** @type {any} */ d) => (d[f] === from ? { ...d, [f]: to } : d)),
                /** @type {any} */ (ctx).table, tablesOf(ctx)
            );
        }
    });

    const remove = makeEdit({
        type: 'scale.removeCategory',
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
                // Delete rows in the removed category.
                ({ field: f }, rows) => rows.filter((/** @type {any} */ d) => d[f] !== cat),
                /** @type {any} */ (ctx).table, tablesOf(ctx)
            );
            if (grow) { const r = stepResize(ctx, -1); if (r) result.resize = r; }
            return result;
        }
    });

    return [add, rename, remove];
}
