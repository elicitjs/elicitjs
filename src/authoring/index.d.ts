/**
 * Type declarations for the AUTHORING KIT — what you build new vocabulary FROM.
 *
 * Kept out of the grammar namespaces (`plot.*`, `edit.*`, `constraints.*`,
 * `guides.*`, `elements.*`, `widgets.*`), none of which may contain anything
 * that cannot appear in a spec. See src/authoring/index.js for what each group is
 * for.
 *
 * Reachable as `elicit.authoring.*` or `import { … } from 'elicitjs/authoring'`.
 *
 * GENERATED from the JSDoc on the source modules — do not edit by hand.
 * Regenerate with `node scripts/gen-authoring-types.mjs`; `npm run check:exports`
 * fails if it drifts from the runtime barrel.
 */
// ── from src/plot/mark.js ───────────────────────────────────────────────────
/**
 * Map a datum through one channel's global scale. Handles `{ fn }`, `{ value }`,
 * `{ datum }`, `{ field }` and `{ field, scale: null }`, and falls back when the
 * scale or value is missing. A function `value` is a constant, never called.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {import('../types.js').Datum | null} datum a null datum resolves constants only
 * @param {any} [fallback]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any}
 */
export function encodeChannel(scales: import("../types.js").ScaleMap, channels: Record<string, any>, channel: string, datum: import("../types.js").Datum | null, fallback?: any, index?: number, data?: import("../types.js").Datum[]): any;
/**
 * The interval a datum occupies on a category axis: its category's band, or the
 * sub-band its `xOffset`/`yOffset` category picks inside it. A continuous offset
 * (a jitter) shifts the whole band to centre on its encoded position.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {'x' | 'y'} axis the category axis
 * @param {import('../types.js').Datum} datum
 * @param {string | undefined} key the mark's xKey/yKey fallback
 * @param {number} [index]
 * @param {import('../types.js').Datum[]} [data]
 * @param {number} [fallbackWidth] thickness with no band (bandwidthOf's fallback)
 * @returns {{ start: number, width: number }}
 */
export function categorySlot(scales: import("../types.js").ScaleMap, channels: Record<string, any>, axis: "x" | "y", datum: import("../types.js").Datum, key: string | undefined, index?: number, data?: import("../types.js").Datum[], fallbackWidth?: number): {
    start: number;
    width: number;
};
/**
 * Resolve a mark's handle options into the paint every handle node needs.
 * @param {import('../types.js').ScaleMap} scales the scale map (carries the theme)
 * @param {{ handles?: boolean | string, handleSize?: number, handleColor?: string }} options
 * @param {{ fill?: string, stroke?: string }} [fallback] the mark's own ink, when it has one
 * @returns {{ visible: boolean, grabbable: boolean, size: number, fill: string, stroke: string, strokeWidth: number }}
 */
export function resolveHandles(scales: import("../types.js").ScaleMap, options: {
    handles?: boolean | string;
    handleSize?: number;
    handleColor?: string;
}, fallback?: {
    fill?: string;
    stroke?: string;
}): {
    visible: boolean;
    grabbable: boolean;
    size: number;
    fill: string;
    stroke: string;
    strokeWidth: number;
};
/**
 * The `xKey`/`yKey` a mark reports to the edit/constraint layer: the field bound to
 * each positional channel, defaulting to the channel name. arc, needle and the geo
 * marks don't use this and say why at their own declaration.
 * @param {Record<string, any> | undefined} channels
 * @returns {{ xKey: string, yKey: string }}
 */
export function positionalKeys(channels: Record<string, any> | undefined): {
    xKey: string;
    yKey: string;
};
/**
 * Which axis a directional mark's value runs along.
 *   orientation  'vertical' = the value runs along y, 'horizontal' = along x.
 *                The `…Y`/`…X` factory variants pin it.
 *   extent       what an x1/x2 or y1/y2 pair means: 'value' (the pair is the
 *                value; area, rect, bar) or 'span' (the pair is the chord, so the
 *                other axis is the value; rule, tick, curve).
 *   single       what one bound positional channel means: 'value' (where the mark
 *                sits; rule, text) or 'other' (the category; waffle, dotStack, curve).
 * Precedence: orientation; a declared pair; a band scale (value on the other axis;
 * only when `scales` is passed, which counting marks skip because they answer at
 * factory time); a lone channel; else y.
 * @param {Record<string, any> | undefined} channels
 * @param {import('../types.js').ScaleMap | null | undefined} scales
 * @param {{ orientation?: string, extent?: 'value' | 'span', single?: 'value' | 'other' }} [opts]
 * @returns {'x' | 'y'}
 */
export function resolveValueAxis(channels: Record<string, any> | undefined, scales: import("../types.js").ScaleMap | null | undefined, { orientation, extent, single }?: {
    orientation?: string;
    extent?: "value" | "span";
    single?: "value" | "other";
}): "x" | "y";
/**
 * Resolve a datum's category key on a band/point axis: the discrete counterpart to
 * `encodeChannel`. Band marks feed the key to `bandStartOf`/`bandwidthOf`.
 *   { fn }     fn(d, i, data) -> the category key
 *   { datum }  a constant category (pins every row to one band)
 *   { field }  datum[field]
 *   (none)     datum[key], else the column named after the channel (warns)
 * `{ value }` warns: a category axis has no visual-space constant; use `{ datum }`.
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {import('../types.js').Datum | null} datum
 * @param {string | undefined} key the mark's xKey/yKey fallback
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any} the category key, or undefined when there is nothing to resolve
 */
export function categoryOf(channels: Record<string, any>, channel: string, datum: import("../types.js").Datum | null, key: string | undefined, index?: number, data?: import("../types.js").Datum[]): any;
/**
 * Encode an arbitrary value, in the field's units, through a channel's scale. For
 * parametric marks that compute points no row holds (trend, trendBand). Honours
 * `scale: null` and a missing scale like `encodeChannel`.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {any} value in the channel field's own units
 * @param {any} [fallback]
 * @returns {any}
 */
export function encodeValue(scales: import("../types.js").ScaleMap, channels: Record<string, any>, channel: string, value: any, fallback?: any): any;
/**
 * Resolve an angular channel to math degrees (0° = +x, CCW, y-up). Scaled when the
 * channel has a scale, so `rotate()` inverts exactly; otherwise raw degrees.
 * `theta` is a polar position (a needle's bearing, an arc's sweep); `angle` is a
 * rotation in place, with no axis or legend. Marks stamp the result on
 * `FeatureNode.angle`, the rendered rotation.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel 'angle' (rotation) or 'theta' (polar position)
 * @param {import('../types.js').Datum | null} datum
 * @param {number} [fallback=0]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {number}
 */
