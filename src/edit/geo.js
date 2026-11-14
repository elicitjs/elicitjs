// @ts-check
// edit/geo.js — geo edits (scope 'geo'). Position is inverted through the chart's
// projection, not through x/y scales.

import { makeEdit, mintDatum, claimPick, andWhen } from './shared.js';
import { rectAt } from './pick.js';
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
 * The field holding a geoLine's coordinates list (fallback: coordinates).
 * @param {Record<string, any>} markChannels
 * @returns {string}
 */
function coordsField(markChannels) {
    return (markChannels.coordinates && markChannels.coordinates.field) || 'coordinates';
}

/**
 * move — move a geoPoint (or any lon/lat row) by inverting the pointer.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function move(options = {}) {
    return makeEdit({
        type: 'geo.move',
        gesture: 'drag',
        channels: null,
        pick: 'direct',
        scope: 'geo',
        ...options,
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
            // The projected lon/lat go in `seed`, which counts as placed.
            const datum = mintDatum(ctx, {
                defaults,
                seed: { [keys.lon]: ll.lon, [keys.lat]: ll.lat },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}

/** Is the gesture on a vertex handle? @param {import('../types').EditContext} ctx */
const onVertex = (ctx) => !!(ctx.node && ctx.node.channel === 'vertex');

/**
 * dragVertex — move one vertex of a geoLine's coordinates list. The touched
 * node must carry `channel: 'vertex'` and `vertexIndex` (emitted by geoLine).
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function dragVertex(options = {}) {
    return makeEdit({
        type: 'geo.dragVertex',
        gesture: 'drag',
        channels: null,
        pick: 'direct',
        scope: 'geo',
        ...options,
        when: andWhen(onVertex, options.when),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum || !ctx.node) return undefined;
            const vi = ctx.node.vertexIndex;
            if (vi == null) return undefined;
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const coordsKey = coordsField(ctx.markChannels);
            const prev = ctx.datum[coordsKey];
            if (!Array.isArray(prev) || !prev[vi]) return undefined;
            const next = prev.map((c, i) => (i === vi ? [ll.lon, ll.lat] : c.slice()));
            return { ...ctx.datum, [coordsKey]: next };
        },
    });
}

/**
 * removeVertex — click a vertex handle to drop it from a geoLine's coordinates.
 * Refuses to go below `min` (default 2) vertices; use `remove` for the whole line.
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
        ...rest,
        when: andWhen(onVertex, options.when),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum || !ctx.node) return undefined;
            const vi = ctx.node.vertexIndex;
            if (vi == null) return undefined;
            const coordsKey = coordsField(ctx.markChannels);
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
            const coordsKey = coordsField(ctx.markChannels);

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

            // First sample: mint a row and lock its index on the session.
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
export function boundsFields(mc) {
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
 * The geoBrush driver locks the zone (edge / corner / body) at dragstart in
 * `ctx.session`. A body move translates by the delta from the grab point. At
 * dragend `zone: 'canonicalize'` swaps any inverted pair.
 *
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function brush(options = {}) {
    // `move` is restated so its default lands on the descriptor for the driver.
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
                // Translate the dragstart box by the pointer's geographic delta.
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
 * createRect — plane click mints a geographic bbox centred on the pointer.
 * `width` / `height` are spans in degrees (default 10 × 6).
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
        ...rest,
        // Not on an existing box (the raised plane also receives those clicks).
        when: andWhen(
            (/** @type {import('../types').EditContext} */ ctx) => rectAt(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, edgeInset) == null,
            options.when,
        ),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ll = invertPoint(projectionOf(ctx), ctx.pointer);
            if (!ll) return undefined;
            const f = boundsFields(ctx.markChannels || {});
            const hw = width / 2, hh = height / 2;
            // Seed the bbox from the projected point ± half the spans.
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
