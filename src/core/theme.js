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

    // Chart chrome. Axis spine/ticks (stroke), tick labels + title (labelFill), the
    // edit handle on a draggable axis (handle). Grid lines are separate.
    axis: { stroke: '#6b7280', labelFill: '#374151', fontSize: 10, handle: '#2563eb' },
    grid: { stroke: '#e5e7eb', strokeWidth: 1 },

    // Non-interactive annotation guides (guides/*) PLUS the per-part tokens an
    // edit's self-drawn guide reads (edit/guide.js — bounds / catchment / track).
    // Annotation literals keep the historical look; edit-guide parts merge under
    // GUIDE_PARTS defaults, then under a per-edit `guide: { … }` override.
    guide: {
        rule: { stroke: '#64748b', strokeDasharray: '5 4' },
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
        },
        // Edit-guide parts (resolveGuide). Colour falls back to theme.constraint.
        bounds: { dash: '4 4', width: 1, opacity: 0.9 },
        catchment: { dash: '2 4', width: 1, opacity: 0.45 },
        track: { dash: '3 3', width: 2, opacity: 0.35 },
    },

    // The constraint-guide colour (edit/guide.js). Per-edit `guide: { color }` /
    // legacy `guideColor` still wins.
    constraint: { color: '#e4572e' },

    // Interaction-effects defaults. Merged UNDER spec.effects by resolveEffects, so
    // a theme can restyle grab/select while a chart's own effects spec still wins.
    effects: DEFAULT_EFFECTS,

    // Ghost-preview styling (probe driver, Phase 2). A ghost node multiplies its
    // opacity by `opacity`; a non-null fill/stroke/strokeDasharray overrides the
    // committed mark's paint so the preview reads as tentative.
    ghost: { opacity: 0.45, fill: null, stroke: null, strokeDasharray: null },

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
    // slot here. e.g. `marks: { bar: { fill: 'crimson' } }`.
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
/** @type {import('../types').DeepPartial<import('../types').Theme>} */
let globalTheme = {};

/**
 * Set the application-wide default theme (a partial, deep-merged over DEFAULT_THEME).
 * Every chart created afterwards picks it up unless it passes its own spec.theme,
 * which layers on top. Pass `null`/`{}` to reset to the built-in default.
 * @param {import('../types').DeepPartial<import('../types').Theme> | null} [partial]
 */
export function setTheme(partial) {
    globalTheme = partial || {};
}

/**
 * Resolve a chart's effective theme: DEFAULT_THEME < setTheme() base < spec.theme.
 * A string names a built-in theme; an object is a partial that deep-merges.
 * @param {import('../types').DeepPartial<import('../types').Theme> | string} [user]
 * @returns {import('../types').Theme}
 */
export function resolveTheme(user) {
    const withGlobal = deepMerge(DEFAULT_THEME, globalTheme);
    if (user == null) return withGlobal;
    // A string is resolved by the caller (index.js exposes `themes`); here it is
    // already an object by the time the engine calls us. Guard anyway.
    if (typeof user === 'string') return withGlobal;
    return deepMerge(withGlobal, user);
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
