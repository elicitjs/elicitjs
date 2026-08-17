// @ts-check
// axis.js — axes and gridlines as CHART ELEMENTS (the Observable Plot model).
//
// An axis is scale chrome, not a data mark: `views: 'scale'`, singular `channel`,
// CHROME paint options (not desugared channels), domain-targeting edits
// (`edit.axis.*`). Prefer `elicit.elements.axisX` (also aliased on `plot.*`).
//
// Two ways to use them:
//   1. EXPLICITLY:  elements: [ elements.axisX({ ticks: 5 }), elements.gridY() ]
//      (or still inside `marks` — same factories)
//   2. IMPLICITLY via the global `axes` convenience on Elicit(), which desugars
//      into these same elements (see core/axes.js).
//
// Positioning: `anchor` ('bottom'|'top'|'left'|'right') sets the base side; a
// width/height/scales-aware `transform(ctx) -> {x?,y?}` overrides the base
// translate component(s) — e.g. cross at the origin, or a centred 1D slider axis.

import * as d3 from 'd3';
import { positionOnScale, isDiscrete } from '../core/scales.js';
import { themeOf } from '../core/theme.js';
import { warnUnknownElementOptions, resolveHandles, elementEdits } from './mark.js';

/**
 * `axis`'s own option vocabulary, on top of the universal chart-element options
 * (id / edit / edits / constraints / field). Exported so core/axes.js can hand a
 * grid only the options a grid reads, instead of forwarding the whole axis config.
 * Keep in sync with the destructure in `axis` below.
 * @type {string[]}
 */
export const AXIS_OPTIONS = [
    'channel', 'anchor', 'transform', 'ticks', 'tickValues', 'tickFormat', 'tickSize',
    'title', 'stroke', 'fill', 'fontSize', 'grid', 'handleColor', 'handleSize',
];

/**
 * `grid`'s option vocabulary. Keep in sync with the destructure in `grid` below.
 * @type {string[]}
 */
export const GRID_OPTIONS = ['channel', 'ticks', 'tickValues', 'stroke', 'strokeWidth'];

/** Numeric view of a domain value (a Date sorts by its timestamp). */
const numOf = (/** @type {any} */ v) => (v instanceof Date ? v.getTime() : v);

/**
 * An interactive category label (editable DISCRETE axis): a foreground text node
 * that carries its `category` so edit.axis.categories() can rename it (dblclick ->
 * inline input -> commit) and route the gesture. `index: 0` is a sentinel so the
 * engine's direct-pick dispatch (which keys on node.index) accepts it — a domain
 * edit ignores the index.
 * @param {{ x: number, y: number, textAnchor: string, v: any, format: (v: any) => string, fill: string, fontSize: number }} o
 * @returns {import('../types').FeatureNode}
 */
function categoryLabel({ x, y, textAnchor, v, format, fill, fontSize }) {
    return {
        type: 'text', x, y, text: format(v), textAnchor, fill, fontSize,
        category: v, editText: true, index: 0, cursor: 'text'
    };
}

/**
 * The "×" remove affordance next to a category label (editable DISCRETE axis). A
 * click routes to edit.axis.categories()'s remove edit, which drops the category
 * and its rows.
 * @param {{ x: number, y: number, v: any, fontSize: number }} o
 * @returns {import('../types').FeatureNode}
 */
function removeGlyph({ x, y, v, fontSize }) {
    return {
        type: 'text', x, y, text: '×', textAnchor: 'middle', fill: '#dc2626',
        fontSize: fontSize + 1, cursor: 'pointer', removeCategory: v, index: 0
    };
}

/**
 * The base translate (axis-group origin, in inner-plot pixels) for an anchor.
 *   x/bottom -> (0, height)   x/top -> (0, 0)
 *   y/left   -> (0, 0)        y/right -> (width, 0)
 * @param {string} anchor
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number }}
 */
function baseTranslate(anchor, width, height) {
    switch (anchor) {
        case 'top': return { x: 0, y: 0 };
        case 'bottom': return { x: 0, y: height };
        case 'left': return { x: 0, y: 0 };
        case 'right': return { x: width, y: 0 };
        default: return { x: 0, y: 0 };
    }
}

