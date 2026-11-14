// @ts-check
// theme.js: the survey-instrument guides (option rings, cell grid, slider track,
// prompt, quadrants), each built on `guides.custom`.
//
// Their tokens are read each frame from `ctx.theme.widget`, so `spec.theme` or
// `setTheme()` restyles them. `THEME` is the default (same as `DEFAULT_THEME.widget`).

import { custom } from '../guides/index.js';
import { warnUnknownGuideOptions } from '../guides/shared.js';
import { GUIDE_OPTIONS } from '../vocabulary.js';

/** Stamp the guide's own keyword (not `custom`), since a spec names it. @param {string} type @param {import('../types').Guide} g */
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
const tokensOf = (ctx) => ctx?.theme?.widget || THEME;

/** The categories of a band/point scale, in domain order. @param {any} scale */
const categoriesOf = (scale) => (scale && Array.isArray(scale.domainConfig) ? scale.domainConfig : []);

/**
 * A row of option rings with labels and a track between them. Rings sit on the
 * plot's vertical centre, where a `point` with no y channel lands.
 * @param {{ labelOffset?: number, radius?: number }} [options]
 */
export function optionRings(options = {}) {
    warnUnknownGuideOptions('optionRings', options, GUIDE_OPTIONS.optionRings);
    const { labelOffset = 30, radius: radiusOpt } = options;
    return typed('optionRings', custom((/** @type {any} */ ctx) => {
        const { scales, height } = ctx;
        const tw = tokensOf(ctx);
        const radius = radiusOpt != null ? radiusOpt : tw.radius;
        const cats = categoriesOf(scales.x);
        if (!cats.length) return [];
        const cy = height / 2;
        const cxOf = (/** @type {any} */ c) => scales.x.encode(c);

        /** @type {any[]} */
        const nodes = [];
        // Track segments between rings, so no line crosses an unfilled ring.
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
 * A question matrix's cell grid: a rect per (question, option) cell, column
 * headers above and row labels in the left margin.
 * @param {{ pad?: number }} [options]
 */
export function cellGrid(options = {}) {
    warnUnknownGuideOptions('cellGrid', options, GUIDE_OPTIONS.cellGrid);
    const { pad = 3 } = options;
    return typed('cellGrid', custom((/** @type {any} */ ctx) => {
        const { scales } = ctx;
        const tw = tokensOf(ctx);
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
    warnUnknownGuideOptions('sliderTrack', options, GUIDE_OPTIONS.sliderTrack);
    const { format = (/** @type {any} */ v) => String(v) } = options;
    return typed('sliderTrack', custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const tw = tokensOf(ctx);
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
 * The question prompt, drawn in the top margin. `y` is its offset above the plot.
 * @param {string} text
 * @param {{ y?: number }} [options]
 */
export function prompt(text, options = {}) {
    warnUnknownGuideOptions('prompt', options, GUIDE_OPTIONS.prompt);
    const { y = -18 } = options;
    return typed('prompt', custom((/** @type {any} */ ctx) => {
        const tw = tokensOf(ctx);
        return text ? [{
            type: 'text', x: 0, y, text,
            textAnchor: 'start', fontSize: tw.questionSize, fill: tw.question
        }] : [];
    }));
}

/**
 * A correlation plot's quadrant frame: axes through the centre and a high/low
 * label at each of the four ends.
 * @param {{ x?: string, y?: string }} [labels]
 */
export function quadrants(labels = {}) {
    warnUnknownGuideOptions('quadrants', labels, GUIDE_OPTIONS.quadrants);
    const { x = 'x', y = 'y' } = labels;
    return typed('quadrants', custom((/** @type {any} */ ctx) => {
        const { width, height } = ctx;
        const tw = tokensOf(ctx);
        const cx = width / 2, cy = height / 2;
        /**
         * @param {number} px @param {number} py @param {string} text @param {string} anchor
         * @returns {import('../types').FeatureNode}
         */
        const t = (px, py, text, anchor) =>
            ({ type: 'text', x: px, y: py, text, textAnchor: anchor, fontSize: tw.labelSize, fill: tw.label });
        // A side label stacks one word per line, plus its extreme, so it fits the margin.
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
