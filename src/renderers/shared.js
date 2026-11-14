// @ts-check
// Paint vocabulary shared by the SVG and canvas renderers.
// Curves and path generators live in core/curves.js; re-exported for one import.
export { CURVES, resolveCurve, lineGenerator, areaGenerator, definedPoint } from '../core/curves.js';

// Style channels every mark may set, with their SVG attribute. The canvas
// renderer maps `field` to a 2D-context property. A new style channel is one row here.
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
 * Partition scene nodes into paint layers. Within a layer, array order is
 * z-order; the engine has already settled it (`paintOrder` in core/scene.js).
 *
 * Paint stack (bottom → top):
 *   background → guideRegions → marks → chrome → guideFront → effects → effectsChrome
 *
 * Guide rects sit behind marks unless `front`; other guide nodes go above.
 * Under `clip`, `unclipped` nodes go to `chrome` / `effectsChrome`, painted
 * without the clip.
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
        // Effects win over guide: a select outline is also tagged `guide`.
        if (n.effect) {
            (clip && n.unclipped ? effectsChrome : effects).push(n);
            continue;
        }
        if (n.background) {
            background.push(n);
            continue;
        }
        if (n.guide) {
            // A guide rect is a band behind the marks unless it is `front` (a tip's box).
            if (n.type === 'rect' && !n.front) guideRegions.push(n);
            else guideFront.push(n);
            continue;
        }
        (clip && n.unclipped ? chrome : marks).push(n);
    }
    return { background, guideRegions, marks, chrome, guideFront, effects, effectsChrome };
}

/**
 * Throttle a handler to one call per animation frame, keeping the last arguments.
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
 * Modifier keys a `when` predicate reads. A change re-reports the plane hover
 * so the engine re-arbitrates without a pointer move.
 */
export const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);
