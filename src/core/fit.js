// fit.js — keeping a hierarchy's GEOMETRY settled.
//
// A container's box is not elicited: it follows from what is inside it. That is a
// rule the SCHEMA declares (a nesting table) and the CHANNEL MAP details (`fit: true`
// on a size channel), so the ENGINE holds it, the way it holds a `ref` — after every
// commit, and for data arriving from outside.
//
// The rule is held in the DATA, not in the drawing. A fitted channel names a column,
// and this pass writes the fitted value into it through the channel's own scale —
// an edit is the inverse of encoding, and the fit is an engine-run edit. Two things
// follow, and both are the point:
//
//   · No mark changes. A rect still draws `width` from its column; a link still
//     docks to `Mark.nodeBox`. Neither knows the column was derived.
//   · `getData()` reports the exact fitted geometry, because it IS the data.
//
// Four steps, in order:
//
//   PLACE   a nested row with no position gets one inside its container (a caller
//           saying "add C to group B" has no coordinates to give)
//   CARRY   a container whose position this commit changed takes its whole subtree
//           along by the same pixel delta — so the universal `move` moves a group
//   SPACE   bottom-up, the contents of each container (and last the roots): a
//           container whose size is NOT fitted keeps its contents inside its padding,
//           and rows that `dodge` are pushed apart until no two overlap
//   FIT     in the same bottom-up walk, every container with fitted channels takes
//           the union of its children's boxes, padded, written back into its columns
//
// Everything is measured in pixels through the mark's own `nodeBox` and written back
// through the same scales, so a log or a temporal axis fits like a linear one.

import { scaleKey } from './scales.js';
import { treeOf, nestingOf } from './hierarchy.js';

/** Padding between a container's edge and its contents, when `contains` states none. */
export const DEFAULT_PADDING = 10;

/** How far apart PLACE staggers siblings that arrive with no position, in px. */
const PLACE_STEP = 18;

/** Below this many pixels a fitted value is the one already there (no write). */
const EPSILON = 0.01;

/** The gap `dodge` keeps between two rows when it states none, in px. */
export const DEFAULT_GAP = 8;

/** How many rounds of pushing apart one group gets before it is left as it stands. */
const DODGE_PASSES = 40;

/**
 * A container's padding as four sides. `contains: { padding }` takes one number or
 * `{ top, right, bottom, left }` (a side left out takes the default) — a container
 * with a title along its top wants more room there than along the other three.
 * @param {any} contains the mark's `contains` channel
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
export function paddingOf(contains) {
    const p = contains ? contains.padding : undefined;
    const side = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : DEFAULT_PADDING);
    if (p && typeof p === 'object') {
        return { top: side(p.top), right: side(p.right), bottom: side(p.bottom), left: side(p.left) };
    }
    const all = side(p);
    return { top: all, right: all, bottom: all, left: all };
}

/**
 * Which component of a container's box each channel receives. `inner` is the union
 * of the children's boxes, `pad` the container's padding by side (in pixels, so
 * `top` is toward smaller y).
 *
 * A static channel -> value table, like AXIS_OF: a mark gains a fittable channel by
 * a row here, never by a branch in the pass. A round shape takes the circle (or
 * ellipse) that ENCLOSES the union's rectangle, since its children may sit in the
 * corners; uneven padding moves its centre and it keeps the smaller side's gap.
 * @typedef {{ top: number, right: number, bottom: number, left: number }} Sides
 * @type {Record<string, (inner: { cx: number, cy: number, hw: number, hh: number }, pad: Sides) => number>}
 */
