// @ts-check
// mark.js: the shared foundation every mark builds on. `encodeChannel` maps a datum
// through the engine's global per-channel scales, and `resolveStyle` resolves the
// standard style channels, so every mark encodes and styles the same way.
//
// A channel is one of:
//   { field }              a data field, through the channel's scale
//   { value }              a visual-space constant; skips the scale
//   { datum }              a data-space constant; goes through the scale, so
//                          `y: { datum: 25 }` lands at y=25, not at 25px
//   { field, scale: null } a raw field, unscaled (the datum holds a literal)
//   { fn }                 derived: fn(d, i, data) in visual space, never scaled
// `{ fn }` is read-only (it can't carry an `edit`). A top-level function shorthand
// (`fill: d => …`) desugars to `{ fn }`; `{ value: someFn }` is a constant, never called.
//
// A mark never owns data or a domain: the engine hands the rows to build(), and
// the domain lives on the spec's schema. The contract is the `Mark` interface in
// types.d.ts and MARK_CONTRACTS.md.
//
// pointerEvents: the engine sets 'none' on every node of a mark with no
// direct-pick edit, unless the node set its own. Don't set it on a whole mark to
// make it inert. Do set it per node on chrome (a line's path, a trend's fitted
// line) when the same feature also draws handles, or the chrome, painted last,
// eats the handles' drags.

/**
 * The standard style channels and their defaults. `undefined` leaves the
 * attribute to the renderer's default.
 * @type {Record<string, any>}
 */
const STYLE_DEFAULTS = {
    fill: undefined,
    stroke: undefined,
    strokeWidth: undefined,
    // A constant ('4 2') or a field through an ordinal scale onto a dash
    // vocabulary (core/encoding.js DEFAULT_DASHES). Painted as `strokeDasharray`.
    strokeDash: undefined,
    opacity: undefined,
    fillOpacity: undefined,
    strokeOpacity: undefined
};

// The channels resolveStyle sweeps onto every scene node.
/** @type {string[]} */
export const STANDARD_STYLE_CHANNELS = Object.keys(STYLE_DEFAULTS);

// The scene field a style channel paints to, where the names differ
// (renderers/shared.js STYLE_FIELDS).
/** @type {Record<string, string>} */
const SCENE_FIELD = { strokeDash: 'strokeDasharray' };

// Theme helpers, re-exported so a mark imports its style vocabulary from one
// module. See core/theme.js.
export { themeOf, markDefaults } from '../core/theme.js';
import { themeOf } from '../core/theme.js';

// `warn` dedups by key, so a derived fn that re-runs every render warns once.
import { warn, warningsEnabled } from '../core/dev.js';

// A channel's scale is looked up through `scaleFor` (keyed by channel and field).
import { scaleFor, slotOf, slotWidthOf, bandStartOf, bandwidthOf, offsetScaleOf } from '../core/scales.js';
import { MARK_UNIVERSAL_OPTIONS, MARK_SHORTHANDS, ELEMENT_UNIVERSAL_OPTIONS } from '../vocabulary.js';
import { frameSpecOf } from '../core/encoding.js';

/**
 * Evaluate a derived channel's `fn(d, i, data)` in visual space. A null datum, a
 * null/NaN result or a throw returns the fallback.
 * @param {any} spec the channel spec (must have a function `fn`)
 * @param {string} channel channel name, for the warning key
 * @param {import('../types').Datum | null} datum
 * @param {number | undefined} index
 * @param {import('../types').Datum[] | undefined} data
 * @param {any} fallback
 * @returns {any}
 */
function callChannelFn(spec, channel, datum, index, data, fallback) {
    if (datum == null) return fallback;
    try {
        const out = spec.fn(datum, index, data);
        // A NaN is a missing value, not a coordinate: treat it like null.
        return out == null || (typeof out === 'number' && Number.isNaN(out)) ? fallback : out;
    } catch (err) {
        warn(`fn:${channel}`, `fn on channel "${channel}" threw: ` +
            `${err instanceof Error ? err.message : err}; using the fallback.`);
        return fallback;
    }
}

/**
 * Map a datum through one channel's global scale. Handles `{ fn }`, `{ value }`,
 * `{ datum }`, `{ field }` and `{ field, scale: null }`, and falls back when the
 * scale or value is missing. A function `value` is a constant, never called.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {import('../types').Datum | null} datum a null datum resolves constants only
 * @param {any} [fallback]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any}
 */
