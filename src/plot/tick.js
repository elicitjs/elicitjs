// @ts-check
import { isBand, bandSpan } from '../core/scales.js';
import { encodeChannel, categoryOf, encodeAngle, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon} from './mark.js';

// tick: a thin line-segment mark (Observable Plot's tick). It marks a VALUE on
// one axis (the linear/continuous axis) and SPANS the other axis — a category
// band when the span axis is ordinal, or the full extent otherwise (a rug /
// strip plot). It is bar's zero-thickness sibling: same categorical/value
// decomposition, but the mark draws a line at the value instead of a rect from
// a baseline.
//
//   x: band,   y: linear  -> horizontal ticks (tickY): value on y, span the x band
//   x: linear, y: band     -> vertical ticks   (tickX): value on x, span the y band
//
// `tick` auto-detects which axis is the value axis from the scale types;
// `tickY` / `tickX` force one (matching Plot). Editing, proximity pick, create,
// remove, constraints and the style surface all come from the shared model —
// a tick with `channels.y.edit = move()` is draggable with no mark-specific code.
//
// The span across the band is customizable with `inset` (px shrink each end) or
// an explicit `length` (px, centred) — see bandSpan in core/scales.js, a
// mark-agnostic helper other marks can reuse. When `length` is set AND the span
// axis has a channel (e.g. a scatter tick with both x and y), the segment is
// centred on that channel's encoded position — not on the plot's mid-extent —
// so a short tick sits on the datum instead of floating at the chart centre.

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
    // An explicit endpoint PAIR states the span outright — the same x1/x2 (y1/y2)
    // spelling bar/rect/area/rule use. It wins over the band, because a glyph part
    // whose span is stated in its group's local frame has no band to sit in and a
    // fixed px `length` would not scale with the glyph.
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
    return bandSpan(scale, categoryOf(channels, spanAxis, datum, key, index, data), fullLength, { inset, length });
}

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedValueAxis which axis carries the value
 * @returns {import('../types').Mark}
 */
function buildTick(options, forcedValueAxis) {
    // Desugar top-level style shorthands (stroke: '…', strokeWidth: …) into the
    // channels so tick reads style the same way every mark does.
    const opts = normalizeMarkOptions(options, { mark: 'tick', allow: ['inset', 'length'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        inset = 0,
        length
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'tick',
        channels,
        // A tick sits within a band (like a bar) — it wants the band interval to
        // span, so it asks for the band variant of the categorical scale.
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

            // Which axis carries the value (the line's position)? Explicit wins;
            // otherwise the band axis is the span, so the OTHER axis is the value.
            let valueAxis = forcedValueAxis;
            if (!valueAxis) {
                if (isBand(xScale)) valueAxis = 'y';
                else if (isBand(yScale)) valueAxis = 'x';
                else valueAxis = 'y';
            }

            // A tick reads as a stroked line, so its per-mark defaults are
            // stroke/strokeWidth rather than a fill; stroke follows the theme ink.
            const tickDefaults = markDefaults(scales, 'tick', { stroke: themeOf(scales).ink, strokeWidth: 2 });

            return currentData.map((d, i) => {
                const style = resolveStyle(scales, channels, d, tickDefaults, i, currentData);

                const angle = encodeAngle(scales, channels, d, 0, i, currentData);

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
            });
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tick(options = {}) {
    return buildTick(options, null);
}

/**
 * Horizontal ticks: value on y, spanning the x band.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tickY(options = {}) {
    return buildTick(options, 'y');
}

/**
 * Vertical ticks: value on x, spanning the y band.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function tickX(options = {}) {
    return buildTick(options, 'x');
}
