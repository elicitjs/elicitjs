// arrange.js — slot layouts for a container's contents (`contains: { arrange }`).
// Each takes the children in order, as boxes ({ hw, hh }), and returns where each
// one's centre goes, in pixels. Pure: no rows, no scales.
//   row     left to right, wrapping at `limit` (the inner width) when there is one
//   column  top to bottom, wrapping at `limit` (the inner height) when there is one
//   grid    equal cells, the size of the largest child, `columns` to a row
//   pack    kept where they are, moved only to touch the group and not overlap;
//           boxes pack as boxes, round children as circles. `keep` says how a
//           child moves in: to the nearest spot, or along its angle from the
//           middle. No order (the others read their order from position)

/** The arrangements a container may state. `dodge` and `free` place nothing. */
export const ARRANGEMENTS = ['dodge', 'free', 'row', 'column', 'grid', 'pack'];

/** The arrangements that put children in slots. */
export const SLOTTED = ['row', 'column', 'grid', 'pack'];

/** What a pack keeps as a child moves in to touch the others. */
export const KEEPS = ['distance', 'angle'];

/**
 * @typedef {{ hw: number, hh: number }} Item
 * @typedef {{ x: number, y: number }} Point
 * @typedef {object} SlotOptions
 * @property {string} arrange  one of SLOTTED
 * @property {number} gap  px between neighbours
 * @property {number | null} [columns]  grid only
 * @property {'angle' | 'distance'} [keep]  pack only
 * @property {Point} origin  the inner top-left (row, column, grid; pack has none)
 * @property {{ x: number | null, y: number | null }} limit  the room along each
 *   axis, or null where the container grows
 */

/**
 * Lay items out in lines along one axis, starting a new line when the next one
 * would pass `limit`. Lines line up at their start.
 * @param {Item[]} items @param {'x' | 'y'} axis @param {number} gap
 * @param {Point} origin @param {number | null} limit
 * @returns {Point[]}
 */
function flow(items, axis, gap, origin, limit) {
    const along = axis === 'x' ? 'hw' : 'hh';
    const across = axis === 'x' ? 'hh' : 'hw';
    /** @type {Point[]} */
    const out = [];
    let at = 0, line = 0, thick = 0;
    for (const item of items) {
        const len = 2 * item[along];
        if (at > 0 && limit != null && at + len > limit + 0.01) {
            line += thick + gap;
            at = 0;
            thick = 0;
        }
        const main = at + item[along];
        const cross = line + item[across];
        out.push(axis === 'x' ? { x: origin.x + main, y: origin.y + cross } : { x: origin.x + cross, y: origin.y + main });
        at += len + gap;
        thick = Math.max(thick, 2 * item[across]);
    }
    return out;
}

/**
 * Equal cells in reading order. With no `columns`, as many as fit the width, else
 * the smallest square grid.
 * @param {Item[]} items @param {number} gap @param {number | null | undefined} columns
 * @param {Point} origin @param {number | null} limitX
 * @returns {Point[]}
 */
function grid(items, gap, columns, origin, limitX) {
    const cw = 2 * Math.max(0, ...items.map((m) => m.hw));
    const ch = 2 * Math.max(0, ...items.map((m) => m.hh));
    let n = columns && columns > 0 ? Math.floor(columns) : 0;
    if (!n) n = limitX != null ? Math.floor((limitX + gap) / (cw + gap)) : Math.ceil(Math.sqrt(items.length));
    n = Math.max(1, n);
    return items.map((_, k) => ({
        x: origin.x + (k % n) * (cw + gap) + cw / 2,
        y: origin.y + Math.floor(k / n) * (ch + gap) + ch / 2,
    }));
}

// ── pack: drawn together where they are, touching ──
// Each child is a shape: a circle when every child is round, else its own box.
// A placed shape `p` bars a moving shape `s` from the region round `p` that
// their sizes add up to; `s` touches the group on that region's edge.

/**
 * @typedef {{ x: number, y: number, r: number, hw: number, hh: number }} Shape
 * @typedef {object} Kind
 * @property {(a: Shape, b: Shape) => number} depth  how far two shapes overlap (negative when apart)
 * @property {(near: Shape[], s: Shape, to: Point, k: number) => Point[]} spots
 *   places where `s` touches one of `near`, nearest `to` first among each
 * @property {(o: Point, u: Point, p: Shape, s: Shape) => [number, number] | null} ray
 *   the stretch of the ray `o + t·u` along which `s` would overlap `p`
 */

