// @ts-check
import { isBand } from '../core/scales.js';
import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, markCommon} from './mark.js';

// line: a connected-path mark over an ordered set of points. It is deliberately
// GENERAL — a you-draw-it curve, a multi-series line chart, a connected scatter
// plot, and a hand-drawn 2D path are the same mark along four orthogonal knobs:
//
//   grouping  `series` (alias `z`)  -> which points form one line (defaults to
//                                       the stroke field, so lines auto-colour)
//   ordering  `order`               -> 'domain'   : sort each series by the domain
//                                                    axis (a function / time series)
//                                       'sequence' : connect in creation/array order
//                                                    (connected scatter, map path)
//                                       <field>    : sort by that field
//   editing   the edits on the handles (drag direct/nearest/sweep) — not set here
//   creation  anchor()/newSeries() primitives (see edit/index.js)
//
// Unlike one-node-per-datum marks, `build` emits (per series) one non-interactive
// `path` connector drawn UNDER the handles, plus one indexed circle HANDLE per
// datum. Handles are ordinary marks, so drag / nearest-pick / sweep / create /
// remove / constraints / style all reuse the shared machinery. Handles are always
// emitted (for hit-testing) and merely hidden when `handles: false`.
//
//   x: domain, y: value  -> lineY (time series)      x: value, y: domain -> lineX
//
// `line` auto-detects the value axis; `lineY`/`lineX` force one. `path` is the
// same mark with `order: 'sequence'`, for an order-as-drawn 2D path.

const SINGLE = '__single__'; // group key when no series field is set

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedValueAxis which axis carries the value
 * @param {string} [defaultOrder] 'domain' (presets) or 'sequence' (scatter/path)
 * @returns {import('../types').Mark}
 */
function buildLine(options, forcedValueAxis, defaultOrder = 'domain') {
    // Desugar top-level style shorthands (stroke: '…', strokeWidth: …) into the
    // channels so line reads style the same way every mark does.
    const opts = normalizeMarkOptions(options, { mark: 'line', allow: ['curve', 'handles', 'handleSize', 'handleColor', 'order', 'samples', 'series', 'z'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        curve = 'linear',
        handles = true,
        handleSize,
        handleColor,
        order = defaultOrder,
        samples
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    const seriesField = seriesFieldOf(opts, channels);

    return {
        ...markCommon(opts),
        markName: 'line',
        channels,
        // A line's domain axis is continuous (a point per datum, no band width).
        discreteScale: 'point',
        xKey,
        yKey,
        seriesKey: seriesField,
        order,
        samples,
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
        build: (currentData, scales, width, height) => {
            const { x: xScale, y: yScale } = scales;

            // Which axis carries the value (the point's editable position)?
            //   explicit (lineY/lineX) wins; else a band axis is the domain, so
            //   the other axis is the value; else the axis carrying an `edit`;
            //   else default to value-on-y (the usual time series).
            let valueAxis = forcedValueAxis;
            if (!valueAxis) {
                if (isBand(xScale)) valueAxis = 'y';
                else if (isBand(yScale)) valueAxis = 'x';
                else if (channels.x && channels.x.edit && !(channels.y && channels.y.edit)) valueAxis = 'x';
                else valueAxis = 'y';
            }
            // The domain (sweep) axis is the other one.
            const domainAxis = valueAxis === 'y' ? 'x' : 'y';

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Per-datum pixel positions + series key, keeping the GLOBAL datum
            // index so edits address the right datum after grouping/sorting.
            const placed = currentData.map((d, i) => ({
                d,
                i,
                cx: encodeChannel(scales, channels, 'x', d, width / 2, i, currentData),
                cy: encodeChannel(scales, channels, 'y', d, height / 2, i, currentData),
                series: seriesField ? d[seriesField] : SINGLE
            }));

            // Group into series (first-seen order), preserving each group's
            // original data order so `order: 'sequence'` connects as drawn.
            /** @type {Map<any, typeof placed>} */
            const groups = new Map();
            for (const p of placed) {
                const g = groups.get(p.series);
                if (g) g.push(p); else groups.set(p.series, [p]);
            }

            // Default ink from the theme (steelblue unless the theme's `ink` or a
            // `marks.line` override changes it); the connector's stroke and the
            // handles' fill share it so a line and its handles read as one colour.
            const lineDefaults = markDefaults(scales, 'line', { stroke: themeOf(scales).ink, strokeWidth: 2 });

            // One connector path per series, its points ordered per `order`.
            for (const group of groups.values()) {
                if (group.length < 2) continue; // nothing to connect
                const pts = orderPoints(group, order, domainAxis, seriesField);
                const style = resolveStyle(scales, channels, group[0].d, lineDefaults, group[0].i, currentData);
                nodes.push({
                    type: 'path',
                    points: pts.map(p => /** @type {[number, number]} */([p.cx, p.cy])),
                    curve,
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
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor },
                { fill: lineDefaults.stroke });
                placed.forEach(({ d, i, cx, cy, series }) => {
                if (!handleStyle.grabbable) return;
                const style = resolveStyle(scales, channels, d, {
                    fill: handleStyle.fill,
                    stroke: handleStyle.stroke,
                    strokeWidth: handleStyle.strokeWidth,
                }, i, currentData);
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
 * Order one series' points for its connecting path.
 *   'domain'   -> sort by the domain-axis pixel (a monotonic function / series)
 *   'sequence' -> array order as-is (connect as drawn)
 *   <field>    -> sort by that data field
 * @param {any[]} group
 * @param {string} order
 * @param {'x' | 'y'} domainAxis
 * @param {string | null} seriesField
 * @returns {any[]}
 */
function orderPoints(group, order, domainAxis, seriesField) {
    if (order === 'sequence') return group;
    if (order === 'domain') {
        const key = domainAxis === 'x' ? 'cx' : 'cy';
        return [...group].sort((a, b) => a[key] - b[key]);
    }
    // A named field to sort by.
    return [...group].sort((a, b) => {
        const av = a.d[order], bv = b.d[order];
        return av < bv ? -1 : av > bv ? 1 : 0;
    });
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function line(options = {}) {
    return buildLine(options, null);
}

/**
 * Value on y, domain on x (the usual time series); sweep along x. Domain-ordered.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function lineY(options = {}) {
    return buildLine(options, 'y');
}

/**
 * Value on x, domain on y; sweep along y. Domain-ordered.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function lineX(options = {}) {
    return buildLine(options, 'x');
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
    return buildLine(options, null, 'sequence');
}
