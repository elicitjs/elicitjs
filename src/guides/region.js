// @ts-check
// guides.region — a declarative shaded band between two values on an axis (an
// "acceptable range", a target zone). Like guides.rule it positions in data
// space through scale.encode, so it composes across scale types, and any option
// may be a function of the guide context (see guides/shared.js).
//
//   elicit.guides.region({ y: [40, 60] })          // horizontal band, y in [40,60]
//   elicit.guides.region({ x: ["Agree", "Strongly agree"] })
//   elicit.guides.region({ y: ({ data }) => [min(data), max(data)] })

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * `region`'s option vocabulary. Exported so one list drives the diagnostics,
 * the docs table, and (later) the JSON grammar.
 * @type {string[]}
 */
export const REGION_OPTIONS = ['x', 'y', 'fill', 'opacity', 'stroke', 'label'];

/**
 * @param {{ x?: any, y?: any, fill?: any, opacity?: any }} [options]
 * @returns {import('../types').Guide}
 */
export function region(options = {}) {
    warnUnknownGuideOptions('region', options, REGION_OPTIONS);
    return {
        views: 'state',
        build: (_rows, _scales, _w, _h, ctx) => {
            const { scales, width, height } = ctx;
            // Fill/opacity default to the theme's region tokens; an option still wins.
            const rt = (ctx.theme && ctx.theme.guide && ctx.theme.guide.region) || {};
            const { x, y, fill = rt.fill || '#64748b', opacity = rt.opacity != null ? rt.opacity : 0.1 } = resolveGuideOptions(options, ctx);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            if (Array.isArray(y) && scales.y) {
                const a = scales.y.encode(y[0]);
                const b = scales.y.encode(y[1]);
                nodes.push({
                    type: 'rect', x: 0, y: Math.min(a, b), width, height: Math.abs(b - a),
                    fill, opacity, pointerEvents: 'none', guide: true
                });
            }

            if (Array.isArray(x) && scales.x) {
                const a = scales.x.encode(x[0]);
                const b = scales.x.encode(x[1]);
                nodes.push({
                    type: 'rect', x: Math.min(a, b), y: 0, width: Math.abs(b - a), height,
                    fill, opacity, pointerEvents: 'none', guide: true
                });
            }

            return nodes;
        }
    };
}
