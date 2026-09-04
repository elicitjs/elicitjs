// @ts-check
// labeledValue.js — editable numeric or string readout via text mark.
// Plain-chart twin: text + drag and/or editText.

import { text } from '../plot/index.js';
import { move, editText } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { input?: 'number' | 'text', value?: any,
 *   domain?: [number, number], label?: string }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function labeledValue(opts = {}) {
    const {
        question = 'Set the value',
        input = 'number',
        value,
        domain = [0, 100],
        label = 'value',
        onChange,
        width = 360,
        height = 200,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    if (input === 'text') {
        return {
            width,
            height,
            theme,
            margins: { top: 40, right: 24, bottom: 24, left: 24 },
            // x/y are declared even though no axis is drawn: the label is draggable,
            // so they're elicited fields like any other, and the schema is what owns
            // a field's domain. Leaving them out let them be inferred from the single
            // seed row (a zero-width domain) and tripped the resolver's warning.
            schema: {
                label: { type: 'categorical' },
                x: { type: 'quantitative', domain: [0, 10] },
                y: { type: 'quantitative', domain: [0, 10] }
            },
            data: [{ x: 5, y: 5, label: value != null ? String(value) : label }],
            onChange,
            axes: false,
            guides: [prompt(question)],
            marks: [
                text({
                    id: 'label',
                    fontSize: 18,
                    fill: t.widget.accent,
                    channels: {
                        x: { field: 'x' },
                        y: { field: 'y' },
                        text: { field: 'label', edit: editText() }
                    },
                    edits: [move({ channels: ['x', 'y'], stage })]
                })
            ]
        };
    }

    return {
        width,
        height,
        theme,
        margins: { top: 40, right: 40, bottom: 36, left: 48 },
        schema: {
            cat: { type: 'categorical', domain: ['v'] },
            n: { type: 'quantitative', domain }
        },
        data: [{ cat: 'v', n: value != null ? value : domain[0] }],
        constraints: [clamp({ min: domain[0], max: domain[1], field: 'n' })],
        onChange,
        guides: [prompt(question)],
        marks: [
            text({
                id: 'readout',
                fontSize: 22,
                fill: t.widget.accent,
                channels: {
                    x: { field: 'cat' },
                    y: { field: 'n', edit: move({ guide: true, stage }) },
                    text: { field: 'n' }
                }
            })
        ]
    };
}
