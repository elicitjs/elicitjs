// @ts-check
import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, handlePaint, handlesAreAffordance, markCommon, rawChannel, resolveValueAxis, orderSeries, seriesKeyOf, hasAnyEdit, inkOf, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// line: a connected path over an ordered set of points. One mark covers a
// you-draw-it curve, a multi-series chart, a connected scatter and a drawn path:
//
//   grouping  `series` channel      -> which points form one line (defaults to
//                                       the fill/stroke field)
//   ordering  `order` channel       -> sort each series by that column
//             `connect` option      -> 'domain'   : sort by the domain axis
//                                      'sequence' : connect in array order
//   editing   the edits on the mark (not set here)
//   creation  edit.line.anchor() / newSeries()
//
// `build` emits one inert `path` per series, then one circle handle per row. Handles
// are drawn only when an edit can grab them (or `handles` says so).
//
//   x: domain, y: value  -> lineY (time series)      x: value, y: domain -> lineX
//
// `line` resolves the value axis through `resolveValueAxis`; `lineY`/`lineX` force
// one. `path` is the same mark with `connect: 'sequence'`.

const SINGLE = '__single__'; // group key when no series field is set

/**
 * @param {any} options
 * @param {string} [defaultConnect] 'domain' (presets) or 'sequence' (scatter/path)
 * @returns {import('../types').Mark}
 */
function buildLine(options, defaultConnect = 'domain') {
    const opts = normalizeMarkOptions(options, { mark: 'line', allow: MARK_OPTIONS.line });
    const {
        channels = {},
        curve = 'linear',
        // Unset: handles draw only when an edit can grab them.
        handles: handlesOpt,
        handleSize,
        handleColor,
        connect = defaultConnect
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    const seriesField = seriesFieldOf(channels);

    return {
        ...markCommon(opts),
        type: 'line',
        channels,
        handles: handlesOpt,
        // Read raw (no scale).
        rawChannels: ['curve', 'series', 'order'],
        discreteScale: 'point',
        xKey,
        yKey,
        seriesKey: seriesField,
        connect,
        // Capability for edit.line.*.
        supportsSeries: true,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build(currentData, scales, width, height) {
            // Decided at build time: a composite merges edits into a part after the factory runs.
            const editsNow = { edits: this && this.edits, channels: (this && this.channels) || channels };
            const handles = handlesOpt !== undefined ? handlesOpt : hasAnyEdit(editsNow);
            const rowHandle = handlesAreAffordance(handlesOpt, editsNow);

            // The value axis: explicit orientation, else the non-band axis, else
            // value-on-y. An edit's channel does not decide it.
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation });
            const domainAxis = valueAxis === 'y' ? 'x' : 'y';

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Pixel positions per row, keeping the global index. A missing value gives
            // a null coordinate (breaks the path, no handle); a missing domain value
            // skips the row.
            const placed = currentData.flatMap((d, i) => missingValue(channels, domainAxis, d) ? [] : [{
                d,
                i,
                cx: encodeChannel(scales, channels, 'x', d, valueAxis === 'x' ? null : width / 2, i, currentData),
                cy: encodeChannel(scales, channels, 'y', d, valueAxis === 'y' ? null : height / 2, i, currentData),
                series: seriesField ? d[seriesField] : SINGLE
            }]);

            // Group into series in first-seen order, keeping data order within each.
            // Grouped by key (a Date by its time), tagged with the first raw value.
            /** @type {Map<any, typeof placed>} */
            const groups = new Map();
            for (const p of placed) {
                const k = seriesKeyOf(p.series);
                const g = groups.get(k);
                if (g) { g.push(p); p.series = g[0].series; } else groups.set(k, [p]);
            }

            // Theme default; the path's stroke and the handles' fill share it.
            const lineDefaults = markDefaults(scales, 'line', { stroke: themeOf(scales).ink, strokeWidth: 2 });

            // One path per series, ordered by `connect` / `order`.
            for (const group of groups.values()) {
                if (group.length < 2) continue; // nothing to connect
                const pts = orderSeries(group, connect, domainAxis, channels);
                const style = resolveStyle(scales, channels, group[0].d, lineDefaults, group[0].i, currentData);
                // Curve resolves once per series, from its first row.
                const seriesCurve = String(
                    rawChannel(channels, 'curve', group[0].d, curve, group[0].i, currentData));
                nodes.push({
                    type: 'path',
                    points: pts.map(p => /** @type {[number, number]} */([p.cx, p.cy])),
                    // The row behind each vertex, for tips.
                    pointRows: pts.map((p) => p.i),
                    curve: seriesCurve,
                    ...style,
                    fill: 'none',
                    // Chrome: without this the path, drawn later, eats the handles' drags.
                    pointerEvents: 'none',
                    // Lets proximity tell which line this is.
                    series: group[0].series
                });
            }

            // A circle per row, tagged with `series`, filled with the line's colour
            // unless `handleColor` is set.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor },
                { fill: lineDefaults.stroke });
                placed.forEach(({ d, i, cx, cy, series }) => {
                if (!handleStyle.grabbable) return;
                if (cx == null || cy == null) return; // a missing value has no handle
                const paint = resolveStyle(scales, channels, d, lineDefaults, i, currentData);
                const rowInk = handleColor || (channels.fill ? inkOf(paint.fill) : null) || inkOf(paint.stroke);
                nodes.push({
                    type: 'circle',
                    cx,
                    cy,
                    r: handleStyle.size,
                    ...handlePaint(handleStyle, rowInk),
                    data: d,
                    index: i,
                    series,
                    // Dropped by the engine where no live edit reaches the row.
                    rowHandle,
                    // The axis a sweep measures along.
                    sweepAxis: domainAxis
                });
            });

            return nodes;
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function line(options = {}) {
    return buildLine(options);
}

/**
 * Value on y, domain on x (the usual time series); sweep along x. Domain-ordered.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function lineY(options = {}) {
    return line({ ...options, orientation: 'vertical' });
}

/**
 * Value on x, domain on y; sweep along y. Domain-ordered.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function lineX(options = {}) {
    return line({ ...options, orientation: 'horizontal' });
}

/**
 * A free 2-D path: `line` with `connect: 'sequence'` as the default, so points
 * join in array order (a lasso, a drawn trace, a connected scatter).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function path(options = {}) {
    return buildLine(options, 'sequence');
}
