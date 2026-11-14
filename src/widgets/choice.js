// @ts-check
// choice.js: multiple choice. Likert rings, but the answer is a set: hover
// previews picking or un-picking an option, a click commits. `unique` blocks a
// double pick; `count` caps the total.
//
// Returns an ElicitSpec: Elicit(multipleChoice({ question, options, max })).

import { point } from '../plot/index.js';
import { toggle } from '../edit/index.js';
import { unique, count } from '../constraints/index.js';
import { optionRings, prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { options?: any[], max?: number, value?: any[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function multipleChoice(opts = {}) {
    const {
        question,
        options = [],
        max = Infinity,
        value = [],
        onChange,
        width = 560,
        height = 130,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    /** @type {any[]} */
    const constraints = [unique({ field: 'choice', strategy: 'reject' })];
    if (max !== Infinity) constraints.push(count({ max, strategy: 'reject' }));

    return {
        width,
        height,
        theme,
        margins: { top: 34, right: 60, bottom: 44, left: 60 },
        // The contract of the elicited dataset: one categorical pick per row.
        schema: { choice: { type: 'categorical', domain: options } },
        // A band, so each ring gets an interval rather than a tick.
        scales: { x: { type: 'band' } },
        // The elicited dataset: one row per pick.
        data: value.map((v) => ({ choice: v })),
        constraints,
        onChange,
        axes: false,
        guides: [prompt(question || ''), optionRings()],
        marks: [
            point({
                id: 'choice',
                size: t.widget.radius - 3,
                fill: t.widget.accent,
                channels: {
                    x: { field: 'choice' }
                },
                // A click picks an empty option or takes a pick back; hover previews which.
                edits: [toggle({ pick: 'probe', channels: ['x'], advance: false, stage })]
            })
        ]
    };
}
