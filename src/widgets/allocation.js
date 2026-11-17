// @ts-check
// allocation.js — budget / share-of-N bars with redistribute-to-sum.
// Plain-chart twin: barY + drag + maintainSum({ strategy: 'redistribute' }) + clamp.

import { barY } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp, maintainSum } from '../constraints/index.js';
import { prompt, barTracks } from './theme.js';
import { widgetLook } from './shared.js';
import { barPaint } from './parts.js';

/**
 * @param {import('../types').WidgetOptions & { categories?: string[], total?: number,
 *   values?: number[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function allocation(opts = {}) {
    const {
        question = 'Allocate the budget',
        categories = ['A', 'B', 'C', 'D'],
        total = 100,
        values,
        onChange,
        width = 480,
        height = 280,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;

    const equal = total / categories.length;
    const data = categories.map((cat, i) => ({
        cat,
        share: values && values[i] != null ? values[i] : equal
    }));

    return {
        width,
        height,
        theme: look.theme,
        margins: { top: 40, right: 24, bottom: 36, left: 48 },
        schema: {
            cat: { type: 'categorical', domain: categories },
            share: { type: 'quantitative', domain: [0, total] }
        },
        data,
        constraints: [
            clamp({ min: 0, max: total, field: 'share' }),
            maintainSum({ total, field: 'share', strategy: 'redistribute' })
        ],
        onChange,
        guides: [prompt(question), barTracks()],
        marks: [
            barY({
                id: 'alloc',
                ...barPaint(t, design, 0.75),
                channels: {
                    x: { field: 'cat' },
                    y: { field: 'share', edit: move({ guide: true, stage }) }
                }
            })
        ]
    };
}
