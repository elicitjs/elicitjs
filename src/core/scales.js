// @ts-check
// scales.js — the one scale factory, and the CAPABILITY MODEL every other module
// branches on.
//
// ── Never branch on scale.type ──────────────────────────────────────────────
// `type` is a label ('linear', 'log', 'band', …). It is NOT control flow, for two
// reasons: a `log` scale behaves exactly like a `linear` one everywhere it
// matters, and a scale a user hands us (`scale: d3.scaleBand().padding(0.3)`) has
// no `type` at all. Branching on it means an unrecognized scale silently comes
// back non-invertible — the chart draws fine and every edit on that channel goes
// dead, with no error anywhere.
//
// So each scale carries what it can DO, sniffed once here from the object's own
// shape and stamped on:
//   kind: 'band'       occupies an interval per category (has a bandwidth)
//         'point'      a tick per category (no width)
//         'continuous' has invert(): linear, log, pow, sqrt, time, symlog
//         'discrete'   value -> discrete output (ordinal, sequential ramp)
//   temporal:   the domain holds Dates, so encode() coerces first
//   invertible: a gesture on this channel can be inverted back to data
//
// Marks, edits, axes and the pick layer read `kind`. Adding a scale type means
// adding a case HERE and nowhere else.
import * as d3 from 'd3';

/**
 * Coerce a domain value to a Date for a temporal scale. Accepts Dates, epoch
 * numbers, and ISO/parseable date strings; leaves an already-Date untouched.
 * @param {any} v
 * @returns {Date}
 */
function toDate(v) {
    return v instanceof Date ? v : new Date(v);
}

/**
 * Sniff what a scale can do from its own shape. Works on the scales we build and
 * on any d3 scale a user hands us — d3's own method surface is the tell:
 *   scaleBand   -> bandwidth() + paddingInner()
 *   scalePoint  -> bandwidth() but NO paddingInner (it's band with padding 1)
 *   continuous  -> invert()
 *   ordinal etc -> neither
 * @param {any} scale
 * @returns {import('../types').ScaleKind}
 */
function kindOf(scale) {
    if (typeof scale.bandwidth === 'function') {
        return typeof scale.paddingInner === 'function' ? 'band' : 'point';
    }
    if (typeof scale.invert === 'function') return 'continuous';
    return 'discrete';
}

/**
 * Stamp the capability flags + the unified channel API onto a scale. Every scale
 * that reaches a mark or an edit has been through here, whether we built it
 * (createScale) or a user supplied it (adoptScale).
 * @param {any} scale
 * @param {import('../types').ScaleType} [type] a label, when we know it
 * @returns {import('../types').Scale}
 */
function stamp(scale, type) {
    scale.type = type;
    scale.kind = kindOf(scale);
    const domain = typeof scale.domain === 'function' ? scale.domain() : [];
    scale.temporal = domain.some((/** @type {any} */ v) => v instanceof Date);
    scale.domainConfig = domain;

    // Unified channel API. Marks and edits never branch on the scale:
    //   encode(value)      -> visual output (band centre | pixel | colour | radius)
    //   invertValue(pixel) -> data value    (nearest category | clamped invert)
    // A colour scale is `discrete` with no invert(), so `invertible` is false and
    // edits know a gesture can't drive that channel.
    scale.invertible = scale.kind === 'band' || scale.kind === 'point'
        || typeof scale.invert === 'function';
    scale.encode = (/** @type {any} */ value, /** @type {any} */ fallback) => positionOnScale(scale, value, fallback);
    scale.invertValue = scale.invertible
        ? (/** @type {number} */ pixel) => invertOnScale(scale, pixel)
        : () => undefined;

    return scale;
}

/**
 * Adopt a scale the user built themselves (`scale: d3.scaleBand().padding(0.3)`).
 * It arrives fully configured; we only sniff its capabilities and, for a
 * POSITIONAL channel that named no range of its own, hand it the plot's pixel
 * range — pixels are ours to know, palettes and radii are the author's. A colour
 * scale keeps whatever range/interpolator it was built with.
 * @param {any} scale a d3 scale (or any callable with .domain/.range)
 * @param {{ range?: any[], positional?: boolean, domain?: any[] }} [opts]
 * @returns {import('../types').Scale}
 */
