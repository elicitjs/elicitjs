// fit.js — settles a hierarchy's geometry after every commit and for outside data.
// A container's box follows from its children (`contains`, `fit: true`). Results
// are written into the data through the channels' own scales, so no mark changes
// and `getData()` reports the fitted geometry. Steps, in order:
//   PLACE  a nested row with no position gets one inside its container
//   CARRY  a container the commit moved takes its subtree by the same pixel delta
//   SPACE  bottom-up, an unfitted container keeps its contents inside its padding.
//          Its `arrange` decides the rest: `dodge` rows are pushed apart, `free`
//          rows stay put, a row, column or grid puts its children in slots in
//          order, and a pack draws them together where they are (core/arrange.js)
//   FIT    in the same walk, a fitted container takes its children's union, padded.
//          One that just lost its last child takes its columns' schema `default`

import { scaleFor } from './scales.js';
import { treeOf, nestingOf } from './hierarchy.js';
import { SLOTTED, slotsOf, nearestSlot, readingOrder } from './arrange.js';
import { warn } from './dev.js';

/** Padding between a container's edge and its contents, when `contains` states none. */
const DEFAULT_PADDING = 10;

/** How far apart PLACE staggers siblings that arrive with no position, in px. */
const PLACE_STEP = 18;

/** Below this many pixels a fitted value is the one already there (no write). */
const EPSILON = 0.01;

/** The gap `dodge` keeps between two rows when it states none, in px. */
export const DEFAULT_GAP = 8;

/** How many rounds of pushing apart one group gets before it is left as it stands. */
const DODGE_PASSES = 40;

/** Above this many dodging siblings, an overlap the pushing leaves is not re-packed. */
const PACK_LIMIT = 80;

/**
 * @typedef {{ cx: number, cy: number, hw: number, hh: number, x0: number, y0: number, gap: number | null, rank: number, round: boolean, guest?: boolean, holds?: boolean }} Spaced
 * @typedef {{ x: boolean, y: boolean, x0: number, x1: number, y0: number, y1: number } | null} Bounds
 */

/** Would two dodging rows at these centres sit closer than their gap?
 *  @param {Spaced} a @param {Spaced} b @param {number} ax @param {number} ay @param {number} bx @param {number} by */
function collides(a, b, ax, ay, bx, by) {
    const gap = Math.max(a.gap || 0, b.gap || 0);
    // Two circles are clear by the distance between their centres.
    if (a.round && b.round) return Math.hypot(ax - bx, ay - by) < a.hw + b.hw + gap - EPSILON;
    return Math.abs(ax - bx) < a.hw + b.hw + gap - EPSILON && Math.abs(ay - by) < a.hh + b.hh + gap - EPSILON;
}

/** Is a centre inside the walls along one axis? A row wider than the room sits in its middle.
 *  @param {number} c @param {number} half @param {number} lo @param {number} hi */
function insideWalls(c, half, lo, hi) {
    if (lo + half > hi - half) return Math.abs(c - (lo + hi) / 2) < EPSILON;
    return c - half >= lo - EPSILON && c + half <= hi + EPSILON;
}

/**
 * Place rows one at a time, each at the cheapest spot clear of the rows placed so
 * far and of the locked rows. The spots tried are the row's own position, the walls,
 * and flush against each placed row. Returns null when a row has nowhere to go.
 * @param {Spaced[]} movers every dodging sibling (locked ones are obstacles)
 * @param {Bounds} bounds
 * @param {Spaced[]} order the rows to place
 * @param {(m: Spaced, x: number, y: number) => number} cost
 * @param {(a: Spaced, b: Spaced) => boolean} [passes] pairs that may overlap
 * @returns {Map<Spaced, { x: number, y: number }> | null}
 */
