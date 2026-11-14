// @ts-check
// encoding.js — the channel layer: channel families, scale-type inference,
// default output ranges, and the gesture <-> visual mapping. A channel's `type`
// is the data type; `scaleTypeFor` derives the scale type. Scales are built in
// core/scales.js and resolved per channel in core/resolve.js.

import * as d3 from 'd3';
import { DD } from './themes.js';
import { isContinuousType, isRampType, toDate } from './scales.js';

// Default categorical palette: 10 distinct hues. Override with `scale: { range }`
// or `scale: { scheme }`.
export const DEFAULT_PALETTE = [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];
// Default two-stop ramp for a continuous colour channel.
export const DEFAULT_RAMP = ['#e6f0ff', '#08519c'];
// Default diverging ramp: two hues meeting at a near-white neutral (ColorBrewer
// RdBu's ends).
export const DEFAULT_DIVERGING = ['#2166ac', '#f7f7f7', '#b2182b'];

// Default glyph range for the `symbol` channel: neutral unicode shapes. Override
// with `scale: { range }` or a named `scheme` (SYMBOL_SCHEMES).
const DEFAULT_SYMBOLS = ['●', '■', '▲', '◆', '★', '✚', '▼', '◀', '▶', '⬟'];

// Named symbol/emoji schemes, ordered low -> high to match a sorted ordinal domain.
/** @type {Record<string, readonly string[]>} */
const SYMBOL_SCHEMES = {
    faces: ['😞', '😐', '🙂'],
    faces5: ['😢', '🙁', '😐', '🙂', '😄'],
    hearts: ['🖤', '💛', '❤️'],
    weather: ['☀️', '⛅', '☁️', '🌧️', '⛈️'],
    arrows: ['⬇️', '↘️', '➡️', '↗️', '⬆️'],
    shapes: DEFAULT_SYMBOLS,
};

// Named colour schemes, lowercase keys. Categorical entries are palettes; ramp
// entries are interpolators.
/** @type {Record<string, readonly string[]>} */
const CATEGORICAL_SCHEMES = {
    category10: d3.schemeCategory10,
    tableau10: d3.schemeTableau10,
    observable10: d3.schemeObservable10,
    // Data & Dialogue Lab: the two logo colours, then coral, gold, violet, leaf, rose, slate.
    dd: DD.categorical,
    accent: d3.schemeAccent,
    dark2: d3.schemeDark2,
    paired: d3.schemePaired,
    pastel1: d3.schemePastel1,
    pastel2: d3.schemePastel2,
    set1: d3.schemeSet1,
    set2: d3.schemeSet2,
    set3: d3.schemeSet3,
};
/** @type {Record<string, (t: number) => string>} */
const RAMP_SCHEMES = {
    rdbu: d3.interpolateRdBu,
    rdylbu: d3.interpolateRdYlBu,
    rdylgn: d3.interpolateRdYlGn,
    brbg: d3.interpolateBrBG,
    piyg: d3.interpolatePiYG,
    prgn: d3.interpolatePRGn,
    puor: d3.interpolatePuOr,
    rdgy: d3.interpolateRdGy,
    spectral: d3.interpolateSpectral,
    blues: d3.interpolateBlues,
    greens: d3.interpolateGreens,
    greys: d3.interpolateGreys,
    oranges: d3.interpolateOranges,
    purples: d3.interpolatePurples,
    reds: d3.interpolateReds,
    // The multi-hue sequential ColorBrewer ramps.
    bugn: d3.interpolateBuGn,
    bupu: d3.interpolateBuPu,
    gnbu: d3.interpolateGnBu,
    orrd: d3.interpolateOrRd,
    pubu: d3.interpolatePuBu,
    pubugn: d3.interpolatePuBuGn,
    purd: d3.interpolatePuRd,
    rdpu: d3.interpolateRdPu,
    ylgn: d3.interpolateYlGn,
    ylgnbu: d3.interpolateYlGnBu,
    ylorbr: d3.interpolateYlOrBr,
    ylorrd: d3.interpolateYlOrRd,
    viridis: d3.interpolateViridis,
    magma: d3.interpolateMagma,
    inferno: d3.interpolateInferno,
    plasma: d3.interpolatePlasma,
    cividis: d3.interpolateCividis,
    // Data & Dialogue Lab ramps: pale teal -> teal -> blue -> navy, and blue -> coral.
    ddramp: d3.piecewise(d3.interpolateRgb, DD.sequential),
    dddiverging: d3.piecewise(d3.interpolateRgb, DD.diverging),
    turbo: d3.interpolateTurbo,
    warm: d3.interpolateWarm,
    cool: d3.interpolateCool,
    cubehelix: d3.interpolateCubehelixDefault,
    rainbow: d3.interpolateRainbow,
    sinebow: d3.interpolateSinebow,
};
// ColorBrewer discrete palettes (n = 3..11). Used for ordinal colour instead of
// sampling the interpolator, which overshoots the ends.
/** @type {Record<string, { [n: number]: readonly string[] } | readonly string[][]>} */
const DISCRETE_RAMP_SCHEMES = {
    rdbu: d3.schemeRdBu,
    rdylbu: d3.schemeRdYlBu,
    rdylgn: d3.schemeRdYlGn,
    brbg: d3.schemeBrBG,
    piyg: d3.schemePiYG,
    prgn: d3.schemePRGn,
    puor: d3.schemePuOr,
    rdgy: d3.schemeRdGy,
    spectral: d3.schemeSpectral,
    blues: d3.schemeBlues,
    greens: d3.schemeGreens,
    greys: d3.schemeGreys,
    oranges: d3.schemeOranges,
    purples: d3.schemePurples,
    reds: d3.schemeReds,
    bugn: d3.schemeBuGn,
    bupu: d3.schemeBuPu,
    gnbu: d3.schemeGnBu,
    orrd: d3.schemeOrRd,
    pubu: d3.schemePuBu,
    pubugn: d3.schemePuBuGn,
    purd: d3.schemePuRd,
    rdpu: d3.schemeRdPu,
    ylgn: d3.schemeYlGn,
    ylgnbu: d3.schemeYlGnBu,
    ylorbr: d3.schemeYlOrBr,
    ylorrd: d3.schemeYlOrRd,
};

