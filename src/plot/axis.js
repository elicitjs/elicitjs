// @ts-check
import { ELEMENT_OPTIONS } from '../vocabulary.js';
// axis.js — axes and gridlines as chart elements (`views: 'scale'`). Used
// explicitly (`elements: [elements.axisX(), elements.gridY()]`) or through the
// implicit `axes` option (core/axes.js).
//
// `anchor` sets the side; `transform(ctx) -> {x?, y?}` overrides the base
// translate (e.g. cross at the origin).

import * as d3 from 'd3';
import { positionOnScale, isDiscrete, isBand, bandStartOf, bandwidthOf } from '../core/scales.js';
import { themeOf, axisToken } from '../core/theme.js';
import { measureText } from '../core/measure.js';
import { warnUnknownElementOptions, resolveHandles, elementEdits } from './mark.js';

/**
 * `axis`'s option list, on top of the universal chart-element options
 * (id / edit / edits / field). Keep in sync with the destructure in `axis`.
 * @type {string[]}
 */
export const AXIS_OPTIONS = ELEMENT_OPTIONS.axis;

/**
 * `grid`'s option list. Keep in sync with the destructure in `grid`.
 * @type {string[]}
 */
export const GRID_OPTIONS = ELEMENT_OPTIONS.grid;

/** Numeric view of a domain value (a Date sorts by its timestamp). */
const numOf = (/** @type {any} */ v) => (v instanceof Date ? v.getTime() : v);

/**
 * An editable category label on a discrete axis, carrying its `category` for
 * edit.scale.categories(). `index: 0` is a sentinel so direct-pick dispatch accepts it.
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
 * The "×" remove affordance next to an editable category label.
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
 * A per-tick option: a constant, or `(value, index) => constant`. Only tick-level
 * options take the function form; the spine reads the constant or the theme.
 * @param {any} opt
 * @param {any} v
 * @param {number} i
 * @returns {any}
 */
const perTick = (opt, v, i) => (typeof opt === 'function' ? opt(v, i) : opt);

/** A formatted tick label split into lines at `\n`.
 * @param {any} label @returns {string[]} */
const linesOf = (label) => String(label).split('\n');

/**
 * The axis's chrome for one scale: the option, else the theme's per-kind token,
 * else the axis-wide token. Shared by `measureTitle` and `build`.
 * @param {any} o the axis options
 * @param {any} scales
 * @param {any} scale
 */
function chromeOf(o, scales, scale) {
    const thm = themeOf(scales);
    const tok = (/** @type {string} */ name) => axisToken(thm, scale, name);
    const fontSize = o.fontSize ?? tok('fontSize');
    const fill = o.fill ?? tok('labelFill');
    return {
        stroke: o.stroke ?? tok('stroke'),
        strokeWidth: o.strokeWidth ?? tok('strokeWidth') ?? 1,
        line: o.line ?? tok('line') ?? true,
        tickSize: o.tickSize ?? tok('tickSize') ?? 6,
        tickPadding: o.tickPadding ?? tok('tickPadding') ?? 3,
        labelAngle: o.labelAngle ?? tok('labelAngle') ?? 0,
        fill,
        fontSize,
        fontFamily: o.fontFamily ?? tok('fontFamily') ?? null,
        fontWeight: o.fontWeight ?? tok('fontWeight') ?? null,
        titleFill: o.titleFill ?? tok('titleFill') ?? (typeof fill === 'function' ? tok('labelFill') : fill),
        titleFontSize: o.titleFontSize ?? tok('titleFontSize') ?? fontSize + 1,
        titleFontWeight: o.titleFontWeight ?? tok('titleFontWeight') ?? null,
        titlePadding: o.titlePadding ?? tok('titlePadding') ?? 0,
        titleAnchor: o.titleAnchor ?? tok('titleAnchor') ?? 'middle',
        labelAlign: o.labelAlign ?? tok('labelAlign') ?? null,
        labelOffset: o.labelOffset ?? tok('labelOffset') ?? 0,
        offset: o.offset ?? 0,
    };
}

