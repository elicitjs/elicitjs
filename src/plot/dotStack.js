// @ts-check
// dotStack.js — a stacked dot plot. Each row is one token; tokens sharing a
// category stack into a column, so the belief is the count per slot.
//
//   dotStack({
//     size: 7,                                  // token radius
//     channels: { x: { field: 'bin' } },
//     edits: [ create({ gesture: 'click', channels: ['x'] }), remove() ],
//   })
//
// The stack axis is a count: each token takes 2r + gap px. `dotStackY` stacks
// upward (category on x), `dotStackX` rightward (category on y).

import { encodeChannel, categoryOf, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, resolveValueAxis, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { offsetScaleOf } from '../core/scales.js';

/**
 * The slots along the category axis: the scale's declared domain, else the
 * distinct values in the data.
 * @param {any} scale
 * @param {string} key
 * @param {any[]} data
 * @returns {any[]}
 */
function slotsOf(scale, key, data) {
    if (scale && Array.isArray(scale.domainConfig)) return scale.domainConfig;
    /** @type {any[]} */
    const seen = [];
    // A row with no category names no slot.
    for (const d of data) if (d[key] != null && !seen.includes(d[key])) seen.push(d[key]);
    return seen;
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStack(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'dotStack', allow: MARK_OPTIONS.dotStack });
    const {
        channels = {},
        orientation: orientationOption,
        gap = 2,
        ghost = true,
        label = false
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    // The stack axis, read from the channel map at factory time (not the scales):
    // the count scale's range needs it before any build() runs.
    const stackAxis = resolveValueAxis(channels, null, { orientation: orientationOption, single: 'other' });

    // Token radius for the count scale's pitch. `size` is a constant here, so the
    // pitch is known before there is any data.
    const tokenRadius = (channels.size && channels.size.value != null) ? +channels.size.value : 7;

    return {
        ...markCommon(opts),
        type: 'dotStack',
        channels,
        // A count axis with no `count` channel: one row is one token.
        countAxis: stackAxis,
        countPitch: 2 * tokenRadius + gap,
        // Tokens sit in discrete slots; a point scale gives each slot a tick.
        discreteScale: 'point',
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
            // One radius for every token: resolve `size` against no datum.
            const r = encodeChannel(scales, channels, 'size', null, 7);
            const slot = 2 * r + gap;
            const categoryKey = stackAxis === 'y' ? xKey : yKey;
            const categoryChannel = stackAxis === 'y' ? 'x' : 'y';
            // Columns grow from the bottom (vertical) or left edge (horizontal).
            const base = stackAxis === 'y' ? height : 0;

            // Slot counts, computed first so ghost rings draw behind the tokens.
            // A nested `xOffset`/`yOffset` splits each slot into sub-columns.
            const offsetChannel = categoryChannel === 'x' ? 'xOffset' : 'yOffset';
            const offsetSpec = channels[offsetChannel];
            const nested = offsetSpec && offsetSpec.field != null && offsetScaleOf(scales, channels, categoryChannel);
            const offsetField = nested ? offsetSpec.field : null;
            /** The column a row stacks in. */
            const columnOf = (/** @type {any} */ d, /** @type {number} */ i) => {
                const key = categoryOf(channels, categoryChannel, d, categoryKey, i, currentData);
                return offsetField ? `${key}\u0000${d[offsetField]}` : key;
            };
            /** Every (slot, sub-slot) a token may land in: the synthetic rows a ghost or label sits on. */
            const columns = () => slotsOf(scales[categoryChannel], categoryKey, currentData).flatMap((s) =>
                offsetField
                    ? nested.domain().map((/** @type {any} */ o) => ({ [categoryKey]: s, [offsetField]: o }))
                    : [{ [categoryKey]: s }]);

            /** @type {Map<any, number>} */
            const counts = new Map();
            currentData.forEach((d, i) => {
                // A row with no category counts nowhere and draws nothing.
                if (missingValue(channels, categoryChannel, d)) return;
                if (offsetField && missingValue(channels, offsetChannel, d)) return;
                const key = columnOf(d, i);
                counts.set(key, (counts.get(key) || 0) + 1);
            });

            /** The pixel of a slot's `n`-th token along the stack axis. */
            const placeAt = (/** @type {any} */ datum, /** @type {number} */ n, /** @type {number} */ i) => {
                const along = encodeChannel(scales, channels, categoryChannel, datum, (stackAxis === 'y' ? width : height) / 2, i, currentData);
                const offset = (n + 0.5) * slot;
                return {
                    cx: stackAxis === 'y' ? along : base + offset,
                    cy: stackAxis === 'y' ? base - offset : along
                };
            };

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Ghost ring at each slot's next position. Non-interactive, so it never
            // swallows the plane's create click.
            if (ghost) {
                for (const at of columns()) {
                    nodes.push({
                        type: 'circle',
                        ...placeAt(at, counts.get(columnOf(at, -1)) || 0, -1),
                        r,
                        fill: 'none',
                        stroke: '#bbb',
                        strokeWidth: 1,
                        pointerEvents: 'none'
                    });
                }
            }

            const tokenDefaults = markDefaults(scales, 'dotStack', { fill: themeOf(scales).ink });
            /** @type {Map<any, number>} */
            const seen = new Map();
            currentData.forEach((/** @type {any} */ d, i) => {
                if (missingValue(channels, categoryChannel, d)) return;
                if (offsetField && missingValue(channels, offsetChannel, d)) return;
                const key = columnOf(d, i);
                const n = seen.get(key) || 0;
                seen.set(key, n + 1);
                const style = resolveStyle(scales, channels, d, tokenDefaults, i, currentData);
                const pos = placeAt(d, n, i);
                // A `symbol` channel draws each token as a glyph of radius `r`.
                const glyph = resolveSymbol(scales, channels, d, i, currentData);
                if (glyph !== undefined) {
                    nodes.push(symbolNode(glyph, pos.cx, pos.cy, r, { ...style, data: d, index: i }));
                } else {
                    nodes.push({
                        type: 'circle',
                        ...pos,
                        r,
                        ...style,
                        data: d,
                        index: i
                    });
                }
            });

            // Optional per-slot count label above the column.
            if (label) {
                for (const synthetic of columns()) {
                    const n = counts.get(columnOf(synthetic, -1)) || 0;
                    if (n === 0) continue;
                    const along = encodeChannel(scales, channels, categoryChannel, synthetic, (stackAxis === 'y' ? width : height) / 2, -1, currentData);
                    const offset = (n + 1) * slot;
                    nodes.push({
                        type: 'text',
                        text: String(n),
                        x: stackAxis === 'y' ? along : base + offset,
                        y: stackAxis === 'y' ? base - offset : along,
                        textAnchor: 'middle',
                        fontSize: 11,
                        fill: '#555',
                        pointerEvents: 'none'
                    });
                }
            }

            return nodes;
        }
    };
}

/**
 * Stack tokens upward (category on x).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStackY(options = {}) {
    return dotStack({ ...options, orientation: 'vertical' });
}

/**
 * Stack tokens rightward (category on y).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStackX(options = {}) {
    return dotStack({ ...options, orientation: 'horizontal' });
}
