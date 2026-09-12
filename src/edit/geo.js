// @ts-check
// edit/geo.js — geo-scoped edits. Position goes through the chart projection's
// apply/invert (the inverse of geo mark encoding), not through 1D x/y scales.
// Namespaced as `edit.geo.*` with `scope: 'geo'` so the engine can warn when
// these are attached to a non-geo mark.

import { makeEdit, mintDatum, claimPick } from './shared.js';
import { invertPoint } from '../core/projection.js';

/**
 * @param {import('../types').EditContext} ctx
 * @returns {import('../core/projection.js').ProjectionContext | null}
 */
function projectionOf(ctx) {
    return /** @type {any} */ (ctx.projection || (ctx.scales && ctx.scales.projection) || null);
}

/**
 * Lon/lat field names from the mark's channels (fallback: lon/lat).
 * @param {Record<string, any>} markChannels
 * @returns {{ lon: string, lat: string }}
 */
function lonLatFields(markChannels) {
    const lon = (markChannels.lon && markChannels.lon.field) || 'lon';
    const lat = (markChannels.lat && markChannels.lat.field) || 'lat';
    return { lon, lat };
}

/**
 * move — move a geoPoint (or any lon/lat row) by inverting the pointer.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function move(options = {}) {
    const { ...rest } = options;
    return makeEdit({
        type: 'geo.move',
        gesture: 'drag',
        channels: null,
        pick: 'direct',
        scope: 'geo',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum) return undefined;
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const keys = lonLatFields(ctx.markChannels || {});
            return { ...ctx.datum, [keys.lon]: ll.lon, [keys.lat]: ll.lat };
        },
    });
}

/**
 * create — plane click mints a lon/lat datum at the pointer.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function create(options = {}) {
    const { defaults = {}, ...rest } = options;
    return makeEdit({
        type: 'geo.create',
        gesture: 'click',
        channels: null,
        pick: 'plane',
        scope: 'geo',
        cardinality: 'append',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const keys = lonLatFields(ctx.markChannels || {});
            // The same minting core, but geo's position comes from the PROJECTION,
            // not a channel scale — so the inverted lon/lat go through `seed` (which
            // counts as "placed"), while the pointer-invert loop finds no cartesian
            // channel to add (geo declares channels: null).
            const datum = mintDatum(ctx, {
                defaults,
                seed: { [keys.lon]: ll.lon, [keys.lat]: ll.lat },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}

/**
 * dragVertex — move one vertex of a geoLine's coordinates list. The touched
 * node must carry `channel: 'vertex'` and `vertexIndex` (emitted by geoLine).
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function dragVertex(options = {}) {
    const { ...rest } = options;
    return makeEdit({
        type: 'geo.dragVertex',
        gesture: 'drag',
        channels: null,
        pick: 'direct',
        scope: 'geo',
        when: (/** @type {import('../types').EditContext} */ ctx) => !!(ctx.node && ctx.node.channel === 'vertex'),
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum || !ctx.node) return undefined;
            const vi = ctx.node.vertexIndex;
            if (vi == null) return undefined;
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const coordsKey = (ctx.markChannels.coordinates && ctx.markChannels.coordinates.field)
                || 'coordinates';
            const prev = ctx.datum[coordsKey];
            if (!Array.isArray(prev) || !prev[vi]) return undefined;
            const next = prev.map((c, i) => (i === vi ? [ll.lon, ll.lat] : c.slice()));
            return { ...ctx.datum, [coordsKey]: next };
        },
    });
}

