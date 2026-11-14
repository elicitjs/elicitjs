// @ts-check
// scales.js — the one scale factory, and the capability model every module reads.
// Never branch on `scale.type`: a user's `d3.scaleBand()` has no type, and a type
// allowlist would silently kill its edits. Each scale is stamped with what it can
// do, sniffed from its shape:
//   kind: 'band'       an interval per category (has a bandwidth)
//         'point'      a tick per category (no width)
//         'continuous' has invert(): linear, log, pow, sqrt, time, symlog
//         'discrete'   value -> discrete output (ordinal, sequential ramp)
//   temporal:   the domain holds Dates, so encode() coerces first
//   invertible: a gesture on this channel can be inverted back to data
// A new scale type is a case here and nowhere else.
import * as d3 from 'd3';
import { warn } from './dev.js';

/**
 * The key a non-positional scale lives under in the ScaleMap: one scale per
 * encoding (channel, field), so two marks stating the same encoding share it.
 * Positional channels union by axis instead (`axisOf`). The NUL separator cannot
 * occur in a channel or field name (engine/selection.js qualifies selection keys
 * the same way).
 * @param {string} channel
 * @param {string | undefined} field
 * @returns {string}
 */
export function scaleKey(channel, field) {
    return field == null ? channel : `${channel}\u0000${field}`;
}

/**
 * The scale for one encoding: the (channel, field) key first, the bare channel
 * after. The bare-channel alias is first-wins (core/resolve.js); keep it.
 * @param {Record<string, any> | null | undefined} scales
 * @param {string} channel
 * @param {string | null} [field]
 * @returns {any}
 */
export function scaleFor(scales, channel, field) {
    if (!scales) return undefined;
    return scales[scaleKey(channel, field == null ? undefined : field)] || scales[channel];
}

const CONTINUOUS_TYPES = new Set(['linear', 'log', 'pow', 'sqrt', 'symlog', 'time', 'utc']);
const RAMP_TYPES = new Set(['sequential', 'diverging']);

/**
 * Is this scale type a continuous, invertible one (linear, log, pow, sqrt, symlog, time)?
 * @param {any} type
 * @returns {boolean}
 */
export function isContinuousType(type) {
    return CONTINUOUS_TYPES.has(String(type));
}

/**
 * Is this scale type a colour ramp (sequential, diverging)?
 * @param {any} type
 * @returns {boolean}
 */
export function isRampType(type) {
    return RAMP_TYPES.has(String(type));
}

/**
 * Coerce a domain value to a Date for a temporal scale. Accepts Dates, epoch
 * numbers, and ISO/parseable date strings; leaves an already-Date untouched.
 * @param {any} v
 * @returns {Date}
 */
export function toDate(v) {
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
 * Stamp the capability flags and the unified channel API onto a scale. Every scale
 * a mark or edit sees passes through here (createScale or adoptScale).
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

    // Unified channel API: encode(value) -> visual output; invertValue(pixel) ->
    // data value. A colour scale has no invert(), so `invertible` is false.
    scale.invertible = scale.kind === 'band' || scale.kind === 'point'
        || typeof scale.invert === 'function';
    // A ramp maps a continuous domain to a paint. Non-invertible, yet its domain is
    // an interval, so a legend draws a gradient. Set by our ramps, sniffed from
    // `interpolator()` on an adopted d3 scale.
    scale.ramp = scale.ramp === true || typeof scale.interpolator === 'function';
    scale.encode = (/** @type {any} */ value, /** @type {any} */ fallback) => positionOnScale(scale, value, fallback);
    scale.invertValue = scale.invertible
        ? (/** @type {number} */ pixel) => invertOnScale(scale, pixel)
        : () => undefined;

    return scale;
}

/**
 * Adopt a user-built scale (`scale: d3.scaleBand().padding(0.3)`): sniff its
 * capabilities and, for a positional channel with no range of its own, give it the
 * plot's pixel range. A colour scale keeps its own range.
 * @param {any} scale a d3 scale (or any callable with .domain/.range)
 * @param {{ range?: any[], positional?: boolean, domain?: any[], declared?: boolean }} [opts]
 *   `declared`: the domain came from the schema (not inferred from data)
 * @returns {import('../types').Scale}
 */
