// @ts-check
// trendGeometry.js — the geometry of a PARAMETRIC line and its uncertainty band,
// shared by `trend` (which draws the line and its handles) and `trendBand` (which
// draws the envelope). Pure maths: it returns numbers and pixel points, never scene
// nodes, so the two marks can differ in what they paint while agreeing exactly on
// where things are.
//
// ── The model ───────────────────────────────────────────────────────────────
// A belief about a linear relationship is two numbers:
//
//     y(x) = intercept + slope · x
//
// and its uncertainty is a range on each. The band is the whole family
//
//     { α + β·x : α ∈ [aLo, aHi], β ∈ [bLo, bHi] }
//
// whose envelope at any x is
//
//     upper(x) = aHi + max(bLo·x, bHi·x)
//     lower(x) = aLo + min(bLo·x, bHi·x)
//
// Piecewise linear with a single kink at x = 0 (where the slope range stops
// mattering and only the intercept range is left), so sampling at { x0, 0, x1 }
// gives the polygon EXACTLY — no tessellation, no sampling error.
//
// A correlation belief is this with the intercept pinned: aLo = aHi = 0 collapses
// the polygon to a point at the origin and the band opens as a cone. The old `cone`
// mark hard-coded that case in degrees; here it falls out of the general formula.
//
// ── Parameter channels ──────────────────────────────────────────────────────
// intercept / slope name the two parameters, and the uncertainty is named EITHER
// symmetrically (`interceptSpread` / `slopeSpread`, a half-width in the field's own
// units — one pointer distance sets one) OR as an explicit asymmetric range
// (`intercept1`/`intercept2`, `slope1`/`slope2`, the same 1/2 span spelling `area`
// and `rect` use). The range form wins when present.
//
// All of them are UNSCALED (`scale: null`): they are parameters read in their own
// units, not visual encodings, so they open no scale bucket of their own and need
// no schema entry. Only x and y are scales here — the parameters are projected
// THROUGH them, which is why every pixel below comes from `encodeValue`.

import { encodeChannel, encodeValue } from './mark.js';

/** The parameter channels a trend mark reads, in declaration order. */
export const PARAM_CHANNELS = [
    'intercept', 'slope',
    'interceptSpread', 'slopeSpread',
    'intercept1', 'intercept2', 'slope1', 'slope2'
];

/**
 * Merge author channels over the mark's defaults and stamp `scale: null` on every
 * parameter channel, so a parameter is read in its own units and never resolves a
 * scale. `x` / `y` are left alone — they ARE the scales.
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
 * Read one datum's line parameters and the band's bounds on each.
 *
 * `a` / `b` are the line itself. The bounds default to the line (a zero-width band)
 * so a mark with no uncertainty declared still has well-formed geometry.
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

    // The asymmetric range form wins over the symmetric half-width when declared —
    // it is the more specific statement about the same interval. Bounds are sorted
    // so a range given the wrong way round still draws (rather than inverting the
    // polygon); pair it with ordering() if you want the data itself kept honest.
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
 * The two ends of the x domain, read off the declared domain rather than the data —
 * a parametric mark places itself from the coordinate space, not from rows (it
 * usually has exactly one).
 * @param {import('../types').ScaleMap} scales
 * @returns {{ x0: number, x1: number }}
 */
export function domainEndsOf(scales) {
    const dom = scales.x && /** @type {any} */ (scales.x).domainConfig;
    return {
        x0: Array.isArray(dom) ? Number(dom[0]) : 0,
        x1: Array.isArray(dom) ? Number(dom[dom.length - 1]) : 1
    };
}

/**
 * The two x positions a trend's handles sit at.
 *   anchor — the pivot: dragging the intercept handle translates the line so its
 *            value HERE follows the pointer, and dragging the slope handle rotates
 *            about this point. Defaults to 0 when 0 lies in the x domain (the
 *            classic y-intercept frame), else the domain's first end.
 *   probe  — where the slope handle sits. Defaults to the domain's other end, so
 *            anchor and probe are never the same point.
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
export function clipLineToPlot(x1, y1, x2, y2, w, h) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    // Degenerate: a point. Keep it only if it sits inside the plot.
    if (dx === 0 && dy === 0) {
        if (x1 < 0 || x1 > w || y1 < 0 || y1 > h) return null;
        return { x1, y1, x2, y2 };
    }

    // Liang–Barsky against [0,w] × [0,h], treating the segment as a ray pair so
    // an infinite line through the two sample points reaches every plot edge.
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

    // Finite segment through the samples may lie entirely inside; for the
    // infinite line we still want the full clipped extent, so use [t0, t1]
    // unrestricted by the sample segment.
    return {
        x1: x1 + t0 * dx,
        y1: y1 + t0 * dy,
        x2: x1 + t1 * dx,
        y2: y1 + t1 * dy
    };
}

/**
 * Clip a convex polygon to the plot rectangle (Sutherland–Hodgman).
 *
 * A band's edges are unbounded in y — a wide slope range runs off the top and
 * bottom of the plot within the x domain — and the renderer applies no plot-rect
 * clip (only `overflow: hidden` on the whole SVG), so an unclipped polygon paints
 * over the axes and into the margins. Clipping per-point in pixel space would
 * bend a slanted edge; clipping the POLYGON keeps every edge straight.
 * @param {[number, number][]} points
 * @param {number} w
 * @param {number} h
 * @returns {[number, number][]}
 */
export function clipPolygonToPlot(points, w, h) {
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
 * The line y = a + b·x as a segment clipped to the plot. Sampled at the x-domain
 * ends and then extended as an infinite line, so it runs edge to edge rather than
 * stopping wherever the domain happens to end.
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
 * The two ends of a clipped segment, pulled in along it by `inset` pixels.
 *
 * A handle drawn exactly on the plot boundary is half-cut by it, so a grip mounted
 * at the end of a line has to sit slightly inside. The inset is skipped on a segment
 * too short to survive it — a line that only clips a corner — where pulling both ends
 * in would cross them over each other and put the handles in the wrong order.
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
 * `levels` nested envelopes, innermost first — the band at increasing fractions of
 * its spread. Stacked at a low opacity they darken toward the line, which is how a
 * gradient is drawn here: the renderer has no gradients, so a ramp is N shapes (the
 * idiom `legend`'s continuous colour ramp already uses).
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

/** Deterministic PRNG so a sampled fan is STABLE across re-renders. */
export function mulberry32(/** @type {number} */ seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A standard-normal draw (Box-Muller) from a uniform generator. */
export function gauss(/** @type {() => number} */ rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Draw `samples` lines from the family — the ensemble reading of the same band.
 *
 * `'normal'` treats the declared bounds as a `sigma`-wide envelope (1.96 by
 * default), so ~95% of the draws land inside the polygon the reader pointed at:
 * the bound is what the GESTURE names, and the SD is derived from it, not the
 * other way round. Each side of the line is scaled independently, so an asymmetric
 * range samples asymmetrically; when the range is symmetric this is exactly
 * `Normal(mid, spread / sigma)`.
 *
 * `'uniform'` draws flat across the bounds — every line in the family equally
 * plausible, which is the honest picture when the range is a hard interval rather
 * than a confidence envelope.
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
