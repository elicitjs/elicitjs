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
 * Map a datum through one channel using the global scale. Handles derived
 * channels (`{ fn }`, computed per datum in visual space), visual constants
 * (`{ value }`), data-space constants (`{ datum }`), scaled fields (`{ field }`),
 * unscaled raw fields (`{ field, scale: null }`), and missing scales/fields (fall
 * back). A function `value` (not `fn`) stays an opaque constant, never invoked.
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
 * Resolve a mark's handle options into the paint every handle node needs.
 *
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
export function positionalKeys(channels: Record<string, any> | undefined): {
    xKey: string;
    yKey: string;
};
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
 * @param {import('../types.js').Datum | null} datum
 * @param {string | undefined} key the mark's xKey/yKey fallback
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any} the category key, or undefined when there is nothing to resolve
 */
export function categoryOf(channels: Record<string, any>, channel: string, datum: import("../types.js").Datum | null, key: string | undefined, index?: number, data?: import("../types.js").Datum[]): any;
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
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {string} channel
 * @param {any} value in the channel field's own units
 * @param {any} [fallback]
 * @returns {any}
 */
export function encodeValue(scales: import("../types.js").ScaleMap, channels: Record<string, any>, channel: string, value: any, fallback?: any): any;
/**
 * Resolve the `angle` channel to math degrees (0° = +x, CCW, y-up — the same
 * convention as needle / pointerDegrees). Scaled when an angle scale exists so
 * `rotate()` is an exact inverse; otherwise raw (a `{ value }` constant or the
 * field's literal degrees). Marks stamp the result on `FeatureNode.angle`; the
 * renderer converts to SVG with `rotate(-deg cx cy)`.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types.js').Datum | null} datum
 * @param {number} [fallback=0]
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {number}
 */
export function encodeAngle(scales: import("../types.js").ScaleMap, channels: Record<string, any>, datum: import("../types.js").Datum | null, fallback?: number, index?: number, data?: import("../types.js").Datum[]): number;
/**
 * Resolve a datum's glyph on the `symbol` channel, or `undefined` when the mark
 * declares no symbol channel (or the datum's category maps to nothing). A glyph is
 * a category -> string map through the channel's ordinal scale — the same path
 * `fill` takes to a colour — so a shape mark can render it as a text node in place
 * of its circle/rect. Returns a string glyph or undefined.
 * @param {import('../types.js').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {import('../types.js').Datum} datum
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types.js').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {string | undefined}
 */
export function resolveSymbol(scales: import("../types.js").ScaleMap, channels: Record<string, any>, datum: import("../types.js").Datum, index?: number, data?: import("../types.js").Datum[]): string | undefined;
/**
 * Build a `text` scene node for a glyph centred at (cx, cy), sized so its box is
 * roughly the diameter of a circle of radius `size`. Shared by every shape mark
 * that can render a `symbol` (point / dotStack / waffle), so a glyph token looks
 * the same everywhere. `extra` carries the caller's style/data/index/pointer opts.
 * @param {string} glyph
 * @param {number} cx @param {number} cy
 * @param {number} size the radius the mark would have used for a circle, in px
 * @param {Record<string, any>} [extra]
 * @returns {import('../types.js').FeatureNode}
 */
export function symbolNode(glyph: string, cx: number, cy: number, size: number, extra?: Record<string, any>): import("../types.js").FeatureNode;
/**
 * Resolve the standard style channels for one datum into a style object ready to
 * spread onto a scene node. Only channels the mark actually declared (or that
 * carry a non-undefined default) are included, so a node stays sparse and the
 * renderer's own defaults apply to the rest.
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
export function seriesFieldOf(opts: any, channels?: Record<string, any>): string | null;
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
export function markCommon(opts: any): {
    id: any;
    edits: any;
    constraints: any;
    table: any;
};
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
 * all of them. A `mark` with no `allow` is a diagnostics HOLE and warns (see
 * warnUnknownOptions), which is what keeps the declaration from being optional.
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
export function warnUnknownElementOptions(element: string, options: any, allow: string[]): void;
/** @type {string[]} */
export const STANDARD_STYLE_CHANNELS: string[];
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
export const HANDLE_DEFAULTS: {
    size: number;
};
/**
 * The style names an AXIS mark treats as chrome (its spine, ticks and labels)
 * rather than as per-datum channels — pass to normalizeMarkOptions's `except`.
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
export function bandStartOf(scale: any, value: any, fallback?: any): any;
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
export function bandSpan(scale: any, value: any, fullLength: number, { inset, length }?: {
    inset?: number;
    length?: number;
}): [number, number];
/**
 * Pixel baseline (value origin) of a value scale — where a bar starts from.
 * Uses 0 when in the domain, clamped into the range so bars never escape it.
 * @param {any} valueScale
 * @returns {number}
 */
