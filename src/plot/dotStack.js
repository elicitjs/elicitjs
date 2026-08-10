// @ts-check
// dotStack.js — a stacked dot plot (a dot histogram / token counter). Each datum
// is ONE token (`[{ bin: 0.3 }, { bin: 0.3 }, ...]`); tokens sharing a category
// stack into a countable column. It is the "drop circles into slots" elicitation:
// a click on the plane mints a token in the nearest slot (edit.create), a click
// on a token removes it (edit.remove), and the belief is just how many tokens sit
// in each slot — `data.filter(d => d.bin === b).length`.
//
//   // Elicit({ schema: { bin: { type: 'ordinal', domain: bins } }, data: [], … })
//   dotStack({
//     size: 7,                                  // token radius
//     channels: { x: { field: 'bin' } },
//     edits: [ create({ gesture: 'click', channels: ['x'] }), remove() ],
//     constraints: [ count({ max: 20 }), unique({ field: 'bin', max: 10 }) ],
//   })
//
// The category axis is a band/point scale over the discrete slots (its
// domainConfig is the slot list the ghosts iterate). The OTHER axis is a pure
// count of stacked tokens — fixed token geometry (2r + gap per token), not a
// value scale — so there is exactly ONE field->pixel resolution here, the
// category position through encodeChannel; the stack offset is derived count
// geometry, the same class as a bar's band interval.
//
// `dotStackY` (default) stacks upward with the category on x; `dotStackX` stacks
// rightward with the category on y — the bare + X/Y pairing every directional
// mark in this codebase follows.

import { isDiscrete } from '../core/scales.js';
import { encodeChannel, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon} from './mark.js';

/**
 * The discrete slots along the category axis — the ghost/label layer iterates
 * these. Prefer the scale's declared domain (band/point categories); fall back to
 * the distinct values present in the data.
 * @param {any} scale
 * @param {string} key
 * @param {any[]} data
 * @returns {any[]}
 */
function slotsOf(scale, key, data) {
    if (scale && Array.isArray(scale.domainConfig)) return scale.domainConfig;
    /** @type {any[]} */
    const seen = [];
    for (const d of data) if (!seen.includes(d[key])) seen.push(d[key]);
    return seen;
}

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedAxis  The axis tokens stack ALONG ('y' = up, 'x' = right).
 * @returns {import('../types').Mark}
 */
function buildDotStack(options, forcedAxis) {
    const opts = normalizeMarkOptions(options, { mark: 'dotStack', allow: ['gap', 'ghost', 'label'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        gap = 2,
        ghost = true,
        label = false
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'dotStack',
        channels,
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
            // Stack direction (bar-style autodetect): category on x -> stack UP
            // (along y); a categorical y with no x category -> stack RIGHT (along x).
            let stackAxis = forcedAxis;
            if (!stackAxis) stackAxis = (isDiscrete(scales.y) && !isDiscrete(scales.x)) ? 'x' : 'y';

            // Token radius, from the `size` shorthand. A token is a unit of count,
            // so the stack geometry needs ONE radius for every token — resolve it
            // against no datum, which yields the constant (or the default).
            const r = encodeChannel(scales, channels, 'size', null, 7);
            const slot = 2 * r + gap;
            const categoryKey = stackAxis === 'y' ? xKey : yKey;
            const categoryChannel = stackAxis === 'y' ? 'x' : 'y';
            // The token column grows from the axis floor: the bottom for a vertical
            // stack, the left edge for a horizontal one.
            const base = stackAxis === 'y' ? height : 0;

            // Slot occupancy, resolved up front so the ghost rings can be emitted
            // BEFORE the tokens (draw order == z-order: rings sit behind the stack).
            /** @type {Map<any, number>} */
            const counts = new Map();
            for (const d of currentData) {
                const key = d[categoryKey];
                counts.set(key, (counts.get(key) || 0) + 1);
            }

            /** The pixel of a slot's `n`-th token along the stack axis. */
            const placeAt = (/** @type {any} */ datum, /** @type {number} */ n) => {
                const along = encodeChannel(scales, channels, categoryChannel, datum, (stackAxis === 'y' ? width : height) / 2);
                const offset = (n + 0.5) * slot;
                return {
                    cx: stackAxis === 'y' ? along : base + offset,
                    cy: stackAxis === 'y' ? base - offset : along
                };
            };

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Ghost affordance: a faint open circle at each slot's NEXT position, so
            // an empty slot still reads as droppable (the open rings in the token
            // reference). Non-interactive — the plane owns the create gesture, and a
            // ring must never swallow the click or the hover preview beneath it.
            if (ghost) {
                for (const s of slotsOf(scales[categoryChannel], categoryKey, currentData)) {
                    nodes.push({
                        type: 'circle',
                        ...placeAt({ [categoryKey]: s }, counts.get(s) || 0),
                        r,
                        fill: 'none',
                        stroke: '#bbb',
                        strokeWidth: 1,
                        pointerEvents: 'none'
                    });
                }
            }

            /** @type {Map<any, number>} */
            const seen = new Map();
            currentData.forEach((/** @type {any} */ d, i) => {
                const key = d[categoryKey];
                const n = seen.get(key) || 0;
                seen.set(key, n + 1);
                const style = resolveStyle(scales, channels, d, markDefaults(scales, 'dotStack', { fill: themeOf(scales).ink }), i, currentData);
                const pos = placeAt(d, n);
                // A `symbol` channel renders each token as a glyph (an emoji token
                // stack) instead of a circle; the ghost rings above stay circles as
                // the drop affordance. Token radius `r` sets the glyph size.
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
                for (const s of slotsOf(scales[categoryChannel], categoryKey, currentData)) {
                    const n = counts.get(s) || 0;
                    if (n === 0) continue;
                    const synthetic = { [categoryKey]: s };
                    const along = encodeChannel(scales, channels, categoryChannel, synthetic, (stackAxis === 'y' ? width : height) / 2);
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
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStack(options = {}) {
    return buildDotStack(options, null);
}

/**
 * Stack tokens UPWARD (category on x).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStackY(options = {}) {
    return buildDotStack(options, 'y');
}

/**
 * Stack tokens RIGHTWARD (category on y).
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function dotStackX(options = {}) {
    return buildDotStack(options, 'x');
}