export function encodeChannel(scales, channels, channel, datum, fallback, index, data) {
    if (channel !== 'x' && channel !== 'y') return encodeOwn(scales, channels, channel, datum, fallback, index, data);
    // A nested offset (`xOffset` on x) moves the position to the sub-band's
    // centre. Only on bare x/y: x1/x2 are span ends. NO_POSITION, not the
    // fallback, means "no position": a real band centre can equal the fallback.
    const at = encodeOwn(scales, channels, channel, datum, NO_POSITION, index, data);
    if (at === NO_POSITION) return fallback;
    // Only a data-space position nests: `{ fn }` and `{ value }` are already pixels.
    const own = channels[channel];
    const dataSpace = own && own.scale !== null && (own.field != null || own.datum !== undefined);
    if (dataSpace && datum && typeof at === 'number') {
        const offset = offsetScaleOf(scales, channels, channel);
        if (offset) {
            const local = offsetPixel(offset, channels, channel === 'x' ? 'xOffset' : 'yOffset', datum, index, data);
            if (local !== undefined) return at - /** @type {number} */ (slotWidthOf(scales[channel])) / 2 + local;
        }
    }
    return at;
}

/** What `encodeOwn` hands back for "this row has no position here". */
const NO_POSITION = Symbol('no position');

/**
 * A datum's position inside its parent slot, in slot-local pixels. Undefined
 * when the row has no offset value.
 * @param {any} offset the nested scale
 * @param {Record<string, any>} channels
 * @param {'xOffset' | 'yOffset'} name
 * @param {any} datum
 * @param {number} [index]
 * @param {any[]} [data]
 * @returns {number | undefined}
 */
function offsetPixel(offset, channels, name, datum, index, data) {
    const v = categoryOf(channels, name, datum, undefined, index, data);
    if (v === undefined || v === null) return undefined;
    const p = offset.encode(v);
    return typeof p === 'number' && Number.isFinite(p) ? p : undefined;
}

/**
 * The interval a datum occupies on a category axis: its category's band, or the
 * sub-band its `xOffset`/`yOffset` category picks inside it. A continuous offset
 * (a jitter) shifts the whole band to centre on its encoded position.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {'x' | 'y'} axis the category axis
 * @param {import('../types').Datum} datum
 * @param {string | undefined} key the mark's xKey/yKey fallback
 * @param {number} [index]
 * @param {import('../types').Datum[]} [data]
 * @param {number} [fallbackWidth] thickness with no band (bandwidthOf's fallback)
 * @returns {{ start: number, width: number }}
 */
export function categorySlot(scales, channels, axis, datum, key, index, data, fallbackWidth = 20) {
    const scale = scales[axis];
    const category = categoryOf(channels, axis, datum, key, index, data);
    const start = bandStartOf(scale, category, 0);
    const width = bandwidthOf(scale, fallbackWidth);
    const offset = offsetScaleOf(scales, channels, axis);
    if (!offset) return { start, width };
    const slot = slotOf(scale, category);
    if (!slot) return { start, width };
    const name = axis === 'x' ? 'xOffset' : 'yOffset';
    if (offset.kind === 'band') {
        const sub = categoryOf(channels, name, datum, undefined, index, data);
        const at = sub == null ? null : offset(sub);
        if (at == null || Number.isNaN(at)) return { start, width };
        return { start: slot.start + at, width: offset.bandwidth() };
    }
    const local = offsetPixel(offset, channels, name, datum, index, data);
    return local === undefined ? { start, width } : { start: slot.start + local - width / 2, width };
}

/**
 * The datum -> scaled value path for one channel, before any nested offset.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {import('../types').Datum | null} datum
 * @param {any} [fallback]
 * @param {number} [index]
 * @param {import('../types').Datum[]} [data]
 * @returns {any}
 */