export function encodeAngle(scales: import("../types.js").ScaleMap, channels: Record<string, any>, channel: string, datum: import("../types.js").Datum | null, fallback?: number, index?: number, data?: import("../types.js").Datum[]): number;
/**
 * Resolve a datum's glyph string on the `symbol` channel, or undefined when there
 * is no symbol channel or the category maps to nothing.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types.js').Datum} datum
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {string | undefined}
 */
export function resolveSymbol(scales: import("../types.js").ScaleMap, channels: Record<string, any>, datum: import("../types.js").Datum, index?: number, data?: import("../types.js").Datum[]): string | undefined;
/**
 * Build a `text` node for a glyph centred at (cx, cy), sized to a circle of radius
 * `size`. `extra` carries the caller's style/data/index/pointer fields.
 * @param {string} glyph
 * @param {number} cx @param {number} cy
 * @param {number} size the radius the mark would have used for a circle, in px
 * @param {Record<string, any>} [extra]
 * @returns {import('../types.js').FeatureNode}
 */
export function symbolNode(glyph: string, cx: number, cy: number, size: number, extra?: Record<string, any>): import("../types.js").FeatureNode;
/**
 * Resolve the standard style channels for one datum into a style object for a
 * scene node. Only declared channels (or non-undefined defaults) are included.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types.js').Datum} datum
 * @param {Record<string, any>} [defaults] per-mark default fallbacks (e.g. fill)
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {Record<string, any>}
 */
export function resolveStyle(scales: import("../types.js").ScaleMap, channels: Record<string, any>, datum: import("../types.js").Datum, defaults?: Record<string, any>, index?: number, data?: import("../types.js").Datum[]): Record<string, any>;
/**
 * The field that groups rows into series (a line, an area, a stack segment): the
 * `series` channel, else the field behind fill, stroke, then strokeDash. `series`
 * is a raw channel (never scaled), so marks list it in `Mark.rawChannels`.
 * @param {Record<string, any>} channels the mark's channel map
 * @returns {string | null}
 */
export function seriesFieldOf(channels?: Record<string, any>): string | null;
/**
 * The options every mark passes through verbatim: id, edits, table, tip, clip.
 * Spread first in a factory's returned object; a key stated after it wins.
 *
 * `table:` names the one table a mark draws. Without it the mark takes the table
 * filling its `tableRole` (`link` declares 'links'; other marks get the primary
 * table). Names go in `table:`; roles go in `tableRole` and `Edit.table`.
 * @param {any} opts the result of normalizeMarkOptions
 * @returns {{ id: any, edits: any, table: any, tip: any, clip: any }}
 */
export function markCommon(opts: any): {
    id: any;
    edits: any;
    table: any;
    tip: any;
    clip: any;
};
/**
 * Desugar top-level style shorthands (`fill: 'steelblue'`, `size: 9`) into
 * `channels`, and return new options with the shorthands stripped. An explicit
 * channel wins; a function becomes `{ fn }`, any other value `{ value }`.
 *
 * `except` keeps named shorthands as top-level options, for a mark where the name
 * is chrome rather than per-datum style (an axis's `stroke` paints its spine).
 * Pass `mark` and `allow` for unknown-option diagnostics (see warnUnknownOptions).
 * @param {any} [options]
 * @param {{ except?: string[], mark?: string, allow?: string[] }} [opts]
 * @returns {any}
 */
export function normalizeMarkOptions(options?: any, { except, mark, allow }?: {
    except?: string[];
    mark?: string;
    allow?: string[];
}): any;
/**
 * Validate a chart element's options (`views: 'scale'`). The diagnostics half of
 * normalizeMarkOptions, without the shorthand desugar: an element has no datum,
 * and must not accept the mark style shorthands.
 * @param {string} element the factory name, for the message
 * @param {any} options
 * @param {string[]} allow the element's own option vocabulary
 * @returns {void}
 */
export function warnUnknownElementOptions(element: string, options: any, allow: string[]): void;
/** @type {string[]} */
export const STANDARD_STYLE_CHANNELS: string[];
/**
 * The default handle radius. A mark's `handles` option is one of:
 *   true    drawn and grabbable (the default)
 *   false   neither drawn nor grabbable
 *   'hit'   invisible but grabbable, where the shape itself is the affordance
 * @type {{ size: number }}
 */
export const HANDLE_DEFAULTS: {
    size: number;
};
export function orientationOf(axis: "x" | "y"): "horizontal" | "vertical";
/**
 * The style names an axis treats as chrome, not per-datum channels. Pass to
 * normalizeMarkOptions's `except`.
 * @type {string[]}
 */
export const AXIS_CHROME: string[];
// ── from src/core/scales.js ─────────────────────────────────────────────────
/**
 * @param {any} scale
 * @returns {boolean}
 */
export function isBand(scale: any): boolean;
/**
 * Discrete positional scale (band or point): a category per slot, not a number
 * line. The two share every geometry rule except the half-bandwidth offset.
 * @param {any} scale
 * @returns {boolean}
 */
export function isDiscrete(scale: any): boolean;
/**
 * The min/max pixel bounds of a scale's (possibly reversed) range.
 * @param {any} scale
 * @returns {[number, number]}
 */
export function rangeExtent(scale: any): [number, number];
/**
 * Thickness a band occupies (bar width/height); fallback for non-band scales.
 * @param {any} scale
 * @param {any} [fallback]
 * @returns {any}
 */
export function bandwidthOf(scale: any, fallback?: any): any;
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
export function bandStartOf(scale: any, value: any, fallback?: any): any;
/**
 * The width of one category's slot on a discrete axis: a band's bandwidth, a
 * point's step (the distance between two ticks, centred on each). Undefined for
 * a continuous scale, which has no slot. What an offset channel's range spans.
 * @param {any} scale
 * @returns {number | undefined}
 */
export function slotWidthOf(scale: any): number | undefined;
/**
 * The pixel interval a category occupies on a discrete axis: a band's own
 * interval, or a point's step centred on its tick. Null when the scale is not
 * discrete or the value is not in its domain.
 * @param {any} scale
 * @param {any} value
 * @returns {{ start: number, width: number } | null}
 */
