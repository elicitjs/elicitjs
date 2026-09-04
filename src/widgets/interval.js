// @ts-check
// interval.js — uncertainty interval (mean + lo/hi caps) as a composite glyph.
// Plain-chart twin: composite of an inert whisker + point + ticks, with a coupled
// mean edit (drag the centre, the whole interval translates) and a dataset
// constraint that keeps the mean between the caps.

import { composite, point, ruleY, tick } from '../plot/index.js';
import { move, custom } from '../edit/index.js';
import { clamp } from '../constraints/index.js';
import { defineConstraint } from '../constraints/define.js';
import { prompt } from './theme.js';
import { widgetTheme } from './shared.js';

/**
 * Keep lo ≤ mean ≤ hi after any handle drag (a cap cannot cross the centre).
 * @returns {import('../types').Constraint}
 */
function orderInterval() {
    return defineConstraint(({ active }) => {
        if (!active) return undefined;
        return {
            lo: Math.min(active.lo, active.mean),
            hi: Math.max(active.hi, active.mean)
        };
    }, { type: 'orderInterval' });
}

/**
 * Drag the mean and translate lo/hi by the same delta so the interval moves as a
 * unit. Cap drags stay on plain move() — only the grabbed end moves. When the
 * interval hits a domain wall, the whole interval stops (width preserved) rather
 * than each end clamping independently and collapsing.
 * @param {number} [stage] active-stage gate, forwarded from the widget options
 * @returns {import('../types').Edit}
 */
function moveInterval(stage) {
    return custom((/** @type {import('../types').EditContext} */ ctx) => {
        const datum = ctx.datum;
        const ch = ctx.channels[0];
        if (!ch || !ch.scale || !datum) return undefined;
        const mean = ch.scale.invertValue(ctx.pointer.y);
        if (mean == null || Number.isNaN(Number(mean))) return undefined;

        const domain = ch.scale.domainConfig
            || (typeof ch.scale.domain === 'function' ? ch.scale.domain() : null);
        if (!domain || domain.length < 2) {
            const delta = mean - datum.mean;
            return { ...datum, mean, lo: datum.lo + delta, hi: datum.hi + delta };
        }

        const dLo = Math.min(...domain.map(Number));
        const dHi = Math.max(...domain.map(Number));
        const width = Number(datum.hi) - Number(datum.lo);
        let delta = Number(mean) - Number(datum.mean);
        let lo = Number(datum.lo) + delta;
        let hi = Number(datum.hi) + delta;

        // Rigid translate: shift back as a unit if either end would leave the domain.
        if (width >= dHi - dLo) {
            lo = dLo;
            hi = dHi;
        } else {
            if (lo < dLo) { hi += dLo - lo; lo = dLo; }
            if (hi > dHi) { lo -= hi - dHi; hi = dHi; }
        }
        // Keep the mean's offset within the interval (same delta as the ends).
        const meanOut = Number(datum.mean) + (lo - Number(datum.lo));
        return { ...datum, mean: meanOut, lo, hi };
    }, { guide: true, stage });
}

/**
 * @param {import('../types').WidgetOptions & { category?: string, mean?: number, lo?: number, hi?: number,
 *   domain?: [number, number] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function interval(opts = {}) {
    const {
        question = 'Set your interval',
        category = 'estimate',
        mean = 50,
        lo = 30,
        hi = 70,
        domain = [0, 100],
        onChange,
        width = 360,
        height = 280,
        stage,
        theme
    } = opts;
    const t = widgetTheme(theme);

    return {
        width,
        height,
        theme,
        margins: { top: 40, right: 24, bottom: 36, left: 48 },
        schema: {
            cat: { type: 'categorical', domain: [category] },
            mean: { type: 'quantitative', domain },
            lo: { type: 'quantitative', domain },
            hi: { type: 'quantitative', domain }
        },
        data: [{ cat: category, mean, lo, hi }],
        constraints: [
            clamp({ min: domain[0], max: domain[1], field: 'mean' }),
            clamp({ min: domain[0], max: domain[1], field: 'lo' }),
            clamp({ min: domain[0], max: domain[1], field: 'hi' }),
            orderInterval()
        ],
        onChange,
        guides: [prompt(question)],
        marks: [
            composite({
                id: 'ci',
                parts: [
                    // Inert whisker — no edit, so it stays pointer-transparent and
                    // cannot swallow a cap or mean drag.
                    ruleY({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y1: { field: 'lo' },
                            y2: { field: 'hi' }
                        }
                    }),
                    point({
                        size: t.widget.radius - 2,
                        fill: t.widget.accent,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'mean', edit: moveInterval(stage) }
                        }
                    }),
                    tick({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'lo', edit: move({ stage }) }
                        }
                    }),
                    tick({
                        stroke: t.widget.accent,
                        strokeWidth: 2,
                        channels: {
                            x: { field: 'cat' },
                            y: { field: 'hi', edit: move({ stage }) }
                        }
                    })
                ]
            })
        ]
    };
}

/** @param {any} [opts] @returns {import('../types').ElicitSpec} */
export function ci(opts = {}) {
    return interval(opts);
}