/**
 * Resolve a named colour `scheme` to a range array, or null if unknown.
 * Symbol and categorical schemes return their palette. A ramp scheme returns a
 * 9-stop sample for a continuous channel, else the Brewer set sized to the
 * domain, else `count` samples.
 * @param {string | undefined} scheme
 * @param {import('../types').ScaleType} type the resolved scale type
 * @param {number} count domain length (categories), min 1
 * @returns {any[] | null}
 */
export function schemeRange(scheme, type, count) {
    if (!scheme || typeof scheme !== 'string') return null;
    const key = scheme.toLowerCase();
    // Symbol/emoji schemes are glyph palettes, shaped like a categorical scheme.
    if (SYMBOL_SCHEMES[key]) return [...SYMBOL_SCHEMES[key]];
    if (CATEGORICAL_SCHEMES[key]) return [...CATEGORICAL_SCHEMES[key]];
    const interp = RAMP_SCHEMES[key];
    if (!interp) return null;
    // A continuous colour channel gets a dense sample that createScale joins
    // piecewise. Nine stops keep every hue; an odd count keeps a diverging midpoint.
    if (isRampType(type)) return d3.quantize(interp, 9);
    // A continuous scale type on a colour channel (`scale: { type: 'log', scheme }`)
    // is a ramp too.
    if (isContinuousType(type)) return d3.quantize(interp, 9);
    const n = Math.max(2, count || 2);
    const discrete = DISCRETE_RAMP_SCHEMES[key];
    if (discrete) {
        // Brewer discrete sets exist for n = 3..11; clamp into that window.
        const k = Math.max(3, Math.min(11, n));
        const palette = discrete[k];
        if (palette) return [...palette];
    }
    return d3.quantize(interp, n);
}