export function slotOf(scale: any, value: any): {
    start: number;
    width: number;
} | null;
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
export function offsetScaleOf(scales: Record<string, any>, channels: Record<string, any> | undefined, axis: "x" | "y"): any;
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
export function bandSpan(scale: any, value: any, fullLength: number, { inset, length, slot }?: {
    inset?: number;
    length?: number;
    slot?: {
        start: number;
        width: number;
    };
}): [number, number];
/**
 * Pixel baseline (value origin) of a value scale — where a bar starts from.
 * Uses 0 when in the domain, clamped into the range so bars never escape it.
 * With no scale on that axis (a `{ fn }`-only value channel resolves none) the
 * caller's fallback stands in, rather than a crash in `range()`.
 * @param {any} valueScale
 * @param {number} [fallback]
 * @returns {number}
 */
export function baselineOf(valueScale: any, fallback?: number): number;
// ── from src/plot/polar.js ──────────────────────────────────────────────────
/**
 * @param {number} deg
 * @returns {number}
 */
export function degToRad(deg: number): number;
/**
 * Pixel point at radius `r` and math-degrees `deg` about (cx, cy).
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} deg
 * @returns {{ x: number, y: number }}
 */
export function polarToXY(cx: number, cy: number, r: number, deg: number): {
    x: number;
    y: number;
};
/**
 * Resolve a mark's arc span in degrees from `orient` / `arc` / `start` / `end`.
 *   orient: 'top'|'right'|'bottom'|'left'  — semicircle facing that side
 *   arc: 'semi' (default, same as orient:'top') | 'full'
 * Explicit start/end win over named presets.
 * @param {{
 *   arc?: 'semi' | 'full',
 *   orient?: 'top' | 'right' | 'bottom' | 'left',
 *   start?: number,
 *   end?: number
 * }} opts
 * @returns {[number, number]}
 */
export function arcSpan(opts?: {
    arc?: "semi" | "full";
    orient?: "top" | "right" | "bottom" | "left";
    start?: number;
    end?: number;
}): [number, number];
/**
 * SVG path `d` for an annular sector (or a simple arc when innerRadius is 0).
 * Outer rim from startDeg → endDeg, optional inner rim back. Used by axisRadial
 * bands and the arc (pie/donut) mark.
 * @param {number} cx
 * @param {number} cy
 * @param {number} outerRadius
 * @param {number} startDeg
 * @param {number} endDeg
 * @param {{ innerRadius?: number }} [opts]
 * @returns {string}
 */
export function arcPath(cx: number, cy: number, outerRadius: number, startDeg: number, endDeg: number, opts?: {
    innerRadius?: number;
}): string;
/**
 * SVG path `d` for a stroked arc (spine only — no pie fill).
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {string}
 */
export function arcSpine(cx: number, cy: number, radius: number, startDeg: number, endDeg: number): string;
/**
 * Angular interval [lo, hi] in degrees for one category on an angle scale
 * (band → band edges; point → midpoints between neighbours; continuous → null).
 * @param {any} scale
 * @param {any} value
 * @returns {[number, number] | null}
 */
export function angularBand(scale: any, value: any): [number, number] | null;
/**
 * Triangle vertices for a tapered needle pointing at `deg`.
 * @param {number} cx
 * @param {number} cy
 * @param {number} length
 * @param {number} deg
 * @param {number} [baseWidth]
 * @returns {[number, number][]}
 */
export function needleTriangle(cx: number, cy: number, length: number, deg: number, baseWidth?: number): [number, number][];
/**
 * Named semicircle orientations (math degrees, 0° = +x, CCW). The arc sits on
 * the named side; the open side faces the opposite way — NYT gauges use `top`.
 * @type {Record<string, [number, number]>}
 */
export const ORIENT_SPAN: Record<string, [number, number]>;
// ── from src/plot/trendGeometry.js ──────────────────────────────────────────
/**
 * Merge author channels over the defaults and stamp `scale: null` on every
 * parameter channel. `x` / `y` are left scaled.
 * @param {Record<string, any>} rawChannels
 * @param {Record<string, any>} [defaults] parameter defaults, e.g. { intercept: { field: 'intercept' } }
 * @returns {Record<string, any>}
 */
export function paramChannels(rawChannels: Record<string, any>, defaults?: Record<string, any>): Record<string, any>;
/**
 * Read one row's line (`a`, `b`) and the bounds on each. With no uncertainty
 * declared the bounds equal the line (a zero-width band).
 * @param {any} datum
 * @param {Record<string, any>} channels
 * @param {import('../types.js').ScaleMap} scales
 * @param {number} [index]
 * @param {any[]} [data]
 * @returns {{ a: number, b: number, aLo: number, aHi: number, bLo: number, bHi: number }}
 */
export function readParams(datum: any, channels: Record<string, any>, scales: import("../types.js").ScaleMap, index?: number, data?: any[]): {
    a: number;
    b: number;
    aLo: number;
    aHi: number;
    bLo: number;
    bHi: number;
};
/**
 * The two x positions a trend's handles use.
 *   anchor — the pivot the intercept handle sits at and the slope rotates about.
 *            Defaults to 0 when in the x domain, else the domain's first end.
 *   probe  — the slope handle's column under `grip: 'probe'`. Defaults to the
 *            domain's last end.
 * @param {import('../types.js').ScaleMap} scales
 * @param {{ anchor?: number, probe?: number }} [opts]
 * @returns {{ anchor: number, probe: number }}
 */
export function anchorsOf(scales: import("../types.js").ScaleMap, opts?: {
    anchor?: number;
    probe?: number;
}): {
    anchor: number;
    probe: number;
};
/**
 * The line y = a + b·x clipped to the plot, extended edge to edge rather than
 * stopping at the domain ends.
 * @param {{ a: number, b: number }} params
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
export function lineSegment(params: {
    a: number;
    b: number;
}, scales: import("../types.js").ScaleMap, channels: Record<string, any>, width: number, height: number): {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
} | null;
/**
 * The exact envelope polygon of a line family, in plot pixels, clipped to the plot.
 * Evaluated at the x-domain ends plus x = 0 (the kink) when that lies between them.
 * @param {{ aLo: number, aHi: number, bLo: number, bHi: number }} params
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {[number, number][]}
 */
export function envelopePolygon(params: {
    aLo: number;
    aHi: number;
    bLo: number;
    bHi: number;
}, scales: import("../types.js").ScaleMap, channels: Record<string, any>, width: number, height: number): [number, number][];
/**
 * `levels` nested envelopes, innermost first: the band at increasing fractions of
 * its spread. Stacked at low opacity they darken toward the line.
 * @param {{ a: number, b: number, aLo: number, aHi: number, bLo: number, bHi: number }} params
 * @param {number} levels
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {number} width
 * @param {number} height
 * @returns {[number, number][][]}
 */
