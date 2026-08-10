// @ts-check
// mark.js — the shared foundation every mark builds on (Observable Plot's mark
// model, adapted for belief elicitation). It gives marks two things uniformly:
//
//   1. Channel resolution — turn a datum into a visual value through the GLOBAL
//      per-channel scale the engine resolved (positional OR style), the same way
//      for every mark. `encodeChannel` is the one place that logic lives.
//   2. A standard STYLE surface — fill, stroke, strokeWidth, opacity,
//      fillOpacity, strokeOpacity — resolved the same way (constant, field, or
//      unscaled) and spread onto the scene node, so any mark is styleable in one
//      line and the renderer applies them uniformly.
//
// Declarative first. A channel is one of:
//   { field }              a data field, through the channel's global scale
//   { value }              a VISUAL-space constant — skips the scale
//   { datum }              a DATA-space constant — goes THROUGH the scale, so
//                          `y: { datum: 25 }` lands where y=25 is, not at 25px
//   { field, scale: null } a raw field, unscaled (the datum holds a literal)
//   { fn }                 a DERIVED channel — fn(d, i, data) is computed per
//                          datum in VISUAL space (its result is used as-is, never
//                          scaled). e.g. fill: d => d.x > 50 ? 'red' : 'blue'.
// The first four stay serializable and introspectable by the edit/elicitation
// layer. `{ fn }` is the one deliberate exception: it is opaque to that layer, so
// it is READ-ONLY — a derived channel can't carry an `edit` (it recomputes from
// the committed rows on every render, so a source-field edit re-derives it for
// free). A top-level function shorthand (`fill: d => …`) desugars to `{ fn }`; an
// explicit `{ value: someFn }` stays an opaque constant, never invoked.
//
// ── The mark contract ───────────────────────────────────────────────────────
// A mark NEVER owns data. `Elicit` owns the chart's one dataset; a mark is a view
// over it that encodes some columns and, where a channel carries an `edit`, writes
// them back. The engine hands the current rows to build() — so there is no `data`
// option and no `onChange` (both live on the Elicit spec). Nor does a mark own a
// DOMAIN: that belongs to the data, and is declared once on the spec's schema.
//
// A mark factory returns a plain feature object the engine consumes. Required:
//   build(currentData, scales, width, height) -> FeatureNode[]
//     the one method — emit scene nodes ({ type: 'circle'|'rect'|'line'|'path'|
//     'text', … }); resolve every position/style through encodeChannel/resolveStyle.
// Common optional fields the engine reads:
//   channels                 the channel map (also the source scales resolve from)
//   discreteScale            'band' (bar/tick: interval) | 'point' (dot/line: tick)
//   xKey / yKey              value field names the edit/constraint layer reads back
//   edits / constraints / id     (constraints are promoted to the dataset's set)
//   seriesKey / order / supportsSeries   line-family grouping (see plot/line.js)
// Every data mark should resolve a datum -> pixel through encodeChannel (band+value
// marks use it for the value axis and band-geometry helpers for the category axis),
// so positions are computed exactly one way across marks.
//
// ── pointerEvents: who silences what ────────────────────────────────────────
// The engine silences a mark that carries no direct-pick edit, because the
// renderer defaults nodes to pointer-events:auto and paints later features/parts
// on top — an inert rule overlapping a handle would otherwise swallow its drag.
// That rule is per-FEATURE and all-or-nothing, and it only fills in a value the
// mark left unset (`node.pointerEvents == null`).
//
// So the split is:
//   - Don't silence your WHOLE mark to make it inert — leave pointerEvents alone
//     and let the engine decide (see rule.js). Setting it yourself there also
//     disables the mark when it DOES carry an edit.
//   - DO set it per-node on a glyph's CHROME — a line's path, a trend's fitted
//     line, a dotStack's ghosts, a trendBand's samples — when the same feature also
//     emits handles. The engine can't make that distinction for you (it sees one
//     feature), and without it the chrome, drawn last, eats the handles' drags.
//     `pointerEvents: 'stroke'` narrows a hit area to a shape's outline.

/**
 * The standard style channels every mark understands, with their default
 * fallbacks (used when the mark doesn't set the channel at all). `undefined`
 * means "leave the attribute off" — the renderer supplies its own default.
 * @type {Record<string, any>}
 */
