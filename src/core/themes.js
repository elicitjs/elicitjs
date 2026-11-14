// @ts-check
// themes.js — the built-in named themes (`elicit.themes`). Each is a partial theme
// deep-merged over DEFAULT_THEME, named by object, by string, or via `extends`:
//
//   Elicit({ ...spec, theme: themes.nyt })
//   Elicit({ ...spec, theme: 'nyt' })
//   Elicit({ ...spec, theme: { extends: 'nyt', ink: 'crimson' } })
//   setTheme('economist')   // make it the app-wide default
//
// `default`, `survey`, `dark` and `dd` are ElicitJS's own. The other fourteen are
// the house styles of Flint (https://github.com/microsoft/flint-chart, MIT),
// transcribed in Flint's vocabulary and translated by `fromFlint`. What ElicitJS
// cannot draw (data labels, chart furniture, axis placement, conditional variants)
// is left out and noted on the preset.

/** Flint's type-size tokens, in px. These follow Flint's ordering (100 is the
 *  axis-label size), not its exact values. */
const TYPE_SIZE = { 'text.100': 11, 'text.200': 13, 'text.300': 16, 'text.400': 20, 'text.500': 24 };
/** Flint's `TypeWeight` names, as CSS font-weights. */
const TYPE_WEIGHT = { regular: 'normal', medium: 500, semibold: 600, bold: 'bold' };
/** Flint's `tickLength`, in px. */
const TICK_LENGTH = { short: 4, medium: 6, long: 8 };
/** Flint's `Presence`, as a stroke width multiplier (`omit` draws nothing). */
const PRESENCE_WIDTH = { hairline: 0.5, quiet: 1, full: 1, emphasised: 2 };

/** @param {any} s a Flint size token or px */
const sizeOf = (s) => (typeof s === 'number' ? s : s ? /** @type {any} */ (TYPE_SIZE)[s] : undefined);
/** @param {any} w a Flint weight name or number */
const weightOf = (w) => (w == null ? undefined : /** @type {any} */ (TYPE_WEIGHT)[w] ?? w);
/** Flint's point `size` is an area in px²; an ElicitJS `size` is a radius.
 *  @param {number} area */
const radiusOf = (area) => Math.round(Math.sqrt(area / Math.PI) * 10) / 10;

/** Drop undefined keys, so an `extends` chain never blanks its base's tokens.
 * @param {Record<string, any>} o */
function defined(o) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
    return out;
}

/**
 * Flint `AxisRole` → the per-kind axis tokens.
 * @param {any} role `{ line, lineWeight, ticks, tickLength, labelGap }`
 */
function axisRole(role) {
    if (!role) return undefined;
    return defined({
        line: role.line == null ? undefined : role.line !== 'omit',
        strokeWidth: role.lineWeight ?? (role.line === 'emphasised' ? 2 : undefined),
        tickSize: role.ticks == null ? undefined
            : role.ticks === 'omit' ? 0 : TICK_LENGTH[/** @type {'short'|'medium'|'long'} */ (role.tickLength || 'medium')],
        tickPadding: role.labelGap,
    });
}

/**
 * Translate one Flint preset (in Flint's vocabulary) into an ElicitJS partial theme.
 * @param {any} f
 * @returns {import('../types').DeepPartial<import('../types').Theme> & { extends?: string }}
 */
