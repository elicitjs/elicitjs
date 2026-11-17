// @ts-check
import { baselineOf } from '../core/scales.js';
import { encodeChannel, encodeValue, categorySlot, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, resolveHandles, handlePaint, markCommon, resolveValueAxis, orientationOf, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { groupByPosition, stackLayout, stackDescriptor, stackFieldOf, stackFieldSchema, stackOrder, orderMembers, checkStackChannel } from './stack.js';

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
// baseline. The `stack` channel stacks rows that share a band, in the order of
// its field's categories. Without it, rows that share a band overlap (warned).

/**
 * Cumulative data-space bounds for stacked bars, keyed by row index, plus each
 * band's members so a segment can stamp what a stack edit needs. Grouping,
 * order and accumulation come from plot/stack.js.
 * @param {any[]} data
 * @param {Record<string, any>} channels
 * @param {'x' | 'y'} catChannel the band axis
 * @param {string | undefined} catKey its xKey/yKey fallback
 * @param {string | undefined} valueKey the magnitude column
 * @param {string | null} stackField
 * @param {any[]} order the stack field's category order
 * @returns {Map<number, { y0: number, y1: number, members: number[], local: number }>}
 */
function stackOffsets(data, channels, catChannel, catKey, valueKey, stackField, order) {
    /** @type {Map<number, { y0: number, y1: number, members: number[], local: number }>} */
    const out = new Map();
    // A nested offset is part of the grouping: a stacked grouped bar stacks per sub-band.
    const grouping = [catChannel, catChannel === 'x' ? 'xOffset' : 'yOffset'];
    for (const group of groupByPosition(data, channels, grouping, { [catChannel]: catKey })) {
        const members = orderMembers(group.members, data, stackField, order);
        const { bounds } = stackLayout(members, data, valueKey);
        members.forEach((gi, local) => {
            out.set(gi, { y0: bounds[local][0], y1: bounds[local][1], members, local });
        });
    }
    return out;
}

/**
 * Warn when rows share a band with nothing to stack or dodge them: each bar starts
 * at the baseline, so all but the last are hidden. Rows with no value draw nothing
 * to hide, bars on opposite sides of zero don't cover each other, and translucent
 * bars are layered on purpose.
 * @param {any[]} data
 * @param {Record<string, any>} channels
 * @param {'x' | 'y'} catChannel
 * @param {'x' | 'y'} valueChannel
 * @param {string | undefined} catKey
 */
function warnOverlap(data, channels, catChannel, valueChannel, catKey) {
    const cat = channels[catChannel];
    if (!(cat && cat.field != null)) return;
    const translucent = ['opacity', 'fillOpacity'].some((c) => channels[c] && channels[c].value != null && channels[c].value < 1);
    if (translucent) return;
    const offset = catChannel === 'x' ? 'xOffset' : 'yOffset';
    const valueField = channels[valueChannel] && channels[valueChannel].field;
    for (const group of groupByPosition(data, channels, [catChannel, offset], { [catChannel]: catKey })) {
        const drawn = group.members.filter((i) => !missingValue(channels, catChannel, data[i])
            && !missingValue(channels, offset, data[i]) && !missingValue(channels, valueChannel, data[i]));
        const below = valueField != null ? drawn.filter((i) => Number(data[i][valueField]) < 0).length : 0;
        const above = drawn.length - below;
        if (Math.max(above, below) < 2) continue;
        warn('bar:overlap',
            `bar(): ${Math.max(above, below)} rows share the band "${group.rep[cat.field]}" and draw over ` +
            `each other. Bind the \`stack\` channel to stack them, or \`${offset}\` to place them side by side.`);
        return;
    }
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
    // The `stack` channel switches stacking on and names each segment.
    const stackField = stackFieldOf(channels);
    const doStack = !!stackField && !hasXSpan && !hasYSpan;
    if (stackField && !doStack) {
        warn('bar:stack:span', 'bar(): a span (x1/x2 or y1/y2) places each bar itself, so the `stack` channel is ignored.');
    }
    if (channels.series) {
        warn('bar:series', 'bar() has no `series` channel. To stack segments, bind `stack` to the field that names them.');
    }

    const markEdits = edits || [];
    // Boundary handles address a row pair (loIndex/hiIndex), so only stack edits use them.
    const hasStackEdit = markEdits.some((/** @type {any} */ e) => e && e.scope === 'stack');

    return {
        ...markCommon(opts),
        type: 'bar',
        channels,
        // The stack key is read off the datum, never scaled.
        rawChannels: ['stack'],
        edits: markEdits,
        // Capability for edit.stack.*: only a stacked bar partitions a total.
        supportsStack: doStack,
        discreteScale: 'band',
        xKey,
        yKey,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} [_width]
         * @param {number} [_height]
         * @param {any} [ctx]
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, _width, _height, ctx) => {
            const { x: xScale, y: yScale } = scales;

            const orientation = orientationOf(resolveValueAxis(channels, scales, { orientation: orientationOption }));

            const horizontal = orientation === 'horizontal';
            const catChannel = horizontal ? 'y' : 'x';
            const valueChannel = horizontal ? 'x' : 'y';
            const catKey = horizontal ? yKey : xKey;
            const valueKey = horizontal ? xKey : yKey;
            const hasSpan = horizontal ? hasXSpan : hasYSpan;
            const baseline = baselineOf(horizontal ? xScale : yScale);

            const fieldSchema = stackFieldSchema(stackField, scales, ctx);
            checkStackChannel('bar', channels, fieldSchema);
            const stacks = doStack
                ? stackOffsets(currentData, channels, catChannel, catKey, valueKey, stackField,
                    stackOrder(currentData, /** @type {string} */ (stackField), fieldSchema))
                : null;
            if (!stacks && !hasSpan) warnOverlap(currentData, channels, catChannel, valueChannel, catKey);

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
                            cursor: valueChannel === 'x' ? 'ew-resize' : 'ns-resize',
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