function encodeOwn(scales, channels, channel, datum, fallback, index, data) {
    const spec = channels[channel];
    if (!spec) return fallback;
    // `expr` is reserved for the JSON spec layer; warn rather than ignore it.
    if (spec.expr !== undefined) {
        warn(
            `expr:${channel}`,
            `channel "${channel}" uses { expr: … }, which is RESERVED for the planned JSON ` +
            `spec layer and is not implemented in 0.1. In JavaScript, write the derived ` +
            `form instead: { fn: (d, i, data) => … }.`,
        );
    }
    if (spec.field === undefined) {
        // Derived channel, used as-is. Wins over value/datum.
        if (typeof spec.fn === 'function') {
            const out = callChannelFn(spec, channel, datum, index, data, NO_POSITION);
            if (out === NO_POSITION) return fallback;
            // `{ fn, frame: true }` is in a glyph box's local units, so it goes
            // through the part's frame scale like a `{ frame }` constant.
            if (frameSpecOf(spec)) {
                const scale = scales[channel];
                return scale ? scale.encode(out, fallback) : fallback;
            }
            return out;
        }
        // Visual-space constant: the value is the output.
        if (spec.value !== undefined) return spec.value;
        // Data-space constant: goes through the scale like a field value. On an
        // unscaled channel (`scale: null`) the literal is used as-is.
        if (spec.datum !== undefined) {
            if (spec.scale === null) return spec.datum;
            const scale = scales[channel];
            return scale ? scale.encode(spec.datum, fallback) : fallback;
        }
        return fallback;
    }
    const raw = datum ? datum[spec.field] : undefined;
    // A datum may lack the field (e.g. a freshly created row); fall back, not NaN.
    if (raw === undefined || raw === null) return fallback;
    // Unscaled field: the datum already holds a literal (a CSS colour, a pixel).
    if (spec.scale === null) return raw;
    // The one scale lookup for every mark channel; resolveStyle and resolveSymbol delegate here.
    const scale = scaleFor(scales, channel, spec.field);
    if (!scale) return fallback;
    return scale.encode(raw, fallback);
}

/**
 * The default handle radius. A mark's `handles` option is one of:
 *   true    drawn and grabbable (the default)
 *   false   neither drawn nor grabbable
 *   'hit'   invisible but grabbable, where the shape itself is the affordance
 * @type {{ size: number }}
 */
export const HANDLE_DEFAULTS = { size: 5 };

/**
 * A paint value usable as a colour, or null for `none` / `transparent` / unset —
 * so a handle that takes its series' colour never copies an invisible one.
 * @param {any} v @returns {string | null}
 */
export function inkOf(v) {
    if (v == null || v === '' || v === 'none' || v === 'transparent') return null;
    return String(v);
}

/**
 * Is this datum's value for a field channel missing (null, undefined or NaN)? Such
 * a row has no position on that axis. A constant, `{ fn }` or absent channel is
 * never missing.
 * @param {Record<string, any>} channels @param {string} name @param {any} datum
 * @returns {boolean}
 */
export function missingValue(channels, name, datum) {
    const spec = channels && channels[name];
    if (!spec || spec.field == null || !datum) return false;
    const v = datum[spec.field];
    return v == null || (typeof v === 'number' && Number.isNaN(v));
}

/**
 * Does a mark's options carry any edit, on a channel or in `edits`? Marks use it
 * to draw no handles when nothing can grab them.
 * @param {any} opts normalized mark options
 * @returns {boolean}
 */
export function hasAnyEdit(opts) {
    if (!opts) return false;
    if (Array.isArray(opts.edits) && opts.edits.length) return true;
    const channels = opts.channels || {};
    return Object.values(channels).some((c) => !!(c && typeof c === 'object' && c.edit));
}

/**
 * Are a mark's handles an affordance, so they are stamped `rowHandle` and dropped
 * where no live edit reaches the row? Yes with an edit or with `handles` left at its
 * default. An explicit `handles: true` with no edit draws the dots as ink.
 * @param {any} handlesOpt the mark's `handles` option as the author wrote it
 * @param {{ edits?: any, channels?: Record<string, any> }} opts the edits and channels to read
 * @returns {boolean}
 */
export function handlesAreAffordance(handlesOpt, opts) {
    return handlesOpt === undefined || hasAnyEdit(opts);
}

/**
 * Resolve a mark's handle options into the paint every handle node needs.
 * @param {import('../types').ScaleMap} scales the scale map (carries the theme)
 * @param {{ handles?: boolean | string, handleSize?: number, handleColor?: string }} options
 * @param {{ fill?: string, stroke?: string }} [fallback] the mark's own ink, when it has one
 * @returns {{ visible: boolean, grabbable: boolean, size: number, fill: string, stroke: string, strokeWidth: number }}
 */
