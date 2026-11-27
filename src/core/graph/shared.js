// @ts-check
// shared.js: geometry the graph layouts have in common. Everything here works in
// pixels on node boxes `{ cx, cy, hw, hh }` (centre and half sizes).

/**
 * @typedef {{ cx: number, cy: number, hw: number, hh: number }} Box
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * Push overlapping boxes apart along the axis of least overlap, until each pair
 * keeps `gap` px clear or the passes run out. `weight(i)` is how readily box `i`
 * moves: 0 holds it still. With `walls`, a box that moves stays inside them.
 * Changes `pos` in place.
 * @param {Box[]} boxes the sizes
 * @param {Point[]} pos the centres to move
 * @param {number} gap
 * @param {(i: number) => number} [weight]
 * @param {{ width: number, height: number } | null} [walls]
 * @param {number} [passes]
 */
export function removeOverlaps(boxes, pos, gap, weight = () => 1, walls = null, passes = 200) {
    const n = boxes.length;
    /** @param {number} i */
    const inside = (i) => {
        if (!walls || !weight(i)) return;
        const p = pos[i], b = boxes[i];
        p.x = Math.min(Math.max(p.x, b.hw), Math.max(b.hw, walls.width - b.hw));
        p.y = Math.min(Math.max(p.y, b.hh), Math.max(b.hh, walls.height - b.hh));
    };
    for (let i = 0; i < n; i++) if (pos[i]) inside(i);
    for (let pass = 0; pass < passes; pass++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
            if (!pos[i]) continue;
            for (let j = i + 1; j < n; j++) {
                if (!pos[j]) continue;
                const a = pos[i], b = pos[j];
                const dx = b.x - a.x, dy = b.y - a.y;
                const ox = boxes[i].hw + boxes[j].hw + gap - Math.abs(dx);
                const oy = boxes[i].hh + boxes[j].hh + gap - Math.abs(dy);
                if (ox <= 0.01 || oy <= 0.01) continue;
                const wa = weight(i), wb = weight(j);
                if (wa + wb <= 0) continue;
                const fa = wa / (wa + wb), fb = wb / (wa + wb);
                if (ox < oy) {
                    const s = dx === 0 ? 1 : Math.sign(dx);
                    a.x -= s * ox * fa; b.x += s * ox * fb;
                } else {
                    const s = dy === 0 ? 1 : Math.sign(dy);
                    a.y -= s * oy * fa; b.y += s * oy * fb;
                }
                inside(i);
                inside(j);
                moved = true;
            }
        }
        if (!moved) return;
    }
}

/**
 * The ordered positions closest to `targets` (weighted least squares) that keep
 * each neighbour pair at least `seps[k]` apart: isotonic regression by pooling
 * adjacent violators.
 * @param {number[]} targets
 * @param {number[]} weights
 * @param {number[]} seps seps[k] is the least distance from item k to item k + 1
 * @returns {number[]}
 */
export function placeInOrder(targets, weights, seps) {
    /** @type {number[]} */
    const off = [0];
    for (let i = 1; i < targets.length; i++) off[i] = off[i - 1] + seps[i - 1];
    /** @type {{ v: number, w: number, n: number }[]} */
    const blocks = [];
    targets.forEach((t, i) => {
        blocks.push({ v: t - off[i], w: weights[i], n: 1 });
        while (blocks.length > 1 && blocks[blocks.length - 2].v > blocks[blocks.length - 1].v) {
            const b = /** @type {any} */ (blocks.pop()), a = /** @type {any} */ (blocks.pop());
            blocks.push({ v: (a.v * a.w + b.v * b.w) / (a.w + b.w), w: a.w + b.w, n: a.n + b.n });
        }
    });
    /** @type {number[]} */
    const out = [];
    for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.v + off[out.length]);
    return out;
}

/**
 * The centre of the boxes at `pos` (the middle of their bounding box).
 * @param {Box[]} boxes
 * @param {(Point | null)[]} pos
 * @param {(i: number) => boolean} [which]
 * @returns {Point | null}
 */
export function middleOf(boxes, pos, which = () => true) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pos.forEach((p, i) => {
        if (!p || !which(i)) return;
        x0 = Math.min(x0, p.x - boxes[i].hw); x1 = Math.max(x1, p.x + boxes[i].hw);
        y0 = Math.min(y0, p.y - boxes[i].hh); y1 = Math.max(y1, p.y + boxes[i].hh);
    });
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : null;
}

/** The four ways a layered drawing can run. */
export const DIRECTIONS = ['down', 'right', 'up', 'left'];

/**
 * Turn boxes and points into the frame where the drawing runs down the page, and
 * back. `right` swaps the axes, `up` flips y, `left` does both.
 * @param {string} direction
 */
export function frameOf(direction) {
    const swap = direction === 'right' || direction === 'left';
    const flip = direction === 'up' || direction === 'left';
    return {
        /** @param {Box} b @returns {Box} */
        box: (b) => (swap ? { cx: b.cy, cy: flip ? -b.cx : b.cx, hw: b.hh, hh: b.hw } : { cx: b.cx, cy: flip ? -b.cy : b.cy, hw: b.hw, hh: b.hh }),
        /** @param {Point} p @returns {Point} */
        back: (p) => (swap ? { x: flip ? -p.y : p.y, y: p.x } : { x: p.x, y: flip ? -p.y : p.y }),
    };
}
