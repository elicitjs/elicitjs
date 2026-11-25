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
 * The box a node's `fillImage` is placed in: its own box, unrotated. A path
 * uses its outline `points`; one without them has no box (null).
 * @param {any} node
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function fillBox(node) {
    if (node.type === 'rect') return { x: node.x, y: node.y, width: Math.max(0, node.width), height: Math.max(0, node.height) };
    if (node.type === 'circle') {
        const r = Math.max(0, node.r != null ? node.r : 5);
        return { x: node.cx - r, y: node.cy - r, width: 2 * r, height: 2 * r };
    }
    if (node.type === 'ellipse') {
        const rx = Math.max(0, node.rx != null ? node.rx : 5);
        const ry = Math.max(0, node.ry != null ? node.ry : 5);
        return { x: node.cx - rx, y: node.cy - ry, width: 2 * rx, height: 2 * ry };
    }
    if (node.type === 'path') {
        const pts = (node.points || []).filter((/** @type {any} */ p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!pts.length) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }
    return null;
}

/**
 * Where a picture of `iw × ih` px lands in `box`, as CSS lays out an <img> or a
 * background image: one tile sized by `fit`, placed by `position`, and whether it
 * repeats on each axis. Every fit but 'fill' needs the picture's own size.
 * @param {import('../types').FillImage} pic
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {number} iw @param {number} ih
 * @returns {{ x: number, y: number, width: number, height: number, repeatX: boolean, repeatY: boolean }}
 */
export function imageLayout(pic, box, iw, ih) {
    let width = box.width, height = box.height;
    if (pic.fit !== 'fill' && iw > 0 && ih > 0) {
        const contain = Math.min(box.width / iw, box.height / ih);
        const k = pic.fit === 'cover' ? Math.max(box.width / iw, box.height / ih)
            : pic.fit === 'none' ? 1
                : pic.fit === 'scale-down' ? Math.min(1, contain)
                    : contain;
        width = iw * k;
        height = ih * k;
    }
    const [fx, fy] = pic.position || [0.5, 0.5];
    return {
        x: box.x + (box.width - width) * fx,
        y: box.y + (box.height - height) * fy,
        width,
        height,
        repeatX: pic.repeat === 'repeat' || pic.repeat === 'repeat-x',
        repeatY: pic.repeat === 'repeat' || pic.repeat === 'repeat-y',
    };
}

/**
 * Every tile of a layout that meets the box: the one tile, or its repeats.
 * A tile under 1px repeats nowhere.
 * @param {ReturnType<typeof imageLayout>} at
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @returns {{ x: number, y: number }[]}
 */
export function imageTiles(at, box) {
    /** @param {boolean} repeat @param {number} start @param {number} step @param {number} lo @param {number} hi */
    const along = (repeat, start, step, lo, hi) => {
        if (!repeat || !(step >= 1)) return [start];
        const out = [];
        for (let v = start - Math.ceil((start - lo) / step) * step; v < hi; v += step) out.push(v);
        return out;
    };
    const xs = along(at.repeatX, at.x, at.width, box.x, box.x + box.width);
    const ys = along(at.repeatY, at.y, at.height, box.y, box.y + box.height);
    return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

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
 * `cancel()` drops a pending call.
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @returns {F & { cancel: () => void }}
 */
export function frameThrottle(fn) {
    /** @type {any[] | null} */
    let pending = null;
    let scheduled = false;
    const raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (/** @type {() => void} */ cb) => setTimeout(cb, 16);
    const throttled = /** @type {any} */ ((/** @type {any[]} */ ...args) => {
        pending = args;
        if (scheduled) return;
        scheduled = true;
        raf(() => {
            scheduled = false;
            const a = pending;
            pending = null;
            if (a) fn(...a);
        });
    });
    throttled.cancel = () => { pending = null; };
    return throttled;
}

/**
 * Modifier keys a `when` predicate reads. A change re-reports the plane hover
 * so the engine re-arbitrates without a pointer move.
 */
export const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta']);

// Gesture thresholds in px, the same in every renderer.
// A press on a mark that moves no further than this is still a click.
export const CLICK_DISTANCE = 4;
// A press on the plane becomes a drag once it has moved further than this.
export const PLANE_DRAG_THRESHOLD = 3;
// A finger wobbles more than a mouse: a touch press is a tap until it moves this far.
export const TOUCH_TAP_DISTANCE = 10;

/**
 * How far a press may move and still be a tap (mark click) or not yet a drag
 * (plane), by what pressed.
 * @param {string | undefined} pointerType
 * @param {number} mouse the threshold for a mouse or pen
 * @returns {number}
 */
export function tapDistance(pointerType, mouse) {
    return pointerType === 'touch' ? Math.max(mouse, TOUCH_TAP_DISTANCE) : mouse;
}

/**
 * Does this device have a touch screen? The SVG renderer draws touch targets
 * then. `any-pointer`, so a laptop with a touch screen counts.
 * @returns {boolean}
 */
export function hasTouch() {
    return typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
}

/**
 * A wheel event's deltas in px, whatever unit the browser reports them in.
 * @param {any} event
 * @returns {{ deltaX: number, deltaY: number }}
 */
export function wheelDelta(event) {
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    return { deltaX: (event.deltaX || 0) * unit, deltaY: (event.deltaY || 0) * unit };
}
