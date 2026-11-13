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
// Three steps, in order:
//
//   PLACE   a nested row with no position gets one inside its container (a caller
//           saying "add C to group B" has no coordinates to give)
//   CARRY   a container whose position this commit changed takes its whole subtree
//           along by the same pixel delta — so the universal `move` moves a group
//   FIT     bottom-up, every container with fitted channels takes the union of its
//           children's boxes, padded, written back into its columns
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

/**
 * Which component of a container's box each channel receives. `inner` is the union
 * of the children's boxes, `pad` the container's padding.
 *
 * A static channel -> value table, like AXIS_OF: a mark gains a fittable channel by
 * a row here, never by a branch in the pass. A round shape takes the circle (or
 * ellipse) that ENCLOSES the union's rectangle, since its children may sit in the
 * corners.
 * @type {Record<string, (inner: { cx: number, cy: number, hw: number, hh: number }, pad: number) => number>}
 */
export const FIT_OF = {
    x: (b) => b.cx,
    y: (b) => b.cy,
    width: (b, pad) => 2 * (b.hw + pad),
    height: (b, pad) => 2 * (b.hh + pad),
    size: (b, pad) => Math.hypot(b.hw, b.hh) + pad,
    rx: (b, pad) => b.hw * Math.SQRT2 + pad,
    ry: (b, pad) => b.hh * Math.SQRT2 + pad,
    x1: (b, pad) => b.cx - b.hw - pad,
    x2: (b, pad) => b.cx + b.hw + pad,
    y1: (b, pad) => b.cy - b.hh - pad,
    y2: (b, pad) => b.cy + b.hh + pad,
};

/** The channels that state a box's EXTENT; a fitted one pulls the centre with it. */
const EXTENT_AXIS = { width: 'x', size: 'xy', rx: 'x', height: 'y', ry: 'y' };

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
 */

/**
 * Settle a hierarchy's node rows: place, carry, fit. Returns the SAME array when
 * nothing needed writing, and otherwise a new array in which only the rows that
 * changed are new objects — which is what lets the ghost pass find them by identity
 * and keeps a locked row the same object.
 * @param {SettleOptions} options
 * @returns {import('../types').Datum[]}
 */
export function settleHierarchy({ spec, tables, hosts, scales, width, height, before = null, frozen = null, locked = null }) {
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

    // ── FIT ──────────────────────────────────────────────────────────────────
    // Children before parents, each reading the rows as fitted so far.
    for (const i of tree.bottomUp) {
        if (!tree.hasChildren(i) || (frozen && frozen.has(i))) continue;
        const at = drawn(i);
        const host = at ? at.host : hosts[0];
        const names = fitChannelsOf(host.channels);
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
        const stated = host.contains && host.contains.padding;
        const pad = typeof stated === 'number' ? stated : DEFAULT_PADDING;

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

    return work;
}