export function resolveHandles(scales, options, fallback = {}) {
    const { handles = true, handleSize, handleColor } = options || {};
    const theme = themeOf(scales);
    const visible = handles !== false && handles !== 'hit';
    const grabbable = handles !== false;
    // 'hit' uses a transparent fill, not opacity 0: some hit-testers (Chromium
    // under Playwright) skip opacity:0 nodes.
    return {
        visible,
        grabbable,
        size: handleSize != null ? handleSize : HANDLE_DEFAULTS.size,
        fill: visible
            ? (handleColor || fallback.fill || theme.handle || theme.accent)
            : (grabbable ? 'transparent' : (handleColor || fallback.fill || theme.handle || theme.accent)),
        stroke: visible ? (fallback.stroke || theme.handleStroke) : 'none',
        strokeWidth: visible ? 1.25 : 0,
    };
}

/**
 * A copy of a channel spec without its `edit`, for the copy that must not be a handle.
 * @param {any} spec
 * @returns {any}
 */
export function withoutEdit(spec) {
    if (!spec) return spec;
    const { edit: _edit, ...rest } = spec;
    return rest;
}

/**
 * A handle node's paint: the row's ink (else the handle fill) when drawn, nothing when `'hit'`.
 * @param {{ visible: boolean, fill: string, stroke: string, strokeWidth: number }} handleStyle from `resolveHandles`
 * @param {string | null} [rowInk] the row's own colour, when the handle takes it
 * @returns {{ fill: string, stroke: string, strokeWidth: number }}
 */
export function handlePaint(handleStyle, rowInk) {
    return {
        fill: handleStyle.visible ? (rowInk || handleStyle.fill) : 'transparent',
        stroke: handleStyle.visible ? handleStyle.stroke : 'none',
        strokeWidth: handleStyle.visible ? handleStyle.strokeWidth : 0,
    };
}

/**
 * The `xKey`/`yKey` a mark reports to the edit/constraint layer: the field bound to
 * each positional channel, defaulting to the channel name. arc, needle and the geo
 * marks don't use this and say why at their own declaration.
 * @param {Record<string, any> | undefined} channels
 * @returns {{ xKey: string, yKey: string }}
 */
export function positionalKeys(channels) {
    const ch = channels || {};
    return {
        xKey: (ch.x && ch.x.field) || 'x',
        yKey: (ch.y && ch.y.field) || 'y',
    };
}

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
 * @param {import('../types').ScaleMap | null | undefined} scales
 * @param {{ orientation?: string, extent?: 'value' | 'span', single?: 'value' | 'other' }} [opts]
 * @returns {'x' | 'y'}
 */
export function resolveValueAxis(channels, scales, { orientation, extent = 'value', single = 'value' } = {}) {
    if (orientation === 'horizontal') return 'x';
    if (orientation === 'vertical') return 'y';
    const ch = channels || {};
    /** @param {'x' | 'y'} a @returns {'x' | 'y'} */
    const other = (a) => (a === 'x' ? 'y' : 'x');
    const xPair = !!(ch.x1 || ch.x2), yPair = !!(ch.y1 || ch.y2);
    if (xPair !== yPair) {
        const pairAxis = xPair ? 'x' : 'y';
        return extent === 'span' ? other(pairAxis) : pairAxis;
    }
    if (scales) {
        const xBand = isBandScale(scales.x), yBand = isBandScale(scales.y);
        if (xBand && !yBand) return 'y';
        if (yBand && !xBand) return 'x';
    }
    const hasX = !!ch.x, hasY = !!ch.y;
    if (hasX !== hasY) {
        const bound = hasX ? 'x' : 'y';
        return single === 'value' ? bound : other(bound);
    }
    return 'y';
}

/** @param {any} scale */
const isBandScale = (scale) => !!(scale && scale.kind === 'band');

/**
 * The `orientation` word for a value axis (the inverse of `resolveValueAxis`).
 * @param {'x' | 'y'} axis
 * @returns {'horizontal' | 'vertical'}
 */