/**
 * A tick label's text-anchor: `labelAlign`, else centred on x and running away
 * from the plot on y.
 * @param {boolean} isX @param {number} dir @param {any} c resolved chrome
 * @returns {'start' | 'middle' | 'end'}
 */
function labelAnchorOf(isX, dir, c) {
    if (c.labelAlign) return c.labelAlign;
    return isX ? 'middle' : (dir < 0 ? 'end' : 'start');
}

/**
 * How far the tick labels reach outward from the axis line, the widest label, and
 * the most lines. Read by title placement and the layout reservation.
 * @param {boolean} isX
 * @param {any} c resolved chrome
 * @param {string[]} labels formatted labels
 * @param {number} tickSize the largest tick length (a per-tick size may vary)
 * @returns {{ far: number, labelW: number, lines: number }}
 */
function labelReach(isX, c, labels, tickSize, dir = -1) {
    let labelW = 0;
    let lines = 1;
    for (const l of labels) {
        const ls = linesOf(l);
        lines = Math.max(lines, ls.length);
        for (const s of ls) labelW = Math.max(labelW, measureText(s, { fontSize: c.fontSize, fontFamily: c.fontFamily || undefined }));
    }
    const lineH = Math.round(c.fontSize * 1.2);
    const rad = (Math.abs(c.labelAngle) * Math.PI) / 180;
    const base = tickSize + c.tickPadding;
    if (c.labelAngle) {
        const along = isX ? Math.sin(rad) : Math.cos(rad);
        const across = isX ? Math.cos(rad) : Math.sin(rad);
        return { far: base + labelW * along + c.fontSize * across * 0.6, labelW, lines };
    }
    // Unrotated x: baseline 0.7em past the padding, plus a line-height per extra
    // line. Unrotated y: the part of the label's width that runs away from the plot.
    if (isX) return { far: Math.max(0, base + c.fontSize * 0.7 + (lines - 1) * lineH), labelW, lines };
    const textAnchor = labelAnchorOf(false, dir, c);
    const outward = textAnchor === 'middle' ? 0.5
        : (textAnchor === 'end') === (dir < 0) ? 1 : 0;
    return { far: Math.max(0, base + labelW * outward), labelW, lines };
}

