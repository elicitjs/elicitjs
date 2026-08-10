// @ts-check
// rule: a straight reference line across the plot at a value on one axis, built on
// the shared mark foundation like every other mark.
//
//   ruleY({ channels: { y: { datum: 50 } } })  -> horizontal line at y = 50
//   ruleX({ channels: { x: { datum: 30 } } })  -> vertical line at x = 30
//   ruleY({ channels: { y: { field: 'target' } } })  -> one line per datum
//
// `datum` is a DATA-space constant: it goes through the y scale, so the line lands
// where y=50 is. (`value` would be 50 pixels — see mark.js.) For a one-off
// chart-level reference line, guides.rule is the ergonomic form; `rule` is the mark,
// and it earns its keep when the line is per-datum or is a span.
//
// SPAN mode (Observable Plot's ruleX/ruleY with y1/y2 or x1/x2): declaring a pair
// of endpoint channels draws a SEGMENT between them at the datum's category on the
// other axis, rather than a full-extent line — a lollipop stem or an error-bar
// whisker. It mirrors bar's span model (see bar.js): the endpoints resolve through
// encodeChannel exactly like bar's x1/x2·y1/y2, a missing endpoint defaults to the
// value-axis baseline (so `y2` alone spans baseline -> y2), and the perpendicular
// position comes from the category channel via categoryOf (band centre), the same
// path every other band mark uses.
//
// A rule is an ordinary editable mark: put an `edit` on an endpoint channel and its
// cap becomes a handle. It carries no pointerEvents of its own — the engine silences
// any mark with no direct-pick edit, so an inert whisker cannot swallow a sibling
// handle's drag while an editable one still receives its own.

import { baselineOf, isBand, bandStartOf, bandwidthOf } from '../core/scales.js';
import { encodeChannel, categoryOf, resolveStyle, normalizeMarkOptions, positionalKeys, markCommon} from './mark.js';

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedValueAxis which axis carries the value
 * @returns {import('../types').Mark}
 */
function buildRule(options, forcedValueAxis) {
    // Desugar style shorthands (stroke, strokeWidth, opacity) into constant
    // channels, so a rule reads style the same way every mark does.
    const opts = normalizeMarkOptions(options, { mark: 'rule', allow: ['strokeDasharray', 'discreteScale'] });
    const { channels = {}, id, edits, constraints, strokeDasharray, discreteScale } = opts;

    // Span mode: a pair of endpoint channels on one axis draws a segment between
    // them (a stem / whisker), positioned at the datum's category on the other.
    // Decided once per mark (not per datum), like bar's span. The presence of a
    // y1/y2 (or x1/x2) endpoint — distinct channel names from the reference-line
    // x/y — is the switch; a lone endpoint spans from the value-axis baseline.
    const hasYSpan = !!(channels.y1 || channels.y2);
    const hasXSpan = !!(channels.x1 || channels.x2);
    const spanAxis = hasYSpan ? 'y' : hasXSpan ? 'x' : null;

    // Which axis carries the value? Forced by ruleX/ruleY; else inferred from
    // whichever of x / y the mark declares a channel on.
    const valueAxis = forcedValueAxis || (channels.x ? 'x' : 'y');

    // A rule bound to no field at all is a single reference line, not one line per
    // row — otherwise `ruleY({ channels: { y: { datum: 25 } } })` would stack N
    // identical lines on a chart with N rows.
    const constant = !Object.values(channels).some((/** @type {any} */ c) => c && c.field != null);
    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'rule',
        channels,
        // A rule spans; it has no opinion about the discrete scale of the axis it
        // crosses. Left undefined so a composite can stamp its own onto it.
        discreteScale,
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
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            /** @param {any} datum @param {number} index */
            const emit = (datum, index) => {
                const style = resolveStyle(scales, channels, datum || {}, {
                    stroke: 'black', strokeWidth: 1
                }, index, currentData);

                // Span mode: a segment between two endpoints on spanAxis, at the
                // datum's category on the other axis. Endpoints resolve through
                // encodeChannel (like bar's span); a missing one falls to the
                // value-axis baseline, so `y2` alone spans baseline -> y2.
                if (spanAxis) {
                    const posAxis = spanAxis === 'y' ? 'x' : 'y';
                    const posLen = posAxis === 'x' ? width : height;
                    const baseline = baselineOf(scales[spanAxis]);
                    const [c1, c2] = spanAxis === 'y' ? ['y1', 'y2'] : ['x1', 'x2'];
                    const a = channels[c1] ? encodeChannel(scales, channels, c1, datum, baseline, index, currentData) : baseline;
                    const b = channels[c2] ? encodeChannel(scales, channels, c2, datum, baseline, index, currentData) : baseline;
                    if (a === undefined || b === undefined) return;
                    // Perpendicular position: category centre on a band axis (via
                    // categoryOf, so { fn }/{ datum } work), else encodeChannel.
                    const posScale = scales[posAxis];
                    let posAt = posLen / 2;
                    if (channels[posAxis]) {
                        if (isBand(posScale)) {
                            const catKey = posAxis === 'x' ? xKey : yKey;
                            const cat = categoryOf(channels, posAxis, datum, catKey, index, currentData);
                            posAt = bandStartOf(posScale, cat, 0) + bandwidthOf(posScale, 0) / 2;
                        } else {
                            posAt = encodeChannel(scales, channels, posAxis, datum, posLen / 2, index, currentData);
                        }
                    }
                    /** @type {import('../types').FeatureNode} */
                    const spanNode = {
                        type: 'line',
                        ...(spanAxis === 'y'
                            ? { x1: posAt, x2: posAt, y1: a, y2: b }
                            : { x1: a, x2: b, y1: posAt, y2: posAt }),
                        ...style,
                        data: datum,
                        index
                    };
                    if (strokeDasharray != null) spanNode.strokeDasharray = strokeDasharray;
                    nodes.push(spanNode);
                    return;
                }

                const at = encodeChannel(scales, channels, valueAxis, datum, undefined, index, currentData);
                if (at === undefined) return;

                /** @type {import('../types').FeatureNode} */
                const node = {
                    type: 'line',
                    ...(valueAxis === 'y'
                        ? { x1: 0, x2: width, y1: at, y2: at }
                        : { x1: at, x2: at, y1: 0, y2: height }),
                    ...style,
                    data: datum,
                    index
                };
                if (strokeDasharray != null) node.strokeDasharray = strokeDasharray;
                nodes.push(node);
            };

            if (constant) emit(null, -1);
            else currentData.forEach(emit);
            return nodes;
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rule(options = {}) {
    return buildRule(options, null);
}

/**
 * A horizontal reference line at a y value (spans the full width).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ruleY(options = {}) {
    return buildRule(options, 'y');
}

/**
 * A vertical reference line at an x value (spans the full height).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ruleX(options = {}) {
    return buildRule(options, 'x');
}
