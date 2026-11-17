// @ts-check
// theme.js: the survey-instrument guides (options, cell grid, slider track,
// prompt, quadrants), each built on `guides.custom`.
//
// They draw through the design `theme.widget.design` names (widgets/designs.js)
// and read its tokens each frame, so `spec.theme` or `setTheme()` restyles them.

import { custom } from '../guides/index.js';
import { warnUnknownGuideOptions } from '../guides/shared.js';
import { GUIDE_OPTIONS } from '../vocabulary.js';
import { resolveFormat } from '../format.js';
import { bandwidthOf } from '../core/scales.js';
import { DEFAULT_THEME } from '../core/theme.js';
import { lookOf } from './designs.js';

/** Stamp the guide's own keyword (not `custom`), since a spec names it. @param {string} type @param {import('../types').Guide} g */
const typed = (type, g) => Object.assign(g, { type });

/** The default widget tokens: `DEFAULT_THEME.widget`. */
export const THEME = /** @type {any} */ (DEFAULT_THEME).widget;

/** The categories of a band/point scale, in domain order. @param {any} scale */
const categoriesOf = (scale) => (scale && Array.isArray(scale.domainConfig) ? scale.domainConfig : []);

/**
 * The column the chart's marks draw along an axis, so a guide can tell which
 * options the rows hold.
 * @param {any} ctx @param {'x' | 'y'} axis @returns {string | null}
 */
const fieldOn = (ctx, axis) => {
    for (const f of ctx.features || []) {
        if (!f || (f.views && f.views !== 'data')) continue;
        const spec = f.channels && f.channels[axis];
        if (spec && spec.field != null) return spec.field;
    }
    return null;
};

/** A slot's start and size along a discrete scale. @param {any} scale @param {any} value @param {number} fallback */
const slotOf = (scale, value, fallback) => {
    const size = bandwidthOf(scale, fallback) || fallback;
    return { start: scale.encode(value) - size / 2, size };
};

/** The edges between a scale's slots, ends included. @param {any} scale @param {any[]} cats @param {number} fallback */
const edgesOf = (scale, cats, fallback) => {
    const centres = cats.map((c) => scale.encode(c));
    if (!centres.length) return [];
    const step = centres.length > 1 ? centres[1] - centres[0] : (bandwidthOf(scale, fallback) || fallback);
    return [centres[0] - step / 2, ...centres.map((c) => c + step / 2)];
};

/**
 * The options of a choice: one per category of the chart's discrete axis, drawn
 * in the theme's design (rings on a track by default). They run in a row when
 * the categories are on x, and stack as a list when they are on y.
 * @param {{ labelOffset?: number, radius?: number, control?: 'radio' | 'check' }} [options]
 */
export function options(options = {}) {
    warnUnknownGuideOptions('options', options, GUIDE_OPTIONS.options);
    const { labelOffset = 30, radius: radiusOpt, control = 'radio' } = options;
    return typed('options', custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const look = lookOf(ctx);
        const t = radiusOpt != null ? { ...look.t, radius: radiusOpt } : look.t;
        const axis = categoriesOf(scales.x).length ? 'x' : (categoriesOf(scales.y).length ? 'y' : null);
        if (!axis) return [];
        const scale = scales[axis];
        const cats = categoriesOf(scale);
        const field = fieldOn(ctx, axis);
        const chosen = new Set(field != null ? (ctx.data || []).map((/** @type {any} */ r) => r && r[field]) : []);
        const layout = axis === 'x' ? 'row' : 'list';

        const boxes = cats.map((/** @type {any} */ c) => {
            const { start, size } = slotOf(scale, c, axis === 'x' ? 40 : 30);
            return axis === 'x'
                ? { x: start, y: 0, width: size, height, cx: start + size / 2, cy: height / 2 }
                : { x: 0, y: start, width, height: size, cx: width / 2, cy: start + size / 2 };
        });
        return cats.flatMap((/** @type {any} */ c, /** @type {number} */ i) => look.design.option({
            ...boxes[i],
            label: String(c),
            selected: chosen.has(c),
            control,
            layout,
            index: i,
            count: cats.length,
            next: layout === 'row' && boxes[i + 1] ? { cx: boxes[i + 1].cx, cy: boxes[i + 1].cy } : null,
            labelOffset,
        }, t));
    }));
}

/**
 * A question matrix's cell grid: a cell per (question, option), column headers
 * above and row labels in the left margin. Cells are drawn in the theme's design.
 * @param {{ pad?: number }} [options]
 */