export function baselineOf(valueScale: any): number;
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
 * Angular interval [lo, hi] in degrees for one discrete category on an angle
 * scale (band → band edges; point → midpoints between neighbours; continuous →
 * undefined). Mirrors bandSpan for the degree range.
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
 * Merge author channels over the mark's defaults and stamp `scale: null` on every
 * parameter channel, so a parameter is read in its own units and never resolves a
 * scale. `x` / `y` are left alone — they ARE the scales.
 * @param {Record<string, any>} rawChannels
 * @param {Record<string, any>} [defaults] parameter defaults, e.g. { intercept: { field: 'intercept' } }
 * @returns {Record<string, any>}
 */
export function paramChannels(rawChannels: Record<string, any>, defaults?: Record<string, any>): Record<string, any>;
/**
 * Read one datum's line parameters and the band's bounds on each.
 *
 * `a` / `b` are the line itself. The bounds default to the line (a zero-width band)
 * so a mark with no uncertainty declared still has well-formed geometry.
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
 * The two x positions a trend's handles sit at.
 *   anchor — the pivot: dragging the intercept handle translates the line so its
 *            value HERE follows the pointer, and dragging the slope handle rotates
 *            about this point. Defaults to 0 when 0 lies in the x domain (the
 *            classic y-intercept frame), else the domain's first end.
 *   probe  — where the slope handle sits. Defaults to the domain's other end, so
 *            anchor and probe are never the same point.
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
 * The line y = a + b·x as a segment clipped to the plot. Sampled at the x-domain
 * ends and then extended as an infinite line, so it runs edge to edge rather than
 * stopping wherever the domain happens to end.
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
 * `levels` nested envelopes, innermost first — the band at increasing fractions of
 * its spread. Stacked at a low opacity they darken toward the line, which is how a
 * gradient is drawn here: the renderer has no gradients, so a ramp is N shapes (the
 * idiom `legend`'s continuous colour ramp already uses).
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
     * unit vector INTO the source end
     */
    tangentIn: {
        x: number;
        y: number;
    };
    /**
     * unit vector OUT OF the target end
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
 * A node's rectangle, in scene coordinates. Half-extents rather than width/height
 * because every test here is "how far out from the centre".
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
     * a named edge, or 'auto'
     */
    sourceSide?: string | undefined;
    /**
     * a named edge, or 'auto'
     */
    targetSide?: string | undefined;
};
/**
 * The shapes, keyed by kind. `smooth` is an alias of `bezier`; `loop` is not
 * spellable by an author — it is reached only by a row referencing one node twice.
 *
 * `anchors` says what the `seg` handed to `build` MEANS: the chord already pulled in
 * by `inset` for every point-to-point kind, or the two node centres for a kind that
 * docks to a box. See the header — this is a declared capability so that the mark
 * never branches on a kind name.
 * @type {Record<string, { anchors: string, build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null }>}
 */
