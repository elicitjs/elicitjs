// @ts-check
// geo.js — geographic marks. Position goes through the chart's projection
// (`scales.projection`), not x/y scales; style channels are ordinary. A basemap's
// topology is a mark option; editable geometry lives in the dataset.
//
//   geoBasemap  — inert GeoJSON chrome (background)
//   geoTile     — inert raster tiles (Web Mercator only)
//   geoPoint    — lon/lat circles
//   geoPolygon  — GeoJSON geometries from rows
//   geoLine     — per-row vertex lists, or a trail across rows
//   geoText     — labels at lon/lat
//   geoRect     — geographic box (west/south/east/north)

import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, resolveHandles, markCommon, rawChannel, orderFieldOf, seriesKeyOf } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { textNodeAt, TEXT_RAW_CHANNELS } from './text.js';
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
 * Inert basemap from static GeoJSON passed as the `geojson` option (a
 * FeatureCollection, Feature, GeometryCollection or Geometry). A FeatureCollection
 * draws one path per feature.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoBasemap(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'geoBasemap', allow: MARK_OPTIONS.geoBasemap,
        // Basemap paint is chrome with no datum, so it stays a plain option, not a channel.
        except: ['stroke', 'strokeWidth', 'fill'],
    });
    const {
        channels = {},
        geojson,
        stroke = '#94a3b8',
        strokeWidth = 0.75,
        fill = '#e2e8f0',
    } = opts;
    const object = geojson || null;

    return {
        ...markCommon(opts),
        type: 'geoBasemap',
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

            // One path per Feature.
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
 * Raster tile basemap from a tile server. Inert chrome, like geoBasemap.
 *
 *   geoTile()                                   // OSM standard
 *   geoTile({ url: "https://…/{z}/{x}/{y}.png", attribution: "…" })
 *   geoTile({ url: (t) => `…/${t.z}/${t.x}/${t.y}.png` })
 *
 * Requires `projection: "mercator"` (unrotated); under any other projection it
 * draws nothing and warns. Attribution is drawn by default, since tile services
 * require it; pass `attribution: null` only if you credit them yourself. Public
 * OSM tiles are rate-limited: use your own server or a paid provider in production.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoTile(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoTile', allow: MARK_OPTIONS.geoTile,
        // Tile opacity is chrome, like a basemap's paint.
        except: ['opacity'] });
    const {
        channels = {},
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
        type: 'geoTile',
        channels,
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
                // Half-pixel overdraw hides seams between tiles at fractional pixels.
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
    const opts = normalizeMarkOptions(options, { mark: 'geoPoint', allow: MARK_OPTIONS.geoPoint });
    const { channels = {} } = opts;
    const lonKey = fieldOf(channels, 'lon') || 'lon';
    const latKey = fieldOf(channels, 'lat') || 'lat';

    return {
        ...markCommon(opts),
        type: 'geoPoint',
        channels,
        // Coordinates are read raw (projected, never scaled).
        rawChannels: ['lon', 'lat'],
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
                // Read raw, so a field, `{ fn }`, `{ value }` or `{ datum }` all work.
                const lon = rawChannel(channels, 'lon', d, d[lonKey], i, currentData);
                const lat = rawChannel(channels, 'lat', d, d[latKey], i, currentData);
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
    const opts = normalizeMarkOptions(options, { mark: 'geoPolygon', allow: MARK_OPTIONS.geoPolygon });
    const { channels = {} } = opts;
    const geomKey = fieldOf(channels, 'geometry') || 'geometry';

    return {
        ...markCommon(opts),
        type: 'geoPolygon',
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
                }, i, currentData);
                nodes.push({
                    type: 'path',
                    d: pathD,
                    ...style,
                    data: d,
                    index: i,
                    // The region in lon/lat, so the pick layer can test containment.
                    geoShape: geometry,
                });
            });
            return nodes;
        },
    };
}

/**
 * Order a series' rows for connection: by the `order` channel's column when one is
 * given, else array order as drawn (a geo trail's natural default).
 * @template {{ d: any }} P
 * @param {P[]} group
 * @param {Record<string, any>} channels
 * @returns {P[]}
 */