/** Overlap below this is touching. */
const TOUCH = 1e-3;
/** A gap below this still counts as touching. */
const NEAR = 0.5;
/** How many placed shapes nearest the target are tried as neighbours. */
const NEIGHBOURS = 12;
/** A turn by the golden angle, for a direction when two centres coincide. */
const spin = (/** @type {number} */ k) => ({ x: Math.cos(k * 2.39996), y: Math.sin(k * 2.39996) });

/** Put c tangent to both a and b, on one side. @param {Shape} b @param {Shape} a @param {Point} c @param {number} r */
function tangent(b, a, c, r) {
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
    if (!d2) { c.x = a.x + a.r + r; c.y = a.y; return; }
    const a2 = (a.r + r) ** 2, b2 = (b.r + r) ** 2;
    if (a2 > b2) {
        const x = (d2 + b2 - a2) / (2 * d2);
        const y = Math.sqrt(Math.max(0, b2 / d2 - x * x));
        c.x = b.x - x * dx - y * dy;
        c.y = b.y - x * dy + y * dx;
    } else {
        const x = (d2 + a2 - b2) / (2 * d2);
        const y = Math.sqrt(Math.max(0, a2 / d2 - x * x));
        c.x = a.x + x * dx - y * dy;
        c.y = a.y + x * dy + y * dx;
    }
}

/** @type {Kind} */
const ROUND = {
    depth: (a, b) => a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y),
    // Straight out from each neighbour towards `to`, and tangent to each pair.
    spots(near, s, to, k) {
        /** @type {Point[]} */
        const out = [];
        for (const a of near) {
            let dx = to.x - a.x, dy = to.y - a.y, d = Math.hypot(dx, dy);
            if (d < 1e-6) { const v = spin(k); dx = v.x; dy = v.y; d = 1; }
            out.push({ x: a.x + (dx / d) * (a.r + s.r), y: a.y + (dy / d) * (a.r + s.r) });
        }
        for (let i = 0; i < near.length; i++) {
            for (let j = i + 1; j < near.length; j++) {
                const a = near[i], b = near[j];
                if (Math.hypot(b.x - a.x, b.y - a.y) > a.r + b.r + 2 * s.r) continue;
                const c1 = { x: 0, y: 0 }, c2 = { x: 0, y: 0 };
                tangent(b, a, c1, s.r);
                tangent(a, b, c2, s.r);
                out.push(c1, c2);
            }
        }
        return out;
    },
    ray(o, u, p, s) {
        const R = p.r + s.r, wx = o.x - p.x, wy = o.y - p.y;
        const b = u.x * wx + u.y * wy, disc = b * b - (wx * wx + wy * wy - R * R);
        if (disc <= 0) return null;
        const sq = Math.sqrt(disc);
        return [-b - sq, -b + sq];
    },
};

/** @type {Kind} */
const BOX = {
    depth: (a, b) => Math.min(a.hw + b.hw - Math.abs(b.x - a.x), a.hh + b.hh - Math.abs(b.y - a.y)),
    // The point on each neighbour's edge nearest `to`, and each corner where two
    // neighbours' edges cross (a pocket between them).
    spots(near, s, to) {
        /** @type {Point[]} */
        const out = [];
        const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));
        const edges = near.map((p) => ({
            x0: p.x - p.hw - s.hw, x1: p.x + p.hw + s.hw,
            y0: p.y - p.hh - s.hh, y1: p.y + p.hh + s.hh,
        }));
        for (const e of edges) {
            const y = clamp(to.y, e.y0, e.y1), x = clamp(to.x, e.x0, e.x1);
            out.push({ x: e.x0, y }, { x: e.x1, y }, { x, y: e.y0 }, { x, y: e.y1 });
        }
        for (const a of edges) {
            for (const b of edges) {
                if (a === b) continue;
                // a's sides (vertical) across b's top and bottom (horizontal)
                for (const x of [a.x0, a.x1]) {
                    if (x < b.x0 || x > b.x1) continue;
                    for (const y of [b.y0, b.y1]) if (y >= a.y0 && y <= a.y1) out.push({ x, y });
                }
            }
        }
        return out;
    },
    ray(o, u, p, s) {
        let lo = -Infinity, hi = Infinity;
        for (const [c, d, h] of /** @type {[number, number, number][]} */ ([[o.x - p.x, u.x, p.hw + s.hw], [o.y - p.y, u.y, p.hh + s.hh]])) {
            if (Math.abs(d) < 1e-12) {
                if (Math.abs(c) >= h) return null;
                continue;
            }
            const t1 = (-h - c) / d, t2 = (h - c) / d;
            lo = Math.max(lo, Math.min(t1, t2));
            hi = Math.min(hi, Math.max(t1, t2));
        }
        return lo < hi ? [lo, hi] : null;
    },
};

