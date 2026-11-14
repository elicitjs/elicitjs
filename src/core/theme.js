// @ts-check
// theme.js — the style layer: every default colour, font and affordance token the
// library draws with. A theme is data (no functions), so it deep-merges and a
// caller can override one token (`{ ink: 'crimson' }`) or a family. The engine
// resolves it once and stamps it on the scale map. Precedence, most specific first:
//
//   per-mark channel/option  >  theme.marks[name]  >  theme token  >  renderer base
//   spec.theme               >  setTheme() base    >  DEFAULT_THEME

import { DEFAULT_PALETTE, DEFAULT_RAMP, DEFAULT_DIVERGING } from './encoding.js';
import { DEFAULT_EFFECTS } from './effects.js';
import { themes } from './themes.js';
import { warn } from './dev.js';

/**
 * The built-in defaults. A new default must reproduce the existing look exactly;
 * changing a value restyles the whole library.
 * @type {import('../types').Theme}
 */
export const DEFAULT_THEME = {
    // The primary mark colour, the default ink of every mark.
    ink: 'steelblue',
    // Interactive emphasis: handles, a committed survey answer, an axis edit handle.
    accent: '#2563eb',
    // Secondary chrome / de-emphasised marks.
    muted: '#9ca3af',
    // Draggable-handle ink (resolveHandles in plot/mark.js), separate from `accent`.
    // `handleStroke` is the halo that keeps a handle legible on its own mark.
    handle: '#2563eb',
    handleStroke: '#fff',
    // The chart's backdrop: the CSS background of the svg/canvas, margins included.
    // null = transparent.
    background: null,

    // Colour scales fed to resolveScales when a channel names no explicit range or
    // scheme. Arrays replace wholesale on merge (they are values, not sub-objects).
    palette: DEFAULT_PALETTE,
    ramp: DEFAULT_RAMP,
    diverging: DEFAULT_DIVERGING,

    // Typography. A non-null `family` is set on the root svg (and the canvas) so
    // every label inherits it; null inherits the host page's font.
    font: { family: null, size: 10, labelSize: 12, titleSize: 13 },

    // Chart titles (core/titles.js). A null fill takes the axis label ink; a null
    // fontFamily inherits `font.family`.
    title: { fill: null, fontSize: 16, fontWeight: 600, fontFamily: null, fontStyle: null },
    subtitle: { fill: null, fontSize: 12, fontWeight: 'normal', fontFamily: null, fontStyle: null },
    caption: { fill: null, fontSize: 11, fontWeight: 'normal', fontFamily: null, fontStyle: null },

    // Chart chrome: spine/ticks (stroke), tick labels and title (labelFill), the
    // axis edit handle (handle). Every token is also an `axis()` option of the same
    // name, and the option wins. `discrete` / `continuous` override any token per
    // scale kind (Flint's `structure.axis.measure|categorical`).
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
        // A label's text-anchor; null is the side's own. `labelOffset` moves labels
        // along the axis (px). With a negative `tickPadding` these put labels inside
        // the plot.
        labelAlign: null,
        labelOffset: 0,
        // Per-kind overrides (any token above). Empty: both kinds look alike.
        discrete: {},
        continuous: {},
    },
    // Gridlines. `show` picks which implicit axes get a grid: 'none', 'value' (the
    // axis the value runs along), 'continuous', or 'all'. `zero` emphasises the line
    // at 0 (null, or `{ stroke, strokeWidth, strokeDash }`). `bandPosition` places a
    // band axis's gridlines at that fraction of each band (0 = between categories);
    // null is the centre.
    grid: { stroke: '#e5e7eb', strokeWidth: 1, strokeDash: null, opacity: null, show: 'none', zero: null, bandPosition: null },

    // The plot area's own surface (core/panel.js): `fill` behind the grid, `stroke`
    // a frame. Both null: no panel.
    panel: { fill: null, stroke: null, strokeWidth: 1 },

    // Inner padding of a band scale, as a fraction of the step. A channel's own
    // `scale: { padding }` wins.
    bandPadding: 0.1,

    // Annotation guides (guides/*) and the parts an edit's self-drawn guide reads
    // (edit/guide.js), merged under GUIDE_PARTS and a per-edit `guide: { … }`.
    guide: {
        rule: { stroke: '#64748b', strokeDash: '5 4', strokeWidth: 1, opacity: 0.9 },
        region: { fill: '#64748b', opacity: 0.1 },
        // `currentStroke`/`currentWidth` ring the swatch(es) the target row(s) hold:
        // the only picker-state signal. Never dim swatches; their fill is the encoding.
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

    // Effects defaults, merged under spec.effects by resolveEffects.
    effects: DEFAULT_EFFECTS,

    // Ghost-preview styling (probe driver): `opacity` multiplies; a non-null
    // fill/stroke/strokeDash overrides the mark's paint.
    ghost: { opacity: 0.45, fill: null, stroke: null, strokeDash: null },

    // Survey-instrument tokens (widgets/theme.js).
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

    // Sparse per-mark overrides keyed by mark name (`marks: { bar: { fill: 'crimson' } }`).
    // A few marks read geometry here too: `bar.rx`, `rect.rx`, `point.size`.
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

// The app-wide base set by setTheme(); spec.theme layers over it.
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
 * Flatten a theme's `extends` chain into one partial (Flint's `extends`). A bare
 * string means `{ extends: name }`. An unknown name warns and contributes nothing.
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
 * Either layer may be a built-in theme's name (`'dark'`, `'nyt'`) or a partial,
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
 * The theme a mark's build() sees, stamped on the scale map by the engine.
 * DEFAULT_THEME for a bare scale map (a mark tested in isolation).
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