// Channel families that share scale semantics.
const COLOR_CHANNELS = new Set(['fill', 'stroke']);
const OPACITY_CHANNELS = new Set(['opacity', 'fillOpacity', 'strokeOpacity']);
// `symbol` maps a category to a glyph through an ordinal scale. Non-positional
// and non-invertible; edited with cycle/legend.
const SYMBOL_CHANNELS = new Set(['symbol']);
// The dash family: a field drives the stroke's dash pattern through an ordinal
// scale onto DEFAULT_DASHES (an author's `range` is a list of SVG dash arrays).
const DASH_CHANNELS = new Set(['strokeDash']);
/** The default dash vocabulary: solid, dashed, dotted, dash-dot, long dash. */
export const DEFAULT_DASHES = ['', '4 2', '1 2', '6 3 1 3', '8 4'];

// The axis each positional channel shares a scale with. x1/x2 and y1/y2 are span
// endpoints on x/y. `theta`/`theta2` are the polar angular position (axis:
// `axisRadial`), not `angle`, which is a rotation in place. `radius` is the radial
// position; its pixel range comes from the mark (`Mark.radiusRange`). `count` is an
// axis in the mark's own unit (a waffle cell, a dotStack token), its own bucket so
// it never unions with y. The map stays static: the resolver accumulates the
// mark's hints per bucket. See .claude/rules/scales-and-encoding.md.
/** @type {Record<string, 'x' | 'y' | 'theta' | 'radius' | 'count'>} */
const AXIS_OF = {
    x: 'x', x1: 'x', x2: 'x',
    y: 'y', y1: 'y', y2: 'y',
    theta: 'theta', theta2: 'theta',
    radius: 'radius',
    count: 'count',
};

/**
 * The positional axis a channel shares its scale with ('x', 'y', 'theta',
 * 'radius' or 'count'), or undefined for a non-positional channel (fill, size,
 * opacity, angle, ...).
 * @param {string} channelName
 * @returns {'x' | 'y' | 'theta' | 'radius' | 'count' | undefined}
 */
export function axisOf(channelName) {
    return AXIS_OF[channelName];
}

// ── Offset channels: a second category nested inside the first ─────────────
// `xOffset`/`yOffset` split each x/y slot into sub-bands (grouped bar, dodged dot).
// Not in AXIS_OF: an offset has its own bucket, no axis, and a range of one parent
// slot, fitted after the parent (core/resolve.js). Marks read it through
// `categorySlot` and `encodeChannel`.
/** @type {Record<string, 'x' | 'y'>} */
const OFFSET_OF = { xOffset: 'x', yOffset: 'y' };

/**
 * The positional axis an offset channel nests inside ('x' for `xOffset`, 'y' for
 * `yOffset`), or undefined for any other channel.
 * @param {string} channelName
 * @returns {'x' | 'y' | undefined}
 */
export function offsetParentOf(channelName) {
    return OFFSET_OF[channelName];
}

// ── Frame channels: a composite's local coordinate box ──────────────────────
// `frame: -0.4` or `scale: 'frame'` / `scale: { type: 'frame', range }` resolves a
// channel against the enclosing composite()'s per-datum box. plot/composite.js
// turns it into a linear scale (createFrameScale), so no resolved scale has type
// 'frame'. The global resolver skips these channels, keeping glyph geometry out
// of the chart's x/y buckets.

/**
 * The frame ScaleSpec of a channel, or null when the channel isn't frame-scaled.
 * Accepts both spellings; the object form carries a local `range`.
 * @param {any} chSpec a ChannelSpec
 * @returns {{ range?: number[], [k: string]: any } | null}
 */
export function frameSpecOf(chSpec) {
    if (!chSpec) return null;
    const s = chSpec.scale;
    if (s === 'frame') return {};
    if (s && typeof s === 'object' && s.type === 'frame') return s;
    return null;
}

/**
 * Desugar the short `frame:` spelling into the `scale` forms:
 *
 *   { frame: -0.4 }                  ->  { datum: -0.4, scale: 'frame' }
 *   { field: 'f', frame: [lo, hi] }  ->  { field: 'f', scale: { type: 'frame', range: [lo, hi] } }
 *   { field: 'f', frame: true }      ->  { field: 'f', scale: 'frame' }
 *
 * An explicit `scale` wins.
 * @param {any} chSpec a ChannelSpec
 * @returns {any} the same spec, or a desugared copy
 */
