// @ts-check
// point.js — a channel-driven mark. It reads a `channels` map and resolves every
// channel — positional or not — through the same GLOBAL scale (Observable Plot
// model): the engine builds one scale per channel and the mark just looks it up
// by name. Adding a colour or size channel is data, not new mark code:
//
//   elicit.plot.point({
//     channels: {
//       x:    { field: "gdp" },        // linear   (schema: quantitative)
//       y:    { field: "region" },     // point    (schema: categorical)
//       fill: { field: "region" },     // ordinal palette
//       size: { field: "population" }, // radius
//     }
//   })
//
// Channel resolution + the standard style surface (fill, stroke, strokeWidth,
// opacity, fillOpacity, strokeOpacity) come from the shared mark foundation, so
// point stays styleable in one line and matches every other mark. `size` is the
// dot's radius channel, in px — as a field it ramps, and `point({ size: 9 })` is
// the constant shorthand.
//
// `shape: 'circle' | 'square'` (default circle) picks the glyph. A square is a
// centred rect with side `2 * size`, so it can carry an `angle` channel and
// rotate about its centre — a circle is rotation-invariant.
//
// A missing positional channel parks the dot at the centre of that dimension —
// symmetric across x and y, so 1D-along-x and 1D-along-y are the same code path.

import { encodeChannel, encodeAngle, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon} from './mark.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function point(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'point', allow: ['shape'] });
    const { channels = {}, id, edits, constraints, shape = 'circle' } = opts;

    return {
        ...markCommon(opts),
        markName: 'point',
        channels,
        // A dot's categorical axis wants a point per category (a tick, no width).
        discreteScale: 'point',
        // Field keys the interaction/constraint layer reads, derived from channels.
        ...positionalKeys(channels),

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const pointDefaults = markDefaults(scales, 'point', { fill: themeOf(scales).ink });
            return currentData.map((d, i) => {
                const style = resolveStyle(scales, channels, d, pointDefaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                const size = encodeChannel(scales, channels, 'size', d, 5, i, currentData);
                const angle = encodeAngle(scales, channels, d, 0, i, currentData);
                // A `symbol` channel turns the dot into a glyph (emoji / unicode
                // shape) — the same category->encoding path, rendered as text. `size`
                // still sets its px extent so a glyph point and a circle point match.
                const glyph = resolveSymbol(scales, channels, d, i, currentData);
                if (glyph !== undefined) {
                    return symbolNode(glyph, cx, cy, size, {
                        ...style,
                        data: d,
                        index: i,
                        ...(angle ? { angle } : {}),
                    });
                }
                if (shape === 'square') {
                    // Side = diameter of the circle the same `size` would draw, so
                    // a square point and a circle point occupy the same visual box.
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
