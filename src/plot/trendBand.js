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
// turn it on for standalone spread edits. Affordance when handles are on:
//   circle at `anchor` → channel:'interceptSpread' (or intercept1/2)
//   circle at `probe`  → channel:'slopeSpread' (or slope1/2)
//   handles: true|false|'hit' — shared contract
//
// It declares NO edits of its own. A band and a line over the same rows are two
// views of one belief, and a whole-dataset (plane/probe) edit declared on both
// would run twice per gesture — see warnDuplicatePlaneEdits. Declare the edit on
// the mark the reader grabs; the band re-derives on the next render.

import { resolveStyle, normalizeMarkOptions, markDefaults, themeOf, encodeValue, positionalKeys, resolveHandles, markCommon} from './mark.js';
import {
    paramChannels, readParams, anchorsOf, valueAt,
    lineSegment, envelopePolygon, nestedEnvelopes, sampleLines
} from './trendGeometry.js';

/**
 * @param {import('../types').TrendBandOptions} [options]
 * @returns {import('../types').Mark}
 */
export function trendBand(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'trendBand',
        allow: ['render', 'levels', 'samples', 'seed', 'sigma', 'distribution',
            'anchor', 'probe', 'handles', 'handleSize', 'handleColor']
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
        handles = false,
        handleSize,
        handleColor
    } = opts;

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
                // One grab per spread, on the band's upper edge at the x where that
                // spread has all the leverage: the slope's at `probe`, the
                // intercept's at `anchor` (where the slope range contributes nothing).
                const edge = (/** @type {number} */ x) =>
                    params.aHi + Math.max(params.bLo * x, params.bHi * x);
                for (const [channel, at] of /** @type {[string, number][]} */ ([['interceptSpread', anchor], ['slopeSpread', probe]])) {
                    if (!channels[channel]) continue;
                    nodes.push({
                        type: 'circle',
                        cx: encodeValue(scales, channels, 'x', at, 0),
                        cy: encodeValue(scales, channels, 'y', flat ? valueAt(params, at) : edge(at), 0),
                        r: handleStyle.size,
                        fill: handleStyle.visible ? (handleColor || paint) : 'transparent',
                        // The mark's anchor/probe ride along, so the spread edits pivot
                        // where the handle sits — see plot/trend.js.
                        data: d, index: i, channel, anchor, probe
                    });
                }
            });

            return nodes;
        }
    };
}