export function nestedEnvelopes(params: {
    a: number;
    b: number;
    aLo: number;
    aHi: number;
    bLo: number;
    bHi: number;
}, levels: number, scales: import("../types.js").ScaleMap, channels: Record<string, any>, width: number, height: number): [number, number][][];
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
export function sampleLines(params: {
    a: number;
    b: number;
    aLo: number;
    aHi: number;
    bLo: number;
    bHi: number;
}, opts?: {
    samples?: number;
    seed?: number;
    distribution?: string;
    sigma?: number;
}): {
    a: number;
    b: number;
}[];
export function valueAt(p: {
    a: number;
    b: number;
}, x: number): number;
// ── from src/plot/linkGeometry.js ───────────────────────────────────────────
export type LinkShape = {
    /**
     * authored SVG path
     */
    d?: string | undefined;
    /**
     * polyline the renderer interpolates
     */
    points?: [number, number][] | undefined;
    /**
     * d3 curve name for `points`
     */
    curve?: string | undefined;
    /**
     * sampled polyline for the grab path
     */
    hit?: [number, number][] | undefined;
    /**
     * the shape's own source endpoint
     */
    start: {
        x: number;
        y: number;
    };
    /**
     * the shape's own target endpoint
     */
    end: {
        x: number;
        y: number;
    };
    /**
     * where a label sits
     */
    mid: {
        x: number;
        y: number;
    };
    /**
     * unit vector into the source end
     */
    tangentIn: {
        x: number;
        y: number;
    };
    /**
     * unit vector out of the target end
     */
    tangentOut: {
        x: number;
        y: number;
    };
};
export type LinkSegment = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
};
/**
 * A node's rectangle in scene coordinates, as centre plus half-extents.
 */
export type LinkBox = {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
};
export type LinkShapeOptions = {
    /**
     * how far a self-loop reaches from its node
     */
    loopRadius?: number | undefined;
    /**
     * corner rounding for the routed kinds
     */
    cornerRadius?: number | undefined;
    /**
     * the source node's box (box-anchored kinds)
     */
    source?: LinkBox | undefined;
    /**
     * the target node's box
     */
    target?: LinkBox | undefined;
    /**
     * clearance from the source edge, in px
     */
    sourceGap?: number | undefined;
    /**
     * clearance from the target edge, in px
     */
    targetGap?: number | undefined;
    /**
     * a named edge, or null/'auto' to slide; shorthand for `sourcePort.side`
     */
    sourceSide?: string | null | undefined;
    /**
     * a named edge, or null/'auto' to slide
     */
    targetSide?: string | null | undefined;
    /**
     * where the route leaves the source box
     */
    sourcePort?: import("../plot/linkRouter.js").LinkPort | undefined;
    /**
     * where it enters the target box
     */
    targetPort?: import("../plot/linkRouter.js").LinkPort | undefined;
    /**
     * a pinned source edge's outward normal, for a curved kind's tangent
     */
    sourceNormal?: {
        x: number;
        y: number;
    } | undefined;
    /**
     * a pinned target edge's outward normal
     */
    targetNormal?: {
        x: number;
        y: number;
    } | undefined;
    /**
     * every node box in the chart, for a routed kind to avoid
     */
    obstacles?: LinkBox[] | undefined;
    /**
     * the edge a self-loop leaves by (`loopSides`)
     */
    loopOut?: string | undefined;
    /**
     * the edge a self-loop returns by
     */
    loopIn?: string | undefined;
    /**
     * how many loops sit inside this one on its edge
     */
    nest?: number | undefined;
    /**
     * the chart's routing grid, for detours
     */
    grid?: import("../plot/linkRouter.js").RoutingGrid | undefined;
};
/**
 * The link shapes, keyed by kind. `smooth` builds the same shape as `bezier`;
 * `loop` is used only for a row referencing one node twice.
 *
 * `anchors` says what the `seg` passed to `build` means: `'chord'`, the chord already
 * inset; `'box'`, the two node centres, with the boxes in `opts`.
 * @type {Record<string, { anchors: string, build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null }>}
 */
export const LINK_SHAPES: Record<string, {
    anchors: string;
    build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null;
}>;
// ── from src/plot/hitpath.js ────────────────────────────────────────────────
/**
 * Sample a quadratic Bézier into a polyline. `samples` lets a rounded corner
 * (linkGeometry.js) use fewer segments.
 * @param {[number, number]} p1 @param {[number, number]} c @param {[number, number]} p2
 * @param {number} [samples] segments to divide the curve into
 * @returns {[number, number][]}
 */
export function sampleQuadratic(p1: [number, number], c: [number, number], p2: [number, number], samples?: number): [number, number][];
/**
 * Sample a cubic Bézier into a polyline.
 * @param {[number, number]} p1 @param {[number, number]} c1
 * @param {[number, number]} c2 @param {[number, number]} p2
 * @returns {[number, number][]}
 */
export function sampleCubic(p1: [number, number], c1: [number, number], c2: [number, number], p2: [number, number]): [number, number][];
// ── from src/plot/stack.js ──────────────────────────────────────────────────
/**
 * Which rows form one group. The positional channels in `keys` that carry a field
 * partition the dataset; with none bound, every row is one group. Keys resolve
 * through `categoryOf`, so `{ fn }` and `{ datum }` channels group the way they
 * draw. Each group keeps its rows' global indices in first-seen order.
 *
 * @param {any[]} data the chart's dataset
 * @param {Record<string, any>} channels the mark's channel map
 * @param {string[]} keys positional channels that may group (e.g. ['x'] or ['x','y'])
 * @param {Record<string, string | undefined>} [fallbackKeys] each channel's xKey/yKey fallback
 * @returns {{ key: string, rep: any, members: number[] }[]} groups, in first-seen order
 */
export function groupByPosition(data: any[], channels: Record<string, any>, keys: string[], fallbackKeys?: Record<string, string | undefined>): {
    key: string;
    rep: any;
    members: number[];
}[];
/**
 * One group's shares and cumulative bounds, in the magnitude field's data units.
 * `bounds[local]` is `[lo, hi]`: the running total before and after this row.
 * Non-finite and negative magnitudes count as 0.
 *
 * @param {number[]} members global row indices, in stack order
 * @param {any[]} data the chart's dataset
 * @param {string | undefined} field the magnitude column
 * @returns {{ mags: number[], total: number, bounds: [number, number][] }}
 */
export function stackLayout(members: number[], data: any[], field: string | undefined): {
    mags: number[];
    total: number;
    bounds: [number, number][];
};
/**
 * What a mark stamps on a segment node or boundary handle so `edit.stack.*` can
 * invert the layout. Pure data, no closures or scales: edits re-derive magnitudes
 * from the live dataset each tick and read only `members`/`geometry` from it.
 *
 * `geometry` says how a pointer becomes a position along the stack:
 *   { kind: 'linear',  axis }                            value axis, through its scale
 *   { kind: 'angular', cx, cy, spanStart, spanEnd, pad } around a ring
 *
 * @param {{ members: number[], local?: number, field: string | undefined, geometry: any }} spec
 * @returns {{ members: number[], local: number | undefined, field: string | undefined, geometry: any }}
 */