export const STYLE_DEFAULTS = {
    fill: undefined,
    stroke: undefined,
    strokeWidth: undefined,
    opacity: undefined,
    fillOpacity: undefined,
    strokeOpacity: undefined
};

// The channels resolveStyle sweeps onto every scene node.
/** @type {string[]} */
export const STANDARD_STYLE_CHANNELS = Object.keys(STYLE_DEFAULTS);

// Top-level option shorthands that desugar to constant channels, so an author
// writes `fill: 'red'` rather than `channels: { fill: { value: 'red' } }`.
//
// A superset of the style channels: `size` is a constant a mark reads itself
// (a circle's radius, via encodeChannel), not one resolveStyle spreads onto a
// node — so it belongs here and NOT in STANDARD_STYLE_CHANNELS. `text`/`fontSize`/
// `textAnchor`/`lineAnchor`/`dx`/`dy` are the text mark's own constants (read raw
// by the mark, not swept by resolveStyle), so `text({ text: 'hi', dy: -8 })`
// reads like every other shorthand. (`format` is a mark-level option, not a
// channel — it stays off this list.)
const SHORTHANDS = [
    ...STANDARD_STYLE_CHANNELS,
    'size', 'symbol', 'text', 'fontSize', 'textAnchor', 'lineAnchor', 'dx', 'dy',
    // Orientation in math degrees (0° = +x, CCW). Constant form is a visual-space
    // shorthand; a scaled field goes through the angle channel's scale so rotate()
    // is an exact inverse. Not a style channel — marks that care read it themselves.
    'angle',
];

// The theme helpers a mark's build() reads its DEFAULT ink/fonts from. Re-exported
// here so a mark imports its whole style vocabulary from one module (marks already
// import resolveStyle/encodeChannel from mark.js). `themeOf(scales)` reads the theme
// the engine stamped on the scale map; `markDefaults(scales, name, fallbacks)` layers
// any `theme.marks[name]` overrides over the mark's built-in fallbacks. See
// core/theme.js for the precedence rules.
export { themeOf, markDefaults } from '../core/theme.js';
import { themeOf } from '../core/theme.js';

// A derived channel's fn re-runs on every render, so a warning would repeat
// forever — `warn` dedups once per key. See core/dev.js.
import { warn, warningsEnabled } from '../core/dev.js';

/**
 * Evaluate a derived channel's `fn(d, i, data)` in VISUAL space. The result is
 * used as-is (never scaled). A null/undefined datum resolves to the fallback
 * rather than calling `fn(undefined)` (constant-resolving callers pass no datum);
 * a fn that returns null/undefined or throws also falls back, so a bad accessor
 * never blanks the chart.
 * @param {any} spec the channel spec (must have a function `fn`)
 * @param {string} channel channel name, for the warning key
 * @param {import('../types').Datum | null} datum
 * @param {number | undefined} index
 * @param {import('../types').Datum[] | undefined} data
 * @param {any} fallback
 * @returns {any}
 */
export function callChannelFn(spec, channel, datum, index, data, fallback) {
    if (datum == null) return fallback;
    try {
        const out = spec.fn(datum, index, data);
        return out == null ? fallback : out;
    } catch (err) {
        warn(`fn:${channel}`, `fn on channel "${channel}" threw: ` +
            `${err instanceof Error ? err.message : err}; using the fallback.`);
        return fallback;
    }
}

