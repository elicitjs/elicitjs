// @ts-check
// trendBand.js — the UNCERTAINTY around a parametric line. Where `trend` draws
// y = intercept + slope*x, this draws the whole family of lines the belief allows:
// an interval on the intercept, an interval on the slope, and everything between.
//
//   trendBand({ channels: {
//     intercept: { field: 'a' }, interceptSpread: { field: 'aSd' },
//     slope:     { field: 'b' }, slopeSpread:     { field: 'bSd' },
//   }})
//
// The uncertainty is named EITHER symmetrically (`interceptSpread` / `slopeSpread`,
// a half-width in the field's own units — one pointer distance sets one) or as an
// explicit asymmetric range (`intercept1`/`intercept2`, `slope1`/`slope2`, the same
// 1/2 span spelling `area` and `rect` use). See plot/trendGeometry.js for the model
// and the envelope formula; this file is only the paint.
//
// ── Three readings of one band ──────────────────────────────────────────────
//   'region'   (default) one polygon: the exact envelope. Crisp, cheap, and the
//              honest shape — the family really is a convex region with a kink
//              where x crosses zero.
//   'gradient' `levels` nested envelopes stacked at low opacity, so the ink
//              darkens toward the line. The renderer has no gradients; a ramp here
//              is N shapes, the same idiom `legend`'s continuous ramp uses.
//   'samples'  `samples` individual lines drawn from the family. The ensemble
//              reading — you see the individual hypotheses rather than their hull.
//              `distribution` picks how: 'normal' treats the bounds as a `sigma`
//              envelope (~95% of draws land inside it), 'uniform' spreads flat.
//
// Every node is inert (`pointerEvents: 'none'`) and painted in the BACKGROUND
// layer, because the band is a view of parameters the reader edits elsewhere —
// on the `trend` line's handles, or straight off the plane. `handles` defaults
// FALSE (unlike `trend`) so a band+line pair doesn't double the grab targets;
// turn it on for standalone spread edits. The spread grips follow `trend`'s `grip`
// contract exactly — a PAIR mounted on the ends of the band's own upper edge by
// default, so opening the cone is not capped by how far the pinned column reaches,
// and one pinned at x = `probe` under `grip: 'probe'`. Affordance when handles are
// on:
//   circle at `anchor`     → channel:'interceptSpread' (or intercept1/2)
//   circle at each EDGE END→ channel:'slopeSpread' (grip: 'end', the default)
//   circle at `probe`      → channel:'slopeSpread' (grip: 'probe')
//   handles: true|false|'hit' — shared contract
//
// It declares NO edits of its own. A band and a line over the same rows are two
// views of one belief, and a whole-dataset (plane/probe) edit declared on both
// would run twice per gesture — see warnDuplicatePlaneEdits. Declare the edit on
// the mark the reader grabs; the band re-derives on the next render.

import { resolveStyle, normalizeMarkOptions, markDefaults, themeOf, encodeValue, positionalKeys, resolveHandles, markCommon} from './mark.js';
import {
    paramChannels, readParams, anchorsOf, valueAt,
    lineSegment, segmentEnds, envelopePolygon, nestedEnvelopes, sampleLines
} from './trendGeometry.js';
import { warn } from '../core/dev.js';

/**
 * @param {import('../types').TrendBandOptions} [options]
 * @returns {import('../types').Mark}
 */
