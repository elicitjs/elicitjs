// @ts-check
// geo.js — geographic marks for map elicitation (mini GIS surface).
//
// Position goes through the chart's shared projection (`scales.projection` from
// `spec.projection`) — NOT through x/y 1D scales. Style channels (fill, stroke,
// size, …) remain ordinary. Static basemap topology is a mark option; editable
// geometry lives on the dataset.
//
//   geoBasemap  — inert GeoJSON chrome (background)
//   geoPoint    — lon/lat circles
//   geoPolygon  — GeoJSON geometries from rows (fill-editable)
//   geoLine     — coordinate lists / MultiLineString paths + vertex handles
//   geoRect     — geographic AABB (west/south/east/north)

import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, resolveHandles, markCommon} from './mark.js';
import { textNodeAt, hasEditText } from './text.js';
import { resolveFormat } from '../format.js';
import { warn } from '../core/dev.js';
import { projectPoint, projectBounds } from '../core/projection.js';
import { tileCover, tileUrl } from '../core/tiles.js';

/** Series key for an ungrouped mark (one implicit series). */
const SINGLE = Symbol('single');

/** Raster tiles only register under an unrotated Web Mercator. */
function warnTilesNeedMercator() {
    warn(
        'geoTile:mercator',
        'geoTile needs projection: "mercator" (unrotated). Tiles are images '
        + 'baked in Web Mercator — under another projection they cannot align with '
        + 'the data, so none are drawn. Use geoBasemap({ geojson }) for vector chrome '
        + 'under other projections.'
    );
}

/**
 * @param {import('../types').ScaleMap} scales
 * @returns {import('../core/projection.js').ProjectionContext | null}
 */
function projectionOf(scales) {
    return /** @type {any} */ (scales && scales.projection) || null;
}

/**
 * Field name from a channel, or null.
 * @param {Record<string, any>} channels
 * @param {string} name
 * @returns {string | null}
 */
function fieldOf(channels, name) {
    const spec = channels[name];
    return spec && spec.field != null ? spec.field : null;
}

/**
 * Inert basemap from static GeoJSON. Not elicited — topology is a **mark option**
 * (`geojson` / `features`), not the chart dataset. Pass a FeatureCollection,
 * Feature, GeometryCollection, or Geometry. FeatureCollections emit one path per
 * feature so shared boundaries stay visible.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoBasemap(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoBasemap', allow: ['geojson', 'features'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        geojson,
        features: geoFeatures,
        stroke = '#94a3b8',
        strokeWidth = 0.75,
        fill = '#e2e8f0',
    } = opts;
    const object = geojson || geoFeatures || null;

    return {
        ...markCommon(opts),
        markName: 'geoBasemap',
        channels,
        supportsGeo: true,
        /**
         * @param {any[]} _currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} _width
         * @param {number} _height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (_currentData, scales, _width, _height) => {
            const projection = projectionOf(scales);
            if (!projection || !object) return [];
            const style = resolveStyle(scales, channels, /** @type {any} */ ({}), {
                fill, stroke, strokeWidth,
            });
            const fillV = style.fill != null ? style.fill : fill;
            const strokeV = style.stroke != null ? style.stroke : stroke;
            const sw = style.strokeWidth != null ? style.strokeWidth : strokeWidth;

            // One path per Feature so neighborhood/state outlines read clearly.
            const list = object.type === 'FeatureCollection' && Array.isArray(object.features)
                ? object.features
                : [object];

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            list.forEach((/** @type {any} */ item, /** @type {number} */ i) => {
                const geom = item && item.type === 'Feature' ? item.geometry : item;
                if (!geom) return;
                const d = projection.path(geom);
                if (!d) return;
                nodes.push({
                    type: 'path',
                    d,
                    fill: fillV,
                    stroke: strokeV,
                    strokeWidth: sw,
                    opacity: style.opacity,
                    fillOpacity: style.fillOpacity,
                    strokeOpacity: style.strokeOpacity,
                    background: true,
                    pointerEvents: 'none',
                    index: i,
                });
            });
            return nodes;
        },
    };
}

