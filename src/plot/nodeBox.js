// @ts-check
// nodeBox.js — a node's rectangle, as links, ports and connect edits see it.
// The node mark declares its box as a rule over the row (`Mark.nodeBox`); this
// turns that rule into boxes. Without a rule, a node is a small square about its
// position.

import { encodeChannel } from './mark.js';

/**
 * Which channels place a node when no box rule does: the mark's own `x`/`y`, else
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
 * The row whose declared box contains a point, or null. `accepts` filters rows;
 * among hits the highest `rank` wins, then the nearest centre.
 * @param {{ x: number, y: number }} point
 * @param {any[]} rows
 * @param {import('../types').NodeBoxRule} rule
 * @param {{ accepts?: (i: number) => boolean, rank?: (i: number) => number }} [options]
 * @returns {number | null} the row's index
 */
export function boxAt(point, rows, rule, { accepts, rank } = {}) {
    /** @type {number | null} */
    let best = null;
    let bestRank = -Infinity;
    let bestDist = Infinity;
    rows.forEach((row, i) => {
        if (!row || (accepts && !accepts(i))) return;
        const box = rule(row, i, rows);
        if (!box || ![box.cx, box.cy, box.hw, box.hh].every(Number.isFinite)) return;
        if (Math.abs(point.x - box.cx) > box.hw || Math.abs(point.y - box.cy) > box.hh) return;
        const r = rank ? rank(i) : 0;
        const d = Math.hypot(box.cx - point.x, box.cy - point.y);
        if (r > bestRank || (r === bestRank && d < bestDist)) { best = i; bestRank = r; bestDist = d; }
    });
    return best;
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
