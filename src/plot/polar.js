// @ts-check
// polar.js — shared polar geometry for needle, axisRadial, and arc marks.
// Marks still emit Cartesian scene nodes (path / line / circle / text); these
// helpers turn (degrees, radius) into SVG coordinates. Math convention: 0° = +x,
// counterclockwise, y-up — then flipped into SVG's y-down space.

import { isBand, isDiscrete } from '../core/scales.js';

/**
 * @param {number} deg
 * @returns {number}
 */
export function degToRad(deg) {
    return (deg * Math.PI) / 180;
}

/**
 * Pixel point at radius `r` and math-degrees `deg` about (cx, cy).
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} deg
 * @returns {{ x: number, y: number }}
 */
export function polarToXY(cx, cy, r, deg) {
    const a = degToRad(deg);
    return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

/**
 * Named semicircle orientations (math degrees, 0° = +x, CCW). The arc sits on
 * the named side; the open side faces the opposite way — NYT gauges use `top`.
 * @type {Record<string, [number, number]>}
 */
export const ORIENT_SPAN = {
    top: [180, 0],       // left → top → right (default semi; opens down)
    right: [-90, 90],    // bottom → right → top (opens left)
    bottom: [0, -180],   // right → bottom → left (opens up)
    left: [90, 270],     // top → left → bottom (opens right)
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
export function arcSpan(opts = {}) {
    if (opts.start != null && opts.end != null) return [opts.start, opts.end];
    if (opts.arc === 'full') return [-180, 180];
    if (opts.orient && ORIENT_SPAN[opts.orient]) return ORIENT_SPAN[opts.orient];
    // Default semi = top (NYT / dashboard / speedometer left→right).
    return ORIENT_SPAN.top;
}

/**
 * Signed sweep from startDeg to endDeg, normalized to [-360, 360]. The direction
 * is kept as given (scale.range order), not the shorter arc.
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {number}
 */
function sweepDegrees(startDeg, endDeg) {
    let sweep = endDeg - startDeg;
    // Keep ±360 so a full circle stays a full circle.
    while (sweep > 360) sweep -= 360;
    while (sweep < -360) sweep += 360;
    return sweep;
}

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
export function arcPath(cx, cy, outerRadius, startDeg, endDeg, opts = {}) {
    const inner = opts.innerRadius || 0;
    const sweep = sweepDegrees(startDeg, endDeg);
    if (Math.abs(sweep) < 1e-6 || outerRadius <= 0) return '';

    // A full ±360° arc has coinciding endpoints — SVG can't draw it as one A.
    // Split into two half-sweeps.
    if (Math.abs(Math.abs(sweep) - 360) < 1e-6) {
        const mid = startDeg + sweep / 2;
        const a = arcPath(cx, cy, outerRadius, startDeg, mid, opts);
        const b = arcPath(cx, cy, outerRadius, mid, endDeg, opts);
        // Merge two closed sectors into one compound path (both close to centre / inner).
        return `${a} ${b}`.trim();
    }

    const svgSweep = sweep >= 0 ? 0 : 1;
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;

    const o0 = polarToXY(cx, cy, outerRadius, startDeg);
    const o1 = polarToXY(cx, cy, outerRadius, endDeg);

    if (inner <= 0) {
        return [
            `M ${cx} ${cy}`,
            `L ${o0.x} ${o0.y}`,
            `A ${outerRadius} ${outerRadius} 0 ${largeArc} ${svgSweep} ${o1.x} ${o1.y}`,
            'Z'
        ].join(' ');
    }

    const i0 = polarToXY(cx, cy, inner, startDeg);
    const i1 = polarToXY(cx, cy, inner, endDeg);
    const innerSweep = svgSweep === 0 ? 1 : 0;
    return [
        `M ${o0.x} ${o0.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArc} ${svgSweep} ${o1.x} ${o1.y}`,
        `L ${i1.x} ${i1.y}`,
        `A ${inner} ${inner} 0 ${largeArc} ${innerSweep} ${i0.x} ${i0.y}`,
        'Z'
    ].join(' ');
}

/**
 * SVG path `d` for a stroked arc (spine only — no pie fill).
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} startDeg
 * @param {number} endDeg
 * @returns {string}
 */
export function arcSpine(cx, cy, radius, startDeg, endDeg) {
    const sweep = sweepDegrees(startDeg, endDeg);
    if (Math.abs(sweep) < 1e-6 || radius <= 0) return '';
    if (Math.abs(Math.abs(sweep) - 360) < 1e-6) {
        const mid = startDeg + sweep / 2;
        return `${arcSpine(cx, cy, radius, startDeg, mid)} ${arcSpine(cx, cy, radius, mid, endDeg)}`.trim();
    }
    const o0 = polarToXY(cx, cy, radius, startDeg);
    const o1 = polarToXY(cx, cy, radius, endDeg);
    const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
    const svgSweep = sweep >= 0 ? 0 : 1;
    return `M ${o0.x} ${o0.y} A ${radius} ${radius} 0 ${largeArc} ${svgSweep} ${o1.x} ${o1.y}`;
}

/**
 * Angular interval [lo, hi] in degrees for one category on an angle scale
 * (band → band edges; point → midpoints between neighbours; continuous → null).
 * @param {any} scale
 * @param {any} value
 * @returns {[number, number] | null}
 */
export function angularBand(scale, value) {
    if (!scale || !isDiscrete(scale)) return null;
    const domain = scale.domain();
    if (!domain.length) return null;

    if (isBand(scale)) {
        const start = scale(value);
        if (start == null) return null;
        return [start, start + scale.bandwidth()];
    }

    // point: boundaries halfway to neighbours and to the range ends. Keep the
    // range's direction (no min/max): a span of [180, 0] is descending.
    const range = scale.range();
    const start = range[0];
    const end = range[range.length - 1];
    const i = domain.indexOf(value);
    if (i < 0) return null;
    const centers = domain.map((/** @type {any} */ v) => scale(v));
    const lo = i === 0 ? start : (centers[i - 1] + centers[i]) / 2;
    const hi = i === domain.length - 1 ? end : (centers[i] + centers[i + 1]) / 2;
    return [lo, hi];
}

/**
 * Triangle vertices for a tapered needle pointing at `deg`.
 * @param {number} cx
 * @param {number} cy
 * @param {number} length
 * @param {number} deg
 * @param {number} [baseWidth]
 * @returns {[number, number][]}
 */
export function needleTriangle(cx, cy, length, deg, baseWidth = 10) {
    const tip = polarToXY(cx, cy, length, deg);
    const half = baseWidth / 2;
    const left = polarToXY(cx, cy, half, deg + 90);
    const right = polarToXY(cx, cy, half, deg - 90);
    return [
        [tip.x, tip.y],
        [left.x, left.y],
        [right.x, right.y]
    ];
}
