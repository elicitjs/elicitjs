// @ts-check
// trend.js: a parametric line. A row { intercept, slope } draws
// y = intercept + slope*x, clipped to the plot, plus handles:
//   - an intercept handle at x = anchor (0 when in the x domain, else the domain
//     start). Dragging it moves the line vertically and holds the slope.
//   - slope handles. `grip: 'end'` (default) puts one at each end of the drawn line;
//     a drag rotates about the anchor through the pointer, so any angle is
//     reachable. There are two because the far end swaps sides as the line passes
//     vertical. `grip: 'probe'` puts one handle at x = `probe` instead.
//
//   Elicit({ schema: { x: { type: 'quantitative', domain: [-10, 10] },
//                      y: { type: 'quantitative', domain: [-10, 10] } },
//            data: [{ intercept: 0, slope: 1 }],
//            marks: [ trend({ channels: {
//              intercept: { field: 'intercept', edit: edit.trend.intercept() },
//              slope:     { field: 'slope',     edit: edit.trend.slope({ stage: 1 }) },
//            }}) ] })
//
// `x`/`y` name the plot's axes, not fields of the row. `intercept` and `slope` are
// unscaled channels (renameable, or pinned with `{ datum }`). The shared model is
// in plot/trendGeometry.js. The mark is inert until an edit is attached.
//
// Both handle kinds live on one feature over one row, so each carries a `channel`
// tag ('intercept' | 'slope') that the trend edits claim.

import { resolveStyle, normalizeMarkOptions, markDefaults, encodeValue, positionalKeys, resolveHandles, handlesAreAffordance, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { trendChannels, trendRequires, warnProbeIgnored, readParams, anchorsOf, lineSegment, segmentEnds, valueAt } from './trendGeometry.js';

/**
 * @param {import('../types').TrendOptions} [options]
 * @returns {import('../types').Mark}
 */
export function trend(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'trend',
        allow: MARK_OPTIONS.trend
    });
    const {
        edits,
        anchor: anchorOpt,
        probe: probeOpt,
        grip = 'end',
        handles = true,
        handleSize,
        handleColor,
    } = opts;

    // `probe` is the pinned grip's column, and nothing else reads it.
    warnProbeIgnored('trend', 'slope', "the line's own ends", probeOpt, grip);

    const channels = trendChannels(opts.channels || {});
    const anchors = { anchor: anchorOpt, probe: probeOpt };
    // Grips are row handles unless an inert trend states `handles: true` (ink).
    const rowHandle = handlesAreAffordance(opts.handles, { edits, channels });

    return {
        ...markCommon(opts),
        type: 'trend',
        channels,
        // Signals autoAxes to cross at the origin when the chart leaves `axes` unset.
        isTrend: true,
        supportsTrend: true,
        ...positionalKeys(channels),
        // build() bails to [] without both continuous axes; this says why.
        requires: trendRequires(),
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            if (!scales.x || !scales.y) return [];
            const { anchor, probe } = anchorsOf(scales, anchors);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const trendDefaults = markDefaults(scales, 'trend', { stroke: '#333', fill: '#333' });
            // The mark's ink is the handle fallback.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor },
                { fill: trendDefaults.fill });

            currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                // No intercept or slope: draw nothing.
                if (missingValue(channels, 'intercept', d) || missingValue(channels, 'slope', d)) return;
                const params = readParams(d, channels, scales, i, currentData);
                const style = resolveStyle(scales, channels, d, trendDefaults, i, currentData);

                const clipped = lineSegment(params, scales, channels, width, height);
                if (clipped) {
                    nodes.push({
                        type: 'line',
                        ...clipped,
                        stroke: style.stroke || trendDefaults.stroke,
                        strokeWidth: style.strokeWidth || 2,
                        // Chrome: must not swallow the handles' drags.
                        pointerEvents: 'none'
                    });
                }

                if (!handleStyle.grabbable) return;
                // Each handle carries anchor/probe/grip, so the edit pivots where the
                // handle sits without repeating `anchor` on the edit.
                const handle = (/** @type {string} */ channel, /** @type {number} */ cx, /** @type {number} */ cy) => {
                    nodes.push({
                        type: 'circle',
                        cx, cy,
                        r: handleStyle.size,
                        fill: handleStyle.visible ? (handleColor || style.fill || handleStyle.fill) : 'transparent',
                        data: d, index: i, channel,
                        anchor, probe, grip,
                        rowHandle, // dropped where no live edit reaches the row
                    });
                };

                // Intercept handle at the pivot.
                handle('intercept',
                    encodeValue(scales, channels, 'x', anchor, 0),
                    encodeValue(scales, channels, 'y', valueAt(params, anchor), 0));

                if (grip === 'probe') {
                    handle('slope',
                        encodeValue(scales, channels, 'x', probe, 0),
                        encodeValue(scales, channels, 'y', valueAt(params, probe), 0));
                    return;
                }
                // A grip at each end of the drawn line, inset from the plot edge.
                // No segment (line misses the plot) means no grips.
                for (const end of segmentEnds(clipped, handleStyle.size + 1) || []) {
                    handle('slope', end.x, end.y);
                }
            });
            return nodes;
        }
    };
}
