// @ts-check
// axisRadial.js — a circular / semicircular axis as a CHART ELEMENT (sibling of
// axisX/axisY). It views the global `angle` SCALE (`views: 'scale'`), paints
// chrome (arc spine, ticks, labels, optional colored categorical bands), and is
// inert by default. Domain editing is out of scope — Cartesian edit.axis.* stays
// on linear axes.
//
//   elements.axisRadial({
//     orient: 'top',          // default: left → right through the top (NYT)
//     radius: 110, bands: true, ticks: 5,
//   })
//
// Placement exception: optional `channels.x` / `channels.y` (and `fill` for
// categorical bands) draw ONE RING PER ROW — small-multiple chrome around each
// needle. That is the one ChartElement that carries a channel map, and only for
// placement / band colour — not for encoding elicited columns the way a data
// mark does. It is `elicit.elements.axisRadial`, and only there.

import { positionOnScale, isDiscrete } from '../core/scales.js';
import { DEFAULT_PALETTE } from '../core/encoding.js';
import { encodeChannel, warnUnknownElementOptions, themeOf } from './mark.js';
import { tickData } from './axis.js';
import {
    arcSpan,
    arcSpine,
    arcPath,
    angularBand,
    polarToXY,
} from './polar.js';

/**
 * Horizontal text anchor for a label sitting at pixel `x` relative to the ring
 * centre `cx`: labels on the right grow rightward (`start`), on the left grow
 * leftward (`end`), near the vertical stay centred. Keeps long category names
 * (e.g. "VERY LIKELY D") from overflowing a centred anchor at the arc ends.
 * @param {number} x @param {number} cx @param {number} [eps]
 * @returns {'start' | 'middle' | 'end'}
 */
function anchorFor(x, cx, eps = 1) {
    if (x > cx + eps) return 'start';
    if (x < cx - eps) return 'end';
    return 'middle';
}

/** @type {string[]} */
export const AXIS_RADIAL_OPTIONS = [
    'channel', 'channels', 'radius', 'innerRadius', 'bandWidth', 'ticks', 'tickValues',
    'tickFormat', 'tickSize', 'labelOffset', 'bands', 'title', 'arc', 'orient',
    'start', 'end', 'labelFill', 'stroke', 'strokeWidth', 'fontSize',
];

/**
 * @param {any} [options]
 * @returns {import('../types').ChartElement}
 */
