// @ts-check
// theme.js — the survey-instrument look, and the affordances that produce it.
//
// A survey widget deviates from the chart look (no axis spines, no ticks) but not
// from the model: everything below is a GUIDE — a non-interactive annotation that
// re-derives from the live render context every frame, drawn through the one guide
// path (`guides.custom`). The option rings on a Likert scale, the cell grid behind
// a matrix and a slider's track are affordances, not data; they carry no datum and
// must never swallow a gesture, which is precisely what a guide is.
//
// That is the point of these widgets as a demonstration: the styling changes, the
// principles don't. A plain-chart Likert and this one differ only in which guides
// they draw — same mark, same edit, same constraint.
//
// ── Theming ─────────────────────────────────────────────────────────────────
// The affordance tokens (accent/ring/track/cell/label/question/…) come from the
// chart's THEME, read LIVE from the render context (`ctx.theme.widget`) each frame,
// so a `spec.theme` (or `setTheme()`) restyles every survey instrument at once —
// this is the showcase for the style layer. `THEME` below is the built-in default
// (identical to `DEFAULT_THEME.widget`), used when no theme rode in on the context.

import { custom } from '../guides/index.js';

/** Stamp a guide's identity: the keyword a spec names it by. @param {string} type @param {import('../types').Guide} g */
const typed = (type, g) => Object.assign(g, { type });
import { bandwidthOf } from '../core/scales.js';

export const THEME = {
    accent: '#2563eb',      // a committed answer
    ring: '#cbd5e1',        // an empty option
    track: '#e2e8f0',
    cellFill: '#f8fafc',
    cellStroke: '#e2e8f0',
    label: '#334155',
    question: '#0f172a',
    labelSize: 12,
    questionSize: 13,
    radius: 11
};

/** The widget tokens for this frame: the chart's theme, else the built-in default.
 * @param {any} ctx render context (carries `theme`) @returns {typeof THEME} */
const widgetTheme = (ctx) => (ctx && ctx.theme && ctx.theme.widget) || THEME;

/** The categories of a band/point scale, in domain order. @param {any} scale */
const categoriesOf = (scale) => (scale && Array.isArray(scale.domainConfig) ? scale.domainConfig : []);

/**
 * The row of option rings + their labels, with a connecting track behind them.
 * Rings sit on the plot's vertical centre — where a `point` with no y channel
 * parks itself — so the answer dot lands exactly inside its ring.
 * @param {{ labelOffset?: number, radius?: number }} [options]
 */
export function optionRings(options = {}) {
    const { labelOffset = 30, radius: radiusOpt } = options;
    // Its own keyword, not `custom`: this guide appears in a spec by name.
    return typed('optionRings', custom((/** @type {any} */ ctx) => {
        const { scales, height } = ctx;
        const tw = widgetTheme(ctx);
        const radius = radiusOpt != null ? radiusOpt : tw.radius;
        const cats = categoriesOf(scales.x);
        if (!cats.length) return [];
        const cy = height / 2;
        const cxOf = (/** @type {any} */ c) => scales.x.encode(c);

        /** @type {any[]} */
        const nodes = [];
        // The track, drawn as segments BETWEEN adjacent rings rather than one line
        // through them: guide circles are unfilled (so the answer dot shows through)
        // and a continuous rule would cut across every ring's interior.
        for (let i = 0; i < cats.length - 1; i++) {
            nodes.push({
                type: 'line',
                x1: cxOf(cats[i]) + radius, y1: cy,
                x2: cxOf(cats[i + 1]) - radius, y2: cy,
                stroke: tw.track, strokeWidth: 3, background: true
            });
        }
        for (const c of cats) {
            nodes.push({
                type: 'circle', cx: cxOf(c), cy, r: radius,
                fill: 'none', stroke: tw.ring, strokeWidth: 1.5
            });
            nodes.push({
                type: 'text', x: cxOf(c), y: cy + labelOffset, text: String(c),
                textAnchor: 'middle', fontSize: tw.labelSize, fill: tw.label
            });
        }
        return nodes;
    }));
}

/**
 * The cell grid of a question matrix: a soft rect per (question, option) cell,
 * column headers above, and row labels in the left margin. Guide rects draw
 * behind the marks, so an answered cell shows its dot on top of its cell.
 * @param {{ pad?: number }} [options]
 */
