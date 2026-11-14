// @ts-check
// rule: a straight line across the plot at a value on one axis.
//
//   ruleY({ channels: { y: { datum: 50 } } })  -> horizontal line at y = 50
//   ruleY({ channels: { y: { field: 'target' } } })  -> one line per datum
//
// Span mode: an endpoint pair (y1/y2 or x1/x2) draws a segment between them at
// the row's category on the other axis (a stem, a whisker). A missing endpoint
// defaults to the value-axis baseline.
// No `pointerEvents` here on purpose: the engine silences a rule with no edit.

import { baselineOf, isBand } from '../core/scales.js';
import { encodeChannel, categorySlot, resolveStyle, normalizeMarkOptions, positionalKeys, markCommon, markDefaults, themeOf, resolveValueAxis, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rule(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'rule', allow: MARK_OPTIONS.rule });
    const { channels = {}, discreteScale } = opts;

    // Span mode, decided once per mark: any y1/y2 (or x1/x2) endpoint switches it on.
    const hasYSpan = !!(channels.y1 || channels.y2);
    const hasXSpan = !!(channels.x1 || channels.x2);
    const spanAxis = hasYSpan ? 'y' : hasXSpan ? 'x' : null;

    // The value axis, decided at factory time (no scales): forced by ruleX/ruleY,
    // else from the declared channels.
    const valueAxis = resolveValueAxis(channels, null, { orientation: opts.orientation, extent: 'span', single: 'value' });

    // A rule bound to no field draws one line, not one per row.
    const constant = !Object.values(channels).some((/** @type {any} */ c) => c && c.field != null);
    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        type: 'rule',
        channels,
        // Left undefined so a composite can stamp its own.
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
                const style = resolveStyle(scales, channels, datum || {},
                    markDefaults(scales, 'rule', { stroke: themeOf(scales).ink, strokeWidth: 1 }),
                    index, currentData);

                // Span mode: a segment between two endpoints on spanAxis; a
                // missing endpoint falls to the value-axis baseline.
                if (spanAxis) {
                    const posAxis = spanAxis === 'y' ? 'x' : 'y';
                    const posLen = posAxis === 'x' ? width : height;
                    const baseline = baselineOf(scales[spanAxis]);
                    const [c1, c2] = spanAxis === 'y' ? ['y1', 'y2'] : ['x1', 'x2'];
                    // No segment for a row missing its position or every bound endpoint.
                    if (missingValue(channels, posAxis, datum)) return;
                    const bound = [c1, c2].filter((c) => channels[c] && channels[c].field != null);
                    if (bound.length && bound.every((c) => missingValue(channels, c, datum))) return;
                    const a = channels[c1] ? encodeChannel(scales, channels, c1, datum, baseline, index, currentData) : baseline;
                    const b = channels[c2] ? encodeChannel(scales, channels, c2, datum, baseline, index, currentData) : baseline;
                    if (a === undefined || b === undefined) return;
                    // Perpendicular position: category centre on a band axis, else encodeChannel.
                    const posScale = scales[posAxis];
                    let posAt = posLen / 2;
                    if (channels[posAxis]) {
                        if (isBand(posScale)) {
                            const catKey = posAxis === 'x' ? xKey : yKey;
                            // The band's centre, or its sub-band's under a nested offset.
                            const slot = categorySlot(scales, channels, posAxis, datum, catKey, index, currentData, 0);
                            posAt = slot.start + slot.width / 2;
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
                nodes.push(node);
            };

            if (constant) emit(null, -1);
            else currentData.forEach(emit);
            return nodes;
        }
    };
}

/**
 * A horizontal reference line at a y value (spans the full width).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ruleY(options = {}) {
    return rule({ ...options, orientation: 'vertical' });
}

/**
 * A vertical reference line at an x value (spans the full height).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function ruleX(options = {}) {
    return rule({ ...options, orientation: 'horizontal' });
}
