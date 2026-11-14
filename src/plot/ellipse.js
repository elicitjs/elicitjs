// @ts-check
// ellipse.js — a dot with two radii, `rx` and `ry`, each its own channel (so each
// can carry a field and an edit). `size` is the fallback for an unset radius, so
// `ellipse({ size: 6 })` is a circle.
// Emits an `ellipse` scene node, not a path, because renderers don't apply
// `angle` to paths.

import {
    encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions,
    themeOf, markDefaults, positionalKeys, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ellipse(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'ellipse', allow: MARK_OPTIONS.ellipse });
    const { channels = {} } = opts;

    return {
        ...markCommon(opts),
        type: 'ellipse',
        channels,
        // A tick per category, like a dot.
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * The ellipse as a network node: its radii, met on the curve. A tilted
         * ellipse keeps its unrotated box.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const size = encodeChannel(scales, channels, 'size', d, 5, i, rows);
            return {
                cx: encodeChannel(scales, channels, 'x', d, width / 2, i, rows),
                cy: encodeChannel(scales, channels, 'y', d, height / 2, i, rows),
                hw: Math.max(0, +encodeChannel(scales, channels, 'rx', d, size, i, rows) || 0),
                hh: Math.max(0, +encodeChannel(scales, channels, 'ry', d, size, i, rows) || 0),
                round: true,
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
            const defaults = markDefaults(scales, 'ellipse', { fill: themeOf(scales).ink });
            return currentData.flatMap((d, i) => {
                // A row with no x or y value has no position: no ellipse.
                if (missingValue(channels, 'x', d) || missingValue(channels, 'y', d)) return [];
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                // `size` is the fallback for both radii.
                const size = encodeChannel(scales, channels, 'size', d, 5, i, currentData);
                const rx = encodeChannel(scales, channels, 'rx', d, size, i, currentData);
                const ry = encodeChannel(scales, channels, 'ry', d, size, i, currentData);
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                return {
                    type: 'ellipse',
                    cx,
                    cy,
                    rx,
                    ry,
                    ...style,
                    data: d,
                    index: i,
                    ...(angle ? { angle } : {}),
                };
            });
        }
    };
}