export function normalizeFrameKey(chSpec) {
    if (!chSpec || typeof chSpec !== 'object' || chSpec.frame === undefined) return chSpec;
    const { frame, ...rest } = chSpec;
    if (rest.scale !== undefined) return rest;
    if (Array.isArray(frame)) return { ...rest, scale: { type: 'frame', range: frame } };
    if (typeof frame === 'number') return { ...rest, datum: frame, scale: 'frame' };
    return { ...rest, scale: 'frame' };
}

// Channels whose frame output is a magnitude (a length from the origin), not a position.
const FRAME_MAGNITUDE = new Set(['size', 'rx', 'ry', 'strokeWidth']);

/**
 * How a channel reads the frame:
 *   'x'     pixel = originX + u * halfSize
 *   'y'     pixel = originY - u * halfSize   (local y is UP)
 *   'size'  pixel = u * halfSize             (a length, no origin)
 *   'plain' pixel = u                        (already in its own output units —
 *                                             `angle`/`theta` in degrees, `curvature`)
 *
 * Only x/y read the box; `theta` (degrees) stays 'plain' like `angle`.
 * @param {string} channelName
 * @returns {'x' | 'y' | 'size' | 'plain'}
 */
export function frameFamilyOf(channelName) {
    const axis = axisOf(channelName);
    if (axis === 'x' || axis === 'y') return axis;
    if (FRAME_MAGNITUDE.has(channelName)) return 'size';
    return 'plain';
}

/**
 * The default local range of a frame channel: [-1, 1] for positional channels
 * (centred on the anchor), [0, 1] for magnitudes, null for 'plain' (the caller
 * falls back to the channel's ordinary range).
 * @param {string} channelName
 * @returns {number[] | null}
 */
export function frameLocalRange(channelName) {
    const family = frameFamilyOf(channelName);
    if (family === 'x' || family === 'y') return [-1, 1];
    if (family === 'size') return [0, 1];
    return null;
}

// ---------------------------------------------------------------------------
// Inference: what the data is, then how a channel draws it (core/resolve.js).
// ---------------------------------------------------------------------------

/**
 * What a field's values are, from a sample: a Date is temporal, a number is
 * quantitative, anything else categorical. No values -> quantitative.
 * @param {any[]} values
 * @returns {import('../types').MeasureType}
 */
export function inferMeasureType(values) {
    const sample = values.find((v) => v != null);
    if (sample instanceof Date) return 'temporal';
    if (typeof sample === 'number') return 'quantitative';
    if (sample === undefined) return 'quantitative';
    return 'categorical';
}

/**
 * Route a channel + its data type to a scale type. The one place this is decided,
 * so a declared type and an inferred one produce the same scale. `discrete` is
 * the scale the mark wants for discrete data (`discreteScale`: 'band' or 'point').
 * @param {string} channelName
 * @param {import('../types').MeasureType} measure
 * @param {import('../types').ScaleType} [discrete]
 * @returns {import('../types').ScaleType}
 */
export function scaleTypeFor(channelName, measure, discrete = 'band') {
    const continuous = measure === 'quantitative' || measure === 'temporal';
    // Colour family: continuous data -> a ramp, discrete -> a palette.
    if (COLOR_CHANNELS.has(channelName)) return continuous ? 'sequential' : 'ordinal';
    // Symbol family: always ordinal (declare the field categorical/ordinal).
    if (SYMBOL_CHANNELS.has(channelName)) return 'ordinal';
    // Dash family: a category -> dash-pattern map.
    if (DASH_CHANNELS.has(channelName)) return 'ordinal';
    // Offset family: a nested category always takes a sub-band of its parent's
    // slot, whatever the mark prefers.
    if (OFFSET_OF[channelName] && !continuous) return 'band';
    // positional / size / opacity: dates -> time, numbers -> linear, categories ->
    // the mark's discrete scale (band|point).
    if (measure === 'temporal') return 'time';
    if (measure === 'quantitative') return 'linear';
    return discrete;
}

