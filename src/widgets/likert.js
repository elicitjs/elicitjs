// @ts-check
// likert.js: a Likert scale. A `point` on a band of the options, `create` under
// the `probe` driver (hover previews, a click sets), and
// `count({ max: 1, strategy: 'replace' })` to keep one answer. The rings come
// from theme.js.
//
// Returns an ElicitSpec: Elicit(likert({ question, options })). The plain-API
// twin is on the `/widgets` page of the elicitjs-docs site.

import { point } from '../plot/index.js';
import { create } from '../edit/index.js';
import { count } from '../constraints/index.js';
import { optionRings, prompt } from './theme.js';
import { widgetTheme } from './shared.js';

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
        height = 130,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    return {
        width,
        height,
        theme,
        margins: { top: 34, right: 60, bottom: 44, left: 60 },
        // `ordinal`: the options' order is meaningful. The schema lets the scales
        // resolve with zero rows.
        schema: { choice: { type: 'ordinal', domain: options } },
        // A band, so each ring gets an interval rather than a tick.
        scales: { x: { type: 'band' } },
        // The elicited dataset: the one answer, or no rows until the first click.
        data: value != null ? [{ choice: value }] : [],
        // Each click appends; count trims back to the single newest point.
        constraints: [count({ max: 1, strategy: 'replace' })],
        onChange,
        // The instrument draws its own scale (rings + labels); no chart axes.
        axes: false,
        guides: [prompt(question || ''), optionRings()],
        marks: [
            point({
                id: 'likert',
                size: t.widget.radius - 3,
                fill: t.widget.accent,
                channels: {
                    x: { field: 'choice' }
                },
                edits: [
                    // Hover previews, a click commits. `advance: false`: one stage,
                    // and re-clicking moves the answer.
                    create({ pick: 'probe', channels: ['x'], advance: false, stage })
                ]
            })
        ]
    };
}