export const LINK_SHAPES: Record<string, {
    anchors: string;
    build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null;
}>;
// ── from src/plot/hitpath.js ────────────────────────────────────────────────
/**
 * Sample a quadratic Bézier into a polyline.
 *
 * `samples` exists for the one caller that is not building a hit path: a rounded
 * corner (linkGeometry.js) IS a quadratic, and rounding it through this sampler is
 * what keeps an elbow a `points` polyline instead of a `d` string with a companion
 * hit path. A corner spans a few px, so it needs far fewer segments than a link
 * body — but a second sampler for the difference would be one copy too many.
 *
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
 * Which rows form one group.
 *
 * The grouping is the ENCODING: whichever of the named positional channels carry a
 * field partitions the dataset, so a `bar` stacks the rows that share a band and an
 * `arc` puts one donut in each x/y slot. Bind none of them and every row lands in a
 * single group — the classic one-stack / one-pie case, which is the same code path
 * rather than a special case. There is no `groupBy` option anywhere in this library
 * and this is why: declaring the position already says it.
 *
 * Keys resolve through `categoryOf`, so a `{ fn }` or `{ datum }` channel groups the
 * way it draws. Reading `datum[key]` raw here instead — which is what bar's old
 * private `stackOffsets` did — silently ignored both forms on the very axis that
 * decides the grouping.
 *
 * Each group keeps its rows' GLOBAL indices (their addresses in the engine's one
 * dataset) in first-seen order, so a node, a handle and an edit all still address
 * that one dataset.
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
 * One group's shares and cumulative bounds, in the magnitude field's own DATA units.
 *
 * `bounds[local]` is `[lo, hi]`: the running total before this row, and after it. A
 * bar reads those as the segment's two ends on the value axis; an arc scales them
 * into its angular span. Both then encode them through their own scale — the numbers
 * here are data, never pixels.
 *
 * Non-finite and negative magnitudes count as 0. A stack is a part-to-whole
 * statement, and a negative part has no interval to occupy — silently flipping one
 * would put a segment behind its own baseline and make the boundaries between it and
 * its neighbours cross.
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
 * What a mark stamps on a segment node or a boundary handle so an edit can invert
 * the layout that produced it.
 *
 * This is the `node.frame` idea from `composite`, applied to a stack: the mark that
 * ENCODED the layout carries the means to invert it, so `edit.stack.*` needs no
 * second layout implementation and no knowledge of which mark it is on. Everything
 * here is pure DATA — no closures, no scales. A commit re-renders and the node an
 * in-flight gesture is holding goes stale, so every edit re-derives magnitudes from
 * the live dataset each tick and reads only `members`/`geometry` from the stamp.
 *
 * `geometry` says how a pointer becomes a position along the stack, and it names a
 * CAPABILITY rather than a mark:
 *   { kind: 'linear',  axis }                          value axis, through its scale
 *   { kind: 'angular', cx, cy, spanStart, spanEnd, pad } around a ring
 * `edit/stack.js` holds one small table keyed by `kind`; a third geometry is a row
 * in it, not a branch in a mark.
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
 * Break a string into lines that each fit `maxWidth`. Greedy word wrap, honouring
 * newlines the author (or the user) typed, and hard-breaking a single word that is
 * too long for the box on its own — a word that cannot fit still has to be drawn
 * somewhere, and overflowing the shape is worse than a mid-word break.
 *
 * With no `maxWidth` the text still splits on its own newlines, so a multi-line
 * string works before any wrapping is asked for.
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
// ── from src/edit/shared.js ─────────────────────────────────────────────────
/**
 * Strip a `pick` an edit cannot honour, and say so.
 *
 * A few edits are inseparable from one driver: `brushSpan`/`brushRect`/`geo.brush`
 * read a zone lock that only their own driver writes, so pointing them at another
 * strategy produces an edit that silently never fires. They already forced their
 * pick — but did it by quietly dropping the option, which is the same class of
 * silent no-op the drop was protecting against.
 * @param {any} options
 * @param {string} type the edit's type, for the message
 * @param {string} pick the driver it is bound to
 * @returns {any} the options without `pick`
 */