/**
 * Infer a scale domain from data values: unique set for discrete scales, extent
 * for continuous ones. Only reached when the schema declares no domain.
 * @param {import('../types').ScaleType} type
 * @param {any[]} values
 * @returns {any[]}
 */
export function inferDomainFromValues(type, values) {
    if (type === 'band' || type === 'point' || type === 'ordinal') {
        return [...new Set(values.filter((v) => v != null))];
    }
    // A time scale reads date strings; NaN is a missing value.
    const nums = values.filter((v) => v != null)
        .map((v) => (type === 'time' ? +toDate(v) : v))
        .filter((v) => !Number.isNaN(v));
    return nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 1];
}

/**
 * Union the declared domains of every field feeding one axis. An error bar puts
 * `mean`, `lo` and `hi` on y; the axis must span all three, not whichever field
 * happened to be encoded first.
 * @param {import('../types').MeasureType} measure
 * @param {any[][]} domains one per field that declared one
 * @returns {any[] | undefined}
 */
export function unionDomains(measure, domains) {
    if (!domains.length) return undefined;
    if (domains.length === 1) return domains[0];
    if (measure === 'quantitative' || measure === 'temporal') {
        const num = measure === 'temporal' ? (/** @type {any} */ v) => +toDate(v) : Number;
        const lows = domains.map((d) => Math.min(...d.map(num)));
        const highs = domains.map((d) => Math.max(...d.map(num)));
        const [lo, hi] = [Math.min(...lows), Math.max(...highs)];
        return measure === 'temporal' ? [new Date(lo), new Date(hi)] : [lo, hi];
    }
    // Discrete: ordered union, first-seen order (ordinal's order is significant).
    return [...new Set(domains.flat())];
}

// Scheme families the automatic colour path rotates through, one per encoding on
// a channel, so two encodings don't both start at palette index 0. Index 0 defers
// to the theme.
const CATEGORICAL_ROTATION = ['tableau10', 'dark2', 'set2', 'accent', 'paired', 'set3'];
const SEQUENTIAL_ROTATION = ['blues', 'oranges', 'greens', 'purples', 'greys'];

/** Sample a 2+ stop ramp array to `n` evenly spaced swatches. */
function rampToDiscrete(/** @type {any[]} */ stops, /** @type {number} */ n) {
    if (n <= 1) return [stops[stops.length - 1]];
    const interp = d3.piecewise(d3.interpolateRgb, stops);
    return d3.quantize(interp, n);
}

/**
 * The default colour range for a colour channel, chosen by the measure:
 *   categorical  -> distinct hues
 *   ordinal      -> an ordered ramp sampled to one swatch per category
 *   quantitative -> a continuous ramp
 * `index` is which encoding this is among those sharing the channel: index 0
 * reads the theme, later ones take a different scheme family.
 * @param {import('../types').ScaleType} type
 * @param {any} theme
 * @param {{ measure?: import('../types').MeasureType, index?: number, count?: number }} [opts]
 * @returns {any[]}
 */
function colorRange(type, theme, opts = {}) {
    const { measure, index = 0, count = 2 } = opts;
    const nth = (/** @type {string[]} */ list) => list[index % list.length];

    if (type === 'diverging') {
        return index === 0
            ? ((theme && theme.diverging) || DEFAULT_DIVERGING)
            : (schemeRange(nth(['rdbu', 'brbg', 'piyg', 'rdylgn']), 'diverging', count) || DEFAULT_DIVERGING);
    }
    if (type === 'sequential') {
        return index === 0
            ? ((theme && theme.ramp) || DEFAULT_RAMP)
            : (schemeRange(nth(SEQUENTIAL_ROTATION), 'sequential', count) || DEFAULT_RAMP);
    }
    // Discrete from here. Whether swatches are ordered depends on the measure,
    // not the scale type.
    if (measure === 'ordinal') {
        // Index 0 samples the theme's ramp.
        if (index === 0) return rampToDiscrete((theme && theme.ramp) || DEFAULT_RAMP, Math.max(2, count));
        return schemeRange(nth(SEQUENTIAL_ROTATION), 'ordinal', count)
            || rampToDiscrete(DEFAULT_RAMP, Math.max(2, count));
    }
    return index === 0
        ? ((theme && theme.palette) || DEFAULT_PALETTE)
        : (schemeRange(nth(CATEGORICAL_ROTATION), 'ordinal', count) || DEFAULT_PALETTE);
}

