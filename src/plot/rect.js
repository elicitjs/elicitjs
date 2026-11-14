// @ts-check
import { isBand, baselineOf, rangeExtent } from '../core/scales.js';
import { encodeChannel, categorySlot, encodeAngle, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// rect: a rectangle whose extent on each axis is resolved independently (heatmap
// cells, 2-D regions, histograms, annotation boxes).
//
//   rect  — each axis resolves on its own
//   rectX — force x to baseline→value (a horizontal histogram bar)
//   rectY — force y to baseline→value (a vertical histogram bar)
//
// Per axis, the first that applies:
//   1. SPAN     x1 and x2 (y1 and y2) both set → between the two
//   2. SIZE     width / height set → a fixed px box centred on the x/y anchor
//   3. BAND     a band scale, unless the axis is forced to value → the category interval
//   4. VALUE    an x/y channel → baseline→value
//   5. EXTENT   nothing on this axis → the full range

/**
 * Resolve one axis's pixel extent for a datum: [lo, hi] (lo ≤ hi) plus whether
 * it used band geometry (for `bandAxis`).
 * @param {'x' | 'y'} axis
 * @param {Record<string, any>} channels
 * @param {import('../types').ScaleMap} scales
 * @param {any} scale the axis scale
 * @param {any} datum
 * @param {string} key the axis field name
 * @param {boolean} forcedValue this axis is forced to baseline→value
 * @param {number} fullLength the plot extent along this axis (fallback span)
 * @param {number} [index] row index, passed to derived channel fns
 * @param {any[]} [data] the dataset, passed to derived channel fns
 * @returns {{ lo: number, hi: number, band: boolean }}
 */
function resolveExtent(axis, channels, scales, scale, datum, key, forcedValue, fullLength, index, data) {
    const c1 = axis + '1';
    const c2 = axis + '2';
    // 1. SPAN — both endpoints declared.
    if (channels[c1] && channels[c2]) {
        const v1 = encodeChannel(scales, channels, c1, datum, 0, index, data);
        const v2 = encodeChannel(scales, channels, c2, datum, 0, index, data);
        return { lo: Math.min(v1, v2), hi: Math.max(v1, v2), band: false };
    }
    // 2. SIZE — a fixed px extent centred on the x/y anchor.
    const sizeCh = axis === 'x' ? 'width' : 'height';
    if (channels[sizeCh]) {
        const size = encodeChannel(scales, channels, sizeCh, datum, 0, index, data);
        const [rlo, rhi] = scale ? rangeExtent(scale) : [0, fullLength];
        const center = encodeChannel(scales, channels, axis, datum, (rlo + rhi) / 2, index, data);
        return { lo: center - size / 2, hi: center + size / 2, band: false };
    }
    // 3. BAND — a categorical axis (skipped when this axis is forced to value).
    if (!forcedValue && isBand(scale)) {
        // The category's band, or its sub-band under a nested `xOffset`/`yOffset`.
        const { start, width: thickness } = categorySlot(scales, channels, axis, datum, key, index, data);
        return { lo: start, hi: start + thickness, band: true };
    }
    // 4. VALUE — a single field drawn from the baseline.
    if (channels[axis]) {
        const baseline = baselineOf(scale);
        const value = encodeChannel(scales, channels, axis, datum, baseline, index, data);
        return { lo: Math.min(value, baseline), hi: Math.max(value, baseline), band: false };
    }
    // 5. EXTENT — nothing on this axis: span it fully.
    const [rlo, rhi] = scale ? rangeExtent(scale) : [0, fullLength];
    return { lo: Math.min(rlo, rhi), hi: Math.max(rlo, rhi), band: false };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rect(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'rect', allow: MARK_OPTIONS.rect,
    });
    // `orientation` forces one axis to baseline→value.
    const forcedValueAxis = opts.orientation === 'vertical' ? 'y'
        : opts.orientation === 'horizontal' ? 'x' : null;
    const { channels = {}, width: widthOpt, height: heightOpt, rx: rxOpt, gradient } = opts;
    // `width` / `height` / `rx` options are px constants for those channels. They
    // are rect-only, so they live in `allow`, not the shared SHORTHANDS.
    if (widthOpt !== undefined && !channels.width) channels.width = { value: widthOpt };
    if (heightOpt !== undefined && !channels.height) channels.height = { value: heightOpt };
    if (rxOpt !== undefined && !channels.rx) channels.rx = { value: rxOpt };

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        type: 'rect',
        channels,
        // A rect wants the band interval on any categorical axis (like a bar).
        discreteScale: 'band',
        xKey,
        yKey,
        /**
         * The box this rect draws for one row, from the same extents build() reads.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const xExt = resolveExtent('x', channels, scales, scales.x, d, xKey, forcedValueAxis === 'x', width, i, rows);
            const yExt = resolveExtent('y', channels, scales, scales.y, d, yKey, forcedValueAxis === 'y', height, i, rows);
            return {
                cx: (xExt.lo + xExt.hi) / 2,
                cy: (yExt.lo + yExt.hi) / 2,
                hw: (xExt.hi - xExt.lo) / 2,
                hh: (yExt.hi - yExt.lo) / 2,
            };
        },
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const { x: xScale, y: yScale } = scales;
            const rectDefaults = markDefaults(scales, 'rect', { fill: themeOf(scales).ink });

            // No rect when every positional field of a dimension is missing.
            /** @param {any} d @param {string[]} names */
            const noExtent = (d, names) => {
                const bound = names.filter((n) => channels[n] && channels[n].field != null);
                return bound.length > 0 && bound.every((n) => missingValue(channels, n, d));
            };
            return currentData.flatMap((d, i) => {
                if (noExtent(d, ['x', 'x1', 'x2']) || noExtent(d, ['y', 'y1', 'y2'])) return [];
                const style = resolveStyle(scales, channels, d, rectDefaults, i, currentData);

                const xExt = resolveExtent('x', channels, scales, xScale, d, xKey, forcedValueAxis === 'x', width, i, currentData);
                const yExt = resolveExtent('y', channels, scales, yScale, d, yKey, forcedValueAxis === 'y', height, i, currentData);

                // With exactly one band axis, flag it for proximity picking.
                /** @type {'x' | 'y' | undefined} */
                let bandAxis;
                if (xExt.band && !yExt.band) bandAxis = 'x';
                else if (yExt.band && !xExt.band) bandAxis = 'y';

                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                // Corner radius, in px.
                const rx = channels.rx
                    ? encodeChannel(scales, channels, 'rx', d, 0, i, currentData)
                    : rectDefaults.rx;

                return {
                    type: 'rect',
                    ...(gradient ? { fillGradient: gradient } : {}),
                    x: xExt.lo,
                    y: yExt.lo,
                    width: xExt.hi - xExt.lo,
                    height: yExt.hi - yExt.lo,
                    ...style,
                    data: d,
                    index: i,
                    ...(angle ? { angle } : {}),
                    ...(rx ? { rx } : {}),
                    ...(bandAxis ? { bandAxis } : {})
                };
            });
        }
    };
}

/**
 * Value on x (baseline→value), the other axis a span/band — a horizontal bar/histogram.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rectX(options = {}) {
    return rect({ ...options, orientation: 'horizontal' });
}

/**
 * Value on y (baseline→value), the other axis a span/band — a vertical bar/histogram.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rectY(options = {}) {
    return rect({ ...options, orientation: 'vertical' });
}
