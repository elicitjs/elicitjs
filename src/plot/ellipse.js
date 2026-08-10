// @ts-check
// ellipse.js — a dot with two independent radii.
//
// `point` has one `size` channel, because a circle has one radius. An ellipse
// splits that into `rx` and `ry`, and the split is the point: each is its own
// magnitude channel, so each can carry its own field and its own edit. A shape
// that widens on one drag and flattens on another is two elicited numbers in one
// mark — a face's eye (open / squinting), a confidence blob whose axes are two
// separate uncertainties, a scatter point with per-axis error.
//
//   ellipse({
//     channels: {
//       x:  { field: 'gdp' },
//       y:  { field: 'life' },
//       rx: { field: 'sigmaX', edit: slide({ axis: 'x', increase: 'right' }) },
//       ry: { field: 'sigmaY', edit: slide({ axis: 'y', increase: 'down' }) },
//     }
//   })
//
// `rx`/`ry` are size-family channels: a field ramps through the default [3, 18]
// px radius range, a `{ value }` is a constant in px, and inside a `group`'s
// frame (`scale: { type: 'frame', range: [0.06, 0.19] }`) they are a fraction of
// the glyph's half-size, so an eye scales with its face.
//
// `size` is accepted as the FALLBACK for a radius the mark doesn't otherwise
// name, so `ellipse({ size: 6 })` is a circle and `ellipse({ size: 6, channels:
// { ry: … } })` is an ellipse with a fixed width — the same relationship
// `point({ size })` has to its radius.
//
// The node is a real `ellipse` scene node rather than a two-arc path: paths can
// be rotated by neither renderer (they carry no centre and neither the SVG nor
// the canvas draw applies `angle` to them), and an ellipse that cannot tilt is
// half a shape.

import {
    encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions,
    themeOf, markDefaults, positionalKeys, markCommon,} from './mark.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ellipse(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'ellipse', allow: [] });
    const { channels = {}, id, edits, constraints } = opts;

    return {
        ...markCommon(opts),
        markName: 'ellipse',
        channels,
        // Like a dot: its categorical axis wants a tick per category, not an interval.
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const defaults = markDefaults(scales, 'ellipse', { fill: themeOf(scales).ink });
            return currentData.map((d, i) => {
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                // `size` is the shared fallback, so a half-declared ellipse is a
                // circle rather than a shape with one arbitrary default radius.
                const size = encodeChannel(scales, channels, 'size', d, 5, i, currentData);
                const rx = encodeChannel(scales, channels, 'rx', d, size, i, currentData);
                const ry = encodeChannel(scales, channels, 'ry', d, size, i, currentData);
                const angle = encodeAngle(scales, channels, d, 0, i, currentData);
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
