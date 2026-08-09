// @ts-check
import { isBand, bandwidthOf, bandStartOf, baselineOf } from '../core/scales.js';
import { encodeChannel, encodeValue, categoryOf, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles } from './mark.js';
import { groupByPosition, stackLayout, stackDescriptor } from './stack.js';

// bar: a rectangular mark that composes across orientations. The band axis is
// the categorical/position axis (sets the bar's position + thickness) and the
// linear axis is the value/length axis (sets the bar's length from a baseline).
//
//   x: band,   y: linear  -> vertical bars   (barY)
//   x: linear, y: band     -> horizontal bars (barX)
//
// `bar` auto-detects orientation from the scale types (or takes an explicit
// `orientation`); `barY` / `barX` force one. In all cases the mark reads the
// x-channel via the `x` accessor and the y-channel via `y`, so which channel is
// the "value" and which is the "category" follows the scales — matching the spec.
//
// The value axis also accepts an explicit SPAN instead of a single value: two
// endpoint channels (x1/x2 for barX, y1/y2 for barY) place the bar between them
// rather than from the baseline — e.g. a Gantt-style "years active" span per
// category. x1/x2 share the same resolved scale as x (and y1/y2 as y — see
// core/resolve.js's axis aliasing), so they're read through encodeChannel exactly
// like the single-value form.
//
// Optional `stack: true | <seriesField>` stacks bars that share a category: each
// segment sits on the cumulative sum of prior series in that band. Declare a
// schema domain that covers the stacked total. Span mode and stack are mutually
// exclusive (span wins).

/**
 * Stack order within one band. Data order by default; a series field sorts by
 * first-seen series key, so the same category sits at the same height in every band
 * — which is also where a segment an edit mints belongs, since the key it was given
 * decides its place rather than which band it was cut in.
 *
 * Ties keep data order (Array#sort is stable), and an unseen key sorts LAST rather
 * than to the front — which is what `indexOf`'s -1 would otherwise do to it.
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
 * Cumulative data-space baselines for stacked bars, keyed by datum index — plus the
 * band's membership, so a segment can stamp what an edit needs to invert the stack.
 *
 * The grouping and the cumulative walk both come from plot/stack.js, shared with
 * `arc`: rows are bucketed by the category CHANNEL (through `categoryOf`, so a
 * `{ fn }`/`{ datum }` channel groups the way it draws — this used to read
 * `datum[catKey]` raw and silently ignore both forms), and each band's shares are
 * accumulated in DATA units, which `build` then puts through `encodeValue`.
 *
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
    for (const group of groupByPosition(data, channels, [catChannel], { [catChannel]: catKey })) {
        const members = orderMembers(group.members, data, seriesField);
        const { bounds } = stackLayout(members, data, valueKey);
        members.forEach((gi, local) => {
            out.set(gi, { y0: bounds[local][0], y1: bounds[local][1], members, local });
        });
    }
    return out;
}

/**
 * @param {any} options
 * @param {string | null} forcedOrientation
 * @returns {import('../types').Mark}
 */