export const orientationOf = (axis) => (axis === 'x' ? 'horizontal' : 'vertical');

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
 * @param {import('../types').Datum | null} datum
 * @param {string | undefined} key the mark's xKey/yKey fallback
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any} the category key, or undefined when there is nothing to resolve
 */
export function categoryOf(channels, channel, datum, key, index, data) {
    const spec = channels ? channels[channel] : undefined;
    const column = key != null ? key : channel;
    if (key == null && datum && datum[channel] !== undefined) {
        warn(
            `implicitcol:${channel}`,
            `a mark places rows on the "${channel}" category axis but declares no ` +
            `"${channel}" channel, so it is reading the column named "${channel}" implicitly. ` +
            `Declare it — channels: { ${channel}: { field: "${channel}" } } — so the spec says ` +
            `which column the mark draws (and which one an edit would write).`
        );
    }
    const fallback = datum ? datum[column] : undefined;
    if (!spec) return fallback;
    if (spec.field === undefined) {
        if (typeof spec.fn === 'function') {
            return callChannelFn(spec, channel, datum, index, data, fallback);
        }
        if (spec.datum !== undefined) return spec.datum;
        if (spec.value !== undefined) {
            warn(
                `catvalue:${channel}`,
                `channel "${channel}" is a CATEGORY axis on this mark, and { value: … } is a ` +
                `visual-space constant — there is no visual constant for "which band". Use ` +
                `{ datum: … } to pin every row to one category, or { field: "…" } to read it ` +
                `from the data.`
            );
            return fallback;
        }
        return fallback;
    }
    const raw = datum ? datum[spec.field] : undefined;
    return raw === undefined || raw === null ? fallback : raw;
}

/**
 * Encode an arbitrary value, in the field's units, through a channel's scale. For
 * parametric marks that compute points no row holds (trend, trendBand). Honours
 * `scale: null` and a missing scale like `encodeChannel`.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {any} value in the channel field's own units
 * @param {any} [fallback]
 * @returns {any}
 */
export function encodeValue(scales, channels, channel, value, fallback) {
    if (value === undefined || value === null) return fallback;
    const spec = channels[channel];
    if (spec && spec.scale === null) return value;
    const scale = scales[channel];
    if (!scale) return fallback;
    return scale.encode(value, fallback);
}

/**
 * Resolve an angular channel to math degrees (0° = +x, CCW, y-up). Scaled when the
 * channel has a scale, so `rotate()` inverts exactly; otherwise raw degrees.
 * `theta` is a polar position (a needle's bearing, an arc's sweep); `angle` is a
 * rotation in place, with no axis or legend. Marks stamp the result on
 * `FeatureNode.angle`, the rendered rotation.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel 'angle' (rotation) or 'theta' (polar position)
 * @param {import('../types').Datum | null} datum
 * @param {number} [fallback=0]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {number}
 */
export function encodeAngle(scales, channels, channel, datum, fallback = 0, index, data) {
    if (!channels || !channels[channel]) return fallback;
    // scales is an index signature — an angular scale is optional.
    const scale = /** @type {any} */ (scales)[channel];
    if (scale) return encodeChannel(scales, channels, channel, datum, fallback, index, data);
    const spec = channels[channel];
    // Derived angle — fn returns degrees directly (visual space, no scale).
    if (typeof spec.fn === 'function') {
        return +callChannelFn(spec, channel, datum, index, data, fallback);
    }
    if (spec.field != null) {
        const v = datum ? datum[spec.field] : undefined;
        return v == null ? fallback : +v;
    }
    if (spec.value !== undefined) return +spec.value;
    return fallback;
}

/**
 * Resolve a datum's glyph string on the `symbol` channel, or undefined when there
 * is no symbol channel or the category maps to nothing.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types').Datum} datum
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {string | undefined}
 */
export function resolveSymbol(scales, channels, datum, index, data) {
    if (!channels || !channels.symbol) return undefined;
    const glyph = encodeChannel(scales, channels, 'symbol', datum, undefined, index, data);
    return (glyph == null || glyph === '') ? undefined : String(glyph);
}

/**
 * Build a `text` node for a glyph centred at (cx, cy), sized to a circle of radius
 * `size`. `extra` carries the caller's style/data/index/pointer fields.
 * @param {string} glyph
 * @param {number} cx @param {number} cy
 * @param {number} size the radius the mark would have used for a circle, in px
 * @param {Record<string, any>} [extra]
 * @returns {import('../types').FeatureNode}
 */