export function trendBand(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'trendBand',
        allow: ['render', 'levels', 'samples', 'seed', 'sigma', 'distribution',
            'anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor']
    });
    const {
        edits,
        render = 'region',
        levels = 5,
        samples = 60,
        seed = 7,
        // The bounds are the HALF-WIDTH the gesture points at, not a raw SD: the
        // line under the cursor is the edge of the fan. Samples are drawn with
        // sd = spread / sigma, so ~95% of them land inside it.
        sigma = 1.96,
        distribution = 'normal',
        anchor: anchorOpt,
        probe: probeOpt,
        grip = 'end',
        handles = false,
        handleSize,
        handleColor
    } = opts;

    // Same contract as trend(): `probe` places a grip only under `grip: 'probe'`.
    if (probeOpt != null && grip !== 'probe') {
        warn('trendBand:probe-ignored',
            "trendBand(): `probe` places the slopeSpread handle only under "
            + "`grip: 'probe'`. The default grip mounts the handles on the band's own "
            + "edge ends; add `grip: 'probe'` to pin one at that column instead.");
    }

    const channels = paramChannels(opts.channels || {}, {
        intercept: { field: 'intercept' },
        slope: { field: 'slope' }
    });
    const anchors = { anchor: anchorOpt, probe: probeOpt };

    return {
        ...markCommon(opts),
        markName: 'trendBand',
        channels,
        supportsTrend: true,
        // Shares the trend's origin-crossing axis frame — a band without its line
        // is still a statement about intercept and slope.
        isTrend: true,
        ...positionalKeys(channels),
        // A trend is PARAMETRIC: its line is evaluated at the x domain's ends, not
        // read off any row, so it cannot draw at all without both continuous axes.
        // build() bails to [] in that case — which looks exactly like a spec that
        // silently failed to render, so the engine says why (warnScaleRequirements).
        requires: [{
            channels: ['x', 'y'],
            kind: 'continuous',
            mode: 'all',
            why: 'an intercept and a slope are only defined over two continuous axes.',
        }],
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
            // Shared handle contract (plot/mark.js). `handles` still defaults to
            // FALSE here, unlike every other mark: the band is a view of parameters
            // the reader edits on the trend line, so grabs on it are opt-in.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            const bandInk = themeOf(scales).ink;
            // The two renders ink differently and each gets its own default, both
            // ordinary style channels the author (or a theme) overrides: a filled
            // region is one shape at `fillOpacity`, a fan is N strokes at
            // `strokeOpacity`. Deriving one from the other looks clever and reads as
            // a bug — a fan whose alpha fell off with `samples` was invisible at the
            // default count, and silently ignored a `strokeOpacity` the author set.
            const bandDefaults = markDefaults(scales, 'trendBand',
                { fill: bandInk, stroke: bandInk, fillOpacity: 0.18, strokeOpacity: 0.15 });

            /**
             * The end of a straight edge's clipped segment on the given side of the x
             * axis: `1` for the largest data-x, `-1` for the smallest. Read back through
             * the scale rather than compared in pixels, so a reversed x range picks the
             * same END rather than the same SIDE OF THE SCREEN.
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
                const params = readParams(d, channels, scales, i, currentData);
                const style = resolveStyle(scales, channels, d, bandDefaults, i, currentData);
                const paint = style.fill || bandDefaults.fill;
                const alpha = style.fillOpacity;
                // A zero-width band has nothing to draw — the belief has no
                // uncertainty yet (the state a two-step elicitation starts in).
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
                            // Per LINE, so the fan's density is the author's to pick:
                            // raising `samples` darkens the overlap, and lowering
                            // `strokeOpacity` thins it back out.
                            strokeOpacity: style.strokeOpacity,
                            pointerEvents: 'none',
                            background: true
                        });
                    }
                } else if (!flat && render === 'gradient') {
                    // Stacked at a per-level alpha that COMPOUNDS to `alpha` at the
                    // centre, so the outermost level is faint and the ink builds
                    // toward the line without the author tuning N opacities.
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
                // One grab per spread, on the band's upper edge. The intercept's sits
                // at `anchor`, where the slope range contributes nothing — its place is
                // fixed by the pivot, so it needs no grip contract. The slope's is
                // where that spread has the leverage: the edge's own ends, or `probe`.
                const edge = (/** @type {number} */ x) =>
                    params.aHi + Math.max(params.bLo * x, params.bHi * x);
                const handle = (/** @type {string} */ channel, /** @type {number} */ cx, /** @type {number} */ cy) => {
                    nodes.push({
                        type: 'circle',
                        cx, cy,
                        r: handleStyle.size,
                        fill: handleStyle.visible ? (handleColor || paint) : 'transparent',
                        // The mark's anchor/probe and grip ride along, so the spread
                        // edits pivot where the handle sits and read the gesture the way
                        // that handle affords — see plot/trend.js.
                        data: d, index: i, channel, anchor, probe, grip
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
                // The upper edge is PIECEWISE — `bHi` governs it where x > 0 and `bLo`
                // where x < 0 — so each end comes off its own straight piece, clipped
                // like the line it is. A domain that doesn't cross zero puts both ends
                // on the same piece, which is simply both ends of one segment.
                for (const [side, b] of /** @type {[number, number][]} */ ([[1, params.bHi], [-1, params.bLo]])) {
                    const end = edgeEnd({ a: params.aHi, b }, side);
                    if (end) handle('slopeSpread', end.x, end.y);
                }
            });

            return nodes;
        }
    };
}
