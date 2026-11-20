// @ts-check
// image.js — one picture per row, centred at (x, y), like an <img>. The `src`
// channel is its URL, and takes `fit` (object-fit, default 'contain') and
// `position` (object-position) as params. `size` is the radius in px, so the
// picture sits in a square of side `2 * size`. Drawn as a rect whose fill is the
// picture, so it picks, outlines and eases like any rect.

import { encodeChannel, encodeAngle, resolveStyle, resolveImage, normalizeMarkOptions, markDefaults, positionalKeys, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';

/** The default radius, in px: a 32px picture. */
const IMAGE_SIZE = 16;

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function image(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'image', allow: MARK_OPTIONS.image });
    const { channels = {} } = opts;
    if (!channels.src) {
        warn('image:nosrc', 'plot.image() has no `src` channel, so it draws nothing. ' +
            'Pass a URL: src: "photo.png", or a column of URLs: channels: { src: { field: "…" } }.');
    }

    /** @param {import('../types').ScaleMap} scales */
    const sizeDefault = (scales) => markDefaults(scales, 'image', {}).size ?? IMAGE_SIZE;

    return {
        ...markCommon(opts),
        type: 'image',
        channels,
        rawChannels: ['src'],
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * The square the picture sits in.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const r = Math.max(0, +encodeChannel(scales, channels, 'size', d, sizeDefault(scales), i, rows) || 0);
            return {
                cx: encodeChannel(scales, channels, 'x', d, width / 2, i, rows),
                cy: encodeChannel(scales, channels, 'y', d, height / 2, i, rows),
                hw: r,
                hh: r,
                round: false,
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
            // No fill of its own: the picture is the fill.
            const defaults = markDefaults(scales, 'image', { fill: 'none' });
            return currentData.flatMap((d, i) => {
                if (missingValue(channels, 'x', d) || missingValue(channels, 'y', d)) return [];
                const picture = resolveImage(channels, 'src', d, i, currentData);
                // A row with no URL has nothing to draw.
                if (!picture.fillImage) return [];
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                const size = Math.max(0, +encodeChannel(scales, channels, 'size', d, sizeDefault(scales), i, currentData) || 0);
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                return {
                    type: 'rect',
                    x: cx - size,
                    y: cy - size,
                    width: size * 2,
                    height: size * 2,
                    ...style,
                    ...picture,
                    data: d,
                    index: i,
                    ...(angle ? { angle } : {}),
                };
            });
        },
    };
}
