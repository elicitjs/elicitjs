// @ts-check
// trendGeometry.js: geometry of a parametric line and its uncertainty band, shared
// by `trend` and `trendBand`. Pure maths: numbers and pixel points, no scene nodes.
//
// The line is y(x) = intercept + slope · x. The band is the family
// { α + β·x : α ∈ [aLo, aHi], β ∈ [bLo, bHi] }, whose envelope is
//
//     upper(x) = aHi + max(bLo·x, bHi·x)
//     lower(x) = aLo + min(bLo·x, bHi·x)
//
// It has one kink at x = 0, so sampling at { x0, 0, x1 } gives the polygon exactly.
//
// The uncertainty is either a half-width (`interceptSpread` / `slopeSpread`) or a
// range (`intercept1`/`intercept2`, `slope1`/`slope2`); the range wins. Parameter
// channels are unscaled (`scale: null`); only x and y are scales.

import { encodeChannel, encodeValue } from './mark.js';
import { warn } from '../core/dev.js';

/** The parameter channels a trend mark reads, in declaration order. */
const PARAM_CHANNELS = [
    'intercept', 'slope',
    'interceptSpread', 'slopeSpread',
    'intercept1', 'intercept2', 'slope1', 'slope2'
];

/**
 * Merge author channels over the defaults and stamp `scale: null` on every
 * parameter channel. `x` / `y` are left scaled.
 * @param {Record<string, any>} rawChannels
 * @param {Record<string, any>} [defaults] parameter defaults, e.g. { intercept: { field: 'intercept' } }
 * @returns {Record<string, any>}
 */
export function paramChannels(rawChannels, defaults = {}) {
    /** @type {Record<string, any>} */
    const merged = { x: { field: 'x' }, y: { field: 'y' }, ...defaults, ...rawChannels };
    for (const name of PARAM_CHANNELS) {
        const spec = merged[name];
        if (spec) merged[name] = { ...spec, scale: null };
    }
    return merged;
}

/**
 * A trend mark's channels: the author's over the `intercept` / `slope` column defaults.
 * @param {Record<string, any>} rawChannels
 * @returns {Record<string, any>}
 */
export function trendChannels(rawChannels) {
    return paramChannels(rawChannels, { intercept: { field: 'intercept' }, slope: { field: 'slope' } });
}

/**
 * The scale requirement both trend marks declare: the line is evaluated over two continuous axes.
 * @returns {import('../types').MarkRequirement[]}
 */
export function trendRequires() {
    return [{
        channels: ['x', 'y'],
        kind: 'continuous',
        match: 'all',
        why: 'an intercept and a slope are only defined over two continuous axes.',
    }];
}

/**
 * Warn that `probe` does nothing under the default grip.
 * @param {string} mark the factory name
 * @param {string} handle the handle `probe` would place
 * @param {string} mount where the default grip mounts the handles
 * @param {any} probe @param {string} grip
 */
export function warnProbeIgnored(mark, handle, mount, probe, grip) {
    if (probe == null || grip === 'probe') return;
    warn(`${mark}:probe-ignored`,
        `${mark}(): \`probe\` places the ${handle} handle only under \`grip: 'probe'\`. `
        + `The default grip mounts the handles on ${mount}; add `
        + "`grip: 'probe'` to pin one at that column instead.");
}

/**
 * Read one row's line (`a`, `b`) and the bounds on each. With no uncertainty
 * declared the bounds equal the line (a zero-width band).
 * @param {any} datum
 * @param {Record<string, any>} channels
 * @param {import('../types').ScaleMap} scales
 * @param {number} [index]
 * @param {any[]} [data]
 * @returns {{ a: number, b: number, aLo: number, aHi: number, bLo: number, bHi: number }}
 */