function buildBar(options, forcedOrientation) {
    // Desugar top-level style shorthands (e.g. the legacy `fill: 'steelblue'`)
    // into the channels as constant channels, so bar reads style the same way
    // every mark does. Explicit `channels.fill` still wins.
    const opts = normalizeMarkOptions(options, {
        mark: 'bar',
        allow: ['orientation', 'stack', 'series', 'z', 'handles', 'handleSize', 'handleColor'],
    });
    const {
        channels = {},
        id,
        edits,
        constraints,
        orientation: orientationOption,
        stack,
        // Affordance: a dot on each interior boundary between two stacked segments
        // (node.edge), which edit.stack.* grabs. handles: true|false|'hit' is the
        // shared contract. Only emitted when a stack edit is wired — a mark is inert
        // until an edit names the column it writes.
        handles = true,
        handleSize,
        handleColor,
    } = opts;

    // Channel-native: read the x/y field from the channels, falling back to the
    // legacy x/y accessor options. Either way the scale for each channel is the
    // global one the engine resolves and passes in as scales.x / scales.y.
    const { xKey, yKey } = positionalKeys(channels);
    // Span mode: both endpoint channels declared on that axis. Decided once per
    // mark (not per datum) — the missing form (baseline+value) stays the default.
    const hasXSpan = !!(channels.x1 && channels.x2);
    const hasYSpan = !!(channels.y1 && channels.y2);
    // `stack: 'field'` names the series outright; `stack: true` infers it the same
    // way every series-grouping mark does.
    const seriesField = typeof stack === 'string' ? stack
        : stack === true ? seriesFieldOf(opts, channels)
            : null;
    const doStack = !!stack && !hasXSpan && !hasYSpan;

    const markEdits = edits || [];
    // Boundary handles are for the stack edits only: they address a row PAIR
    // (loIndex/hiIndex), which no other edit knows what to do with.
    const hasStackEdit = markEdits.some((/** @type {any} */ e) => e && e.scope === 'stack');

    return {
        id,
        markName: 'bar',
        channels,
        edits: markEdits,
        constraints,
        // Capability flag: what edit.stack.* needs to work (see SCOPE_CAPABILITY).
        // Only a STACKED bar partitions a total — an unstacked one is a set of
        // independent lengths, with no boundary between two rows to cut or drag.
        supportsStack: doStack,
        // A bar's categorical axis wants the band interval (its thickness).
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

            let orientation = forcedOrientation || orientationOption;
            if (!orientation) {
                if (isBand(xScale)) orientation = 'vertical';
                else if (isBand(yScale)) orientation = 'horizontal';
                else orientation = 'vertical';
            }

            // Which axis carries the category, and which the magnitude. Named once
            // here because the stack layout, the node stamp and the boundary handles
            // all need the same answer.
            const catChannel = orientation === 'horizontal' ? 'y' : 'x';
            const valueChannel = orientation === 'horizontal' ? 'x' : 'y';
            const catKey = orientation === 'horizontal' ? yKey : xKey;
            const valueKey = orientation === 'horizontal' ? xKey : yKey;

            const stacks = doStack
                ? stackOffsets(currentData, channels, catChannel, catKey, valueKey, seriesField)
                : null;

            // Default ink from the theme (classic steelblue unless the theme's `ink`
            // or a `marks.bar` override changes it); a per-datum fill channel still
            // wins. Resolved once — the tokens don't vary per row.
            // A stacked bar also gets a seam stroke, so two abutting segments read as
            // two even in one hue — a cut has to be visible the moment it happens.
            // Through markDefaults (themeable, overridable by a stroke channel), never
            // as a literal.
            const barDefaults = markDefaults(scales, 'bar', doStack
                ? { fill: themeOf(scales).ink, stroke: themeOf(scales).handleStroke, strokeWidth: 1 }
                : { fill: themeOf(scales).ink });

            // One handle contract for every mark that draws one: shared radius
            // default, one meaning per `handles` value, paint from the theme.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });

            // How a pointer becomes a position along this stack: straight through the
            // value scale, because a stack's baseline is 0 and so its cumulative total
            // IS the axis value. Pure data — edit/stack.js re-derives the magnitudes
            // from the live dataset and inverts through the same scale that encoded
            // them, which is why nothing here is a closure.
            /** @type {any} */
            const geometry = { kind: 'linear', axis: valueChannel };
            /** @param {number} i @returns {any} */
            const stampOf = (i) => {
                const s = stacks && stacks.get(i);
                return s ? stackDescriptor({ members: s.members, local: s.local, field: valueKey, geometry }) : undefined;
            };

            /** @type {import('../types').FeatureNode[]} */
            const nodes = currentData.map((d, i) => {
                // Standard style surface (fill/stroke/opacity/…), resolved per
                // datum through the same channels every mark uses.
                const style = resolveStyle(scales, channels, d, barDefaults, i, currentData);
                const stamp = stampOf(i);

                if (orientation === 'horizontal') {
                    // Category on y (band geometry), value/length on x. The value
                    // axis resolves through encodeChannel like every other mark; the
                    // band axis keeps its interval geometry (start + thickness).
                    const bandStart = bandStartOf(yScale, categoryOf(channels, 'y', d, yKey, i, currentData), 0);
                    const thickness = bandwidthOf(yScale, 20);
                    const baseline = baselineOf(xScale);
                    let lo, hi;
                    if (hasXSpan) {
                        const v1 = encodeChannel(scales, channels, 'x1', d, baseline, i, currentData);
                        const v2 = encodeChannel(scales, channels, 'x2', d, baseline, i, currentData);
                        lo = Math.min(v1, v2);
                        hi = Math.max(v1, v2);
                    } else if (stacks) {
                        // Stack baselines are derived data-space values, not channel
                        // reads — encodeValue runs them through the same scale path.
                        const { y0, y1 } = stacks.get(i) || { y0: 0, y1: d[xKey] };
                        const p0 = encodeValue(scales, channels, 'x', y0, baseline);
                        const p1 = encodeValue(scales, channels, 'x', y1, baseline);
                        lo = Math.min(p0, p1);
                        hi = Math.max(p0, p1);
                    } else {
                        const valuePos = encodeChannel(scales, channels, 'x', d, baseline, i, currentData);
                        lo = Math.min(valuePos, baseline);
                        hi = Math.max(valuePos, baseline);
                    }
                    return {
                        type: 'rect',
                        x: lo,
                        y: bandStart,
                        width: hi - lo,
                        height: thickness,
                        ...style,
                        data: d,
                        index: i,
                        orientation,
                        bandAxis: 'y', // proximity measures distance along y (rows)
                        ...(stamp ? { stack: stamp } : {})
                    };
                }

                // Vertical: category on x (band geometry), value/length on y. Value
                // via encodeChannel (as every mark); band axis keeps its interval.
                const bandStart = bandStartOf(xScale, categoryOf(channels, 'x', d, xKey, i, currentData), 0);
                const thickness = bandwidthOf(xScale, 20);
                const baseline = baselineOf(yScale);
                let lo, hi;
                if (hasYSpan) {
                    const v1 = encodeChannel(scales, channels, 'y1', d, baseline, i, currentData);
                    const v2 = encodeChannel(scales, channels, 'y2', d, baseline, i, currentData);
                    lo = Math.min(v1, v2);
                    hi = Math.max(v1, v2);
                } else if (stacks) {
                    const { y0, y1 } = stacks.get(i) || { y0: 0, y1: d[yKey] };
                    const p0 = encodeValue(scales, channels, 'y', y0, baseline);
                    const p1 = encodeValue(scales, channels, 'y', y1, baseline);
                    lo = Math.min(p0, p1);
                    hi = Math.max(p0, p1);
                } else {
                    const valuePos = encodeChannel(scales, channels, 'y', d, baseline, i, currentData);
                    lo = Math.min(valuePos, baseline);
                    hi = Math.max(valuePos, baseline);
                }
                return {
                    type: 'rect',
                    x: bandStart,
                    y: lo,
                    width: thickness,
                    height: hi - lo,
                    ...style,
                    data: d,
                    index: i,
                    orientation,
                    bandAxis: 'x', // proximity measures distance along x (columns)
                    ...(stamp ? { stack: stamp } : {})
                };
            });

            // ── Boundary handles ────────────────────────────────────────────────
            // One dot per movable INTERIOR boundary of each band: n segments have
            // n−1 of them, because the outer two ends are the stack's baseline and
            // its total, not a division between two rows. Same rule as an arc's rim
            // handles, where the full-circle seam is the fixed anchor.
            //
            // The handle carries the pair it separates (loIndex/hiIndex) plus the
            // same `stack` stamp its segments have, so edit.stack.edge re-derives the
            // band's layout from `members` alone and its pair-shift touches no other
            // band.
            if (stacks && hasStackEdit && handleStyle.grabbable) {
                const catScale = catChannel === 'x' ? xScale : yScale;
                const valueScale = valueChannel === 'x' ? xScale : yScale;
                const baseline = baselineOf(valueScale);
                const thickness = bandwidthOf(catScale, 20);

                /** @type {Set<number[]>} */
                const seen = new Set();
                for (const entry of stacks.values()) {
                    const members = entry.members;
                    if (seen.has(members)) continue;   // one pass per band, not per row
                    seen.add(members);

                    const rep = currentData[members[0]];
                    const bandStart = bandStartOf(
                        catScale, categoryOf(channels, catChannel, rep, catKey, members[0], currentData), 0);
                    const centre = bandStart + thickness / 2;

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
                            fill: handleStyle.visible ? handleStyle.fill : 'transparent',
                            stroke: handleStyle.visible ? handleStyle.stroke : 'none',
                            strokeWidth: handleStyle.visible ? handleStyle.strokeWidth : 0,
                            cursor: 'grab',
                            data: currentData[gi],
                            index: gi,
                            // Edge payload, read by edit.stack.edge / .merge.
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
export function bar(options = {}) {
    return buildBar(options, null);
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function barY(options = {}) {
    return buildBar(options, 'vertical');
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function barX(options = {}) {
    return buildBar(options, 'horizontal');
}
