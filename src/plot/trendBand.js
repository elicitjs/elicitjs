// @ts-check
// trendBand.js: the uncertainty around a parametric line, drawn as the family of
// lines allowed by an interval on the intercept and on the slope. The model is in
// plot/trendGeometry.js; this file is the paint.
//
//   trendBand({ channels: {
//     intercept: { field: 'a' }, interceptSpread: { field: 'aSd' },
//     slope:     { field: 'b' }, slopeSpread:     { field: 'bSd' },
//   }})
//
// `render`:
//   'region'   (default) one polygon, the exact envelope.
//   'gradient' `levels` nested envelopes stacked at low opacity, darkening toward
//              the line.
//   'samples'  `samples` lines drawn from the family; `distribution` is 'normal'
//              (bounds = `sigma` envelope) or 'uniform'.
//
// The band nodes are inert and painted in the background layer. `handles` defaults
// to false (unlike `trend`); when on, the spread grips follow trend's `grip`:
//   circle at `anchor`      → channel:'interceptSpread'
//   circle at each edge end → channel:'slopeSpread' (grip: 'end', the default)
//   circle at `probe`       → channel:'slopeSpread' (grip: 'probe')
//
// Declare a plane/probe edit on the band or the line, not both, or it runs twice
// per gesture (see warnDuplicatePlaneEdits).

