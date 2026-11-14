// @ts-check
// curve.js — a segment bowed off its chord by a `curvature` channel, so the bend
// is an elicited number (a mouth's smile, an annotation's arc).
//
//   curveY({
//     channels: {
//       x1: { datum: -0.36, scale: 'frame' },
//       x2: { datum:  0.36, scale: 'frame' },
//       y:  { datum: -0.34, scale: 'frame' },
//       curvature: { field: 'valence', scale: { range: [0.6, -0.6] },
//                    edit: slide({ axis: 'y', increase: 'up' }) },
//       angle: { field: 'smirk', scale: { type: 'frame', range: [-15, 15] } },
//     }
//   })
//
// `curvature` is the apex's offset from the chord as a fraction of the
// half-chord: 0 is straight, positive bows to the left of travel from the first
// endpoint to the second. `angle` tilts the curve about its chord midpoint and is
// baked into the path (renderers don't rotate paths).
//
// `curveY` spans x and sits on y; `curveX` spans y and sits on x; bare `curve`
// reads the declared channels. The span is an endpoint pair, or a centre channel
// plus `length` in px.
//
// Emits the visible path plus a wide transparent hit path with sampled `points`
// (see hitpath.js). Both carry `cx`/`cy` at the chord midpoint. The hit path
// leaves `pointerEvents` unset so the engine decides.

import {
    encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions,
    themeOf, markDefaults, positionalKeys, markCommon, resolveValueAxis, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { HIT_WIDTH, sampleQuadratic } from './hitpath.js';

/**
 * A point rotated about a pivot by `deg` math degrees (CCW, y-up), the same
 * convention as `FeatureNode.angle`.
 * @param {[number, number]} p
 * @param {{ cx: number, cy: number }} pivot
 * @param {number} deg
 * @returns {[number, number]}
 */
function rotatePoint(p, pivot, deg) {
    if (!deg) return p;
    const rad = (-deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = p[0] - pivot.cx;
    const dy = p[1] - pivot.cy;
    return [pivot.cx + dx * cos - dy * sin, pivot.cy + dx * sin + dy * cos];
}

/**
 * A bending segment; the chord runs along x unless a y1/y2 pair says otherwise.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curve(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'curve', allow: MARK_OPTIONS.curve });
    const { channels = {}, length } = opts;
    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        type: 'curve',
        channels,
        // A curve sits on a tick, not in an interval.
        discreteScale: 'point',
        xKey,
        yKey,

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            // A declared endpoint pair is the chord; a lone x or y is its centre.
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation, extent: 'span', single: 'other' });
            const spanAxis = valueAxis === 'x' ? 'y' : 'x';
            const spanFull = spanAxis === 'x' ? width : height;
            const valueFull = valueAxis === 'x' ? width : height;

            const defaults = markDefaults(scales, 'curve', {
                fill: 'none',
                stroke: themeOf(scales).ink,
                strokeWidth: 2,
            });

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            currentData.forEach((d, i) => {
                // No curve for a row missing any bound positional value.
                if (['x', 'y', 'x1', 'x2', 'y1', 'y2'].some((c) => missingValue(channels, c, d))) return;
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const at = encodeChannel(scales, channels, valueAxis, d, valueFull / 2, i, currentData);

                // The chord's two ends: an explicit endpoint pair, else a `length`
                // centred on the span axis' own channel.
                let a, b;
                if (channels[`${spanAxis}1`] && channels[`${spanAxis}2`]) {
                    a = encodeChannel(scales, channels, `${spanAxis}1`, d, spanFull * 0.25, i, currentData);
                    b = encodeChannel(scales, channels, `${spanAxis}2`, d, spanFull * 0.75, i, currentData);
                } else {
                    const centre = encodeChannel(scales, channels, spanAxis, d, spanFull / 2, i, currentData);
                    const half = (length != null ? length : Math.min(width, height) * 0.25) / 2;
                    a = centre - half;
                    b = centre + half;
                }

                /** @type {[number, number]} */
                let p1 = spanAxis === 'x' ? [a, at] : [at, a];
                /** @type {[number, number]} */
                let p2 = spanAxis === 'x' ? [b, at] : [at, b];

                const mid = { cx: (p1[0] + p2[0]) / 2, cy: (p1[1] + p2[1]) / 2 };
                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const chord = Math.hypot(dx, dy) || 1;
                // Unit normal to the left of travel.
                const nx = dy / chord;
                const ny = -dx / chord;

                const curvature = encodeChannel(scales, channels, 'curvature', d, 0, i, currentData);
                // A quadratic's apex is halfway to its control point, so the
                // control sits at twice the apex offset.
                const apex = (curvature || 0) * (chord / 2);
                /** @type {[number, number]} */
                let c = [mid.cx + nx * apex * 2, mid.cy + ny * apex * 2];

                // Tilt is baked in — neither renderer rotates a path node.
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                if (angle) {
                    p1 = rotatePoint(p1, mid, angle);
                    p2 = rotatePoint(p2, mid, angle);
                    c = rotatePoint(c, mid, angle);
                }

                const path = `M ${p1[0]} ${p1[1]} Q ${c[0]} ${c[1]} ${p2[0]} ${p2[1]}`;
                const points = sampleQuadratic(p1, c, p2);

                nodes.push({
                    type: 'path',
                    d: path,
                    cx: mid.cx,
                    cy: mid.cy,
                    ...style,
                    data: d,
                    index: i,
                    // Chrome: the affordance is the hit path below, drawn over it.
                    pointerEvents: 'none',
                });
                nodes.push({
                    type: 'path',
                    d: path,
                    points,
                    cx: mid.cx,
                    cy: mid.cy,
                    fill: 'none',
                    stroke: 'transparent',
                    strokeWidth: Math.max(HIT_WIDTH, (style.strokeWidth || 2) * 6),
                    data: d,
                    index: i,
                    cursor: 'grab',
                });
            });
            return nodes;
        }
    };
}

/**
 * A curve spanning x, positioned on y (a mouth, a horizontal arc).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curveY(options = {}) {
    return curve({ ...options, orientation: 'vertical' });
}

/**
 * A curve spanning y, positioned on x (a vertical bow / bracket).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curveX(options = {}) {
    return curve({ ...options, orientation: 'horizontal' });
}