export function stackDescriptor({ members, local, field, geometry }: {
    members: number[];
    local?: number;
    field: string | undefined;
    geometry: any;
}): {
    members: number[];
    local: number | undefined;
    field: string | undefined;
    geometry: any;
};
// ── from src/core/measure.js ────────────────────────────────────────────────
/**
 * The rendered width of a string, in px.
 * @param {string} text
 * @param {{ fontSize?: number, fontFamily?: string, fontWeight?: string | number }} [font]
 * @returns {number}
 */
export function measureText(text: string, font?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string | number;
}): number;
/**
 * Break a string into lines that fit `maxWidth`: greedy word wrap, honouring typed
 * newlines, hard-breaking a word too long for the box. With no `maxWidth` it only
 * splits on newlines.
 *
 * @param {string} text
 * @param {{ maxWidth?: number, fontSize?: number, fontFamily?: string, fontWeight?: string | number }} [opts]
 * @returns {string[]} at least one line (possibly empty), never null
 */
export function wrapText(text: string, opts?: {
    maxWidth?: number;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string | number;
}): string[];
/**
 * The box a padded note of text occupies: `measureBlock` plus padding and minimums.
 * This is `sticker`'s sizing rule, shared so a link can dock to a note's edge
 * without reading another mark's geometry:
 *
 *   link({ channels: { nodeWidth: { fn: d => noteBox(d.label).width } } })
 *
 * Defaults match `sticker`'s; change both together.
 *
 * @param {string} text
 * @param {{ padding?: number, maxWidth?: number, minWidth?: number, minHeight?: number,
 *   fontSize?: number, fontFamily?: string, lineHeight?: number }} [opts]
 * @returns {{ block: { lines: string[], width: number, height: number, lineHeight: number }, width: number, height: number }}
 */
export function noteBox(text: string, opts?: {
    padding?: number;
    maxWidth?: number;
    minWidth?: number;
    minHeight?: number;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
}): {
    block: {
        lines: string[];
        width: number;
        height: number;
        lineHeight: number;
    };
    width: number;
    height: number;
};
// ── from src/vocabulary.js ──────────────────────────────────────────────────
/** Options every mark accepts. (`constraints` belongs on the spec, not a mark.)
 *  @type {string[]} */
export const MARK_UNIVERSAL_OPTIONS: string[];
/** Top-level constant shorthands every mark desugars into channels
 *  (`fill: 'red'` -> `channels.fill = { value: 'red' }`). `size` and the text
 *  names are read by the marks themselves; `angle` is a rotation in place.
 *  @type {string[]} */
export const MARK_SHORTHANDS: string[];
/** Options every chart element accepts. `field` and `table` name what its edits write.
 *  @type {string[]} */
export const ELEMENT_UNIVERSAL_OPTIONS: string[];
/** Options every guide accepts. @type {string[]} */
export const GUIDE_UNIVERSAL_OPTIONS: string[];
/** Each mark's options beyond the universal ones and the shorthands. `…X`/`…Y`
 *  variants share their bare mark's entry.
 *  @type {Record<string, string[]>} */
export const MARK_OPTIONS: Record<string, string[]>;
/** Each chart element's options beyond the universal ones.
 *  @type {Record<string, string[]>} */
export const ELEMENT_OPTIONS: Record<string, string[]>;
/** Each guide's options beyond the universal ones.
 *  @type {Record<string, string[]>} */
export const GUIDE_OPTIONS: Record<string, string[]>;
/** The options `makeEdit` reads on every edit. Others come from `EDIT_OPTIONS` or
 *  a driver's `Driver.options`.
 *  @type {string[]} */
export const EDIT_UNIVERSAL_OPTIONS: string[];
/** Each edit's options beyond `EDIT_UNIVERSAL_OPTIONS`, keyed by its dotted `type`.
 *  A type with no entry is not validated.
 *  @type {Record<string, string[]>} */
export const EDIT_OPTIONS: Record<string, string[]>;
/** Constraints: the options each reads. `field` is one name or an ordered list,
 *  and omitting it means "the column the dispatching edit writes".
 *  @type {Record<string, string[]>} */
export const CONSTRAINT_OPTIONS: Record<string, string[]>;
// ── from src/plot/axis.js ───────────────────────────────────────────────────
/**
 * `axis`'s option list, on top of the universal chart-element options
 * (id / edit / edits / field). Keep in sync with the destructure in `axis`.
 * @type {string[]}
 */
export const AXIS_OPTIONS: string[];
/**
 * `grid`'s option list. Keep in sync with the destructure in `grid`.
 * @type {string[]}
 */
export const GRID_OPTIONS: string[];
// ── from src/plot/legend.js ─────────────────────────────────────────────────
/**
 * `legend`'s option list, on top of the universal chart-element options
 * (id / edit / edits / field). Keep in sync with the destructure in `legend`.
 * @type {string[]}
 */
export const LEGEND_OPTIONS: string[];
// ── from src/plot/axisRadial.js ─────────────────────────────────────────────
/** @type {string[]} */
export const AXIS_RADIAL_OPTIONS: string[];
// ── from src/edit/shared.js ─────────────────────────────────────────────────
/**
 * Strip a `pick` an edit bound to one driver cannot honour, and warn.
 * Used by edits that read a zone lock only their driver writes
 * (`brushSpan`, `brushRect`, `geo.brush`).
 * @param {any} options
 * @param {string} type the edit's type, for the message
 * @param {string} pick the driver it is bound to
 * @returns {any} the options without `pick`
 */
export function claimPick(options: any, type: string, pick: string): any;
/**
 * Normalize an edit spec into the canonical Edit descriptor the engine routes to.
 *
 * Unknown keys pass through onto the descriptor, which is how a driver reads its
 * per-edit options (`edgeInset`, `resize`, …). Canonical keys always win over a
 * raw spread value.
 * @param {any} spec
 * @returns {import('../types.js').Edit}
 */
export function makeEdit(spec: any): import("../types.js").Edit;
/**
 * Restrict an edit to one tagged handle of a multi-handle feature (an area's
 * y1/y2 edges), by wrapping its `when` to match the node's `channel` tag.
 * An untagged or absent node passes, so plane/probe picks still fire.
 * @param {any} edit
 * @param {string} name the `channel` tag this edit owns
 * @returns {any}
 */