export function adoptScale(scale, { range, positional, domain, declared } = {}) {
    // The schema owns the domain. An instance left at d3's default (empty, or
    // [0, 1] for continuous) takes it: a declared domain always, an inferred one
    // only into an empty domain. A domain the author set is kept.
    if (domain && typeof scale.domain === 'function') {
        const own = scale.domain();
        const untouched = own.length === 0
            || (own.length === 2 && Number(own[0]) === 0 && Number(own[1]) === 1);
        if (untouched && (declared || own.length === 0)) scale.domain(domain);
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
 * The mark declares band vs point (`discreteScale`); an explicit `scale` wins.
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
            .padding(spec.padding != null ? spec.padding : (spec.bandPadding != null ? spec.bandPadding : 0.1));
    } else if (type === 'point') {
        scale = d3.scalePoint().domain(spec.domain).range(range)
            .padding(spec.padding != null ? spec.padding : 0.5);
    } else if (type === 'ordinal') {
        scale = d3.scaleOrdinal().domain(spec.domain).range(range);
    } else if (type === 'sequential') {
        // A callable ramp; no bandwidth or invert, so it sniffs as non-invertible.
        const [lo, hi] = [Math.min(...spec.domain), Math.max(...spec.domain)];
        const t = d3.scaleLinear().domain([lo, hi]).range([0, 1]).clamp(true);
        // Every stop of the range, joined piecewise (a 3-stop `range` is three colours).
        const ramp = d3.piecewise(d3.interpolateRgb, range);
        scale = (/** @type {any} */ value) => ramp(t(value));
        scale.domain = () => spec.domain;
        scale.range = () => range;
        scale.ramp = true;
    } else if (type === 'diverging') {
        // A ramp with a pivot (a data value; default 0 when the domain straddles
        // it, else the midpoint). Each side is scaled independently, so the pivot
        // keeps its colour on a lopsided domain like [-2, 10].
        const [dlo, dhi] = [Math.min(...spec.domain), Math.max(...spec.domain)];
        const pivot = spec.pivot != null
            ? spec.pivot
            : (dlo < 0 && dhi > 0 ? 0 : (dlo + dhi) / 2);
        const t = d3.scaleLinear()
            .domain([dlo, pivot, dhi])
            .range([0, 0.5, 1])
            .clamp(true);
        // No invert(), so non-invertible like `sequential`. A two-colour range
        // gets a neutral middle so the pivot has its own colour.
        const stops = range.length >= 3
            ? range
            : [range[0], '#f7f7f7', range[range.length - 1]];
        const ramp = d3.piecewise(d3.interpolateRgb, stops);
        scale = (/** @type {any} */ value) => ramp(t(value));
        scale.domain = () => spec.domain;
        scale.range = () => range;
        scale.ramp = true;
        scale.pivot = () => pivot;
    } else if (type === 'log') {
        scale = d3.scaleLog().domain(spec.domain).range(range);
        if (spec.base != null) scale.base(spec.base);
    } else if (type === 'symlog') {
        // Linear near zero, logarithmic beyond: for magnitudes that reach 0 or go
        // negative. `constant` sets the width of the linear region.
        scale = d3.scaleSymlog().domain(spec.domain).range(range);
        if (spec.constant != null) scale.constant(spec.constant);
    } else if (type === 'pow' || type === 'sqrt') {
        scale = d3.scalePow().domain(spec.domain).range(range)
            .exponent(spec.exponent != null ? spec.exponent : (type === 'sqrt' ? 0.5 : 1));
    } else {
        scale = d3.scaleLinear().domain(spec.domain).range(range);
    }

    // A continuous scale with a longer colour range than its domain: spread the
    // domain over every stop, since d3 pairs domain and range elementwise.
    if (typeof scale.domain === 'function' && typeof scale.interpolate === 'function'
        && Array.isArray(range) && range.length > spec.domain.length && typeof range[0] === 'string'
        && spec.domain.length === 2) {
        // Evenly in the scale's own space (log, sqrt, symlog, time), so a log
        // colour scale spreads its stops by decade rather than bunching them.
        const unit = scale.copy().range([0, 1]);
        const n = range.length;
        scale.domain(d3.range(n).map((/** @type {number} */ i) => unit.invert(i / (n - 1))));
        scale.interpolate(d3.interpolateRgb);
    }

    // Continuous-scale refinements, ignored by the discrete scales that lack them.
    if (spec.nice && typeof scale.nice === 'function') scale.nice();
    if (spec.clamp && typeof scale.clamp === 'function') scale.clamp(true);

    return stamp(scale, type);
}

