// @ts-check
// theme.js — the STYLE layer: one place that owns every default colour, font, and
// affordance token the library draws with. Kept deliberately separate from the two
// existing customization seams it complements:
//
//   · a mark's per-datum STYLE channels (fill/stroke/opacity/…) — the most specific
//     override, resolved in plot/mark.js. A channel always wins over the theme.
//   · the interaction-EFFECTS layer (core/effects.js) — transient feedback for
//     interaction STATE (grab, proximity-select). The theme supplies its DEFAULTS
//     but effects stay their own resolved object.
//
// The model mirrors `spec.effects → resolveEffects → ctx.effects`: a chart passes
// `spec.theme`, the engine resolves it once (`resolveTheme`), stamps it on the scale
// map (the same transport `projection` uses, so build() and edit ctx share one
// object without widening any signature), and marks/chrome/renderers read defaults
// from it. Precedence, most specific first:
//
//   per-mark channel/option  >  theme.marks[name]  >  theme token  >  renderer base
//   spec.theme               >  setTheme() base    >  DEFAULT_THEME
//
// A theme is DATA — no functions, no closures — so it deep-merges cleanly and a
// caller can override one token (`{ ink: 'crimson' }`) or a whole family.

import { DEFAULT_PALETTE, DEFAULT_RAMP, DEFAULT_DIVERGING } from './encoding.js';
import { DEFAULT_EFFECTS } from './effects.js';
import { themes } from './themes.js';
import { warn } from './dev.js';

/**
 * The built-in defaults. Every value here is the literal the library drew with
 * BEFORE the theme layer existed, so `resolveTheme()` with no user theme is
 * pixel-identical to the pre-theme output. Change a value here and it recolours the
 * whole library from one place.
 * @type {import('../types').Theme}
 */
