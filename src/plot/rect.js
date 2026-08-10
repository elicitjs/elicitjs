// @ts-check
import { isBand, bandwidthOf, bandStartOf, baselineOf, rangeExtent } from '../core/scales.js';
import { encodeChannel, categoryOf, encodeAngle, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon} from './mark.js';

// rect: the generalized bar. A bar fixes ONE axis to a categorical band (position
// + thickness) and draws the OTHER as a length from a baseline (or an explicit
// x1/x2 · y1/y2 span). A rect lifts that restriction: EACH axis independently
// resolves its extent as a span, a band, or a baseline→value length, so a
// rectangle can span both axes at once — Observable Plot's rect model (heatmap
// cells, 2-D regions, binned histograms, annotation boxes).
//
//   rect  — span-or-band on both axes (x1/x2 AND y1/y2, or a band on either)
//   rectX — force x to baseline→value (value on x, y a span/band) — a horizontal
//           histogram bar
//   rectY — force y to baseline→value (value on y, x a span/band) — a vertical
//           histogram bar
//
// Per axis, the extent is picked by what the author declared (in order):
//   1. SPAN     both endpoint channels present (x1&x2 / y1&y2) → min/max of the two
//               encoded pixels. x1/x2 share x's resolved scale via resolve.js's axis
//               aliasing, so they go through encodeChannel exactly like x.
//   2. SIZE     an explicit pixel extent (width / height) → a fixed-size box centred
//               on the x/y anchor (SVG-native). Overrides band/value, so a fixed box
//               wins over the category interval; on a band axis the anchor is the
//               category centre, so the box sits centred in its cell.
//   3. VALUE    this axis is the forced value axis, OR only a single x/y field is
//               given → baseline→value (like a bar's length).
//   4. BAND     the axis's scale is a band → the category interval (start + bandwidth).
//   5. EXTENT   nothing positional on this axis → span the full range (a rule-like
//               fallback, so a 1-D rect still draws).
//
// Editing: x1/x2/y1/y2 are already registered positional channels, so move /
// moveSpan / brushSpan work on a rect for free; brushRect() (edit/basic.js) adds
// composable 2-D edge/corner/body editing over all four extents at once.

/**
 * Resolve one axis's pixel extent for a datum. Returns [lo, hi] (lo ≤ hi) plus
 * whether this axis used band geometry (so the mark can flag `bandAxis` for the
 * proximity picker).
 * @param {'x' | 'y'} axis
 * @param {Record<string, any>} channels
 * @param {import('../types').ScaleMap} scales
 * @param {any} scale the axis scale
 * @param {any} datum
 * @param {string} key the axis field name
 * @param {boolean} forcedValue this axis is forced to baseline→value
 * @param {number} fullLength the plot extent along this axis (fallback span)
 * @param {number} [index] row index, passed to derived channel fns
 * @param {any[]} [data] the dataset, passed to derived channel fns
 * @returns {{ lo: number, hi: number, band: boolean }}
 */
function resolveExtent(axis, channels, scales, scale, datum, key, forcedValue, fullLength, index, data) {
    const c1 = axis + '1';
    const c2 = axis + '2';
    // 1. SPAN — both endpoints declared.
    if (channels[c1] && channels[c2]) {
        const v1 = encodeChannel(scales, channels, c1, datum, 0, index, data);
        const v2 = encodeChannel(scales, channels, c2, datum, 0, index, data);
        return { lo: Math.min(v1, v2), hi: Math.max(v1, v2), band: false };
    }
    // 2. SIZE — an explicit pixel extent centred on an x/y anchor (SVG-native w/h).
    // Wins over band/value so a fixed-size box beats the category interval; the
    // anchor goes through encodeChannel, so on a band axis it's the category centre.
    const sizeCh = axis === 'x' ? 'width' : 'height';
    if (channels[sizeCh]) {
        const size = encodeChannel(scales, channels, sizeCh, datum, 0, index, data);
        const [rlo, rhi] = scale ? rangeExtent(scale) : [0, fullLength];
        const center = encodeChannel(scales, channels, axis, datum, (rlo + rhi) / 2, index, data);
        return { lo: center - size / 2, hi: center + size / 2, band: false };
    }
    // 3. BAND — a categorical axis (skipped when this axis is forced to value).
    if (!forcedValue && isBand(scale)) {
        const start = bandStartOf(scale, categoryOf(channels, axis, datum, key, index, data), 0);
        const thickness = bandwidthOf(scale, 20);
        return { lo: start, hi: start + thickness, band: true };
    }
    // 2. VALUE — a single field drawn from the baseline.
    if (channels[axis]) {
        const baseline = baselineOf(scale);
        const value = encodeChannel(scales, channels, axis, datum, baseline, index, data);
        return { lo: Math.min(value, baseline), hi: Math.max(value, baseline), band: false };
    }
    // 4. EXTENT — nothing on this axis: span it fully.
    const [rlo, rhi] = scale ? rangeExtent(scale) : [0, fullLength];
    return { lo: Math.min(rlo, rhi), hi: Math.max(rlo, rhi), band: false };
}

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedValueAxis which axis is forced to baseline→value
 * @returns {import('../types').Mark}
 */
function buildRect(options, forcedValueAxis) {
    const opts = normalizeMarkOptions(options, { mark: 'rect', allow: [] });
    const { channels = {}, id, edits, constraints } = opts;

    const { xKey, yKey } = positionalKeys(channels);

    return {
        ...markCommon(opts),
        markName: 'rect',
        channels,
        // A rect wants the band interval on any categorical axis (like a bar).
        discreteScale: 'band',
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
            const { x: xScale, y: yScale } = scales;
            const rectDefaults = markDefaults(scales, 'rect', { fill: themeOf(scales).ink });

            return currentData.map((d, i) => {
                const style = resolveStyle(scales, channels, d, rectDefaults, i, currentData);

                const xExt = resolveExtent('x', channels, scales, xScale, d, xKey, forcedValueAxis === 'x', width, i, currentData);
                const yExt = resolveExtent('y', channels, scales, yScale, d, yKey, forcedValueAxis === 'y', height, i, currentData);

                // If one axis is a band, proximity picking measures distance along
                // the OTHER (value) axis' interval — mirror bar's bandAxis so a
                // nearest-pick grabs the cell from anywhere in its band.
                /** @type {'x' | 'y' | undefined} */
                let bandAxis;
                if (xExt.band && !yExt.band) bandAxis = 'x';
                else if (yExt.band && !xExt.band) bandAxis = 'y';

                const angle = encodeAngle(scales, channels, d, 0, i, currentData);

                return {
                    type: 'rect',
                    x: xExt.lo,
                    y: yExt.lo,
                    width: xExt.hi - xExt.lo,
                    height: yExt.hi - yExt.lo,
                    ...style,
                    data: d,
                    index: i,
                    ...(angle ? { angle } : {}),
                    ...(bandAxis ? { bandAxis } : {})
                };
            });
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rect(options = {}) {
    return buildRect(options, null);
}

/**
 * Value on x (baseline→value), the other axis a span/band — a horizontal bar/histogram.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rectX(options = {}) {
    return buildRect(options, 'x');
}

/**
 * Value on y (baseline→value), the other axis a span/band — a vertical bar/histogram.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function rectY(options = {}) {
    return buildRect(options, 'y');
}