function fromFlint(f) {
    const text = f.text || {};
    const structure = f.structure || {};
    const type = f.type || {};
    const series = f.series || {};
    const grid = f.grid || {};
    const marks = f.marks || {};
    const family = type.family;
    /** @param {any} role @param {string} [fallbackFill] */
    const typeRole = (role, fallbackFill) => role ? defined({
        fill: role.color ?? fallbackFill,
        fontSize: sizeOf(role.size),
        fontWeight: weightOf(role.weight),
        fontFamily: role.family,
        fontStyle: role.style,
    }) : undefined;

    // Which axes a gridline runs on, from Flint's `grid.measure` / `grid.category`.
    const on = (/** @type {any} */ p) => p != null && p !== 'omit';
    const show = grid.show ?? (grid.measure == null && grid.category == null ? undefined
        : on(grid.category) ? 'all' : on(grid.measure) ? 'value' : 'none');
    const gridPresence = on(grid.measure) ? grid.measure : grid.category;
    // The emphasised line at zero: Flint's `grid.zero`, else its bar `baseline`.
    const zeroSpec = grid.zero ?? f.baseline;
    const zero = zeroSpec == null ? undefined
        : zeroSpec === 'omit' ? null
            : {
                stroke: structure.zero || structure.axis || text.primary,
                strokeWidth: (typeof zeroSpec === 'object' ? zeroSpec.weight : undefined)
                    ?? PRESENCE_WIDTH[/** @type {'full'} */ (typeof zeroSpec === 'object' ? zeroSpec.presence : zeroSpec)] ?? 1,
                strokeDash: null,
            };

    // A dark outline on every filled mark (Flint `marks.outline`, source 'ink').
    const outline = marks.outline ? { stroke: text.primary, strokeWidth: marks.outline.weight } : {};
    const rx = marks.cornerRadius;
    const pointSize = marks.pointSize != null ? radiusOf(marks.pointSize) : undefined;
    const markOverrides = defined({
        bar: rx != null || marks.outline ? defined({ rx, ...outline }) : undefined,
        rect: marks.outline ? outline : undefined,
        point: pointSize != null || marks.outline ? defined({ size: pointSize, ...outline }) : undefined,
        line: marks.strokeWeight != null ? { strokeWidth: marks.strokeWeight } : undefined,
        area: marks.strokeWeight != null ? { strokeWidth: marks.strokeWeight } : undefined,
    });

    // Hover and selection outline in the house's primary text colour.
    const effects = text.primary ? {
        hovered: { outline: { color: text.primary } },
        selected: { outline: { color: text.primary } },
    } : undefined;

    return defined({
        extends: f.extends,
        background: f.surface,
        ink: series.single,
        accent: f.accent,
        handle: f.accent,
        muted: text.muted,
        palette: series.categorical,
        ramp: series.sequential,
        diverging: series.diverging,
        bandPadding: marks.bandFraction != null ? Math.round((1 - marks.bandFraction) * 100) / 100 : undefined,
        font: family || type.axisLabel ? defined({
            family,
            size: sizeOf(type.axisLabel && type.axisLabel.size),
        }) : undefined,
        title: typeRole(type.headline, text.primary),
        subtitle: typeRole(type.deck, text.secondary),
        caption: typeRole(type.footnote, text.muted),
        axis: defined({
            stroke: structure.axis,
            labelFill: (type.axisLabel && type.axisLabel.color) || text.secondary,
            fontSize: sizeOf(type.axisLabel && type.axisLabel.size),
            handle: f.accent,
            titleFill: (type.axisTitle && type.axisTitle.color) || undefined,
            titleFontSize: sizeOf(type.axisTitle && type.axisTitle.size),
            titleFontWeight: weightOf(type.axisTitle && type.axisTitle.weight),
            discrete: axisRole(f.axis && f.axis.categorical),
            continuous: axisRole(f.axis && f.axis.measure),
        }),
        grid: defined({
            stroke: structure.grid,
            strokeWidth: grid.weight ?? (gridPresence ? PRESENCE_WIDTH[/** @type {'full'} */ (gridPresence)] : undefined),
            strokeDash: grid.style === 'dashed' ? '4 4' : grid.style === 'dotted' ? '1 3' : grid.style ? null : undefined,
            show,
            zero,
        }),
        guide: defined({
            rule: structure.rule ? { stroke: structure.rule } : undefined,
            // Flint's keys draw a chip with no outline.
            legend: defined({
                stroke: 'none',
                labelFill: text.secondary,
                swatchRadius: f.legend && f.legend.swatch === 'circle' ? 7 : undefined,
            }),
        }),
        constraint: series.negative ? { color: series.negative } : undefined,
        effects,
        widget: defined({
            accent: f.accent,
            ring: structure.grid,
            track: structure.grid,
            cellFill: f.surface || undefined,
            cellStroke: structure.grid,
            label: text.secondary,
            question: text.primary,
        }),
        marks: Object.keys(markOverrides).length ? markOverrides : undefined,
    });
}

// ----------------------------------------------------------------- Flint presets
// Transcribed from Flint's presets. `palette` is Flint's `categoricalExtended` where
// the preset has one, so a chart with many series keeps the house colours.

/** `nyt` — "New York Times": newsroom graphics. A serif headline that states the
 *  finding over sans-serif labels; no value-axis spine or ticks; a quiet value grid
 *  and a full rule at zero. (Flint also prints values on the marks and names series
 *  at their line ends; those are layout, not theme tokens, here.) */