/**
 * Raster tile basemap — real OSM/Carto/satellite imagery under the marks, the
 * Leaflet model. Chrome like geoBasemap, but the source is a tile server rather
 * than GeoJSON, so it is NOT elicited and takes no data.
 *
 *   geoTile()                                   // OSM standard
 *   geoTile({ url: "https://…/{z}/{x}/{y}.png", attribution: "…" })
 *   geoTile({ url: (t) => `…/${t.z}/${t.x}/${t.y}.png` })
 *
 * REQUIRES `projection: "mercator"` (unrotated). Tiles are pre-rendered pictures
 * baked in Web Mercator; under any other projection they cannot be made to line
 * up with the data without resampling each image, so the mark draws nothing and
 * dev-warns rather than quietly showing a misregistered map.
 *
 * Attribution is a licence condition of every tile service (OSM's included), so
 * it is drawn by default — pass `attribution: null` only if you are rendering the
 * credit yourself. Public OSM tiles are rate-limited and not for heavy production
 * traffic: see the OSM tile usage policy and use your own server or a paid
 * provider when you ship.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoTile(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoTile', allow: ['url', 'subdomains', 'tileSize', 'minZoom', 'maxZoom', 'zoomOffset', 'attribution', 'attributionSize'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        subdomains = [],
        tileSize = 256,
        minZoom = 0,
        maxZoom = 19,
        zoomOffset = 0,
        opacity,
        attribution = '© OpenStreetMap contributors',
        attributionSize = 9,
    } = opts;

    return {
        ...markCommon(opts),
        markName: 'geoTile',
        channels,
        // Verbatim — map chrome rarely edits, but dropping these after normalize
        // made geoTile the only mark that silently discarded author-supplied edits.
        supportsGeo: true,
        /**
         * @param {any[]} _currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (_currentData, scales, width, height) => {
            const projection = projectionOf(scales);
            if (!projection) return [];

            const cover = tileCover(projection, width, height, {
                tileSize, minZoom, maxZoom, zoomOffset,
            });
            if (!cover) {
                warnTilesNeedMercator();
                return [];
            }

            /** @type {import('../types').FeatureNode[]} */
            const nodes = cover.tiles.map((t) => ({
                type: 'image',
                x: t.px,
                y: t.py,
                // Half-pixel overdraw: adjacent tiles land on fractional pixels at a
                // fitted (non-power-of-two) scale, and without it the seams show as
                // hairlines through the map.
                width: t.size + 0.5,
                height: t.size + 0.5,
                href: tileUrl(url, t, subdomains),
                opacity,
                background: true,
                pointerEvents: 'none',
                key: t.key,
            }));

            if (attribution) {
                nodes.push({
                    type: 'text',
                    x: width - 4,
                    y: height - 4,
                    text: attribution,
                    fontSize: attributionSize,
                    textAnchor: 'end',
                    lineAnchor: 'bottom',
                    dominantBaseline: 'text-after-edge',
                    fill: '#334155',
                    pointerEvents: 'none',
                });
            }
            return nodes;
        },
    };
}

