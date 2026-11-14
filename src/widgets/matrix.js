// @ts-check
// matrix.js: a question matrix (a grid of Likert rows). A band y of questions
// crossed with a band x of options; the cell grid and labels are guides. `toggle`
// on (x, y) picks a cell, and `unique({ field: 'question', strategy: 'replace' })`
// keeps one answer per row.
//
// Returns an ElicitSpec: Elicit(matrix({ questions, options })).

import { point } from '../plot/index.js';
import { toggle } from '../edit/index.js';
import { unique } from '../constraints/index.js';
import { cellGrid, prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { questions?: any[], options?: any[], value?: any[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function matrix(opts = {}) {
    const {
        question,
        questions = [],
        options = [],
        value = [],
        onChange,
        width = 620,
        height = 100 + questions.length * 46,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    const margins = { top: 62, right: 30, bottom: 20, left: 130 };
    const innerHeight = height - margins.top - margins.bottom;

    return {
        width,
        height,
        theme,
        margins,
        // The contract of the elicited dataset: which option answers which question.
        schema: {
            option: { type: 'ordinal', domain: options },
            question: { type: 'categorical', domain: questions }
        },
        scales: {
            // A band, so each cell gets an interval rather than a tick.
            x: { type: 'band' },
            // A y band defaults to [height, 0]; pin it so the first question is on top.
            y: { type: 'band', range: [0, innerHeight] }
        },
        // The elicited dataset: one row per answered question.
        data: value,
        // One answer per row: a pick elsewhere in the row replaces it.
        constraints: [unique({ field: 'question', strategy: 'replace' })],
        onChange,
        axes: false,
        guides: [prompt(question || '', { y: -38 }), cellGrid()],
        marks: [
            point({
                id: 'matrix',
                size: t.widget.radius - 3,
                fill: t.widget.accent,
                channels: {
                    x: { field: 'option' },
                    y: { field: 'question' }
                },
                edits: [toggle({ pick: 'probe', channels: ['x', 'y'], advance: false, stage })]
            })
        ]
    };
}
