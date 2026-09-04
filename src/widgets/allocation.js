// @ts-check
// allocation.js — budget / share-of-N bars with redistribute-to-sum.
// Plain-chart twin: barY + drag + maintainSum({ strategy: 'redistribute' }) + clamp.

import { barY } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp, maintainSum } from '../constraints/index.js';
import { prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { categories?: string[], targetSum?: number,
 *   values?: number[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function allocation(opts = {}) {
    const {
        question = 'Allocate the budget',
        categories = ['A', 'B', 'C', 'D'],
        targetSum = 100,
        values,
        onChange,
        width = 480,
        height = 280,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    const equal = targetSum / categories.length;
    const data = categories.map((cat, i) => ({
        cat,
        share: values && values[i] != null ? values[i] : equal
    }));

    return {
        width,
        height,
        theme,
        margins: { top: 40, right: 24, bottom: 36, left: 48 },
        schema: {
            cat: { type: 'categorical', domain: categories },
            share: { type: 'quantitative', domain: [0, targetSum] }
        },
        data,
        constraints: [
            clamp({ min: 0, max: targetSum, field: 'share' }),
            maintainSum({ targetSum, field: 'share', strategy: 'redistribute' })
        ],
        onChange,
        guides: [prompt(question)],
        marks: [
            barY({
                id: 'alloc',
                fill: t.widget.accent,
                fillOpacity: 0.75,
                channels: {
                    x: { field: 'cat' },
                    y: { field: 'share', edit: move({ guide: true, stage }) }
                }
            })
        ]
    };
}
