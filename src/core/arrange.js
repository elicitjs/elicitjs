// arrange.js — slot layouts for a container's contents (`contains: { arrange }`).
// Each takes the children in order, as boxes ({ hw, hh }), and returns where each
// one's centre goes, in pixels. Pure: no rows, no scales.
//   row     left to right, wrapping at `limit` (the inner width) when there is one
//   column  top to bottom, wrapping at `limit` (the inner height) when there is one
//   grid    equal cells, the size of the largest child, `columns` to a row
//   pack    circles kept where they are, moved only to touch the group and not
//           overlap; no order (the others read their order from position)

/** The arrangements a container may state. `dodge` and `free` place nothing. */
export const ARRANGEMENTS = ['dodge', 'free', 'row', 'column', 'grid', 'pack'];

/** The arrangements that put children in slots. */
export const SLOTTED = ['row', 'column', 'grid', 'pack'];

/**
 * @typedef {{ hw: number, hh: number }} Item
 * @typedef {{ x: number, y: number }} Point
 * @typedef {object} SlotOptions
 * @property {string} arrange  one of SLOTTED
 * @property {number} gap  px between neighbours
 * @property {number | null} [columns]  grid only
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

// ── pack: circles kept where they are, each touching the group ──

/** @typedef {{ x: number, y: number, r: number }} Circle */

/** Put c tangent to both a and b, on one side. @param {Circle} b @param {Circle} a @param {Circle} c */
function place(b, a, c) {
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
    if (!d2) { c.x = a.x + a.r + c.r; c.y = a.y; return; }
    const a2 = (a.r + c.r) ** 2, b2 = (b.r + c.r) ** 2;
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

/** How far two circles overlap (negative when apart). @param {Circle} a @param {Circle} b */
const overlap = (a, b) => a.r + b.r - Math.hypot(b.x - a.x, b.y - a.y);
/** Overlap below this is touching. */
const TOUCH = 1e-3;
/** A gap below this still counts as touching. */
const NEAR = 0.5;
/** How many placed circles nearest the target are tried as neighbours. */
const NEIGHBOURS = 12;

/**
 * The free spot nearest `to` where a circle of radius `r` touches the placed ones.
 * @param {Circle[]} placed @param {number} r @param {{ x: number, y: number }} to
 * @param {{ x: number, y: number }} centre @param {number} k  for a direction when `to` sits on a centre
 * @returns {{ x: number, y: number }}
 */
function freeSpot(placed, r, to, centre, k) {
    const free = (/** @type {Circle} */ c) => placed.every((p) => overlap(p, c) < TOUCH);
    const near = [...placed].sort((a, b) => Math.hypot(a.x - to.x, a.y - to.y) - Math.hypot(b.x - to.x, b.y - to.y))
        .slice(0, NEIGHBOURS);
    /** @type {Circle[]} */
    const spots = [];
    for (const a of near) {
        let dx = to.x - a.x, dy = to.y - a.y, d = Math.hypot(dx, dy);
        if (d < 1e-6) { dx = Math.cos(k * 2.39996); dy = Math.sin(k * 2.39996); d = 1; }
        spots.push({ x: a.x + (dx / d) * (a.r + r), y: a.y + (dy / d) * (a.r + r), r });
    }
    for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
            const a = near[i], b = near[j];
            if (Math.hypot(b.x - a.x, b.y - a.y) > a.r + b.r + 2 * r) continue;
            const c1 = { x: 0, y: 0, r }, c2 = { x: 0, y: 0, r };
            place(b, a, c1);
            place(a, b, c2);
            spots.push(c1, c2);
        }
    }
    let best = null, bestD = Infinity;
    for (const c of spots) {
        const d = Math.hypot(c.x - to.x, c.y - to.y);
        if (d < bestD && free(c)) { best = c; bestD = d; }
    }
    if (best) return best;
    // Hemmed in: out from the centre, past everything in the way.
    let dx = to.x - centre.x, dy = to.y - centre.y, d = Math.hypot(dx, dy);
    if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
    const c = { x: to.x, y: to.y, r };
    for (let step = 0; step < 1000 && !free(c); step++) {
        c.x += (dx / d) * r * 0.5;
        c.y += (dy / d) * r * 0.5;
    }
    return c;
}

/**
 * Pack items as circles (a box takes the circle round it), \`gap\` apart edge to
 * edge. A circle stays where it is when it overlaps nothing and touches the group;
 * otherwise it moves to the free spot nearest it that does. So a packed group is
 * left alone, and a moved item lands next to where it was put. Items marked
 * \`moved\` are placed last, so they give way.
 * @param {(Item & { round?: boolean, cx: number, cy: number, moved?: boolean })[]} items
 * @param {number} gap
 * @returns {Point[]}
 */
function pack(items, gap) {
    const n = items.length;
    /** @type {Circle[]} */
    const circles = items.map((m) => ({
        x: m.cx, y: m.cy,
        r: (m.round ? Math.max(m.hw, m.hh) : Math.hypot(m.hw, m.hh)) + gap / 2,
    }));
    if (n < 1) return [];
    const stay = circles.map((_, k) => !items[k].moved);
    const ofStay = circles.filter((_, k) => stay[k]);
    const from = ofStay.length ? ofStay : circles;
    const centre = { x: from.reduce((s, c) => s + c.x, 0) / from.length, y: from.reduce((s, c) => s + c.y, 0) / from.length };
    const toCentre = (/** @type {number} */ k) => Math.hypot(circles[k].x - centre.x, circles[k].y - centre.y);
    /** @type {Circle[]} */
    const placed = [];
    const left = new Set(circles.map((_, k) => k));
    const touches = (/** @type {Circle} */ c) => placed.some((p) => overlap(p, c) > -NEAR);
    // Through the group by contact, from the circle nearest its centre, so one that
    // already touches a placed one is kept where it is.
    for (let count = 0; count < n; count++) {
        const pool = [...left].filter((k) => stay[k]);
        const from = pool.length ? pool : [...left];
        const touching = from.filter((k) => touches(circles[k]));
        const k = (touching.length ? touching : from).reduce((a, b) => (toCentre(b) < toCentre(a) - 1e-9 ? b : a));
        left.delete(k);
        const c = circles[k];
        if (placed.length && !(touches(c) && placed.every((p) => overlap(p, c) < TOUCH))) {
            const at = freeSpot(placed, c.r, c, centre, k);
            c.x = at.x;
            c.y = at.y;
        }
        placed.push(c);
    }
    return circles.map((c) => ({ x: c.x, y: c.y }));
}

/**
 * Where each item's centre goes, in order. Pack reads where each item is now
 * (\`cx\`, \`cy\`) and whether it was just \`moved\`.
 * @param {(Item & { round?: boolean, cx?: number, cy?: number, moved?: boolean })[]} items
 * @param {SlotOptions} options
 * @returns {Point[]}
 */
export function slotsOf(items, { arrange, gap, columns = null, origin, limit }) {
    if (arrange === 'row') return flow(items, 'x', gap, origin, limit.x);
    if (arrange === 'column') return flow(items, 'y', gap, origin, limit.y);
    if (arrange === 'grid') return grid(items, gap, columns, origin, limit.x);
    return pack(/** @type {any} */ (items), gap);
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
