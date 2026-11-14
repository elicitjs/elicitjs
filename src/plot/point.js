// @ts-check
// point.js — one dot per row at (x, y). `size` is the radius in px.
// `shape: 'circle' | 'square'` picks the glyph; a square has side `2 * size`.
// A `symbol` channel draws a text glyph instead. A missing positional channel
// puts the dot at the centre of that dimension.

import { encodeChannel, encodeAngle, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function point(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'point', allow: MARK_OPTIONS.point });
    const { channels = {}, shape = 'circle' } = opts;

    return {
        ...markCommon(opts),
        type: 'point',
        channels,
        // A dot's categorical axis wants a point per category (a tick, no width).
        discreteScale: 'point',
        // Field keys the interaction/constraint layer reads, derived from channels.
        ...positionalKeys(channels),

        /**
         * The box a dot occupies, for a network that docks links to it: its centre
         * and its radius, through the same channels build() reads.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const r = Math.max(0, +encodeChannel(scales, channels, 'size', d, markDefaults(scales, 'point', {}).size ?? 5, i, rows) || 0);
            return {
                cx: encodeChannel(scales, channels, 'x', d, width / 2, i, rows),
                cy: encodeChannel(scales, channels, 'y', d, height / 2, i, rows),
                hw: r,
                hh: r,
                // A circle (or a glyph drawn in one) is met on its circle; a square
                // point on its edges.
                round: shape !== 'square',
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
            const pointDefaults = markDefaults(scales, 'point', { fill: themeOf(scales).ink });
            return currentData.flatMap((d, i) => {
                // A row with no x or y value has no position: no dot.
                if (missingValue(channels, 'x', d) || missingValue(channels, 'y', d)) return [];
                const style = resolveStyle(scales, channels, d, pointDefaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                const size = encodeChannel(scales, channels, 'size', d, pointDefaults.size ?? 5, i, currentData);
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                // A `symbol` channel draws a text glyph sized by `size`.
                const glyph = resolveSymbol(scales, channels, d, i, currentData);
                if (glyph !== undefined && /^\s*[Mm]/.test(glyph)) {
                    warn(
                        'point:symbol:path',
                        'point(): a `symbol` resolved to an SVG path, which this mark draws as TEXT. ' +
                        'Use plot.shape() for path symbols.'
                    );
                }
                if (glyph !== undefined) {
                    return symbolNode(glyph, cx, cy, size, {
                        ...style,
                        data: d,
                        index: i,
                        ...(angle ? { angle } : {}),
                    });
                }
                if (shape === 'square') {
                    // Side = the circle's diameter, so both fill the same box.
                    const side = Math.max(0, size * 2);
                    return {
                        type: 'rect',
                        x: cx - side / 2,
                        y: cy - side / 2,
                        width: side,
                        height: side,
                        ...style,
                        data: d,
                        index: i,
                        ...(angle ? { angle } : {}),
                    };
                }
                return {
                    type: 'circle',
                    cx,
                    cy,
                    r: size,
                    ...style,
                    data: d,
                    index: i,
                    ...(angle ? { angle } : {}),
                };
            });
        }
    };
}
