// @ts-check
// text.js — one label per row at (x, y).
//
//   elicit.plot.text({
//     channels: {
//       x:    { field: "gdp" },       // linear position
//       y:    { field: "life" },      // linear position
//       text: { field: "country" },   // the string to draw (raw, unscaled)
//     },
//     dy: -8,                         // pixel offset above the point
//     lineAnchor: 'bottom',           // vertical anchor (top·middle·bottom)
//     format: '.1f',                  // d3-format string (or a function)
//   })
//
// x/y go through the scales; `text`, the font channels, the anchors and dx/dy are
// raw channels (unscaled). `format` only changes the display.
//
//   text  — position from x AND y
//   textX — value on x, y parked at the vertical centre (a 1-D label along x)
//   textY — value on y, x parked at the horizontal centre (a 1-D label along y)

import { encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions, rawChannel, markDefaults, positionalKeys, markCommon, themeOf, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { measureBlock } from '../core/measure.js';
import { resolveFormat } from '../format.js';

/**
 * Map a Plot-style lineAnchor to an SVG dominant-baseline.
 * @param {string} anchor
 * @returns {string}
 */
function dominantBaselineOf(anchor) {
    switch (anchor) {
        case 'top': return 'text-before-edge';
        case 'bottom': return 'text-after-edge';
        case 'middle':
        default: return 'central';
    }
}


/**
 * A text node at an already-resolved pixel position. Shared by `text` (x/y
 * scales) and `geoText` (projection). dx/dy are visual offsets added after
 * positioning.
 *
 * `wrap` (px, or a function of the row so it can match a per-row box width)
 * splits the string into `lines`; `text` stays the whole string, one node.
 *
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {any} d the datum
 * @param {number} i its index in the dataset
 * @param {number} px @param {number} py resolved position, before dx/dy
 * @param {{ format?: (v: any) => any, data?: import('../types').Datum[], wrap?: number | ((d: any, i: number, data: any[]) => number), lineHeight?: number }} [opts]
 * @returns {import('../types').FeatureNode}
 */
export function textNodeAt(scales, channels, d, i, px, py, opts = {}) {
    const { format = (/** @type {any} */ v) => v, data, wrap: wrapOpt, lineHeight } = opts;
    const wrap = typeof wrapOpt === 'function' ? wrapOpt(d, i, data || [d]) : wrapOpt;
    const style = resolveStyle(scales, channels, d, markDefaults(scales, 'text', { fill: '#111' }), i, data);

    const dx = +rawChannel(channels, 'dx', d, 0, i, data) || 0;
    const dy = +rawChannel(channels, 'dy', d, 0, i, data) || 0;

    // Angle in math degrees, scaled when a scale exists so rotate() inverts it.
    const angle = encodeAngle(scales, channels, 'angle', d, 0, i, data);

    const lineAnchor = rawChannel(channels, 'lineAnchor', d, 'middle', i, data);
    const fontSize = rawChannel(channels, 'fontSize', d, 12, i, data);
    const text = format(rawChannel(channels, 'text', d, '', i, data));
    // Typography. Unset, a label inherits the chart's font.
    const fontWeight = rawChannel(channels, 'fontWeight', d, undefined, i, data);
    const fontStyle = rawChannel(channels, 'fontStyle', d, undefined, i, data);
    const fontFamily = rawChannel(channels, 'fontFamily', d, undefined, i, data);

    // Measure only when wrapping.
    const block = wrap || lineHeight
        ? measureBlock(text, {
            maxWidth: wrap,
            fontSize: +fontSize || 12,
            fontFamily: fontFamily || (themeOf(scales).font && themeOf(scales).font.family) || undefined,
            fontWeight,
            lineHeight,
        })
        : null;

    return {
        type: 'text',
        x: px + dx,
        y: py + dy,
        text,
        fontSize,
        textAnchor: rawChannel(channels, 'textAnchor', d, 'middle', i, data),
        lineAnchor,
        dominantBaseline: dominantBaselineOf(lineAnchor),
        ...(fontWeight != null ? { fontWeight } : {}),
        ...(fontStyle != null ? { fontStyle } : {}),
        ...(fontFamily != null ? { fontFamily } : {}),
        ...(angle ? { angle } : {}),
        ...(block && block.lines.length > 1
            ? { lines: block.lines, lineHeight: block.lineHeight }
            : {}),
        ...style,
        data: d,
        index: i,
    };
}

/** The channels a label reads itself, unscaled (`rawChannel`). Shared with
 *  `geoText`, which places the same node through a projection.
 *  @type {string[]} */
export const TEXT_RAW_CHANNELS = [
    'text', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'textAnchor', 'lineAnchor', 'dx', 'dy',
];

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function text(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'text', allow: MARK_OPTIONS.text,
    });
    const { channels = {}, format: formatOpt, wrap, lineHeight } = opts;
    const format = resolveFormat(formatOpt);

    return {
        ...markCommon(opts),
        type: 'text',
        channels,
        // Read through `rawChannel`, so the resolver builds no scale for them.
        rawChannels: TEXT_RAW_CHANNELS,
        // A label sits at a category, not over an interval.
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
            return currentData.flatMap((d, i) => {
                // A row with no x or y value has no position: no label.
                if (missingValue(channels, 'x', d) || missingValue(channels, 'y', d)) return [];
                const { x, y } = anchorOf(d, i, currentData, scales, width, height);
                return [textNodeAt(scales, channels, d, i, x, y, {
                    format, data: currentData, wrap, lineHeight,
                })];
            });
        },

        // A label's box: another shape over the same rows is the node, if there is one.
        labelBox: true,
        /**
         * The block this row's text occupies, so a label can be a network node.
         * Anchored and shifted the way the text is drawn; rotation is ignored.
         * @param {any} d @param {number} i @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         * @returns {import('../types').NodeBox}
         */
        nodeBox: (d, i, rows, scales, width, height) => {
            const at = anchorOf(d, i, rows, scales, width, height);
            const dx = +rawChannel(channels, 'dx', d, 0, i, rows) || 0;
            const dy = +rawChannel(channels, 'dy', d, 0, i, rows) || 0;
            const fontSize = +rawChannel(channels, 'fontSize', d, 12, i, rows) || 12;
            const block = measureBlock(format(rawChannel(channels, 'text', d, '', i, rows)), {
                maxWidth: typeof wrap === 'function' ? wrap(d, i, rows) : wrap,
                fontSize,
                fontWeight: rawChannel(channels, 'fontWeight', d, undefined, i, rows),
                fontFamily: rawChannel(channels, 'fontFamily', d, undefined, i, rows)
                    || (themeOf(scales).font && themeOf(scales).font.family) || undefined,
                lineHeight,
            });
            const hw = block.width / 2;
            const hh = block.height / 2;
            const anchor = rawChannel(channels, 'textAnchor', d, 'middle', i, rows);
            const line = rawChannel(channels, 'lineAnchor', d, 'middle', i, rows);
            const x = at.x + dx;
            const y = at.y + dy;
            return {
                cx: anchor === 'start' ? x + hw : anchor === 'end' ? x - hw : x,
                cy: line === 'top' ? y + hh : line === 'bottom' ? y - hh : y,
                hw,
                hh,
            };
        },
    };

    /**
     * Where a row's label is anchored: each axis through its global scale, parked at
     * the centre when the axis isn't used (textX/textY force the counter-axis centre).
     * @param {any} d @param {number} i @param {any[]} rows
     * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
     */
    function anchorOf(d, i, rows, scales, width, height) {
        const forcedAxis = opts.orientation === 'vertical' ? 'y'
            : opts.orientation === 'horizontal' ? 'x' : null;
        return {
            x: forcedAxis === 'y' ? width / 2 : encodeChannel(scales, channels, 'x', d, width / 2, i, rows),
            y: forcedAxis === 'x' ? height / 2 : encodeChannel(scales, channels, 'y', d, height / 2, i, rows),
        };
    }
}

/**
 * A 1-D label along x: value on x, parked at the vertical centre.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function textX(options = {}) {
    return text({ ...options, orientation: 'horizontal' });
}

/**
 * A 1-D label along y: value on y, parked at the horizontal centre.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function textY(options = {}) {
    return text({ ...options, orientation: 'vertical' });
}