/**
 * Points at lon/lat. Pair with `edit.geo.move` / `edit.geo.create`.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoPoint(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoPoint', allow: ['shape'] });
    const { channels = {}, id, edits, constraints } = opts;
    const lonKey = fieldOf(channels, 'lon') || 'lon';
    const latKey = fieldOf(channels, 'lat') || 'lat';

    return {
        ...markCommon(opts),
        markName: 'geoPoint',
        channels,
        supportsGeo: true,
        lonKey,
        latKey,
        xKey: lonKey,
        yKey: latKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const projection = projectionOf(scales);
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const geoDefaults = markDefaults(scales, 'geoPoint', { fill: themeOf(scales).ink });
            currentData.forEach((d, i) => {
                const lon = channels.lon ? (d[lonKey]) : d.lon;
                const lat = channels.lat ? (d[latKey]) : d.lat;
                const pt = projectPoint(projection, lon, lat);
                if (!pt) return;
                const style = resolveStyle(scales, channels, d, geoDefaults, i, currentData);
                nodes.push({
                    type: 'circle',
                    cx: pt.x,
                    cy: pt.y,
                    r: encodeChannel(scales, channels, 'size', d, 5, i, currentData),
                    ...style,
                    data: d,
                    index: i,
                });
            });
            return nodes;
        },
    };
}

/**
 * Polygons / MultiPolygons from a geometry field on each row.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoPolygon(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoPolygon', allow: [] });
    const { channels = {}, id, edits, constraints } = opts;
    const geomKey = fieldOf(channels, 'geometry') || 'geometry';

    return {
        ...markCommon(opts),
        markName: 'geoPolygon',
        channels,
        supportsGeo: true,
        geometryKey: geomKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {
            const projection = projectionOf(scales);
            if (!projection) return [];
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            currentData.forEach((d, i) => {
                const geometry = d[geomKey];
                if (!geometry) return;
                const pathD = projection.path(geometry);
                if (!pathD) return;
                const style = resolveStyle(scales, channels, d, {
                    fill: '#93c5fd',
                    stroke: '#1e3a8a',
                    strokeWidth: 0.75,
                });
                nodes.push({
                    type: 'path',
                    d: pathD,
                    ...style,
                    data: d,
                    index: i,
                });
            });
            return nodes;
        },
    };
}

/**
 * Order a series' rows for connection.
 *   'sequence'  -> array order as drawn (the connected-scatter default)
 *   <field>     -> ascending by that field (a timestamp, a rank, …)
 * @param {{ d: any, i: number, x: number, y: number }[]} group
 * @param {string} order
 * @returns {{ d: any, i: number, x: number, y: number }[]}
 */
function orderRows(group, order) {
    if (!order || order === 'sequence') return group;
    return group.slice().sort((a, b) => {
        const av = a.d[order], bv = b.d[order];
        if (av == null || bv == null) return 0;
        return av < bv ? -1 : av > bv ? 1 : 0;
    });
}