/**
 * Build the scale for one frame channel of one datum: a composite's per-datum
 * local box (plot/composite.js) as a real, invertible linear (or time) scale, so
 * edits invert through the same object that encoded. `localRange` is where the
 * channel's extremes land in the box; `family` says how a local unit becomes a
 * pixel (frameFamilyOf). A discrete field gets a point scale with no padding
 * spanning `localRange`, so edits snap to the nearest category.
 * @param {{ domain: any[], localRange: number[], origin?: number, halfSize?: number, family?: 'x' | 'y' | 'size' | 'plain', discrete?: boolean }} opts
 * @returns {import('../types').Scale | null}
 */
export function createFrameScale({ domain, localRange, origin = 0, halfSize = 1, family = 'plain', discrete = false }) {
    /** @type {(u: number) => number} */
    const toPixel = family === 'x' ? (u) => origin + u * halfSize
        : family === 'y' ? (u) => origin - u * halfSize   // local y is UP
            : family === 'size' ? (u) => u * halfSize
                : (u) => u;                               // already in output units
    const scale = discrete
        ? createScale({ type: 'point', domain, padding: 0 },
            [toPixel(localRange[0]), toPixel(localRange[localRange.length - 1])])
        : createScale(
            { type: domain.some((/** @type {any} */ v) => v instanceof Date) ? 'time' : 'linear', domain },
            localRange.map(toPixel));
    // The glyph's radius, so a `slide` on a frame channel sweeps its domain in one
    // radius (edit/basic.js: slideExtent). Not a capability; nothing branches on it.
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
    // A missing value would give NaN, which the browser drops silently.
    if (value == null) return fallback;
    // Temporal: coerce the value to a Date so string/epoch data still positions —
    // and an unparseable one is a missing value, not a NaN coordinate.
    if (scale.temporal) {
        const p = scale(toDate(value));
        return typeof p === 'number' && !Number.isFinite(p) ? fallback : p;
    }
    const p = scale(value);
    // Only a numeric result can be a broken coordinate; colours pass through.
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
 * Leading pixel edge of a value's slot (`encode` returns a band's centre). Use
 * this instead of hand-rolling `scale(d[key])`.
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
 * The width of one category's slot on a discrete axis: a band's bandwidth, a
 * point's step (the distance between two ticks, centred on each). Undefined for
 * a continuous scale, which has no slot. What an offset channel's range spans.
 * @param {any} scale
 * @returns {number | undefined}
 */
export function slotWidthOf(scale) {
    if (!scale) return undefined;
    if (scale.kind === 'band') return scale.bandwidth();
    if (scale.kind === 'point') return typeof scale.step === 'function' ? scale.step() : 0;
    return undefined;
}

/**
 * The pixel interval a category occupies on a discrete axis: a band's own
 * interval, or a point's step centred on its tick. Null when the scale is not
 * discrete or the value is not in its domain.
 * @param {any} scale
 * @param {any} value
 * @returns {{ start: number, width: number } | null}
 */
export function slotOf(scale, value) {
    const width = slotWidthOf(scale);
    if (width === undefined) return null;
    const p = scale(value);
    if (p == null || Number.isNaN(p)) return null;
    return { start: scale.kind === 'point' ? p - width / 2 : p, width };
}