export function adoptScale(scale, { range, positional, domain } = {}) {
    // The schema owns the domain; apply it unless the author's scale already
    // declares one (an adopted scale with an explicit domain is deliberate).
    if (domain && typeof scale.domain === 'function' && !scale.domain().length) {
        scale.domain(domain);
    }
    if (range && positional && typeof scale.range === 'function') scale.range(range);
    return stamp(scale);
}

/**
 * The single scale factory for every channel — positional (x/y) and beyond
 * (colour, size, opacity). `range` is the channel's visual output range: pixels
 * for x/y, a radius interval for size, a palette or two-stop ramp for colour.
 *   linear|log|pow|sqrt -> continuous field  -> continuous output (pixel | radius)
 *   symlog              -> continuous field  -> like log, but spans 0 / negatives
 *   time                -> temporal field    -> continuous output over Dates
 *   band                -> discrete field    -> an interval per category (a bar's
 *                                               thickness comes from the bandwidth)
 *   point               -> discrete field    -> a tick per category (a circle sits
 *                                               on it; no width)
 *   ordinal             -> discrete field    -> discrete output (category -> colour)
 *   sequential          -> continuous field  -> continuous colour along a ramp
 *   diverging           -> continuous field  -> colour by distance from a pivot
 *
 * band vs point is the discrete split that matters per MARK: a bar needs the
 * interval, a circle wants the tick. The mark declares which it wants
 * (`discreteScale`) and the resolver picks accordingly; an explicit `scale` wins.
 * @param {any} spec { type, domain, padding, nice, clamp, base, exponent }
 * @param {any[]} range
 * @returns {import('../types').Scale | null}
 */