export function claimEdge(edit: any, name: string): any;
/**
 * A series key not already in the data, for a new line.
 *
 * With a declared domain, the first unused category (`nextCategory`, honouring
 * `open`); a closed, exhausted domain returns undefined and warns. Without one,
 * the smallest unused non-negative integer.
 * @param {any[]} data
 * @param {string | null} seriesField
 * @param {Record<string, any> | null} [schema] the table's field schema
 * @returns {any} the key, or undefined when a closed domain is exhausted
 */
export function nextSeriesKey(data: any[], seriesField: string | null, schema?: Record<string, any> | null): any;
/**
 * A category for a row an edit is minting: the first declared category no row uses.
 * When they run out:
 *   closed (default) — return undefined so the caller refuses.
 *   open — mint a placeholder name that collides with nothing, to rename later.
 *
 * @param {any[]} data
 * @param {string | null | undefined} field
 * @param {any[]} domain the field's declared/resolved domain
 * @param {{ open?: boolean, label?: string | ((n: number) => string) }} [options]
 *   `label` is the placeholder stem, or a function of the placeholder's number
 * @returns {any} the category, or undefined when a closed domain is exhausted
 */
export function nextCategory(data: any[], field: string | null | undefined, domain: any[], { open, label }?: {
    open?: boolean;
    label?: string | ((n: number) => string);
}): any;
/**
 * Mint one new datum, the core every creator builds on. Layers, later wins:
 *   1. `schemaDefaults(ctx.schema)` — every declared field at its default.
 *   2. `defaults` — the creator's non-positional seed and any extent a rect needs.
 *   3. `seed` — values already resolved (geo lon/lat, a series key). Counts as placed.
 *   4. the inverted pointer, per positional channel.
 *   5. the identity key, when the table declares one (`nextCategory` placeholder).
 * Returns undefined when nothing could be placed, or when a closed key vocabulary
 * is exhausted.
 * @param {import('../types.js').EditContext} ctx
 * @param {{ defaults?: Record<string, any>, seed?: Record<string, any>, label?: string }} [opts]
 * @returns {Record<string, any> | undefined}
 */
export function mintDatum(ctx: import("../types.js").EditContext, { defaults, seed, label }?: {
    defaults?: Record<string, any>;
    seed?: Record<string, any>;
    label?: string;
}): Record<string, any> | undefined;
/**
 * The scene node an edit is acting on: `ctx.node` for a direct pick, else the
 * mark in `ctx.marks` at `ctx.index` (a plane pick carries no node).
 * @param {import('../types.js').EditContext} ctx
 * @returns {any | null}
 */
export function resolveMarkNode(ctx: import("../types.js").EditContext): any | null;
/**
 * Centre of a scene node: circles / needles carry cx/cy; rects carry
 * x/y/width/height; paths may stamp cx/cy for angular edits about a pivot; a text
 * mark carries a bare x/y anchor.
 * @param {any} node
 * @returns {{ cx: number, cy: number } | null}
 */
export function markCenter(node: any): {
    cx: number;
    cy: number;
} | null;
/**
 * The pixel one keyboard step along `scale` moves the pointer to, so an arrow key
 * drives the same edit a drag does. On a discrete axis a step is the next
 * category; on a continuous one it is a fraction of the range.
 * @param {any} scale the axis scale (may be null / non-invertible)
 * @param {number} at current pixel position on that axis
 * @param {-1 | 0 | 1} dir step direction in pixel space
 * @param {boolean} [coarse] a bigger step (Shift)
 * @returns {number} the new pixel position (unchanged when it can't step)
 */
export function nudgeTarget(scale: any, at: number, dir: -1 | 0 | 1, coarse?: boolean): number;
/**
 * Map a pixel on a track [pxAt0 → pxAt1] linearly to a value in [loVal → hiVal],
 * clamped to the track. Used by `slide`. Domain-linear on purpose: the track is a
 * UI segment, not the scale's pixel range.
 * @param {number} px current pixel position on the track
 * @param {number} pxAt0 the pixel where the value is `loVal`
 * @param {number} pxAt1 the pixel where the value is `hiVal`
 * @param {number} loVal domain value at `pxAt0`
 * @param {number} hiVal domain value at `pxAt1`
 * @returns {number | undefined} the value, or undefined for a zero-length track
 */
export function linearInvert(px: number, pxAt0: number, pxAt1: number, loVal: number, hiVal: number): number | undefined;
/**
 * The domain extremes [lo, hi] of a resolved channel, from its scale's
 * `domainConfig`. Falls back to [0, 1].
 * @param {import('../types.js').ResolvedChannel | { scale?: any } | null | undefined} ch
 * @returns {[number, number]}
 */
export function channelDomain(ch: import("../types.js").ResolvedChannel | {
    scale?: any;
} | null | undefined): [number, number];
/**
 * The discrete values a channel steps through (what `cycle` advances along): the
 * scale's domain, else the field's schema domain. Channels with `scale: null` or
 * raw channels have no scale, so the schema fallback is the normal path for them.
 * @param {import('../types.js').ResolvedChannel | null | undefined} ch
 * @param {Record<string, any> | undefined} [schema] the target table's field map
 * @returns {any[] | null}
 */
export function discreteDomain(ch: import("../types.js").ResolvedChannel | null | undefined, schema?: Record<string, any> | undefined): any[] | null;
/**
 * Invert the pointer through one channel's scale. Pass `center` for radial
 * channels (`size`, `angle`) that need a pivot.
 * @param {import('../types.js').ResolvedChannel} ch
 * @param {{ x: number, y: number }} pointer
 * @param {{ cx: number, cy: number } | null} [center]
 * @returns {any}
 */
export function invertChannel(ch: import("../types.js").ResolvedChannel, pointer: {
    x: number;
    y: number;
}, center?: {
    cx: number;
    cy: number;
} | null): any;
/**
 * Recenter a mark's pixel span on the pointer and invert both endpoints to data.
 * Used by `moveSpan` and the body zone of `brushSpan` / `brushRect`.
 *
 * The span width comes from the datum (the node is the fallback) and stays rigid
 * at the range edges; a span wider than the range pins to it. Returns a ≤ b.
 * @param {any} node the mark's current scene node (rect: x/y/width/height)
 * @param {import('../types.js').ResolvedChannel} chA
 * @param {import('../types.js').ResolvedChannel} chB
 * @param {{ x: number, y: number }} pointer
 * @param {any} [datum] the row, for the span's data-space width
 * @returns {{ a: any, b: any } | undefined}
 */