export const FIT_OF = {
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

/** The channels that state a box's EXTENT; a fitted one pulls the centre with it. */
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
    const scale = /** @type {any} */ (scales[scaleKey(name, spec.field)] || scales[name]);
    if (!scale || !scale.invertible || typeof scale.invertValue !== 'function') return null;
    return { field: spec.field, encode: (v) => scale.encode(v), invert: (px) => scale.invertValue(px) };
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
 *   the gap a row keeps from its siblings, or null for a row that takes no part.
 *   Omit to push nothing apart (a stroke in progress: rows must not scatter under
 *   a node being carried past them)
 * @property {import('../types').Datum[] | null} [since]  the node rows before the
 *   gesture that is now settling; a row whose box differs HOLDS its place and its
 *   siblings make room for it
 * @property {number[] | null} [anchors]  further rows that hold their place
 */

/**
 * Settle a hierarchy's node rows: place, carry, space, fit. Returns the SAME array when
 * nothing needed writing, and otherwise a new array in which only the rows that
 * changed are new objects — which is what lets the ghost pass find them by identity
 * and keeps a locked row the same object.
 * @param {SettleOptions} options
 * @returns {import('../types').Datum[]}
 */
export function settleHierarchy({ spec, tables, hosts, scales, width, height, before = null, frozen = null, locked = null, dodges = null, since = null, anchors = null }) {
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
        write(i, {
            [xs.field]: xs.invert(into.box.cx + (k % 4) * PLACE_STEP),
            [ys.field]: ys.invert(into.box.cy + Math.floor(k / 4) * PLACE_STEP),
        });
    }

    // ── CARRY ────────────────────────────────────────────────────────────────
    // Only a container the COMMIT moved: its row differs from the committed one and
    // its box centre with it. One nested inside another mover rides along as a
    // descendant, so it is not carried twice.
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
    // there, and every container around it (it grew to take that row, so ITS
    // siblings make room). Everything else gives way; two of a kind split it.
    /** @type {Set<number>} */
    const held = new Set(anchors || []);
    if (dodges && since && since.length <= rows.length) {
        rows.forEach((row, i) => {
            if (i >= since.length) { held.add(i); return; }
            if (row === since[i]) return;
            const was = drawn(i, since);
            const now = drawn(i, rows);
            if (!was || !now) return;
            const b = now.box, a = was.box;
            if ([b.cx - a.cx, b.cy - a.cy, b.hw - a.hw, b.hh - a.hh].some((d) => Math.abs(d) >= EPSILON)) held.add(i);
        });
    }
    for (const i of [...held]) for (const a of tree.ancestorsOf(i)) held.add(a);

    /** Shift a row and everything inside it. @param {number} i @param {number} dx @param {number} dy */
    const shiftTree = (i, dx, dy) => {
        shift(i, dx, dy);
        for (const j of tree.descendantsOf(i)) shift(j, dx, dy);
    };
    /**
     * Space one group of siblings: keep them inside `bounds` (the padded inside of a
     * container that does not fit itself) and push the ones that dodge apart. Each
     * overlapping pair separates along the axis of LEAST overlap — the smallest move
     * that clears it — and the push goes to whichever of the two does not hold its
     * place. A repair, like the link router's: bounded, and when there is no room
     * the rows are left as close to clear as the walls allow.
     * @param {number[]} kids
     * @param {{ x: boolean, y: boolean, x0: number, x1: number, y0: number, y1: number } | null} bounds
     */
    const space = (kids, bounds) => {
        if (!bounds && !dodges) return;
        /** @type {{ k: number, cx: number, cy: number, hw: number, hh: number, x0: number, y0: number, gap: number | null, rank: number }[]} */
        const live = [];
        for (const k of kids) {
            const at = drawn(k);
            if (!at) continue;
            const fixed = !!(locked && locked(rows[k], k));
            live.push({
                k, cx: at.box.cx, cy: at.box.cy, hw: at.box.hw, hh: at.box.hh, x0: at.box.cx, y0: at.box.cy,
                gap: dodges ? dodges(work[k], k, work) : null,
                rank: fixed ? 2 : held.has(k) ? 1 : 0,
            });
        }
        if (!live.length) return;
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
                    const gap = Math.max(/** @type {number} */ (a.gap), /** @type {number} */ (b.gap));
                    const ox = a.hw + b.hw + gap - Math.abs(b.cx - a.cx);
                    const oy = a.hh + b.hh + gap - Math.abs(b.cy - a.cy);
                    if (ox <= EPSILON || oy <= EPSILON) continue;
                    pushed = true;
                    const share = a.rank > b.rank ? 0 : a.rank < b.rank ? 1 : 0.5; // a's part of the move
                    // Four ways to clear the pair: b goes right, left, down or up
                    // of a. The shortest wins — unless it would push a row through
                    // the container's wall, where the next shortest is tried.
                    const sx = a.hw + b.hw + gap, sy = a.hh + b.hh + gap;
                    const ways = [
                        { x: true, dir: 1, d: sx - (b.cx - a.cx) }, { x: true, dir: -1, d: sx + (b.cx - a.cx) },
                        { x: false, dir: 1, d: sy - (b.cy - a.cy) }, { x: false, dir: -1, d: sy + (b.cy - a.cy) },
                    ].sort((m, n) => m.d - n.d);
                    const fitsIn = (/** @type {typeof ways[0]} */ w) => {
                        if (!bounds || !(w.x ? bounds.x : bounds.y)) return true;
                        const lo = w.x ? bounds.x0 : bounds.y0, hi = w.x ? bounds.x1 : bounds.y1;
                        const ok = (/** @type {typeof a} */ m, /** @type {number} */ by) => {
                            if (Math.abs(by) < EPSILON) return true;
                            const c = (w.x ? m.cx : m.cy) + by, half = w.x ? m.hw : m.hh;
                            return c - half >= lo - EPSILON && c + half <= hi + EPSILON;
                        };
                        return ok(a, -w.dir * w.d * share) && ok(b, w.dir * w.d * (1 - share));
                    };
                    const way = ways.find(fitsIn) || ways[0];
                    if (way.x) {
                        a.cx -= way.dir * way.d * share;
                        b.cx += way.dir * way.d * (1 - share);
                    } else {
                        a.cy -= way.dir * way.d * share;
                        b.cy += way.dir * way.d * (1 - share);
                    }
                }
            }
            keep();
            if (!pushed) break;
        }
        for (const m of live) {
            const dx = m.cx - m.x0;
            const dy = m.cy - m.y0;
            if (Math.abs(dx) >= EPSILON || Math.abs(dy) >= EPSILON) shiftTree(m.k, dx, dy);
        }
    };

    // ── SPACE + FIT ──────────────────────────────────────────────────────────
    // Children before parents, each reading the rows as settled so far: a
    // container's contents are spaced, then it is fitted round them, and only then
    // is it spaced against its own siblings one level up.
    for (const i of tree.bottomUp) {
        if (!tree.hasChildren(i) || (frozen && frozen.has(i))) continue;
        const at = drawn(i);
        const host = at ? at.host : hosts[0];
        const names = fitChannelsOf(host.channels);
        const pad = paddingOf(host.contains);
        const fits = {
            x: FITS_AXIS.x.some((n) => names.includes(n)),
            y: FITS_AXIS.y.some((n) => names.includes(n)),
        };
        // A container that sizes itself needs no wall: it grows. One that does not
        // keeps its contents inside its padding, along each axis it does not fit.
        const walled = at && host.contains && !(fits.x && fits.y);
        space(tree.childrenOf(i), walled ? {
            x: !fits.x, y: !fits.y,
            x0: at.box.cx - at.box.hw + pad.left, x1: at.box.cx + at.box.hw - pad.right,
            y0: at.box.cy - at.box.hh + pad.top, y1: at.box.cy + at.box.hh - pad.bottom,
        } : null);
        if (!names.length) continue;

        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const c of tree.childrenOf(i)) {
            const kid = drawn(c);
            if (!kid) continue;
            x0 = Math.min(x0, kid.box.cx - kid.box.hw);
            x1 = Math.max(x1, kid.box.cx + kid.box.hw);
            y0 = Math.min(y0, kid.box.cy - kid.box.hh);
            y1 = Math.max(y1, kid.box.cy + kid.box.hh);
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
    if (dodges) {
        /** @type {number[]} */
        const roots = [];
        work.forEach((_, i) => { if (tree.parentOf(i) === null) roots.push(i); });
        space(roots, { x: true, y: true, x0: 0, x1: width, y0: 0, y1: height });
    }

    return work;
}