const nyt = fromFlint({
    surface: null,
    text: { primary: '#121212', secondary: '#6b6b6b', muted: '#8a8a8a' },
    structure: { grid: '#e4e4e4', axis: '#121212', rule: '#121212' },
    series: {
        single: '#2f6b9a',
        categorical: ['#2f6b9a', '#c2352b', '#4a8b6f', '#7f6a9e', '#d9a441', '#e27ea6', '#3fae9e', '#9ca13a', '#8c6d31', '#6b8fb3', '#d07b3a', '#b5546a'],
        sequential: ['#eef4f8', '#c2d8e7', '#8bb0cf', '#5187b3', '#2f6b9a', '#1c4363'],
        diverging: ['#2f6b9a', '#8fb4cc', '#efece5', '#dd9a86', '#c2352b'],
        negative: '#c2352b',
    },
    accent: '#c2352b',
    type: {
        family: 'Helvetica, Arial, sans-serif',
        headline: { family: 'Georgia, serif', size: 'text.400', weight: 'bold', color: '#121212' },
        deck: { family: 'Georgia, serif', size: 'text.200', color: '#6b6b6b' },
        axisLabel: { size: 'text.100' },
    },
    axis: {
        categorical: { line: 'full', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid', zero: 'full' },
    marks: { bandFraction: 0.72, strokeWeight: 2.4, pointSize: 58 },
});

/** `economist` — "The Economist": the print weekly. Compact; a flat bold headline
 *  over a deck that names the measure; a categorical spine, no value spine; a blue-
 *  grey grid and a dark zero rule. (Flint's red tab at the top-left, and its value
 *  axis on the right, are furniture and placement this port does not draw.) */
const economist = fromFlint({
    surface: null,
    text: { primary: '#121317', secondary: '#54585a', muted: '#8b9196' },
    structure: { grid: '#c9d3da', axis: '#121317', rule: '#c9d3da', zero: '#121317' },
    series: {
        single: '#006ba2',
        categorical: ['#006ba2', '#3ebcd2', '#ebb434', '#379a8b', '#9a3d5b', '#a17ba5'],
        sequential: ['#dcebf2', '#a7ccdd', '#6ba7c6', '#2f88ae', '#006ba2', '#003f5c'],
        diverging: ['#006ba2', '#7ba7b8', '#e9e5dc', '#c8967a', '#a1655a'],
        negative: '#e3120b',
    },
    accent: '#e3120b',
    type: {
        family: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        headline: { size: 'text.300', weight: 'bold' },
        deck: { size: 'text.200', color: '#54585a' },
        axisLabel: { size: 11 },
        axisTitle: { size: 11, weight: 'regular', color: '#54585a' },
    },
    axis: {
        categorical: { line: 'full', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid', zero: 'full' },
    marks: { bandFraction: 0.68, strokeWeight: 1.6, pointSize: 66 },
});

/** `swiss` — International Typographic Style: warm paper, black structural axes
 *  with short outward ticks on the value axis, a bold flush-left Helvetica
 *  headline, one signal red. No rounded corners, no gradients, no ornament. */
const swiss = fromFlint({
    surface: '#f4f1ea',
    text: { primary: '#1a1a1a', secondary: '#555555', muted: '#8a8a8a' },
    structure: { grid: '#d9d5cc', axis: '#1a1a1a', rule: '#1a1a1a' },
    series: {
        single: '#e2231a',
        categorical: ['#e2231a', '#1a1a1a', '#0067a5', '#f2b705', '#2a7f4f', '#e06d1f', '#5b4b8a', '#1f8a8a', '#b5195f', '#8a8a2a', '#5a6b78', '#8a5a2a'],
        sequential: ['#fbe3df', '#f4a19a', '#eb6a5f', '#e2231a', '#9e120c'],
        diverging: ['#0067a5', '#7fb2d6', '#efeae0', '#ef9a90', '#e2231a'],
        negative: '#e2231a',
    },
    accent: '#e2231a',
    type: {
        family: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        headline: { size: 'text.400', weight: 'bold' },
        deck: { size: 'text.200', color: '#555555' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100', weight: 'bold', color: '#1a1a1a' },
    },
    axis: {
        categorical: { line: 'full', ticks: 'omit' },
        measure: { line: 'full', ticks: 'full', tickLength: 'short' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid', zero: 'full' },
    marks: { bandFraction: 0.7, strokeWeight: 3, pointSize: 52 },
});

/** `nature` — the journal figure: small, black, Arial; full axis spines with long
 *  outward ticks on both axes and NO gridlines; Okabe–Ito colours. (Flint also
 *  prints fit statistics in the panel and adds shape as a redundant channel.) */
const nature = fromFlint({
    surface: null,
    text: { primary: '#000000', secondary: '#000000' },
    structure: { axis: '#000000', grid: '#00000000' },
    series: {
        single: '#0072b2',
        categorical: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#332288', '#117733', '#882255', '#88ccee', '#999933'],
        sequential: ['#e6f0f7', '#b3d3e8', '#79b0d5', '#3a8fc4', '#0072b2', '#00436a'],
        diverging: ['#0072b2', '#83b9db', '#ffffff', '#eba06a', '#d55e00'],
    },
    accent: '#000000',
    type: {
        family: 'Arial, Helvetica, sans-serif',
        headline: { size: 'text.200', weight: 'bold' },
        deck: { size: 'text.100', style: 'italic' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100' },
    },
    axis: {
        categorical: { line: 'full', ticks: 'full', tickLength: 'long' },
        measure: { line: 'full', ticks: 'full', tickLength: 'long' },
    },
    grid: { measure: 'omit', category: 'omit' },
    marks: { bandFraction: 0.55, strokeWeight: 1.2, pointSize: 45 },
});

/** `mckinsey` — the consulting deck: no axes, no gridlines, a near-black primary
 *  over electric blues, wide bands, and a baseline. (Flint prints every value in a
 *  column; that is data-label layout, not a theme token, here.) */
const mckinsey = fromFlint({
    surface: null,
    text: { primary: '#051c2c', secondary: '#5a6872', muted: '#8a969d' },
    structure: { axis: '#051c2c', rule: '#d3dce1', grid: '#d3dce1' },
    series: {
        single: '#051c2c',
        categorical: ['#051c2c', '#2251ff', '#00a9f4', '#00cfb4', '#8c9ba5', '#7c5cff', '#0e7c8b', '#6fb7e8', '#b39ddb', '#3d4f66'],
        sequential: ['#eef3f8', '#cfdcea', '#9db8d2', '#5b82ab', '#051c2c'],
        diverging: ['#2251ff', '#9db8d2', '#eef3f8', '#d98f6a', '#b4472e'],
    },
    accent: '#2251ff',
    type: {
        family: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        headline: { size: 'text.300', weight: 'bold' },
        deck: { size: 'text.200' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'omit', category: 'omit' },
    baseline: 'full',
    marks: { bandFraction: 0.7, strokeWeight: 2, pointSize: 72 },
});

/** `datawrapper` — the embedded web chart: Roboto, a plain headline and
 *  description, a light solid value grid, no axis lines, and a dark baseline. */
const datawrapper = fromFlint({
    surface: null,
    text: { primary: '#181818', secondary: '#747474', muted: '#888888' },
    structure: { grid: '#e7e7e7', rule: '#d8d8d8', axis: '#181818' },
    series: {
        single: '#18a1cd',
        categorical: ['#18a1cd', '#c71e1d', '#fa8c00', '#09bb9f', '#15607a', '#009076', '#ffca76', '#1d81a2', '#00dca6', '#c4c4c4', '#ffe59c'],
        sequential: ['#d3eef8', '#9cd6ec', '#5bbbe0', '#18a1cd', '#15607a'],
        diverging: ['#15607a', '#719aae', '#e8e8e8', '#ff6954', '#c71e1d'],
        negative: '#c71e1d',
    },
    accent: '#18a1cd',
    type: {
        family: "Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif",
        headline: { size: 22, weight: 'bold', color: '#000000' },
        deck: { size: 14, color: '#181818' },
        axisLabel: { size: 12 },
        footnote: { size: 11, color: '#888888' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'full', category: 'omit', style: 'solid' },
    baseline: { presence: 'full', weight: 1 },
    marks: { bandFraction: 0.65, pointSize: 48 },
});

/** `powerbi` — the dark dashboard tile: Segoe UI on a near-black canvas, a quiet
 *  value grid, no axis lines, softly rounded bars. Its sequential ramp runs dim to
 *  bright, so a higher value is brighter. */
const powerbi = fromFlint({
    surface: '#1b1a19',
    text: { primary: '#f3f2f1', secondary: '#c8c6c4', muted: '#a19f9d' },
    structure: { grid: '#5a5856', axis: '#3b3a39', rule: '#3b3a39' },
    series: {
        single: '#118dff',
        categorical: ['#118dff', '#e66c37', '#3bd1c7', '#e044a7', '#d9b300', '#8764b8', '#d64550', '#4a9c2d', '#6677d9', '#b146c2', '#ff9d3b', '#25797f'],
        sequential: ['#123049', '#0f4c86', '#1170c9', '#3f9dff', '#7bbcff', '#c9e3ff'],
        diverging: ['#118dff', '#5aa9f0', '#4a4948', '#e08a4a', '#d64550'],
        negative: '#e66c37',
    },
    accent: '#118dff',
    type: {
        family: "'Segoe UI', system-ui, sans-serif",
        headline: { size: 'text.200', weight: 'semibold', color: '#f3f2f1' },
        axisLabel: { size: 'text.100', color: '#c8c6c4' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid' },
    marks: { strokeWeight: 2.2, pointSize: 62, cornerRadius: 3 },
});

/** `powerbiLight` — Flint's `powerbi-light`: the same tile on a white canvas with a
 *  hairline grid. */
const powerbiLight = fromFlint({
    surface: '#ffffff',
    text: { primary: '#252423', secondary: '#605e5c', muted: '#a19f9d' },
    structure: { grid: '#ededed', axis: '#d2d0ce', rule: '#d2d0ce' },
    series: {
        single: '#118dff',
        categorical: ['#118dff', '#12239e', '#e66c37', '#6b007b', '#e044a7', '#744ec2', '#d9b300', '#d64550', '#197278', '#5c2e91', '#ff9d3b', '#4a9c2d'],
        sequential: ['#e5f1ff', '#b3d7ff', '#7bbcff', '#3f9dff', '#118dff', '#0a5cb5'],
        diverging: ['#118dff', '#7bb8f5', '#e1dfdd', '#e59866', '#d64550'],
        negative: '#d13438',
    },
    accent: '#118dff',
    type: {
        family: "'Segoe UI', system-ui, sans-serif",
        headline: { size: 'text.200', weight: 'semibold', color: '#252423' },
        axisLabel: { size: 'text.100', color: '#605e5c' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid' },
    marks: { strokeWeight: 2.2, pointSize: 62, cornerRadius: 3 },
});

/** `pop` — a pop-art remix of `swiss` (it `extends` it, as in Flint): electric
 *  process colours on yellow, heavy black structure, thick outlines around every
 *  filled mark, oversized marks and Arial Black. Its palette is its own six; past
 *  that a chart wraps (Flint falls through to Swiss's extended set). */
const pop = fromFlint({
    extends: 'swiss',
    surface: '#fff200',
    text: { primary: '#111111', secondary: '#5f0047', muted: '#8c0068' },
    structure: { axis: '#111111', grid: '#111111', rule: '#111111' },
    series: {
        single: '#ff1493',
        categorical: ['#ff1493', '#00d9ff', '#ff5a1f', '#7a3cff', '#00c853', '#111111'],
        sequential: ['#00d9ff', '#7a3cff', '#ff1493', '#ff5a1f', '#fff200'],
        diverging: ['#00d9ff', '#7a3cff', '#fff200', '#ff5a1f', '#ff1493'],
        negative: '#ff1493',
    },
    accent: '#ff1493',
    type: {
        family: "'Arial Black', Arial, sans-serif",
        headline: { family: "'Arial Black', 'Helvetica Neue', Arial, sans-serif", size: 'text.500', weight: 'bold' },
        deck: { size: 'text.200', weight: 'bold', color: '#5f0047' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100', weight: 'bold' },
    },
    axis: {
        categorical: { line: 'emphasised', lineWeight: 3, ticks: 'omit', labelGap: 7 },
        measure: { line: 'emphasised', lineWeight: 3, ticks: 'full', tickLength: 'long', labelGap: 7 },
    },
    grid: { measure: 'quiet', category: 'hairline', style: 'solid', weight: 1, zero: 'emphasised' },
    marks: { bandFraction: 0.84, strokeWeight: 6, pointSize: 180, outline: { weight: 3 } },
});

/** `cartoon` — a playful comic house: cream paper, a rounded comic face, fat dark
 *  "sticker" outlines, bright crayon colours, rounded bar corners, chunky lines and
 *  a soft dashed grid. (Flint draws only the parts a theme owns — no hand wobble.) */
const cartoon = fromFlint({
    surface: '#fffdf5',
    text: { primary: '#2e2b28', secondary: '#8a837a', muted: '#b3aa9c' },
    structure: { grid: '#ece5d6', axis: '#2e2b28', rule: '#2e2b28' },
    series: {
        single: '#3aa9ff',
        categorical: ['#3aa9ff', '#ff5d5d', '#ffc23c', '#4cc76a', '#9b6cff', '#ff8a3d', '#2ec4c4', '#ff77b7', '#7bd23a', '#ffd84a', '#6c8cff', '#c96a2a'],
        sequential: ['#fff2cc', '#ffd98a', '#ffb14a', '#ff8a3d', '#ff5d5d'],
        diverging: ['#3aa9ff', '#8fc9ff', '#f2ead8', '#ffb0a0', '#ff5d5d'],
        negative: '#ff5d5d',
    },
    accent: '#ff5d5d',
    type: {
        family: "'Comic Sans MS', 'Comic Neue', 'Chalkboard SE', 'Marker Felt', cursive",
        headline: { size: 'text.400', weight: 'bold' },
        deck: { size: 'text.200', color: '#8a837a' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100', weight: 'bold', color: '#2e2b28' },
    },
    axis: {
        categorical: { line: 'full', lineWeight: 2.5, ticks: 'omit', labelGap: 7 },
        measure: { line: 'full', lineWeight: 2.5, ticks: 'omit', labelGap: 7 },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'dashed', weight: 1.5 },
    marks: { bandFraction: 0.62, strokeWeight: 5, cornerRadius: 10, pointSize: 170, outline: { weight: 2.5 } },
});

/** `apple` — a quiet app-interface chart in the system colours: no axis lines or
 *  ticks, a hairline value grid, light labels, rounded bars. */
const apple = fromFlint({
    surface: '#ffffff',
    text: { primary: '#000000', secondary: '#8a8a8e', muted: '#aeaeb2' },
    structure: { axis: '#8a8a8e', grid: '#d1d1d6', rule: '#c6c6c8', zero: '#8a8a8e' },
    series: {
        single: '#007aff',
        categorical: ['#007aff', '#34c759', '#ff9500', '#af52de', '#ff3b30', '#32ade6', '#5856d6', '#ff2d55', '#00c7be', '#a2845e', '#30b0c7', '#ffcc00'],
        sequential: ['#d6e9ff', '#7ab8ff', '#007aff', '#0055b3', '#003a7a'],
        diverging: ['#0055b3', '#7ab8ff', '#f2f2f7', '#ff9f97', '#d70015'],
        negative: '#ff3b30',
    },
    accent: '#007aff',
    type: {
        family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
        headline: { family: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif", size: 'text.300', weight: 'semibold' },
        deck: { size: 'text.200', color: '#8a8a8e' },
        axisLabel: { size: 'text.100' },
        axisTitle: { size: 'text.100' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit', labelGap: 6 },
        measure: { line: 'omit', ticks: 'omit', labelGap: 6 },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid', weight: 0.5, zero: 'quiet' },
    marks: { bandFraction: 0.6, strokeWeight: 2, cornerRadius: 4, pointSize: 40 },
});

/** `deStijl` — Flint's `de-stijl`, after Neo-Plasticism: red, yellow and blue on
 *  off-white, bounded by heavy black lines; horizontals and verticals only; Futura
 *  in italic for the title. The heavy grid runs on value axes only — Flint's own
 *  variant drops it on a banded axis so a bar is never cut in two. */
const deStijl = fromFlint({
    surface: '#f4f1e8',
    text: { primary: '#121212', secondary: '#4a4945', muted: '#7c7a73' },
    structure: { axis: '#121212', grid: '#121212', rule: '#121212', zero: '#121212' },
    series: {
        single: '#d40f0f',
        categorical: ['#d40f0f', '#1f4a94', '#f5c400', '#121212', '#a9a69d', '#e6a08f', '#8ea3c4', '#e8d58a', '#5a5853', '#8f2318', '#17305e', '#cfcbc0'],
        sequential: ['#e9e4d6', '#f5c400', '#d40f0f', '#1f4a94', '#121212'],
        diverging: ['#1f4a94', '#8ea3c4', '#e9e4d6', '#e6a08f', '#d40f0f'],
        negative: '#d40f0f',
    },
    accent: '#d40f0f',
    type: {
        family: "Futura, 'Avenir Next', 'Century Gothic', 'Helvetica Neue', Arial, sans-serif",
        headline: { size: 'text.300', weight: 'medium', style: 'italic', color: '#121212' },
        deck: { size: 'text.100', color: '#4a4945' },
        axisLabel: { size: 'text.100', color: '#4a4945' },
        axisTitle: { size: 'text.100', color: '#4a4945' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit', labelGap: 8 },
        measure: { line: 'omit', ticks: 'omit', labelGap: 8 },
    },
    // Both axes, as in Flint — but only where they are continuous, which is
    // Flint's own variant for a banded axis.
    grid: { measure: 'full', category: 'full', show: 'continuous', weight: 3, zero: 'full' },
    marks: { bandFraction: 0.82, strokeWeight: 4, cornerRadius: 0, pointSize: 110 },
});

/** `bbc` — BBC News graphics as drawn by the bbplot package: a large bold headline,
 *  light horizontal gridlines, no axis lines or titles, a heavy rule at zero.
 *  Flint's palette is four colours. (The footer rule and source credit are
 *  furniture this port does not draw.) */
const bbc = fromFlint({
    surface: '#ffffff',
    text: { primary: '#222222', secondary: '#222222', muted: '#555555' },
    structure: { grid: '#cbcbcb', axis: '#333333', zero: '#333333', rule: '#333333' },
    series: {
        single: '#1380a1',
        categorical: ['#1380A1', '#FAAB18', '#990000', '#588300'],
        sequential: ['#FDE725', '#5EC962', '#21918C', '#3B528B', '#440154'],
    },
    accent: '#1380A1',
    type: {
        family: "'BBC Reith Sans', Helvetica, Arial, sans-serif",
        headline: { size: 22, weight: 'bold', color: '#222222' },
        deck: { size: 17, weight: 'regular', color: '#222222' },
        axisLabel: { size: 14, color: '#222222' },
        axisTitle: { size: 14, color: '#222222' },
        footnote: { size: 12, color: '#222222' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit' },
        measure: { line: 'omit', ticks: 'omit' },
    },
    grid: { measure: 'quiet', category: 'omit', style: 'solid', weight: 1, zero: 'emphasised' },
    marks: { bandFraction: 0.9, strokeWeight: 2, pointSize: 40 },
});

/** `material` — Material Design 3 read as a chart house: a purple-led tonal palette,
 *  Google Sans for the title and Roboto for labels, outline-variant gridlines, no
 *  axis lines, bars rounded to the M3 shape scale, round legend chips. */
const material = fromFlint({
    surface: '#FFFBFE',
    text: { primary: '#1D1B20', secondary: '#49454F', muted: '#79747E' },
    structure: { axis: '#79747E', grid: '#CAC4D0', rule: '#CAC4D0', zero: '#79747E' },
    series: {
        single: '#6750A4',
        categorical: ['#6750A4', '#00696E', '#E8A600', '#B3261E', '#0B57D0', '#146C2E', '#7D5260', '#625B71', '#B69DF8', '#4FD8EB', '#FFB4AB', '#A8C7FA'],
        sequential: ['#EADDFF', '#B69DF8', '#7F67BE', '#4F378B', '#21005D'],
        diverging: ['#0B57D0', '#A8C7FA', '#F4EFF4', '#F2B8B5', '#B3261E'],
        negative: '#B3261E',
    },
    accent: '#6750A4',
    type: {
        family: "'Google Sans Text', Roboto, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        headline: { family: "'Google Sans', 'Google Sans Text', Roboto, system-ui, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif", size: 'text.400', weight: 'medium', color: '#1D1B20' },
        deck: { size: 'text.200', weight: 'regular', color: '#49454F' },
        axisLabel: { size: 'text.100', color: '#49454F' },
        axisTitle: { size: 'text.100', weight: 'medium', color: '#49454F' },
        footnote: { size: 'text.100', color: '#79747E' },
    },
    axis: {
        categorical: { line: 'omit', ticks: 'omit', labelGap: 8 },
        measure: { line: 'omit', ticks: 'omit', labelGap: 8 },
    },
    grid: { measure: 'full', category: 'omit', style: 'solid', weight: 1, zero: 'quiet' },
    marks: { bandFraction: 0.7, strokeWeight: 2, cornerRadius: 4, pointSize: 36 },
    legend: { swatch: 'circle' },
});

/** The Data & Dialogue Lab palette (`themes.dd`, `scheme: 'dd'`). `teal` and `blue`
 *  are the two logo colours; every other hue is chosen to sit beside them. Each hue
 *  has a `*Dark` partner for the stroke that goes with it. */
export const DD = {
    teal: '#50AEB7', tealDark: '#37919B',
    blue: '#2B5D87', blueDark: '#1D4467',
    coral: '#EE7B5E', coralDark: '#CC5B3F',
    gold: '#F2B94B', goldDark: '#C99128',
    violet: '#8A78C0', violetDark: '#6B5AA2',
    leaf: '#7DB86B', leafDark: '#5C9A4B',
    rose: '#D9638A', roseDark: '#B8446B',
    slate: '#8497A8', slateDark: '#64788A',
    // Blue-tinted neutrals, light to dark.
    grey50: '#F6F9FB', grey100: '#EAF0F4', grey200: '#D9E2E9', grey300: '#BCC9D4',
    grey400: '#94A5B3', grey500: '#6F8294', grey600: '#46596B', grey900: '#14283A',
    categorical: ['#50AEB7', '#2B5D87', '#EE7B5E', '#F2B94B', '#8A78C0', '#7DB86B', '#D9638A', '#8497A8'],
    sequential: ['#E6F4F5', '#A6D6DB', '#50AEB7', '#2F7F9E', '#2B5D87', '#173553'],
    diverging: ['#2B5D87', '#7FB1CB', '#F5F3EE', '#F4B49E', '#D8593B']
};

/** @type {Record<import('../types').ThemeName, import('../types').DeepPartial<import('../types').Theme> & { extends?: string }>} */
export const themes = {
    // The identity theme — resolves to DEFAULT_THEME unchanged.
    default: {},

    // A Qualtrics-flavoured survey look: neutral chrome, an indigo accent, softer
    // type. Restyles the widgets too.
    survey: {
        ink: '#4f46e5',
        accent: '#4f46e5',
        muted: '#94a3b8',
        font: {
            family: '"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            size: 11,
            labelSize: 13,
            titleSize: 15
        },
        axis: { stroke: '#cbd5e1', labelFill: '#475569', fontSize: 11, handle: '#4f46e5' },
        grid: { stroke: '#f1f5f9', strokeWidth: 1 },
        constraint: { color: '#e11d48' },
        widget: {
            accent: '#4f46e5',
            ring: '#cbd5e1',
            track: '#e2e8f0',
            cellFill: '#f8fafc',
            cellStroke: '#e2e8f0',
            label: '#475569',
            question: '#1e293b',
            labelSize: 13,
            questionSize: 15,
            radius: 12
        }
    },

    // Dark mode: a slate backdrop (`background`) with light ink and chrome, so it
    // reads on a dark page without host CSS.
    dark: {
        background: '#0f172a',
        ink: '#38bdf8',
        accent: '#38bdf8',
        muted: '#64748b',
        axis: { stroke: '#475569', labelFill: '#cbd5e1', fontSize: 10, handle: '#38bdf8' },
        grid: { stroke: '#1e293b' },
        guide: {
            rule: { stroke: '#94a3b8', strokeDash: '5 4' },
            region: { fill: '#94a3b8', opacity: 0.14 },
            legend: { stroke: '#cbd5e1', labelFill: '#cbd5e1', fontSize: 11 }
        },
        constraint: { color: '#fb7185' },
        widget: {
            accent: '#38bdf8',
            ring: '#334155',
            track: '#1e293b',
            cellFill: '#1e293b',
            cellStroke: '#334155',
            label: '#cbd5e1',
            question: '#f1f5f9',
            labelSize: 12,
            questionSize: 13,
            radius: 11
        }
    },

    // Data & Dialogue Lab: teal ink, blue accent, coral and gold contrast hues,
    // blue-tinted neutrals. No stroke by default; a stroke is the hue's `*Dark` partner.
    dd: {
        ink: DD.teal,
        accent: DD.blue,
        muted: DD.grey400,
        handle: DD.blue,
        handleStroke: '#fff',
        palette: DD.categorical,
        ramp: DD.sequential,
        diverging: DD.diverging,
        axis: { stroke: DD.grey300, labelFill: DD.grey600, fontSize: 10, handle: DD.blue },
        grid: { stroke: DD.grey100 },
        bandPadding: 0.22,
        guide: {
            rule: { stroke: DD.grey400, strokeDash: '5 4' },
            region: { fill: DD.blue, opacity: 0.08 },
            legend: { stroke: DD.grey600, labelFill: DD.grey600, fontSize: 11, currentStroke: DD.grey900, swatchRadius: 3 }
        },
        constraint: { color: DD.coral },
        // Hover and selection keep the `color: 'auto'` trace; only the drop target
        // is fixed, in the lab's blue.
        effects: {
            target: { outline: { color: DD.blue, width: 2.5, pad: 3, opacity: 0.9 } }
        },
        marks: { bar: { rx: 3 }, rect: { rx: 2 } },
        widget: {
            accent: DD.blue,
            ring: DD.grey200,
            track: DD.grey100,
            cellFill: DD.grey50,
            cellStroke: DD.grey200,
            label: DD.grey600,
            question: DD.grey900,
            labelSize: 12,
            questionSize: 13,
            radius: 11
        }
    },

    // Flint's fourteen house styles (see the header).
    nyt,
    economist,
    swiss,
    nature,
    mckinsey,
    datawrapper,
    powerbi,
    powerbiLight,
    pop,
    cartoon,
    apple,
    deStijl,
    bbc,
    material,
};