/**
 * Map a datum through one channel using the global scale. Handles derived
 * channels (`{ fn }`, computed per datum in visual space), visual constants
 * (`{ value }`), data-space constants (`{ datum }`), scaled fields (`{ field }`),
 * unscaled raw fields (`{ field, scale: null }`), and missing scales/fields (fall
 * back). A function `value` (not `fn`) stays an opaque constant, never invoked.
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
    const spec = channels[channel];
    if (!spec) return fallback;
    if (spec.field === undefined) {
        // Derived channel — fn(d, i, data) computed in visual space, used as-is.
        // Wins over value/datum so `{ fn }` is unambiguous.
        if (typeof spec.fn === 'function') {
            return callChannelFn(spec, channel, datum, index, data, fallback);
        }
        // Visual-space constant — the value IS the output. Subsumes static options
        // like fill: "steelblue".
        if (spec.value !== undefined) return spec.value;
        // Data-space constant — the value is in the field's units, so it goes
        // through the scale exactly as a field's value would. `y: { datum: 25 }`
        // is a reference line at y=25, not at pixel 25. On an UNSCALED channel
        // (`scale: null`) the units are already the output, so the literal is used
        // as-is — the same rule the `{ field }` branch below applies, which is what
        // lets a parametric mark pin a parameter (`intercept: { datum: 0 }`).
        if (spec.datum !== undefined) {
            if (spec.scale === null) return spec.datum;
            const scale = scales[channel];
            return scale ? scale.encode(spec.datum, fallback) : fallback;
        }
        return fallback;
    }
    const raw = datum ? datum[spec.field] : undefined;
    // A datum may lack this channel's field (e.g. a freshly created point with
    // no group/mag yet) — fall back rather than encoding undefined -> NaN.
    if (raw === undefined || raw === null) return fallback;
    // Unscaled field: the datum already holds a literal (a CSS colour, a pixel).
    if (spec.scale === null) return raw;
    const scale = scales[channel];
    if (!scale) return fallback;
    return scale.encode(raw, fallback);
}

/**
 * The shared HANDLE contract — one radius default, one meaning for `handles`, and
 * one place a handle's paint comes from.
 *
 * A handle is a grabbable sub-element a mark draws so a value can be dragged: a
 * line/area point, a trend's intercept and slope dots, an arc's boundary, a face's
 * eyelid, an axis end, a legend's ramp grip. Seven marks drew them with no shared
 * contract at all — `handleSize` defaulted to 4, 5 or 6 depending on the mark and
 * was hard-coded on axis (5) and legend (6); the colour was themed on some marks and
 * a literal (`'steelblue'`, `'#0f172a'`, `'rgba(15,23,42,0.5)'`) on others; and
 * `handles: false` meant three different things — invisible AND inert, invisible but
 * still grabbable, or radius-zero.
 *
 * `handles` now has exactly three values:
 *   true    drawn and grabbable (the default)
 *   false   neither drawn nor grabbable
 *   'hit'   invisible but still grabbable — the deliberate behaviour arc and face
 *           already had, where the SHAPE is the affordance (a slice boundary, a lip)
 *           and the dot would only be clutter.
 * @type {{ size: number }}
 */
export const HANDLE_DEFAULTS = { size: 5 };

