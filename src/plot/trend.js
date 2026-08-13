// @ts-check
// trend.js — a PARAMETRIC line mark. A datum { intercept, slope } is a belief about
// a linear relationship, and the mark draws y = intercept + slope*x across the plot
// (clipped to the plot rectangle) plus two handles:
//   - an INTERCEPT handle at x = anchor (default 0 when that lies in the x domain,
//     else the domain's first end): dragging it translates the line vertically
//     (holds slope), setting the value there — the classic y-intercept when anchor
//     is 0.
//   - a pair of SLOPE handles, one at each END of the drawn line: dragging either
//     rotates the line about the anchor point (holds the anchor's value), and the
//     line follows the pointer, so it swings through the full circle.
// Stage the two edits to elicit intercept first, then slope:
//
//   Elicit({ schema: { x: { type: 'quantitative', domain: [-10, 10] },
//                      y: { type: 'quantitative', domain: [-10, 10] } },
//            data: [{ intercept: 0, slope: 1 }],
//            marks: [ trend({ channels: {
//              intercept: { field: 'intercept', edit: edit.trend.intercept() },
//              slope:     { field: 'slope',     edit: edit.trend.slope({ stage: 1 }) },
//            }}) ] })
//
// Trend is the one mark whose POSITIONAL channels name the plot's AXES rather than
// fields of its datum: the belief is about the relationship between x and y, while
// the datum stores the two parameters of the line. So `x`/`y` default to the fields
// of the same name and the schema supplies their domains, and the line's endpoints
// and both handles are derived from that coordinate space.
//
// The parameters are their own channels — `intercept` and `slope`, defaulting to
// the fields of the same name — so the columns are renameable like any other field
// (`channels: { slope: { field: 'r' } }`), or PINNED to a constant
// (`intercept: { datum: 0 }`), which is all a correlation belief is. They are
// UNSCALED: parameters in their own units, projected through x/y rather than
// encoded themselves. See plot/trendGeometry.js for the whole model, which this
// mark shares with `trendBand` — the band around this line.
//
// By default (when the chart leaves `axes` unspecified), autoAxes detects a trend
// and crosses the axes at the origin — the natural frame for intercept + slope.
//
// ── Where the slope handle sits, and why it is a PAIR ───────────────────────
// `grip: 'end'` (the default) mounts the slope handles on the line's own ENDS —
// where the drawn, clipped segment meets the plot edge — and a drag on one passes
// the line through the pointer. That is what makes a full rotation possible: the
// old handle was pinned to x = `probe` and only its y followed, so the reachable
// slope was capped at `ySpan / (probe - anchor)`, vertical was unreachable, and a
// steep line walked its own grab target off the top of the plot (the line is
// clipped; the handle was not).
//
// TWO handles, not one, because a line's "far end" genuinely swaps sides as it
// passes vertical: a single end-mounted grip would teleport across the plot
// mid-drag. Drawn at both ends the circles simply slide around the plot border and
// trade roles — continuous motion, and `build()` needs to know nothing about the
// pointer to get it. Both carry `channel: 'slope'`, so either drives the one edit.
//
// `grip: 'probe'` is the old behaviour: ONE handle at x = `probe`, sliding
// vertically at that column. `probe` means nothing under the default grip, and the
// mark says so rather than ignoring it in silence.
//
// Affordance map (attach edit.trend.intercept / .slope yourself — mark is inert):
//   line chrome          → pointer-transparent (not a grab target)
//   circle at `anchor`   → channel:'intercept' (default x=0-in-domain or domain start)
//   circle at each END   → channel:'slope' (grip: 'end', the default)
//   circle at `probe`    → channel:'slope' (grip: 'probe'; the other domain end)
//   handles: true|false|'hit' — shared contract; false emits no handles
//
// The line is a non-interactive visual and each handle is a draggable circle tagged
// with a `channel` ('intercept' | 'slope'); the two edits claim their own tag, so
// grabbing one handle never moves the other. Trend needs that arbitration because
// BOTH handles live on ONE feature over ONE datum, so a drag fans to both of its
// direct edits. (A glyph whose handles are separate marks — see `composite` — needs
// none of it: dispatch already routes a gesture to the touched node's own feature.)
//
// ── A trend is INERT until you say what it edits ────────────────────────────
// Like every other mark. `trend()` draws the line and its handles; it writes nothing
// until an `edit` is attached to a parameter channel:
//
//   trend({ channels: {
//     intercept: { field: 'intercept', edit: edit.trend.intercept() },
//     slope:     { field: 'slope',     edit: edit.trend.slope({ stage: 1 }) },
//   }})
//
// This mark used to attach those two edits ITSELF, unconditionally — `trend({ edits:
// [] })` was still draggable, and nothing in the spec said which columns a gesture
// would write. Which column an interaction writes is the one thing the channel map
// exists to state, and a default that cannot be turned off is not a default. Staging
// goes on the edit (`edit.trend.slope({ stage: 1 })`), like every other edit's stage.

