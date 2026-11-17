// @ts-check
// likert.js: a Likert scale. One answer on an ordered row of options.
// Plain-chart twin: a mark + create({ pick: 'probe' }) + count({ max: 1 }).

import { create } from '../edit/index.js';
import { count } from '../constraints/index.js';
import { options as optionsGuide, prompt } from './theme.js';
import { widgetLook, tileLayout } from './shared.js';
import { answerMark } from './parts.js';

/**
 * @param {import('../types').WidgetOptions & { options?: any[], value?: any }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function likert(opts = {}) {
    const {
        question,
        options = [],
        value,
        onChange,
        width = 560,
        height,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;

    // Options that tile the plot size it; rings sit on its centre line.
    const tiled = design.tiles ? tileLayout({ count: options.length, layout: 'row', t, width, height }) : null;
    const total = tiled ? tiled.height : (height != null ? height : 130);
    const margins = tiled ? tiled.margins : { top: 34, right: 60, bottom: 44, left: 60 };

    return {
        width,
        height: total,
        theme: look.theme,
        margins,
        schema: { choice: { type: 'ordinal', domain: options } },
        scales: { x: tiled ? tiled.scale : { type: 'band' } },
        data: value != null ? [{ choice: value }] : [],
        constraints: [count({ max: 1, strategy: 'replace' })],
        onChange,
        axes: false,
        guides: [prompt(question || '', tiled ? { y: tiled.promptY } : {}), optionsGuide()],
        marks: [
            answerMark({
                id: 'likert', t, design, layout: 'row', control: 'radio',
                cell: tiled ? tiled.cell : { width: 0, height: total - margins.top - margins.bottom },
                channels: { x: { field: 'choice' } },
                edits: [create({ pick: 'probe', channels: ['x'], advance: false, stage })],
            })
        ]
    };
}