/**
 * The free spot nearest `to` where `s` touches the placed shapes.
 * @param {Kind} kind @param {Shape[]} placed @param {Shape} s @param {Point} centre
 * @param {number} k  for a direction when `s` sits on a centre
 * @returns {Point}
 */
function freeSpot(kind, placed, s, centre, k) {
    const free = (/** @type {Point} */ at) => placed.every((p) => kind.depth(p, { ...s, ...at }) < TOUCH);
    const byDistance = [...placed].sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y));
    // The nearest neighbours first; when they are hemmed in, all of them.
    for (const near of [byDistance.slice(0, NEIGHBOURS), byDistance.slice(NEIGHBOURS).length ? byDistance : []]) {
        let best = null, bestD = Infinity;
        for (const at of kind.spots(near, s, s, k)) {
            const d = Math.hypot(at.x - s.x, at.y - s.y);
            if (d < bestD && free(at)) { best = at; bestD = d; }
        }
        if (best) return best;
    }
    // Hemmed in: out from the centre, past everything in the way.
    let dx = s.x - centre.x, dy = s.y - centre.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
    const step = 0.5 * Math.max(s.r, Math.min(s.hw, s.hh), 1);
    const at = { x: s.x, y: s.y };
    for (let n = 0; n < 1000 && !free(at); n++) {
        at.x += (dx / d) * step;
        at.y += (dy / d) * step;
    }
    return at;
}

/**
 * Where `s` touches the placed shapes on the ray from `o` through it, nearest
 * where it is now. Some spot always exists: past the last one the ray crosses.
 * @param {Kind} kind @param {Shape[]} placed @param {Shape} s @param {Point} o
 * @param {number} k  for a direction when `s` sits on `o`
 * @returns {Point}
 */
function alongRay(kind, placed, s, o, k) {
    const t0 = Math.hypot(s.x - o.x, s.y - o.y);
    const u = t0 < 1e-6 ? spin(k) : { x: (s.x - o.x) / t0, y: (s.y - o.y) / t0 };
    const at = (/** @type {number} */ t) => ({ x: o.x + t * u.x, y: o.y + t * u.y });
    /** @type {number[]} */
    const ts = [];
    for (const p of placed) {
        const span = kind.ray(o, u, p, s);
        if (!span) continue;
        if (span[0] > 0) ts.push(span[0]);
        if (span[1] > 0) ts.push(span[1]);
    }
    let best = null, bestD = Infinity;
    for (const t of ts) {
        const c = at(t);
        if (Math.abs(t - t0) < bestD && placed.every((p) => kind.depth(p, { ...s, ...c }) < TOUCH)) {
            best = c;
            bestD = Math.abs(t - t0);
        }
    }
    return best || at(Math.max(t0, ...ts));
}

/**
 * Pack items together, `gap` apart edge to edge. Every child is a circle when all
 * are round, else its own box. An item stays where it is when it overlaps nothing
 * and touches the group; otherwise it moves to touch it, by `keep`:
 *   distance  to the free spot nearest it
 *   angle     along the line from the middle item through it, so its direction
 *             from the middle stays the same
 * So a packed group is left alone. Items marked `moved` are placed last, so they
 * give way.
 * @param {(Item & { round?: boolean, cx: number, cy: number, moved?: boolean })[]} items
 * @param {number} gap
 * @param {'angle' | 'distance'} keep
 * @returns {Point[]}
 */