export function cellGrid(options = {}) {
    const { pad = 3 } = options;
    // Its own keyword, not `custom`: this guide appears in a spec by name.
    return typed('cellGrid', custom((/** @type {any} */ ctx) => {
        const { scales } = ctx;
        const tw = widgetTheme(ctx);
        const cols = categoriesOf(scales.x);
        const rows = categoriesOf(scales.y);
        if (!cols.length || !rows.length) return [];
        const bw = bandwidthOf(scales.x, 40);
        const bh = bandwidthOf(scales.y, 30);

        /** @type {any[]} */
        const nodes = [];
        for (const r of rows) {
            for (const c of cols) {
                nodes.push({
                    type: 'rect',
                    x: scales.x.encode(c) - bw / 2 + pad,
                    y: scales.y.encode(r) - bh / 2 + pad,
                    width: bw - 2 * pad,
                    height: bh - 2 * pad,
                    fill: tw.cellFill, stroke: tw.cellStroke, strokeWidth: 1
                });
            }
        }
        for (const c of cols) {
            nodes.push({
                type: 'text', x: scales.x.encode(c), y: -14, text: String(c),
                textAnchor: 'middle', fontSize: tw.labelSize, fill: tw.label
            });
        }
        for (const r of rows) {
            nodes.push({
                type: 'text', x: -10, y: scales.y.encode(r) + 4, text: String(r),
                textAnchor: 'end', fontSize: tw.labelSize, fill: tw.label
            });
        }
        return nodes;
    }));
}

/**
 * A slider's track: a rule along the plot's centre line with end caps and value
 * labels at the domain ends.
 * @param {{ format?: (v: any) => string }} [options]
 */
export function sliderTrack(options = {}) {
    const { format = (/** @type {any} */ v) => String(v) } = options;
    // Its own keyword, not `custom`: this guide appears in a spec by name.
    return typed('sliderTrack', custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const tw = widgetTheme(ctx);
        if (!scales.x) return [];
        const cy = height / 2;
        const dom = scales.x.domainConfig || [0, 1];
        const lo = dom[0], hi = dom[dom.length - 1];
        return [
            { type: 'line', x1: 0, y1: cy, x2: width, y2: cy, stroke: tw.track, strokeWidth: 4, background: true },
            { type: 'line', x1: 0, y1: cy - 7, x2: 0, y2: cy + 7, stroke: tw.ring, strokeWidth: 2 },
            { type: 'line', x1: width, y1: cy - 7, x2: width, y2: cy + 7, stroke: tw.ring, strokeWidth: 2 },
            { type: 'text', x: 0, y: cy + 26, text: format(lo), textAnchor: 'start', fontSize: tw.labelSize, fill: tw.label },
            { type: 'text', x: width, y: cy + 26, text: format(hi), textAnchor: 'end', fontSize: tw.labelSize, fill: tw.label }
        ];
    }));
}

/**
 * The question prompt, drawn into the top margin so it travels with the chart.
 * `y` lifts it clear of whatever the instrument draws below it (column headers,
 * an axis label) — the caller owns the top margin, so it owns the offset.
 * @param {string} text
 * @param {{ y?: number }} [options]
 */
export function prompt(text, options = {}) {
    const { y = -18 } = options;
    // Its own keyword, not `custom`: this guide appears in a spec by name.
    return typed('prompt', custom((/** @type {any} */ ctx) => {
        const tw = widgetTheme(ctx);
        return text ? [{
            type: 'text', x: 0, y, text,
            textAnchor: 'start', fontSize: tw.questionSize, fill: tw.question
        }] : [];
    }));
}

/**
 * The crosshair frame of a correlation plot: axes through the centre and a
 * high/low label on each of the four ends (the layout of the line+cone task).
 * The side labels stack onto two lines so a long variable name fits the margin
 * instead of running off the SVG.
 * @param {{ x?: string, y?: string }} [labels]
 */
export function crosshair(labels = {}) {
    const { x = 'x', y = 'y' } = labels;
    // Its own keyword, not `custom`: this guide appears in a spec by name.
    return typed('crosshair', custom((/** @type {any} */ ctx) => {
        const { width, height } = ctx;
        const tw = widgetTheme(ctx);
        const cx = width / 2, cy = height / 2;
        /**
         * @param {number} px @param {number} py @param {string} text @param {string} anchor
         * @returns {import('../types').FeatureNode}
         */
        const t = (px, py, text, anchor) =>
            ({ type: 'text', x: px, y: py, text, textAnchor: anchor, fontSize: tw.labelSize, fill: tw.label });
        // A side label stacks one word per line (plus its extreme), centred on the
        // axis — a long variable name then fits the margin instead of running off
        // the SVG, however wide it is.
        const lineH = 14;
        const side = (/** @type {number} */ px, /** @type {string} */ extreme, /** @type {string} */ anchor) => {
            const lines = [...String(x).split(/\s+/), `(${extreme})`];
            const top = cy - ((lines.length - 1) * lineH) / 2;
            return lines.map((word, i) => t(px, top + i * lineH + 4, word, anchor));
        };

        return [
            { type: 'line', x1: 0, y1: cy, x2: width, y2: cy, stroke: tw.ring, strokeWidth: 1, background: true },
            { type: 'line', x1: cx, y1: 0, x2: cx, y2: height, stroke: tw.ring, strokeWidth: 1, background: true },
            ...side(width + 10, 'high', 'start'),
            ...side(-10, 'low', 'end'),
            t(cx, -8, `${y} (high)`, 'middle'),
            t(cx, height + 20, `${y} (low)`, 'middle')
        ];
    }));
}
