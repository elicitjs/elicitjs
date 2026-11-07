// @ts-check
// interval.js — uncertainty interval (mean + lo/hi caps) as a composite glyph.
// Plain-chart twin: composite of an inert whisker + point + ticks, with a coupled
// mean edit (drag the centre, the whole interval translates) and a dataset
// constraint that keeps the mean between the caps.

import { composite, point, ruleY, tick } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp, ordering, follow, symmetric } from '../constraints/index.js';
import { prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * The glyph's coupling is DECLARED, as dataset invariants: `follow` carries the
 * interval with its mean (the range moves as a unit), `ordering` keeps lo ≤ mean
 * ≤ hi whichever handle is grabbed, and `symmetric: true` mirrors one end's drag
 * about the mean. The handles are ordinary `move()`s — nothing here is a custom
 * edit — so the same three lines couple any mean-with-interval glyph.
 * @param {import('../types').WidgetOptions & { category?: string, mean?: number, lo?: number, hi?: number,
 *   domain?: [number, number], symmetric?: boolean }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function interval(opts = {}) {
    const {
        question = 'Set your interval',
        category = 'estimate',
        mean = 50,
        lo = 30,
        hi = 70,
        domain = [0, 100],
        symmetric: mirrored = false,
        onChange,
        width = 360,
        height = 280,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    return {
        width,
        height,
        theme,
        margins: { top: 40, right: 24, bottom: 36, left: 48 },
        schema: {
            cat: { type: 'categorical', domain: [category] },
            mean: { type: 'quantitative', domain },
            lo: { type: 'quantitative', domain },
            hi: { type: 'quantitative', domain }
        },
        data: [{ cat: category, mean, lo, hi }],
        constraints: [
            follow({ field: ['lo', 'hi'], lead: 'mean' }),
            ...(mirrored ? [symmetric({ field: ['lo', 'hi'], about: 'mean' })] : []),
            ordering({ field: ['lo', 'mean', 'hi'] }),
            clamp({ min: domain[0], max: domain[1], field: ['lo', 'mean', 'hi'] }),
        ],
        onChange,
        guides: [prompt(question)],
        marks: [
            composite({
                id: 'ci',
                parts: [
                    // Inert whisker — no edit, so it stays pointer-transparent and
                    // cannot swallow a cap or mean drag.
                    ruleY({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y1: { field: 'lo' },
                            y2: { field: 'hi' }
                        }
                    }),
                    point({
                        size: t.widget.radius - 2,
                        fill: t.widget.accent,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'mean', edit: move({ stage, guide: true }) }
                        }
                    }),
                    tick({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'lo', edit: move({ stage }) }
                        }
                    }),
                    tick({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'hi', edit: move({ stage }) }
                        }
                    })
                ]
            })
        ]
    };
}

