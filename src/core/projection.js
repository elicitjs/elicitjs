// @ts-check
// projection.js — chart-level geographic projection context (Observable Plot model).
//
// A projection is NOT a 1D scale kind. When `spec.projection` is set, geo marks
// place lon/lat / GeoJSON through this object instead of through x/y scales.
// Encode and edit share one contract:
//   apply([lon, lat])  → [x, y] | null
//   invert([x, y])     → [lon, lat] | null
//   path(geometry)     → SVG path `d` string
//
// Named projections and fit/domain options mirror Plot's createProjection so
// authors can pass `"mercator"`, `{ type, domain, rotate, … }`, or a live
// d3.geo* instance.

import * as d3 from 'd3';
import { warn, warningsEnabled } from './dev.js';

/**
 * @typedef {{
 *   apply: (p: [number, number]) => [number, number] | null,
 *   invert: (p: [number, number]) => [number, number] | null,
 *   path: (object?: any) => string | null,
 *   invertible: boolean,
 *   raw: any
 * }} ProjectionContext
 */

/**
 * @typedef {{
 *   type?: string | Function,
 *   domain?: any,
 *   rotate?: [number, number] | [number, number, number],
 *   parallels?: [number, number],
 *   precision?: number,
 *   clipAngle?: number,
 *   inset?: number,
 *   insetTop?: number,
 *   insetRight?: number,
 *   insetBottom?: number,
 *   insetLeft?: number,
 *   [k: string]: any
 * }} ProjectionOptions
 */

/**
 * Named projection factories. Aspect constants match Plot's scaleProjection
 * defaults (world extents → frame).
 * @type {Record<string, () => any>}
 */
const NAMED = {
    'albers-usa': () => d3.geoAlbersUsa(),
    albers: () => d3.geoAlbers(),
    'azimuthal-equal-area': () => d3.geoAzimuthalEqualArea(),
    'azimuthal-equidistant': () => d3.geoAzimuthalEquidistant(),
    'conic-conformal': () => d3.geoConicConformal(),
    'conic-equal-area': () => d3.geoConicEqualArea(),
    'conic-equidistant': () => d3.geoConicEquidistant(),
    'equal-earth': () => d3.geoEqualEarth(),
    equirectangular: () => d3.geoEquirectangular(),
    gnomonic: () => d3.geoGnomonic(),
    mercator: () => d3.geoMercator(),
    orthographic: () => d3.geoOrthographic(),
    stereographic: () => d3.geoStereographic(),
    'transverse-mercator': () => d3.geoTransverseMercator(),
    identity: () => d3.geoIdentity(),
};

/**
 * @param {string | Function | any} type
 * @returns {any}
 */
function instantiate(type) {
    if (typeof type === 'function' && typeof type.stream !== 'function') {
        // A factory (d3.geoMercator) rather than an instance.
        return type();
    }
    if (typeof type === 'string') {
        const key = type.toLowerCase();
        const factory = NAMED[key];
        if (!factory) throw new Error(`[elicit] unknown projection type: ${type}`);
        return factory();
    }
    // Live d3 projection (has .stream).
    return type;
}

/**
 * Domains already checked for ring winding. Kept as a WeakSet rather than folded
 * into dev.js's string-keyed dedup because the check itself costs a `d3.geoArea`
 * per polygon on every render — this remembers the WORK, not just the message.
 */
const warnedDomains = new WeakSet();

/**
 * d3-geo reads a reversed exterior ring as the *complement* of the polygon: its
 * area becomes the whole sphere, so `fitExtent` fits the world instead of the
 * region and every correctly-wound feature collapses to a sub-pixel dot. Silent
 * and baffling — so say it out loud.
 * @param {any} domain
 * @param {string | undefined} type the projection type
 */
function warnInvertedRings(domain, type) {
    if (!warningsEnabled()) return;
    // Ring winding is a SPHERICAL rule: `d3.geoArea` on planar coordinates (an
    // `identity` projection over pre-projected GeoJSON) measures nothing a ring's
    // direction says, and reported every planar map as inverted.
    if (type === 'identity') return;
    if (!domain || typeof domain !== 'object' || warnedDomains.has(domain)) return;
    warnedDomains.add(domain);

    const list = domain.type === 'FeatureCollection' && Array.isArray(domain.features)
        ? domain.features
        : [domain];
    const inverted = list.filter((/** @type {any} */ f) => {
        const g = f && f.type === 'Feature' ? f.geometry : f;
        if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return false;
        return d3.geoArea(g) > Math.PI; // a sane region never covers half the globe
    });
    if (!inverted.length) return;

    const names = inverted
        .map((/** @type {any} */ f, /** @type {number} */ i) =>
            (f.properties && (f.properties.name || f.properties.NAME)) || `feature ${i}`)
        .slice(0, 3);
    warn(
        `rings:${names.join(',')}`,
        `projection domain has ${inverted.length} polygon(s) with reversed ring ` +
        `winding (${names.join(', ')}${inverted.length > 3 ? ', …' : ''}). d3 reads these as ` +
        `covering the whole globe, so the map fits the world and your features shrink to a dot. ` +
        `Rewind the exterior rings counterclockwise (RFC 7946).`
    );
}

/**
 * Wrap a fitted/translated d3 projection in the chart's apply/invert/path API.
 * @param {any} projection
 * @returns {ProjectionContext}
 */