export function cellGrid(options = {}) {
    warnUnknownGuideOptions('cellGrid', options, GUIDE_OPTIONS.cellGrid);
    const { pad = 3 } = options;
    return typed('cellGrid', custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const { t, design } = lookOf(ctx);
        const cols = categoriesOf(scales.x);
        const rows = categoriesOf(scales.y);
        if (!cols.length || !rows.length) return [];
        const bw = bandwidthOf(scales.x, 40);
        const bh = bandwidthOf(scales.y, 30);
        const xField = fieldOn(ctx, 'x');
        const yField = fieldOn(ctx, 'y');
        const answered = (/** @type {any} */ r, /** @type {any} */ c) => xField != null && yField != null
            && (ctx.data || []).some((/** @type {any} */ d) => d && d[xField] === c && d[yField] === r);

        /** @type {any[]} */
        const nodes = [...design.grid({
            x: 0, y: 0, width, height, cx: width / 2, cy: height / 2,
            rows: edgesOf(scales.y, rows, 30), columns: edgesOf(scales.x, cols, 40),
        }, t)];
        rows.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
            for (const c of cols) {
                const cx = scales.x.encode(c), cy = scales.y.encode(r);
                nodes.push(...design.option({
                    x: cx - bw / 2 + pad, y: cy - bh / 2 + pad, width: bw - 2 * pad, height: bh - 2 * pad, cx, cy,
                    label: String(c), selected: answered(r, c), control: 'radio', layout: 'cell',
                    index: i, count: rows.length, next: null, labelOffset: 0,
                }, t));
            }
        });
        for (const c of cols) {
            nodes.push({
                type: 'text', x: scales.x.encode(c), y: -14, text: String(c),
                textAnchor: 'middle', fontSize: t.labelSize, fill: t.label
            });
        }
        for (const r of rows) {
            nodes.push({
                type: 'text', x: -10, y: scales.y.encode(r) + 4, text: String(r),
                textAnchor: 'end', fontSize: t.labelSize, fill: t.label
            });
        }
        return nodes;
    }));
}

/**
 * A slider's track along the plot's centre line, with value labels at the domain
 * ends. The track is drawn in the theme's design.
 * @param {{ format?: string | ((v: any) => string) }} [options]
 */
export function sliderTrack(options = {}) {
    warnUnknownGuideOptions('sliderTrack', options, GUIDE_OPTIONS.sliderTrack);
    const format = resolveFormat(options.format);
    return typed('sliderTrack', custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const { t, design } = lookOf(ctx);
        if (!scales.x) return [];
        const cy = height / 2;
        const dom = scales.x.domainConfig || [0, 1];
        const lo = dom[0], hi = dom[dom.length - 1];
        const field = fieldOn(ctx, 'x');
        const row = (ctx.data || [])[0];
        const value = row && field != null ? row[field] : null;
        const at = value != null ? scales.x.encode(value) : null;
        return [
            ...design.track({ x1: 0, x2: width, y: cy, at: Number.isFinite(at) ? at : null }, t),
            { type: 'text', x: 0, y: cy + 26, text: format(lo), textAnchor: 'start', fontSize: t.labelSize, fill: t.label },
            { type: 'text', x: width, y: cy + 26, text: format(hi), textAnchor: 'end', fontSize: t.labelSize, fill: t.label }
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
        const { t } = lookOf(ctx);
        const heavy = t.questionWeight != null && +t.questionWeight !== 400 && t.questionWeight !== 'normal';
        return text ? [{
            type: 'text', x: 0, y, text,
            textAnchor: 'start', fontSize: t.questionSize, fill: t.question,
            ...(heavy ? { fontWeight: t.questionWeight } : {})
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
        const { t: tw } = lookOf(ctx);
        const cx = width / 2, cy = height / 2;
        /**
         * @param {number} px @param {number} py @param {string} text @param {string} anchor
         * @returns {import('../types').FeatureNode}
         */
        const t = (px, py, text, anchor) =>
            ({ type: 'text', x: px, y: py, text, textAnchor: anchor, fontSize: tw.labelSize, fill: tw.label });
        // A side label stacks one word per line, plus its extreme, so it fits the margin.
        const lineH = Math.round(tw.labelSize * 1.17);
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

/**
 * The lines between a ranking list's slots, where the design draws any.
 * Internal: a widget's own chrome, not a spec keyword.
 */
export function rankSlots() {
    return custom((/** @type {any} */ ctx) => {
        const { scales, width, height } = ctx;
        const { t, design } = lookOf(ctx);
        const rows = categoriesOf(scales.y);
        if (!rows.length) return [];
        return design.slots({ x: 0, y: 0, width, height, cx: width / 2, cy: height / 2, rows: edgesOf(scales.y, rows, t.rowHeight) }, t);
    });
}

/**
 * A soft column behind each bar, where the design draws bars on a track.
 * Internal: a widget's own chrome, not a spec keyword.
 */
export function barTracks() {
    return custom((/** @type {any} */ ctx) => {
        const { scales, height } = ctx;
        const { t, design } = lookOf(ctx);
        const bar = design.bar(t);
        const cats = categoriesOf(scales.x);
        if (!bar.track || !cats.length) return [];
        return cats.map((/** @type {any} */ c) => {
            const { start, size } = slotOf(scales.x, c, 40);
            return /** @type {any} */ ({ type: 'rect', x: start, y: 0, width: size, height, rx: bar.corner || 0, fill: t.soft });
        });
    });
}
