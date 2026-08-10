// @ts-check
// waffle.js — a waffle mark: like bar, it shows a quantity for a category, but
// subdivides the block into a grid of CELLS so a reader can COUNT exact amounts
// and a gesture can pick a proportion cell-by-cell. It mirrors bar's structure
// (band = category axis + thickness, linear = value axis + length from a
// baseline; orientation autodetected or forced by waffleX/waffleY).
//
//   waffleY([{ cat: 'apples', value: 212 }, ...], { x: 'cat', y: 'value' })
//
// The invariant that makes a waffle a waffle (Observable Plot's model): ONE CELL
// IS A FIXED QUANTITY. `unit` (default 1) is the value each cell represents, so
// `value / unit` cells are filled and the reader can literally count them. Cells
// are laid out `multiple` across the band and are UNIFORM SQUARES that touch:
// their pitch is the smaller of the per-column band width and the per-row block
// height, so the grid always fits inside `thickness x blockLen` and its width
// never exceeds the bandwidth (it is centred across the band, and may be
// narrower). `multiple` defaults to the largest column count whose square cells
// still fill the block height — floor(sqrt(totalCells * thickness / blockLen)) —
// so a full waffle reaches the value's height on the axis and rows stay countable.
//
// The value's fill LEVEL is still resolved through encodeChannel (the single
// field->pixel path) so a plain `move()` on the value channel fills to the
// pointer; the grid quantizes that level into whole cells. Empty cells (up to the
// domain top) are drawn too so the whole block is one direct-pick drag target —
// dragging *up* into them raises the count. `showEmpty: false` keeps them as
// targets but paints them transparent; `emptyFill` sets their colour. `shape`
// picks 'rect' (default), 'circle', or 'symbol' cells — and a `symbol` channel
// (category -> glyph) turns each cell into that glyph automatically (an emoji
// waffle). Pair with a `snap` constraint whose step equals `unit` to land on
// whole cells.
//
// Interactions: use `edit.waffle.fill()` on the value channel — it maps the pointer
// to the exact cell under it (row + column) and fills up to and INCLUDING that cell,
// consistently for both drag and a single click. (A plain `move()` inverts the 1D
// value scale, which can't target a cell in a packed grid, so the fill lands on
// the wrong row.) Every cell carries the shared grid descriptor `node.grid` that
// the edit reads — which is what `supportsWaffle` below declares. Add a second
// `edit.waffle.fill({ gesture: 'click' })` at mark level for tap-to-set alongside
// drag-to-fill.

import { isBand, bandwidthOf, bandStartOf, baselineOf } from '../core/scales.js';
import { warn } from '../core/dev.js';
import { encodeChannel, categoryOf, resolveStyle, resolveSymbol, symbolNode, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon} from './mark.js';

/** @param {any} scale @returns {[number, number]} */
function domainExtent(scale) {
    const d = scale && scale.domainConfig;
    if (Array.isArray(d) && d.length >= 2) {
        const lo = Math.min(d[0], d[d.length - 1]);
        const hi = Math.max(d[0], d[d.length - 1]);
        return [lo, hi];
    }
    // The cell COUNT is domainSpan / unit, so a missing domain doesn't just move the
    // waffle — it silently makes every block one cell tall over [0,1]. That reads as
    // a rendering choice rather than a missing declaration, so say it.
    warn(
        'waffle:domain',
        'a waffle needs a declared DOMAIN on its value axis — one cell is a fixed '
        + 'quantity, so the number of cells is (domain span / unit). Without it the '
        + 'domain falls back to [0, 1] and the grid stops being countable. Declare it: '
        + 'schema: { <field>: { type: "quantitative", domain: [0, max] } }.'
    );
    return [0, 1];
}

/**
 * @param {any} options
 * @param {string | null} forcedOrientation
 * @returns {import('../types').Mark}
 */