import { resolveStyle, normalizeMarkOptions, markDefaults, themeOf, encodeValue, positionalKeys, resolveHandles, handlesAreAffordance, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import {
    trendChannels, trendRequires, warnProbeIgnored, readParams, anchorsOf, valueAt,
    lineSegment, segmentEnds, envelopePolygon, nestedEnvelopes, sampleLines
} from './trendGeometry.js';

/**
 * @param {import('../types').TrendBandOptions} [options]
 * @returns {import('../types').Mark}
 */
export function trendBand(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'trendBand',
        allow: MARK_OPTIONS.trendBand
    });
    const {
        edits,
        render = 'region',
        levels = 5,
        samples = 60,
        seed = 7,
        // The bounds are the fan's edge, not an SD: samples use sd = spread / sigma.
        sigma = 1.96,
        distribution = 'normal',
        anchor: anchorOpt,
        probe: probeOpt,
        grip = 'end',
        handles = false,
        handleSize,
        handleColor
    } = opts;

    warnProbeIgnored('trendBand', 'slopeSpread', "the band's own edge ends", probeOpt, grip);

    const channels = trendChannels(opts.channels || {});
    const anchors = { anchor: anchorOpt, probe: probeOpt };
    // Spread grips are row handles unless an inert band asks for them as ink.
    const rowHandle = handlesAreAffordance(opts.handles, { edits, channels });

    return {
        ...markCommon(opts),
        type: 'trendBand',
        channels,
        supportsTrend: true,
        // Gets the trend's origin-crossing axes.
        isTrend: true,
        ...positionalKeys(channels),
        // build() bails to [] without both continuous axes; this says why.
        requires: trendRequires(),
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            if (!scales.x || !scales.y) return [];
            const { anchor, probe } = anchorsOf(scales, anchors);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            const bandInk = themeOf(scales).ink;
            // A region uses `fillOpacity`, a fan of samples `strokeOpacity`; neither
            // is derived from the other.
            const bandDefaults = markDefaults(scales, 'trendBand',
                { fill: bandInk, stroke: bandInk, fillOpacity: 0.18, strokeOpacity: 0.15 });

            /**
             * The end of a straight edge's clipped segment: `1` for the largest
             * data-x, `-1` for the smallest. Compared in data space so a reversed x
             * range still picks the same end.
             * @param {{ a: number, b: number }} line
             * @param {number} side
             * @returns {{ x: number, y: number } | null}
             */
            const edgeEnd = (line, side) => {
                const ends = segmentEnds(
                    lineSegment(line, scales, channels, width, height), handleStyle.size + 1);
                if (!ends) return null;
                const xs = /** @type {any} */ (scales.x);
                const at = xs && xs.invertible
                    ? (/** @type {{x: number}} */ p) => Number(xs.invertValue(p.x))
                    : (/** @type {{x: number}} */ p) => p.x;
                const [p, q] = ends;
                return (side > 0) === (at(p) >= at(q)) ? p : q;
            };

            currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                // No intercept or slope: no line, so no band about it.
                if (missingValue(channels, 'intercept', d) || missingValue(channels, 'slope', d)) return;
                const params = readParams(d, channels, scales, i, currentData);
                const style = resolveStyle(scales, channels, d, bandDefaults, i, currentData);
                const paint = style.fill || bandDefaults.fill;
                const alpha = style.fillOpacity;
                // A zero-width band draws nothing (handles still draw).
                const flat = params.aLo === params.aHi && params.bLo === params.bHi;

                if (!flat && render === 'samples') {
                    for (const line of sampleLines(params, { samples, seed, distribution, sigma })) {
                        const seg = lineSegment(line, scales, channels, width, height);
                        if (!seg) continue;
                        nodes.push({
                            type: 'line',
                            ...seg,
                            stroke: style.stroke || bandDefaults.stroke,
                            strokeWidth: style.strokeWidth != null ? style.strokeWidth : 1,
                            // Per line, so more samples darken the overlap.
                            strokeOpacity: style.strokeOpacity,
                            pointerEvents: 'none',
                            background: true
                        });
                    }
                } else if (!flat && render === 'gradient') {
                    // Per-level alpha that compounds to `alpha` at the centre.
                    const n = Math.max(1, Math.round(levels));
                    const perLevel = 1 - Math.pow(1 - Math.min(0.99, alpha), 1 / n);
                    for (const ring of nestedEnvelopes(params, n, scales, channels, width, height)) {
                        nodes.push({
                            type: 'path',
                            points: ring,
                            curve: 'linear',
                            fill: paint,
                            fillOpacity: perLevel,
                            stroke: 'none',
                            pointerEvents: 'none',
                            background: true
                        });
                    }
                } else if (!flat) {
                    const ring = envelopePolygon(params, scales, channels, width, height);
                    if (ring.length >= 3) {
                        nodes.push({
                            type: 'path',
                            points: ring,
                            curve: 'linear',
                            fill: paint,
                            fillOpacity: alpha,
                            stroke: 'none',
                            pointerEvents: 'none',
                            background: true
                        });
                    }
                }

                if (!handleStyle.grabbable) return;
                // Grips sit on the band's upper edge: intercept spread at `anchor`,
                // slope spread at the edge's ends or at `probe`.
                const edge = (/** @type {number} */ x) =>
                    params.aHi + Math.max(params.bLo * x, params.bHi * x);
                const handle = (/** @type {string} */ channel, /** @type {number} */ cx, /** @type {number} */ cy) => {
                    nodes.push({
                        type: 'circle',
                        cx, cy,
                        r: handleStyle.size,
                        fill: handleStyle.visible ? (handleColor || paint) : 'transparent',
                        // anchor/probe/grip ride along for the spread edits (see plot/trend.js).
                        data: d, index: i, channel, anchor, probe, grip,
                        rowHandle, // dropped where no live edit reaches the row
                    });
                };

                if (channels.interceptSpread) {
                    handle('interceptSpread',
                        encodeValue(scales, channels, 'x', anchor, 0),
                        encodeValue(scales, channels, 'y', flat ? valueAt(params, anchor) : edge(anchor), 0));
                }
                if (!channels.slopeSpread) return;
                if (grip === 'probe') {
                    handle('slopeSpread',
                        encodeValue(scales, channels, 'x', probe, 0),
                        encodeValue(scales, channels, 'y', flat ? valueAt(params, probe) : edge(probe), 0));
                    return;
                }
                // The upper edge is piecewise: `bHi` where x > 0, `bLo` where x < 0.
                // Each end comes off its own piece.
                for (const [side, b] of /** @type {[number, number][]} */ ([[1, params.bHi], [-1, params.bLo]])) {
                    const end = edgeEnd({ a: params.aHi, b }, side);
                    if (end) handle('slopeSpread', end.x, end.y);
                }
            });

            return nodes;
        }
    };
}