/**
 * The pixel extent of a polar mark's ring: `outer` as declared, else 0.4 of the
 * plot's smaller side; `inner` in (0, 1] is a ratio of outer, above 1 px (clamped
 * inside). Read by `channelRange` and by `arc`, so scale range and ring agree.
 * @param {{ inner?: number | null, outer?: number | null } | null | undefined} hint
 * @param {{ width: number, height: number }} dims
 * @returns {{ inner: number, outer: number }}
 */
export function radiusExtent(hint, dims) {
    const outer = hint && hint.outer != null ? hint.outer : 0.4 * Math.min(dims.width, dims.height);
    const innerOpt = hint && hint.inner != null ? hint.inner : 0;
    const inner = innerOpt > 0 && innerOpt <= 1 ? innerOpt * outer : Math.min(innerOpt, outer * 0.95);
    return { inner, outer };
}

/**
 * The default visual output range for a channel: pixels for x/y, a radius
 * interval for size, a palette/ramp for colour, [0,1] for opacity.
 * @param {string} channelName
 * @param {import('../types').ScaleType} type
 * @param {{ width: number, height: number }} dims
 * @param {any} [theme] the resolved theme (supplies default palette/ramp/diverging)
 * @param {{ measure?: import('../types').MeasureType, index?: number, count?: number, countAxis?: 'x' | 'y', radiusRange?: { inner?: number | null, outer?: number | null } | null }} [opts]
 *   colour reads `measure`, `index` and `count`; `countAxis` and `radiusRange`
 *   are hints accumulated from the mark.
 * @returns {any[]}
 */
export function channelRange(channelName, type, dims, theme, opts = {}) {
    switch (channelName) {
        case 'x': return [0, dims.width];
        case 'y': return [dims.height, 0];   // pixel y is inverted
        case 'size': return [3, 18];         // radius, px
        // An ellipse's two radii are the size family, one per axis.
        case 'rx': return [3, 18];
        case 'ry': return [3, 18];
        // How far a `curve` bows off its chord, as a fraction of the half-chord:
        // 0 is a straight segment, ±1 bows out by the half-chord's length.
        case 'curvature': return [-1, 1];
        // Degrees, math convention (y-up): left (180°) -> right (0°) over the top.
        // `theta` and `angle` share the default but get separate scales.
        case 'theta': return [180, 0];
        case 'angle': return [180, 0];
        // A count axis runs along the direction the mark declares (`Mark.countAxis`).
        case 'count': return opts.countAxis === 'x' ? [0, dims.width] : [dims.height, 0];
        // Radial position: px between the mark's inner and outer radius (`radiusExtent`).
        case 'radius': { const r = radiusExtent(opts.radiusRange, dims); return [r.inner, r.outer]; }
    }
    // Opacity and colour families share their base channel's range.
    if (OPACITY_CHANNELS.has(channelName)) return [0.15, 1];
    if (COLOR_CHANNELS.has(channelName)) return colorRange(type, theme, opts);
    // Symbol channel: a glyph palette (author overrides with scale.range/scheme).
    if (SYMBOL_CHANNELS.has(channelName)) return [...DEFAULT_SYMBOLS];
    if (DASH_CHANNELS.has(channelName)) return [...DEFAULT_DASHES];
    // Stroke width in px; the [0, 1] fallback would draw identical hairlines.
    if (channelName === 'strokeWidth') return [1, 8];
    return [0, 1];
}

/**
 * A feature's channel map. Marks carry `channels` directly; this is the one
 * accessor, so the engine never reaches into a feature's shape.
 * @param {any} feature
 * @returns {Record<string, any>}
 */
export function normalizeChannels(feature) {
    return feature.channels || {};
}

// ---------------------------------------------------------------------------
// Interaction primitive — the inverse direction (gesture -> data).
// ---------------------------------------------------------------------------