import { resolveStyle, normalizeMarkOptions, markDefaults, encodeValue, positionalKeys, resolveHandles, markCommon} from './mark.js';
import { paramChannels, readParams, anchorsOf, lineSegment, segmentEnds, valueAt } from './trendGeometry.js';
import { warn } from '../core/dev.js';

/**
 * @param {import('../types').TrendOptions} [options]
 * @returns {import('../types').Mark}
 */
export function trend(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'trend',
        allow: ['anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor']
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

    // `probe` is the pinned grip's column, and nothing else reads it. Silently
    // accepting it under the default grip would leave an author moving a handle
    // that isn't there.
    if (probeOpt != null && grip !== 'probe') {
        warn('trend:probe-ignored',
            "trend(): `probe` places the slope handle only under `grip: 'probe'`. "
            + "The default grip mounts the handles on the line's own ends; add "
            + "`grip: 'probe'` to pin one at that column instead.");
    }

    const channels = paramChannels(opts.channels || {}, {
        intercept: { field: 'intercept' },
        slope: { field: 'slope' }
    });
    const anchors = { anchor: anchorOpt, probe: probeOpt };

    return {
        ...markCommon(opts),
        markName: 'trend',
        channels,
        // Signals autoAxes to cross at the origin when the chart leaves `axes` unset.
        isTrend: true,
        supportsTrend: true,
        ...positionalKeys(channels),
        // A trend is PARAMETRIC: its line is evaluated at the x domain's ends, not
        // read off any row, so it cannot draw at all without both continuous axes.
        // build() bails to [] in that case — which looks exactly like a spec that
        // silently failed to render, so the engine says why (warnScaleRequirements).
        requires: [{
            channels: ['x', 'y'],
            kind: 'continuous',
            mode: 'all',
            why: 'an intercept and a slope are only defined over two continuous axes.',
        }],
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
            // Shared handle contract (plot/mark.js). The mark's own ink stays the
            // fallback, so a themed trend keeps its colour.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor },
                { fill: trendDefaults.fill });

            currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                const params = readParams(d, channels, scales, i, currentData);
                const style = resolveStyle(scales, channels, d, trendDefaults, i, currentData);

                const clipped = lineSegment(params, scales, channels, width, height);
                if (clipped) {
                    nodes.push({
                        type: 'line',
                        ...clipped,
                        stroke: style.stroke || trendDefaults.stroke,
                        strokeWidth: style.strokeWidth || 2,
                        // Chrome: the line is derived from the two handles, never
                        // grabbed itself, so it must not swallow their drags.
                        pointerEvents: 'none'
                    });
                }

                if (!handleStyle.grabbable) return;
                // Every handle carries the MARK's anchor/probe and its grip, so an edit
                // pivots exactly where the handle it grabbed sits and reads the gesture
                // the way that handle affords — the author sets `anchor` once, on the
                // mark that draws the handle, and never has to repeat it on the edit to
                // keep the two in sync. (The same node-as-transport pattern arc uses
                // for `pivotX/pivotY` and waffle for `grid`.)
                const handle = (/** @type {string} */ channel, /** @type {number} */ cx, /** @type {number} */ cy) => {
                    nodes.push({
                        type: 'circle',
                        cx, cy,
                        r: handleStyle.size,
                        fill: handleStyle.visible ? (style.fill || handleStyle.fill) : 'transparent',
                        data: d, index: i, channel,
                        anchor, probe, grip
                    });
                };

                // The intercept handle FIRST, at the pivot: it is the one handle whose
                // place is fixed by the anchor rather than by the line's angle.
                handle('intercept',
                    encodeValue(scales, channels, 'x', anchor, 0),
                    encodeValue(scales, channels, 'y', valueAt(params, anchor), 0));

                if (grip === 'probe') {
                    handle('slope',
                        encodeValue(scales, channels, 'x', probe, 0),
                        encodeValue(scales, channels, 'y', valueAt(params, probe), 0));
                    return;
                }
                // One grip at each end of the DRAWN line, inset so the circle isn't
                // half-cut by the plot edge it sits on. No clipped segment means the
                // line misses the plot entirely — there is nothing to grab.
                for (const end of segmentEnds(clipped, handleStyle.size + 1) || []) {
                    handle('slope', end.x, end.y);
                }
            });
            return nodes;
        }
    };
}
