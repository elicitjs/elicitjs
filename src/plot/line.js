// @ts-check
import { isBand } from '../core/scales.js';
import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, markCommon, rawChannel, orderFieldOf, resolveValueAxis, orderSeries, seriesKeyOf, hasAnyEdit, inkOf } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// line: a connected-path mark over an ordered set of points. It is deliberately
// GENERAL — a you-draw-it curve, a multi-series line chart, a connected scatter
// plot, and a hand-drawn 2D path are the same mark along four orthogonal knobs:
//
//   grouping  `series` channel      -> which points form one line (defaults to
//                                       the fill/stroke field, so lines auto-colour)
//   ordering  `order` CHANNEL       -> sort each series by that column
//             `connect` option      -> 'domain'   : sort by the domain axis
//                                                    (a function / time series)
//                                      'sequence' : connect in creation/array order
//                                                    (connected scatter, map path)
//   editing   the edits on the handles (drag direct/nearest/sweep) — not set here
//   creation  anchor()/newSeries() primitives (see edit/index.js)
//
// Unlike one-node-per-datum marks, `build` emits (per series) one non-interactive
// `path` connector drawn UNDER the handles, plus one indexed circle HANDLE per
// datum. Handles are ordinary marks, so drag / nearest-pick / sweep / create /
// remove / style all reuse the shared machinery. Handles are always
// emitted (for hit-testing) and merely hidden when `handles: false`.
//
//   x: domain, y: value  -> lineY (time series)      x: value, y: domain -> lineX
//
// `line` auto-detects the value axis; `lineY`/`lineX` force one. `path` is the
// same mark with `connect: 'sequence'`, for an order-as-drawn 2D path.

const SINGLE = '__single__'; // group key when no series field is set

/**
 * @param {any} options
 * @param {string} [defaultConnect] 'domain' (presets) or 'sequence' (scatter/path)
 * @returns {import('../types').Mark}
 */