export function readParams(datum, channels, scales, index, data) {
    const read = (/** @type {string} */ name, /** @type {number} */ fallback) => {
        const v = encodeChannel(scales, channels, name, datum, fallback, index, data);
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const a = read('intercept', 0);
    const b = read('slope', 0);

    // The range form wins over the half-width. Bounds are sorted so a reversed
    // range still draws; ordering() keeps the data itself in order.
    const bound = (/** @type {string} */ param, /** @type {number} */ mid) => {
        if (channels[`${param}1`] || channels[`${param}2`]) {
            const lo = read(`${param}1`, mid);
            const hi = read(`${param}2`, mid);
            return lo <= hi ? [lo, hi] : [hi, lo];
        }
        const spread = Math.abs(read(`${param}Spread`, 0));
        return [mid - spread, mid + spread];
    };

    const [aLo, aHi] = bound('intercept', a);
    const [bLo, bHi] = bound('slope', b);
    return { a, b, aLo, aHi, bLo, bHi };
}

/**
 * The two ends of the declared x domain (not the data's extent).
 * @param {import('../types').ScaleMap} scales
 * @returns {{ x0: number, x1: number }}
 */
function domainEndsOf(scales) {
    const dom = scales.x && /** @type {any} */ (scales.x).domainConfig;
    return {
        x0: Array.isArray(dom) ? Number(dom[0]) : 0,
        x1: Array.isArray(dom) ? Number(dom[dom.length - 1]) : 1
    };
}

/**
 * The two x positions a trend's handles use.
 *   anchor — the pivot the intercept handle sits at and the slope rotates about.
 *            Defaults to 0 when in the x domain, else the domain's first end.
 *   probe  — the slope handle's column under `grip: 'probe'`. Defaults to the
 *            domain's last end.
 * @param {import('../types').ScaleMap} scales
 * @param {{ anchor?: number, probe?: number }} [opts]
 * @returns {{ anchor: number, probe: number }}
 */
export function anchorsOf(scales, opts = {}) {
    const { x0, x1 } = domainEndsOf(scales);
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    const defaultAnchor = (lo <= 0 && 0 <= hi) ? 0 : x0;
    return {
        anchor: opts.anchor != null ? Number(opts.anchor) : defaultAnchor,
        probe: opts.probe != null ? Number(opts.probe) : x1
    };
}

/** The line's value at x. @param {{a: number, b: number}} p @param {number} x */
export const valueAt = (p, x) => p.a + p.b * x;

/**
 * Clip an infinite line through (x1,y1)-(x2,y2) to the plot rectangle [0,w]×[0,h].
 * Returns the clipped segment, or null if it misses the plot entirely.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} w @param {number} h
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
function clipLineToPlot(x1, y1, x2, y2, w, h) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    // Degenerate: a point. Keep it only if it sits inside the plot.
    if (dx === 0 && dy === 0) {
        if (x1 < 0 || x1 > w || y1 < 0 || y1 > h) return null;
        return { x1, y1, x2, y2 };
    }

    // Liang–Barsky against [0,w] × [0,h], with t unbounded so the infinite line
    // reaches every plot edge.
    let t0 = -Infinity;
    let t1 = Infinity;
    /** @param {number} p @param {number} q */
    const clip = (p, q) => {
        if (p === 0) return q >= 0;
        const r = q / p;
        if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
        } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
        }
        return true;
    };

    if (!clip(-dx, x1 - 0)) return null;
    if (!clip(dx, w - x1)) return null;
    if (!clip(-dy, y1 - 0)) return null;
    if (!clip(dy, h - y1)) return null;
    if (t0 > t1) return null;

    return {
        x1: x1 + t0 * dx,
        y1: y1 + t0 * dy,
        x2: x1 + t1 * dx,
        y2: y1 + t1 * dy
    };
}

/**
 * Clip a convex polygon to the plot rectangle (Sutherland–Hodgman). A wide slope
 * range runs past the plot, and the renderer clips to the plot rect only when
 * `spec.clip` (or a viewport edit) turns it on.
 * @param {[number, number][]} points
 * @param {number} w
 * @param {number} h
 * @returns {[number, number][]}
 */
function clipPolygonToPlot(points, w, h) {
    /** @type {{ inside: (p: [number, number]) => boolean, at: (a: [number, number], b: [number, number]) => [number, number] }[]} */
    const edges = [
        { inside: (p) => p[0] >= 0, at: (a, b) => cut(a, b, 0, 0) },
        { inside: (p) => p[0] <= w, at: (a, b) => cut(a, b, 0, w) },
        { inside: (p) => p[1] >= 0, at: (a, b) => cut(a, b, 1, 0) },
        { inside: (p) => p[1] <= h, at: (a, b) => cut(a, b, 1, h) }
    ];

    /** @param {[number, number]} a @param {[number, number]} b @param {0 | 1} axis @param {number} at */
    function cut(a, b, axis, at) {
        const span = b[axis] - a[axis];
        const t = span === 0 ? 0 : (at - a[axis]) / span;
        return /** @type {[number, number]} */ ([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }

    let out = points;
    for (const edge of edges) {
        /** @type {[number, number][]} */
        const next = [];
        for (let i = 0; i < out.length; i++) {
            const cur = out[i];
            const prev = out[(i + out.length - 1) % out.length];
            const curIn = edge.inside(cur);
            const prevIn = edge.inside(prev);
            if (curIn) {
                if (!prevIn) next.push(edge.at(prev, cur));
                next.push(cur);
            } else if (prevIn) {
                next.push(edge.at(prev, cur));
            }
        }
        out = next;
        if (!out.length) return [];
    }
    return out;
}

/**
 * The line y = a + b·x clipped to the plot, extended edge to edge rather than
 * stopping at the domain ends.
 * @param {{ a: number, b: number }} params
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
export function lineSegment(params, scales, channels, width, height) {
    const { x0, x1 } = domainEndsOf(scales);
    const px = (/** @type {number} */ x) => encodeValue(scales, channels, 'x', x, 0);
    const py = (/** @type {number} */ y) => encodeValue(scales, channels, 'y', y, 0);
    return clipLineToPlot(
        px(x0), py(valueAt(params, x0)),
        px(x1), py(valueAt(params, x1)),
        width, height
    );
}