export function createScale(spec, range) {
    if (!spec) return null;

    const type = spec.type || 'linear';
    /** @type {any} */
    let scale;

    if (type === 'time') {
        // Temporal axis — continuous like linear, but over Dates. Domain values
        // may be Dates, epoch numbers, or date strings; coerce them.
        scale = d3.scaleTime().domain(spec.domain.map(toDate)).range(range);
    } else if (type === 'band') {
        scale = d3.scaleBand().domain(spec.domain).range(range)
            .padding(spec.padding != null ? spec.padding : 0.1);
    } else if (type === 'point') {
        scale = d3.scalePoint().domain(spec.domain).range(range)
            .padding(spec.padding != null ? spec.padding : 0.5);
    } else if (type === 'ordinal') {
        scale = d3.scaleOrdinal().domain(spec.domain).range(range);
    } else if (type === 'sequential') {
        // Callable ramp with the d3-scale shape downstream code expects. It has
        // neither bandwidth nor invert, so it sniffs as 'discrete' — correct: a
        // colour is not something a gesture can invert.
        const [lo, hi] = [Math.min(...spec.domain), Math.max(...spec.domain)];
        const t = d3.scaleLinear().domain([lo, hi]).range([0, 1]).clamp(true);
        const ramp = d3.interpolateRgb(range[0], range[1]);
        scale = (/** @type {any} */ value) => ramp(t(value));
        scale.domain = () => spec.domain;
        scale.range = () => range;
    } else if (type === 'diverging') {
        // A ramp with a PIVOT: a value's distance from the pivot picks its colour,
        // and each side gets its own half of the ramp. What a sequential scale can't
        // say — "this is above/below the reference, by this much" — which is most of
        // what an elicited difference, error or surprise means.
        //
        // The pivot is a DATA value (`scale: { type: 'diverging', pivot: 0 }`),
        // defaulting to 0 when the domain straddles it (the usual neutral) and to the
        // domain's midpoint when it doesn't. The two sides are scaled independently,
        // so the pivot keeps its colour even on a lopsided domain like [-2, 10] —
        // stretching one range across both halves would put the neutral colour at 4.
        const [dlo, dhi] = [Math.min(...spec.domain), Math.max(...spec.domain)];
        const pivot = spec.pivot != null
            ? spec.pivot
            : (dlo < 0 && dhi > 0 ? 0 : (dlo + dhi) / 2);
        const t = d3.scaleLinear()
            .domain([dlo, pivot, dhi])
            .range([0, 0.5, 1])
            .clamp(true);
        // Callable with the d3-scale shape downstream expects, and NO invert() — so
        // it sniffs as 'discrete'/non-invertible, exactly like `sequential`: a colour
        // is not something a gesture can drive backwards.
        const stops = range.length >= 3
            ? [range[0], range[1], range[range.length - 1]]
            : [range[0], '#f7f7f7', range[range.length - 1]];
        const ramp = d3.piecewise(d3.interpolateRgb, stops);
        scale = (/** @type {any} */ value) => ramp(t(value));
        scale.domain = () => spec.domain;
        scale.range = () => range;
        scale.pivot = () => pivot;
    } else if (type === 'log') {
        scale = d3.scaleLog().domain(spec.domain).range(range);
        if (spec.base != null) scale.base(spec.base);
    } else if (type === 'symlog') {
        // Linear near zero, logarithmic beyond it — the scale for a quantity that
        // spans orders of magnitude AND legitimately reaches 0 (or goes negative),
        // where `log` simply has no answer. `constant` sets how wide the linear
        // region is.
        scale = d3.scaleSymlog().domain(spec.domain).range(range);
        if (spec.constant != null) scale.constant(spec.constant);
    } else if (type === 'pow' || type === 'sqrt') {
        scale = d3.scalePow().domain(spec.domain).range(range)
            .exponent(spec.exponent != null ? spec.exponent : (type === 'sqrt' ? 0.5 : 1));
    } else {
        scale = d3.scaleLinear().domain(spec.domain).range(range);
    }

    // Continuous-scale refinements, ignored by the discrete scales that lack them.
    if (spec.nice && typeof scale.nice === 'function') scale.nice();
    if (spec.clamp && typeof scale.clamp === 'function') scale.clamp(true);

    return stamp(scale, type);
}

/**
 * Build the scale for ONE frame channel of ONE datum — a group's local
 * coordinate box, expressed as a real scale.
 *
 * A composite in BOX mode (plot/composite.js) places its parts in a box centred on its
 * encoded position and sized by its encoded `size`. Both are per-DATUM (a face
 * per row sits somewhere different and may be a different size), so the box
 * cannot be a global scale. It is instead one ordinary linear scale per datum,
 * built here: `domain` is the field's own units (the schema's), `localRange` is
 * where in the box the channel's extremes land, and `family` says how a local
 * unit becomes a pixel (see frameFamilyOf).
 *
 * The point of routing this through `createScale` rather than a bespoke helper
 * is that the result is a genuine Scale — capability-stamped, invertible, with a
 * `domainConfig` — so the edit layer inverts a gesture through the SAME object
 * that encoded it and nothing about "an edit is the inverse of encoding" needs a
 * special case. The scales this returns carry type 'linear' (or 'time'); 'frame'
 * is a channel-side marker and never reaches a resolved scale.
 * @param {{ domain: any[], localRange: number[], origin?: number, halfSize?: number, family?: 'x' | 'y' | 'size' | 'plain' }} opts
 * @returns {import('../types').Scale | null}
 */
