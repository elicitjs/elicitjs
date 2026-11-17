// @ts-check
// slider.js: a value on a track.
// Plain-chart twin: point + move({ pick: 'probe' }) + clamp (+ snap).

import { point } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp, snap } from '../constraints/index.js';
import { sliderTrack, prompt } from './theme.js';
import { widgetLook } from './shared.js';

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
    const look = widgetLook(theme);
    const { t, design } = look;
    const thumb = design.thumb(t);

    /** @type {any[]} */
    const constraints = [clamp({ min: domain[0], max: domain[1], field: 'value' })];
    if (step) constraints.push(snap({ field: 'value', step, origin: domain[0] }));

    return {
        width,
        height,
        theme: look.theme,
        margins: { top: 34, right: 40, bottom: 40, left: 40 },
        schema: { value: { type: 'quantitative', domain } },
        data: [{ value: value != null ? value : domain[0] }],
        constraints,
        onChange,
        axes: false,
        guides: [prompt(question || ''), sliderTrack(format ? { format } : {})],
        marks: [
            point({
                id: 'slider',
                size: thumb.size,
                fill: thumb.fill,
                ...(thumb.stroke != null ? { stroke: thumb.stroke, strokeWidth: thumb.strokeWidth != null ? thumb.strokeWidth : 1 } : {}),
                channels: {
                    x: { field: 'value' }
                },
                edits: [move({ pick: 'probe', channels: ['x'], advance: false, stage })]
            })
        ]
    };
}
