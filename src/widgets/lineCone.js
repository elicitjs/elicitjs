// @ts-check
// lineCone.js — the two-step correlation elicitation as a named instrument:
//
//   "What is the most likely relationship?"  -> the line follows the pointer,
//                                               a click sets it.
//   "What are the plausible alternatives?"   -> the cone opens with the pointer,
//                                               a click sets that too.
//
// ── It is a PRESET, not a mark ──────────────────────────────────────────────
// A correlation belief is a trend line with its intercept pinned at the origin and
// its slope confined to [-1, 1]; the cone is that line's uncertainty band. So this
// widget is `trendBand` + `trend` over one dataset, with the correlation stated as
// two `clamp` constraints and a pinned `intercept` channel — nothing here is baked
// into a mark. (There used to be a `cone` mark that hard-coded all of it in
// degrees; the general marks subsume it.)
//
// Stage 0 owns the slope, stage 1 owns the spread. The `probe` driver previews each
// as a ghost and commits on click, then advances — so once a field is set, its edit
// is gated off and the value is frozen, exactly as the original study instrument
// behaved.
//
// ── Why the plot is square ──────────────────────────────────────────────────
// r is read as an ANGLE: the line should sweep ±45° as r goes -1 -> +1. In slope
// space that holds only when one x unit and one y unit are the same number of
// pixels, so the widget sizes its margins to make the INNER plot square over the
// matched [-1, 1] x [-1, 1] domains. Change `width`/`height` and it stays square;
// the outer box just gets a wider frame.
//
// Read the answer at any point with container.getData() ->
// [{ r, spread }] where `r` is the correlation in [-1, 1] and `spread` is the
// half-width of the plausible envelope in the same units. `container.on('stage')`
// tells you which question the reader is on (2 = both answered).
//
// Returns an ElicitSpec: Elicit(lineCone({ x: 'Exercise', y: 'Body weight' })).

import { composite, trend, trendBand } from '../plot/index.js';
import { trend as editTrend } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { quadrants, prompt } from './theme.js';

// The frame the prompt and the two-line axis labels need, as a minimum. The inner
// plot is squared off inside whatever is left.
const MIN_MARGINS = { top: 56, right: 92, bottom: 52, left: 92 };

/**
 * Margins that leave a SQUARE inner plot — one x unit and one y unit the same
 * number of pixels, which is what makes the line's screen angle read as r.
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
        // The plot's coordinate space: standardized units, matched on both axes, so
        // a slope of 1 is a 45° line and r IS the slope.
        schema: {
            x: { type: 'quantitative', domain: [-1, 1] },
            y: { type: 'quantitative', domain: [-1, 1] },
            // The contract of the elicited dataset: a correlation in [-1, 1] and the
            // half-width of its plausible envelope, in the same units.
            r: { type: 'quantitative', domain: [-1, 1], default: 0 },
            spread: { type: 'quantitative', domain: [0, 1], default: 0 }
        },
        // The elicited dataset: the correlation and its envelope half-width.
        data: [{ r, spread }],
        // What makes this a CORRELATION rather than a free trend: the slope is a
        // correlation coefficient, and the envelope can't exceed the same range.
        // Declared, not baked into a mark.
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
                    // The cone: the fan of relationships still on the table. Purely a
                    // view — the gesture that opens it is declared on the line below,
                    // so one plane gesture can't fan to two marks.
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
                    // The line, and both questions. The intercept is PINNED at the
                    // origin: a constant channel names no column, so no edit can
                    // write one — the line pivots about (0, 0) by construction.
                    trend({
                        handles: false,
                        channels: {
                            intercept: { datum: 0 },
                            // Stage 0: the pointer's direction from the origin IS the
                            // correlation. The line follows the cursor; a click sets it.
                            slope: {
                                field: 'r',
                                edit: editTrend.slope({ pick: 'probe', stage: 0 })
                            },
                            // Stage 1: how far the line through the pointer tilts away
                            // from the committed one is the envelope half-width — so the
                            // cone edge sits under the cursor.
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
