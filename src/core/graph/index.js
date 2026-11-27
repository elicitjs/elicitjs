// @ts-check
// graph/: the layouts that place nodes by their links (`layout.network.*`) and the
// tidy pass (`layout.tidy`). Pure: every function takes boxes in pixels and returns
// centres. `core/fit.js` reads the boxes off the marks and writes the result back
// into the rows through the channels' scales.

import { layered } from './layered.js';
import { tidyTree } from './tree.js';
import { stress } from './stress.js';
import { removeOverlaps, middleOf } from './shared.js';
import { warn } from '../dev.js';

export { tidy } from './tidy.js';
export { DIRECTIONS } from './shared.js';

/** The ways a network layout treats rows that already have a position. */
export const PLACES = ['new', 'all'];

/**
 * @typedef {import('./shared.js').Box} Box
 * @typedef {import('./shared.js').Point} Point
 * @typedef {{
 *   boxes: (Box | null)[],
 *   edges: [number, number][],
 *   unplaced: Set<number>,
 *   floating?: Set<number>,
 *   locked: Set<number>,
 *   held: Set<number>,
 *   width: number,
 *   height: number,
 * }} GraphInput
 */

/**
 * Where one network layout puts each node. Rows it leaves alone are absent.
 * @param {import('../../types').LayoutSpec} layout
 * @param {GraphInput} input
 * @returns {Map<number, Point>}
 */
export function placeNetwork(layout, input) {
    const { boxes, edges, unplaced, locked, held, width, height } = input;
    // Rows whose current spot means nothing yet (dropped mid-plot to be sized).
    const floating = input.floating || unplaced;
    const opt = layout.options || {};
    const all = opt.place === 'all';
    /** @type {Map<number, Point>} */
    const out = new Map();
    // Only rows with a box take part; a row no mark can draw is left alone.
    const ids = boxes.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    if (!ids.length || (!all && !ids.some((i) => unplaced.has(i)))) return out;
    const local = new Map(ids.map((i, k) => [i, k]));
    const sub = /** @type {Box[]} */ (ids.map((i) => boxes[i]));
    /** @type {[number, number][]} */
    const subEdges = [];
    for (const [s, t] of edges) {
        if (local.has(s) && local.has(t)) subEdges.push([/** @type {number} */ (local.get(s)), /** @type {number} */ (local.get(t))]);
    }
    const middle = { x: width / 2, y: height / 2 };
    /** The rows that keep their place. */
    const keep = (/** @type {number} */ i) => locked.has(i) || (!all && !unplaced.has(i));

    if (layout.type === 'network.force') {
        const fixed = new Set(ids.filter((i) => keep(i) || (all && held.has(i))).map((i) => /** @type {number} */ (local.get(i))));
        const start = ids.map((i) => (unplaced.has(i) ? null : { x: /** @type {Box} */ (boxes[i]).cx, y: /** @type {Box} */ (boxes[i]).cy }));
        const { points, fresh } = stress(start, subEdges, { length: opt.length, fixed });
        if (fresh) {
            const mid = middleOf(sub, points);
            if (mid) for (const p of points) { p.x += middle.x - mid.x; p.y += middle.y - mid.y; }
        }
        // The nodes it moves stay inside the plot, and clear of each other.
        removeOverlaps(sub, points, opt.gap, (k) => (fixed.has(k) ? 0 : 1), { width, height });
        points.forEach((p, k) => { if (!fixed.has(k)) out.set(ids[k], p); });
        return out;
    }

    /** @type {Point[]} */
    let points;
    if (layout.type === 'network.tree') {
        const res = tidyTree(sub, subEdges, { direction: opt.direction, gap: opt.gap, rankGap: opt.rankGap });
        if (res.spanning) {
            warn(
                'layout:network.tree:spanning',
                'layout.network.tree(): the links do not form a tree (a node has two parents, or there is a cycle), ' +
                'so some links are left out of the layout. Use layout.network.layered() for a graph with shared children or cycles.'
            );
        }
        points = res.points;
    } else {
        points = layered(sub, subEdges, { direction: opt.direction, gap: opt.gap, rankGap: opt.rankGap });
    }

    // A drawing bigger than the plot would be cut off: say so.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    points.forEach((p, k) => {
        x0 = Math.min(x0, p.x - sub[k].hw); x1 = Math.max(x1, p.x + sub[k].hw);
        y0 = Math.min(y0, p.y - sub[k].hh); y1 = Math.max(y1, p.y + sub[k].hh);
    });
    if (x1 - x0 > width + 1 || y1 - y0 > height + 1) {
        warn(
            `layout:${layout.type}:size`,
            `layout.${layout.type}() draws ${Math.round(x1 - x0)} x ${Math.round(y1 - y0)} px, but the plot is ` +
            `${Math.round(width)} x ${Math.round(height)} px, so some nodes sit outside it. ` +
            'Make the chart bigger, or lower `gap` or `rankGap`.'
        );
    }

    // The drawing sits where the rows that keep their place say. Otherwise it
    // keeps the middle of the rows it moves, so a group laid out inside a
    // container stays there; a drawing with no positions at all goes mid-plot.
    const anchors = ids.map((i, k) => (keep(i) ? k : -1)).filter((k) => k >= 0);
    let dx, dy;
    if (anchors.length) {
        dx = anchors.reduce((s, k) => s + sub[k].cx - points[k].x, 0) / anchors.length;
        dy = anchors.reduce((s, k) => s + sub[k].cy - points[k].y, 0) / anchors.length;
    } else {
        const placed = ids.some((i) => !floating.has(i));
        const was = placed
            ? middleOf(sub, sub.map((b) => ({ x: b.cx, y: b.cy })), (k) => !floating.has(ids[k]))
            : null;
        const target = was || middle;
        const mid = /** @type {Point} */ (middleOf(sub, points));
        dx = target.x - mid.x;
        dy = target.y - mid.y;
    }
    const moved = points.map((p, k) => (anchors.includes(k) ? { x: sub[k].cx, y: sub[k].cy } : { x: p.x + dx, y: p.y + dy }));
    if (anchors.length) removeOverlaps(sub, moved, opt.gap, (k) => (anchors.includes(k) ? 0 : 1));
    moved.forEach((p, k) => { if (!anchors.includes(k)) out.set(ids[k], p); });
    return out;
}