/**
 * Tick values + a formatter for a scale.
 *   continuous -> scale.ticks(count) (+ scale.tickFormat), unless `tickValues` given
 *   band/point/ordinal -> the domain (every category), formatter = identity
 * @param {any} scale
 * @param {{ ticks?: number, tickValues?: any[], tickFormat?: any }} opts
 * @returns {{ values: any[], format: (v: any) => string }}
 */
export function tickData(scale, opts = {}) {
    const { ticks = 5, tickValues, tickFormat } = opts;
    // Every non-continuous kind labels one tick per domain entry.
    const categorical = scale.kind !== 'continuous';

    let values;
    if (tickValues) {
        values = tickValues;
    } else if (categorical) {
        values = scale.domain();
    } else if (typeof scale.ticks === 'function') {
        values = scale.ticks(ticks);
    } else {
        values = scale.domain();
    }

    /** @type {(v: any) => string} */
    let format;
    if (typeof tickFormat === 'function') {
        format = tickFormat;
    } else if (typeof tickFormat === 'string') {
        format = d3.format(tickFormat);
    } else if (!categorical && typeof scale.tickFormat === 'function') {
        format = scale.tickFormat(ticks);
    } else {
        format = (/** @type {any} */ v) => `${v}`;
    }

    return { values, format };
}