export function symbolNode(glyph, cx, cy, size, extra = {}) {
    return {
        type: 'text',
        x: cx,
        y: cy,
        text: glyph,
        fontSize: Math.max(1, size * 2),
        textAnchor: 'middle',
        dominantBaseline: 'central',
        ...extra,
    };
}

/**
 * Resolve the standard style channels for one datum into a style object for a
 * scene node. Only declared channels (or non-undefined defaults) are included.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types').Datum} datum
 * @param {Record<string, any>} [defaults] per-mark default fallbacks (e.g. fill)
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {Record<string, any>}
 */
export function resolveStyle(scales, channels, datum, defaults = {}, index, data) {
    /** @type {Record<string, any>} */
    const style = {};
    for (const ch of STANDARD_STYLE_CHANNELS) {
        const fallback = ch in defaults ? defaults[ch] : STYLE_DEFAULTS[ch];
        const value = encodeChannel(scales, channels, ch, datum, fallback, index, data);
        if (value !== undefined) style[SCENE_FIELD[ch] || ch] = value;
    }
    return style;
}

/**
 * The field that groups rows into series (a line, an area, a stack segment): the
 * `series` channel, else the field behind fill, stroke, then strokeDash. `series`
 * is a raw channel (never scaled), so marks list it in `Mark.rawChannels`.
 * @param {Record<string, any>} channels the mark's channel map
 * @returns {string | null}
 */
export function seriesFieldOf(channels = {}) {
    return (channels.series && channels.series.field)
        || (channels.fill && channels.fill.field)
        || (channels.stroke && channels.stroke.field)
        // A line dashed by category is one line per category too.
        || (channels.strokeDash && channels.strokeDash.field)
        || null;
}

/**
 * A series value as a grouping key: a Date groups by its time, so equal but
 * distinct Date objects share one series.
 * @param {any} v
 * @returns {any}
 */
export function seriesKeyOf(v) {
    return v instanceof Date ? v.getTime() : v;
}

/**
 * Order one series' points for its path. An `order` channel wins; otherwise
 * `connect: 'domain'` sorts by the domain axis's pixel position (so an ordinal axis
 * follows its domain order) and 'sequence' keeps data order. Shared by line and area.
 * @template {{ d: any, cx: number | null, cy: number | null }} P
 * @param {P[]} group placed rows, with the domain axis encoded into cx / cy
 * @param {string} connect 'domain' | 'sequence'
 * @param {'x' | 'y'} domainAxis
 * @param {Record<string, any>} channels
 * @returns {P[]}
 */
export function orderSeries(group, connect, domainAxis, channels) {
    const field = orderFieldOf(channels);
    if (field) {
        return [...group].sort((a, b) => {
            const av = a.d[field], bv = b.d[field];
            return av < bv ? -1 : av > bv ? 1 : 0;
        });
    }
    if (connect === 'domain') {
        const key = domainAxis === 'x' ? 'cx' : 'cy';
        return [...group].sort((a, b) => Number(a[key]) - Number(b[key]));
    }
    return group;
}

/**
 * Read an unscaled channel: a field's value, a `{ fn }` result, a `{ value }`
 * constant, else the fallback. The unscaled counterpart of `encodeChannel`.
 * A mark that reads a channel through this must list it in `Mark.rawChannels`, or
 * the resolver builds a scale nothing uses.
 * @param {Record<string, any>} channels
 * @param {string} name
 * @param {any} datum
 * @param {any} fallback
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any}
 */
export function rawChannel(channels, name, datum, fallback, index, data) {
    const spec = channels[name];
    if (!spec) return fallback;
    if (spec.field != null) {
        const v = datum[spec.field];
        return v == null ? fallback : v;
    }
    // Derived channel — fn(d, i, data) computed in visual space (no scale here anyway).
    if (typeof spec.fn === 'function') {
        return callChannelFn(spec, name, datum, index, data, fallback);
    }
    if (spec.value !== undefined) return spec.value;
    // `{ datum }` has no scale to go through here; warn instead of treating it as `{ value }`.
    if (spec.datum !== undefined) {
        warn(
            `rawdatum:${name}`,
            `channel "${name}" on a text mark has no scale — its value IS the output — so ` +
            `{ datum: … } has nothing to go through. Use { value: … } for a constant.`
        );
    }
    return fallback;
}