function orderRows(group, channels) {
    const field = orderFieldOf(channels);
    if (!field) return group;
    return group.slice().sort((a, b) => {
        const av = a.d[field], bv = b.d[field];
        if (av == null || bv == null) return 0;
        return av < bv ? -1 : av > bv ? 1 : 0;
    });
}

/**
 * A line over geographic positions. Two forms, picked by the channels:
 *
 *   coordinates / geometry  -> one line per row, from its vertex list ([[lon,lat], …])
 *                              or LineString geometry. Vertex handles carry
 *                              `channel: 'vertex'` + `vertexIndex` (edit.geo.dragVertex).
 *
 *   lon / lat               -> one trail across rows per `series`, ordered by the
 *                              `order` channel, else array order. Put draggable dots
 *                              on a sibling geoPoint.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoLine(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoLine', allow: MARK_OPTIONS.geoLine });
    const {
        channels = {},
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
    const seriesField = seriesFieldOf(channels);
    const connect = opts.connect || 'sequence';
    // Per-row lines show their vertices; a trail's dots belong to a sibling geoPoint.
    const showVertices = opts.showVertices != null ? opts.showVertices : !rowMode;
    // Defaulted vertices are row handles (dropped where no edit reaches the row);
    // explicit `showVertices: true` draws them as ink.
    const vertexHandles = opts.showVertices == null;

    if (rowMode) {
        return {
            ...markCommon(opts),
            type: 'geoLine',
            channels,
            // Read raw (no scale), like `line`'s / `area`'s / `link`'s.
            rawChannels: ['curve', 'series', 'order', 'lon', 'lat'],
            supportsGeo: true,
            lonKey,
            latKey,
            xKey: lonKey,
            yKey: latKey,
            seriesKey: seriesField,
            connect,
            supportsSeries: true,
            /**
             * @param {any[]} currentData
             * @param {import('../types').ScaleMap} scales
             * @returns {import('../types').FeatureNode[]}
             */
            build: (currentData, scales) => {
                const projection = projectionOf(scales);
                if (!projection) return [];

                /** @type {{ d: any, i: number, x: number, y: number, lon: any, lat: any, series: any }[]} */
                const placed = [];
                currentData.forEach((d, i) => {
                    const lon = rawChannel(channels, 'lon', d, d[lonKey], i, currentData);
                    const lat = rawChannel(channels, 'lat', d, d[latKey], i, currentData);
                    const pt = projectPoint(projection, lon, lat);
                    if (!pt) return;
                    placed.push({ d, i, x: pt.x, y: pt.y, lon, lat, series: seriesField ? d[seriesField] : SINGLE });
                });

                // Grouped by key (a Date by its time), tagged with the first raw value.
                /** @type {Map<any, any[]>} */
                const groups = new Map();
                for (const p of placed) {
                    const k = seriesKeyOf(p.series);
                    const g = groups.get(k);
                    if (g) { g.push(p); p.series = g[0].series; } else groups.set(k, [p]);
                }

                /** @type {import('../types').FeatureNode[]} */
                const nodes = [];
                const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
                for (const group of groups.values()) {
                    if (group.length < 2) continue; // nothing to connect
                    const pts = orderRows(group, channels);
                    const style = resolveStyle(scales, channels, group[0].d, {
                        stroke: '#1d4ed8',
                        strokeWidth: 2,
                    }, group[0].i, currentData);
                    // `curve` resolves once per series, against its first row.
                    const seriesCurve = String(
                        rawChannel(channels, 'curve', group[0].d, curve, group[0].i, currentData));
                    if (seriesCurve !== 'linear') {
                        warn(
                            'geoLine:curve',
                            'geoLine: a trail follows the projection (great circles, clipped at the ' +
                            'antimeridian), so `curve` does not apply to it and is ignored.'
                        );
                    }
                    // A geographic line (great circles, antimeridian clipping) via
                    // d3-geo; `points` stay for the pick layer and the canvas.
                    const geometry = { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) };
                    const pathD = projection.path(geometry);
                    nodes.push({
                        type: 'path',
                        ...(pathD ? { d: pathD } : {}),
                        points: pts.map((p) => /** @type {[number, number]} */ ([p.x, p.y])),
                        curve: seriesCurve,
                        ...style,
                        // No pointerEvents: the engine silences an uneditable trail,
                        // keeping a sibling geoPoint's dots grabbable.
                        fill: 'none',
                    });
                }

                if (showVertices && handleStyle.grabbable) {
                    placed.forEach((p) => {
                        nodes.push({
                            type: 'circle',
                            cx: p.x,
                            cy: p.y,
                            r: handleStyle.size,
                            fill: handleStyle.fill,
                            stroke: handleStyle.stroke,
                            strokeWidth: handleStyle.visible ? 1 : 0,
                            data: p.d,
                            index: p.i,
                            rowHandle: vertexHandles,
                        });
                    });
                }
                return nodes;
            },
        };
    }

    return {
        ...markCommon(opts),
        type: 'geoLine',
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
                }, i, currentData);
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

                if (showVertices && handleStyle.grabbable) {
                    coords.forEach((c, vi) => {
                        const pt = projectPoint(projection, c[0], c[1]);
                        if (!pt) return;
                        nodes.push({
                            type: 'circle',
                            cx: pt.x,
                            cy: pt.y,
                            r: handleStyle.size,
                            fill: handleStyle.visible ? (handleColor || style.stroke || handleStyle.fill) : 'transparent',
                            stroke: handleStyle.stroke,
                            strokeWidth: handleStyle.visible ? 1 : 0,
                            data: d,
                            index: i,
                            channel: 'vertex',
                            vertexIndex: vi,
                            rowHandle: vertexHandles,
                        });
                    });
                }
            });
            return nodes;
        },
    };
}

