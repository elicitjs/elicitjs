// @ts-check
// histogram.js — frequency beliefs via editable rect/bar bins.
// Plain-chart twin: barY or rectY + drag + create into bins.

import { barY } from '../plot/index.js';
import { move } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { prompt, barTracks } from './theme.js';
import { widgetLook } from './shared.js';
import { barPaint } from './parts.js';

/**
 * @param {import('../types').WidgetOptions & { bins?: string[], max?: number,
 *   values?: number[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function histogram(opts = {}) {
    const {
        question = 'How often?',
        bins = ['0-1', '1-2', '2-3', '3-4', '4+'],
        max = 40,
        values,
        onChange,
        width = 480,
        height = 280,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;

    const data = bins.map((bin, i) => ({
        bin,
        n: values && values[i] != null ? values[i] : 0
    }));

    return {
        width,
        height,
        theme: look.theme,
        margins: { top: 40, right: 24, bottom: 40, left: 40 },
        schema: {
            bin: { type: 'categorical', domain: bins },
            n: { type: 'quantitative', domain: [0, max] }
        },
        data,
        constraints: [clamp({ min: 0, max, field: 'n' })],
        onChange,
        guides: [prompt(question), barTracks()],
        marks: [
            barY({
                id: 'hist',
                ...barPaint(t, design, 0.7),
                channels: {
                    x: { field: 'bin' },
                    y: { field: 'n', edit: move({ guide: true, stage }) }
                }
            })
        ]
    };
}