/**
 * The field a line-family mark sorts its points by: the `order` channel's field, or
 * null (the mark then follows its `connect` mode). `order` is a raw channel, so
 * marks list it in `Mark.rawChannels`.
 * @param {Record<string, any>} channels
 * @returns {string | null}
 */
export function orderFieldOf(channels = {}) {
    return (channels.order && channels.order.field) || null;
}

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
export function markCommon(opts) {
    return {
        id: opts.id,
        // Mark-level edits (joint / arbitrary); channel-level edits live in
        // channels[ch].edit. Both are gathered by the engine via collectEdits.
        edits: opts.edits,
        table: opts.table,
        // A tooltip for this mark's rows: `true`, the columns to show, or a
        // function of the row. The engine desugars it into `guides.tip({ mark })`.
        tip: opts.tip,
        // `false` draws this mark past the clip (an annotation in the margin):
        // the engine stamps its nodes `unclipped`, as it does a chart element's.
        clip: opts.clip,
    };
}

/**
 * Option names that are wrong in a known way (old names and common guesses), each
 * with its correction.
 * @type {Record<string, string>}
 */
const MISTAKEN_OPTIONS = {
    color: 'there is no `color` channel — use `fill` (or `stroke` for a line).',
    data: 'a mark never owns data. Put `data` on the Elicit spec; the engine hands the rows to every mark.',
    onChange: 'put `onChange` on the Elicit spec, not on a mark.',
    domain: "a domain describes the DATA, so it lives on the spec's schema: schema: { field: { domain: [...] } }.",
    range: 'a range belongs to the scale: channels.<name>.scale = { range: [...] }.',
    scale: 'a scale is per channel: channels.<name>.scale, or spec.scales for the whole chart.',
    channel: 'did you mean `channels`? (Axis/grid/legend marks take a singular `channel`; data marks take a `channels` map.)',
    edit: 'attach an edit to a channel — y: { field: "…", edit: move() } — or pass several with `edits: [...]`.',
    r: 'the radius channel is `size` (px), on every mark.',
    handleRadius: "a sub-element's radius is `handleSize`.",
    order: 'order is a CHANNEL — it names the column to sort by: '
        + 'channels: { order: { field: "…" } }. The MODE (sort by the domain axis, or '
        + 'connect in array order) is the `connect` option: connect: "domain" | "sequence".',
    series: 'series is a CHANNEL — it names a column, and `channels` is the only place '
        + 'a mark names one: channels: { series: { field: "…" } }.',
    z: 'the grouping channel is `series`: channels: { series: { field: "…" } }.',
    constraints: 'a constraint is a DATASET invariant — it gates every edit from every '
        + 'mark, whichever one declared it — so writing it inside a mark says something '
        + 'the engine does not mean. Put it on the Elicit spec: constraints: [...].',
    value: 'a constant belongs on a channel: channels.<name> = { value: … } for visual space, { datum: … } for data space.',
    field: 'a field belongs on a channel: channels.<name> = { field: "…" }.',
    ...positionalCorrections(),
};

/**
 * The positional names (`ruleY({ y: 50 })`), each with the same correction:
 * a `{ datum }` or `{ field }` channel, or a guide for a plain reference line.
 * @returns {Record<string, string>}
 */
function positionalCorrections() {
    /** @type {Record<string, string>} */
    const out = {};
    for (const ch of ['x', 'y', 'x1', 'x2', 'y1', 'y2', 'theta', 'radius', 'lon', 'lat']) {
        out[ch] = `positional channels are not top-level shorthands (only style names like ` +
            `fill/stroke/size are). For a constant in the field's own units, write ` +
            `channels: { ${ch}: { datum: … } } — it goes THROUGH the scale, so it lands where ` +
            `that value is. For a column, channels: { ${ch}: { field: "…" } }. And for a plain ` +
            `reference line, a guide is the mark-free way to say it: guides.rule({ ${ch}: … }).`;
    }
    return out;
}