/**
 * Labels at lon/lat. Only the position is projected; everything else comes from
 * `textNodeAt` (text.js), so editText(), edit.geo.move() and cycle() work as on
 * `text`. `dx`/`dy` nudge the glyph without moving its lon/lat.
 *
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoText(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoText', allow: MARK_OPTIONS.geoText });
    const { channels = {}, format: formatOpt } = opts;
    const lonKey = fieldOf(channels, 'lon') || 'lon';
    const latKey = fieldOf(channels, 'lat') || 'lat';
    const format = resolveFormat(formatOpt);

    return {
        ...markCommon(opts),
        type: 'geoText',
        channels,
        rawChannels: ['lon', 'lat', ...TEXT_RAW_CHANNELS],
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
                const lon = rawChannel(channels, 'lon', d, d[lonKey], i, currentData);
                const lat = rawChannel(channels, 'lat', d, d[latKey], i, currentData);
                const pt = projectPoint(projection, lon, lat);
                if (!pt) return;
                nodes.push(textNodeAt(scales, channels, d, i, pt.x, pt.y, { format, data: currentData }));
            });
            return nodes;
        },
    };
}

/**
 * A geographic box from west/south/east/north.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function geoRect(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'geoRect', allow: MARK_OPTIONS.geoRect });
    const { channels = {} } = opts;
    const westKey = fieldOf(channels, 'west') || 'west';
    const southKey = fieldOf(channels, 'south') || 'south';
    const eastKey = fieldOf(channels, 'east') || 'east';
    const northKey = fieldOf(channels, 'north') || 'north';

    return {
        ...markCommon(opts),
        type: 'geoRect',
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
                // Normalise, so a box dragged inside-out still draws as a box.
                const west = Math.min(w0, e0), east = Math.max(w0, e0);
                const south = Math.min(s0, n0), north = Math.max(s0, n0);
                const box = projectBounds(projection, west, south, east, north);
                if (!box || box.width <= 0 || box.height <= 0) return;
                const style = resolveStyle(scales, channels, d, {
                    fill: 'rgba(37, 99, 235, 0.2)',
                    stroke: '#1d4ed8',
                    strokeWidth: 1.5,
                }, i, currentData);
                // The visible ring follows the projection; the rect below is the hit
                // target. Winding matters: d3-geo fills a reversed ring's complement.
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
