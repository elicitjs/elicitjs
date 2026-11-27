// @ts-check
// layout/ — chart-level spatial settling processes (`spec.layout`).
// Each reads the marks' rendered boxes (`nodeBox`, glyph extents) and writes
// settled positions/sizes back into the dataset through the channels' scales.
// The root layouts work on any table. A layout that needs a structure is scoped:
// `layout.network.*` places a network's nodes, `layout.hierarchy.*` a hierarchy's.

import { makeLayout, layoutOptions, defineLayout } from './define.js';
import { KEEPS } from '../core/arrange.js';
import { DIRECTIONS, PLACES } from '../core/graph/index.js';
import { warn } from '../core/dev.js';

export { defineLayout as custom };

const VALID_IN = ['all', 'roots', 'containers'];
const VALID_FIT = [true, false, 'x', 'y'];

/**
 * Validate `in` scope option.
 * @param {string} type
 * @param {any} scope
 * @param {string[]} allowed
 */
function checkIn(type, scope, allowed) {
    if (scope === undefined || typeof scope === 'function') return scope;
    if (typeof scope === 'string' && allowed.includes(scope)) return scope;
    warn(
        `layout:${type}:in`,
        `layout.${type}({ in: ${JSON.stringify(scope)} }) is not a valid scope. ` +
        `Use ${allowed.map((s) => `"${s}"`).join(', ')}, or a predicate function (d, i, rows) => boolean.`
    );
    return undefined;
}

/**
 * Container enclosure geometry: inner `padding`, optional auto-sizing (`fit`),
 * walls for fixed containers, and subtree carry/placement.
 * @param {import('../types').ContainLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
function contain(options = {}) {
    const { where, padding, fit = false } = scopedOptions('hierarchy.contain', options);
    let resolvedFit = fit;
    if (!VALID_FIT.includes(/** @type {any} */ (fit))) {
        warn(
            'layout:hierarchy.contain:fit',
            `layout.hierarchy.contain({ fit: ${JSON.stringify(fit)} }): use true, false, "x" or "y". Ignoring.`
        );
        resolvedFit = false;
    }
    return makeLayout({
        type: 'hierarchy.contain',
        structure: 'hierarchy',
        options: { where, padding, fit: resolvedFit },
    });
}

/** Layouts that need a hierarchy: they work on its nodes. */
export const hierarchy = { contain };

/**
 * A scoped layout's options. It always works on its structure's nodes, so a
 * `table` is ignored.
 * @template {Record<string, any>} T
 * @param {string} type
 * @param {T} options
 * @returns {T}
 */
function scopedOptions(type, options) {
    const checked = layoutOptions(type, options);
    if (checked && /** @type {any} */ (checked).table != null) {
        warn(
            `layout:${type}:table`,
            `layout.${type}({ table }): this layout works on the ${type.split('.')[0]}'s nodes table, so \`table\` is ignored.`
        );
    }
    return checked;
}

/**
 * A finite, non-negative number, else the default.
 * @param {any} v @param {number} fallback
 */
const size = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback);

/**
 * One of `allowed`, else the first, with a warning.
 * @param {string} type @param {string} key @param {any} value @param {string[]} allowed
 * @returns {string}
 */
function oneOf(type, key, value, allowed) {
    if (value === undefined) return allowed[0];
    if (allowed.includes(value)) return value;
    warn(
        `layout:${type}:${key}`,
        `layout.${type}({ ${key}: ${JSON.stringify(value)} }): use ${allowed.map((v) => `"${v}"`).join(', ')}. Using "${allowed[0]}".`
    );
    return allowed[0];
}

/**
 * A row predicate (`where`), or undefined with a warning when it is not a function.
 * @param {string} type @param {any} where
 * @returns {((d: any, i: number, rows: any[]) => boolean) | undefined}
 */
function rowTest(type, where) {
    if (where === undefined || typeof where === 'function') return where;
    warn(
        `layout:${type}:where`,
        `layout.${type}({ where }) takes a function (d, i, rows) => boolean. Every node takes part.`
    );
    return undefined;
}