export function claimPick(options: any, type: string, pick: string): any;
/**
 * Normalize an edit spec into the canonical Edit descriptor the engine routes to.
 *
 * Unknown keys PASS THROUGH onto the descriptor: driver-specific knobs
 * (`edgeInset`, `resize`, `move`, …) ride on the edit where their driver reads
 * them (see edgeInsetOf in pick.js). Canonical keys are normalized below and
 * always win over a raw spread value. This is the one sanctioned way a custom
 * driver (registerDriver) carries per-edit options — no post-hoc attachment.
 * @param {any} spec
 * @returns {import('../types.js').Edit}
 */
export function makeEdit(spec: any): import("../types.js").Edit;
/**
 * Claim an edit for ONE tagged handle of a multi-handle feature.
 *
 * When a feature emits several handles over one datum (an area's y1/y2 edges, a
 * trend's intercept/slope), direct-pick dispatch fans a gesture to EVERY direct
 * edit on the feature — so an unguarded drag on the lo handle also runs the hi
 * edge's edit. Each handle carries its `channel`, and this wraps an edit's `when`
 * so it only fires on its own.
 *
 * An UNTAGGED or ABSENT node passes: a mark-level edit spanning both edges still
 * sees every gesture, and a plane/probe-pick edit (which carries no node at all)
 * is not silently killed by a guard written for handles.
 * @param {any} edit
 * @param {string} name the `channel` tag this edit owns
 * @returns {any}
 */
export function claimEdge(edit: any, name: string): any;
/**
 * A fresh series key not already present in the data — the identity of a new line.
 * Uses the smallest non-negative integer free among the existing keys, so colors
 * (an ordinal scale over the keys) stay stable as lines come and go.
 * @param {any[]} data
 * @param {string | null} seriesField
 * @returns {number}
 */
export function nextSeriesKey(data: any[], seriesField: string | null): number;
/**
 * A category for a row an edit is minting — the categorical sibling of
 * `nextSeriesKey`, and the reason `edit.stack.cut` needs no keyboard.
 *
 * The schema owns the domain, and the domain says which categories COULD exist; the
 * data says which are in play. So a new segment takes the first declared category
 * nothing currently uses. Which leaves the case where they run out, and that is
 * where `FieldSchema.open` speaks:
 *
 *   closed (the default) — the domain is the whole vocabulary. Return undefined and
 *     let the caller refuse: minting a category the author didn't declare would put
 *     a value on an axis that has no room for it.
 *   open — the domain is a starting set. Mint a placeholder that collides with
 *     nothing, for the author (or the user, via edit.axis.categories) to rename.
 *     Creating and NAMING are separate acts; blocking the first on the second is
 *     what forces a gesture to become a text field.
 *
 * @param {any[]} data
 * @param {string | null | undefined} field
 * @param {any[]} domain the field's declared/resolved domain
 * @param {{ open?: boolean, label?: string }} [options] `label` is the placeholder stem
 * @returns {any} the category, or undefined when a closed domain is exhausted
 */