export const DEFAULT_THEME = {
    // The primary mark colour. Every mark that historically defaulted to
    // 'steelblue' (bar/point/line/area/rect/dotStack/waffle/tick/geo) reads this,
    // so one token restyles the chart's ink.
    ink: 'steelblue',
    // Interactive emphasis: draggable handles, a committed survey answer, an axis
    // edit handle. Matches the widgets' historical accent.
    accent: '#2563eb',
    // Secondary chrome / de-emphasised marks.
    muted: '#9ca3af',
    // Draggable-handle ink, shared by every mark that draws one (see
    // resolveHandles in plot/mark.js). Split out from `accent` so a theme can make
    // handles read differently from other interactive emphasis without changing
    // both. `handleStroke` is the halo that keeps a handle legible on top of the
    // mark it belongs to — arc, face, axis, legend and geo each hard-coded '#fff'
    // for exactly this, which meant none of them worked on a dark theme.
    handle: '#2563eb',
    handleStroke: '#fff',
    // The chart's backdrop, applied as the CSS background of the svg/canvas (so it
    // covers the margin band too). Defaults to null = transparent (the host page's
    // background shows through, exactly as before); a dark theme sets it to paint the
    // whole chart. This is the one piece a dark-mode chart needs beyond light ink.
    background: null,

    // Colour scales fed to resolveScales when a channel names no explicit range or
    // scheme. Arrays replace wholesale on merge (they are values, not sub-objects).
    palette: DEFAULT_PALETTE,
    ramp: DEFAULT_RAMP,
    diverging: DEFAULT_DIVERGING,

    // Typography. `family`, when non-null, is emitted on the root svg (and used by
    // the canvas renderer) so every label inherits it. It defaults to null so the
    // built-in look inherits the host page's font exactly as before — a theme
    // (e.g. themes.survey) opts into a specific family. `size` matches the
    // historical geom-text fallback (10).
    font: { family: null, size: 10, labelSize: 12, titleSize: 13 },

    // Chart titles (spec.title / subtitle / caption — core/titles.js). A null fill
    // takes the axis label ink, so a dark theme's titles follow its labels. A null
    // fontFamily inherits `font.family`; a headline may set its own (a serif title
    // over sans-serif labels is the commonest house style there is).
    title: { fill: null, fontSize: 16, fontWeight: 600, fontFamily: null, fontStyle: null },
    subtitle: { fill: null, fontSize: 12, fontWeight: 'normal', fontFamily: null, fontStyle: null },
    caption: { fill: null, fontSize: 11, fontWeight: 'normal', fontFamily: null, fontStyle: null },

    // Chart chrome. Axis spine/ticks (stroke), tick labels + title (labelFill), the
    // edit handle on a draggable axis (handle). Grid lines are separate.
    //
    // Every token is also an `axis()` option of the same name, and the option wins.
    // `discrete` / `continuous` hold per-KIND overrides of any token, read off the
    // scale's capability flag — which is how a theme says "no spine on the value
    // axis, a spine under the categories" (the newsroom look Flint's presets share,
    // https://github.com/microsoft/flint-chart, `structure.axis.measure|categorical`).
    axis: {
        stroke: '#6b7280',
        labelFill: '#374151',
        fontSize: 10,
        handle: '#2563eb',
        // Spine (domain line) width, also the tick width.
        strokeWidth: 1,
        // Draw the spine at all. `false` keeps the ticks and labels.
        line: true,
        // Tick length in px; 0 draws no ticks.
        tickSize: 6,
        // Gap between a tick's end and its label, in px.
        tickPadding: 3,
        // Tick-label rotation in math degrees (counter-clockwise), like a mark's `angle`.
        labelAngle: 0,
        // Label typography; null inherits `font.family` / the renderer's weight.
        fontFamily: null,
        fontWeight: null,
        // The axis title. Null fill takes `labelFill`; null size is `fontSize + 1`.
        titleFill: null,
        titleFontSize: null,
        titleFontWeight: null,
        // Extra gap between the tick labels and the title, in px (added to the default).
        titlePadding: 0,
        // The title's place along the axis: 'start', 'middle', 'end' (right / top).
        titleAnchor: 'middle',
        // A label's text-anchor ('start' | 'middle' | 'end'); null is the side's own
        // (centred under an x tick, flush against a y axis). `labelOffset` moves
        // every label along the axis, px. With a negative `tickPadding` these put
        // the labels inside the plot — the space-saving axis.
        labelAlign: null,
        labelOffset: 0,
        // Per-kind overrides (any token above). Empty: both kinds look alike.
        discrete: {},
        continuous: {},
    },
    // Gridlines. `show` decides which IMPLICIT axes get a grid without the spec
    // asking (`axes: { y: { grid: true } }` still works either way): 'none' keeps
    // the historical look; 'value' grids the axis the value runs along (the
    // continuous one, y when both are — Flint's "measure" grid); 'continuous'
    // every continuous axis; 'all' every axis.
    // `zero` emphasises the line at 0 on a continuous grid (a baseline rule):
    // null for none, or `{ stroke, strokeWidth, strokeDash }`.
    // `bandPosition` puts a band axis's gridlines at that fraction of each band
    // (0 = between the categories); null is the centre.
    grid: { stroke: '#e5e7eb', strokeWidth: 1, strokeDash: null, opacity: null, show: 'none', zero: null, bandPosition: null },

    // The PLOT AREA's own surface, distinct from `background` (which covers the
    // margins too). `fill` paints behind the grid — the ggplot2 grey panel — and
    // `stroke` draws a frame around it. Both null: no panel node at all.
    panel: { fill: null, stroke: null, strokeWidth: 1 },

    // Inner padding of a band scale (the gap between bars), as a fraction of the
    // step. A channel's own `scale: { padding }` still wins. Flint calls the
    // complement `bandFraction` (bar width / step).
    bandPadding: 0.1,

    // Non-interactive annotation guides (guides/*) PLUS the per-part tokens an
    // edit's self-drawn guide reads (edit/guide.js — bounds / catchment / track).
    // Annotation literals keep the historical look; edit-guide parts merge under
    // GUIDE_PARTS defaults, then under a per-edit `guide: { … }` override.
    guide: {
        rule: { stroke: '#64748b', strokeDash: '5 4', strokeWidth: 1, opacity: 0.9 },
        region: { fill: '#64748b', opacity: 0.1 },
        // `currentStroke`/`currentWidth` ring the swatch(es) the target row(s)
        // currently hold, so a picker says what a click would REPLACE as well as
        // what it can set — and, by its absence, that there is nothing to write to.
        // That ring is the whole unarmed-state signal: a legend is a key first, so
        // it may not dim its own swatches to report a picker's state (their fill is
        // the encoding, and a faded key reports a colour the marks do not have).
        legend: {
            stroke: '#374151', labelFill: '#374151', fontSize: 11,
            currentStroke: '#111827', currentWidth: 2,
            // Swatch geometry: chip size and the gap between items (both px), and
            // the chip's corner radius — `swatchSize / 2` draws round chips.
            swatchSize: 14, gap: 6, swatchRadius: 0,
            // null renders the title at the label weight (measured as if bold).
            titleFontWeight: null,
        },
        // Edit-guide parts (resolveGuide). Colour falls back to theme.constraint.
        bounds: { dash: '4 4', width: 1, opacity: 0.9 },
        catchment: { dash: '2 4', width: 1, opacity: 0.45 },
        track: { dash: '3 3', width: 2, opacity: 0.35 },
    },

    // The constraint-guide colour (edit/guide.js). A per-edit
    // `guide: { color }` still wins.
    constraint: { color: '#e4572e' },

    // Interaction-effects defaults. Merged UNDER spec.effects by resolveEffects, so
    // a theme can restyle grab/select while a chart's own effects spec still wins.
    effects: DEFAULT_EFFECTS,

    // Ghost-preview styling (probe driver, Phase 2). A ghost node multiplies its
    // opacity by `opacity`; a non-null fill/stroke/strokeDash overrides the
    // committed mark's paint so the preview reads as tentative.
    ghost: { opacity: 0.45, fill: null, stroke: null, strokeDash: null },

    // Survey-instrument affordance tokens (widgets/theme.js). The historical
    // module-level THEME const, now injectable per-chart.
    widget: {
        accent: '#2563eb',      // a committed answer
        ring: '#cbd5e1',        // an empty option
        track: '#e2e8f0',
        cellFill: '#f8fafc',
        cellStroke: '#e2e8f0',
        label: '#334155',
        question: '#0f172a',
        labelSize: 12,
        questionSize: 13,
        radius: 11
    },

    // Sparse per-mark overrides, keyed by mark name. Empty by default — a mark's
    // own built-in fallback (passed to markDefaults) stands unless a theme fills a
    // slot here. e.g. `marks: { bar: { fill: 'crimson' } }`. Beyond the paint
    // channels, a few marks read a geometry default here too: `bar.rx` / `rect.rx`
    // (corner radius) and `point.size` (radius).
    marks: {}
};