function expose(projection) {
    const path = d3.geoPath(projection);
    const invertible = typeof projection.invert === 'function';
    return {
        apply(p) {
            if (!p || p[0] == null || p[1] == null) return null;
            const out = projection(p);
            if (!out || out[0] == null || out[1] == null) return null;
            if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) return null;
            return /** @type {[number, number]} */ (out);
        },
        invert(p) {
            if (!invertible || !p || p[0] == null || p[1] == null) return null;
            const out = projection.invert(p);
            if (!out || out[0] == null || out[1] == null) return null;
            if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) return null;
            return /** @type {[number, number]} */ (out);
        },
        path(object) {
            if (object == null) return null;
            return path(object);
        },
        invertible,
        raw: projection
    };
}

/**
 * Build the chart's projection context from `spec.projection` and the plot frame.
 * Returns null when no projection is configured.
 *
 * @param {string | ProjectionOptions | any | null | undefined} projectionOpt
 * @param {{ width: number, height: number }} dims inner plot size (margins already subtracted)
 * @returns {ProjectionContext | null}
 */
export function createProjection(projectionOpt, dims) {
    if (projectionOpt == null) return null;

    // Already a ProjectionContext (re-entrant / test helper).
    if (typeof projectionOpt === 'object'
        && typeof projectionOpt.apply === 'function'
        && typeof projectionOpt.invert === 'function'
        && projectionOpt.raw) {
        return /** @type {ProjectionContext} */ (projectionOpt);
    }

    // Live d3 projection passed directly.
    if (typeof projectionOpt === 'function' && typeof projectionOpt.stream === 'function') {
        return expose(projectionOpt);
    }
    if (typeof projectionOpt === 'object' && typeof projectionOpt.stream === 'function') {
        return expose(projectionOpt);
    }

    /** @type {ProjectionOptions} */
    let options = {};
    /** @type {string | Function | any} */
    let type = projectionOpt;
    let domain;
    let inset = 0;
    let insetTop, insetRight, insetBottom, insetLeft;

    if (typeof projectionOpt === 'object' && projectionOpt !== null) {
        ({
            type,
            domain,
            inset = 0,
            insetTop = inset,
            insetRight = inset,
            insetBottom = inset,
            insetLeft = inset,
            ...options
        } = { type: undefined, domain: undefined, ...projectionOpt });
        if (type == null && typeof projectionOpt.stream === 'function') {
            return expose(projectionOpt);
        }
        if (type == null) return null;
    } else {
        insetTop = insetRight = insetBottom = insetLeft = 0;
    }

    const projection = instantiate(type);
    const {
        rotate,
        parallels,
        precision = 0.15,
        clipAngle,
    } = options;

    if (precision != null && typeof projection.precision === 'function') {
        projection.precision(precision);
    }
    if (rotate != null && typeof projection.rotate === 'function') {
        projection.rotate(rotate);
    }
    if (parallels != null && typeof projection.parallels === 'function') {
        projection.parallels(parallels);
    }
    if (clipAngle != null && typeof projection.clipAngle === 'function') {
        projection.clipAngle(clipAngle);
    }

    const width = Math.max(0, dims.width - (insetLeft || 0) - (insetRight || 0));
    const height = Math.max(0, dims.height - (insetTop || 0) - (insetBottom || 0));

    if (domain != null && typeof projection.fitExtent === 'function') {
        warnInvertedRings(domain, type);
        projection.fitExtent(
            [[insetLeft || 0, insetTop || 0], [(insetLeft || 0) + width, (insetTop || 0) + height]],
            domain
        );
    } else if (typeof projection.fitSize === 'function') {
        // Default fit: unit sphere / world, then nudge by insets via translate.
        try {
            projection.fitSize([width, height], { type: 'Sphere' });
        } catch {
            // Some projections (albers-usa) reject Sphere; leave default scale.
        }
        if ((insetLeft || 0) || (insetTop || 0)) {
            const t = projection.translate();
            projection.translate([t[0] + (insetLeft || 0), t[1] + (insetTop || 0)]);
        }
    }

    return expose(projection);
}

/**
 * Project a lon/lat pair through the chart projection. Returns null if missing.
 * @param {ProjectionContext | null | undefined} projection
 * @param {number} lon
 * @param {number} lat
 * @returns {{ x: number, y: number } | null}
 */
export function projectPoint(projection, lon, lat) {
    if (!projection || lon == null || lat == null) return null;
    const xy = projection.apply([+lon, +lat]);
    if (!xy) return null;
    return { x: xy[0], y: xy[1] };
}

/**
 * Invert a plot-pixel pointer to lon/lat. Returns null outside the projection.
 * @param {ProjectionContext | null | undefined} projection
 * @param {{ x: number, y: number }} pointer
 * @returns {{ lon: number, lat: number } | null}
 */
export function invertPoint(projection, pointer) {
    if (!projection || !pointer) return null;
    const ll = projection.invert([pointer.x, pointer.y]);
    if (!ll) return null;
    return { lon: ll[0], lat: ll[1] };
}

/**
 * Geographic AABB → screen rectangle (axis-aligned in pixel space from the four
 * projected corners). Lon/lat boxes appear curved under Mercator; the node is
 * the AABB of the projected corners — good enough for handles and brush hit-tests.
 * @param {ProjectionContext | null | undefined} projection
 * @param {number} west
 * @param {number} south
 * @param {number} east
 * @param {number} north
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function projectBounds(projection, west, south, east, north) {
    if (!projection) return null;
    const corners = [
        projectPoint(projection, west, south),
        projectPoint(projection, west, north),
        projectPoint(projection, east, south),
        projectPoint(projection, east, north),
    ];
    if (corners.some((c) => !c)) return null;
    const xs = corners.map((c) => /** @type {{ x: number, y: number }} */ (c).x);
    const ys = corners.map((c) => /** @type {{ x: number, y: number }} */ (c).y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