export function nextCategory(data: any[], field: string | null | undefined, domain: any[], { open, label }?: {
    open?: boolean;
    label?: string;
}): any;
/**
 * Mint ONE new datum — the single seed-and-invert core every creator builds on
 * (`create`, `toggle`, `anchor`, `draw`'s freehand branch, `geo.create`). Creation
 * is mark-agnostic: a datum is generated from the scales/axes, then whatever mark
 * views the dataset encodes it. This is that generation, in one place:
 *   1. `schemaDefaults(ctx.schema)` — every declared field at its default (else null,
 *      present-but-unset), so a minted row matches the elicited shape.
 *   2. `defaults` — the creator's explicit non-positional seed (group, mag, …), AND
 *      the extent an `rect`/area needs (`width`/`height`, `x2`/`y2`) so it isn't minted
 *      zero-size. These win over the schema.
 *   3. `seed` — values a creator already resolved outside the pointer inversion: geo's
 *      projected lon/lat, a line's series key. These win last and, being present, count
 *      as "placed" on their own.
 *   4. the inverted pointer, per positional channel — the exact inverse of `encode`.
 *   5. an IDENTITY, when the table declares one (see below).
 * Returns the datum, or `undefined` when nothing could be placed (no invertible
 * positional channel and no `seed`) — the "this mark can't create here" signal a
 * caller turns into a no-op (see also warnCreateOnNonMark in elicit.js).
 *
 * ── Identity ───────────────────────────────────────────────────────────────
 * A table may declare one field as its `key` — the column that identifies a row,
 * and the one a `ref` in another table points at. A minted row has to carry one:
 * a row whose identity is null can be referenced by nothing, so a link drawn to it
 * connects nothing and a gesture can never complete it.
 *
 * That is a property of the SCHEMA, not of any particular edit, so it belongs here
 * rather than in a creator of its own — `create`, `toggle` and every other minting
 * edit get it for free, on any table under any structure. `nextCategory` is the
 * same primitive `edit.stack.cut` uses, which is what keeps CREATING and NAMING
 * separate acts: the row arrives with a placeholder, and an `editText` renames it.
 * A closed vocabulary that has run out returns undefined, and the caller refuses —
 * the author declared exactly which rows may exist.
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
 * The scene node an edit is currently acting on, regardless of pick strategy:
 * `ctx.node` is set for a direct-pick gesture (the DOM element it landed on),
 * but a plane-pick gesture (nearest/sweep) resolves its target by datum index
 * with no node attached — so fall back to looking the current mark up in
 * `ctx.marks` by `ctx.index`, the same by-datum-index lookup guide.js's
 * `selectEffectNodes` already does for the proximity highlight.
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
 * Where the pointer would be if you nudged it one step along `scale` — the pixel a
 * keyboard press stands in for, so an arrow key drives the SAME edit a drag does
 * (the edit still just inverts a pointer through a scale; it never learns there was
 * a keyboard).
 *
 * The step has to be asked of the scale, which is why this can't live in the
 * renderer: on a discrete axis a step is "the next category" (a fixed pixel nudge
 * would do nothing at all until it happened to cross a band edge), and on a
 * continuous one it's a fraction of the range.
 * @param {any} scale the axis scale (may be null / non-invertible)
 * @param {number} at current pixel position on that axis
 * @param {-1 | 0 | 1} dir step direction in PIXEL space
 * @param {boolean} [coarse] a bigger step (Shift)
 * @returns {number} the new pixel position (unchanged when it can't step)
 */
export function nudgeTarget(scale: any, at: number, dir: -1 | 0 | 1, coarse?: boolean): number;
/**
 * Map a pixel position on a straight track [pxAt0 → pxAt1] to a value, LINEARLY
 * across the channel's domain [loVal → hiVal]. `pxAt0` is the pixel where the
 * value is `loVal`, `pxAt1` where it is `hiVal`; the position is clamped to the
 * track, so the value never runs past the domain. This is "drag along an axis =
 * a value" — the single linear pointer→value mapping the `slide` edit and the
 * face's direct-manipulation handles both build on, so the two never drift.
 *
 * Deliberately domain-linear (not `scale.invertValue`): a `slide` track is an
 * arbitrary UI segment anchored at the handle, NOT the scale's own pixel range,
 * so the scale is consulted only for the domain extremes (via `domainConfig`),
 * never as geometry. For a plain linear channel this equals the scale's own
 * inversion; for a non-positional [0,1] param (a face channel) it maps the track
 * straight onto the field's units.
 * @param {number} px current pixel position on the track
 * @param {number} pxAt0 the pixel where the value is `loVal`
 * @param {number} pxAt1 the pixel where the value is `hiVal`
 * @param {number} loVal domain value at `pxAt0`
 * @param {number} hiVal domain value at `pxAt1`
 * @returns {number | undefined} the value, or undefined for a zero-length track
 */
export function linearInvert(px: number, pxAt0: number, pxAt1: number, loVal: number, hiVal: number): number | undefined;
/**
 * The domain extremes [lo, hi] of a resolved channel, read off its scale's
 * `domainConfig` (the declared field domain). Falls back to [0, 1] — the neutral
 * range a non-positional param uses — when the channel carries no domain. The
 * one place `slide` and the face read a channel's value range, so a track always
 * spans the same [lo, hi] the encoding drew from.
 * @param {import('../types.js').ResolvedChannel | { scale?: any } | null | undefined} ch
 * @returns {[number, number]}
 */
