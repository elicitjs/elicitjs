// @ts-check
// layered.js: a layered (Sugiyama) drawing for directed diagrams. Every link runs
// one way down the ranks.
//   1. break cycles: a greedy order (Eades, Lin and Smyth); links against it reverse
//   2. ranks: longest path, then sources pulled down next to their children
//   3. a dummy item for each rank a long link passes through
//   4. order each rank to cut crossings: barycenter sweeps, then neighbour swaps
//   5. coordinates: each item moves toward its neighbours, order and gaps kept
// The current drawing seeds every choice, so a layout of its own output is stable.

import { placeInOrder, frameOf } from './shared.js';

/** Width given to a long link's dummy item, in px. */
const DUMMY_WIDTH = 4;
/** Sweeps of the crossing reduction. */
const SWEEPS = 12;
/** Rounds of the coordinate pass. */
const ROUNDS = 24;

/**
 * Lay out a directed graph in ranks.
 * @param {import('./shared.js').Box[]} boxes0 every node's box (its centre seeds the order)
 * @param {[number, number][]} edges source → target, by node index
 * @param {{ direction?: string, gap?: number, rankGap?: number }} [options]
 * @returns {import('./shared.js').Point[]} centres, relative to an arbitrary origin
 */
export function layered(boxes0, edges, options = {}) {
    const { direction = 'down', gap = 24, rankGap = 48 } = options;
    const frame = frameOf(direction);
    const boxes = boxes0.map(frame.box);
    const N = boxes.length;
    if (!N) return [];

    // Seed order: top to bottom, then left to right, as drawn.
    const seed = [...Array(N).keys()].sort((a, b) => boxes[a].cy - boxes[b].cy || boxes[a].cx - boxes[b].cx);
    const proper = edges.filter(([s, t]) => s !== t && s >= 0 && t >= 0 && s < N && t < N);

    // 1. Break cycles.
    /** @type {number[][]} */
    const outs = boxes.map(() => []);
    /** @type {number[][]} */
    const ins = boxes.map(() => []);
    for (const [s, t] of proper) { outs[s].push(t); ins[t].push(s); }
    const alive = new Set(seed);
    const outD = (/** @type {number} */ v) => outs[v].filter((w) => alive.has(w)).length;
    const inD = (/** @type {number} */ v) => ins[v].filter((w) => alive.has(w)).length;
    /** @type {number[]} */
    const left = [];
    /** @type {number[]} */
    const right = [];
    while (alive.size) {
        let changed = true;
        while (changed) {
            changed = false;
            for (const v of seed) if (alive.has(v) && outD(v) === 0) { right.unshift(v); alive.delete(v); changed = true; }
            for (const v of seed) if (alive.has(v) && inD(v) === 0) { left.push(v); alive.delete(v); changed = true; }
        }
        if (!alive.size) break;
        let best = -1, bestScore = -Infinity;
        for (const v of seed) {
            if (!alive.has(v)) continue;
            const score = outD(v) - inD(v);
            if (score > bestScore) { bestScore = score; best = v; }
        }
        left.push(best);
        alive.delete(best);
    }
    const order = left.concat(right);
    const at = new Map(order.map((v, k) => [v, k]));
    const dag = proper.map(([s, t]) => (/** @type {number} */ (at.get(s)) < /** @type {number} */ (at.get(t)) ? [s, t] : [t, s]));

    // 2. Ranks.
    const rank = new Array(N).fill(0);
    /** @type {number[][]} */
    const kids = boxes.map(() => []);
    /** @type {number[][]} */
    const parents = boxes.map(() => []);
    for (const [u, v] of dag) { kids[u].push(v); parents[v].push(u); }
    for (const v of order) for (const u of parents[v]) rank[v] = Math.max(rank[v], rank[u] + 1);
    for (const v of order.slice().reverse()) {
        if (parents[v].length || !kids[v].length) continue;
        rank[v] = Math.min(...kids[v].map((w) => rank[w])) - 1;
    }
    const r0 = Math.min(...rank);
    for (let v = 0; v < N; v++) rank[v] -= r0;
    const R = Math.max(...rank);

    // 3. Items: the nodes, then a dummy for each rank a long link crosses.
    /** @type {{ w: number, x0: number, rank: number, dummy: boolean }[]} */
    const items = boxes.map((b, v) => ({ w: 2 * b.hw, x0: b.cx, rank: rank[v], dummy: false }));
    /** @type {[number, number][]} */
    const links = [];
    for (const [u, v] of dag) {
        let prev = u;
        for (let r = rank[u] + 1; r < rank[v]; r++) {
            const t = (r - rank[u]) / (rank[v] - rank[u]);
            items.push({ w: DUMMY_WIDTH, x0: boxes[u].cx + t * (boxes[v].cx - boxes[u].cx), rank: r, dummy: true });
            links.push([prev, items.length - 1]);
            prev = items.length - 1;
        }
        links.push([prev, v]);
    }
    /** @type {number[][]} */
    const L = Array.from({ length: R + 1 }, () => []);
    items.forEach((it, id) => L[it.rank].push(id));
    for (const layer of L) layer.sort((a, b) => items[a].x0 - items[b].x0 || a - b);
    /** @type {number[][]} */
    const up = items.map(() => []);
    /** @type {number[][]} */
    const down = items.map(() => []);
    for (const [a, b] of links) { down[a].push(b); up[b].push(a); }
    /** @type {[number, number][][]} links leaving each rank */
    const between = Array.from({ length: R }, () => /** @type {[number, number][]} */ ([]));
    for (const l of links) between[items[l[0]].rank].push(l);

    // 4. Order each rank.
    const pos = new Array(items.length).fill(0);
    const index = () => { for (const layer of L) layer.forEach((id, k) => { pos[id] = k; }); };
    const crossings = () => {
        let c = 0;
        for (const es of between) {
            for (let i = 0; i < es.length; i++) {
                for (let j = i + 1; j < es.length; j++) {
                    if ((pos[es[i][0]] - pos[es[j][0]]) * (pos[es[i][1]] - pos[es[j][1]]) < 0) c++;
                }
            }
        }
        return c;
    };
    /** Crossings among the links of u and v when u is left of v. @param {number} u @param {number} v */
    const pairCost = (u, v) => {
        let c = 0;
        for (const nb of [up, down]) for (const a of nb[u]) for (const b of nb[v]) if (pos[a] > pos[b]) c++;
        return c;
    };
    /** @param {number[]} layer @param {number[][]} nb */
    const sortBy = (layer, nb) => {
        const key = new Map(layer.map((id, k) => [id, nb[id].length ? nb[id].reduce((s, n) => s + pos[n], 0) / nb[id].length : k]));
        layer.sort((a, b) => /** @type {number} */ (key.get(a)) - /** @type {number} */ (key.get(b)) || pos[a] - pos[b]);
        layer.forEach((id, k) => { pos[id] = k; });
    };
    const swaps = () => {
        for (let guard = 0; guard < 8; guard++) {
            let improved = false;
            for (const layer of L) {
                for (let k = 0; k < layer.length - 1; k++) {
                    const u = layer[k], v = layer[k + 1];
                    if (pairCost(v, u) < pairCost(u, v)) {
                        layer[k] = v; layer[k + 1] = u;
                        pos[u] = k + 1; pos[v] = k;
                        improved = true;
                    }
                }
            }
            if (!improved) return;
        }
    };
    index();
    let best = L.map((l) => l.slice());
    let bestCount = crossings();
    for (let sweep = 0; sweep < SWEEPS && bestCount > 0; sweep++) {
        if (sweep % 2 === 0) for (let r = 1; r <= R; r++) sortBy(L[r], up);
        else for (let r = R - 1; r >= 0; r--) sortBy(L[r], down);
        swaps();
        const c = crossings();
        if (c < bestCount) { bestCount = c; best = L.map((l) => l.slice()); }
    }
    for (let r = 0; r <= R; r++) L[r] = best[r];

    // 5. Coordinates.
    const X = new Array(items.length).fill(0);
    const sep = (/** @type {number} */ a, /** @type {number} */ b) => (items[a].w + items[b].w) / 2 + (items[a].dummy || items[b].dummy ? gap / 2 : gap);
    for (const layer of L) {
        let x = 0;
        layer.forEach((id, k) => { if (k) x += sep(layer[k - 1], id); X[id] = x; });
    }
    for (let round = 0; round < ROUNDS; round++) {
        const downward = round % 2 === 0;
        const ranks = [...Array(R + 1).keys()];
        if (!downward) ranks.reverse();
        for (const r of ranks) {
            const layer = L[r];
            if (!layer.length) continue;
            const targets = layer.map((id) => {
                const nb = round >= ROUNDS - 4 ? up[id].concat(down[id]) : (downward ? up[id] : down[id]);
                return nb.length ? nb.reduce((s, n) => s + X[n], 0) / nb.length : X[id];
            });
            const weights = layer.map((id) => (items[id].dummy ? 2 : 1));
            const seps = layer.slice(1).map((id, k) => sep(layer[k], id));
            placeInOrder(targets, weights, seps).forEach((x, k) => { X[layer[k]] = x; });
        }
    }

    // Rank lines: each rank as tall as its tallest node, `rankGap` between ranks.
    const tall = new Array(R + 1).fill(0);
    for (let v = 0; v < N; v++) tall[rank[v]] = Math.max(tall[rank[v]], boxes[v].hh);
    const Y = [tall[0]];
    for (let r = 1; r <= R; r++) Y[r] = Y[r - 1] + tall[r - 1] + rankGap + tall[r];

    return boxes.map((_, v) => frame.back({ x: X[v], y: Y[rank[v]] }));
}