/**
 * The shared axis builder. `axisX`/`axisY` are thin wrappers that pin `channel`.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function axis(options = {}) {
    // No normalizeMarkOptions here, deliberately: an axis encodes no datum. It
    // draws a SCALE (picked by `channel`), so it has no channel map and its
    // stroke/fill/fontSize are chrome — plain options, like axisRadial's
    // AXIS_CHROME set. There is nothing to desugar. But there IS something to
    // VALIDATE, which is a separate job: warnUnknownElementOptions is the
    // diagnostics half on its own (see plot/mark.js).
    warnUnknownElementOptions('axis', options, AXIS_OPTIONS);
    const {
        channel = 'x',
        anchor = channel === 'x' ? 'bottom' : 'left',
        transform,
        ticks = 5,
        tickValues,
        tickFormat,
        tickSize = 6,
        title,
        // Chrome colours/size default to the theme's axis tokens, resolved at build
        // time (a factory can't see the chart's theme). An explicit option still wins.
        stroke: strokeOpt,      // spine + ticks
        fill: fillOpt,          // tick labels + title (text nodes take a fill)
        fontSize: fontSizeOpt,
        grid = false,
        // Opt-in interactivity: an edit (edit.axis.scale / edit.axis.categories) or
        // a list of them, and an optional single field the edit pins (defaults to
        // every field on the axis). Axes are inert unless `edit`/`edits` is given.
        field,
        // Which TABLE an edit on this axis writes. Resolved by NAME in the engine's
        // one binding pass, like a mark's.
        table,
        handleColor: handleColorOpt,
        handleSize: handleSizeOpt,
        id,
        // Forwarded, not dropped — the engine promotes a feature's constraints into
        // the one dataset-wide set.
        constraints
    } = options;

    const isX = channel === 'x';
    const edits = elementEdits(options, channel);
    const editable = edits.length > 0;

    return {
        id,
        markName: 'axis',
        constraints,
        isAxis: true,
        // A GUIDE: it views the SCALE, not columns of the dataset. See types.d.ts's
        // Mark.views — the engine and resolveChannels branch on this, not on which
        // of isAxis/isGrid/isLegend happens to be set.
        views: 'scale',
        channel,
        layer: 'background',
        // Interactive-axis wiring: the edits the engine collects (mark-level, so
        // collectEdits picks them up) and the field/table they pin. Empty/undefined
        // for a plain inert axis. `field` is read by resolveChannels (edit/route.js)
        // ahead of the emergent `scale.fields[0]`; `table` by the engine's binding pass.
        edits,
        field,
        table,
        // A paired grid, when `grid: true` — the engine reads this to auto-add a
        // matching grid mark alongside the axis (see elicit.js). Harmless otherwise.
        grid,
        /**
         * @param {any[]} _data
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (_data, scales, width, height) => {
            const scale = scales[channel];
            if (!scale) return []; // 1D plot / hidden channel — no-op

            // Resolve chrome from the theme (option overrides > theme.axis tokens).
            const thm = themeOf(scales);
            const stroke = strokeOpt ?? thm.axis.stroke;
            const fill = fillOpt ?? thm.axis.labelFill;
            const fontSize = fontSizeOpt ?? thm.axis.fontSize;
            // Shared handle contract (plot/mark.js) — axis used to hard-code size
            // and pull colour from theme.axis.handle without going through resolveHandles.
            const handleStyle = resolveHandles(scales, {
                handles: true,
                handleSize: handleSizeOpt,
                handleColor: handleColorOpt ?? thm.axis.handle,
            });
            const handleColor = handleStyle.fill;
            const handleSize = handleStyle.size;
            const handleStroke = handleStyle.stroke;

            const base = baseTranslate(anchor, width, height);
            const t = transform
                ? { ...base, ...(transform({ width, height, scales, anchor, base }) || {}) }
                : base;

            const { values, format } = tickData(scale, { ticks, tickValues, tickFormat });
            // Tick/label direction: axes on bottom/right push ticks in the positive
            // direction (down / right), top/left in the negative.
            const dir = (anchor === 'bottom' || anchor === 'right') ? 1 : -1;

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // An editable DISCRETE axis makes its category labels interactive (rename
            // by dblclick-typing, remove via an × affordance); an editable CONTINUOUS
            // axis grows draggable end-handles. Both leave the spine/ticks inert.
            const discrete = editable && isDiscrete(scale);
            const continuous = editable && scale.kind === 'continuous';

            // Domain spine — spans the scale's pixel range along the axis.
            if (isX) {
                nodes.push({
                    type: 'line', x1: t.x, x2: t.x + width, y1: t.y, y2: t.y,
                    stroke, strokeWidth: 1, background: true, pointerEvents: 'none'
                });
            } else {
                nodes.push({
                    type: 'line', x1: t.x, x2: t.x, y1: t.y, y2: t.y + height,
                    stroke, strokeWidth: 1, background: true, pointerEvents: 'none'
                });
            }

            // Ticks + labels.
            for (const v of values) {
                const p = positionOnScale(scale, v);
                if (p == null || Number.isNaN(p)) continue;
                if (isX) {
                    const px = t.x + p;
                    nodes.push({
                        type: 'line', x1: px, x2: px, y1: t.y, y2: t.y + dir * tickSize,
                        stroke, strokeWidth: 1, background: true, pointerEvents: 'none'
                    });
                    const ly = t.y + dir * (tickSize + fontSize);
                    nodes.push(discrete
                        ? categoryLabel({ x: px, y: ly, textAnchor: 'middle', v, format, fill, fontSize })
                        : { type: 'text', x: px, y: ly, text: format(v), textAnchor: 'middle', fill, fontSize, background: true, pointerEvents: 'none' });
                    if (discrete) nodes.push(removeGlyph({ x: px, y: ly + fontSize, v, fontSize }));
                } else {
                    const py = t.y + p;
                    nodes.push({
                        type: 'line', x1: t.x, x2: t.x + dir * tickSize, y1: py, y2: py,
                        stroke, strokeWidth: 1, background: true, pointerEvents: 'none'
                    });
                    const lx = t.x + dir * (tickSize + 3);
                    nodes.push(discrete
                        ? categoryLabel({ x: lx, y: py + fontSize / 3, textAnchor: dir < 0 ? 'end' : 'start', v, format, fill, fontSize })
                        : { type: 'text', x: lx, y: py + fontSize / 3, text: format(v), textAnchor: dir < 0 ? 'end' : 'start', fill, fontSize, background: true, pointerEvents: 'none' });
                    if (discrete) nodes.push(removeGlyph({ x: lx + dir * (fontSize + 4), y: py + fontSize / 3, v, fontSize }));
                }
            }

            // Editable affordances past the ticks: a "+" to add a category, or the two
            // numeric end-handles the axisDrag driver grabs.
            if (discrete) {
                const addX = isX ? t.x + width + fontSize : t.x;
                const addY = isX ? t.y + dir * (tickSize + fontSize) : t.y + height + dir * (tickSize + fontSize);
                nodes.push({
                    type: 'text', x: addX, y: addY, text: '＋', textAnchor: 'middle',
                    fill: handleColor, fontSize: fontSize + 4, cursor: 'pointer',
                    addCategory: true, editText: true, index: 0
                });
            } else if (continuous) {
                const dom = typeof scale.domain === 'function' ? scale.domain() : [];
                const loV = dom[0];
                const hiV = dom[dom.length - 1];
                const along = (/** @type {any} */ vv) => (isX ? t.x : t.y) + positionOnScale(scale, vv);
                for (const end of /** @type {const} */ (['min', 'max'])) {
                    const gV = end === 'max' ? hiV : loV;
                    const aV = end === 'max' ? loV : hiV;
                    const gPix = along(gV);
                    const aPix = along(aV);
                    const denom = numOf(gV) - numOf(aV) || 1;
                    nodes.push({
                        type: 'circle',
                        cx: isX ? t.x + positionOnScale(scale, gV) : t.x,
                        cy: isX ? t.y : t.y + positionOnScale(scale, gV),
                        // Placement: at the domain's two extremes — the values a
                        // rescale drag moves.
                        r: handleSize, fill: handleColor, stroke: handleStroke, strokeWidth: handleStyle.strokeWidth,
                        axisHandle: true, handle: end, axis: channel,
                        anchorPixel: aPix, anchorValue: aV, grabPixel: gPix, grabValue: gV,
                        pxPerUnit: (gPix - aPix) / denom,
                        cursor: isX ? 'ew-resize' : 'ns-resize'
                    });
                }
            }

            // Optional axis title, centred along the axis, pushed past the labels.
            if (title) {
                if (isX) {
                    nodes.push({
                        type: 'text', x: t.x + width / 2, y: t.y + dir * (tickSize + fontSize * 2.4),
                        text: title, textAnchor: 'middle', fill, fontSize: fontSize + 1,
                        background: true, pointerEvents: 'none'
                    });
                } else {
                    nodes.push({
                        type: 'text', x: t.x + dir * (tickSize + fontSize * 2.4), y: t.y + height / 2,
                        text: title, textAnchor: 'middle', fill, fontSize: fontSize + 1,
                        background: true, pointerEvents: 'none'
                    });
                }
            }

            return nodes;
        }
    };
}