function pack(items, gap, keep) {
    const n = items.length;
    if (n < 1) return [];
    const round = items.every((m) => m.round);
    const kind = round ? ROUND : BOX;
    /** @type {Shape[]} */
    const shapes = items.map((m) => ({
        x: m.cx, y: m.cy,
        r: Math.max(m.hw, m.hh) + gap / 2,
        hw: m.hw + gap / 2, hh: m.hh + gap / 2,
    }));
    const stay = items.map((m) => !m.moved);
    const ofStay = shapes.filter((_, k) => stay[k]);
    const from = ofStay.length ? ofStay : shapes;
    const centre = { x: from.reduce((s, c) => s + c.x, 0) / from.length, y: from.reduce((s, c) => s + c.y, 0) / from.length };
    const toCentre = (/** @type {number} */ k) => Math.hypot(shapes[k].x - centre.x, shapes[k].y - centre.y);
    /** @type {Shape[]} */
    const placed = [];
    const left = new Set(shapes.map((_, k) => k));
    const touches = (/** @type {Shape} */ s) => placed.some((p) => kind.depth(p, s) > -NEAR);
    const free = (/** @type {Shape} */ s) => placed.every((p) => kind.depth(p, s) < TOUCH);
    // The middle item: the one an angle is read from.
    /** @type {Point | null} */
    let middle = null;
    // Through the group by contact, from the item nearest its centre, so one that
    // already touches a placed one is kept where it is.
    for (let count = 0; count < n; count++) {
        const pool = [...left].filter((k) => stay[k]);
        const choice = pool.length ? pool : [...left];
        const touching = choice.filter((k) => touches(shapes[k]));
        // By angle, inside out from the middle; by distance, touching ones first.
        /** @type {Point | null} */
        const mid = keep === 'angle' ? middle : null;
        const near = (/** @type {number} */ k) => (mid ? Math.hypot(shapes[k].x - mid.x, shapes[k].y - mid.y) : toCentre(k));
        /** @type {number} */
        const k = (mid || !touching.length ? choice : touching).reduce((a, b) => (near(b) < near(a) - 1e-9 ? b : a));
        left.delete(k);
        /** @type {Shape} */
        const s = shapes[k];
        if (placed.length && !(touches(s) && free(s))) {
            const at = keep === 'angle' && middle ? alongRay(kind, placed, s, middle, k) : freeSpot(kind, placed, s, centre, k);
            s.x = at.x;
            s.y = at.y;
        }
        if (!middle) middle = { x: s.x, y: s.y };
        placed.push(s);
    }
    return shapes.map((s) => ({ x: s.x, y: s.y }));
}

/**
 * Where each item's centre goes, in order. Pack reads where each item is now
 * (`cx`, `cy`) and whether it was just `moved`.
 * @param {(Item & { round?: boolean, cx?: number, cy?: number, moved?: boolean })[]} items
 * @param {SlotOptions} options
 * @returns {Point[]}
 */
export function slotsOf(items, { arrange, gap, columns = null, keep = 'distance', origin, limit }) {
    if (arrange === 'row') return flow(items, 'x', gap, origin, limit.x);
    if (arrange === 'column') return flow(items, 'y', gap, origin, limit.y);
    if (arrange === 'grid') return grid(items, gap, columns, origin, limit.x);
    return pack(/** @type {any} */ (items), gap, keep);
}

/**
 * The index a moved item takes among the others: the slot nearest its centre.
 * Tries each place in turn. For row, column and grid; pack has no order.
 * @param {(Item & { round?: boolean })[]} others  in order
 * @param {Item & { round?: boolean, cx: number, cy: number }} item
 * @param {SlotOptions} options
 * @returns {number}
 */
export function nearestSlot(others, item, options) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k <= others.length; k++) {
        const order = [...others.slice(0, k), item, ...others.slice(k)];
        const at = slotsOf(order, options)[k];
        const d = Math.hypot(at.x - item.cx, at.y - item.cy);
        if (d < bestD - 0.01) { best = k; bestD = d; }
    }
    return best;
}

/**
 * The order of children that did not move: as they sit, read along the
 * arrangement's flow.
 * @param {string} arrange
 * @param {boolean} wraps  whether a row or column breaks into lines
 * @returns {(a: { cx: number, cy: number, hw: number, hh: number }, b: { cx: number, cy: number, hw: number, hh: number }) => number}
 */
export function readingOrder(arrange, wraps) {
    const near = (/** @type {number} */ d) => (Math.abs(d) < 0.5 ? 0 : d);
    if (arrange === 'row') {
        return wraps ? (a, b) => near((a.cy - a.hh) - (b.cy - b.hh)) || (a.cx - b.cx) : (a, b) => a.cx - b.cx;
    }
    if (arrange === 'column') {
        return wraps ? (a, b) => near((a.cx - a.hw) - (b.cx - b.hw)) || (a.cy - b.cy) : (a, b) => a.cy - b.cy;
    }
    return (a, b) => near(a.cy - b.cy) || (a.cx - b.cx);
}