/**
 * Resolve a mark's handle options into the paint every handle node needs.
 *
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
    // 'hit' must stay pointer-hittable: opacity:0 is skipped by some hit-testers
    // (Chromium under Playwright), so invisible-but-grabbable uses a transparent
    // fill instead — the same pattern face already used for its supplemental dots.
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
 * The value-field names a mark reports back to the edit/constraint layer as
 * `xKey`/`yKey` — the field each positional channel is bound to, defaulting to the
 * column named after the channel.
 *
 * One helper because there were FOUR spellings of this in `src/plot/`:
 * `(channels.x && channels.x.field) || 'x'` (bar, line, area, tick, rect, waffle,
 * rule, trend, trendBand), the same thing without the default (point, text, face),
 * `yKey` set and `xKey` never (arc), and a non-positional field aliased into both
 * (needle). The engine and edit/guide.js each re-applied `|| 'x'` on read, so the
 * variants mostly agreed by accident — but "mostly, by accident" is what this pass
 * exists to remove.
 *
 * arc, needle and the geo* family stay deliberate exceptions and say why at their
 * own declaration: arc has no category axis (its rows are their own layout order),
 * needle is positioned by an angle, and geo marks key on lon/lat.
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
 * Resolve a datum's CATEGORY on a band/point axis — the discrete-axis counterpart
 * to `encodeChannel`.
 *
 * A band mark (bar/tick/rect/waffle/arc) needs a category KEY, not a pixel: it feeds
 * the key to `bandStartOf`/`bandwidthOf` to get an interval. So it cannot use
 * `encodeChannel`, and every one of them instead read `datum[key]` raw — which meant
 * the channel forms worked on a bar's VALUE axis and were silently ignored on its
 * CATEGORY axis. `bar({ channels: { x: { datum: 'A' } } })` read `d['x']` and drew
 * wherever that landed. This is that missing path, in one place.
 *
 * The forms, in the same precedence `encodeChannel` uses:
 *   { fn }     fn(d, i, data) -> the category key
 *   { datum }  a data-space constant: the category itself (pin every row to one band)
 *   { field }  datum[field] — the ordinary case
 *   (none)     datum[key], the mark's xKey/yKey; and when the mark has no key
 *              either, the column named after the CHANNEL (`d.x` on x). That last
 *              step is the old per-mark `(channels.x && channels.x.field) || 'x'`
 *              default, hoisted here so it happens once instead of being spelled
 *              four different ways across bar/tick/rect/waffle/point/text/arc — and
 *              warned about, because an implicit column is exactly the "which data
 *              does this mark touch?" ambiguity the channel map exists to remove.
 *
 * `{ value }` is deliberately NOT honoured, and warns. `value` means "visual space,
 * skip the scale", and on a category axis there is no such thing: the output of the
 * axis is a band, chosen by which category you name — which is exactly `{ datum }`.
 * Silently treating it as a category would make two spellings mean one thing.
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
 * Encode an ARBITRARY value through a channel's scale — the derived-value sibling
 * of `encodeChannel`, which can only encode a value a datum already holds.
 *
 * A parametric mark computes the points it draws (`trend`'s line is sampled at x
 * positions no row contains; `trendBand`'s envelope is evaluated at the domain
 * ends), so it has a value in the field's units and needs the same field->pixel
 * path. Without this, such a mark reaches past the encoding layer and calls
 * `scales.x.encode(v)` itself, which is how `trend`/`cone` each grew their own
 * placement rules. Honours `scale: null` (raw) and a missing scale exactly as
 * `encodeChannel` does, so the two stay interchangeable.
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
 * Resolve the `angle` channel to math degrees (0° = +x, CCW, y-up — the same
 * convention as needle / pointerDegrees). Scaled when an angle scale exists so
 * `rotate()` is an exact inverse; otherwise raw (a `{ value }` constant or the
 * field's literal degrees). Marks stamp the result on `FeatureNode.angle`; the
 * renderer converts to SVG with `rotate(-deg cx cy)`.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types').Datum | null} datum
 * @param {number} [fallback=0]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {number}
 */
export function encodeAngle(scales, channels, datum, fallback = 0, index, data) {
    if (!channels || !channels.angle) return fallback;
    // scales is an index signature — angle is optional.
    const angleScale = /** @type {any} */ (scales)['angle'];
    if (angleScale) return encodeChannel(scales, channels, 'angle', datum, fallback, index, data);
    const spec = channels.angle;
    // Derived angle — fn returns degrees directly (visual space, no scale).
    if (typeof spec.fn === 'function') {
        return +callChannelFn(spec, 'angle', datum, index, data, fallback);
    }
    if (spec.field != null) {
        const v = datum ? datum[spec.field] : undefined;
        return v == null ? fallback : +v;
    }
    if (spec.value !== undefined) return +spec.value;
    return fallback;
}

/**
 * Resolve a datum's glyph on the `symbol` channel, or `undefined` when the mark
 * declares no symbol channel (or the datum's category maps to nothing). A glyph is
 * a category -> string map through the channel's ordinal scale — the same path
 * `fill` takes to a colour — so a shape mark can render it as a text node in place
 * of its circle/rect. Returns a string glyph or undefined.
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
 * Build a `text` scene node for a glyph centred at (cx, cy), sized so its box is
 * roughly the diameter of a circle of radius `size`. Shared by every shape mark
 * that can render a `symbol` (point / dotStack / waffle), so a glyph token looks
 * the same everywhere. `extra` carries the caller's style/data/index/pointer opts.
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
 * Resolve the standard style channels for one datum into a style object ready to
 * spread onto a scene node. Only channels the mark actually declared (or that
 * carry a non-undefined default) are included, so a node stays sparse and the
 * renderer's own defaults apply to the rest.
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
        if (value !== undefined) style[ch] = value;
    }
    return style;
}

/**
 * The field that identifies a SERIES — which rows belong to the same line, area,
 * geoLine, or stack segment. One rule for the whole mark layer, because "what
 * groups these rows?" is one question: the marks that ask it were each answering
 * it differently (line read stroke, area read fill-then-stroke), so a coloured
 * area and a coloured line grouped by different channels.
 *
 * Precedence: the explicit option (`series`, or Plot's `z` alias) wins; otherwise
 * the field behind a paint channel, fill before stroke — Observable Plot's `z`
 * default, so a coloured chart groups with no extra config.
 *
 * `series` is the public option name; `seriesKey` is the internal feature field.
 * @param {any} opts normalized mark options
 * @param {Record<string, any>} channels the mark's channel map
 * @returns {string | null}
 */
