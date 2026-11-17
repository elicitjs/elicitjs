// @ts-check
// matrix.js: a grid of questions by options, one answer per question.
// Plain-chart twin: a mark on two band scales + toggle({ pick: 'probe' }) + unique.

import { toggle } from '../edit/index.js';
import { unique } from '../constraints/index.js';
import { cellGrid, prompt } from './theme.js';
import { widgetLook } from './shared.js';
import { answerMark } from './parts.js';

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
    const look = widgetLook(theme);
    const { t, design } = look;

    const margins = { top: 62, right: 30, bottom: 20, left: 130 };
    const innerWidth = width - margins.left - margins.right;
    const innerHeight = height - margins.top - margins.bottom;

    return {
        width,
        height,
        theme: look.theme,
        margins,
        schema: {
            option: { type: 'ordinal', domain: options },
            question: { type: 'categorical', domain: questions }
        },
        scales: {
            x: { type: 'band' },
            y: { type: 'band', range: [0, innerHeight] }
        },
        data: value,
        constraints: [unique({ field: 'question', strategy: 'replace' })],
        onChange,
        axes: false,
        // A design whose answer fills the cell draws its cells edge to edge.
        guides: [prompt(question || '', { y: -38 }), cellGrid(design.tiles ? { pad: 0 } : {})],
        marks: [
            answerMark({
                id: 'matrix', t, design, layout: 'cell', control: 'radio',
                cell: {
                    width: innerWidth / Math.max(1, options.length),
                    height: innerHeight / Math.max(1, questions.length),
                },
                channels: {
                    x: { field: 'option' },
                    y: { field: 'question' }
                },
                edits: [toggle({ pick: 'probe', channels: ['x', 'y'], advance: false, stage })],
            })
        ]
    };
}
