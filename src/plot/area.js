// @ts-check
import { isBand, baselineOf } from '../core/scales.js';
import { claimEdge } from '../edit/shared.js';
import { encodeChannel, resolveStyle, normalizeMarkOptions, seriesFieldOf, themeOf, markDefaults, positionalKeys, resolveHandles, markCommon, rawChannel, resolveValueAxis, orderSeries, seriesKeyOf, hasAnyEdit } from './mark.js';
import { areaGenerator } from '../core/curves.js';
import { MARK_OPTIONS } from '../vocabulary.js';

// area: a filled path under a series (the distributional sibling of line). Same
// grouping / ordering knobs as line; emits one filled `path` per series plus
// optional handle circles so sweep/drag/create reuse the line edit machinery.
//
//   area   — auto-detect value axis
//   areaY  — value on y (fill down to the y baseline)
//   areaX  — value on x (fill across to the x baseline)
//
// The value axis also accepts an explicit SPAN instead of a single value: two
// endpoint channels (y1/y2 for areaY, x1/x2 for areaX) fill BETWEEN them rather
// than down to the baseline. That is the uncertainty band — a confidence interval
// or a fan chart around a forecast — and it's the same span/baseline split `bar`
// and `rect` already make, spelled the same way, rather than a separate mark that
// would fork this one's series/curve/order/handle machinery.
//
//   areaY({ channels: { x: { field: 'year' },
//                       y1: { field: 'lo' }, y2: { field: 'hi' } } })
//
// y1/y2 share y's resolved scale (see core/resolve.js's axis aliasing), so they go
// through encodeChannel exactly like the single-value form, and the schema's domain
// union means the band and a sibling mean line land on one axis. Handles sit on
// BOTH edges, so `drag` on y1/y2 or `brushSpan` edits the interval directly. Pair
// with ordering({ fields: ['lo','hi'] }) to stop the band turning inside-out.

const SINGLE = '__single__';

/**
 * Span mode puts TWO handles on ONE feature over ONE datum (one per edge), and
 * direct-pick dispatch fans a gesture out to every direct edit on the feature —
 * so an unguarded drag on the lo handle runs the hi edge's drag too and collapses
 * the band onto the pointer. `claimEdge` (edit/shared.js) claims each edge's edit
 * for its own `channel`-tagged handle — the trend intercept/slope arbitration,
 * applied for the author rather than asked of them.
 *
 * Guard every edit that governs exactly one edge of the span pair, whether it was
 * co-located on the channel or declared at mark level.
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

/**
 * @param {any} options
 * @returns {import('../types').Mark}
 */