function pack(movers, bounds, order, cost, passes) {
    /** @type {{ m: Spaced, x: number, y: number }[]} */
    const placed = movers.filter((m) => m.rank === 2).map((m) => ({ m, x: m.cx, y: m.cy }));
    /** @type {Map<Spaced, { x: number, y: number }>} */
    const out = new Map();
    for (const m of order) {
        const xs = new Set([m.x0]), ys = new Set([m.y0]);
        if (bounds && bounds.x) [bounds.x0 + m.hw, bounds.x1 - m.hw, (bounds.x0 + bounds.x1) / 2].forEach((v) => xs.add(v));
        if (bounds && bounds.y) [bounds.y0 + m.hh, bounds.y1 - m.hh, (bounds.y0 + bounds.y1) / 2].forEach((v) => ys.add(v));
        for (const p of placed) {
            const gap = Math.max(m.gap || 0, p.m.gap || 0);
            xs.add(p.x - p.m.hw - m.hw - gap); xs.add(p.x + p.m.hw + m.hw + gap);
            ys.add(p.y - p.m.hh - m.hh - gap); ys.add(p.y + p.m.hh + m.hh + gap);
        }
        /** @type {{ x: number, y: number, c: number } | null} */
        let best = null;
        for (const x of xs) {
            if (bounds && bounds.x && !insideWalls(x, m.hw, bounds.x0, bounds.x1)) continue;
            for (const y of ys) {
                if (bounds && bounds.y && !insideWalls(y, m.hh, bounds.y0, bounds.y1)) continue;
                const c = cost(m, x, y);
                if (best && c >= best.c) continue;
                if (placed.some((p) => !(passes && passes(m, p.m)) && collides(m, p.m, x, y, p.x, p.y))) continue;
                best = { x, y, c };
            }
        }
        if (!best) return null;
        placed.push({ m, x: best.x, y: best.y });
        out.set(m, { x: best.x, y: best.y });
    }
    return out;
}

/**
 * A container's padding as four sides: `contains: { padding }` is a number or
 * `{ top, right, bottom, left }` (a missing side takes the default).
 * @param {any} contains the mark's `contains` channel
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
function paddingOf(contains) {
    const p = contains ? contains.padding : undefined;
    const side = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : DEFAULT_PADDING);
    if (p && typeof p === 'object') {
        return { top: side(p.top), right: side(p.right), bottom: side(p.bottom), left: side(p.left) };
    }
    const all = side(p);
    return { top: all, right: all, bottom: all, left: all };
}

/**
 * How a container arranges its contents: `contains: { arrange, gap, columns }`.
 * The engine has already checked `arrange` (engine/features.js).
 * @param {any} contains the mark's `contains` channel
 * @returns {{ arrange: string, gap: number, columns: number | null }}
 */
function arrangeOf(contains) {
    const c = contains || {};
    return {
        arrange: typeof c.arrange === 'string' ? c.arrange : 'dodge',
        gap: typeof c.gap === 'number' && Number.isFinite(c.gap) ? Math.max(0, c.gap) : DEFAULT_GAP,
        columns: typeof c.columns === 'number' && c.columns >= 1 ? Math.floor(c.columns) : null,
    };
}

/**
 * Which component of a container's box each channel receives: `inner` is the union
 * of the children's boxes, `pad` the padding by side in px. A mark gains a fittable
 * channel by a row here. A round shape takes the circle/ellipse that encloses the
 * union's rectangle.
 * @typedef {{ top: number, right: number, bottom: number, left: number }} Sides
 * @type {Record<string, (inner: { cx: number, cy: number, hw: number, hh: number }, pad: Sides) => number>}
 */
const FIT_OF = {
    x: (b, p) => b.cx + (p.right - p.left) / 2,
    y: (b, p) => b.cy + (p.bottom - p.top) / 2,
    width: (b, p) => 2 * b.hw + p.left + p.right,
    height: (b, p) => 2 * b.hh + p.top + p.bottom,
    size: (b, p) => Math.hypot(b.hw + Math.abs(p.right - p.left) / 2, b.hh + Math.abs(p.bottom - p.top) / 2)
        + Math.min(p.top, p.right, p.bottom, p.left),
    rx: (b, p) => (b.hw + Math.abs(p.right - p.left) / 2) * Math.SQRT2 + Math.min(p.left, p.right),
    ry: (b, p) => (b.hh + Math.abs(p.bottom - p.top) / 2) * Math.SQRT2 + Math.min(p.top, p.bottom),
    x1: (b, p) => b.cx - b.hw - p.left,
    x2: (b, p) => b.cx + b.hw + p.right,
    y1: (b, p) => b.cy - b.hh - p.top,
    y2: (b, p) => b.cy + b.hh + p.bottom,
};

/** The channels that state a box's extent; a fitted one pulls the centre with it. */
const EXTENT_AXIS = { width: 'x', size: 'xy', rx: 'x', height: 'y', ry: 'y' };