/**
 * Math-convention angle in degrees (y-up, 0° = +x, counterclockwise) of a
 * pointer about a centre. Shared by visualForChannel('theta'/'angle') and rotate().
 * @param {{ x: number, y: number }} pointer
 * @param {{ cx: number, cy: number }} center
 * @returns {number}
 */
export function pointerDegrees(pointer, center) {
    return Math.atan2(-(pointer.y - center.cy), pointer.x - center.cx) * 180 / Math.PI;
}

/**
 * Bring a raw atan2 angle (from pointerDegrees, in (-180, 180]) to within ±180°
 * of an arc span's centre, then clamp to the span. Avoids the ±180° branch cut
 * reading as a jump to the far end; a no-op for a full circle. Shared by rotate()
 * and the arc edge edit.
 * @param {number} deg raw angle in (-180, 180]
 * @param {number} spanStart degrees (scale.range[0])
 * @param {number} spanEnd degrees (scale.range[last])
 * @returns {number}
 */
export function unwrapDegrees(deg, spanStart, spanEnd) {
    const lo = Math.min(spanStart, spanEnd);
    const hi = Math.max(spanStart, spanEnd);
    const center = (lo + hi) / 2;
    // Shift by whole turns into (center - 180, center + 180].
    const unwrapped = center + ((((deg - center) % 360) + 540) % 360) - 180;
    return Math.max(lo, Math.min(hi, unwrapped));
}

/**
 * Gesture -> visual for a channel-scoped interaction: positional channels read
 * the pointer; `size`/`radius` read the distance from `center`; `theta`/`angle`
 * read the bearing about it. The one place gestures are mapped.
 * @param {string} channelName
 * @param {{ x: number, y: number }} pointer
 * @param {{ cx: number, cy: number } | null} [center]
 * @returns {number | undefined}
 */
export function visualForChannel(channelName, pointer, center) {
    const axis = axisOf(channelName);
    if (axis === 'x') return pointer.x;
    if (axis === 'y') return pointer.y;
    // An offset reads the pointer along its parent axis; its invertValue finds the
    // parent slot (core/scales.js: nestOffsetScale).
    const parent = OFFSET_OF[channelName];
    if (parent === 'x') return pointer.x;
    if (parent === 'y') return pointer.y;
    // A radius — `size` (a mark's own extent) or `radius` (a polar position) — is
    // the pointer's distance from the centre.
    if (channelName === 'size' || axis === 'radius') {
        return center ? Math.hypot(pointer.x - center.cx, pointer.y - center.cy) : undefined;
    }
    // `theta` and `angle` both invert as a bearing about the centre.
    if (channelName === 'theta' || channelName === 'angle') {
        return center ? pointerDegrees(pointer, center) : undefined;
    }
    return undefined; // channel isn't spatially adjustable this way
}

/**
 * The inverse of visualForChannel: the pointer position that produces a visual
 * value. Lets an external controller drive a positional edit by a data value
 * (encode -> pointer -> the edit's invert round-trips). `center` is the pivot
 * for radial channels.
 * @param {string} channelName
 * @param {number} visual value already in the scale's output space
 * @param {{ cx: number, cy: number } | null} [center]
 * @returns {{ x: number, y: number } | undefined}
 */
export function pointerForChannel(channelName, visual, center = null) {
    const axis = axisOf(channelName);
    if (axis === 'x') return { x: visual, y: center ? center.cy : 0 };
    if (axis === 'y') return { x: center ? center.cx : 0, y: visual };
    if (!center) return undefined; // radial channels need a pivot
    if (channelName === 'size' || axis === 'radius') { // radius along +x from the centre
        return { x: center.cx + visual, y: center.cy };
    }
    // Both angular channels: a point on a unit-ish circle at `visual` degrees.
    if (channelName === 'theta' || channelName === 'angle') {
        const rad = visual * Math.PI / 180;
        const R = 100; // any R > 0 works — pointerDegrees only reads atan2, not distance
        return { x: center.cx + R * Math.cos(rad), y: center.cy - R * Math.sin(rad) };
    }
    return undefined; // channel isn't spatially adjustable this way
}