/**
 * A line over geographic positions. Two shapes, picked by the channels:
 *
 *   coordinates / geometry  -> ONE LINE PER ROW. Each row carries its own vertex
 *                              list ([[lon,lat], …]) or LineString geometry. Pair
 *                              with edit.geo.draw / edit.geo.dragVertex; vertex
 *                              handles carry `channel: 'vertex'` + `vertexIndex`.
 *
 *   lon / lat               -> ONE PATH ACROSS ROWS, connecting the dataset's
 *                              points in `order` (default 'sequence'), grouped by
 *                              `series`. This is the geographic connected scatter
 *                              — the geo sibling of the `path` mark. Put the
 *                              draggable dots on a sibling geoPoint mark and the
 *                              trail re-derives on every render.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoLine(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoLine', allow: ['curve', 'handles', 'handleSize', 'handleColor', 'order', 'showVertices', 'series', 'z'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        curve = 'linear',
        handles = true,
        handleSize,
        handleColor,
    } = opts;
    const coordsKey = fieldOf(channels, 'coordinates') || 'coordinates';
    const geomKey = fieldOf(channels, 'geometry') || null;

    // Row-connecting mode: positions come one-per-row off lon/lat.
    const rowMode = !!(channels.lon && channels.lat);
    const lonKey = fieldOf(channels, 'lon') || 'lon';
    const latKey = fieldOf(channels, 'lat') || 'lat';
    const seriesField = seriesFieldOf(opts, channels);
    const order = opts.order || 'sequence';
    // Per-row lines own their vertices; a connected scatter's dots belong to a
    // sibling geoPoint (so they can be dragged independently).
    const showVertices = opts.showVertices != null ? opts.showVertices : !rowMode;

    if (rowMode) {
        return {
            ...markCommon(opts),
            markName: 'geoLine',
            channels,
            supportsGeo: true,
            lonKey,
            latKey,
            xKey: lonKey,
            yKey: latKey,
            seriesKey: seriesField,
            order,
            supportsSeries: true,
            /**
             * @param {any[]} currentData
             * @param {import('../types').ScaleMap} scales
             * @returns {import('../types').FeatureNode[]}
             */
            build: (currentData, scales) => {
                const projection = projectionOf(scales);
                if (!projection) return [];

                /** @type {{ d: any, i: number, x: number, y: number, series: any }[]} */
                const placed = [];
                currentData.forEach((d, i) => {
                    const pt = projectPoint(projection, d[lonKey], d[latKey]);
                    if (!pt) return;
                    placed.push({ d, i, x: pt.x, y: pt.y, series: seriesField ? d[seriesField] : SINGLE });
                });

                /** @type {Map<any, any[]>} */
                const groups = new Map();
                for (const p of placed) {
                    const g = groups.get(p.series);
                    if (g) g.push(p); else groups.set(p.series, [p]);
                }

                /** @type {import('../types').FeatureNode[]} */
                const nodes = [];
                const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
                for (const group of groups.values()) {
                    if (group.length < 2) continue; // nothing to connect
                    const pts = orderRows(group, order);
                    const style = resolveStyle(scales, channels, group[0].d, {
                        stroke: '#1d4ed8',
                        strokeWidth: 2,
                    });
                    nodes.push({
                        type: 'path',
                        points: pts.map((p) => /** @type {[number, number]} */ ([p.x, p.y])),
                        curve,
                        ...style,
                        // A stroked trail, never a filled blob. No pointerEvents set
                        // here: with no direct-pick edit the engine silences the mark,
                        // which keeps a sibling geoPoint's dots grabbable through it.
                        fill: 'none',
                    });
                }

                if (showVertices) {
                    placed.forEach((p) => {
                        nodes.push({
                            type: 'circle',
                            cx: p.x,
                            cy: p.y,
                            r: handleStyle.size,
                            fill: handleStyle.visible ? handleStyle.fill : 'transparent',
                            stroke: '#fff',
                            strokeWidth: 1,
                            data: p.d,
                            index: p.i,
                        });
                    });
                }
                return nodes;
            },
        };
    }

    return {
        ...markCommon(opts),
        markName: 'geoLine',
        channels,
        supportsGeo: true,
        coordinatesKey: coordsKey,
        geometryKey: geomKey,
        supportsSeries: false,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {
            const projection = projectionOf(scales);
            if (!projection) return [];
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            currentData.forEach((d, i) => {
                /** @type {[number, number][] | null} */
                let coords = null;
                if (geomKey && d[geomKey] && d[geomKey].coordinates) {
                    const g = d[geomKey];
                    coords = g.type === 'LineString' ? g.coordinates
                        : g.type === 'MultiLineString' ? g.coordinates.flat()
                            : null;
                }
                if (!coords && Array.isArray(d[coordsKey])) coords = d[coordsKey];
                if (!coords || !coords.length) return;

                const geometry = { type: 'LineString', coordinates: coords };
                const pathD = projection.path(geometry);
                const style = resolveStyle(scales, channels, d, {
                    fill: 'none',
                    stroke: '#1d4ed8',
                    strokeWidth: 2,
                });
                if (pathD) {
                    nodes.push({
                        type: 'path',
                        d: pathD,
                        ...style,
                        fill: 'none',
                        data: d,
                        index: i,
                        pointerEvents: 'stroke',
                    });
                }

                if (showVertices) {
                    coords.forEach((c, vi) => {
                        const pt = projectPoint(projection, c[0], c[1]);
                        if (!pt) return;
                        nodes.push({
                            type: 'circle',
                            cx: pt.x,
                            cy: pt.y,
                            r: handleStyle.size,
                            fill: handleStyle.visible ? (handleColor || style.stroke || handleStyle.fill) : 'transparent',
                            stroke: '#fff',
                            strokeWidth: 1,
                            data: d,
                            index: i,
                            channel: 'vertex',
                            vertexIndex: vi,
                        });
                    });
                }
            });
            return nodes;
        },
    };
}

