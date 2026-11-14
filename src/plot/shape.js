// @ts-check
// shape — one path per row, centred at (x, y): a d3 symbol name or an SVG path.
// The shape comes from the `symbol` channel (an ordinal scale onto names or
// paths), else the `path` option (a constant or a function of the row; default
// 'circle'). `size` is the radius of the box it fits; `angle` rotates it.
// Size, angle and position are baked into `d` (a path node carries no `angle`),
// plus an outline `points` polygon and `cx`/`cy` for picking.
import { encodeChannel, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, encodeAngle, resolveSymbol, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { unitShape, placeShape, DEFAULT_SHAPES } from './shapes.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function shape(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'shape', allow: MARK_OPTIONS.shape });
    const { channels: declared = {}, path = 'circle' } = opts;
    // A symbol channel with no range of its own takes the named-shape vocabulary
    // (point's default range is text glyphs, which this mark cannot draw).
    const channels = declared.symbol && declared.symbol.field != null && declared.symbol.scale == null
        ? { ...declared, symbol: { ...declared.symbol, scale: { range: [...DEFAULT_SHAPES] } } }
        : declared;

    /**
     * The unit shape for a row, with a loud fallback.
     * @param {any} spec @returns {{ segments: any[] }}
     */
    const unitOf = (spec) => {
        const unit = unitShape(spec == null ? 'circle' : String(spec));
        if (unit) return unit;
        warn(
            `shape:path:unparsed:${String(spec).slice(0, 24)}`,
            `shape(): "${String(spec).slice(0, 40)}" is not a shape name (${DEFAULT_SHAPES.join(', ')}) ` +
            `or an SVG path this mark can read; drawing a circle instead.`
        );
        return /** @type {any} */ (unitShape('circle'));
    };

    return {
        ...markCommon(opts),
        type: 'shape',
        channels,
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * The box a shape occupies — the square its unit form fits — for a network
         * that docks links to it and puts ports on its edges.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const r = Math.max(0, +encodeChannel(scales, channels, 'size', d, 6, i, rows) || 0);
            return {
                cx: encodeChannel(scales, channels, 'x', d, width / 2, i, rows),
                cy: encodeChannel(scales, channels, 'y', d, height / 2, i, rows),
                hw: r, hh: r, round: false,
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
            const defaults = markDefaults(scales, 'shape', { fill: themeOf(scales).ink });
            return currentData.flatMap((d, i) => {
                // A row with no x or y value has no position: no shape.
                if (missingValue(channels, 'x', d) || missingValue(channels, 'y', d)) return [];
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                const size = Math.max(0, +encodeChannel(scales, channels, 'size', d, 6, i, currentData) || 0);
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, currentData);
                const spec = channels.symbol
                    ? resolveSymbol(scales, channels, d, i, currentData)
                    : (typeof path === 'function' ? path(d, i, currentData) : path);
                const { d: pathD, points } = placeShape(unitOf(spec), cx, cy, size, angle || 0);
                return {
                    type: 'path',
                    d: pathD,
                    points,
                    polygon: true,
                    cx, cy,
                    ...style,
                    data: d,
                    index: i,
                };
            });
        },
    };
}