export function seriesFieldOf(opts, channels = {}) {
    return opts.series || opts.z
        || (channels.fill && channels.fill.field)
        || (channels.stroke && channels.stroke.field)
        || null;
}

/**
 * Options every mark accepts, whatever it draws.
 * @type {string[]}
 */
const UNIVERSAL_OPTIONS = ['channels', 'id', 'edits', 'constraints', 'table'];

/**
 * The options every mark must pass through VERBATIM, gathered in one place.
 *
 * Spread this first in a factory's returned object; any key the mark states
 * itself afterwards wins (`bar` renames its own to `edits: markEdits`). One
 * helper because "a mark factory that accepts `edits`/`constraints` and drops
 * them" is a bug this codebase has already shipped once — `rule` silently
 * dropped all four for a long time, which made a draggable whisker impossible.
 * Four names in one place cannot drift the way four names in 29 places did.
 *
 * ── WHICH TABLE A MARK DRAWS ───────────────────────────────────────────────
 * A mark is a view over exactly ONE table of the dataset. `table:` names it.
 * With none, the mark takes the table filling its `tableRole` — `link` declares
 * `'links'`, every other mark leaves it unset and so gets the structure's
 * PRIMARY table, which on a single-table chart is the only one there is. The
 * engine resolves this once, where features are flattened, and dev-warns on a
 * name the schema doesn't declare.
 *
 * NAMES go in `table:`; ROLES go in `tableRole` and `Edit.table`. That
 * indirection is what lets a schema call its tables `claims`/`supports` and
 * need no `table:` written anywhere.
 * @param {any} opts the result of normalizeMarkOptions
 * @returns {{ id: any, edits: any, constraints: any, table: any }}
 */
export function markCommon(opts) {
    return {
        id: opts.id,
        // Mark-level edits (joint / arbitrary); channel-level edits live in
        // channels[ch].edit. Both are gathered by the engine via collectEdits.
        edits: opts.edits,
        // Data invariants, promoted by the engine into the dataset's constraint
        // set and run on every edit commit, from any mark (see elicit.js).
        constraints: opts.constraints,
        table: opts.table,
    };
}

/**
 * Option names that are WRONG in a specific, diagnosable way, each with the
 * correction. These are the API's own history: every one of them was either a
 * real name once, or is the name a reasonable person guesses. Silently ignoring
 * them (which is what `...rest` did) is the worst outcome — the chart renders,
 * looking almost right, and the author has no idea their option did nothing.
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
    value: 'a constant belongs on a channel: channels.<name> = { value: … } for visual space, { datum: … } for data space.',
    field: 'a field belongs on a channel: channels.<name> = { field: "…" }.',
};

/**
 * Warn about options a mark will silently ignore.
 *
 * Unknown keys used to fall into `...rest` and get spread onto the feature, where
 * nothing reads them — so `color: 'red'`, `channel:` for `channels:`, or a
 * misspelled `strokeWdith` all "worked" and did nothing at all. That is the
 * quietest class of authoring bug in the library.
 *
 * `allow` is the mark's own option vocabulary on top of the universal options and
 * the style shorthands. Omitting it silently disables every unknown-option check —
 * so a mark that names itself but declares no vocabulary is a diagnostics HOLE, not
 * a lenient default, and gets told so (once). `arc`/`pie`/`donut` and `axisRadial`
 * sat in that hole for a long time: `arc({ outerRadus: 50 })` warned nothing.
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
            `its unknown-option diagnostics. Declare the mark's own option vocabulary — see ` +
            `the "Adding a new mark" contract in CLAUDE.md.`
        );
    }
    const known = allow
        ? new Set([...UNIVERSAL_OPTIONS, ...SHORTHANDS, ...allow])
        : null;
    for (const key of Object.keys(options)) {
        const fix = MISTAKEN_OPTIONS[key];
        if (fix) {
            // `channel` is the real option name on axis/grid/legend, and several
            // marks legitimately take `field`; an explicit allowlist wins over the
            // generic correction.
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
 * Desugar top-level constant shorthands into `channels`, without clobbering an
 * explicit `channels[ch]` (an explicit channel wins). Keeps
 * `bar({ fill: 'steelblue' })` and `point({ size: 9 })` working through the one
 * channel path. Returns a new options object with a merged `channels` map and the
 * shorthands stripped.
 *
 * `except` keeps named shorthands as plain top-level options instead of desugaring
 * them. That's for a mark where the name is CHROME rather than per-datum style:
 * an axis's `stroke` paints its spine and its `fontSize` its labels — there is no
 * datum to resolve them against, so turning them into channels would only create
 * a channel nothing reads (and force the mark to reach back into raw options for
 * the real value, which is what axisRadial used to do).
 * Pass `mark` (the factory name) to get unknown-option diagnostics, and `allow`
 * to declare the mark's own option vocabulary on top of the universal ones. This
 * is the one place every mark already funnels through, so validating here reaches
 * all of them; `defineMark` makes it unskippable rather than voluntary.
 * @param {any} [options]
 * @param {{ except?: string[], mark?: string, allow?: string[] }} [opts]
 * @returns {any}
 */