/** Is `v` a plain object we should recurse into (vs. an array/Date/scale/null)?
 * @param {any} v */
function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * Deep-merge `over` onto `base`, recursing into plain objects only. Arrays and
 * scalars replace wholesale — a theme's `palette: [...]` swaps the array rather than
 * index-merging, and a token like `ink` is a plain overwrite. Neither input is
 * mutated.
 * @param {any} base
 * @param {any} over
 * @returns {any}
 */
export function deepMerge(base, over) {
    if (!isPlainObject(over)) return over === undefined ? base : over;
    const out = { ...base };
    for (const key of Object.keys(over)) {
        const b = base ? base[key] : undefined;
        const o = over[key];
        out[key] = isPlainObject(b) && isPlainObject(o) ? deepMerge(b, o) : (o === undefined ? b : o);
    }
    return out;
}

// The app-wide base, settable via setTheme(). A per-chart spec.theme layers over
// this, which layers over DEFAULT_THEME. Starts empty so DEFAULT_THEME is the
// baseline until an app opts in.
/** @type {import('../types').ThemeSpec} */
let globalTheme = {};

/**
 * Set the application-wide default theme (a partial, deep-merged over DEFAULT_THEME).
 * Every chart created afterwards picks it up unless it passes its own spec.theme,
 * which layers on top. Pass `null`/`{}` to reset to the built-in default.
 * @param {import('../types').ThemeSpec | null} [partial]
 */
