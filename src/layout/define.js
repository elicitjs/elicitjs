// @ts-check
// define.js: layout descriptor normalizer, option checking, and `defineLayout`
// (`layout.custom`).
//
// A layout is a chart-level spatial settling process over one table's rows:
//   { type, options, table?, structure?, apply? }
// A scoped layout (`layout.network.*`, `layout.hierarchy.*`) names the structure it
// needs in `structure` and its type is its dotted path (`network.layered`).
// Built-in layouts (`hierarchy.contain`, `dodge`, `row`, `column`, `grid`, `pack`,
// `tidy`, `network.*`) are run
// by `core/fit.js` against the marks' `nodeBox` geometry and inverted back into
// data through the channels' scales. `custom` runs an author-supplied function
// against the same layout context.

import { warn, warningsEnabled } from '../core/dev.js';
import { LAYOUT_UNIVERSAL_OPTIONS, LAYOUT_OPTIONS } from '../vocabulary.js';

/**
 * Mistaken layout option keys, with the correction to show.
 * @type {Record<string, string>}
 */
const MISTAKEN_LAYOUT_OPTIONS = {
    arrange: 'arrangements are their own layout factories: layout.row(), layout.column(), layout.grid(), layout.pack() or layout.dodge().',
    columns: '`columns` only applies to layout.grid({ columns }).',
    keep: '`keep` only applies to layout.pack({ keep: "distance" | "angle" }).',
    axis: 'use `fit: true | "x" | "y"` on layout.hierarchy.contain({ fit }) to pick which axes fit.',
    padding: '`padding` belongs on layout.hierarchy.contain({ padding }).',
    fit: '`fit` belongs on layout.hierarchy.contain({ fit }).',
    mode: 'a network layout takes `place: "new" | "all"`: position only rows that have none, or every row.',
};

/**
 * Warn on options a layout factory does not read, and return them unchanged.
 * @template T
 * @param {string} type the factory name
 * @param {T} options
 * @returns {T}
 */
export function layoutOptions(type, options) {
    if (!options || !warningsEnabled()) return options;
    const allow = [...LAYOUT_UNIVERSAL_OPTIONS, ...(LAYOUT_OPTIONS[type] || [])];
    for (const key of Object.keys(options)) {
        if (allow.includes(key)) continue;
        const fix = MISTAKEN_LAYOUT_OPTIONS[key];
        warn(
            `layoutopt:${type}:${key}`,
            fix
                ? `layout.${type}({ ${key}: … }): ${fix}`
                : `layout.${type}({ ${key}: … }) is not an option this layout reads, so it is ignored. ` +
                  `layout.${type} options are: ${allow.slice().sort().join(', ')}.`,
        );
    }
    return options;
}

/**
 * Normalize a layout spec into its descriptor.
 * @param {{ type: string, options?: Record<string, any>, table?: string, structure?: 'network' | 'hierarchy', apply?: (ctx: import('../types').LayoutContext) => any }} spec
 * @returns {import('../types').LayoutSpec}
 */
export function makeLayout(spec) {
    return {
        type: spec.type,
        options: spec.options || {},
        ...(spec.table != null ? { table: spec.table } : {}),
        ...(spec.structure ? { structure: spec.structure } : {}),
        ...(typeof spec.apply === 'function' ? { apply: spec.apply } : {}),
    };
}

/**
 * Author a spatial layout process (`layout.custom`). Runs after the built-in
 * passes against `{ rows, tables, tree, nodeBox, extentOf, scales, width, height,
 * locked, anchors, yields, preview, shift, shiftTree, write }`. With `where`, it
 * changes only the rows `where` picks.
 * @param {(ctx: import('../types').LayoutContext) => any} fn
 * @param {{ table?: string, where?: (d: any, i: number, rows: any[]) => boolean }} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function defineLayout(fn, options = {}) {
    const { table, where } = layoutOptions('custom', options);
    if (where !== undefined && typeof where !== 'function') {
        warn('layout:custom:where', 'layout.custom(fn, { where }) takes a function (d, i, rows) => boolean. It may change every row.');
    }
    return makeLayout({
        type: 'custom',
        table,
        options: typeof where === 'function' ? { where } : {},
        apply: fn,
    });
}
