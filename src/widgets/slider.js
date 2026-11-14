// @ts-check
// slider.js: a continuous or stepped slider. The knob follows the pointer and a
// click sets it (`drag` under the `probe` driver). `clamp` keeps it in range; an
// optional `snap` lands it on `step` ticks.
//
// Returns an ElicitSpec: Elicit(slider({ question, domain, step })).

import { point } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp, snap } from '../constraints/index.js';
import { sliderTrack, prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { domain?: [number, number], step?: number,
 *   value?: number, format?: (v: any) => string }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function slider(opts = {}) {
    const {
        question,
        domain = [0, 1],
        step,
        value,
        format,
        onChange,
        width = 560,
        height = 120,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    /** @type {any[]} */
    const constraints = [clamp({ min: domain[0], max: domain[1], field: 'value' })];
    if (step) constraints.push(snap({ field: 'value', step, origin: domain[0] }));

    return {
        width,
        height,
        theme,
        margins: { top: 34, right: 40, bottom: 40, left: 40 },
        // The contract of the elicited dataset: one quantitative value, bounded.
        schema: { value: { type: 'quantitative', domain } },
        // The elicited dataset: the single value the knob carries.
        data: [{ value: value != null ? value : domain[0] }],
        constraints,
        onChange,
        axes: false,
        guides: [prompt(question || ''), sliderTrack(format ? { format } : {})],
        marks: [
            point({
                id: 'slider',
                size: t.widget.radius - 2,
                fill: t.widget.accent,
                channels: {
                    x: { field: 'value' }
                },
                // No `create`: the value always exists, so there is one knob.
                edits: [move({ pick: 'probe', channels: ['x'], advance: false, stage })]
            })
        ]
    };
}