/**
 * The two ends of a clipped segment, pulled in along it by `inset` px so a grip
 * isn't half-cut by the plot edge. Skipped on a segment too short for it, where the
 * ends would cross.
 * @param {{ x1: number, y1: number, x2: number, y2: number } | null} seg
 * @param {number} [inset]
 * @returns {{ x: number, y: number }[] | null} the two ends, in the segment's own order
 */
export function segmentEnds(seg, inset = 0) {
    if (!seg) return null;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len)) return null;
    const t = (inset > 0 && len > 4 * inset) ? inset / len : 0;
    return [
        { x: seg.x1 + t * dx, y: seg.y1 + t * dy },
        { x: seg.x2 - t * dx, y: seg.y2 - t * dy }
    ];
}

/**
 * The exact envelope polygon of a line family, in plot pixels, clipped to the plot.
 * Evaluated at the x-domain ends plus x = 0 (the kink) when that lies between them.
 * @param {{ aLo: number, aHi: number, bLo: number, bHi: number }} params
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {[number, number][]}
 */
export function envelopePolygon(params, scales, channels, width, height) {
    const { aLo, aHi, bLo, bHi } = params;
    const { x0, x1 } = domainEndsOf(scales);
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);

    /** @type {number[]} */
    const xs = [lo];
    if (lo < 0 && 0 < hi) xs.push(0);
    xs.push(hi);

    const px = (/** @type {number} */ x) => encodeValue(scales, channels, 'x', x, 0);
    const py = (/** @type {number} */ y) => encodeValue(scales, channels, 'y', y, 0);
    const upper = (/** @type {number} */ x) => aHi + Math.max(bLo * x, bHi * x);
    const lower = (/** @type {number} */ x) => aLo + Math.min(bLo * x, bHi * x);

    /** @type {[number, number][]} */
    const ring = [];
    for (const x of xs) ring.push([px(x), py(upper(x))]);
    for (let i = xs.length - 1; i >= 0; i--) ring.push([px(xs[i]), py(lower(xs[i]))]);
    return clipPolygonToPlot(ring, width, height);
}

/**
 * `levels` nested envelopes, innermost first: the band at increasing fractions of
 * its spread. Stacked at low opacity they darken toward the line.
 * @param {{ a: number, b: number, aLo: number, aHi: number, bLo: number, bHi: number }} params
 * @param {number} levels
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {[number, number][][]}
 */
export function nestedEnvelopes(params, levels, scales, channels, width, height) {
    const { a, b, aLo, aHi, bLo, bHi } = params;
    /** @type {[number, number][][]} */
    const out = [];
    for (let k = 1; k <= levels; k++) {
        const t = k / levels;
        const scaled = {
            aLo: a - (a - aLo) * t, aHi: a + (aHi - a) * t,
            bLo: b - (b - bLo) * t, bHi: b + (bHi - b) * t
        };
        const ring = envelopePolygon(scaled, scales, channels, width, height);
        if (ring.length >= 3) out.push(ring);
    }
    return out;
}

/** Deterministic PRNG so a sampled fan is stable across re-renders. */
function mulberry32(/** @type {number} */ seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A standard-normal draw (Box-Muller) from a uniform generator. */
function gauss(/** @type {() => number} */ rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw `samples` lines from the family.
 *
 * `'normal'` treats the bounds as a `sigma`-wide envelope (default 1.96, so ~95%
 * of draws land inside). Each side is scaled separately, so an asymmetric range
 * samples asymmetrically; a symmetric one is `Normal(mid, spread / sigma)`.
 * `'uniform'` draws flat across the bounds.
 * @param {{ a: number, b: number, aLo: number, aHi: number, bLo: number, bHi: number }} params
 * @param {{ samples?: number, seed?: number, distribution?: string, sigma?: number }} [opts]
 * @returns {{ a: number, b: number }[]}
 */
export function sampleLines(params, opts = {}) {
    const { samples = 60, seed = 7, distribution = 'normal', sigma = 1.96 } = opts;
    const { a, b, aLo, aHi, bLo, bHi } = params;
    const rnd = mulberry32(seed);
    const safeSigma = sigma > 0 ? sigma : 1.96;

    const draw = (/** @type {number} */ mid, /** @type {number} */ lo, /** @type {number} */ hi) => {
        if (distribution === 'uniform') return lo + rnd() * (hi - lo);
        const z = gauss(rnd) / safeSigma;
        return z >= 0 ? mid + z * (hi - mid) : mid + z * (mid - lo);
    };

    /** @type {{ a: number, b: number }[]} */
    const out = [];
    for (let k = 0; k < samples; k++) {
        out.push({ a: draw(a, aLo, aHi), b: draw(b, bLo, bHi) });
    }
    return out;
}