/**
 * Warn about options a mark would silently ignore. `allow` is the mark's own
 * option vocabulary on top of the universal options and style shorthands; a `mark`
 * with no `allow` disables the check, and warns that it did.
 * @param {string | undefined} mark the factory name, for the message
 * @param {any} options the RAW options, before shorthands are stripped
 * @param {string[] | undefined} allow mark-specific option names
 * @returns {void}
 */
export function warnUnknownOptions(mark, options, allow) {
    if (!options || !warningsEnabled()) return;
    const name = mark || 'this mark';
    if (mark && !allow) {
        warn(
            `noallow:${mark}`,
            `${name}() calls normalizeMarkOptions without an \`allow\` list, which turns off ` +
            `its unknown-option diagnostics. Declare the mark's own option vocabulary in ` +
            `MARK_OPTIONS (src/vocabulary.js) and pass it as \`allow\`.`
        );
    }
    const known = allow
        ? new Set([...MARK_UNIVERSAL_OPTIONS, ...MARK_SHORTHANDS, ...allow])
        : null;
    for (const key of Object.keys(options)) {
        const fix = MISTAKEN_OPTIONS[key];
        if (fix) {
            // Some marks really take `channel` or `field`; the allow list wins.
            if (known && known.has(key)) continue;
            warn(`opt:${name}:${key}`, `${name}({ ${key}: … }): ${fix}`);
            continue;
        }
        if (!known || known.has(key)) continue;
        warn(
            `opt:${name}:${key}`,
            `${name}({ ${key}: … }) is not an option this mark reads, so it is ignored. ` +
            `Mark options are: ${[...known].sort().join(', ')}.`
        );
    }
}

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
export function normalizeMarkOptions(options = {}, { except = [], mark, allow } = {}) {
    warnUnknownOptions(mark, options, allow);
    const { channels = {}, ...rest } = options;
    /** @type {Record<string, any>} */
    const merged = { ...channels };
    for (const ch of MARK_SHORTHANDS) {
        if (rest[ch] === undefined || except.includes(ch)) continue;
        // An explicit channel for this name wins over the shorthand.
        if (merged[ch] === undefined) {
            merged[ch] = typeof rest[ch] === 'function' ? { fn: rest[ch] } : { value: rest[ch] };
        }
        delete rest[ch];
    }
    return { ...rest, channels: merged };
}

/**
 * The style names an axis treats as chrome, not per-datum channels. Pass to
 * normalizeMarkOptions's `except`.
 * @type {string[]}
 */
export const AXIS_CHROME = ['stroke', 'strokeWidth', 'fill', 'fontSize'];

/**
 * Validate a chart element's options (`views: 'scale'`). The diagnostics half of
 * normalizeMarkOptions, without the shorthand desugar: an element has no datum,
 * and must not accept the mark style shorthands.
 * @param {string} element the factory name, for the message
 * @param {any} options
 * @param {string[]} allow the element's own option vocabulary
 * @returns {void}
 */
export function warnUnknownElementOptions(element, options, allow) {
    if (!options || !warningsEnabled()) return;
    const known = new Set([...ELEMENT_UNIVERSAL_OPTIONS, ...allow]);
    for (const key of Object.keys(options)) {
        if (known.has(key)) continue;
        const fix = MISTAKEN_OPTIONS[key];
        if (fix) {
            warn(`opt:${element}:${key}`, `${element}({ ${key}: … }): ${fix}`);
            continue;
        }
        warn(
            `opt:${element}:${key}`,
            `${element}({ ${key}: … }) is not an option this chart element reads, so it is ` +
            `ignored. ${element} options are: ${[...known].sort().join(', ')}.`
        );
    }
}

/**
 * A chart element's edit list: `edit` and `edits` flattened into one array, with
 * the element's `channel` injected into any edit that names none, so
 * `resolveChannels` can find the edit's scale (an element has no channel map).
 * @param {any} options the element's raw options (read `edit` and `edits`)
 * @param {string} channel the scale the element draws
 * @returns {import('../types').Edit[]}
 */
export function elementEdits(options, channel) {
    const raw = [options && options.edit, options && options.edits];
    return raw
        .flat(Infinity)
        .filter((e) => e && typeof (/** @type {any} */ (e).apply) === 'function')
        .map((e) => (/** @type {any} */ (e).channels ? e : { .../** @type {any} */ (e), channels: [channel] }));
}
