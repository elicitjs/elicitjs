// @ts-check
// layout/ — chart-level spatial settling processes (`spec.layout`).
// Each reads the marks' rendered boxes (`nodeBox`, glyph extents) and writes
// settled positions/sizes back into the dataset through the channels' scales.
// Works across tables, networks and hierarchies (`contain` is hierarchy-only).

import { makeLayout, layoutOptions, defineLayout } from './define.js';
import { KEEPS } from '../core/arrange.js';
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
export function contain(options = {}) {
    const { where, padding, fit = false, table } = layoutOptions('contain', options);
    let resolvedFit = fit;
    if (!VALID_FIT.includes(/** @type {any} */ (fit))) {
        warn(
            'layout:contain:fit',
            `layout.contain({ fit: ${JSON.stringify(fit)} }): use true, false, "x" or "y". Ignoring.`
        );
        resolvedFit = false;
    }
    return makeLayout({
        type: 'contain',
        table,
        options: { where, padding, fit: resolvedFit },
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
    const { gap, in: scope, table } = layoutOptions('row', options);
    const validIn = checkIn('row', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'row',
        table,
        options: { gap, in: validIn },
    });
}

/**
 * Stack items top to bottom, wrapping when a fixed height limits them.
 * @param {import('../types').FlowLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function column(options = {}) {
    const { gap, in: scope, table } = layoutOptions('column', options);
    const validIn = checkIn('column', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'column',
        table,
        options: { gap, in: validIn },
    });
}

/**
 * Place items in equal cells, `columns` to a row.
 * @param {import('../types').GridLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function grid(options = {}) {
    const { columns, gap, in: scope, table } = layoutOptions('grid', options);
    const validIn = checkIn('grid', scope, ['roots', 'containers']);
    return makeLayout({
        type: 'grid',
        table,
        options: { columns, gap, in: validIn },
    });
}

/**
 * Draw items together where they are, touching at `gap` px (circles when all
 * round, else boxes). `keep` is 'distance' (default) or 'angle'.
 * @param {import('../types').PackLayoutOptions} [options]
 * @returns {import('../types').LayoutSpec}
 */
export function pack(options = {}) {
    const { gap, keep, in: scope, table } = layoutOptions('pack', options);
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
        options: { gap, keep: resolvedKeep, in: validIn },
    });
}