export function axisRadial(options = {}) {
    // Chart-element validation (no style-shorthand desugar). `channels` is the
    // documented placement exception for small-multiple rings — see header.
    warnUnknownElementOptions('axisRadial', options, AXIS_RADIAL_OPTIONS);
    const {
        channels = {},
        id,
        edits,
        channel = 'angle',
        radius: radiusOpt,
        innerRadius = 0,
        bandWidth = 18,
        ticks = 5,
        tickValues,
        tickFormat,
        tickSize = 6,
        labelOffset = 14,
        bands = false,
        title,
        arc: arcOpt,
        orient,
        start,
        end,
        // Chrome colours/size default to the theme's axis tokens at build time.
        labelFill: labelFillOpt,
        stroke: strokeOpt,
        strokeWidth = 1.25,
        fontSize: fontSizeOpt,
    } = options;

    const [spanStart, spanEnd] = arcSpan({ arc: arcOpt, orient, start, end });
    const xField = channels.x && channels.x.field;
    const yField = channels.y && channels.y.field;

    return {
        id,
        markName: 'axisRadial',
        channel,
        // Placement / band-colour only — see header. Not a data-mark channel map.
        channels,
        edits,
        isAxis: true,
        views: 'scale',
        layer: 'background',
        /**
         * @param {any[]} currentData
         * @param {any} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const scale = scales[channel];
            if (!scale) return [];

            // Resolve chrome from the theme (option overrides > theme.axis tokens).
            const thm = themeOf(scales);
            const labelFill = labelFillOpt ?? thm.axis.labelFill;
            const stroke = strokeOpt ?? thm.axis.stroke;
            const fontSize = fontSizeOpt ?? thm.axis.fontSize;

            // Prefer the scale's own range as the arc span when the author set one;
            // otherwise fall back to the mark's arc/start/end options.
            const range = typeof scale.range === 'function' ? scale.range() : null;
            let a0 = spanStart;
            let a1 = spanEnd;
            if (range && range.length >= 2 && typeof range[0] === 'number') {
                a0 = range[0];
                a1 = range[range.length - 1];
            }

            const bg = { background: true, pointerEvents: 'none' };
            const { values, format } = tickData(scale, { ticks, tickValues, tickFormat });
            const fillField = channels.fill && channels.fill.field;

            /**
             * Emit one radial axis (bands + spine + ticks + labels + title) about a
             * centre. Reused for the single centred axis and for the per-datum rings
             * that surround small-multiple needles.
             * @param {number} cx @param {number} cy @param {number} r
             * @returns {import('../types').FeatureNode[]}
             */
            const drawAxis = (cx, cy, r) => {
                /** @type {import('../types').FeatureNode[]} */
                const out = [];

                // Colored categorical / ordinal sectors.
                if (bands && isDiscrete(scale)) {
                    const domain = scale.domain();
                    domain.forEach((/** @type {any} */ v, /** @type {number} */ i) => {
                        const band = angularBand(scale, v);
                        if (!band) return;
                        const [lo, hi] = band;
                        const row = fillField ? { [fillField]: v } : {};
                        let fill = encodeChannel(scales, channels, 'fill', row, null);
                        // No fill channel declared -> a stable categorical palette (the
                        // same default an ordinal fill scale would produce).
                        if (fill == null) fill = DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
                        const inner = innerRadius > 0 ? innerRadius : Math.max(0, r - bandWidth);
                        const d = arcPath(cx, cy, r, lo, hi, { innerRadius: inner });
                        if (!d) return;
                        out.push({ type: 'path', d, fill, stroke: 'none', fillOpacity: 0.9, ...bg });
                    });
                }

                // Arc spine.
                const spine = arcSpine(cx, cy, r, a0, a1);
                if (spine) {
                    out.push({ type: 'path', d: spine, fill: 'none', stroke, strokeWidth, ...bg });
                }

                // Ticks + labels.
                values.forEach((/** @type {any} */ v) => {
                    const deg = positionOnScale(scale, v);
                    if (deg == null || Number.isNaN(deg)) return;
                    const outer = polarToXY(cx, cy, r, deg);
                    const inner = polarToXY(cx, cy, r - tickSize, deg);
                    if (tickSize > 0) {
                        out.push({
                            type: 'line',
                            x1: outer.x, y1: outer.y,
                            x2: inner.x, y2: inner.y,
                            stroke, strokeWidth: 1, ...bg,
                        });
                    }
                    const label = polarToXY(cx, cy, r + labelOffset, deg);
                    out.push({
                        type: 'text',
                        x: label.x,
                        y: label.y,
                        text: format(v),
                        textAnchor: anchorFor(label.x, cx),
                        dominantBaseline: 'middle',
                        fontSize,
                        fill: labelFill,
                        ...bg,
                    });
                });

                if (title) {
                    out.push({
                        type: 'text',
                        x: cx,
                        y: cy + r + labelOffset + fontSize + 8,
                        text: title,
                        textAnchor: 'middle',
                        fontSize: fontSize + 1,
                        fill: '#0f172a',
                        ...bg,
                    });
                }

                return out;
            };

            // Per-datum rings: when an x/y channel places pivots (small-multiple
            // needles), ring each one. Otherwise a single axis at the plot centre.
            if (xField || yField) {
                /** @type {import('../types').FeatureNode[]} */
                const nodes = [];
                const r = radiusOpt != null ? radiusOpt : Math.min(width, height) * 0.42;
                currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                    const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                    const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                    nodes.push(...drawAxis(cx, cy, r));
                });
                return nodes;
            }

            const cx = encodeChannel(scales, channels, 'x', currentData[0], width / 2, 0, currentData);
            const cy = encodeChannel(scales, channels, 'y', currentData[0], height / 2, 0, currentData);
            const r = radiusOpt != null ? radiusOpt : Math.min(width, height) * 0.42;
            return drawAxis(cx, cy, r);
        },
    };
}
