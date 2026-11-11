// @ts-check
// Renderer-agnostic paint vocabulary shared by every renderer. A renderer's job
// is to turn typed FeatureNodes into pixels; WHAT a node can say (its curve, its
// style channels) is the same regardless of whether the pixels come from SVG
// attributes or canvas 2D calls. Keeping that vocabulary here is what lets a
// second renderer stay a faithful sibling of the first: adding a style channel is
// one row in STYLE_FIELDS and both renderers pick it up.
// The curve vocabulary and the path generators live in core/curves.js (marks
// build area paths with them too); re-exported here so a renderer keeps one
// import for its paint vocabulary.
export { CURVES, resolveCurve, lineGenerator, areaGenerator, definedPoint } from '../core/curves.js';

// The standard paint surface: the style channels every mark may set, with the SVG
// attribute name and base default for the DOM renderer. A canvas renderer reads
// `field` and maps it to a 2D-context property instead. ADDING A STYLE CHANNEL IS
// ONE ROW HERE — both renderers stay in step.
/** @type {{ field: string, svgAttr: string, base: any }[]} */
export const STYLE_FIELDS = [
    { field: 'fill', svgAttr: 'fill', base: null },
    { field: 'stroke', svgAttr: 'stroke', base: null },
    { field: 'strokeWidth', svgAttr: 'stroke-width', base: null },
    { field: 'strokeDasharray', svgAttr: 'stroke-dasharray', base: null },
    { field: 'strokeLinecap', svgAttr: 'stroke-linecap', base: null },
    { field: 'opacity', svgAttr: 'opacity', base: null },
    { field: 'fillOpacity', svgAttr: 'fill-opacity', base: null },
    { field: 'strokeOpacity', svgAttr: 'stroke-opacity', base: null }
];

/**
 * Partition scene nodes into paint layers. Role flags (`background`, `guide`,
 * `effect`) pin axes, edit guides, and interaction overlays; among ordinary
 * marks, **array order is z-order** (later features / nodes within a feature
 * paint on top). The engine has already settled that order — including a
 * glyph's parts, which group per row rather than per part (`paintOrder` in
 * core/scene.js) — so a renderer only has to preserve it.
 *
 * Paint stack (bottom → top):
 *   background → guideRegions → marks → chrome → guideFront → effects → effectsChrome
 *
 * Guide rects (shaded bands) stay behind marks; every other guide node (rules,
 * constraint ticks, labels) goes to `guideFront` in scene order so lines/text
 * aren't dropped. Interaction-effect overlays (`effect: true` — proximity ring,
 * select outline) always paint last, above marks and guides. Legend chips/ramps
 * use `background` (same layer as axes) so a non-interactive legend sits behind
 * marks without stealing hits.
 *
 * Under `clip` (the chart confines its marks to the plot rect), a mark or effect
 * node flagged `unclipped` — a chart element's chrome: an axis handle on the
 * plot edge, an interactive legend in the margin — goes to `chrome` /
 * `effectsChrome` instead, which the renderer paints above the clipped marks /
 * effects without the clip. Without `clip` both are empty, so an unclipped
 * chart's paint order is untouched.
 *
 * @param {any[]} children `scene.children`
 * @param {{ clip?: boolean }} [opts]
 * @returns {{
 *   background: any[],
 *   guideRegions: any[],
 *   marks: any[],
 *   chrome: any[],
 *   guideFront: any[],
 *   effects: any[],
 *   effectsChrome: any[]
 * }}
 */
export function partitionScene(children, opts = {}) {
    const clip = !!opts.clip;
    /** @type {any[]} */
    const background = [];
    /** @type {any[]} */
    const guideRegions = [];
    /** @type {any[]} */
    const marks = [];
    /** @type {any[]} */
    const guideFront = [];
    /** @type {any[]} */
    const effects = [];
    /** @type {any[]} */
    const chrome = [];
    /** @type {any[]} */
    const effectsChrome = [];

    for (const n of children || []) {
        if (!n) continue;
        // Effects win over guide/background: a select outline is also tagged
        // `guide` for the engine's guide pass, but it must paint on top.
        if (n.effect) {
            (clip && n.unclipped ? effectsChrome : effects).push(n);
            continue;
        }
        if (n.background) {
            background.push(n);
            continue;
        }
        if (n.guide) {
            // A guide rect is a shaded band behind the marks — unless it says
            // `front` (a tip's box, a readout's backing), which belongs above them.
            if (n.type === 'rect' && !n.front) guideRegions.push(n);
            else guideFront.push(n);
            continue;
        }
        (clip && n.unclipped ? chrome : marks).push(n);
    }
    return { background, guideRegions, marks, chrome, guideFront, effects, effectsChrome };
}

/**
 * Throttle a handler to one call per animation frame, keeping the LAST
 * arguments. For pointer tracking: a pointermove fires far more often than a
 * frame can paint, and every one would re-render the chart.
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @returns {F}
 */
export function frameThrottle(fn) {
    /** @type {any[] | null} */
    let pending = null;
    let scheduled = false;
    const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (/** @type {() => void} */ cb) => setTimeout(cb, 16);
    return /** @type {F} */ (/** @type {any} */ ((/** @type {any[]} */ ...args) => {
        pending = args;
        if (scheduled) return;
        scheduled = true;
        raf(() => {
            scheduled = false;
            const a = pending;
            pending = null;
            if (a) fn(...a);
        });
    }));
}

/**
 * The keys whose press or release can change what a `when` predicate answers
 * (`when.shift`, `when.alt`, …). A renderer re-reports the plane hover when one
 * changes under a still pointer, so the engine re-arbitrates without a move.
 */
export const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);
