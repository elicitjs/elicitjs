// @ts-check
// lineCone.js: the two-step correlation elicitation. Stage 0 sets the line
// (slope = r), stage 1 opens the cone (spread); each previews under the pointer
// and a click commits and advances.
//
// A `trend` + `trendBand` with the intercept pinned at 0 and two `clamp`s. The
// inner plot is kept square so the line's screen angle reads as r.
//
// getData() gives [{ r, spread }]; on('stage') reports the question (2 = done).
// Returns an ElicitSpec: Elicit(lineCone({ x: 'Exercise', y: 'Body weight' })).

import { composite, trend, trendBand } from '../plot/index.js';
import { trend as editTrend } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { quadrants, prompt } from './theme.js';

// Minimum margins for the prompt and axis labels; the square plot fits inside the rest.
const MIN_MARGINS = { top: 56, right: 92, bottom: 52, left: 92 };

/**
 * Margins that leave a square inner plot.
 * @param {number} width @param {number} height
 * @returns {{ top: number, right: number, bottom: number, left: number }}
 */
function squareMargins(width, height) {
    const m = { ...MIN_MARGINS };
    const innerW = width - m.left - m.right;
    const innerH = height - m.top - m.bottom;
    if (innerW > innerH) {
        const pad = (innerW - innerH) / 2;
        m.left += pad;
        m.right += pad;
    } else if (innerH > innerW) {
        const pad = (innerH - innerW) / 2;
        m.top += pad;
        m.bottom += pad;
    }
    return m;
}

/**
 * `lineCone` owns its own two stages (slope, then spread), so it takes no `stage`
 * option; every other WidgetOptions field applies.
 * @param {Omit<import('../types').WidgetOptions, 'stage'> & { x?: string, y?: string,
 *   r?: number, spread?: number, samples?: number, seed?: number,
 *   render?: 'region' | 'gradient' | 'samples' }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function lineCone(opts = {}) {
    const {
        question,
        x = 'x',
        y = 'y',
        r = 0,
        spread = 0,
        samples = 60,
        seed = 7,
        render = 'samples',
        onChange,
        width = 460,
        height = 400,
        theme
    } = opts;

    return {
        width,
        height,
        theme,
        margins: squareMargins(width, height),
        // Matched standardized units on both axes, so r is the slope.
        schema: {
            x: { type: 'quantitative', domain: [-1, 1] },
            y: { type: 'quantitative', domain: [-1, 1] },
            // The correlation and the half-width of its plausible envelope.
            r: { type: 'quantitative', domain: [-1, 1], default: 0 },
            spread: { type: 'quantitative', domain: [0, 1], default: 0 }
        },
        // The elicited dataset: the correlation and its envelope half-width.
        data: [{ r, spread }],
        // Bound the slope and spread to a correlation's range.
        constraints: [
            clamp({ field: 'r', min: -1, max: 1 }),
            clamp({ field: 'spread', min: 0, max: 1 })
        ],
        onChange,
        axes: false,
        guides: [prompt(question || '', { y: -32 }), quadrants({ x, y })],
        marks: [
            composite({
                id: 'lineCone',
                parts: [
                    // The cone. Its edit is on the line below, so one plane gesture
                    // doesn't fan to two marks.
                    trendBand({
                        render,
                        samples,
                        seed,
                        channels: {
                            intercept: { datum: 0 },
                            slope: { field: 'r' },
                            slopeSpread: { field: 'spread' }
                        }
                    }),
                    // The line, carrying both edits. A constant intercept pins it
                    // at the origin, since no edit can write a constant channel.
                    trend({
                        handles: false,
                        channels: {
                            intercept: { datum: 0 },
                            // Stage 0: the pointer's direction from the origin is r.
                            slope: {
                                field: 'r',
                                edit: editTrend.slope({ pick: 'probe', stage: 0 })
                            },
                            // Stage 1: the tilt from the committed line to the pointer
                            // is the spread, so the cone edge sits under the cursor.
                            slopeSpread: {
                                field: 'spread',
                                edit: editTrend.slopeSpread({ pick: 'probe', stage: 1 })
                            }
                        }
                    })
                ]
            })
        ]
    };
}