export function setTheme(partial) {
    globalTheme = partial || {};
}

/**
 * Flatten a theme's `extends` chain into one partial. `extends` names a built-in
 * theme (a key of `themes`) to start from; the theme's own tokens deep-merge over
 * it. The idea and the word are Flint's (`ThemeSpec.extends`,
 * https://github.com/microsoft/flint-chart/blob/main/docs/theme-spec.md), where a
 * preset like `pop` is a remix of `swiss`. A bare string is shorthand for
 * `{ extends: name }`. An unknown name warns and contributes nothing, so a typo
 * shows the default look instead of throwing.
 * @param {any} user a partial theme, a theme name, or null
 * @param {number} [depth] cycle guard
 * @returns {any} a partial with no `extends` key
 */
function expandTheme(user, depth = 0) {
    if (user == null) return {};
    const t = typeof user === 'string' ? { extends: user } : user;
    if (t.extends == null) return t;
    const { extends: name, ...own } = t;
    /** @type {Record<string, any>} */
    const named = themes;
    const base = depth < 8 && Object.prototype.hasOwnProperty.call(named, name) ? named[name] : null;
    if (!base) {
        warn(`theme:unknown:${name}`, `theme "${name}" is not a built-in theme (${Object.keys(themes).join(', ')}); using the default look.`);
        return own;
    }
    return deepMerge(expandTheme(base, depth + 1), own);
}

/**
 * Resolve a chart's effective theme: DEFAULT_THEME < setTheme() base < spec.theme.
 * Either layer may be a built-in theme's NAME (`'dark'`, `'nyt'`) or a partial,
 * and a partial may `extends` a named theme.
 * @param {import('../types').ThemeSpec | null} [user]
 * @returns {import('../types').Theme}
 */
export function resolveTheme(user) {
    const withGlobal = deepMerge(DEFAULT_THEME, expandTheme(globalTheme));
    if (user == null) return withGlobal;
    return deepMerge(withGlobal, expandTheme(user));
}

/**
 * One axis token as it applies to an axis over `scale`: the `discrete` /
 * `continuous` override for that scale's kind, else the axis-wide token. Reads the
 * capability flag `kind`, never `scale.type`.
 * @param {import('../types').Theme} theme
 * @param {any} scale
 * @param {string} token
 * @returns {any}
 */
export function axisToken(theme, scale, token) {
    const axisTheme = /** @type {any} */ (theme.axis) || {};
    const kind = scale && scale.kind === 'continuous' ? 'continuous' : 'discrete';
    const over = axisTheme[kind];
    if (over && over[token] !== undefined) return over[token];
    return axisTheme[token];
}

/**
 * The theme a mark's build() can see: the engine stamps the resolved theme on the
 * scale map (the projection-transport pattern) so no build() signature changes.
 * Falls back to DEFAULT_THEME for a bare scale map (a mark unit-tested in isolation).
 * @param {any} scales
 * @returns {import('../types').Theme}
 */
export function themeOf(scales) {
    return (scales && scales.theme) || DEFAULT_THEME;
}

/**
 * A mark's default style object: its own built-in fallbacks, with any
 * `theme.marks[name]` overrides layered on top. The result is what the mark hands
 * to resolveStyle as `defaults`, so a per-datum channel still wins over both.
 * @param {any} scales
 * @param {string} name mark name, e.g. 'bar'
 * @param {Record<string, any>} fallbacks the mark's built-in defaults (may read theme tokens)
 * @returns {Record<string, any>}
 */
export function markDefaults(scales, name, fallbacks) {
    const t = themeOf(scales);
    const override = (t.marks && t.marks[name]) || {};
    return { ...fallbacks, ...override };
}
