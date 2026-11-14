// @ts-check
// waffle.js: a block per category, cut into countable cells. The category axis
// sets position and thickness; the `count` channel (its own count axis, not y)
// sets how many cells fill.
//
//   waffleY({ channels: { x: { field: 'cat' }, count: { field: 'n' } } })  // blocks grow UP
//   waffleX({ channels: { y: { field: 'cat' }, count: { field: 'n' } } })  // blocks grow RIGHT
//
// One cell is `unit` of the field (default 1). Cells are touching squares laid out
// `multiple` across the band; `multiple` defaults to the largest count whose cells
// still fill the block, floor(sqrt(totalCells * thickness / blockLen)). The count
// axis is opt-in (`axes: { count: true }`).
//
// Empty cells up to the domain top are drawn too, as the drag target
// (`showEmpty: false` makes them transparent, still grabbable). `shape` is 'rect',
// 'circle' or 'symbol'; a `symbol` channel turns cells into glyphs.
//
// Edit with `edit.waffle.fill()`, which maps the pointer to the cell under it via
// `node.grid`. A plain `move()` inverts the 1-D scale and lands on the wrong row.

import { baselineOf } from '../core/scales.js';
import { warn } from '../core/dev.js';
import { encodeChannel, categorySlot, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, resolveValueAxis, orientationOf, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

/**
 * The grid for `totalCells` cells: `multiple` across the band, `rows` along the
 * count axis, and a square `cellSize` that fits `thickness x blockLen`. Pure, so
 * the resolver and build() get the same grid.
 * @param {{ totalCells: number, thickness: number, blockLen: number, multiple?: number }} o
 * @returns {{ totalCells: number, multiple: number, rows: number, cellSize: number }}
 */
export function waffleLayout({ totalCells, thickness, blockLen, multiple: multipleOption }) {
    let multiple = /** @type {number} */ (multipleOption);
    if (!(multiple >= 1)) {
        const fit = Math.sqrt((totalCells * thickness) / blockLen);
        multiple = Number.isFinite(fit) && fit >= 1 ? Math.floor(fit) : 1;
    }
    multiple = Math.max(1, Math.min(totalCells, Math.round(multiple)));
    const rows = Math.ceil(totalCells / multiple);
    const cellSize = Math.min(thickness / multiple, blockLen / rows);
    return { totalCells, multiple, rows, cellSize };
}

/** @param {any} scale @returns {[number, number]} */
function domainExtent(scale) {
    const d = scale && scale.domainConfig;
    if (Array.isArray(d) && d.length >= 2) {
        const lo = Math.min(d[0], d[d.length - 1]);
        const hi = Math.max(d[0], d[d.length - 1]);
        return [lo, hi];
    }
    // The cell count is domainSpan / unit, so a missing domain breaks the grid.
    warn(
        'waffle:domain',
        'a waffle needs a declared DOMAIN on its value axis — one cell is a fixed '
        + 'quantity, so the number of cells is (domain span / unit). Without it the '
        + 'domain falls back to [0, 1] and the grid stops being countable. Declare it: '
        + 'schema: { <field>: { type: "quantitative", domain: [0, max] } }, and bind it '
        + 'to the `count` channel.'
    );
    return [0, 1];
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function waffle(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'waffle', allow: MARK_OPTIONS.waffle });
    const {
        channels = {},
        orientation: orientationOption,
        unit = 1,
        multiple: multipleOption,
        gap = 1,
        shape = 'rect',
        showEmpty = true,
        emptyFill = '#eee'
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    // Orientation comes from the channel map at factory time, never the scales:
    // `countAxis` sets the count scale's range before any build() runs, and both
    // must agree. The bound category channel is the band; count runs the other way.
    const orientation = orientationOf(resolveValueAxis(channels, null, { orientation: orientationOption, single: 'other' }));
    const vertical = orientation !== 'horizontal';

    /** @type {{ totalCells: number, multiple: number, rows: number, cellSize: number } | null} */
    let layoutHint = null;
    return {
        ...markCommon(opts),
        type: 'waffle',
        channels,
        // The screen direction of the count axis, for its scale's range (channelRange).
        countAxis: vertical ? 'y' : 'x',
        // The resolver ranges the count scale to the grid's drawn length (a
        // width-limited grid is shorter than the block). Cached so build() matches.
        /**
         * @param {{ thickness: number, blockLen: number, domainSpan: number }} o
         * @returns {number} the grid's length along the count axis, px
         */
        countLayout: ({ thickness, blockLen, domainSpan }) => {
            const totalCells = Math.max(1, Math.round(domainSpan / unit));
            layoutHint = waffleLayout({ totalCells, thickness, blockLen, multiple: multipleOption });
            return layoutHint.rows * layoutHint.cellSize;
        },
        discreteScale: 'band',
        xKey,
        yKey,
        // Cell pitch comes from the band width; checked by warnScaleRequirements.
        requires: [{
            channels: ['x', 'y'],
            kind: 'discrete',
            match: 'any',
            why: 'a waffle tiles ONE category\'s block into countable cells, so its '
                + 'category axis has to be a band (an interval to tile).',
        }],
        // Stamps `node.grid`, which edit.waffle.fill reads.
        supportsWaffle: true,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales) => {

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            const waffleDefaults = markDefaults(scales, 'waffle', { fill: themeOf(scales).ink });
            currentData.forEach((/** @type {any} */ d, i) => {
                // No category (or nested category): draw nothing. A missing count
                // keeps its empty grid for the reader to fill.
                if (missingValue(channels, vertical ? 'x' : 'y', d)) return;
                if (missingValue(channels, vertical ? 'xOffset' : 'yOffset', d)) return;
                const style = resolveStyle(scales, channels, d, waffleDefaults, i, currentData);
                // Glyph cells from a `symbol` channel or shape: 'symbol'.
                const glyph = shape === 'symbol' ? (resolveSymbol(scales, channels, d, i, currentData) || '·')
                    : resolveSymbol(scales, channels, d, i, currentData);

                const valueChannel = 'count';
                const valueScale = /** @type {any} */ (scales).count;
                const bandKey = vertical ? xKey : yKey;

                // The category's band, or its sub-band under an offset.
                const { start: bandStart, width: thickness } = categorySlot(
                    scales, channels, vertical ? 'x' : 'y', d, bandKey, i, currentData);
                const baseline = baselineOf(valueScale);

                // The count domain and its pixel length; the grid tiles all of it.
                const [dlo, dhi] = domainExtent(valueScale);
                const domainSpan = Math.abs(dhi - dlo) || 1;
                const domainTopPx = valueScale ? valueScale.encode(dhi, baseline) : baseline;
                const blockLen = Math.abs(baseline - domainTopPx) || 1;

                // The block holds domainSpan / unit cells; warn when that isn't whole.
                const exactCells = domainSpan / unit;
                if (Math.abs(exactCells - Math.round(exactCells)) > 1e-9) {
                    warn(
                        'waffle:unit',
                        `a waffle's domain span (${domainSpan}) is not a whole number of `
                        + `\`unit\`s (${unit}) — it needs ${exactCells.toFixed(2)} cells, so the `
                        + `grid is rounded to ${Math.round(exactCells)} and one cell no longer `
                        + `means exactly ${unit}. Pick a unit that divides the domain.`
                    );
                }
                const totalCells = Math.max(1, Math.round(exactCells));
                // The resolver's cached layout (`countLayout` above), else computed here.
                const layout = layoutHint && layoutHint.totalCells === totalCells
                    ? layoutHint
                    : waffleLayout({ totalCells, thickness, blockLen, multiple: multipleOption });
                const { multiple, rows, cellSize } = layout;
                const bandInset = (thickness - multiple * cellSize) / 2;
                const drawSize = Math.max(0.5, cellSize - gap);

                // Shared by every cell of the row; edit.waffle.fill maps a pointer to
                // a cell (row + column) through it.
                const grid = {
                    axis: vertical ? 'y' : 'x',
                    sign: vertical ? -1 : 1, // pixels grow this way into the block
                    baseline, cellSize, rows, multiple, bandStart, bandInset,
                    unit, dlo, dhi, totalCells
                };

                // Pixel direction away from the baseline.
                const valueDir = vertical ? -1 : 1;

                // The whole grid as one rect, stamped on every cell so an effect
                // outline rings the block, not a single cell.
                const blockAcross = bandStart + bandInset + gap / 2;
                const blockAlong = Math.min(baseline, baseline + valueDir * rows * cellSize) + gap / 2;
                const acrossLen = Math.max(0, multiple * cellSize - gap);
                const alongLen = Math.max(0, rows * cellSize - gap);
                const effectShape = {
                    type: 'rect',
                    x: vertical ? blockAcross : blockAlong,
                    y: vertical ? blockAlong : blockAcross,
                    width: vertical ? acrossLen : alongLen,
                    height: vertical ? alongLen : acrossLen,
                };

                // Fill level through encodeChannel, rounded to whole cells.
                const level = encodeChannel(scales, channels, valueChannel, d, baseline, i, currentData);
                const fillFraction = Math.abs(baseline - level) / blockLen;
                const filled = Math.max(0, Math.min(totalCells, Math.round(fillFraction * totalCells)));

                for (let idx = 0; idx < totalCells; idx++) {
                    const row = Math.floor(idx / multiple); // 0 at the baseline
                    const col = idx % multiple;
                    const isFilled = idx < filled;

                    // Empty cells are the drag track, so `showEmpty: false` makes
                    // them transparent rather than removing them.
                    const cellStyle = isFilled
                        ? style
                        : { ...style, fill: showEmpty ? emptyFill : 'transparent' };

                    // Cell origin: centred across the band, stepped from the baseline.
                    const bandPos = bandStart + bandInset + col * cellSize;
                    const valueNear = baseline + valueDir * row * cellSize;       // edge closer to baseline
                    const valueFar = baseline + valueDir * (row + 1) * cellSize;  // edge further out
                    const valueTop = Math.min(valueNear, valueFar);              // smaller pixel

                    // Glyph cell at the cell centre; empty ones fade but stay grabbable.
                    if (glyph !== undefined) {
                        const bandCenter = bandPos + cellSize / 2;
                        const valCenter = (valueNear + valueFar) / 2;
                        /** @type {Record<string, any>} */
                        const extra = { ...style, data: d, index: i, grid, effectShape };
                        if (!isFilled) extra.opacity = showEmpty ? 0.2 : 0;
                        nodes.push(symbolNode(
                            glyph,
                            vertical ? bandCenter : valCenter,
                            vertical ? valCenter : bandCenter,
                            drawSize / 2,
                            extra
                        ));
                        continue;
                    }

                    if (shape === 'circle') {
                        const r = drawSize / 2;
                        const bandCenter = bandPos + cellSize / 2;
                        const valCenter = (valueNear + valueFar) / 2;
                        nodes.push({
                            type: 'circle',
                            cx: vertical ? bandCenter : valCenter,
                            cy: vertical ? valCenter : bandCenter,
                            r,
                            ...cellStyle,
                            data: d,
                            index: i,
                            grid,
                            effectShape
                        });
                        continue;
                    }

                    nodes.push({
                        type: 'rect',
                        x: (vertical ? bandPos : valueTop) + gap / 2,
                        y: (vertical ? valueTop : bandPos) + gap / 2,
                        width: drawSize,
                        height: drawSize,
                        ...cellStyle,
                        data: d,
                        index: i,
                        grid,
                        effectShape
                    });
                }
            });

            return nodes;
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function waffleY(options = {}) {
    return waffle({ ...options, orientation: 'vertical' });
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function waffleX(options = {}) {
    return waffle({ ...options, orientation: 'horizontal' });
}
