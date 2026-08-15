// @ts-check
// guides.rule — a declarative reference line, positioned in DATA space through
// the scales. It's the guide counterpart of a mark: you give it a value on a
// channel and it draws a line across the plot at that position, using the SAME
// scale.encode() a mark would. Non-interactive.
//
//   elicit.guides.rule({ y: 50, label: "target" })   // horizontal line at y = 50
//   elicit.guides.rule({ x: "Neutral" })             // vertical line at a category
//
// Any option may instead be a function of the guide context, so a reference line
// can be DERIVED from the elicited data rather than fixed:
//
//   elicit.guides.rule({ y: ({ data }) => d3.mean(data, (d) => d.y), label: "mean" })
//
// Because it positions through scale.encode, it works on any scale type (linear
// pixel, band centre) with no special-casing — a reference line on a Likert band
// axis is the same call as one on a continuous axis.

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * `rule`'s option vocabulary. Exported so one list drives the diagnostics,
 * the docs table, and (later) the JSON grammar.
 * @type {string[]}
 */
export const RULE_OPTIONS = ['x', 'y', 'stroke', 'strokeDasharray', 'strokeWidth', 'opacity', 'label'];

/**
 * @param {{ x?: any, y?: any, stroke?: any, strokeDasharray?: any, label?: any }} [options]
 * @returns {import('../types').Guide}
 */
export function rule(options = {}) {
    warnUnknownGuideOptions('rule', options, RULE_OPTIONS);
    return {
        views: 'state',
        build: (_rows, _scales, _w, _h, ctx) => {
            const { scales, width, height } = ctx;
            // Colour/dash default to the theme's rule tokens (a theme can restyle
            // every reference line); an explicit option still wins.
            const rt = (ctx.theme && ctx.theme.guide && ctx.theme.guide.rule) || {};
            const {
                x, y, stroke = rt.stroke || '#64748b', strokeDasharray = rt.strokeDasharray || '5 4', label
            } = resolveGuideOptions(options, ctx);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            if (y !== undefined && scales.y) {
                const py = scales.y.encode(y);
                nodes.push({
                    type: 'line', x1: 0, x2: width, y1: py, y2: py,
                    stroke, strokeDasharray, strokeWidth: 1, opacity: 0.9,
                    pointerEvents: 'none', guide: true
                });
                if (label) nodes.push({
                    type: 'text', x: width - 4, y: py - 4, text: label,
                    fill: stroke, fontSize: 10, textAnchor: 'end',
                    pointerEvents: 'none', guide: true
                });
            }

            if (x !== undefined && scales.x) {
                const px = scales.x.encode(x);
                nodes.push({
                    type: 'line', x1: px, x2: px, y1: 0, y2: height,
                    stroke, strokeDasharray, strokeWidth: 1, opacity: 0.9,
                    pointerEvents: 'none', guide: true
                });
                if (label) nodes.push({
                    type: 'text', x: px + 4, y: 10, text: label,
                    fill: stroke, fontSize: 10, textAnchor: 'start',
                    pointerEvents: 'none', guide: true
                });
            }

            return nodes;
        }
    };
}