/**
 * A layered drawing for flowcharts and causal maps: every link runs one way down
 * the ranks, nodes in a rank are ordered to cut crossings.
 * @param {import('../types').LayeredLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
function layered(options = {}) {
    const type = 'network.layered';
    const { direction, gap, rankGap, place, where } = scopedOptions(type, options);
    return makeLayout({
        type,
        structure: 'network',
        options: {
            direction: oneOf(type, 'direction', direction, DIRECTIONS),
            gap: size(gap, 24),
            rankGap: size(rankGap, 48),
            place: oneOf(type, 'place', place, PLACES),
            where: rowTest(type, where),
        },
    });
}

/**
 * A tidy tree for trees and mind maps: each parent centred on its children, one
 * line (or ring) per depth.
 * @param {import('../types').TreeLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
function tree(options = {}) {
    const type = 'network.tree';
    const { direction, gap, rankGap, place, where } = scopedOptions(type, options);
    return makeLayout({
        type,
        structure: 'network',
        options: {
            direction: oneOf(type, 'direction', direction, [...DIRECTIONS, 'radial']),
            gap: size(gap, 12),
            rankGap: size(rankGap, 40),
            place: oneOf(type, 'place', place, PLACES),
            where: rowTest(type, where),
        },
    });
}

/**
 * A spread for concept maps and general networks: linked nodes about `length` px
 * apart, the rest by how many links lie between them (stress majorization).
 * @param {import('../types').ForceLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
function force(options = {}) {
    const type = 'network.force';
    const { length, gap, place, where } = scopedOptions(type, options);
    return makeLayout({
        type,
        structure: 'network',
        options: {
            length: size(length, 100) || 100,
            gap: size(gap, 8),
            place: oneOf(type, 'place', place, PLACES),
            where: rowTest(type, where),
        },
    });
}

/** Layouts that need a network: they place its nodes by its links. */
export const network = { layered, tree, force };

/**
 * Line a hand layout up: centres within `snap` px share a row or column, nearly
 * even gaps become even, and an overlapping node takes a free cell.
 * @param {import('../types').TidyLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function tidy(options = {}) {
    const { snap, gap, where, in: scope, table } = layoutOptions('tidy', options);
    const validIn = checkIn('tidy', scope, VALID_IN);
    return makeLayout({
        type: 'tidy',
        table,
        options: { snap: size(snap, 16), gap: size(gap, 8), where: rowTest('tidy', where), in: validIn },
    });
}

/**
 * Push overlapping rows apart so their boxes keep at least `gap` px clear.
 * Works on tables, networks and hierarchies.
 * @param {import('../types').DodgeLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function dodge(options = {}) {
    const { gap, where, in: scope, table } = layoutOptions('dodge', options);
    const validIn = checkIn('dodge', scope, VALID_IN);
    return makeLayout({
        type: 'dodge',
        table,
        options: { gap, where, in: validIn },
    });
}

/**
 * Line items up left to right, wrapping when a fixed width limits them.
 * @param {import('../types').FlowLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function row(options = {}) {
    const { gap, in: scope, where, table } = layoutOptions('row', options);
    const validIn = checkIn('row', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'row',
        table,
        options: { gap, in: validIn, where: rowTest('row', where) },
    });
}

/**
 * Stack items top to bottom, wrapping when a fixed height limits them.
 * @param {import('../types').FlowLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function column(options = {}) {
    const { gap, in: scope, where, table } = layoutOptions('column', options);
    const validIn = checkIn('column', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'column',
        table,
        options: { gap, in: validIn, where: rowTest('column', where) },
    });
}

/**
 * Place items in equal cells, `columns` to a row.
 * @param {import('../types').GridLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function grid(options = {}) {
    const { columns, gap, in: scope, where, table } = layoutOptions('grid', options);
    const validIn = checkIn('grid', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'grid',
        table,
        options: { columns, gap, in: validIn, where: rowTest('grid', where) },
    });
}

/**
 * Draw items together where they are, touching at `gap` px (circles when all
 * round, else boxes). `keep` is 'distance' (default) or 'angle'.
 * @param {import('../types').PackLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function pack(options = {}) {
    const { gap, keep, in: scope, where, table } = layoutOptions('pack', options);
    let resolvedKeep = keep;
    if (keep !== undefined && !KEEPS.includes(keep)) {
        warn(
            'layout:pack:keep',
            `layout.pack({ keep: ${JSON.stringify(keep)} }): use one of ${KEEPS.map((k) => `"${k}"`).join(', ')}. Packing by "distance".`
        );
        resolvedKeep = 'distance';
    }
    const validIn = checkIn('pack', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'pack',
        table,
        options: { gap, keep: resolvedKeep, in: validIn, where: rowTest('pack', where) },
    });
}