export function normalizeMarkOptions(options = {}, { except = [], mark, allow } = {}) {
    warnUnknownOptions(mark, options, allow);
    const { channels = {}, ...rest } = options;
    /** @type {Record<string, any>} */
    const merged = { ...channels };
    for (const ch of SHORTHANDS) {
        if (rest[ch] === undefined || except.includes(ch)) continue;
        // An explicit channel for this name wins over the shorthand.
        // A function shorthand (`fill: d => …`) desugars to a DERIVED channel
        // (`{ fn }`), computed per datum in visual space; any other value is a
        // visual-space constant (`{ value }`).
        if (merged[ch] === undefined) {
            merged[ch] = typeof rest[ch] === 'function' ? { fn: rest[ch] } : { value: rest[ch] };
        }
        delete rest[ch];
    }
    return { ...rest, channels: merged };
}

/**
 * The style names an AXIS mark treats as chrome (its spine, ticks and labels)
 * rather than as per-datum channels — pass to normalizeMarkOptions's `except`.
 * @type {string[]}
 */
export const AXIS_CHROME = ['stroke', 'strokeWidth', 'fill', 'fontSize'];

/**
 * Options every CHART ELEMENT accepts. A chart element (`views: 'scale'` — axis,
 * grid, legend, axisRadial) draws a SCALE rather than columns of the dataset, so it
 * has no `channels` map: the universal set is the mark's minus that.
 * @type {string[]}
 */
const UNIVERSAL_ELEMENT_OPTIONS = ['id', 'edit', 'edits', 'constraints', 'field'];

/**
 * Validate a CHART ELEMENT's options. The counterpart to normalizeMarkOptions for
 * `views: 'scale'` features — the diagnostics half without the channel desugar half,
 * because an element has nothing to desugar INTO.
 *
 * This exists because `axis`/`axisX`/`axisY`/`grid`/`gridX`/`gridY`/`legend`/
 * `legendColor`/`legendSize`/`legendSymbol` skipped normalizeMarkOptions entirely
 * (correctly — they encode no datum) and thereby skipped all validation too. They
 * take ~20 options each and checked none of them: `axisX({ colour: 'red' })` and
 * `axisX({ tickss: 5 })` both rendered a default axis in silence. Routing them
 * through normalizeMarkOptions instead would be wrong in the other direction — it
 * would accept `dy`/`symbol`/`size` (every style SHORTHAND) on an axis.
 * @param {string} element the factory name, for the message
 * @param {any} options
 * @param {string[]} allow the element's own option vocabulary
 * @returns {void}
 */
export function warnUnknownElementOptions(element, options, allow) {
    if (!options || !warningsEnabled()) return;
    const known = new Set([...UNIVERSAL_ELEMENT_OPTIONS, ...allow]);
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