export function channelDomain(ch: import("../types.js").ResolvedChannel | {
    scale?: any;
} | null | undefined): [number, number];
/**
 * The DISCRETE value set a channel steps through — what `cycle` advances along.
 *
 * The scale's domain when the channel HAS a scale; the field's SCHEMA domain when
 * it doesn't. That second half is not a fallback for a broken case, it is the
 * ordinary one: the schema OWNS the domain, and two perfectly well-formed channels
 * resolve no scale at all — `scale: null` (the datum holds a literal colour, a
 * sticker's `tone`) and a raw non-positional channel a mark reads itself (a link's
 * `curve`). Reading only `ch.scale.domain()` made `cycle()` a silent no-op on both:
 * the cursor turns editable, the click lands, `apply` returns undefined, nothing
 * happens and nothing is logged.
 * @param {import('../types.js').ResolvedChannel | null | undefined} ch
 * @param {Record<string, any> | undefined} [schema] the target table's field map
 * @returns {any[] | null}
 */
export function discreteDomain(ch: import("../types.js").ResolvedChannel | null | undefined, schema?: Record<string, any> | undefined): any[] | null;
/**
 * Invert the pointer through ONE channel's scale — the single-field half of
 * `move()`, factored out so `brushSpan`'s edge-zone tick can reuse the
 * exact same computation instead of a second copy. Pass `center` for radial
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
 * Recenter a mark's CURRENT pixel span (read off its rendered node) on the
 * pointer, then invert both new endpoints back to data — the whole-span-move
 * computation `moveSpan` and `brushSpan`/`brushRect`'s body zone both use.
 * Stateless: no dragstart/delta tracking, just "the gesture sets the absolute
 * position", the same model `move()`/`invertChannel` already use for a single
 * field.
 *
 * The span's WIDTH is preserved when the pointer pushes it against the scale's
 * pixel range: the whole interval shifts as a unit rather than each endpoint
 * clamping independently (which would shrink the span to zero at the edge and
 * leave it stuck). If the span is already wider than the range, it pins to the
 * full range.
 * @param {any} node the mark's current scene node (rect: x/y/width/height)
 * @param {import('../types.js').ResolvedChannel} chA
 * @param {import('../types.js').ResolvedChannel} chB
 * @param {{ x: number, y: number }} pointer
 * @returns {{ a: any, b: any } | undefined}
 */