function buildLine(options, defaultConnect = 'domain') {
    // Desugar top-level style shorthands (stroke: '…', strokeWidth: …) into the
    // channels so line reads style the same way every mark does.
    const opts = normalizeMarkOptions(options, { mark: 'line', allow: MARK_OPTIONS.line });
    const {
        channels = {},
        id,
        edits,
        curve = 'linear',
        // Handles draw only when something can grab them — an edit on a channel
        // or in `edits` — the rule bar and arc already follow. A plain recreation
        // used to need `handles: false` on every line to lose dots it never asked for.
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
        // `curve` is read raw (no scale), so it must be declared — same contract as
        // `link`, which resolves its own per-row `curve` the same way. It was a plain
        // option here and a raw channel there: one name, two tiers.
        rawChannels: ['curve', 'series', 'order'],
        // A line's domain axis is continuous (a point per datum, no band width).
        discreteScale: 'point',
        xKey,
        yKey,
        seriesKey: seriesField,
        connect,
        // Groups points into series, so the line-scoped edits (edit.line.*) apply.
        // The engine dev-warns if a line-scoped edit lands on a mark without this.
        supportsSeries: true,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build(currentData, scales, width, height) {
            // Handles draw only when something can grab them. Decided HERE, from the
            // feature as the engine holds it — a composite merges its edits into a
            // part after the factory ran, so a factory-time answer missed them.
            const handles = handlesOpt !== undefined ? handlesOpt
                : hasAnyEdit({ edits: this && this.edits, channels: (this && this.channels) || channels });
            const { x: xScale, y: yScale } = scales;

            // Which axis carries the value (the point's editable position)?
            //   explicit (lineY/lineX) wins; else a band axis is the domain, so
            //   the other axis is the value; else the axis carrying an `edit`;
            //   else default to value-on-y (the usual time series).
            // (A line whose x carried the only edit used to flip to value-on-x by that
            // fact alone — an orientation you could not see in the spec. State it:
            // lineX, or orientation: 'horizontal'.)
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation });
            // The domain (sweep) axis is the other one.
            const domainAxis = valueAxis === 'y' ? 'x' : 'y';

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Per-datum pixel positions + series key, keeping the GLOBAL datum
            // index so edits address the right datum after grouping/sorting.
            // A row with no VALUE has no position: its coordinate is null, which
            // breaks the path there (core/curves.js) and draws no handle. The domain
            // axis keeps the centre fallback, so a value-only row still sits on it.
            const placed = currentData.map((d, i) => ({
                d,
                i,
                cx: encodeChannel(scales, channels, 'x', d, valueAxis === 'x' ? null : width / 2, i, currentData),
                cy: encodeChannel(scales, channels, 'y', d, valueAxis === 'y' ? null : height / 2, i, currentData),
                series: seriesField ? d[seriesField] : SINGLE
            }));

            // Group into series (first-seen order), preserving each group's
            // original data order so `order: 'sequence'` connects as drawn. Grouped
            // by KEY (a Date by its time), tagged with the group's first raw value.
            /** @type {Map<any, typeof placed>} */
            const groups = new Map();
            for (const p of placed) {
                const k = seriesKeyOf(p.series);
                const g = groups.get(k);
                if (g) { g.push(p); p.series = g[0].series; } else groups.set(k, [p]);
            }

            // Default ink from the theme (steelblue unless the theme's `ink` or a
            // `marks.line` override changes it); the connector's stroke and the
            // handles' fill share it so a line and its handles read as one colour.
            const lineDefaults = markDefaults(scales, 'line', { stroke: themeOf(scales).ink, strokeWidth: 2 });

            // One connector path per series, its points ordered per `order`.
            for (const group of groups.values()) {
                if (group.length < 2) continue; // nothing to connect
                const pts = orderSeries(group, connect, domainAxis, channels);
                const style = resolveStyle(scales, channels, group[0].d, lineDefaults, group[0].i, currentData);
                // One path per SERIES, so a channel-bound curve resolves once per
                // series against that series' first row — the same rule a line's
                // paint channels already follow (see ChannelSpec.fn in types.d.ts).
                const seriesCurve = String(
                    rawChannel(channels, 'curve', group[0].d, curve, group[0].i, currentData));
                nodes.push({
                    type: 'path',
                    points: pts.map(p => /** @type {[number, number]} */([p.cx, p.cy])),
                    // The row behind each vertex, so a tip (or a readout) over the
                    // path can name the nearest one.
                    pointRows: pts.map((p) => p.i),
                    curve: seriesCurve,
                    ...style,
                    // A stroked path reads as a line, never a filled blob.
                    fill: 'none',
                    pointerEvents: 'none',
                    // Tag with the group so proximity can resolve WHICH line this is
                    // (measuring to the path, not just its handles).
                    series: group[0].series
                });
            }

            // Handles: an ordinary circle per datum, so edits/pick reuse the mark
            // machinery. Tagged with `series` so a sweep can scope to one line.
            // A handle is FILLED with its line's colour (the row's resolved stroke)
            // and ringed with the theme's handle stroke, so a handle on a coloured
            // series reads as that series — `handleColor` still overrides.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor },
                { fill: lineDefaults.stroke });
                placed.forEach(({ d, i, cx, cy, series }) => {
                if (!handleStyle.grabbable) return;
                if (cx == null || cy == null) return; // a missing value has no handle
                const paint = resolveStyle(scales, channels, d, lineDefaults, i, currentData);
                const style = {
                    fill: handleStyle.visible ? (handleColor || (channels.fill ? inkOf(paint.fill) : null) || inkOf(paint.stroke) || handleStyle.fill) : handleStyle.fill,
                    stroke: handleStyle.stroke,
                    strokeWidth: handleStyle.strokeWidth,
                };
                nodes.push({
                    type: 'circle',
                    cx,
                    cy,
                    // One `handles` vocabulary across marks (plot/mark.js): `false` is
                    // neither drawn nor grabbable. Invisible-but-grabbable is
                    // `handles: 'hit'` (transparent fill — not opacity:0).
                    r: handleStyle.size,
                    ...style,
                    ...(handleStyle.visible ? {} : {
                        fill: 'transparent',
                        stroke: 'none',
                        strokeWidth: 0,
                    }),
                    data: d,
                    index: i,
                    series,
                    // The domain axis a you-draw-it sweep measures distance along.
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
 * A free 2-D path: points connected in CREATION order, both axes free. Same mark
 * as `line`, with `order: 'sequence'` as the default instead of domain order.
 *
 * That is what a lasso, a drawn trace and a connected scatter all are — an ordered
 * sequence of points in the plane, rather than a value read against a domain axis.
 * The name describes the geometry, not the chart genre: this used to also be
 * exported as `connectedScatter`, which named one thing you can draw with it.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function path(options = {}) {
    return buildLine(options, 'sequence');
}