export function createFrameScale({ domain, localRange, origin = 0, halfSize = 1, family = 'plain' }) {
    /** @type {(u: number) => number} */
    const toPixel = family === 'x' ? (u) => origin + u * halfSize
        : family === 'y' ? (u) => origin - u * halfSize   // local y is UP
            : family === 'size' ? (u) => u * halfSize
                : (u) => u;                               // already in output units
    const type = domain.some((/** @type {any} */ v) => v instanceof Date) ? 'time' : 'linear';
    const scale = createScale({ type, domain }, localRange.map(toPixel));
    // The glyph's radius, carried on the scale so a GESTURE can size itself to the
    // glyph. A `slide` on a frame channel sweeps the domain in one radius instead
    // of a fixed 120px, which is far too coarse on a small glyph and too fine on a
    // large one (see edit/basic.js: slideExtent). Not a scale capability — nothing
    // branches on it; it is the one number an edit would otherwise have to guess.
    /** @type {any} */ (scale).frameExtent = Math.abs(halfSize) || undefined;
    return scale;
}

// --- Scale helpers shared by marks -----------------------------------------
// These let marks be composed across scale types (band vs linear) and axis
// orientations without special-casing each mark.

/**
 * @param {any} scale
 * @returns {boolean}
 */
export function isBand(scale) {
    return !!scale && scale.kind === 'band';
}

/**
 * Discrete positional scale (band or point): a category per slot, not a number
 * line. The two share every geometry rule except the half-bandwidth offset.
 * @param {any} scale
 * @returns {boolean}
 */
export function isDiscrete(scale) {
    return !!scale && (scale.kind === 'band' || scale.kind === 'point');
}

/**
 * The min/max pixel bounds of a scale's (possibly reversed) range.
 * @param {any} scale
 * @returns {[number, number]}
 */
export function rangeExtent(scale) {
    const r = scale.range();
    return [Math.min(r[0], r[1]), Math.max(r[0], r[1])];
}

/**
 * Center pixel position of a value on a scale:
 *   band   -> band start + bandwidth/2 (the category's center)
 *   linear -> scale(value)
 *   missing scale (1D plots) -> the provided fallback (usually the range center)
 * @param {any} scale
 * @param {any} value
 * @param {any} [fallback]
 * @returns {any}
 */
export function positionOnScale(scale, value, fallback) {
    if (!scale) return fallback;
    if (scale.kind === 'band') {
        const p = scale(value);
        return p == null ? fallback : p + scale.bandwidth() / 2;
    }
    if (scale.kind === 'point') {
        // scalePoint already returns the tick position (no bandwidth to offset).
        const p = scale(value);
        return p == null ? fallback : p;
    }
    // Temporal: coerce the value to a Date so string/epoch data still positions.
    if (scale.temporal) return scale(toDate(value));
    // A row missing this field yields scale(undefined) -> NaN, and an SVG attribute
    // of NaN is dropped by the browser, so the mark VANISHES with no error. The band
    // and point branches above already null-check; this one didn't.
    if (value == null) return fallback;
    const p = scale(value);
    // Only a NUMERIC result can be a broken coordinate. This helper also carries
    // non-positional channels (fill returns "steelblue"), so anything non-numeric
    // passes through untouched.
    return typeof p === 'number' && !Number.isFinite(p) ? fallback : p;
}

/**
 * Thickness a band occupies (bar width/height); fallback for non-band scales.
 * @param {any} scale
 * @param {any} [fallback]
 * @returns {any}
 */
export function bandwidthOf(scale, fallback) {
    return scale && scale.bandwidth ? scale.bandwidth() : fallback;
}

/**
 * Leading pixel edge of a value's slot — the companion to `bandwidthOf`, which
 * gives the slot's thickness. `positionOnScale`/`encode` deliberately return a
 * band's CENTRE (that's where a mark sits), so a mark that draws the band as a
 * rectangle needs its start. That's the one geometry question encodeChannel
 * can't answer, and hand-rolling `scale(d[key])` for it is how the "four ways to
 * place a mark" drift started — ask here instead.
 *   band  -> the category's interval start
 *   point -> the tick itself (no width to offset from)
 *   other -> encode(value), i.e. the position IS the edge
 * @param {any} scale
 * @param {any} value
 * @param {any} [fallback]
 * @returns {any}
 */
export function bandStartOf(scale, value, fallback) {
    if (!scale) return fallback;
    if (scale.kind === 'band' || scale.kind === 'point') {
        const p = scale(value);
        return p == null ? fallback : p;
    }
    return positionOnScale(scale, value, fallback);
}