/** The channels whose fit decides a box's extent along each pixel axis. */
const FITS_AXIS = { x: ['width', 'size', 'rx', 'x1', 'x2'], y: ['height', 'size', 'ry', 'y1', 'y2'] };

/** The channels a CARRY shifts, by the pointer axis each runs along. */
const POSITION_CHANNELS = { x: ['x', 'x1', 'x2'], y: ['y', 'y1', 'y2'] };

/**
 * The channels of one mark that the fit writes for a container row: every channel
 * marked `fit: true`, plus the centre (`x`/`y`) along any axis whose extent is
 * fitted — a box sized to its contents but left where it was would not cover them.
 * @param {Record<string, any>} channels
 * @returns {string[]}
 */
export function fitChannelsOf(channels) {
    const out = new Set();
    for (const [name, spec] of Object.entries(channels || {})) {
        if (!spec || spec.fit !== true || !FIT_OF[name]) continue;
        out.add(name);
        const axis = /** @type {Record<string, string>} */ (EXTENT_AXIS)[name];
        if (axis) for (const a of axis) if (channels[a]) out.add(a);
    }
    return [...out];
}

/**
 * A channel's current pixel value for a row, and how to turn a pixel back into the
 * column's units — or null when the channel names no column, or its scale cannot be
 * run backwards (a band). `scale: null` is a column already in pixels.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} name
 * @returns {{ field: string, encode: (v: any) => number, invert: (px: number) => any } | null}
 */
function channelIO(scales, channels, name) {
    const spec = channels && channels[name];
    if (!spec || spec.field == null) return null;
    if (spec.scale === null) {
        return { field: spec.field, encode: (v) => +v, invert: (px) => px };
    }
    const scale = scaleFor(scales, name, spec.field);
    if (!scale || !scale.invertible || typeof scale.invertValue !== 'function') return null;
    return { field: spec.field, encode: (v) => scale.encode(v), invert: (px) => scale.invertValue(px) };
}

/** Every channel that places or sizes a node's box. */
const LAYOUT_CHANNELS = [...POSITION_CHANNELS.x, ...POSITION_CHANNELS.y, ...Object.keys(EXTENT_AXIS)];

/**
 * The columns that place and size node boxes, each with its way to pixels and
 * back. `extent` marks a size column. One entry per column, first host first.
 * @param {import('../types').ScaleMap} scales
 * @param {any[]} hosts the marks drawing the nodes table
 * @returns {{ field: string, encode: (v: any) => number, invert: (px: number) => any, extent: boolean }[]}
 */
export function layoutIO(scales, hosts) {
    /** @type {Map<string, any>} */
    const out = new Map();
    for (const host of hosts) {
        for (const name of LAYOUT_CHANNELS) {
            const io = channelIO(scales, host.channels, name);
            if (io && !out.has(io.field)) out.set(io.field, { ...io, extent: name in EXTENT_AXIS });
        }
    }
    return [...out.values()];
}

/**
 * @typedef {object} SettleOptions
 * @property {import('../types').SchemaSpec} spec
 * @property {Record<string, import('../types').Datum[]>} tables
 * @property {any[]} hosts  the marks drawing the nodes table that declare `nodeBox`,
 *   in preference order; a row's host is the first that yields it a box
 * @property {import('../types').ScaleMap} scales
 * @property {number} width  @property {number} height  the plot's inner size
 * @property {import('../types').Datum[] | null} [before]  the node rows as last
 *   committed, for CARRY; omit for data that arrived from outside (nothing moved)
 * @property {Set<number> | null} [frozen]  node indices whose box must hold still
 *   (the ancestors of a row in mid-drag — see the nest driver)
 * @property {((row: any, i: number) => boolean) | null} [locked]  read-only rows
 * @property {((row: any, i: number, rows: any[]) => number | null) | null} [dodges]
 *   the gap a row keeps from its siblings, or null for none
 * @property {boolean} [spacing]  push rows apart and put slotted contents in their
 *   slots. Off mid-stroke: rows must not scatter under a carried node
 * @property {Set<number> | null} [emptied]  containers that just lost their last
 *   child: their fitted size returns to the schema `default`
 * @property {import('../types').Datum[] | null} [since]  the node rows before the
 *   gesture that is now settling; a row whose box differs holds its place and its
 *   siblings make room for it
 * @property {number[] | null} [anchors]  further rows that hold their place
 * @property {Set<number> | null} [keepSize]  containers that keep their size while
 *   their contents are still spaced inside them (a preview mid-drag)
 * @property {Set<number> | null} [yields]  the rows the gesture itself moved. One
 *   never pushes a container aside: the container holds and the row gives way
 * @property {boolean} [passing]  the `yields` rows are still being dragged, so they
 *   pass over a container instead of giving way to it
 * @property {((row: any, i: number, rows: any[]) => boolean) | null} [holds]  which
 *   rows may hold others
 * @property {((row: any, i: number, rows: any[]) => any) | null} [extents]  the
 *   space a row takes as a whole (a composite: every part, label included). Used
 *   to space rows and to fit containers round them. Omit to use the drawn box
 */