/**
 * removeVertex — drop one vertex from a geoLine's coordinates list: the inverse of
 * `dragVertex` (and of the vertex-appending `draw`), so a drawn path can be
 * simplified as well as reshaped. Same target contract as `dragVertex` — the
 * touched node carries `channel: 'vertex'` and `vertexIndex`.
 *
 * Defaults to a plain click. When `dragVertex` already lives on the same handle,
 * that's fine (drag and click are different gestures); pair with a modifier if a
 * sibling CLICK edit shares the mark: `removeVertex({ when: when.alt })`.
 *
 * A line needs two vertices to exist, so a removal that would leave fewer is
 * rejected (returns undefined) rather than silently degenerating the row — use
 * the ordinary `remove` to delete the whole line.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function removeVertex(options = {}) {
    const { min = 2, ...rest } = options;
    return makeEdit({
        type: 'geo.removeVertex',
        gesture: 'click',
        channels: null,
        pick: 'direct',
        scope: 'geo',
        when: (/** @type {import('../types').EditContext} */ ctx) => !!(ctx.node && ctx.node.channel === 'vertex'),
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum || !ctx.node) return undefined;
            const vi = ctx.node.vertexIndex;
            if (vi == null) return undefined;
            const coordsKey = (ctx.markChannels.coordinates && ctx.markChannels.coordinates.field)
                || 'coordinates';
            const prev = ctx.datum[coordsKey];
            if (!Array.isArray(prev) || !prev[vi]) return undefined;
            if (prev.length <= min) return undefined; // would degenerate the line
            const next = prev.filter((_, i) => i !== vi).map((c) => c.slice());
            return { ...ctx.datum, [coordsKey]: next };
        },
    });
}

/**
 * draw — author a geoLine by dragging. Uses the draw driver session; defaults to
 * `into: 'new'` so each stroke mints one row whose `coordinates` list grows as
 * the pointer moves (sampled by `minDist` px). Pair with `dragVertex` to reshape.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function draw(options = {}) {
    const {
        threshold = 24,
        minDist = 8,
        defaults = {},
        into = 'new',
        ...rest
    } = options;
    return makeEdit({
        type: 'geo.draw',
        gesture: 'drag',
        cardinality: 'appendMany',
        channels: null,
        pick: 'draw',
        scope: 'geo',
        threshold,
        into,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const st = ctx.session;
            if (!st) return undefined;
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const coordsKey = (ctx.markChannels.coordinates && ctx.markChannels.coordinates.field)
                || 'coordinates';

            const px = ctx.pointer.x, py = ctx.pointer.y;
            if (st.lastX != null && st.lastY != null) {
                if (Math.hypot(px - st.lastX, py - st.lastY) < minDist) return undefined;
            }

            // Continue the row locked for this stroke.
            if (st.drawIndex != null && ctx.data[st.drawIndex]) {
                const i = st.drawIndex;
                const row = ctx.data[i];
                const coords = Array.isArray(row[coordsKey]) ? row[coordsKey].slice() : [];
                coords.push([ll.lon, ll.lat]);
                st.lastX = px;
                st.lastY = py;
                return ctx.data.map((d, j) => (j === i ? { ...d, [coordsKey]: coords } : d));
            }

            // First sample of a new stroke: mint a row (its `coordinates` list is the
            // position, so it rides `seed`) and lock its index on the session object
            // (same reference the driver holds for the gesture).
            const datum = mintDatum(ctx, { defaults, seed: { [coordsKey]: [[ll.lon, ll.lat]] } });
            if (!datum) return undefined;
            const next = [...ctx.data, datum];
            st.drawIndex = next.length - 1;
            st.lastX = px;
            st.lastY = py;
            return next;
        },
    });
}

/**
 * The four extent field names from a mark's channels.
 * @param {Record<string, any>} mc
 * @returns {{ west: string, south: string, east: string, north: string }}
 */
function boundsFields(mc) {
    return {
        west: (mc.west && mc.west.field) || 'west',
        south: (mc.south && mc.south.field) || 'south',
        east: (mc.east && mc.east.field) || 'east',
        north: (mc.north && mc.north.field) || 'north',
    };
}