/**
 * The pixel span a mark occupies ALONG a (possibly categorical) axis — the
 * inverse concern of `bandwidthOf`: not "how thick" but "from where to where".
 * Mark-agnostic so any mark that spans a band (a tick across its category, and
 * later a bar) shares one rule:
 *   band scale   -> the category's interval [start, start+bandwidth]
 *   no band      -> the full axis extent [0, fullLength]  (rug / strip plot)
 * `inset` (px) shrinks each end; an explicit `length` (px) overrides the span
 * with a fixed-length segment centred on the band (or the axis) instead.
 * @param {any} scale the axis scale for the span dimension (may be null/linear)
 * @param {any} value the datum's category on that axis (band case)
 * @param {number} fullLength the inner pixel length of that axis (no-band case)
 * @param {{ inset?: number, length?: number }} [opts]
 * @returns {[number, number]} [start, end] in pixels
 */
export function bandSpan(scale, value, fullLength, { inset = 0, length } = {}) {
    let lo, hi;
    if (isBand(scale)) {
        const start = scale(value);
        const size = scale.bandwidth();
        lo = start;
        hi = start + size;
    } else {
        // No band on this axis: span the whole extent (a per-datum rule).
        lo = 0;
        hi = fullLength;
    }
    if (length != null) {
        const center = (lo + hi) / 2;
        return [center - length / 2, center + length / 2];
    }
    return [lo + inset, hi - inset];
}

/**
 * Inverse of positionOnScale: map a pixel position back to a data value.
 * The mirror image of how marks are placed, so any scale a mark can be drawn
 * on is also a scale a mark can be created on.
 *   linear -> scale.invert(pixel), clamped into the domain
 *   band   -> the category whose band center is nearest the pixel (band scales
 *             have no invert(); we pick the closest category instead)
 *   missing scale (1D plots) -> undefined (that channel isn't positionable)
 * Returns undefined when the value can't be resolved (e.g. empty band domain).
 * @param {any} scale
 * @param {number} pixel
 * @returns {any}
 */
export function invertOnScale(scale, pixel) {
    if (!scale || !scale.invertible) return undefined; // colour scales, mainly

    if (isDiscrete(scale)) {
        const domain = scale.domain();
        if (!domain.length) return undefined;
        // Discrete scales have no invert(), so find the category whose centre is
        // closest to the pixel. This mirrors positionOnScale: a band's centre is
        // offset by half its bandwidth, a point's centre is the tick itself.
        const half = scale.kind === 'band' ? scale.bandwidth() / 2 : 0;
        let nearest = domain[0];
        let bestDist = Infinity;
        for (const category of domain) {
            const center = scale(category) + half;
            const dist = Math.abs(center - pixel);
            if (dist < bestDist) {
                bestDist = dist;
                nearest = category;
            }
        }
        return nearest;
    }

    // Continuous scale (linear | log | pow | sqrt | time | an adopted d3 scale):
    // invert then clamp into the (possibly reversed) domain so created values
    // never escape the axis. A temporal scale inverts to a Date; clamp numerically
    // on epoch ms and hand back a Date.
    const value = scale.invert(pixel);
    const domain = scale.domain();
    if (scale.temporal) {
        const lo = Math.min(...domain.map(Number));
        const hi = Math.max(...domain.map(Number));
        return new Date(Math.max(lo, Math.min(hi, Number(value))));
    }
    const lo = Math.min(...domain);
    const hi = Math.max(...domain);
    return Math.max(lo, Math.min(hi, value));
}

/**
 * Pixel baseline (value origin) of a value scale — where a bar starts from.
 * Uses 0 when in the domain, clamped into the range so bars never escape it.
 * @param {any} valueScale
 * @returns {number}
 */
export function baselineOf(valueScale) {
    const [lo, hi] = rangeExtent(valueScale);
    const zero = valueScale(0);
    return Math.max(lo, Math.min(hi, zero));
}

