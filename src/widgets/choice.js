// @ts-check
// choice.js: multiple choice. Several answers, up to `max`.
// Plain-chart twin: a mark + toggle({ pick: 'probe' }) + unique + count.

import { toggle } from '../edit/index.js';
import { unique, count } from '../constraints/index.js';
import { options as optionsGuide, prompt } from './theme.js';
import { widgetLook, tileLayout } from './shared.js';
import { answerMark } from './parts.js';

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
        height,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;

    /** @type {any[]} */
    const constraints = [unique({ field: 'choice', strategy: 'reject' })];
    if (max !== Infinity) constraints.push(count({ max, strategy: 'reject' }));

    // The design says whether the options stack as a list or run in a row.
    const layout = design.list ? 'list' : 'row';
    const axis = layout === 'list' ? 'y' : 'x';
    const tiled = design.tiles ? tileLayout({ count: options.length, layout, t, width, height }) : null;
    const total = tiled ? tiled.height : (height != null ? height : 130);
    const margins = tiled ? tiled.margins : { top: 34, right: 60, bottom: 44, left: 60 };
    // A list reads top to bottom, so its band runs down the plot.
    /** @type {import('../types').ScaleSpec} */
    const scale = tiled ? tiled.scale : (layout === 'list'
        ? { type: 'band', range: [0, total - margins.top - margins.bottom] }
        : { type: 'band' });

    return {
        width,
        height: total,
        theme: look.theme,
        margins,
        schema: { choice: { type: 'categorical', domain: options } },
        scales: { [axis]: scale },
        data: value.map((v) => ({ choice: v })),
        constraints,
        onChange,
        axes: false,
        guides: [prompt(question || '', tiled ? { y: tiled.promptY } : {}), optionsGuide({ control: 'check' })],
        marks: [
            answerMark({
                id: 'choice', t, design, layout, control: 'check',
                cell: tiled ? tiled.cell : { width: 0, height: total - margins.top - margins.bottom },
                channels: { [axis]: { field: 'choice' } },
                edits: [toggle({ pick: 'probe', channels: [axis], advance: false, stage })],
            })
        ]
    };
}
