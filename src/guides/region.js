// @ts-check
import { GUIDE_OPTIONS } from '../vocabulary.js';
// guides.region: a shaded band between two values on an axis, positioned in data
// space. Any option may be a function of the guide context.
//
//   elicit.guides.region({ y: [40, 60] })          // horizontal band, y in [40,60]
//   elicit.guides.region({ x: ["Agree", "Strongly agree"] })
//   elicit.guides.region({ y: ({ data }) => [min(data), max(data)] })

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * @param {{ x?: any, y?: any, fill?: any, opacity?: any, stroke?: any, label?: any }} [options]
 *   `stroke` outlines the band; `label` names it (drawn at the band's top-left,
 *   in the plot's label ink).
 * @returns {import('../types').Guide}
 */
export function region(options = {}) {
    warnUnknownGuideOptions('region', options, GUIDE_OPTIONS.region);
    return {
        views: 'state',
        type: 'region',
        build: (_rows, _scales, _w, _h, ctx) => {
            const { scales, width, height } = ctx;
            // Fill/opacity default to the theme's region tokens; an option still wins.
            const rt = ctx.theme?.guide?.region || {};
            const {
                x, y, fill = rt.fill || '#64748b', opacity = rt.opacity ?? 0.1,
                stroke, label,
            } = resolveGuideOptions(options, ctx);
            const labelFill = ctx.theme?.guide?.rule?.labelFill || ctx.theme?.label || '#374151';
            const fontSize = ctx.theme?.guide?.rule?.fontSize || 11;

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            /** @param {number} bx @param {number} by @param {number} bw @param {number} bh */
            const band = (bx, by, bw, bh) => {
                nodes.push({
                    type: 'rect', x: bx, y: by, width: bw, height: bh,
                    fill, opacity, pointerEvents: 'none', guide: true,
                    ...(stroke != null ? { stroke, strokeWidth: 1 } : {}),
                });
                if (label != null && label !== '') {
                    nodes.push({
                        type: 'text', x: bx + 4, y: by + fontSize + 2, text: String(label),
                        fill: labelFill, fontSize, textAnchor: 'start',
                        pointerEvents: 'none', guide: true,
                    });
                }
            };

            if (Array.isArray(y) && scales.y) {
                const a = scales.y.encode(y[0]);
                const b = scales.y.encode(y[1]);
                band(0, Math.min(a, b), width, Math.abs(b - a));
            }

            if (Array.isArray(x) && scales.x) {
                const a = scales.x.encode(x[0]);
                const b = scales.x.encode(x[1]);
                band(Math.min(a, b), 0, Math.abs(b - a), height);
            }

            return nodes;
        }
    };
}
