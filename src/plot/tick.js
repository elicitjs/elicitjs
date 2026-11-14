// @ts-check
import { isBand, bandSpan } from '../core/scales.js';
import { encodeChannel, categoryOf, categorySlot, encodeAngle, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, resolveValueAxis, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// tick: a line segment at a value on one axis, spanning the other axis (a
// category band, or the full extent for a rug).
//
//   x: band,   y: linear  -> horizontal ticks (tickY): value on y, span the x band
//   x: linear, y: band     -> vertical ticks   (tickX): value on x, span the y band
//
// `tick` infers the value axis from the channels and scales; `tickY` / `tickX`
// force one. `inset` shrinks each end in px; `length` sets a fixed px span
// (centred on the span-axis channel when the mark has one).

/**
 * Pixel span for the non-value axis.
 * @param {'x' | 'y'} spanAxis
 * @param {any} scale
 * @param {Record<string, any>} channels
 * @param {import('../types').ScaleMap} scales
 * @param {any} datum
 * @param {string} key
 * @param {number} fullLength
 * @param {number} inset
 * @param {number | undefined} length
 * @param {number} [index] row index, so a derived ({ fn }) channel sees (d, i, data)
 * @param {import('../types').Datum[]} [data]
 * @returns {[number, number]}
 */
function resolveSpan(spanAxis, scale, channels, scales, datum, key, fullLength, inset, length, index, data) {
    // An explicit endpoint pair wins over the band (a glyph part in local units
    // has no band).
    const lo = channels[`${spanAxis}1`];
    const hi = channels[`${spanAxis}2`];
    if (lo && hi) {
        return [
            encodeChannel(scales, channels, `${spanAxis}1`, datum, 0, index, data),
            encodeChannel(scales, channels, `${spanAxis}2`, datum, fullLength, index, data),
        ];
    }
    // A fixed-length tick with a positional channel on the span axis: centre on
    // the datum (scatter / composite glyph), not on the band or plot midpoint.
    if (length != null && channels[spanAxis]) {
        const center = encodeChannel(scales, channels, spanAxis, datum, fullLength / 2, index, data);
        return [center - length / 2, center + length / 2];
    }
    // A nested `xOffset`/`yOffset` narrows the band to the row's sub-band.
    const slot = isBand(scale) ? categorySlot(scales, channels, /** @type {'x' | 'y'} */ (spanAxis), datum, key, index, data) : undefined;
    return bandSpan(scale, categoryOf(channels, spanAxis, datum, key, index, data), fullLength, { inset, length, slot });
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tick(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'tick', allow: MARK_OPTIONS.tick });
    const {
        channels = {},
        inset = 0,
        length
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        type: 'tick',
        channels,
        // A tick spans a band interval.
        discreteScale: 'band',
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
            const { x: xScale, y: yScale } = scales;

            // The value axis: explicit wins; otherwise the axis that isn't the
            // band (or the x1/x2, y1/y2 chord).
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation, extent: 'span' });

            const tickDefaults = markDefaults(scales, 'tick', { stroke: themeOf(scales).ink, strokeWidth: 2 });

            /** @type {any[]} */
            const out = [];
            currentData.forEach((d, i) => {
                // No tick for a row missing its value or its category.
                if (missingValue(channels, valueAxis, d)) return;
                if (missingValue(channels, valueAxis === 'x' ? 'y' : 'x', d)) return;
                const node = tickNode(d, i);
                if (node) out.push(node);
            });
            return out;

            /** @param {any} d @param {number} i */
            function tickNode(d, i) {
                const style = resolveStyle(scales, channels, d, tickDefaults, i, currentData);

                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);

                if (valueAxis === 'x') {
                    // Vertical tick: value on x (linear), span the y band.
                    const valuePos = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                    const [y1, y2] = resolveSpan('y', yScale, channels, scales, d, yKey, height, inset, length, i, currentData);
                    return {
                        type: 'line',
                        x1: valuePos,
                        x2: valuePos,
                        y1,
                        y2,
                        ...style,
                        data: d,
                        index: i,
                        bandAxis: 'y', // proximity measures distance along y (rows)
                        cursor: 'ew-resize',
                        ...(angle ? { angle } : {}),
                    };
                }

                // Horizontal tick: value on y (linear), span the x band.
                const valuePos = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                const [x1, x2] = resolveSpan('x', xScale, channels, scales, d, xKey, width, inset, length, i, currentData);
                return {
                    type: 'line',
                    x1,
                    x2,
                    y1: valuePos,
                    y2: valuePos,
                    ...style,
                    data: d,
                    index: i,
                    bandAxis: 'x', // proximity measures distance along x (columns)
                    cursor: 'ns-resize',
                    ...(angle ? { angle } : {}),
                };
            }
        }
    };
}

/**
 * Horizontal ticks: value on y, spanning the x band.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tickY(options = {}) {
    return tick({ ...options, orientation: 'vertical' });
}

/**
 * Vertical ticks: value on x, spanning the y band.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tickX(options = {}) {
    return tick({ ...options, orientation: 'horizontal' });
}
