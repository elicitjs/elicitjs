// @ts-check
// nodeBox.js — a NODE's rectangle, as the marks and edits that dock to it see it.
//
// A link docks to a box, a port sits on its edges, and a connect gesture tests
// whether the pointer is inside one. All three must agree on where a node's edge
// is, and none may read the geometry another mark DREW. So the mark that draws the
// nodes DECLARES its box as a rule over the row (`Mark.nodeBox`: a point's radius, a
// rect's extent, and therefore a sticker's paper), the engine hands that one rule to
// every reader, and this helper turns it into boxes. One rule, three readers.
//
// With no rule — a network whose nodes are drawn by nothing that declares one, or
// not drawn at all — a node is a small square about its position, so a routed
// connector still leaves it square-on.

import { encodeChannel } from './mark.js';

/**
 * Which channels place a NODE when no box rule does: the mark's own `x`/`y`, else
 * the node table's columns of those names.
 * @param {Record<string, any>} channels
 * @param {any} nodes the nodes TableSchema
 * @returns {Record<string, any>}
 */
export function nodeChannelsOf(channels, nodes) {
    const has = (/** @type {string} */ f) => !!(nodes && nodes.fields[f]);
    return {
        x: channels.x || (has('x') ? { field: 'x' } : undefined),
        y: channels.y || (has('y') ? { field: 'y' } : undefined),
    };
}

/**
 * Every node's box, in scene coordinates, aligned by row index (null for a null
 * row). The declared rule wins; without one, the node's encoded position with a
 * `w`×`h` box about it.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels the reader's channel map (x/y fallback only)
 * @param {any} nodes the nodes TableSchema
 * @param {any[]} rows the node table
 * @param {import('../types').NodeBoxRule | null | undefined} rule
 * @param {number} w default width @param {number} h default height
 * @param {number} width chart inner width @param {number} height chart inner height
 * @returns {(import('../types').NodeBox | null)[]}
 */
export function nodeBoxesOf(scales, channels, nodes, rows, rule, w, h, width, height) {
    const pos = nodeChannelsOf(channels, nodes);
    return rows.map((row, i) => {
        if (!row) return null;
        if (rule) {
            const box = rule(row, i, rows);
            if (box && [box.cx, box.cy, box.hw, box.hh].every(Number.isFinite)) return box;
        }
        return {
            cx: encodeChannel(scales, pos, 'x', row, width / 2, i, rows),
            cy: encodeChannel(scales, pos, 'y', row, height / 2, i, rows),
            hw: w / 2,
            hh: h / 2,
        };
    });
}
