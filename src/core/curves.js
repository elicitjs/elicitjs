// @ts-check
// curves.js — the curve vocabulary and the line/area path generators built on it.
// Unknown names fall back to linear. A missing value (null/NaN) breaks the path.
// An area generates top and bottom edges together so the curve runs the same
// direction on both.
import * as d3 from 'd3';

/** @type {Record<string, any>} */
export const CURVES = {
    linear: d3.curveLinear,
    catmullRom: d3.curveCatmullRom,
    natural: d3.curveNatural,
    step: d3.curveStep,
    stepAfter: d3.curveStepAfter,
    stepBefore: d3.curveStepBefore,
    basis: d3.curveBasis,
    cardinal: d3.curveCardinal,
    monotoneX: d3.curveMonotoneX,
    monotoneY: d3.curveMonotoneY
};

/**
 * @param {string} [name]
 * @returns {any}
 */
export function resolveCurve(name) {
    return (name && CURVES[name]) || d3.curveLinear;
}

/** @param {any} v @returns {boolean} */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Is a `[x, y]` point drawable? A null entry, or a non-finite coordinate, is a
 * gap.
 * @param {any} p
 * @returns {boolean}
 */
export function definedPoint(p) {
    return !!p && finite(p[0]) && finite(p[1]);
}

/**
 * A `d3.line` over `[x, y]` points with this curve, breaking at undefined points.
 * Call `.context(ctx)` for canvas, or invoke it for an SVG `d`.
 * @param {string} [curve]
 * @returns {any}
 */
export function lineGenerator(curve) {
    return d3.line().defined(definedPoint).curve(resolveCurve(curve));
}

/**
 * A `d3.area` over `{ x, y0, y1 }` samples (or `{ y, x0, x1 }` for a horizontal
 * band, when `horizontal` is set) with this curve, breaking at undefined samples.
 * @param {string} [curve]
 * @param {boolean} [horizontal]
 * @returns {any}
 */
export function areaGenerator(curve, horizontal = false) {
    const c = resolveCurve(curve);
    if (horizontal) {
        return d3.area()
            .defined((/** @type {any} */ s) => !!s && finite(s.y) && finite(s.x0) && finite(s.x1))
            .y((/** @type {any} */ s) => s.y)
            .x0((/** @type {any} */ s) => s.x0)
            .x1((/** @type {any} */ s) => s.x1)
            .curve(c);
    }
    return d3.area()
        .defined((/** @type {any} */ s) => !!s && finite(s.x) && finite(s.y0) && finite(s.y1))
        .x((/** @type {any} */ s) => s.x)
        .y0((/** @type {any} */ s) => s.y0)
        .y1((/** @type {any} */ s) => s.y1)
        .curve(c);
}
