// @ts-check
import { ELEMENT_OPTIONS } from '../vocabulary.js';
// axisRadial.js — a circular / semicircular axis as a chart element. It draws the
// `theta` scale (polar angular position, not `angle`): arc spine, ticks, labels and
// optional categorical bands. With `channel: 'radius'` it draws concentric rings.
//
//   elements.axisRadial({
//     orient: 'top',          // default: left → right through the top (NYT)
//     radius: 110, bands: true, ticks: 5,
//   })
//
// The one element with a channel map: `channels.x` / `channels.y` draw one ring
// per row (around small-multiple needles), and `fill` colours the bands.

import { positionOnScale, isDiscrete } from '../core/scales.js';
import { DEFAULT_PALETTE } from '../core/encoding.js';
import { encodeChannel, warnUnknownElementOptions, themeOf } from './mark.js';
import { tickData } from './axis.js';
import { encodeOn } from './legend.js';
import { warn } from '../core/dev.js';
import {
    arcSpan,
    arcSpine,
    arcPath,
    angularBand,
    polarToXY,
} from './polar.js';

/**
 * Text anchor for a label at `x` about centre `cx`, so labels grow away from the
 * ring: `start` on the right, `end` on the left, `middle` near the vertical.
 * @param {number} x @param {number} cx @param {number} [eps]
 * @returns {'start' | 'middle' | 'end'}
 */
function anchorFor(x, cx, eps = 1) {
    if (x > cx + eps) return 'start';
    if (x < cx - eps) return 'end';
    return 'middle';
}

/** @type {string[]} */
export const AXIS_RADIAL_OPTIONS = ELEMENT_OPTIONS.axisRadial;

/**
 * @param {any} [options]
 * @returns {import('../types').ChartElement}
 */
export function axisRadial(options = {}) {
    warnUnknownElementOptions('axisRadial', options, AXIS_RADIAL_OPTIONS);
    const {
        channels = {},
        id,
        edits,
        channel = 'theta',
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
        type: 'axisRadial',
        channel,
        // Placement and band colour only (see header).
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
            // Chrome: the option, else the theme's axis token.
            const thm = themeOf(scales);
            const labelFill = labelFillOpt ?? thm.axis.labelFill;
            const stroke = strokeOpt ?? thm.axis.stroke;
            const fontSize = fontSizeOpt ?? thm.axis.fontSize;

            // A radius axis: concentric rings at the scale's ticks, labelled up the vertical.
            if (channel === 'radius') {
                if (radiusOpt != null) {
                    warn('axisRadial:radius:ignored', 'axisRadial({ channel: "radius" }) draws rings at the radius scale\'s own extent; its `radius` option is ignored.');
                }
                const bg = { background: true, pointerEvents: 'none' };
                const { values, format } = tickData(scale, { ticks, tickValues, tickFormat });
                const cx = encodeChannel(scales, channels, 'x', currentData[0], width / 2, 0, currentData);
                const cy = encodeChannel(scales, channels, 'y', currentData[0], height / 2, 0, currentData);
                /** @type {import('../types').FeatureNode[]} */
                const out = [];
                for (const v of values) {
                    const r = Number(encodeOn(scale, v));
                    if (!Number.isFinite(r) || r <= 0) continue;
                    out.push({ type: 'circle', cx, cy, r, fill: 'none', stroke, strokeWidth: 1, opacity: 0.6, ...bg });
                    out.push({ type: 'text', x: cx + 3, y: cy - r - 2, text: format(v), textAnchor: 'start', fill: labelFill, fontSize, ...bg });
                }
                if (title) {
                    out.push({ type: 'text', x: cx, y: cy - height / 2 + fontSize, text: title, textAnchor: 'middle', fill: labelFill, fontSize: fontSize + 1, ...bg });
                }
                return out;
            }

            // The scale's own range is the arc span; else the arc/start/end options.
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
             * One radial axis (bands, spine, ticks, labels, title) about a centre.
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
                        // No fill channel: the default categorical palette.
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
                        fill: labelFill,
                        ...bg,
                    });
                }

                return out;
            };

            // One ring per row when x/y place them; else one axis at the plot centre.
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
