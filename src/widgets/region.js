// @ts-check
// region.js — annotate a 2-D belief region with brushRect.
// Plain-chart twin: rect + brushRect.

import { rect } from '../plot/index.js';
import { brushRect } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { prompt } from './theme.js';
import { widgetLook } from './shared.js';

/**
 * @param {import('../types').WidgetOptions & { xDomain?: [number, number], yDomain?: [number, number],
 *   x1?: number, x2?: number, y1?: number, y2?: number }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function region(opts = {}) {
    const {
        question = 'Drag the region',
        xDomain = [0, 10],
        yDomain = [0, 10],
        x1 = 3, x2 = 7, y1 = 3, y2 = 7,
        onChange,
        width = 400,
        height = 320,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;
    const corner = design.bar(t).corner;

    return {
        width,
        height,
        theme: look.theme,
        margins: { top: 40, right: 24, bottom: 36, left: 40 },
        schema: {
            x1: { type: 'quantitative', domain: xDomain },
            x2: { type: 'quantitative', domain: xDomain },
            y1: { type: 'quantitative', domain: yDomain },
            y2: { type: 'quantitative', domain: yDomain }
        },
        data: [{ x1, x2, y1, y2 }],
        constraints: [
            clamp({ min: xDomain[0], max: xDomain[1], field: 'x1' }),
            clamp({ min: xDomain[0], max: xDomain[1], field: 'x2' }),
            clamp({ min: yDomain[0], max: yDomain[1], field: 'y1' }),
            clamp({ min: yDomain[0], max: yDomain[1], field: 'y2' })
        ],
        onChange,
        guides: [prompt(question)],
        marks: [
            rect({
                id: 'region',
                fill: t.accent,
                fillOpacity: 0.35,
                stroke: t.accent,
                ...(corner ? { rx: corner } : {}),
                channels: {
                    x1: { field: 'x1' }, x2: { field: 'x2' },
                    y1: { field: 'y1' }, y2: { field: 'y2' }
                },
                edits: [brushRect({ edgeInset: 12, stage })]
            })
        ]
    };
}
