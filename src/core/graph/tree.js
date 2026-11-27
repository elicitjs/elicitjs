// @ts-check
// tree.js: a tidy tree (Reingold–Tilford, in linear time as Buchheim–Walker) over
// a network's links, through d3.tree. A root is a node no link points to. A graph
// that is not a tree is drawn by its breadth-first spanning tree, and several roots
// sit side by side.

import { hierarchy, tree as d3tree } from 'd3';
import { frameOf } from './shared.js';

/**
 * @typedef {{ v: number, children: TreeNode[] }} TreeNode
 */

/**
 * Lay out a tree.
 * @param {import('./shared.js').Box[]} boxes every node's box (its centre orders siblings)
 * @param {[number, number][]} edges parent → child, by node index
 * @param {{ direction?: string, gap?: number, rankGap?: number }} [options]
 * @returns {{ points: import('./shared.js').Point[], spanning: boolean }} centres
 *   relative to an arbitrary origin; `spanning` when some links were left out
 */
export function tidyTree(boxes, edges, options = {}) {
    const { direction = 'down', gap = 12, rankGap = 40 } = options;
    const N = boxes.length;
    if (!N) return { points: [], spanning: false };
    const radial = direction === 'radial';
    const frame = frameOf(radial ? 'down' : direction);
    const local = boxes.map(frame.box);

    /** @type {number[][]} */
    const kids = boxes.map(() => []);
    const hasParent = new Array(N).fill(false);
    let used = 0;
    const pairs = new Set();
    for (const [s, t] of edges) {
        if (s === t || s < 0 || t < 0 || s >= N || t >= N || pairs.has(`${s}>${t}`)) continue;
        pairs.add(`${s}>${t}`);
        kids[s].push(t);
        hasParent[t] = true;
    }
    const byPos = [...Array(N).keys()].sort((a, b) => local[a].cy - local[b].cy || local[a].cx - local[b].cx);
    const seen = new Set();
    /** @type {TreeNode[]} */
    const roots = [];
    /** @param {number} r */
    const grow = (r) => {
        /** @type {TreeNode} */
        const top = { v: r, children: [] };
        seen.add(r);
        const queue = [top];
        while (queue.length) {
            const cur = /** @type {TreeNode} */ (queue.shift());
            const next = kids[cur.v].filter((k) => !seen.has(k));
            // Siblings keep the order they are drawn in.
            next.sort((a, b) => local[a].cx - local[b].cx || a - b);
            for (const k of next) {
                if (seen.has(k)) continue;
                seen.add(k);
                used++;
                /** @type {TreeNode} */
                const node = { v: k, children: [] };
                cur.children.push(node);
                queue.push(node);
            }
        }
        roots.push(top);
    };
    for (const v of byPos) if (!hasParent[v] && !seen.has(v)) grow(v);
    // What is left hangs on a cycle: start from the first one drawn.
    for (const v of byPos) if (!seen.has(v)) grow(v);
    roots.sort((a, b) => local[a.v].cx - local[b.v].cx || a.v - b.v);

    // One hidden root holds the forest, so the trees sit side by side.
    const top = hierarchy(/** @type {any} */ ({ v: -1, children: roots }), (d) => (d.children.length ? d.children : null));
    const breadth = Math.max(...local.map((b) => 2 * b.hw)) + gap;
    const layout = d3tree().nodeSize([breadth, 1]).separation((a, b) => (a.parent === b.parent ? 1 : 1.25));
    layout(top);

    // Depth lines: each depth as deep as its deepest node, `rankGap` between depths.
    /** @type {number[]} */
    const deep = [];
    top.each((d) => { if (d.data.v >= 0) deep[d.depth] = Math.max(deep[d.depth] || 0, local[d.data.v].hh); });
    /** @type {number[]} */
    const lineAt = [0, deep[1] || 0];
    for (let k = 2; k < deep.length; k++) lineAt[k] = lineAt[k - 1] + deep[k - 1] + rankGap + deep[k];

    /** @type {import('./shared.js').Point[]} */
    const points = new Array(N);
    if (radial) {
        // Wrap the breadth around the circle, one ring per depth.
        let lo = Infinity, hi = -Infinity;
        top.each((d) => { if (d.data.v >= 0) { lo = Math.min(lo, /** @type {number} */ (d.x)); hi = Math.max(hi, /** @type {number} */ (d.x)); } });
        const span = Math.max(hi - lo + breadth, 1);
        const ring = Math.max(...local.map((b) => Math.max(b.hw, b.hh) * 2)) + rankGap;
        top.each((d) => {
            if (d.data.v < 0) return;
            const a = ((/** @type {number} */ (d.x) - lo) / span) * 2 * Math.PI - Math.PI / 2;
            const r = roots.length === 1 ? (d.depth - 1) * ring : d.depth * ring;
            points[d.data.v] = { x: r * Math.cos(a), y: r * Math.sin(a) };
        });
    } else {
        top.each((d) => {
            if (d.data.v < 0) return;
            points[d.data.v] = frame.back({ x: /** @type {number} */ (d.x), y: lineAt[d.depth] });
        });
    }
    return { points, spanning: used < pairs.size };
}