/**
 * Nest an offset scale (`xOffset`/`yOffset`) inside its parent: its range becomes
 * one parent slot in px, and its inverse takes an absolute pixel, finds the parent
 * slot, then inverts the remainder. Edits need no offset code.
 * @param {any} offset the offset channel's scale
 * @param {any} parent the x or y scale it nests inside (band or point)
 * @param {number[]} range the slot-local pixel range
 * @returns {any}
 */
export function nestOffsetScale(offset, parent, range) {
    if (!offset || typeof offset.range !== 'function') return offset;
    offset.range(range);
    offset.parent = parent;
    if (offset.invertible) {
        offset.invertValue = (/** @type {number} */ pixel) => {
            const slot = slotOf(parent, parent.invertValue(pixel));
            return slot ? invertOnScale(offset, pixel - slot.start) : undefined;
        };
    }
    return offset;
}

/**
 * The offset scale nested inside a positional axis for one mark's channel map, or
 * null when the mark declares no offset there, or its parent is not discrete (an
 * offset subdivides a category's slot; a number line has none). Same lookup as
 * every encoding read: the (channel, field) key first, the bare channel after.
 * @param {Record<string, any>} scales
 * @param {Record<string, any> | undefined} channels
 * @param {'x' | 'y'} axis
 * @returns {any}
 */
export function offsetScaleOf(scales, channels, axis) {
    const name = axis === 'x' ? 'xOffset' : 'yOffset';
    const spec = channels && channels[name];
    if (!spec || !scales) return null;
    const parent = scales[axis];
    if (slotWidthOf(parent) === undefined) return null;
    const scale = scaleFor(scales, name, spec.field);
    return scale && scale.parent === parent ? scale : null;
}

/**
 * The pixel span a mark occupies along a (possibly categorical) axis:
 *   band scale   -> the category's interval [start, start+bandwidth]
 *   no band      -> the full axis extent [0, fullLength]  (rug / strip plot)
 * `inset` (px) shrinks each end; `length` (px) gives a fixed segment centred on
 * the span.
 * @param {any} scale the axis scale for the span dimension (may be null/linear)
 * @param {any} value the datum's category on that axis (band case)
 * @param {number} fullLength the inner pixel length of that axis (no-band case)
 * @param {{ inset?: number, length?: number, slot?: { start: number, width: number } }} [opts]
 *   `slot` states the interval outright — a mark's `categorySlot`, which is the
 *   sub-band when an offset is nested in this axis.
 * @returns {[number, number]} [start, end] in pixels
 */
export function bandSpan(scale, value, fullLength, { inset = 0, length, slot } = {}) {
    let lo, hi;
    if (slot) {
        lo = slot.start;
        hi = slot.start + slot.width;
    } else if (isBand(scale)) {
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
 * Inverse of positionOnScale: map a pixel back to a data value.
 *   continuous -> scale.invert(pixel), clamped into the domain
 *   band/point -> the category whose centre is nearest
 * Undefined with no scale, a non-invertible scale, or an empty domain.
 * @param {any} scale
 * @param {number} pixel
 * @returns {any}
 */
export function invertOnScale(scale, pixel) {
    if (!scale || !scale.invertible) return undefined; // colour scales, mainly

    if (isDiscrete(scale)) {
        const domain = scale.domain();
        if (!domain.length) return undefined;
        // Nearest category centre, mirroring positionOnScale.
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

    // Continuous: invert, then clamp into the domain. A temporal scale clamps on
    // epoch ms and returns a Date.
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
 * With no scale on that axis (a `{ fn }`-only value channel resolves none) the
 * caller's fallback stands in, rather than a crash in `range()`.
 * @param {any} valueScale
 * @param {number} [fallback]
 * @returns {number}
 */
export function baselineOf(valueScale, fallback = 0) {
    if (!valueScale || typeof valueScale.range !== 'function') return fallback;
    const [lo, hi] = rangeExtent(valueScale);
    const zero = valueScale(0);
    return Math.max(lo, Math.min(hi, zero));
}

