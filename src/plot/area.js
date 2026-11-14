// @ts-check
import { baselineOf } from '../core/scales.js';
import { claimEdge } from '../edit/shared.js';
import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, handlePaint, handlesAreAffordance, markCommon, rawChannel, resolveValueAxis, orderSeries, seriesKeyOf, hasAnyEdit, inkOf, missingValue } from './mark.js';
import { areaGenerator } from '../core/curves.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// area: one filled path per series, down to the baseline, plus optional handle
// circles. Same series/ordering options as line.
//
//   area   — value axis resolved from the channels and scales
//   areaY  — value on y (fill down to the y baseline)
//   areaX  — value on x (fill across to the x baseline)
//
// A span (y1/y2 or x1/x2) fills between two fields instead: an uncertainty band.
// Handles sit on both edges. Pair with ordering({ fields: ['lo','hi'] }) to keep
// the band from turning inside out.
//
//   areaY({ channels: { x: { field: 'year' },
//                       y1: { field: 'lo' }, y2: { field: 'hi' } } })

const SINGLE = '__single__';

/**
 * In span mode both edge handles sit on one feature over one datum, and a gesture
 * reaches every direct edit on the feature. `claimEdge` ties each single-edge edit
 * to its own `channel`-tagged handle so a drag on one edge doesn't move the other.
 * @param {string[] | null} group the pair's channel names, or null outside span mode
 * @param {any} channels
 * @param {any[] | undefined} edits
 * @returns {{ channels: any, edits: any[] | undefined }}
 */
function claimSpanEdges(group, channels, edits) {
    if (!group) return { channels, edits };
    /** @type {any} */
    const guarded = { ...channels };
    for (const ch of group) {
        const spec = guarded[ch];
        if (spec && spec.edit) guarded[ch] = { ...spec, edit: claimEdge(spec.edit, ch) };
    }
    const guardedEdits = edits && edits.map((e) => {
        const names = (e.channels || []).filter((/** @type {string} */ n) => group.includes(n));
        return names.length === 1 ? claimEdge(e, names[0]) : e;
    });
    return { channels: guarded, edits: guardedEdits };
}