export function recenterSpan(node: any, chA: import("../types.js").ResolvedChannel, chB: import("../types.js").ResolvedChannel, pointer: {
    x: number;
    y: number;
}): {
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
 *   rect   -> distance to the bar's band interval (its category slot), measured
 *             along the band axis, so any point in the column/row selects the bar
 *             regardless of its length. `bandAxis` is set by the bar mark.
 *   line   -> true point-to-segment distance to the tick. Along the span you can
 *             still grab it from anywhere (distance 0 on the segment), but two
 *             ticks stacked in the SAME band are disambiguated by the pointer's
 *             distance to each one's value position — the band-interval shortcut
 *             (used for rects) can't, since it ties every tick in the column at 0.
 * @param {any} mark
 * @param {number} px
 * @param {number} py
 * @returns {number}
 */
export function distanceToMark(mark: any, px: number, py: number): number;
/**
 * The nearest mark within `threshold` (or null). Returns the mark's DATUM index so
 * the edit can address the datum. An optional `series` scopes the search to one
 * line's handles (used by a series-locked 2D sweep).
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {any} [series] restrict to marks with this `series` key
 * @returns {number | null}
 */
export function nearestMark(marks: any[], px: number, py: number, threshold: number, series?: any): number | null;
/**
 * The `series` key of the line closest to the pointer within `threshold` (or
 * null) — measured to the LINE ITSELF (its connecting path's segments), not just
 * its vertices, so a click anywhere along a sparse line still resolves to it. Falls
 * back to handle distance for a one-point series (which has no path yet). This is
 * how a gesture decides WHICH line it means: a sweep locks onto it, an `anchor`
 * attaches to it, and being far from every line (null) starts a new one.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @returns {any | null}
 */
export function nearestSeries(marks: any[], px: number, py: number, threshold: number): any | null;
/**
 * The nearest mark measured ALONG ONE AXIS only (the you-draw-it sweep target):
 * distance is |px - cx| on 'x' or |py - cy| on 'y', so the pointer's position on
 * the other axis is ignored and a horizontal sweep always selects the point in
 * the column it is over. Only handle nodes with a centre (circles) are eligible.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @param {number} threshold
 * @param {'x' | 'y'} axis
 * @param {any} [series] restrict to marks with this `series` key (series-locked sweep)
 * @returns {number | null}
 */
export function nearestMarkOnAxis(marks: any[], px: number, py: number, threshold: number, axis: "x" | "y", series?: any): number | null;
/**
 * The topmost mark the pointer is actually ON (containment), or null — the geometric
 * replacement for the browser's SVG hit-test, used by renderers with no DOM elements
 * to hit (the canvas renderer). Distinct from `nearestMark`: `direct` pick means "the
 * mark under the pointer", not "the closest mark within 40px", so this tests real
 * containment and walks the scene BACK-TO-FRONT (last drawn wins, matching paint /
 * z-order).
 *
 * It also honours what SVG enforced for free: a node is only a target if its feature
 * has a direct-pick edit (`editable`) and it isn't locked, a guide, background, or
 * explicitly `pointerEvents:'none'` — the pointer-transparency invariant, which the
 * DOM hit-tester applied via CSS and a geometric hit-test must apply itself.
 *
 * Reuses `distanceToMark` for the genuine distance cases (circle centre, line/path
 * segments); a rect is a real point-in-bounds test rather than `distanceToMark`'s
 * band-proximity shortcut, because "anywhere in the column" is what NEAREST wants,
 * not what a direct hit is.
 * @param {any[]} marks
 * @param {number} px
 * @param {number} py
 * @returns {any | null} the hit node object (not its index), or null
 */
export function hitTest(marks: any[], px: number, py: number): any | null;
/**
 * The snap radius for an edit, with an optional driver-specific default.
 *
 * `fallback` matters: a driver whose grab target is a small fixed handle wants a
 * tighter radius than a free proximity pick. axisDrag and slide each declared one
 * and then wrote `pickThreshold(edit) || THEIRS` — which can never reach the `||`,
 * because pickThreshold always returns at least 40. Both constants were dead, and
 * an axis handle was being grabbed from 40px away instead of 14.
 * @param {import('../types.js').Edit} edit
 * @param {number} [fallback]
 * @returns {number}
 */
export function pickThreshold(edit: import("../types.js").Edit, fallback?: number): number;
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
     * the rows it would commit, and WHICH TABLE they replace (an edit may propose for
     * a table other than the one its mark draws — see edit.network.connect).
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
     * the datum a DIRECT gesture landed on, or null
     * for a plane gesture — where the driver resolves its own target from the
     * pointer (nearestMark and friends). A driver that can serve a direct-pick edit
     * reads this first and skips its proximity search.
     */
    index: number | null;
    session: DriverSession;
    preview: DriverPreview;
    stage: DriverStage;
    runEdit: (edit: import("../types.js").Edit, index: number | null) => boolean;
    previewEdit: (edit: import("../types.js").Edit, index: number | null) => boolean;
};
export type Driver = {
    name: string;
    wants: (edit: import("../types.js").Edit) => boolean;
    onEvent: (ctx: DriverContext) => boolean;
    /**
     * writes a selection into its session (see above),
     * so an edit with `guide: true` can draw the `select` effect for it.
     */
    selects?: boolean | undefined;
};
/**
 * Register a custom driver (or replace a built-in by the same `name`). The engine
 * reads this mutable registry from dispatchPlaneEdits — no elicit.js branches.
 * @param {Driver} driver
 */