/**
 * Settle a hierarchy's node rows: place, carry, space, fit. Returns the same array
 * when nothing changed; otherwise only changed rows are new objects, so the ghost
 * pass finds them by identity and a locked row stays the same object.
 * @param {SettleOptions} options
 * @returns {import('../types').Datum[]}
 */
export function settleHierarchy({ spec, tables, hosts, scales, width, height, before = null, frozen = null, locked = null, dodges = null, spacing = false, emptied = null, since = null, anchors = null, extents = null, keepSize = null, yields = null, passing = false, holds = null }) {
    const nesting = nestingOf(spec);
    const rows = nesting ? tables[nesting.nodes] : null;
    if (!nesting || !rows || !rows.length || !hosts || !hosts.length) return rows || [];
    const tree = treeOf(spec, tables);

    let work = rows;
    /** @param {number} i @param {Record<string, any>} patch */
    const write = (i, patch) => {
        if (locked && locked(rows[i], i)) return;
        if (work === rows) work = rows.slice();
        work[i] = { ...work[i], ...patch };
    };
    const finite = (/** @type {any} */ b) => !!b && [b.cx, b.cy, b.hw, b.hh].every(Number.isFinite);
    /** The mark that draws row `i`, and the box it draws there.
     *  @param {number} i @param {any[]} [from] */
    const drawn = (i, from = work) => {
        const row = from[i];
        if (!row) return null;
        for (const host of hosts) {
            const box = host.nodeBox(row, i, from, scales, width, height);
            if (finite(box)) return { host, box };
        }
        return null;
    };
    /** The space row `i` takes as a whole: its glyph's extent, else its drawn box.
     *  @param {number} i */
    const extentOf = (i) => {
        if (extents && work[i]) {
            const box = extents(work[i], i, work);
            if (finite(box)) return box;
        }
        const at = drawn(i);
        return at ? at.box : null;
    };
    /** Shift row `i` by a pixel delta, through whichever position channels it has.
     *  @param {number} i @param {number} dx @param {number} dy */
    const shift = (i, dx, dy) => {
        const at = drawn(i);
        const host = at ? at.host : hosts[0];
        /** @type {Record<string, any>} */
        const patch = {};
        for (const [axis, d] of /** @type {[('x' | 'y'), number][]} */ ([['x', dx], ['y', dy]])) {
            if (Math.abs(d) < EPSILON) continue;
            for (const name of POSITION_CHANNELS[axis]) {
                const io = channelIO(scales, host.channels, name);
                if (!io) continue;
                const px = io.encode(work[i][io.field]);
                if (Number.isFinite(px)) patch[io.field] = io.invert(px + d);
            }
        }
        if (Object.keys(patch).length) write(i, patch);
    };

    // ── PLACE ────────────────────────────────────────────────────────────────
    // Top-down, so a container placed here is somewhere before its own children ask.
    for (const i of [...tree.bottomUp].reverse()) {
        const parent = tree.parentOf(i);
        if (parent === null || !work[i]) continue;
        const host = hosts[0];
        const xs = channelIO(scales, host.channels, 'x');
        const ys = channelIO(scales, host.channels, 'y');
        if (!xs || !ys) continue;
        const missing = (/** @type {any} */ v) => v === undefined || v === null || (typeof v === 'number' && Number.isNaN(v));
        if (!missing(work[i][xs.field]) && !missing(work[i][ys.field])) continue;
        const into = drawn(parent);
        if (!into) continue;
        const k = tree.childrenOf(parent).indexOf(i);
        // In a slotted container, past its far corner, so it reads as the last slot.
        if (SLOTTED.includes(arrangeOf(into.host.contains).arrange)) {
            write(i, {
                [xs.field]: xs.invert(into.box.cx + into.box.hw + k * PLACE_STEP),
                [ys.field]: ys.invert(into.box.cy + into.box.hh + k * PLACE_STEP),
            });
            continue;
        }
        write(i, {
            [xs.field]: xs.invert(into.box.cx + (k % 4) * PLACE_STEP),
            [ys.field]: ys.invert(into.box.cy + Math.floor(k / 4) * PLACE_STEP),
        });
    }

    // ── CARRY ────────────────────────────────────────────────────────────────
    // Only a container the commit moved. A mover nested in another mover rides
    // along as a descendant, so it is not carried twice.
    if (before && before.length === rows.length) {
        /** @type {Map<number, { dx: number, dy: number }>} */
        const movers = new Map();
        rows.forEach((row, i) => {
            if (row === before[i] || !tree.hasChildren(i)) return;
            const was = drawn(i, before);
            const now = drawn(i, rows);
            if (!was || !now) return;
            const dx = now.box.cx - was.box.cx;
            const dy = now.box.cy - was.box.cy;
            if (Math.abs(dx) >= EPSILON || Math.abs(dy) >= EPSILON) movers.set(i, { dx, dy });
        });
        for (const [i, d] of movers) {
            if (tree.ancestorsOf(i).some((a) => movers.has(a))) continue;
            for (const j of tree.descendantsOf(i)) shift(j, d.dx, d.dy);
        }
    }

    // ── SPACE ────────────────────────────────────────────────────────────────
    // Who holds their place when two rows overlap: the row the gesture just put
    // there, and every container around it (it grew to take that row, so its
    // siblings make room). Everything else gives way; two of a kind split it.
    /** @type {Set<number>} */
    const held = new Set(anchors || []);
    // The rows put somewhere new: a slotted container gives each the slot nearest
    // where it was put. Unlike `held`, a row that only changed size keeps its slot.
    /** @type {Set<number>} */
    const relocated = new Set([...(anchors || []), ...(yields || [])]);
    if (spacing && since && since.length <= rows.length) {
        rows.forEach((row, i) => {
            if (i >= since.length) { held.add(i); relocated.add(i); return; }
            if (row === since[i]) return;
            const was = drawn(i, since);
            const now = drawn(i, rows);
            if (!was || !now) return;
            const b = now.box, a = was.box;
            if ([b.cx - a.cx, b.cy - a.cy, b.hw - a.hw, b.hh - a.hh].some((d) => Math.abs(d) >= EPSILON)) held.add(i);
            if (Math.abs((b.cx - b.hw) - (a.cx - a.hw)) >= EPSILON || Math.abs((b.cy - b.hh) - (a.cy - a.hh)) >= EPSILON) relocated.add(i);
        });
    }
    for (const i of [...held]) for (const a of tree.ancestorsOf(i)) held.add(a);

    /** Shift a row and everything inside it. @param {number} i @param {number} dx @param {number} dy */
    const shiftTree = (i, dx, dy) => {
        shift(i, dx, dy);
        for (const j of tree.descendantsOf(i)) shift(j, dx, dy);
    };
    /**
     * Space one group of siblings: keep them inside `bounds` and push dodging rows
     * apart along the axis of least overlap, moving whichever does not hold its
     * place. Bounded; with no room, rows end as close to clear as the walls allow.
     * @param {number[]} kids
     * @param {{ x: boolean, y: boolean, x0: number, x1: number, y0: number, y1: number } | null} bounds
     * @param {boolean} [dodging] false for a `free` container: walls only
     */
    const space = (kids, bounds, dodging = !!dodges) => {
        if (!bounds && !dodging) return;
        /** @type {(Spaced & { k: number })[]} */
        const live = [];
        for (const k of kids) {
            const box = extentOf(k);
            if (!box) continue;
            const fixed = !!(locked && locked(rows[k], k));
            live.push({
                k, cx: box.cx, cy: box.cy, hw: box.hw, hh: box.hh, x0: box.cx, y0: box.cy,
                gap: dodging && dodges ? dodges(work[k], k, work) : null,
                rank: fixed ? 2 : held.has(k) ? 1 : 0,
                round: !!box.round && Math.abs(box.hw - box.hh) < EPSILON,
                guest: !!(yields && yields.has(k)),
                holds: tree.hasChildren(k) || !!(holds && holds(work[k], k, work)),
            });
        }
        if (!live.length) return;
        // The row the gesture moved, when the other row of a pair is a container.
        const guestOf = (/** @type {Spaced} */ a, /** @type {Spaced} */ b) =>
            (a.guest && b.holds && !b.guest ? a : b.guest && a.holds && !a.guest ? b : null);
        const passes = (/** @type {Spaced} */ a, /** @type {Spaced} */ b) => passing && !!guestOf(a, b);
        const within = (/** @type {number} */ c, /** @type {number} */ half, /** @type {number} */ lo, /** @type {number} */ hi) =>
            (lo + half > hi - half ? (lo + hi) / 2 : Math.min(Math.max(c, lo + half), hi - half));
        const keep = () => {
            if (!bounds) return;
            for (const m of live) {
                if (m.rank === 2) continue;
                if (bounds.x) m.cx = within(m.cx, m.hw, bounds.x0, bounds.x1);
                if (bounds.y) m.cy = within(m.cy, m.hh, bounds.y0, bounds.y1);
            }
        };
        keep();
        const movers = live.filter((m) => m.gap != null);
        for (let pass = 0; pass < DODGE_PASSES && movers.length > 1; pass++) {
            let pushed = false;
            for (let p = 0; p < movers.length; p++) {
                for (let q = p + 1; q < movers.length; q++) {
                    const a = movers[p], b = movers[q];
                    if (a.rank === 2 && b.rank === 2) continue;
                    if (passes(a, b) || !collides(a, b, a.cx, a.cy, b.cx, b.cy)) continue;
                    pushed = true;
                    const gap = Math.max(/** @type {number} */ (a.gap), /** @type {number} */ (b.gap));
                    const guest = guestOf(a, b);
                    // a's part of the move. A container never gives way to the row
                    // the gesture moved.
                    const share = guest && guest.rank < 2 ? (guest === a ? 1 : 0)
                        : a.rank > b.rank ? 0 : a.rank < b.rank ? 1 : 0.5;
                    // Ways to clear the pair, as a direction b moves (a moves the
                    // opposite way) and a distance: right, left, down or up of a, and
                    // for two circles straight apart. The shortest wins, unless it
                    // would push a row through the container's wall.
                    const sx = a.hw + b.hw + gap, sy = a.hh + b.hh + gap;
                    /** @type {{ ux: number, uy: number, d: number }[]} */
                    const ways = [
                        { ux: 1, uy: 0, d: sx - (b.cx - a.cx) }, { ux: -1, uy: 0, d: sx + (b.cx - a.cx) },
                        { ux: 0, uy: 1, d: sy - (b.cy - a.cy) }, { ux: 0, uy: -1, d: sy + (b.cy - a.cy) },
                    ];
                    if (a.round && b.round) {
                        const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
                        const ux = dist > EPSILON ? (b.cx - a.cx) / dist : 1, uy = dist > EPSILON ? (b.cy - a.cy) / dist : 0;
                        ways.push({ ux, uy, d: sx - dist });
                    }
                    ways.sort((m, n) => m.d - n.d);
                    const fitsIn = (/** @type {typeof ways[0]} */ w) => {
                        if (!bounds) return true;
                        const ok = (/** @type {Spaced} */ m, /** @type {number} */ by) => {
                            const x = m.cx + w.ux * by, y = m.cy + w.uy * by;
                            return (!bounds.x || Math.abs(w.ux * by) < EPSILON || insideWalls(x, m.hw, bounds.x0, bounds.x1))
                                && (!bounds.y || Math.abs(w.uy * by) < EPSILON || insideWalls(y, m.hh, bounds.y0, bounds.y1));
                        };
                        return ok(a, -w.d * share) && ok(b, w.d * (1 - share));
                    };
                    const way = ways.find(fitsIn) || ways[0];
                    a.cx -= way.ux * way.d * share;
                    a.cy -= way.uy * way.d * share;
                    b.cx += way.ux * way.d * (1 - share);
                    b.cy += way.uy * way.d * (1 - share);
                }
            }
            keep();
            if (!pushed) break;
        }
        // Pushing pairs apart can stall in a crowded container. Then place the rows
        // one by one: first each at the free spot nearest where it was, then, if that
        // fails, packed in reading order from the top-left. With no room for either,
        // the pushed result stands.
        if (movers.length <= PACK_LIMIT && movers.some((a, p) => movers.some((b, q) => q > p && a.rank + b.rank < 4 && !passes(a, b) && collides(a, b, a.cx, a.cy, b.cx, b.cy)))) {
            const free = movers.filter((m) => m.rank !== 2);
            const reading = (/** @type {typeof live[0]} */ a, /** @type {typeof live[0]} */ b) => (a.y0 - b.y0) || (a.x0 - b.x0);
            // Containers are placed before the row the gesture moved, so it is the one that gives way.
            const anyGuest = free.some((m) => m.guest);
            const weight = (/** @type {Spaced} */ m) => (m.guest ? 0.25 : m.rank + (anyGuest && m.holds ? 0.5 : 0));
            const placed = pack(movers, bounds, [...free].sort((a, b) => (weight(b) - weight(a)) || reading(a, b)),
                (m, x, y) => Math.hypot(x - m.x0, y - m.y0), passes)
                || pack(movers, bounds, [...free].sort(reading), (m, x, y) => y * 1e6 + x, passes);
            if (placed) for (const [m, at] of placed) { m.cx = at.x; m.cy = at.y; }
        }
        for (const m of live) {
            const dx = m.cx - m.x0;
            const dy = m.cy - m.y0;
            if (Math.abs(dx) >= EPSILON || Math.abs(dy) >= EPSILON) shiftTree(m.k, dx, dy);
        }
    };

    /**
     * Put a slotted container's children in their slots, in order. Children that
     * stayed keep their order; one put somewhere new takes the slot nearest it.
     * Mid-drag the row in flight stays under the pointer and its slot stays open.
     * @param {number[]} kids
     * @param {{ cx: number, cy: number, hw: number, hh: number }} box the container
     * @param {Sides} pad
     * @param {{ x: boolean, y: boolean }} grows the axes along which it fits
     * @param {{ arrange: string, gap: number, columns: number | null }} arr
     */
    const slot = (kids, box, pad, grows, arr) => {
        /** @type {{ k: number, cx: number, cy: number, hw: number, hh: number, round: boolean, moved: boolean }[]} */
        const live = [];
        for (const k of kids) {
            const b = extentOf(k);
            if (b) live.push({ k, cx: b.cx, cy: b.cy, hw: b.hw, hh: b.hh, round: !!b.round && Math.abs(b.hw - b.hh) < EPSILON, moved: relocated.has(k) });
        }
        const origin = { x: box.cx - box.hw + pad.left, y: box.cy - box.hh + pad.top };
        const limit = {
            x: grows.x ? null : 2 * box.hw - pad.left - pad.right,
            y: grows.y ? null : 2 * box.hh - pad.top - pad.bottom,
        };
        const options = { arrange: arr.arrange, gap: arr.gap, columns: arr.columns, origin, limit };
        /** @type {typeof live} */
        let order = live;
        if (arr.arrange !== 'pack') {
            const wraps = arr.arrange === 'row' ? limit.x != null : arr.arrange === 'column' ? limit.y != null : true;
            order = live.filter((m) => !m.moved).sort(readingOrder(arr.arrange, wraps));
            for (const m of live) if (m.moved) order.splice(nearestSlot(order, m, options), 0, m);
        }
        slotsOf(order, options).forEach((at, n) => {
            const m = order[n];
            if (passing && yields && yields.has(m.k)) {
                inSlot.set(m.k, { cx: at.x, cy: at.y, hw: m.hw, hh: m.hh });
                return;
            }
            const dx = at.x - m.cx, dy = at.y - m.cy;
            if (Math.abs(dx) >= EPSILON || Math.abs(dy) >= EPSILON) shiftTree(m.k, dx, dy);
        });
    };
    /** Mid-drag, where the row in flight will land: a fitted container is fitted round its slot.
     *  @type {Map<number, { cx: number, cy: number, hw: number, hh: number }>} */
    const inSlot = new Map();

    /**
     * A fitted container that just lost its last child takes its size columns'
     * schema `default`, keeping its top-left. With no default it shrinks to its padding.
     * @param {number} i
     */
    const restore = (i) => {
        const at = drawn(i);
        if (!at) return;
        const fields = (spec.tables[nesting.nodes] || {}).fields || {};
        const pad = paddingOf(at.host.contains);
        /** @type {Record<string, any>} */
        const patch = {};
        for (const name of fitChannelsOf(at.host.channels)) {
            if (!(name in EXTENT_AXIS)) continue;
            const io = channelIO(scales, at.host.channels, name);
            if (!io) continue;
            const declared = fields[io.field] && fields[io.field].default;
            if (declared !== undefined && declared !== null) {
                patch[io.field] = declared;
                continue;
            }
            warn(
                `fit:${io.field}:default`,
                `column "${io.field}" is fitted (\`fit: true\`) but declares no \`default\`, so a ` +
                'container that loses its last child has no size to return to; it shrinks to its ' +
                `padding. Declare one in the schema: ${io.field}: { type: "quantitative", default: … }.`
            );
            patch[io.field] = io.invert(FIT_OF[name]({ cx: at.box.cx, cy: at.box.cy, hw: 0, hh: 0 }, pad));
        }
        if (!Object.keys(patch).length) return;
        write(i, patch);
        // A round shape keeps its centre; a box keeps its top-left.
        const now = drawn(i);
        if (!now || at.box.round) return;
        shift(i, (at.box.cx - at.box.hw) - (now.box.cx - now.box.hw), (at.box.cy - at.box.hh) - (now.box.cy - now.box.hh));
    };

    // ── SPACE + FIT ──────────────────────────────────────────────────────────
    // Children before parents, each reading the rows as settled so far: a
    // container's contents are spaced, then it is fitted round them, and only then
    // is it spaced against its own siblings one level up.
    for (const i of tree.bottomUp) {
        if (frozen && frozen.has(i)) continue;
        if (!tree.hasChildren(i)) {
            if (emptied && emptied.has(i)) restore(i);
            continue;
        }
        const at = drawn(i);
        const host = at ? at.host : hosts[0];
        const names = fitChannelsOf(host.channels);
        const pad = paddingOf(host.contains);
        const arr = arrangeOf(host.contains);
        const fits = {
            x: FITS_AXIS.x.some((n) => names.includes(n)),
            y: FITS_AXIS.y.some((n) => names.includes(n)),
        };
        // A container that sizes itself needs no wall: it grows. One that does not
        // keeps its contents inside its padding, along each axis it does not fit.
        const still = !!(keepSize && keepSize.has(i));
        const walled = at && host.contains && (still || !(fits.x && fits.y));
        // A pack waits for the release: mid-drag nothing in it moves, and a pack
        // the row in flight is over keeps its size, so it holds still under the pointer.
        if (passing && arr.arrange === 'pack' && host.contains) {
            if (yields && tree.childrenOf(i).some((c) => yields.has(c))) continue;
        } else if (spacing && at && host.contains && SLOTTED.includes(arr.arrange)) {
            slot(tree.childrenOf(i), at.box, pad, { x: fits.x && !still, y: fits.y && !still }, arr);
        } else {
            space(tree.childrenOf(i), walled ? {
                x: still || !fits.x, y: still || !fits.y,
                x0: at.box.cx - at.box.hw + pad.left, x1: at.box.cx + at.box.hw - pad.right,
                y0: at.box.cy - at.box.hh + pad.top, y1: at.box.cy + at.box.hh - pad.bottom,
            } : null, arr.arrange === 'dodge');
        }
        if (!names.length || still) continue;

        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of tree.childrenOf(i)) {
            const kid = inSlot.get(c) || extentOf(c);
            if (!kid) continue;
            x0 = Math.min(x0, kid.cx - kid.hw);
            x1 = Math.max(x1, kid.cx + kid.hw);
            y0 = Math.min(y0, kid.cy - kid.hh);
            y1 = Math.max(y1, kid.cy + kid.hh);
        }
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue; // no child draws
        const inner = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };

        /** @type {Record<string, any>} */
        const patch = {};
        for (const name of names) {
            const io = channelIO(scales, host.channels, name);
            if (!io) continue;
            const target = FIT_OF[name](inner, pad);
            const current = io.encode(work[i][io.field]);
            if (Number.isFinite(current) && Math.abs(current - target) < EPSILON) continue;
            patch[io.field] = io.invert(target);
        }
        if (Object.keys(patch).length) write(i, patch);
    }

    // The top level last: every root is at its settled size by now. Its wall is the
    // plot itself — a row pushed aside must not leave the chart (and with it, its
    // column's domain).
    if (spacing && dodges) {
        /** @type {number[]} */
        const roots = [];
        work.forEach((_, i) => { if (tree.parentOf(i) === null) roots.push(i); });
        space(roots, { x: true, y: true, x0: 0, x1: width, y0: 0, y1: height });
    }

    return work;
}