/** @param {any} [options] @returns {import('../types').Mark} */
export function area(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'area', allow: MARK_OPTIONS.area });
    const {
        channels: declaredChannels = {},
        edits: rawEdits,
        curve = 'linear',
        // Handles draw only when something can grab them (see `line`).
        handles: handlesOpt,
        handleSize,
        handleColor,
        connect = 'domain',
        gradient,
    } = opts;

    const { xKey, yKey } = positionalKeys(declaredChannels);
    const seriesField = seriesFieldOf(declaredChannels);
    const hasXSpan = !!(declaredChannels.x1 && declaredChannels.x2);
    const hasYSpan = !!(declaredChannels.y1 && declaredChannels.y2);
    const spanPair = hasYSpan ? ['y1', 'y2'] : hasXSpan ? ['x1', 'x2'] : null;
    const { channels, edits } = claimSpanEdges(spanPair, declaredChannels, rawEdits);

    return {
        ...markCommon(opts),
        // The span-guarded edits, not the raw ones markCommon passes through.
        edits,
        type: 'area',
        handles: handlesOpt,
        channels,
        // Read raw (no scale), like `line`'s and `link`'s.
        rawChannels: ['curve', 'series', 'order'],
        discreteScale: 'point',
        xKey,
        yKey,
        seriesKey: seriesField,
        connect,
        supportsSeries: true,
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build(currentData, scales, width, height) {
            // Decided at build time: a composite merges edits into a part after the factory runs.
            const editsNow = { edits: this && this.edits, channels: (this && this.channels) || channels };
            const handles = handlesOpt !== undefined ? handlesOpt : hasAnyEdit(editsNow);
            const rowHandle = handlesAreAffordance(handlesOpt, editsNow);
            const { x: xScale, y: yScale } = scales;
            // A y1/y2 pair is the value (the band's edges), so extent: 'value'.
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation, extent: 'value' });
            const spanMode = valueAxis === 'y' ? hasYSpan : hasXSpan;

            /** @type {Map<any, { d: any, i: number }[]>} */
            const groups = new Map();
            // Skip rows with no domain value rather than break the band there.
            const alongAxis = valueAxis === 'y' ? 'x' : 'y';
            currentData.forEach((d, i) => {
                if (missingValue(channels, alongAxis, d)) return;
                const key = seriesField != null ? seriesKeyOf(d[seriesField]) : SINGLE;
                let bucket = groups.get(key);
                if (!bucket) { bucket = []; groups.set(key, bucket); }
                bucket.push({ d, i });
            });

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            const areaInk = themeOf(scales).ink;
            const bandDefaults = markDefaults(scales, 'area', { fill: areaInk, stroke: areaInk, fillOpacity: 0.35 });
            const handleDefaults = markDefaults(scales, 'area', { fill: areaInk, stroke: areaInk });
            const yBase = baselineOf(yScale, height);
            const xBase = baselineOf(xScale, 0);

            const domainAxis = valueAxis === 'y' ? 'x' : 'y';
            for (const [series, rows] of groups) {
                const groupRows = rows || [];
                // Order by domain-axis pixel position, as `line` does (orderSeries).
                const placed = groupRows.map(({ d, i }) => ({
                    d, i,
                    cx: encodeChannel(scales, channels, 'x', d, width / 2, i, currentData),
                    cy: encodeChannel(scales, channels, 'y', d, height / 2, i, currentData),
                }));
                const sorted = orderSeries(placed, connect, domainAxis, channels);

                // Style and curve resolve once per series, from its first row.
                const style = resolveStyle(scales, channels, sorted[0] ? sorted[0].d : {}, bandDefaults,
                    sorted[0] ? sorted[0].i : undefined, currentData);
                const seriesCurve = String(rawChannel(channels, 'curve',
                    sorted[0] ? sorted[0].d : {}, curve,
                    sorted[0] ? sorted[0].i : undefined, currentData));

                // One sample per row: domain position and both edges in px. In span
                // mode the far edge is a second field, else the baseline. A missing
                // value gives a null edge, which breaks the band (core/curves.js `defined`).
                /** @type {any[]} */
                let samples;
                if (valueAxis === 'y') {
                    samples = sorted.map(({ d, i, cx }) => ({
                        x: cx,
                        y1: spanMode
                            ? encodeChannel(scales, channels, 'y2', d, null, i, currentData)
                            : encodeChannel(scales, channels, 'y', d, null, i, currentData),
                        y0: spanMode
                            ? encodeChannel(scales, channels, 'y1', d, null, i, currentData)
                            : yBase,
                    }));
                } else {
                    samples = sorted.map(({ d, i, cy }) => ({
                        y: cy,
                        x1: spanMode
                            ? encodeChannel(scales, channels, 'x2', d, null, i, currentData)
                            : encodeChannel(scales, channels, 'x', d, null, i, currentData),
                        x0: spanMode
                            ? encodeChannel(scales, channels, 'x1', d, null, i, currentData)
                            : xBase,
                    }));
                }
                // d3.area draws both edges so the curve runs the same way on each.
                // `points` is the outline polygon the pick layer measures.
                const d = areaGenerator(seriesCurve, valueAxis !== 'y')(samples);
                const definedIdx = samples.map((s, k) => (valueAxis === 'y'
                    ? Number.isFinite(s.x) && Number.isFinite(s.y0) && Number.isFinite(s.y1)
                    : Number.isFinite(s.y) && Number.isFinite(s.x0) && Number.isFinite(s.x1)) ? k : -1).filter((k) => k >= 0);
                const defined = definedIdx.map((k) => samples[k]);
                const rowsDefined = definedIdx.map((k) => sorted[k].i);
                /** @type {[number, number][]} */
                const points = valueAxis === 'y'
                    ? [...defined.map((s) => /** @type {[number, number]} */ ([s.x, s.y1])),
                       ...[...defined].reverse().map((s) => /** @type {[number, number]} */ ([s.x, s.y0]))]
                    : [...defined.map((s) => /** @type {[number, number]} */ ([s.x1, s.y])),
                       ...[...defined].reverse().map((s) => /** @type {[number, number]} */ ([s.x0, s.y]))];

                if (d && defined.length >= 2) {
                    nodes.push({
                        type: 'path',
                        ...(gradient ? { fillGradient: gradient } : {}),
                        d,
                        points,
                        // Each vertex's row (top edge, then bottom reversed), for tips.
                        polygon: true,
                        pointRows: [...rowsDefined, ...[...rowsDefined].reverse()],
                        curve: seriesCurve,
                        ...style,
                        strokeWidth: style.strokeWidth != null ? style.strokeWidth : 1,
                        series: series === SINGLE ? undefined : series,
                        pointerEvents: 'none'
                    });
                }

                // In span mode both edges get a handle, tagged with its `channel`
                // for claimSpanEdges.
                const handleChannels = spanMode
                    ? (valueAxis === 'y' ? ['y1', 'y2'] : ['x1', 'x2'])
                    : [valueAxis];
                if (handleStyle.grabbable) {
                    sorted.forEach(({ d, i }) => {
                        // Filled with the band's colour, ringed with the theme's handle stroke.
                        const paint = resolveStyle(scales, channels, d, handleDefaults, i, currentData);
                        const hStyle = handlePaint(handleStyle, handleColor || inkOf(paint.stroke) || inkOf(paint.fill));
                        for (const ch of handleChannels) {
                            const onY = ch[0] === 'y';
                            const along = onY
                                ? encodeChannel(scales, channels, 'x', d, width / 2, i, currentData)
                                : encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                            const at = encodeChannel(scales, channels, ch, d, null, i, currentData);
                            if (at == null) continue; // a missing value has no handle
                            nodes.push({
                                type: 'circle',
                                cx: onY ? along : at,
                                cy: onY ? at : along,
                                r: handleStyle.size,
                                ...hStyle,
                                data: d,
                                index: i,
                                channel: ch,
                                series: series === SINGLE ? undefined : series,
                                rowHandle, // dropped where no live edit reaches the row
                            });
                        }
                    });
                }
            }

            return nodes;
        }
    };
}

/** @param {any} [options] @returns {import('../types').Mark} */
export function areaY(options = {}) {
    return area({ ...options, orientation: 'vertical' });
}

/** @param {any} [options] @returns {import('../types').Mark} */
export function areaX(options = {}) {
    return area({ ...options, orientation: 'horizontal' });
}