/**
 * The shared axis builder. `axisX`/`axisY` are thin wrappers that pin `channel`.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function axis(options = {}) {
    // Not normalizeMarkOptions: an axis has no channel map, and its paint options
    // are plain chrome.
    warnUnknownElementOptions('axis', options, AXIS_OPTIONS);
    const {
        channel = 'x',
        anchor = channel === 'x' ? 'bottom' : 'left',
        transform,
        ticks = 5,
        tickValues,
        tickFormat,
        title,
        titleAngle,
        // Chrome. Each defaults to the theme's axis token of the same name at build time.
        //   stroke / strokeWidth / line   the spine (and the ticks' paint)
        //   tickSize / tickPadding        tick length; gap from tick to label
        //   fill / fontSize / fontFamily / fontWeight / labelAngle   the labels
        //   titleFill / titleFontSize / titleFontWeight / titlePadding   the title
        //   offset                        px between the plot edge and the axis
        // `tickSize`, `stroke`, `fill` and `fontWeight` also take a function
        // `(value, index) => …` for per-tick styling.
        tickSize,
        tickPadding,
        stroke,
        strokeWidth,
        line,
        fill,
        fontSize,
        fontFamily,
        fontWeight,
        labelAngle,
        titleFill,
        titleFontSize,
        titleFontWeight,
        titlePadding,
        // `titleAnchor`: where the title sits along the axis ('end' is right on x,
        // top on y). `labelAlign`: label text-anchor. `labelOffset`: px along the axis.
        titleAnchor,
        labelAlign,
        labelOffset,
        offset,
        grid = false,
        // The single field an edit pins (default: every field on the axis).
        field,
        // The table an edit on this axis writes, by name.
        table,
        handleColor: handleColorOpt,
        handleSize: handleSizeOpt,
        id,
    } = options;
    const chromeOpts = {
        tickSize, tickPadding, stroke, strokeWidth, line, fill, fontSize, fontFamily,
        fontWeight, labelAngle, titleFill, titleFontSize, titleFontWeight, titlePadding,
        titleAnchor, labelAlign, labelOffset, offset,
    };

    // Direction: x/y from the channel; any other channel (e.g. `count`) from the anchor.
    const isX = channel === 'x'
        || (channel !== 'y' && (anchor === 'bottom' || anchor === 'top'));
    const edits = elementEdits(options, channel);
    // Only direct edits get handles and category affordances.
    const editable = edits.some((e) => e.pick === 'direct');

    /**
     * Resolved chrome, tick data and label reach, read by measure and build.
     * @param {any} scales
     * @param {any} scale
     */
    const layout = (scales, scale) => {
        // Per-tick functions resolve per tick; the constant chrome uses the theme instead.
        const constant = { ...chromeOpts };
        for (const k of /** @type {const} */ (['tickSize', 'fontWeight', 'stroke', 'fill'])) {
            if (typeof constant[k] === 'function') constant[k] = undefined;
        }
        const c = chromeOf(constant, scales, scale);
        const { values, format } = tickData(scale, { ticks, tickValues, tickFormat });
        const sizes = values.map((v, i) => Number(perTick(tickSize, v, i) ?? c.tickSize) || 0);
        // The longest tick decides how far the labels sit, so they stay in one row.
        const maxTick = sizes.length ? Math.max(...sizes) : c.tickSize;
        const labels = values.map((v) => String(format(v)));
        const dir = (anchor === 'bottom' || anchor === 'right') ? 1 : -1;
        return { c, values, format, sizes, maxTick, labels, reach: labelReach(isX, c, labels, maxTick, dir) };
    };

    return {
        id,
        type: 'axis',
        isAxis: true,
        // Views the scale, not dataset columns. Read this, not isAxis/isGrid/isLegend.
        views: 'scale',
        channel,
        layer: 'background',
        // The axis's edits and the field/table they pin. resolveChannels reads
        // `field` ahead of `scale.fields[0]`.
        edits,
        field,
        table,
        // Passed through; the implicit `axes` layer (core/axes.js) adds the paired grid.
        grid,
        // The side this axis draws on; with `measureTitle`, lets the engine reserve margin.
        anchor,
        /**
         * How far past the plot edge this axis reaches when it has a title, rotated
         * or multi-line labels, an offset or `labelAlign`; 0 otherwise.
         * @param {import('../types').ScaleMap} scales
         * @returns {number} px from the plot edge to the axis's far edge
         */
        measureTitle(scales) {
            if (transform) return 0;
            const scale = scales[channel];
            if (!scale) return 0;
            const { c, reach } = layout(scales, scale);
            if (!title && !c.labelAngle && !c.offset && reach.lines <= 1 && !c.labelAlign) return 0;
            if (!title) return c.offset + reach.far + 2;
            if (isX) return c.offset + reach.far + c.titlePadding + c.fontSize * 0.5 + c.titleFontSize * 1.15 + 2;
            const angle = titleAngle != null ? titleAngle : (anchor === 'left' ? 90 : -90);
            // A flat y title at an end sits above or below the plot, not beside the labels.
            if (!angle && c.titleAnchor !== 'middle') return c.offset + reach.far + 2;
            const gap = angle ? c.fontSize * 0.9 : c.fontSize * 1.2;
            const titleExtent = angle ? c.titleFontSize * 0.7 : measureText(String(title), { fontSize: c.titleFontSize, fontWeight: c.titleFontWeight || undefined }) * 1.06;
            return c.offset + reach.far + 1 + gap + c.titlePadding + titleExtent + 2;
        },
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

            const thm = themeOf(scales);
            const { c, values, format, sizes, maxTick, reach } = layout(scales, scale);
            const handleStyle = resolveHandles(scales, {
                handles: true,
                handleSize: handleSizeOpt,
                handleColor: handleColorOpt ?? thm.axis.handle,
            });
            const handleColor = handleStyle.fill;
            const handleSize = handleStyle.size;
            const handleStroke = handleStyle.stroke;

            // Ticks point down/right on bottom/right axes, up/left otherwise.
            const dir = (anchor === 'bottom' || anchor === 'right') ? 1 : -1;
            const base = baseTranslate(anchor, width, height);
            // `offset` moves the whole axis away from the plot.
            if (c.offset) {
                if (isX) base.y += dir * c.offset;
                else base.x += dir * c.offset;
            }
            const t = transform
                ? { ...base, ...(transform({ width, height, scales, anchor, base }) || {}) }
                : base;
            const spineStroke = c.stroke;
            /** Label typography shared by every tick label. */
            const font = {
                ...(c.fontFamily ? { fontFamily: c.fontFamily } : {}),
            };
            const lineH = Math.round(c.fontSize * 1.2);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];

            // Editable discrete axis: renamable labels and × buttons. Editable continuous
            // axis: draggable end-handles.
            const discrete = editable && isDiscrete(scale);
            const continuous = editable && scale.kind === 'continuous';

            // Domain spine.
            if (c.line) {
                nodes.push(isX
                    ? { type: 'line', x1: t.x, x2: t.x + width, y1: t.y, y2: t.y, stroke: spineStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' }
                    : { type: 'line', x1: t.x, x2: t.x, y1: t.y, y2: t.y + height, stroke: spineStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' });
            }

            // Ticks + labels.
            values.forEach((v, i) => {
                const p = positionOnScale(scale, v);
                if (p == null || Number.isNaN(p)) return;
                const size = sizes[i];
                const tickStroke = perTick(stroke, v, i) ?? c.stroke;
                const labelFill = perTick(fill, v, i) ?? c.fill;
                const weight = perTick(fontWeight, v, i) ?? c.fontWeight;
                const text = String(format(v));
                const lines = linesOf(text);
                const paint = {
                    fill: labelFill, fontSize: c.fontSize, ...font,
                    ...(weight != null ? { fontWeight: weight } : {}),
                    ...(lines.length > 1 ? { lines, lineHeight: lineH } : {}),
                };
                // Labels sit past the longest tick so they stay in line.
                const reachOut = maxTick + c.tickPadding;
                if (size > 0) {
                    nodes.push(isX
                        ? { type: 'line', x1: t.x + p, x2: t.x + p, y1: t.y, y2: t.y + dir * size, stroke: tickStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' }
                        : { type: 'line', x1: t.x, x2: t.x + dir * size, y1: t.y + p, y2: t.y + p, stroke: tickStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' });
                }
                /** @type {any} */
                let label;
                if (c.labelAngle) {
                    // Rotated about the point past the tick, with the text running away
                    // from the axis.
                    const up = c.labelAngle > 0;
                    const ends = isX ? (dir > 0 ? up : !up) : dir < 0;
                    label = {
                        type: 'text',
                        x: isX ? t.x + p + c.labelOffset : t.x + dir * reachOut,
                        y: isX ? t.y + dir * reachOut : t.y + p + c.labelOffset,
                        text, textAnchor: c.labelAlign || (ends ? 'end' : 'start'), dominantBaseline: 'central',
                        angle: c.labelAngle, ...paint,
                    };
                } else if (isX) {
                    // A multi-line label grows away from the axis.
                    label = {
                        type: 'text', x: t.x + p + c.labelOffset, y: t.y + dir * (reachOut + c.fontSize * 0.7),
                        text, textAnchor: labelAnchorOf(true, dir, c), ...paint,
                        ...(lines.length > 1 ? { lineAnchor: dir > 0 ? 'top' : 'bottom' } : {}),
                    };
                } else {
                    label = {
                        type: 'text', x: t.x + dir * reachOut, y: t.y + p + c.labelOffset + c.fontSize / 3,
                        text, textAnchor: labelAnchorOf(false, dir, c), ...paint,
                    };
                }
                if (discrete) {
                    nodes.push({ ...label, ...categoryLabel({ x: label.x, y: label.y, textAnchor: label.textAnchor, v, format, fill: labelFill, fontSize: c.fontSize }) });
                    nodes.push(isX
                        ? removeGlyph({ x: label.x, y: label.y + c.fontSize, v, fontSize: c.fontSize })
                        : removeGlyph({ x: label.x + dir * (c.fontSize + 4), y: label.y, v, fontSize: c.fontSize }));
                } else {
                    nodes.push({ ...label, background: true, pointerEvents: 'none' });
                }
            });

            // A "+" to add a category, or the two end-handles the axisDrag driver grabs.
            if (discrete) {
                const addX = isX ? t.x + width + c.fontSize : t.x;
                const addY = isX ? t.y + dir * (c.tickSize + c.fontSize) : t.y + height + dir * (c.tickSize + c.fontSize);
                nodes.push({
                    type: 'text', x: addX, y: addY, text: '＋', textAnchor: 'middle',
                    fill: handleColor, fontSize: c.fontSize + 4, cursor: 'pointer',
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
                        cx: isX ? gPix : t.x,
                        cy: isX ? t.y : gPix,
                        // At the domain's two extremes.
                        r: handleSize, fill: handleColor, stroke: handleStroke, strokeWidth: handleStyle.strokeWidth,
                        axisHandle: true, handle: end, axis: channel,
                        anchorPixel: aPix, anchorValue: aV, grabPixel: gPix, grabValue: gV,
                        pxPerUnit: (gPix - aPix) / denom,
                        cursor: isX ? 'ew-resize' : 'ns-resize'
                    });
                }
            }

            // Axis title, past the labels. A y title is rotated to run along its axis
            // unless `titleAngle` says otherwise (0 for a horizontal title).
            if (title) {
                const titlePaint = {
                    fill: c.titleFill, fontSize: c.titleFontSize, ...font,
                    ...(c.titleFontWeight != null ? { fontWeight: c.titleFontWeight } : {}),
                    background: true, pointerEvents: 'none',
                };
                const at = c.titleAnchor;
                if (isX) {
                    nodes.push({
                        type: 'text', x: t.x + (at === 'start' ? 0 : at === 'end' ? width : width / 2),
                        y: t.y + dir * (reach.far + c.titlePadding + c.fontSize * 0.5 + c.titleFontSize * 0.85),
                        text: title, textAnchor: at, ...titlePaint,
                        ...(titleAngle ? { angle: titleAngle } : {}),
                    });
                } else {
                    const angle = titleAngle != null ? titleAngle : (dir < 0 ? 90 : -90);
                    if (!angle && at !== 'middle') {
                        // Flat, at an end: past the end of the axis, starting at the axis
                        // line ('end' is the top).
                        nodes.push({
                            type: 'text', x: t.x,
                            y: at === 'end'
                                ? t.y - c.titlePadding - c.titleFontSize * 0.5
                                : t.y + height + c.titlePadding + c.titleFontSize * 1.2,
                            text: title, textAnchor: dir < 0 ? 'start' : 'end', ...titlePaint,
                        });
                    } else {
                        const gap = angle ? c.fontSize * 0.9 : c.fontSize * 1.2;
                        // Rotated: 'end' is the top either way it reads. Flat and centred:
                        // anchored away from the labels.
                        const readsUp = angle > 0;
                        const textAnchor = !angle ? (dir < 0 ? 'end' : 'start')
                            : at === 'middle' ? 'middle'
                                : (at === 'end') === readsUp ? 'end' : 'start';
                        nodes.push({
                            type: 'text', x: t.x + dir * (reach.far + 1 + gap + c.titlePadding),
                            y: t.y + (at === 'start' ? height : at === 'end' ? 0 : height / 2),
                            text: title, textAnchor,
                            ...titlePaint,
                            ...(angle ? { angle } : {}),
                        });
                    }
                }
            }

            return nodes;
        }
    };
}

/**
 * The shared grid builder: one full-span line per tick. An `auto` grid (added by
 * the theme) draws lines only where `theme.grid.show` covers its scale; a
 * hand-written grid always draws.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function grid(options = {}) {
    warnUnknownElementOptions('grid', options, GRID_OPTIONS);
    const {
        channel = 'x',
        ticks = 5,
        tickValues,
        // Defaults to the theme's grid tokens; these also take `(value, index) => …`.
        stroke: strokeOpt,
        strokeWidth: strokeWidthOpt,
        strokeDash: strokeDashOpt,
        opacity: opacityOpt,
        // An emphasised line at 0 (continuous scales only): `true` for the theme's
        // zero style, an object for one of its own, `false` for none.
        zero: zeroOpt,
        // Where in a band a gridline sits: 0 start, 0.5 centre, 1 end. Band scales only.
        bandPosition: bandPositionOpt,
        id,
    } = options;

    // A grid has no anchor — it spans the plot — so its direction is the channel's.
    const isX = channel === 'x';

    /** @type {import('../types').Mark & { auto?: boolean }} */
    const mark = {
        id,
        type: 'grid',
        isGrid: true,
        views: 'scale',
        channel,
        layer: 'background',
        // Set by core/axes.js on a grid the theme asked for.
        auto: false,
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
            const g = /** @type {any} */ (thm.grid);
            const continuous = scale.kind === 'continuous';
            const show = g.show || 'none';
            // The value axis: the continuous one, or y when both are.
            const other = /** @type {any} */ (scales)[isX ? 'y' : 'x'];
            const isValueAxis = continuous && (!(other && other.kind === 'continuous') || !isX);
            const drawLines = !mark.auto || show === 'all'
                || (show === 'continuous' && continuous)
                || (show === 'value' && isValueAxis);
            const { values } = tickData(scale, { ticks, tickValues });
            const bandPosition = bandPositionOpt ?? g.bandPosition;
            /** A value's gridline position: its band edge when asked, else its tick. @param {any} v */
            const at = (v) => (bandPosition != null && isBand(scale)
                ? bandStartOf(scale, v) + bandwidthOf(scale, 0) * bandPosition
                : positionOnScale(scale, v));
            /** @param {number} p @param {any} paint */
            const lineAt = (p, paint) => (isX
                ? { type: 'line', x1: p, x2: p, y1: 0, y2: height, ...paint, background: true, pointerEvents: 'none' }
                : { type: 'line', x1: 0, x2: width, y1: p, y2: p, ...paint, background: true, pointerEvents: 'none' });

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            if (drawLines) {
                values.forEach((v, i) => {
                    const p = at(v);
                    if (p == null || Number.isNaN(p)) return;
                    const dash = perTick(strokeDashOpt, v, i) ?? g.strokeDash;
                    const opacity = opacityOpt ?? g.opacity;
                    nodes.push(lineAt(p, {
                        stroke: perTick(strokeOpt, v, i) ?? g.stroke,
                        strokeWidth: perTick(strokeWidthOpt, v, i) ?? g.strokeWidth,
                        ...(dash ? { strokeDasharray: dash } : {}),
                        ...(opacity != null ? { opacity } : {}),
                    }));
                });
            }
            // The zero line, last so it sits over the gridlines it crosses.
            const zero = zeroOpt === false ? null
                : zeroOpt && typeof zeroOpt === 'object' ? { ...(g.zero || {}), ...zeroOpt }
                    : zeroOpt === true ? (g.zero || { stroke: thm.axis.stroke, strokeWidth: 1 })
                        : g.zero;
            if (zero && continuous) {
                const dom = /** @type {any[]} */ (scale.domain ? scale.domain() : []).map(numOf);
                if (Math.min(...dom) <= 0 && Math.max(...dom) >= 0) {
                    const p = positionOnScale(scale, 0);
                    if (p != null && !Number.isNaN(p)) {
                        nodes.push(lineAt(p, {
                            stroke: zero.stroke || thm.axis.stroke,
                            strokeWidth: zero.strokeWidth ?? 1,
                            ...(zero.strokeDash ? { strokeDasharray: zero.strokeDash } : {}),
                        }));
                    }
                }
            }
            return nodes;
        }
    };
    return mark;
}

/** @param {any} [options] @returns {import('../types').Mark} */
export const axisX = (options = {}) => axis({ ...options, channel: 'x' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const axisY = (options = {}) => axis({ ...options, channel: 'y' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const gridX = (options = {}) => grid({ ...options, channel: 'x' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const gridY = (options = {}) => grid({ ...options, channel: 'y' });
