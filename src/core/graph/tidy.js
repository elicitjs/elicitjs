// @ts-check
// tidy.js: keep a hand layout, but line it up. Centres within `snap` px of each
// other share a row (or a column), lines whose gaps nearly agree are spaced
// evenly, and a node that overlaps another while standing alone in its column
// takes the nearest free cell in its row. Moves things as little as it can, and
// tidying a tidy layout moves nothing.

/** Gaps between lines this close to their median are made equal. */
const EVEN_TOLERANCE = 0.35;

/**
 * Group indices whose key values lie within `snap` of the running group mean.
 * @param {number[]} ids
 * @param {(i: number) => number} key
 * @param {number} snap
 * @returns {{ ids: number[], mean: number }[]}
 */
function clusters(ids, key, snap) {
    const sorted = ids.slice().sort((a, b) => key(a) - key(b) || a - b);
    /** @type {{ ids: number[], mean: number }[]} */
    const groups = [];
    for (const id of sorted) {
        const last = groups[groups.length - 1];
        if (last && key(id) - last.mean <= snap) {
            last.ids.push(id);
            last.mean = last.ids.reduce((s, k) => s + key(k), 0) / last.ids.length;
        } else {
            groups.push({ ids: [id], mean: key(id) });
        }
    }
    return groups;
}

/**
 * Space lines evenly when their gaps already nearly agree; otherwise leave them.
 * @param {number[]} lines in order
 * @returns {number[]}
 */
function evenLines(lines) {
    if (lines.length < 3) return lines;
    const gaps = lines.slice(1).map((v, k) => v - lines[k]);
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    if (gaps.some((d) => Math.abs(d - median) > median * EVEN_TOLERANCE)) return lines;
    const step = (lines[lines.length - 1] - lines[0]) / (lines.length - 1);
    return lines.map((_, k) => lines[0] + k * step);
}

/**
 * Tidy a set of boxes.
 * @param {import('./shared.js').Box[]} boxes
 * @param {{ snap?: number, gap?: number, fixed?: Set<number> }} [options]
 * @returns {import('./shared.js').Point[]} the new centres
 */
export function tidy(boxes, options = {}) {
    const { snap = 16, gap = 8, fixed = new Set() } = options;
    const pts = boxes.map((b) => ({ x: b.cx, y: b.cy }));
    const ids = boxes.map((_, i) => i);
    if (ids.length < 2) return pts;

    /** @param {'x' | 'y'} axis */
    const line = (axis) => {
        const groups = clusters(ids, (i) => pts[i][axis], snap);
        // A group holding a fixed box lines up on it.
        const means = groups.map((g) => {
            const held = g.ids.filter((i) => fixed.has(i));
            return held.length ? pts[held[0]][axis] : g.mean;
        });
        const lines = groups.some((g) => g.ids.some((i) => fixed.has(i))) ? means : evenLines(means);
        groups.forEach((g, k) => { for (const i of g.ids) if (!fixed.has(i)) pts[i][axis] = lines[k]; });
        return groups;
    };
    line('y');
    const columns = line('x');

    // An overlapping node alone in its column moves to the nearest free cell in its row.
    const shared = columns.filter((g) => g.ids.length > 1).map((g) => pts[g.ids[0]].x);
    const clear = (/** @type {number} */ i, /** @type {number} */ j) =>
        Math.abs(pts[i].x - pts[j].x) >= boxes[i].hw + boxes[j].hw + gap - 0.01
        || Math.abs(pts[i].y - pts[j].y) >= boxes[i].hh + boxes[j].hh + gap - 0.01;
    for (const g of columns) {
        if (g.ids.length !== 1) continue;
        const i = g.ids[0];
        if (fixed.has(i) || ids.every((j) => j === i || clear(i, j))) continue;
        const free = shared.filter((x) => ids.every((j) => j === i || Math.abs(pts[j].y - pts[i].y) > 0.5 || Math.abs(pts[j].x - x) > 0.5));
        if (!free.length) continue;
        const was = pts[i].x;
        pts[i].x = free.reduce((b, x) => (Math.abs(x - was) < Math.abs(b - was) ? x : b), free[0]);
        if (!ids.every((j) => j === i || clear(i, j))) pts[i].x = was;
    }
    return pts;
}