/**
 * Labels at lon/lat — the geographic sibling of `text`. Position is the ONLY thing
 * a projection changes about a label, so everything else (the string, font,
 * anchors, angle, dx/dy nudge, the editText opt-in, style) comes from the shared
 * `textNodeAt` in text.js rather than a second copy here.
 *
 * That means a geoText is editable exactly like a cartesian one:
 *   editText()      — double-click to retype the label's content
 *   edit.geo.move() — drag the label to a new lon/lat
 *   cycle()         — click to advance a categorical label
 * `dx`/`dy` nudge the glyph off the anchor point (e.g. dy: -12 to sit a name above
 * a geoPoint's dot) without moving the lon/lat a drag would write.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoText(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoText', allow: ['format'] });
    const { channels = {}, id, edits, constraints, format: formatOpt } = opts;
    const lonKey = fieldOf(channels, 'lon') || 'lon';
    const latKey = fieldOf(channels, 'lat') || 'lat';
    const canEditText = hasEditText(edits, channels);
    const format = resolveFormat(formatOpt);

    return {
        ...markCommon(opts),
        markName: 'geoText',
        channels,
        supportsGeo: true,
        lonKey,
        latKey,
        xKey: lonKey,
        yKey: latKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {
            const projection = projectionOf(scales);
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            currentData.forEach((d, i) => {
                const pt = projectPoint(projection, d[lonKey], d[latKey]);
                if (!pt) return;
                nodes.push(textNodeAt(scales, channels, d, i, pt.x, pt.y, { format, canEditText, data: currentData }));
            });
            return nodes;
        },
    };
}

/**
 * Geographic axis-aligned bbox as west/south/east/north.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoRect(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoRect', allow: [] });
    const { channels = {}, id, edits, constraints } = opts;
    const westKey = fieldOf(channels, 'west') || 'west';
    const southKey = fieldOf(channels, 'south') || 'south';
    const eastKey = fieldOf(channels, 'east') || 'east';
    const northKey = fieldOf(channels, 'north') || 'north';

    return {
        ...markCommon(opts),
        markName: 'geoRect',
        channels,
        supportsGeo: true,
        westKey,
        southKey,
        eastKey,
        northKey,
        xKey: westKey,
        yKey: southKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {
            const projection = projectionOf(scales);
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            currentData.forEach((d, i) => {
                const w0 = d[westKey], s0 = d[southKey];
                const e0 = d[eastKey], n0 = d[northKey];
                if (w0 == null || s0 == null || e0 == null || n0 == null) return;
                // Draw min/max, so a box the user dragged inside-out (west past
                // east) still renders as a box. Without this the ring winds
                // backwards and d3 fills its complement — the whole frame.
                const west = Math.min(w0, e0), east = Math.max(w0, e0);
                const south = Math.min(s0, n0), north = Math.max(s0, n0);
                const box = projectBounds(projection, west, south, east, north);
                if (!box || box.width <= 0 || box.height <= 0) return;
                const style = resolveStyle(scales, channels, d, {
                    fill: 'rgba(37, 99, 235, 0.2)',
                    stroke: '#1d4ed8',
                    strokeWidth: 1.5,
                });
                // Also emit a geographic ring path so the visual follows the
                // projection (curved under Mercator); the rect node is the
                // hit-target / brush AABB.
                // Ring winding matters: d3-geo reads a reversed exterior ring as
                // the *complement* of the polygon, which fills the whole frame and
                // leaves the box itself blank.
                const ring = {
                    type: 'Polygon',
                    coordinates: [[
                        [west, south], [west, north], [east, north], [east, south], [west, south],
                    ]],
                };
                const pathD = projection && projection.path(ring);
                if (pathD) {
                    nodes.push({
                        type: 'path',
                        d: pathD,
                        ...style,
                        data: d,
                        index: i,
                        pointerEvents: 'none',
                    });
                }
                nodes.push({
                    type: 'rect',
                    x: box.x,
                    y: box.y,
                    width: box.width,
                    height: box.height,
                    fill: 'transparent',
                    stroke: 'transparent',
                    data: d,
                    index: i,
                });
            });
            return nodes;
        },
    };
}
