// @ts-check
import { baselineOf } from '../core/scales.js';
import { encodeChannel, encodeValue, categorySlot, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, handlePaint, markCommon, resolveValueAxis, orientationOf, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { groupByPosition, stackLayout, stackDescriptor } from './stack.js';

// bar: a rect per row. The category axis sets position and thickness; the value
// axis sets length from the baseline.
//
//   x: band,   y: linear  -> vertical bars   (barY)
//   x: linear, y: band     -> horizontal bars (barX)
//
// `bar` resolves orientation through `resolveValueAxis` (span channels, then a
// band-kind scale, then which of x/y is bound) unless `orientation` is given.
//
// A span (x1/x2 or y1/y2) places the bar between two values instead of from the
// baseline. `stack: true` stacks rows that share a category; the `series` channel
// decides the grouping. Span wins over stack.

/**
 * Stack order within one band: data order, or first-seen series key order when
 * there is a series field, so a series sits at the same height in every band.
 * Ties keep data order; an unseen key sorts last.
 * @param {number[]} members global row indices, in data order
 * @param {any[]} data
 * @param {string | null} seriesField
 * @returns {number[]}
 */
function orderMembers(members, data, seriesField) {
    if (!seriesField) return members;
    /** @type {any[]} */
    const seriesOrder = [];
    for (const d of data) {
        const s = d[seriesField];
        if (!seriesOrder.includes(s)) seriesOrder.push(s);
    }
    const rank = (/** @type {number} */ gi) => {
        const at = seriesOrder.indexOf(data[gi][seriesField]);
        return at < 0 ? seriesOrder.length : at;
    };
    return [...members].sort((a, b) => rank(a) - rank(b));
}

/**
 * Cumulative data-space bounds for stacked bars, keyed by row index, plus each
 * band's members so a segment can stamp what a stack edit needs. Grouping and
 * accumulation come from plot/stack.js.
 * @param {any[]} data
 * @param {Record<string, any>} channels
 * @param {'x' | 'y'} catChannel the band axis
 * @param {string | undefined} catKey its xKey/yKey fallback
 * @param {string | undefined} valueKey the magnitude column
 * @param {string | null} seriesField
 * @returns {Map<number, { y0: number, y1: number, members: number[], local: number }>}
 */
function stackOffsets(data, channels, catChannel, catKey, valueKey, seriesField) {
    /** @type {Map<number, { y0: number, y1: number, members: number[], local: number }>} */
    const out = new Map();
    // A nested offset is part of the grouping: a stacked grouped bar stacks per sub-band.
    const grouping = [catChannel, catChannel === 'x' ? 'xOffset' : 'yOffset'];
    for (const group of groupByPosition(data, channels, grouping, { [catChannel]: catKey })) {
        const members = orderMembers(group.members, data, seriesField);
        const { bounds } = stackLayout(members, data, valueKey);
        members.forEach((gi, local) => {
            out.set(gi, { y0: bounds[local][0], y1: bounds[local][1], members, local });
        });
    }
    return out;
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function bar(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'bar',
        allow: MARK_OPTIONS.bar,
    });
    const {
        channels = {},
        edits,
        orientation: orientationOption,
        stack,
        // Dots on the interior boundaries between stacked segments (node.edge),
        // grabbed by edit.stack.*. Drawn only when a stack edit is wired.
        handles = true,
        handleSize,
        handleColor,
        // { stops, direction }, stamped on each rect as `fillGradient`.
        gradient,
        // Corner radius in px; defaults to the theme's `marks.bar.rx`.
        rx: rxOpt,
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);
    // Span mode: both endpoint channels declared on that axis.
    const hasXSpan = !!(channels.x1 && channels.x2);
    const hasYSpan = !!(channels.y1 && channels.y2);
    // The `series` channel groups the stack; `stack` only switches it on.
    const seriesField = stack ? seriesFieldOf(channels) : null;
    const doStack = !!stack && !hasXSpan && !hasYSpan;

    const markEdits = edits || [];
    // Boundary handles address a row pair (loIndex/hiIndex), so only stack edits use them.
    const hasStackEdit = markEdits.some((/** @type {any} */ e) => e && e.scope === 'stack');

    return {
        ...markCommon(opts),
        type: 'bar',
        channels,
        // The grouping key is read off the datum, never scaled.
        rawChannels: ['series'],
        edits: markEdits,
        // Capability for edit.stack.*: only a stacked bar partitions a total.
        supportsStack: doStack,
        discreteScale: 'band',
        xKey,
        yKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {
            const { x: xScale, y: yScale } = scales;

            const orientation = orientationOf(resolveValueAxis(channels, scales, { orientation: orientationOption }));

            const horizontal = orientation === 'horizontal';
            const catChannel = horizontal ? 'y' : 'x';
            const valueChannel = horizontal ? 'x' : 'y';
            const catKey = horizontal ? yKey : xKey;
            const valueKey = horizontal ? xKey : yKey;
            const hasSpan = horizontal ? hasXSpan : hasYSpan;
            const baseline = baselineOf(horizontal ? xScale : yScale);

            const stacks = doStack
                ? stackOffsets(currentData, channels, catChannel, catKey, valueKey, seriesField)
                : null;

            // Theme defaults. A stacked bar also gets a seam stroke so abutting
            // segments of one hue stay distinct.
            const barDefaults = markDefaults(scales, 'bar', doStack
                ? { fill: themeOf(scales).ink, stroke: themeOf(scales).handleStroke, strokeWidth: 1 }
                : { fill: themeOf(scales).ink });
            const rx = rxOpt ?? barDefaults.rx;

            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });

            // Pointer -> cumulative value goes straight through the value scale.
            // Pure data, not a closure: edit/stack.js re-derives from live data.
            /** @type {any} */
            const geometry = { kind: 'linear', axis: valueChannel };
            /** @param {number} i @returns {any} */
            const stampOf = (i) => {
                const s = stacks && stacks.get(i);
                return s ? stackDescriptor({ members: s.members, local: s.local, field: valueKey, geometry }) : undefined;
            };

            /** @type {import('../types').FeatureNode[]} */
            const nodes = currentData.flatMap((d, i) => {
                // No category (or no nested offset category): draw no bar. A missing
                // value keeps a zero-height bar at the baseline that a nearest pick can lift.
                if (missingValue(channels, catChannel, d)) return [];
                if (missingValue(channels, catChannel === 'x' ? 'xOffset' : 'yOffset', d)) return [];
                const style = resolveStyle(scales, channels, d, barDefaults, i, currentData);
                const stamp = stampOf(i);

                // The category's band, or its sub-band under an offset.
                const { start: bandStart, width: thickness } = categorySlot(scales, channels, catChannel, d, catKey, i, currentData);
                let lo, hi;
                if (hasSpan) {
                    const v1 = encodeChannel(scales, channels, `${valueChannel}1`, d, baseline, i, currentData);
                    const v2 = encodeChannel(scales, channels, `${valueChannel}2`, d, baseline, i, currentData);
                    lo = Math.min(v1, v2);
                    hi = Math.max(v1, v2);
                } else if (stacks) {
                    // Stack bounds are data-space values, encoded through the value scale.
                    const { y0, y1 } = stacks.get(i) || { y0: 0, y1: d[valueKey] };
                    const p0 = encodeValue(scales, channels, valueChannel, y0, baseline);
                    const p1 = encodeValue(scales, channels, valueChannel, y1, baseline);
                    lo = Math.min(p0, p1);
                    hi = Math.max(p0, p1);
                } else {
                    const valuePos = encodeChannel(scales, channels, valueChannel, d, baseline, i, currentData);
                    lo = Math.min(valuePos, baseline);
                    hi = Math.max(valuePos, baseline);
                }
                return {
                    type: 'rect',
                    ...(gradient ? { fillGradient: gradient } : {}),
                    ...(rx ? { rx } : {}),
                    ...(horizontal
                        ? { x: lo, y: bandStart, width: hi - lo, height: thickness }
                        : { x: bandStart, y: lo, width: thickness, height: hi - lo }),
                    ...style,
                    data: d,
                    index: i,
                    orientation,
                    bandAxis: catChannel, // proximity measures distance along the category axis
                    ...(stamp ? { stack: stamp } : {})
                };
            });

            // Boundary handles: n-1 per band of n segments (the baseline and total
            // are not boundaries). Each carries the pair it separates and the stack stamp.
            if (stacks && hasStackEdit && handleStyle.grabbable) {
                /** @type {Set<number[]>} */
                const seen = new Set();
                for (const entry of stacks.values()) {
                    const members = entry.members;
                    if (seen.has(members)) continue;   // one pass per band, not per row
                    seen.add(members);

                    const rep = currentData[members[0]];
                    const slot = categorySlot(scales, channels, catChannel, rep, catKey, members[0], currentData);
                    const centre = slot.start + slot.width / 2;

                    for (let local = 0; local < members.length - 1; local++) {
                        const gi = members[local];
                        const cum = stacks.get(gi);
                        if (!cum) continue;
                        const at = encodeValue(scales, channels, valueChannel, cum.y1, baseline);
                        nodes.push({
                            type: 'circle',
                            cx: valueChannel === 'x' ? at : centre,
                            cy: valueChannel === 'x' ? centre : at,
                            r: handleStyle.size,
                            ...handlePaint(handleStyle),
                            cursor: 'grab',
                            data: currentData[gi],
                            index: gi,
                            // Read by edit.stack.edge / .merge.
                            edge: true,
                            loIndex: gi,
                            hiIndex: members[local + 1],
                            stack: stackDescriptor({ members, local, field: valueKey, geometry }),
                        });
                    }
                }
            }

            return nodes;
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function barY(options = {}) {
    return bar({ ...options, orientation: 'vertical' });
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function barX(options = {}) {
    return bar({ ...options, orientation: 'horizontal' });
}