export function registerDriver(driver: Driver): void;
// ── from src/constraints/define.js ──────────────────────────────────────────
/**
 * Creates a constraint.
 * @param {(ctx: import('../types.js').ConstraintContext) => any} reducer
 * @param {any} [meta]
 * @returns {import('../types.js').Constraint}
 */
export function defineConstraint(reducer: (ctx: import("../types.js").ConstraintContext) => any, meta?: any): import("../types.js").Constraint;
// ── from src/widgets/theme.js ───────────────────────────────────────────────
/**
 * The row of option rings + their labels, with a connecting track behind them.
 * Rings sit on the plot's vertical centre — where a `point` with no y channel
 * parks itself — so the answer dot lands exactly inside its ring.
 * @param {{ labelOffset?: number, radius?: number }} [options]
 */
export function optionRings(options?: {
    labelOffset?: number;
    radius?: number;
}): import("../types.js").Guide;
/**
 * The cell grid of a question matrix: a soft rect per (question, option) cell,
 * column headers above, and row labels in the left margin. Guide rects draw
 * behind the marks, so an answered cell shows its dot on top of its cell.
 * @param {{ pad?: number }} [options]
 */
export function cellGrid(options?: {
    pad?: number;
}): import("../types.js").Guide;
/**
 * A slider's track: a rule along the plot's centre line with end caps and value
 * labels at the domain ends.
 * @param {{ format?: (v: any) => string }} [options]
 */
export function sliderTrack(options?: {
    format?: (v: any) => string;
}): import("../types.js").Guide;
/**
 * The question prompt, drawn into the top margin so it travels with the chart.
 * `y` lifts it clear of whatever the instrument draws below it (column headers,
 * an axis label) — the caller owns the top margin, so it owns the offset.
 * @param {string} text
 * @param {{ y?: number }} [options]
 */
export function prompt(text: string, options?: {
    y?: number;
}): import("../types.js").Guide;
/**
 * The crosshair frame of a correlation plot: axes through the centre and a
 * high/low label on each of the four ends (the layout of the line+cone task).
 * The side labels stack onto two lines so a long variable name fits the margin
 * instead of running off the SVG.
 * @param {{ x?: string, y?: string }} [labels]
 */
export function crosshair(labels?: {
    x?: string;
    y?: string;
}): import("../types.js").Guide;
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
 * The resolved theme a widget factory reads its answer-mark ink/size from:
 * DEFAULT_THEME < setTheme() base < the widget's own `theme` option — the same
 * precedence the engine applies to `spec.theme`, so the baked-in mark colour and the
 * live affordance colours always agree.
 * @param {import('../types.js').DeepPartial<import('../types.js').Theme> | undefined} [theme]
 * @returns {import('../types.js').Theme}
 */
export function widgetTheme(theme?: import("../types.js").DeepPartial<import("../types.js").Theme> | undefined): import("../types.js").Theme;
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
 * Does this projection place lon/lat the way the tile pyramid does — i.e. will
 * tiles register with the data?
 *
 * Checked by BEHAVIOUR, not by a type name (same discipline as the scale
 * capability flags: a name is a label, a measurement is the truth). We derive the
 * world's top-left from the projection itself, then assert that probe points land
 * exactly where the Web Mercator formula says they must:
 *
 *   x = ox + worldPx · (lon + 180) / 360
 *   y = oy + worldPx · (0.5 − ln(tan(π/4 + φ/2)) / 2π)
 *
 * The LATITUDE probes are what carry the test: mercator and equirectangular agree
 * on the equator (both are linear in lon), so an equator-only check passes
 * equirectangular and would silently draw a stretched, misregistered map. The
 * probes also reject an oblique rotation, a clipped globe, and a hand-rolled d3
 * projection. A pure LONGITUDE rotation legitimately passes: it pans the sphere,
 * and since the tile grid is placed through the same projection, imagery and data
 * pan together.
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
 * The theme a mark's build() can see: the engine stamps the resolved theme on the
 * scale map (the projection-transport pattern) so no build() signature changes.
 * Falls back to DEFAULT_THEME for a bare scale map (a mark unit-tested in isolation).
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