/**
 * The shared grid builder — full-span lines across the plot, one per tick.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function grid(options = {}) {
    warnUnknownElementOptions('grid', options, GRID_OPTIONS);
    const {
        channel = 'x',
        ticks = 5,
        tickValues,
        // Grid line colour/width default to the theme's grid tokens (build-time).
        stroke: strokeOpt,
        strokeWidth: strokeWidthOpt,
        id,
        // A grid draws a scale, not rows — but it accepts `constraints` like any
        // other feature and the engine promotes them to the dataset's set, so
        // forward rather than silently drop (axis/grid/legend all used to drop it).
        constraints
    } = options;

    const isX = channel === 'x';

    return {
        id,
        markName: 'grid',
        constraints,
        isGrid: true,
        views: 'scale',
        channel,
        layer: 'background',
        /**
         * @param {any[]} _data
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (_data, scales, width, height) => {
            const scale = scales[channel];
            if (!scale) return [];
            const thm = themeOf(scales);
            const stroke = strokeOpt ?? thm.grid.stroke;
            const strokeWidth = strokeWidthOpt ?? thm.grid.strokeWidth;
            const { values } = tickData(scale, { ticks, tickValues });

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            for (const v of values) {
                const p = positionOnScale(scale, v);
                if (p == null || Number.isNaN(p)) continue;
                if (isX) {
                    nodes.push({
                        type: 'line', x1: p, x2: p, y1: 0, y2: height,
                        stroke, strokeWidth, background: true, pointerEvents: 'none'
                    });
                } else {
                    nodes.push({
                        type: 'line', x1: 0, x2: width, y1: p, y2: p,
                        stroke, strokeWidth, background: true, pointerEvents: 'none'
                    });
                }
            }
            return nodes;
        }
    };
}

/** @param {any} [options] @returns {import('../types').Mark} */
export const axisX = (options = {}) => axis({ ...options, channel: 'x' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const axisY = (options = {}) => axis({ ...options, channel: 'y' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const gridX = (options = {}) => grid({ ...options, channel: 'x' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const gridY = (options = {}) => grid({ ...options, channel: 'y' });
