// @ts-check
// curve.js — a segment that BENDS. A tick draws a straight line between two
// points; a curve draws the same span bowed off its chord by an amount that is
// itself a channel, so "how much does this bend, and which way" becomes an
// elicited number: a mouth's smile, an annotation's arc, a preference curve's
// convexity, a flow's deflection.
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
// ── The channels ────────────────────────────────────────────────────────────
// `curvature` is dimensionless: the apex's offset from the chord as a fraction
// of the HALF-chord, so 0 is a straight segment and ±1 bows out by half the
// span's length. It scales with the chord, which is what keeps a glyph's curve
// proportional when the glyph resizes. Sign: POSITIVE bows to the LEFT of travel
// from the first endpoint to the second (rightward chord bows up, downward chord
// bows right). Which way "more" should bend is the author's, and it belongs on
// the scale — `scale: { range: [0.6, -0.6] }` maps a rising field to a deepening
// ∪ rather than a rising ∩.
//
// `angle` tilts the whole curve about its chord midpoint, in math degrees. It is
// baked into the GEOMETRY rather than left on the node, because neither renderer
// rotates a `path` (see FeatureNode.angle) — and a curve that can't tilt loses
// the one gesture that distinguishes it from a bent tick.
//
// `curveY` spans x and is positioned on y; `curveX` spans y and is positioned on
// x; bare `curve` reads the declared channels (a y1/y2 pair means curveX). The
// span comes from the `x1`/`x2` (or `y1`/`y2`) endpoint pair, or from a centre
// channel plus a `length` in px.
//
// ── Two nodes ───────────────────────────────────────────────────────────────
// A stroked curve is a few pixels wide and would be nearly impossible to grab,
// so the mark emits its visible path plus a fat transparent HIT path over the
// same geometry. The hit path also carries a sampled `points` polyline, because
// the pick layer measures distance along `points` and cannot hit a `d`-only path
// at all (that is how a canvas-rendered curve would otherwise be undraggable).
// Both stamp `cx`/`cy` at the chord midpoint so `markCenter` — and therefore
// `slide`'s track and `rotate`'s pivot — resolve on a path mark.
//
// The hit path leaves `pointerEvents` unset ON PURPOSE: the engine silences a
// mark with no direct-pick edit, so an inert curve can't swallow a sibling
// handle's drag, while an editable one gets the pointer back automatically.

import {
    encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions,
    themeOf, markDefaults, positionalKeys, markCommon,} from './mark.js';

// How many segments the hit polyline samples the quadratic into. Enough that the
// straight-line error is well under the hit stroke's own width at any curvature.
const HIT_SAMPLES = 16;
// Minimum grab width for the invisible hit path, in px.
const HIT_WIDTH = 16;

/**
 * A point rotated about a pivot by `deg` MATH degrees (CCW, y-up), which in
 * screen space (y-down) is a clockwise rotation of the same magnitude — the same
 * convention `FeatureNode.angle` and the renderers' rotate(-deg) use.
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
 * Sample a quadratic Bézier into a polyline, for the pick layer.
 * @param {[number, number]} p1 @param {[number, number]} c @param {[number, number]} p2
 * @returns {[number, number][]}
 */
function sampleQuadratic(p1, c, p2) {
    /** @type {[number, number][]} */
    const pts = [];
    for (let i = 0; i <= HIT_SAMPLES; i++) {
        const t = i / HIT_SAMPLES;
        const u = 1 - t;
        pts.push([
            u * u * p1[0] + 2 * u * t * c[0] + t * t * p2[0],
            u * u * p1[1] + 2 * u * t * c[1] + t * t * p2[1],
        ]);
    }
    return pts;
}

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedSpanAxis which axis the chord runs along
 * @returns {import('../types').Mark}
 */
function buildCurve(options, forcedSpanAxis) {
    const opts = normalizeMarkOptions(options, { mark: 'curve', allow: ['length'] });
    const { channels = {}, id, edits, constraints, length } = opts;
    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'curve',
        channels,
        // A curve sits on a tick, not in an interval — it marks a position, and its
        // span is stated by its own endpoint channels.
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
            // The chord runs along x unless the spec says (or shows) otherwise: a
            // declared y1/y2 pair is a vertical span.
            const spanAxis = forcedSpanAxis
                || (channels.y1 && channels.y2 ? 'y' : 'x');
            const valueAxis = spanAxis === 'x' ? 'y' : 'x';
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
                // Unit normal to the LEFT of travel (rotate the chord direction a
                // quarter turn CCW in math space / CW on screen).
                const nx = dy / chord;
                const ny = -dx / chord;

                const curvature = encodeChannel(scales, channels, 'curvature', d, 0, i, currentData);
                // The apex sits `curvature` half-chords off the chord; a quadratic
                // passes through the midpoint between chord and control, so the
                // control point is twice as far out as the apex.
                const apex = (curvature || 0) * (chord / 2);
                /** @type {[number, number]} */
                let c = [mid.cx + nx * apex * 2, mid.cy + ny * apex * 2];

                // Tilt is baked in — neither renderer rotates a path node.
                const angle = encodeAngle(scales, channels, d, 0, i, currentData);
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
 * A bending segment; the chord runs along x unless a y1/y2 pair says otherwise.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curve(options = {}) {
    return buildCurve(options, null);
}

/**
 * A curve spanning x, positioned on y (a mouth, a horizontal arc).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curveY(options = {}) {
    return buildCurve(options, 'x');
}

/**
 * A curve spanning y, positioned on x (a vertical bow / bracket).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function curveX(options = {}) {
    return buildCurve(options, 'y');
}
