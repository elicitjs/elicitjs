// @ts-check
// stress.js: stress majorization (SMACOF, as in Gansner, Koren and North). Each
// pair of nodes is drawn as far apart as `length` times the number of links between
// them, by weighted least squares. Deterministic, and fixed nodes stay where they are.

/** Most rounds of the solver. */
const ROUNDS = 300;
/** The solver stops once no node moves further than this in a round, in px. */
const SETTLED = 0.05;
/** The golden angle, which spreads new nodes evenly around a start. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Hops between every pair of nodes, links taken both ways. Pairs in different
 * parts of the graph count as one hop more than the longest path.
 * @param {number} N
 * @param {[number, number][]} edges
 * @returns {number[][]}
 */
export function hops(N, edges) {
    /** @type {number[][]} */
    const adj = Array.from({ length: N }, () => []);
    for (const [s, t] of edges) {
        if (s === t || s < 0 || t < 0 || s >= N || t >= N) continue;
        adj[s].push(t); adj[t].push(s);
    }
    /** @type {number[][]} */
    const D = [];
    let longest = 1;
    for (let s = 0; s < N; s++) {
        const d = new Array(N).fill(Infinity);
        d[s] = 0;
        const queue = [s];
        for (let q = 0; q < queue.length; q++) {
            const u = queue[q];
            for (const w of adj[u]) if (d[w] === Infinity) { d[w] = d[u] + 1; queue.push(w); }
        }
        for (const x of d) if (x < Infinity) longest = Math.max(longest, x);
        D.push(d);
    }
    for (const row of D) for (let j = 0; j < N; j++) if (row[j] === Infinity) row[j] = longest + 1;
    return D;
}

/**
 * Classical MDS by power iteration: a deterministic start for nodes that have
 * nowhere better to begin.
 * @param {number[][]} D hops
 * @param {number} length px per hop
 * @returns {import('./shared.js').Point[]}
 */
function classicalMDS(D, length) {
    const N = D.length;
    const D2 = D.map((r) => r.map((d) => (d * length) ** 2));
    const rowMean = D2.map((r) => r.reduce((a, b) => a + b, 0) / N);
    const all = rowMean.reduce((a, b) => a + b, 0) / N;
    const B = D2.map((r, i) => r.map((d, j) => -0.5 * (d - rowMean[i] - rowMean[j] + all)));
    /** @type {{ v: number[], lambda: number }[]} */
    const found = [];
    for (let k = 0; k < 2; k++) {
        let v = Array.from({ length: N }, (_, i) => Math.cos(i * (k + 1) * 1.7) + 0.1 * i);
        let lambda = 0;
        for (let it = 0; it < 100; it++) {
            let w = B.map((r) => r.reduce((s, b, j) => s + b * v[j], 0));
            for (const u of found) {
                const p = w.reduce((s, x, i) => s + x * u.v[i], 0);
                w = w.map((x, i) => x - p * u.v[i]);
            }
            const norm = Math.hypot(...w) || 1;
            lambda = norm;
            v = w.map((x) => x / norm);
        }
        found.push({ v, lambda });
    }
    return found[0].v.map((_, i) => ({
        x: found[0].v[i] * Math.sqrt(found[0].lambda),
        y: found[1].v[i] * Math.sqrt(found[1].lambda),
    }));
}

/**
 * Lay out a graph by stress. `start` gives each node's current centre, or null for
 * a node with none yet.
 * @param {(import('./shared.js').Point | null)[]} start
 * @param {[number, number][]} edges
 * @param {{ length?: number, fixed?: Set<number> }} [options]
 * @returns {{ points: import('./shared.js').Point[], fresh: boolean }} the centres;
 *   `fresh` when the drawing started from nothing (so it may go anywhere)
 */
export function stress(start, edges, options = {}) {
    const { length = 100, fixed = new Set() } = options;
    const N = start.length;
    if (!N) return { points: [], fresh: false };
    const D = hops(N, edges);
    /** @type {(import('./shared.js').Point | null)[]} */
    const P = start.map((p) => (p ? { x: p.x, y: p.y } : null));
    const known = P.filter(Boolean).length;

    // A drawing piled up in one spot (or with nothing placed) starts from MDS.
    const placed = /** @type {import('./shared.js').Point[]} */ (P.filter(Boolean));
    const mx = placed.reduce((s, p) => s + p.x, 0) / (placed.length || 1);
    const my = placed.reduce((s, p) => s + p.y, 0) / (placed.length || 1);
    const spread = Math.sqrt(placed.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / (placed.length || 1));
    const fresh = !fixed.size && (known === 0 || (N > 1 && spread < length * 0.5));
    if (fresh) {
        const M = classicalMDS(D, length);
        // Mirror it to read like the drawing it replaces.
        for (const axis of /** @type {('x' | 'y')[]} */ (['x', 'y'])) {
            const mid = axis === 'x' ? mx : my;
            const corr = M.reduce((s, m, i) => s + m[axis] * ((P[i] ? /** @type {any} */ (P[i])[axis] : mid) - mid), 0);
            if (corr < 0) for (const m of M) m[axis] = -m[axis];
        }
        M.forEach((m, i) => { if (!fixed.has(i)) P[i] = { x: mx + m.x, y: my + m.y }; });
    } else {
        // A node with no position starts beside the placed nodes it links to.
        let k = 0;
        for (let i = 0; i < N; i++) {
            if (P[i]) continue;
            const nb = edges.filter(([s, t]) => s === i || t === i).map(([s, t]) => (s === i ? t : s)).filter((j) => start[j]);
            const from = nb.length ? nb : placed.map((_, j) => j).filter((j) => start[j]);
            const ax = from.length ? from.reduce((s, j) => s + /** @type {any} */ (start[j]).x, 0) / from.length : mx;
            const ay = from.length ? from.reduce((s, j) => s + /** @type {any} */ (start[j]).y, 0) / from.length : my;
            k++;
            P[i] = { x: ax + Math.cos(k * GOLDEN) * length * 0.6, y: ay + Math.sin(k * GOLDEN) * length * 0.6 };
        }
    }
    const pts = /** @type {import('./shared.js').Point[]} */ (P);
    // Two nodes on one spot have no direction to part in: nudge them apart.
    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            if (fixed.has(j)) continue;
            if (Math.abs(pts[i].x - pts[j].x) < 0.5 && Math.abs(pts[i].y - pts[j].y) < 0.5) {
                pts[j] = { x: pts[j].x + Math.cos(j * GOLDEN) * 2, y: pts[j].y + Math.sin(j * GOLDEN) * 2 };
            }
        }
    }

    for (let round = 0; round < ROUNDS; round++) {
        let most = 0;
        for (let i = 0; i < N; i++) {
            if (fixed.has(i)) continue;
            let nx = 0, ny = 0, ws = 0;
            for (let j = 0; j < N; j++) {
                if (j === i) continue;
                const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
                const dist = Math.hypot(dx, dy) || 1e-3;
                const want = D[i][j] * length;
                const w = 1 / (D[i][j] * D[i][j]);
                nx += w * (pts[j].x + (want * dx) / dist);
                ny += w * (pts[j].y + (want * dy) / dist);
                ws += w;
            }
            const next = { x: nx / ws, y: ny / ws };
            most = Math.max(most, Math.abs(next.x - pts[i].x), Math.abs(next.y - pts[i].y));
            pts[i] = next;
        }
        if (most < SETTLED) break;
    }
    return { points: pts, fresh };
}