function buildWaffle(options, forcedOrientation) {
    const opts = normalizeMarkOptions(options, { mark: 'waffle', allow: ['orientation', 'unit', 'multiple', 'gap', 'shape', 'showEmpty', 'emptyFill'] });
    const {
        channels = {},
        id,
        edits,
        constraints,
        orientation: orientationOption,
        unit = 1,
        multiple: multipleOption,
        gap = 1,
        shape = 'rect',
        showEmpty = true,
        emptyFill = '#eee'
    } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'waffle',
        channels,
        discreteScale: 'band',
        xKey,
        yKey,
        // What this mark NEEDS from the scales, checked by the engine
        // (warnScaleRequirements). A waffle is the most scale-dependent mark here:
        // its cell pitch comes from the band's width and its cell COUNT from the
        // value scale's declared domain. Without a band axis every block silently
        // becomes 20px wide (bandwidthOf's fallback) and the grid stops meaning
        // "one cell = one unit", which is the entire point of a waffle.
        requires: [{
            channels: ['x', 'y'],
            kind: 'discrete',
            mode: 'any',
            why: 'a waffle tiles ONE category\'s block into countable cells, so its '
                + 'category axis has to be a band (an interval to tile).',
        }],
        // Capability flag: this mark stamps `node.grid`, which is what
        // edit.waffle.fill reads (see SCOPE_CAPABILITY in core/elicit.js).
        supportsWaffle: true,
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

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            const waffleDefaults = markDefaults(scales, 'waffle', { fill: themeOf(scales).ink });
            currentData.forEach((/** @type {any} */ d, i) => {
                const style = resolveStyle(scales, channels, d, waffleDefaults, i, currentData);
                const vertical = orientation !== 'horizontal';
                // A `symbol` channel (or shape:'symbol') fills the block with glyph
                // cells — an emoji waffle (🍎🍎🍎 for a count of 3). Every cell of a
                // datum shares its glyph; empty cells stay faint but grabbable.
                const glyph = shape === 'symbol' ? (resolveSymbol(scales, channels, d, i, currentData) || '·')
                    : resolveSymbol(scales, channels, d, i, currentData);

                // Band (category) geometry vs value (length) geometry — the same
                // split bar makes. `bandStart`/`thickness` place the block across
                // its category; the value scale sets where each cell row lands.
                const bandScale = vertical ? xScale : yScale;
                const valueChannel = vertical ? 'y' : 'x';
                const valueScale = vertical ? yScale : xScale;
                const bandKey = vertical ? xKey : yKey;

                const bandStart = bandStartOf(
                    bandScale,
                    categoryOf(channels, vertical ? 'x' : 'y', d, bandKey, i, currentData),
                    0
                );
                const thickness = bandwidthOf(bandScale, 20);
                const baseline = baselineOf(valueScale);

                // Value DOMAIN in data units, and the pixels that span it. The
                // grid tiles this whole span in `unit`-sized cells, so it's the
                // same block a bar would draw — just cut into countable cells.
                const [dlo, dhi] = domainExtent(valueScale);
                const domainSpan = Math.abs(dhi - dlo) || 1;
                const domainTopPx = valueScale ? valueScale.encode(dhi, baseline) : baseline;
                const blockLen = Math.abs(baseline - domainTopPx) || 1;

                // One cell = `unit` of value, so `totalCells` tile the whole value
                // block. `multiple` cells sit across the band. Auto-pick the LARGEST
                // `multiple` whose square cells still fit the band width while
                // filling the block height — i.e. multiple = floor(sqrt(totalCells *
                // thickness / blockLen)). A user override is honoured (clamped so it
                // never overflows the band).
                const totalCells = Math.max(1, Math.round(domainSpan / unit));
                let multiple = multipleOption;
                if (!(multiple >= 1)) {
                    const fit = Math.sqrt((totalCells * thickness) / blockLen);
                    multiple = Number.isFinite(fit) && fit >= 1 ? Math.floor(fit) : 1;
                }
                multiple = Math.max(1, Math.min(totalCells, Math.round(multiple)));

                // Uniform SQUARE cells that touch: the pitch is the smaller of the
                // per-column band width and the per-row block height, so the whole
                // grid fits inside `thickness x blockLen`. The grid is then centred
                // across the band (its width may be < thickness — never more, as
                // requested for the categorical case).
                const rows = Math.ceil(totalCells / multiple);
                const cellSize = Math.min(thickness / multiple, blockLen / rows);
                const bandInset = (thickness - multiple * cellSize) / 2;
                const drawSize = Math.max(0.5, cellSize - gap);

                // Grid descriptor shared by every cell of this datum, so the
                // waffle-native `edit.waffle.fill` edit can map a pointer to the exact
                // cell (row + column) it is over — the value scale alone can't,
                // since the packed grid isn't a 1:1 vertical split of the block.
                const grid = {
                    axis: vertical ? 'y' : 'x',
                    sign: vertical ? -1 : 1, // pixels grow this way INTO the block
                    baseline, cellSize, rows, multiple, bandStart, bandInset,
                    unit, dlo, dhi, totalCells
                };

                // Fill LEVEL through encodeChannel (the one field->pixel path),
                // quantized into whole cells so the count is exact and the top of
                // the filled cells lines up with `value` on the axis.
                const level = encodeChannel(scales, channels, valueChannel, d, baseline, i, currentData);
                const fillFraction = Math.abs(baseline - level) / blockLen;
                const filled = Math.max(0, Math.min(totalCells, Math.round(fillFraction * totalCells)));

                // Signed step away from the baseline along the value axis (up for a
                // vertical waffle, right for a horizontal one).
                const valueDir = vertical ? -1 : 1;

                for (let idx = 0; idx < totalCells; idx++) {
                    const row = Math.floor(idx / multiple); // 0 at the baseline
                    const col = idx % multiple;
                    const isFilled = idx < filled;

                    // Empty cells double as the drag TRACK: they're the target a
                    // drag grabs to raise the count, so they always exist. Hiding
                    // them (`showEmpty: false`) makes them transparent — invisible
                    // but still grabbable — rather than removing the target.
                    const cellStyle = isFilled
                        ? style
                        : { ...style, fill: showEmpty ? emptyFill : 'transparent' };

                    // Cell origin: band offset (centred) + value offset from the
                    // baseline. Uniform `cellSize` pitch makes neighbours touch.
                    const bandPos = bandStart + bandInset + col * cellSize;
                    const valueNear = baseline + valueDir * row * cellSize;       // edge closer to baseline
                    const valueFar = baseline + valueDir * (row + 1) * cellSize;  // edge further out
                    const valueTop = Math.min(valueNear, valueFar);              // smaller pixel

                    // Glyph cell: a text node at the cell centre, sized to the cell.
                    // Empty cells fade (but keep pointer events, as the drag track).
                    if (glyph !== undefined) {
                        const bandCenter = bandPos + cellSize / 2;
                        const valCenter = (valueNear + valueFar) / 2;
                        /** @type {Record<string, any>} */
                        const extra = { ...style, data: d, index: i, grid };
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
                            grid
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
                        grid
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
export function waffle(options = {}) {
    return buildWaffle(options, null);
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function waffleY(options = {}) {
    return buildWaffle(options, 'vertical');
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function waffleX(options = {}) {
    return buildWaffle(options, 'horizontal');
}