function buildArea(options) {
    const opts = normalizeMarkOptions(options, { mark: 'area', allow: MARK_OPTIONS.area });
    const {
        channels: declaredChannels = {},
        id,
        edits: rawEdits,
        curve = 'linear',
        // Handles draw only when something can grab them (see `line`).
        handles = hasAnyEdit(opts),
        handleSize,
        handleColor,
        connect = 'domain',
        gradient,
    } = opts;

    const { xKey, yKey } = positionalKeys(declaredChannels);
    const seriesField = seriesFieldOf(declaredChannels);
    // Span mode is decided once per mark (not per datum), exactly as bar/rect do it.
    const hasXSpan = !!(declaredChannels.x1 && declaredChannels.x2);
    const hasYSpan = !!(declaredChannels.y1 && declaredChannels.y2);
    const spanPair = hasYSpan ? ['y1', 'y2'] : hasXSpan ? ['x1', 'x2'] : null;
    const { channels, edits } = claimSpanEdges(spanPair, declaredChannels, rawEdits);

    return {
        ...markCommon(opts),
        type: 'area',
        handles,
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
        build: (currentData, scales, width, height) => {
            const { x: xScale, y: yScale } = scales;
            // A declared y1/y2 pair IS the value (the band's two edges), so its axis
            // is the value axis — extent: 'value', where a tick's pair is its chord.
            const valueAxis = resolveValueAxis(channels, scales, { orientation: opts.orientation, extent: 'value' });
            const spanMode = valueAxis === 'y' ? hasYSpan : hasXSpan;

            /** @type {Map<any, { d: any, i: number }[]>} */
            const groups = new Map();
            currentData.forEach((d, i) => {
                const key = seriesField != null ? seriesKeyOf(d[seriesField]) : SINGLE;
                let bucket = groups.get(key);
                if (!bucket) { bucket = []; groups.set(key, bucket); }
                bucket.push({ d, i });
            });

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            // The shared handle contract (plot/mark.js): one radius default, one
            // meaning per `handles` value, themed paint instead of the literal
            // 'steelblue' that used to be an area handle's fallback fill.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            const yBase = baselineOf(yScale, height);
            const xBase = baselineOf(xScale, 0);

            const domainAxis = valueAxis === 'y' ? 'x' : 'y';
            for (const [series, rows] of groups) {
                const groupRows = rows || [];
                // Place the DOMAIN axis first and order by its pixel position — the
                // same rule `line` follows (orderSeries), so an ordinal x orders by
                // its declared domain and the band never crosses itself.
                const placed = groupRows.map(({ d, i }) => ({
                    d, i,
                    cx: encodeChannel(scales, channels, 'x', d, width / 2, i, currentData),
                    cy: encodeChannel(scales, channels, 'y', d, height / 2, i, currentData),
                }));
                const sorted = orderSeries(placed, connect, domainAxis, channels);

                const areaInk = themeOf(scales).ink;
                // One band spans a whole series, so its style resolves from the series'
                // FIRST row — and passes that row's own index, not a bare undefined.
                const style = resolveStyle(scales, channels, sorted[0] ? sorted[0].d : {},
                    markDefaults(scales, 'area', { fill: areaInk, stroke: areaInk, fillOpacity: 0.35 }),
                    sorted[0] ? sorted[0].i : undefined, currentData);
                // One band per SERIES, so a channel-bound curve resolves once per
                // series against its first row — the same rule as the style above.
                const seriesCurve = String(rawChannel(channels, 'curve',
                    sorted[0] ? sorted[0].d : {}, curve,
                    sorted[0] ? sorted[0].i : undefined, currentData));

                // Span mode: the far edge is a second field, not the baseline. Both
                // edges resolve through encodeChannel like any other channel, so the
                // only difference from the baseline form is WHERE the path closes.
                // One SAMPLE per row: the domain position and the band's two edges in
                // pixels. A row with no value gets a null edge, which breaks the
                // band there (core/curves.js `defined`) instead of drawing through
                // the baseline. Each sorted entry keeps its GLOBAL index `i`, so a
                // derived ({ fn }) channel gets the same (d, i, data) here as it would
                // on any other mark — sorting into series must not change what fn
                // sees.
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
                // The path: top and bottom edges generated TOGETHER by d3.area, so one
                // curve applies to both in the same direction (a closed polygon
                // through d3.line curved the bottom edge backwards). `points` is the
                // outline polygon the pick layer measures and the canvas can draw.
                const d = areaGenerator(seriesCurve, valueAxis !== 'y')(samples);
                const defined = samples.filter((s) => valueAxis === 'y'
                    ? Number.isFinite(s.x) && Number.isFinite(s.y0) && Number.isFinite(s.y1)
                    : Number.isFinite(s.y) && Number.isFinite(s.x0) && Number.isFinite(s.x1));
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
                        curve: seriesCurve,
                        ...style,
                        strokeWidth: style.strokeWidth != null ? style.strokeWidth : 1,
                        series: series === SINGLE ? undefined : series,
                        pointerEvents: 'none'
                    });
                }

                // Handles. In span mode BOTH edges get one — an interval is edited by
                // its ends, and a band whose lower edge had no handle would be a
                // half-editable mark. Each carries the `channel` it belongs to, which
                // is what claimSpanEdges' `when` guard reads to keep a drag on one
                // edge from also running the other edge's edit.
                const handleChannels = spanMode
                    ? (valueAxis === 'y' ? ['y1', 'y2'] : ['x1', 'x2'])
                    : [valueAxis];
                // One `handles` vocabulary (plot/mark.js): false = neither drawn nor
                // grabbable; 'hit' = invisible but grabbable. area used to treat false
                // as opacity:0 + pointerEvents:none and ignore 'hit'.
                if (handleStyle.grabbable) {
                    sorted.forEach(({ d, i }) => {
                        // Filled with the band's own colour (its stroke, else its
                        // fill), ringed with the theme's handle stroke.
                        const paint = resolveStyle(scales, channels, d, markDefaults(scales, 'area',
                            { fill: areaInk, stroke: areaInk }), i, currentData);
                        const hStyle = {
                            fill: handleStyle.visible ? (handleColor || paint.stroke || paint.fill || handleStyle.fill) : handleStyle.fill,
                            stroke: handleStyle.stroke,
                            strokeWidth: handleStyle.strokeWidth,
                        };
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
                                // Channel fill must not paint a 'hit' handle — force
                                // transparent after resolveStyle.
                                ...(handleStyle.visible ? {} : {
                                    fill: 'transparent',
                                    stroke: 'none',
                                    strokeWidth: 0,
                                }),
                                data: d,
                                index: i,
                                channel: ch,
                                series: series === SINGLE ? undefined : series,
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
export function area(options = {}) {
    return buildArea(options);
}

/** @param {any} [options] @returns {import('../types').Mark} */
export function areaY(options = {}) {
    return area({ ...options, orientation: 'vertical' });
}

/** @param {any} [options] @returns {import('../types').Mark} */
export function areaX(options = {}) {
    return area({ ...options, orientation: 'horizontal' });
}