/**
 * brush — resize or move a geoRect's west/south/east/north.
 *
 * Which zone a gesture means (edge / corner / body) is classified ONCE at
 * dragstart by the geoBrush driver (src/edit/drivers/geoBrush.js) and locked in
 * the feature's session for the whole gesture; this apply just reads the lock
 * (`ctx.session`), exactly like `brushRect` in basic.js. Re-deciding the zone
 * per tick is what made the old version resize when you meant to move.
 *
 * A body move translates by the geographic delta from the latched grab anchor,
 * so the box follows the cursor instead of snapping its center to it. On dragend
 * the driver re-invokes with zone 'canonicalize' to un-invert a crossed pair.
 *
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function brush(options = {}) {
    // `edgeInset` / `move` are driver-only knobs: makeEdit passes them through
    // onto the descriptor, where the driver reads them (as edgeInsetOf does).
    // `move` is re-stated so its default lands even when the caller omits it.
    const { move = true, ...rest } = claimPick(options, 'geo.brush', 'geoBrush');
    return makeEdit({
        type: 'geo.brush',
        gesture: 'drag',
        channels: null,
        scope: 'geo',
        ...rest,
        move,
        pick: 'geoBrush',
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const st = ctx.session;
            const zone = st && st.zone;
            const d = ctx.datum;
            if (!zone || !d) return undefined; // driver sets the lock on dragstart

            const f = boundsFields(ctx.markChannels || {});

            if (zone === 'canonicalize') {
                const out = { ...d };
                let changed = false;
                for (const [lo, hi] of [[f.west, f.east], [f.south, f.north]]) {
                    if (d[lo] == null || d[hi] == null || d[lo] <= d[hi]) continue;
                    out[lo] = d[hi];
                    out[hi] = d[lo];
                    changed = true;
                }
                return changed ? out : undefined;
            }

            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;

            let west = d[f.west], south = d[f.south], east = d[f.east], north = d[f.north];

            if (zone === 'body') {
                if (!move || !st.grab || !st.box0) return undefined;
                // Translate the box as it stood at dragstart by the pointer's
                // geographic delta — preserves the grab offset AND the span.
                const dLon = ll.lon - st.grab.lon;
                const dLat = ll.lat - st.grab.lat;
                west = st.box0.west + dLon;
                east = st.box0.east + dLon;
                south = st.box0.south + dLat;
                north = st.box0.north + dLat;
            } else {
                for (const edge of (st.edges || [])) {
                    if (edge === 'west') west = ll.lon;
                    else if (edge === 'east') east = ll.lon;
                    else if (edge === 'south') south = ll.lat;
                    else if (edge === 'north') north = ll.lat;
                }
            }

            return {
                ...d,
                [f.west]: west,
                [f.south]: south,
                [f.east]: east,
                [f.north]: north,
            };
        },
    });
}

/**
 * Is the pointer over an existing rect node (grown by `inset`)? A geoBrush chart
 * raises the plane above the marks, so a plane click fires even when it lands on
 * a box — without this, clicking a box to grab it would also mint a new one.
 * @param {import('../types').EditContext} ctx
 * @param {number} inset
 * @returns {boolean}
 */
function overExistingRect(ctx, inset) {
    const { x: px, y: py } = ctx.pointer;
    return (ctx.marks || []).some((m) => {
        if (m.type !== 'rect' || m.index == null) return false;
        if (m.x == null || m.y == null || m.width == null || m.height == null) return false;
        return px >= m.x - inset && px <= m.x + m.width + inset
            && py >= m.y - inset && py <= m.y + m.height + inset;
    });
}

/**
 * createRect — plane click mints a geographic bbox centered on the pointer.
 * `width` / `height` are spans in DEGREES (a city box is ~0.02°, not 10°), so
 * pass them explicitly for anything smaller than a continent.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function createRect(options = {}) {
    const {
        defaults = {},
        // Default spans in degrees when minting a new box.
        width = 10,
        height = 6,
        edgeInset = 8,
        ...rest
    } = options;
    return makeEdit({
        type: 'geo.createRect',
        gesture: 'click',
        channels: null,
        pick: 'plane',
        scope: 'geo',
        cardinality: 'append',
        // Clicking an existing box means "grab it", not "make another".
        when: (/** @type {import('../types').EditContext} */ ctx) => !overExistingRect(ctx, edgeInset),
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const f = boundsFields(ctx.markChannels || {});
            const hw = width / 2, hh = height / 2;
            // An extent mark: its position IS the bbox, seeded from the projected
            // point ± the default spans, so the box is never minted zero-size.
            const datum = mintDatum(ctx, {
                defaults,
                seed: {
                    [f.west]: ll.lon - hw,
                    [f.east]: ll.lon + hw,
                    [f.south]: ll.lat - hh,
                    [f.north]: ll.lat + hh,
                },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}