export function recenterSpan(node: any, chA: import("../types.js").ResolvedChannel, chB: import("../types.js").ResolvedChannel, pointer: {
    x: number;
    y: number;
}, datum?: any): {
    a: any;
    b: any;
} | undefined;
export function andWhen(guard: (ctx: any) => boolean, userWhen: ((ctx: any) => boolean) | null | undefined): (ctx: any) => boolean;
// ── from src/core/schema.js ─────────────────────────────────────────────────
/**
 * The starting values a minted datum gets from the dataset schema: every declared
 * field, set to its explicit `default` when given, else `null` (present but unset,
 * to be set later by an edit). Returns {} when no schema is declared.
 * @param {Record<string, import('../types.js').FieldSchema> | undefined} schema
 * @returns {Record<string, any>}
 */
export function schemaDefaults(schema: Record<string, import("../types.js").FieldSchema> | undefined): Record<string, any>;
// ── from src/edit/pick.js ───────────────────────────────────────────────────
/**
 * Distance from pointer to a mark, per mark type:
 *   circle -> euclidean distance to the centre.
 *   ellipse -> distance to the centre.
 *   rect   -> distance to the bar's band interval along `bandAxis`, so any point
 *             in the column selects the bar.
 *   line   -> point-to-segment distance.
 *   path   -> 0 inside a filled polygon, else distance to the polyline.
 * @param {any} mark
 * @param {number} px
 * @param {number} py
 * @returns {number}
 */
export function distanceToMark(mark: any, px: number, py: number): number;
/**
 * The datum index of the nearest mark within `threshold`, or null. `series`
 * restricts the search to one line's handles.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {any} [series] restrict to marks with this `series` key
 * @returns {number | null}
 */
export function nearestMark(marks: any[], px: number, py: number, threshold: number, series?: any): number | null;
/**
 * The `series` key of the line closest to the pointer within `threshold`, or null.
 * Measured to the line's path, falling back to handle centres for a one-point series.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {{ includeLocked?: boolean }} [options] `includeLocked`: also consider
 *   locked lines (for append-only edits like anchor).
 * @returns {any | null}
 */
export function nearestSeries(marks: any[], px: number, py: number, threshold: number, options?: {
    includeLocked?: boolean;
}): any | null;
/**
 * The datum index of the nearest mark measured along one axis only (the sweep
 * target). Any datum-bearing node with a `markCenter` is eligible.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {'x' | 'y'} axis
 * @param {any} [series] restrict to marks with this `series` key (series-locked sweep)
 * @param {(mark: any) => boolean} [accept] a further filter (e.g. one edge's handles)
 * @returns {number | null}
 */
export function nearestMarkOnAxis(marks: any[], px: number, py: number, threshold: number, axis: "x" | "y", series?: any, accept?: (mark: any) => boolean): number | null;
/**
 * The topmost editable mark containing the pointer, or null. The geometric
 * hit test for renderers without DOM hit-testing (canvas). Walks the scene
 * back to front, and skips nodes that are not `editable` (or `hoverable` on
 * hover), locked, guides, backgrounds, or `pointerEvents: 'none'`.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {boolean} [hover] also accept a `hoverable` node (what a hover reports, not what a press grabs)
 * @returns {any | null} the hit node object (not its index), or null
 */
export function hitTest(marks: any[], px: number, py: number, hover?: boolean): any | null;
/**
 * The snap radius for an edit: its `threshold`, else `fallback` (a driver may
 * pass a tighter default).
 * @param {import('../types.js').Edit | null | undefined} edit
 * @param {number} [fallback]
 * @returns {number}
 */
export function pickThreshold(edit: import("../types.js").Edit | null | undefined, fallback?: number): number;
/**
 * @param {import('../types.js').Edit} edit
 * @returns {number}
 */
export function edgeInsetOf(edit: import("../types.js").Edit): number;
export const DEFAULT_PICK_THRESHOLD: 40;
// ── from src/edit/drivers/index.js ──────────────────────────────────────────
export type DriverSession = {
    get: () => any;
    set: (patch: any) => void;
    clear: () => void;
};
export type DriverPreview = {
    /**
     * the parked proposal:
     * the rows it would commit and the table they replace (which may not be the mark's).
     */
    get: () => {
        table: string;
        rows: any[];
    } | null;
    clear: () => boolean;
};
export type DriverStage = {
    get: () => number;
    set: (n: number) => void;
    next: () => void;
};
export type DriverContext = {
    feature: any;
    event: any;
    edits: import("../types.js").Edit[];
    marks: any[];
    data: any[];
    scales: import("../types.js").ScaleMap;
    /**
     * the datum a direct gesture landed on, or null
     * for a plane gesture, where the driver resolves its own target.
     */
    index: number | null;
    session: DriverSession;
    preview: DriverPreview;
    stage: DriverStage;
    runEdit: (edit: import("../types.js").Edit, index: number | null, at?: {
        x: number;
        y: number;
    }) => boolean;
    previewEdit: (edit: import("../types.js").Edit, index: number | null) => boolean;
    reachable?: ((edit: import("../types.js").Edit, index: number | null, node?: any) => string[] | null) | undefined;
};
export type Driver = {
    name: string;
    /**
     * a capability
     * claim on an edit not addressed by pick name (never re-test `pick`)
     */
    wants?: ((edit: import("../types.js").Edit) => boolean) | undefined;
    /**
     * the session keys this driver owns; its
     * `session.clear()` nulls exactly these
     */
    sessionKeys?: string[] | undefined;
    /**
     * the per-edit knobs this driver reads off the
     * descriptor (`edgeInset`, `resize`, …); unknown-option warnings skip them
     */
    options?: string[] | undefined;
    onEvent: (ctx: DriverContext) => boolean;
    /**
     * writes a selection into its session, so its
     * edits get a catchment guide
     */
    selects?: boolean | undefined;
    /**
     * only chooses the row, so
     * `el.control(name, index)` can run its edits on a named row directly
     */
    targetsRow?: boolean | undefined;
};
/**
 * Register a custom driver, or replace a built-in with the same `name`.
 * @param {Driver} driver
 */
export function registerDriver(driver: Driver): void;
// ── from src/constraints/define.js ──────────────────────────────────────────
/**
 * Author a constraint from a rule over the data-only context (`constraints.custom`).
 * The rule returns a value, an object, replacement rows, or `false` to reject;
 * the active datum, field, domain and result handling are done for you.
 * @param {(ctx: import('../types.js').ConstraintContext) => any} reducer
 * @param {{ type?: string, field?: string | string[], options?: Record<string, any>,
 *   table?: string, guide?: (ctx: any) => any[] }} [meta]
 * @returns {import('../types.js').ConstraintSpec}
 */
