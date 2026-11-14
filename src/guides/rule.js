// @ts-check
import { GUIDE_OPTIONS } from '../vocabulary.js';
// guides.rule: a reference line at a data value, positioned through scale.encode.
//
//   elicit.guides.rule({ y: 50, label: "target" })   // horizontal line at y = 50
//   elicit.guides.rule({ x: "Neutral" })             // vertical line at a category
//   elicit.guides.rule({ y: ({ data }) => d3.mean(data, (d) => d.y), label: "mean" })

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * @param {{ x?: any, y?: any, stroke?: any, strokeDash?: any, strokeWidth?: any, opacity?: any, label?: any }} [options]
 * @returns {import('../types').Guide}
 */
export function rule(options = {}) {
    warnUnknownGuideOptions('rule', options, GUIDE_OPTIONS.rule);
    return {
        views: 'state',
        type: 'rule',
        build: (_rows, _scales, _w, _h, ctx) => {
            const { scales, width, height } = ctx;
            // Colour/dash default to the theme's rule tokens; an option wins.
            const rt = ctx.theme?.guide?.rule || {};
            const {
                x, y, label,
                stroke = rt.stroke, strokeDash: strokeDasharray = rt.strokeDash,
                strokeWidth = rt.strokeWidth, opacity = rt.opacity,
            } = resolveGuideOptions(options, ctx);
            const fontSize = ctx.theme?.font?.labelSize || 10;

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            if (y !== undefined && scales.y) {
                const py = scales.y.encode(y);
                nodes.push({
                    type: 'line', x1: 0, x2: width, y1: py, y2: py,
                    stroke, strokeDasharray, strokeWidth, opacity,
                    pointerEvents: 'none', guide: true
                });
                if (label) nodes.push({
                    type: 'text', x: width - 4, y: py - 4, text: label,
                    fill: stroke, fontSize, textAnchor: 'end',
                    pointerEvents: 'none', guide: true
                });
            }

            if (x !== undefined && scales.x) {
                const px = scales.x.encode(x);
                nodes.push({
                    type: 'line', x1: px, x2: px, y1: 0, y2: height,
                    stroke, strokeDasharray, strokeWidth, opacity,
                    pointerEvents: 'none', guide: true
                });
                if (label) nodes.push({
                    type: 'text', x: px + 4, y: 10, text: label,
                    fill: stroke, fontSize, textAnchor: 'start',
                    pointerEvents: 'none', guide: true
                });
            }

            return nodes;
        }
    };
}