export function defineConstraint(reducer: (ctx: import("../types.js").ConstraintContext) => any, meta?: {
    type?: string;
    field?: string | string[];
    options?: Record<string, any>;
    table?: string;
    guide?: (ctx: any) => any[];
}): import("../types.js").ConstraintSpec;
// ── from src/widgets/theme.js ───────────────────────────────────────────────
export namespace THEME {
    let accent: string;
    let ring: string;
    let track: string;
    let cellFill: string;
    let cellStroke: string;
    let label: string;
    let question: string;
    let labelSize: number;
    let questionSize: number;
    let radius: number;
}
// ── from src/widgets/shared.js ──────────────────────────────────────────────
/**
 * Resolve a widget's theme for its answer mark's ink and size: DEFAULT_THEME, then
 * the setTheme() base, then the widget's `theme` option, the same precedence the
 * engine applies to `spec.theme`.
 * @param {import('../types.js').ThemeSpec | undefined} [theme]
 * @returns {import('../types.js').Theme}
 */
export function widgetTheme(theme?: import("../types.js").ThemeSpec | undefined): import("../types.js").Theme;
// ── from src/core/projection.js ─────────────────────────────────────────────
export type ProjectionContext = {
    apply: (p: [number, number]) => [number, number] | null;
    invert: (p: [number, number]) => [number, number] | null;
    path: (object?: any) => string | null;
    invertible: boolean;
    raw: any;
};
export type ProjectionOptions = {
    type?: string | Function;
    domain?: any;
    rotate?: [number, number] | [number, number, number];
    parallels?: [number, number];
    precision?: number;
    clipAngle?: number;
    inset?: number;
    insetTop?: number;
    insetRight?: number;
    insetBottom?: number;
    insetLeft?: number;
    [k: string]: any;
};
/**
 * Build the chart's projection context from `spec.projection` and the plot frame.
 * Returns null when no projection is configured.
 *
 * @param {string | ProjectionOptions | any | null | undefined} projectionOpt
 * @param {{ width: number, height: number }} dims inner plot size (margins already subtracted)
 * @returns {ProjectionContext | null}
 */
export function createProjection(projectionOpt: string | ProjectionOptions | any | null | undefined, dims: {
    width: number;
    height: number;
}): ProjectionContext | null;
/**
 * Project a lon/lat pair through the chart projection. Returns null if missing.
 * @param {ProjectionContext | null | undefined} projection
 * @param {number} lon
 * @param {number} lat
 * @returns {{ x: number, y: number } | null}
 */
export function projectPoint(projection: ProjectionContext | null | undefined, lon: number, lat: number): {
    x: number;
    y: number;
} | null;
/**
 * Invert a plot-pixel pointer to lon/lat. Returns null outside the projection.
 * @param {ProjectionContext | null | undefined} projection
 * @param {{ x: number, y: number }} pointer
 * @returns {{ lon: number, lat: number } | null}
 */
export function invertPoint(projection: ProjectionContext | null | undefined, pointer: {
    x: number;
    y: number;
}): {
    lon: number;
    lat: number;
} | null;
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
export function projectBounds(projection: ProjectionContext | null | undefined, west: number, south: number, east: number, north: number): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null;
// ── from src/core/tiles.js ──────────────────────────────────────────────────
export type Tile = {
    z: number;
    x: number;
    y: number;
    px: number;
    py: number;
    size: number;
    key: string;
};
/**
 * Does this projection place lon/lat the way the tile pyramid does? Checked by
 * behaviour: probe points must land where the Web Mercator formula puts them:
 *
 *   x = ox + worldPx · (lon + 180) / 360
 *   y = oy + worldPx · (0.5 − ln(tan(π/4 + φ/2)) / 2π)
 *
 * The latitude probes reject equirectangular, which agrees on the equator. A pure
 * longitude rotation passes: tiles and data pan together.
 *
 * @param {ProjectionContext | null | undefined} projection
 * @returns {boolean}
 */
export function isWebMercator(projection: ProjectionContext | null | undefined): boolean;
/**
 * @typedef {{ z: number, x: number, y: number, px: number, py: number, size: number, key: string }} Tile
 */
/**
 * The tiles covering the plot frame, with their pixel placement.
 * Returns null when the projection can't carry tiles.
 *
 * @param {ProjectionContext | null | undefined} projection
 * @param {number} width @param {number} height  inner plot size
 * @param {{ tileSize?: number, minZoom?: number, maxZoom?: number, zoomOffset?: number }} [opts]
 * @returns {{ z: number, size: number, tiles: Tile[] } | null}
 */
export function tileCover(projection: ProjectionContext | null | undefined, width: number, height: number, opts?: {
    tileSize?: number;
    minZoom?: number;
    maxZoom?: number;
    zoomOffset?: number;
}): {
    z: number;
    size: number;
    tiles: Tile[];
} | null;
/**
 * Resolve a tile URL from a template (`{z}/{x}/{y}`, with an optional `{s}`
 * subdomain) or a function. Subdomains are rotated by tile coords so a row of
 * tiles spreads across the server's hosts, as Leaflet does.
 *
 * @param {string | ((t: Tile) => string)} url
 * @param {Tile} tile
 * @param {string[]} subdomains
 * @returns {string}
 */
export function tileUrl(url: string | ((t: Tile) => string), tile: Tile, subdomains?: string[]): string;
// ── from src/core/theme.js ──────────────────────────────────────────────────
/**
 * The theme a mark's build() sees, stamped on the scale map by the engine.
 * DEFAULT_THEME for a bare scale map (a mark tested in isolation).
 * @param {any} scales
 * @returns {import('../types.js').Theme}
 */
export function themeOf(scales: any): import("../types.js").Theme;
/**
 * A mark's default style object: its own built-in fallbacks, with any
 * `theme.marks[name]` overrides layered on top. The result is what the mark hands
 * to resolveStyle as `defaults`, so a per-datum channel still wins over both.
 * @param {any} scales
 * @param {string} name mark name, e.g. 'bar'
 * @param {Record<string, any>} fallbacks the mark's built-in defaults (may read theme tokens)
 * @returns {Record<string, any>}
 */
export function markDefaults(scales: any, name: string, fallbacks: Record<string, any>): Record<string, any>;
// ── from src/core/dev.js ────────────────────────────────────────────────────
/**
 * Warn once per `key`. The `[elicit]` prefix is added here — call sites pass the
 * message only.
 * @param {string} key dedup key; include the mark/feature so two bad marks both report
 * @param {string} message
 * @returns {void}
 */
export function warn(key: string, message: string): void;
