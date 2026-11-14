// @ts-check
import { ELEMENT_OPTIONS } from '../vocabulary.js';
// legend.js — a legend for a non-positional channel (fill / stroke / size /
// symbol / …), a chart element like the axes. It reads the global scale for one
// encoding, (channel, field), and draws swatches, a ramp, or a size/angle/width key.
//
// It reserves a band on its `anchor` side: core/legends.js calls `measure`, shrinks
// the plot, and fills `_place`. With `edit.legend.category()` or
// `edit.legend.value()` it is also a picker that writes `field` into the target
// row: `row`, else the chart's selection, else the sole row of a one-row table.

import * as d3 from 'd3';
import { themeOf } from '../core/theme.js';
import { tickData } from './axis.js';
import { warnUnknownElementOptions, resolveHandles, elementEdits } from './mark.js';
import { warn } from '../core/dev.js';
import { scaleFor } from '../core/scales.js';
import { measureText } from '../core/measure.js';
import { unitShape, placeShape, DEFAULT_SHAPES } from './shapes.js';

/**
 * `legend`'s option list, on top of the universal chart-element options
 * (id / edit / edits / field). Keep in sync with the destructure in `legend`.
 * @type {string[]}
 */
export const LEGEND_OPTIONS = ELEMENT_OPTIONS.legend;

/** Numeric view of a domain value (a Date sorts by its timestamp). */
const numOf = (/** @type {any} */ v) => (v instanceof Date ? v.getTime() : v);

/** Whether a channel encodes to a colour. */
const isColorChannel = (/** @type {string} */ ch) => ch === 'fill' || ch === 'stroke';

/**
 * Whether a scale is drawn as a continuous key rather than swatches: a continuous
 * scale, or a colour ramp (`ramp: true`, stamped by core/scales.js).
 * @param {any} scale
 * @returns {boolean}
 */
function isRampScale(scale) {
    return scale.kind === 'continuous' || !!scale.ramp;
}

/**
 * Which shape a legend takes, from what the channel encodes to:
 *
 *   swatches   a discrete domain, whatever the channel — one chip per category
 *   ramp       continuous colour: a gradient with ticks
 *   graduated  continuous size: nested circles at tick values
 *   fan        continuous angle: spokes at their encoded bearings
 *   weights    continuous strokeWidth: segments at their encoded thicknesses
 *
 * Every form reads `scale.encode`, so it matches the scale the marks use.
 * @param {string} channel
 * @param {any} scale
 * @returns {'swatches' | 'ramp' | 'graduated' | 'fan' | 'weights'}
 */
function legendForm(channel, scale) {
    if (!isRampScale(scale)) return 'swatches';
    if (channel === 'size') return 'graduated';
    if (channel === 'theta') return 'fan';
    if (channel === 'strokeWidth') return 'weights';
    return 'ramp';
}

/**
 * A value through a scale: `encode` when the scale has it, else the scale called directly.
 * @param {any} scale @param {any} v
 * @returns {any}
 */
export const encodeOn = (scale, v) => (typeof scale.encode === 'function' ? scale.encode(v) : scale(v));

/**
 * The column a legend reads and writes: its pinned `field`, else the scale's first.
 * @param {string | undefined} field @param {any} scale
 * @returns {string | null}
 */
const writtenField = (field, scale) => field ?? ((scale && scale.fields && scale.fields[0]) || null);

/**
 * The box one discrete swatch occupies: `swatchSize`, or for `size` large enough
 * to fit the biggest encoded radius (never clamped).
 * @param {string} channel
 * @param {any} scale
 * @param {any[]} domain
 * @param {number} swatchSize
 * @returns {number}
 */
function swatchBox(channel, scale, domain, swatchSize) {
    if (channel !== 'size') return swatchSize;
    let max = 0;
    for (const v of domain) {
        const r = Number(encodeOn(scale, v));
        if (Number.isFinite(r)) max = Math.max(max, r);
    }
    return Math.max(swatchSize, 2 * max);
}

/**
 * The caption above a legend: `title`, else the field's name (`scale.fields[0]`
 * when no field is pinned). `title: false` turns it off.
 * @param {any} title @param {string | undefined} field @param {any} scale
 * @returns {string | null}
 */
function legendTitle(title, field, scale) {
    if (title === false || title === null) return null;
    if (title != null) return String(title);
    const f = writtenField(field, scale);
    return f == null ? null : String(f);
}

/**
 * A label column's pixel width: the longest label, measured (core/measure.js), plus
 * a small allowance. `labelWidth` overrides it.
 * @param {any[]} values
 * @param {(v: any) => string} format
 * @param {number} fontSize
 * @returns {number}
 */
function estimateLabelWidth(values, format, fontSize) {
    let max = 0;
    for (const v of values) max = Math.max(max, measureText(String(format(v)), { fontSize }));
    // The page's font is often a little wider than the measuring fallback.
    return Math.ceil(max * 1.06 + 2);
}

/**
 * The shared legend builder. `legendColor`/`legendSize`/`legendSymbol` pin
 * `channel`. Its paint options default to the theme's legend tokens.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function legend(options = {}) {
    warnUnknownElementOptions('legend', options, LEGEND_OPTIONS);
    const {
        channel = 'fill',
        anchor = 'right',
        // Default: vertical on the sides, horizontal top/bottom.
        orient: orientOpt,
        // Swatch geometry; unset, the theme's `guide.legend` tokens (14 / 6).
        swatchSize: swatchSizeOpt,
        gap: gapOpt,
        labelWidth: labelWidthOpt,
        rampLength = 140,
        rampThickness = 12,
        ticks = 4,
        tickFormat,
        title,
        // The row the picker writes: a number, an array, or
        // `(data, { selection }) => index`. Unset: the selection, else a sole row.
        row,
        // Chrome; defaults to the theme's legend tokens.
        stroke: strokeOpt,
        fill: fillOpt,
        fontSize: fontSizeOpt,
        handleColor: handleColorOpt,
        handleSize: handleSizeOpt,
        // The column and table an edit writes. Unset: `scale.fields[0]` and the
        // primary table.
        field,
        table,
        id,
    } = options;

    const orient = orientOpt || (anchor === 'left' || anchor === 'right' ? 'vertical' : 'horizontal');
    const vertical = orient === 'vertical';
    const edits = elementEdits(options, channel);
    const editable = edits.length > 0;
    // A domain edit (edit.scale.categories) adds a typable swatch, "×" and "+". Kept
    // apart from `editable`: a picker needs a target row, a domain edit doesn't.
    const domainEditable = edits.some((e) => /** @type {any} */ (e).target === 'domain');

    // The scale for this (channel, field) encoding; the bare channel as fallback.
    /** @param {import('../types').ScaleMap} scales */
    const scaleOf = (scales) => /** @type {any} */ (scaleFor(scales, channel, field));

    // Filled by core/legends.js each render: `offset` from the plot edge to the
    // legend's near edge, `size` its extent across the side.
    const place = { offset: 0, size: 0 };

    /** Swatch geometry and title weight: option > theme legend token > default.
     *  @param {any} thm */
    const geometryOf = (thm) => {
        const lt = thm.guide.legend || {};
        return {
            swatchSize: swatchSizeOpt ?? lt.swatchSize ?? 14,
            gap: gapOpt ?? lt.gap ?? 6,
            swatchRadius: lt.swatchRadius ?? 0,
            titleWeight: lt.titleFontWeight ?? null,
        };
    };

    /**
     * The values a legend lists (domain or ticks), their formatter and label width.
     * Shared by measure() and build().
     * @param {any} scale
     * @param {any} thm
     * @returns {{ ramp: boolean, form: 'swatches'|'ramp'|'graduated'|'fan'|'weights', values: any[], format: (v: any) => string, labelW: number, fontSize: number }}
     */
    const readScale = (scale, thm) => {
        const fontSize = fontSizeOpt ?? (thm.guide.legend.fontSize || 11);
        const form = legendForm(channel, scale);
        const ramp = form !== 'swatches';
        let values, format;
        if (ramp) {
            // Ticks from a linear proxy over [lo, hi]; a colour ramp has no ticks of its own.
            const dom = scale.domain();
            const lin = d3.scaleLinear().domain([Math.min(...dom.map(numOf)), Math.max(...dom.map(numOf))]);
            values = lin.ticks(ticks);
            format = typeof tickFormat === 'string' ? d3.format(tickFormat)
                : typeof tickFormat === 'function' ? tickFormat
                    : lin.tickFormat(ticks);
        } else {
            values = scale.domain();
            format = tickFormat ? tickData(scale, { tickFormat }).format : (/** @type {any} */ v) => `${v}`;
        }
        const labelW = labelWidthOpt != null ? labelWidthOpt : estimateLabelWidth(values, format, fontSize);
        return { ramp, form, values, format, labelW, fontSize };
    };

    return {
        id,
        type: 'legend',
        isLegend: true,
        views: 'scale',
        channel,
        anchor,
        orient,
        layer: 'background',
        // `field` is read by resolveChannels ahead of `scale.fields[0]`.
        edits,
        field,
        table,
        _place: place,

        /**
         * Bounding box of the legend content, for the reservation pass.
         * @param {import('../types').ScaleMap} scales
         * @param {{ width: number, height: number }} [dims] the plot's inner size, so a
         *   horizontal legend can wrap
         * @returns {{ width: number, height: number } | null}
         */
        measure(scales, dims) {
            const scale = scaleOf(scales);
            if (!scale || typeof scale.domain !== 'function') return null;
            const thm = themeOf(scales);
            const { swatchSize, gap, titleWeight } = geometryOf(thm);
            const { form, values, labelW, fontSize } = readScale(scale, thm);
            const titleText = legendTitle(title, field, scale);
            const titlePad = titleText ? fontSize + 4 : 0;
            const titleW = titleText ? measureText(titleText, { fontSize: fontSize + 1, fontWeight: titleWeight ?? 600 }) + 2 : 0;
            /** @param {{ width: number, height: number }} box */
            const withTitle = (box) => ({ width: Math.max(box.width, titleW), height: box.height });

            if (form === 'graduated') {
                // Nested circles, sized from the scale.
                const radii = graduatedRadii(scale, values);
                if (!radii.length) return withTitle({ width: labelW, height: fontSize + titlePad });
                const rMax = radii[radii.length - 1].r;
                const stack = radii.reduce((h, g) => h + 2 * g.r + gap, 0);
                if (vertical) return withTitle({ width: 2 * rMax + 6 + labelW, height: stack + titlePad });
                return withTitle({ width: radii.reduce((w, g) => w + 2 * g.r + 6 + labelW + gap, 0), height: 2 * rMax + fontSize + titlePad });
            }
            if (form === 'fan') {
                const fan = fanLayout(scale, values, labelW, fontSize);
                return withTitle({ width: fan.width, height: fan.height + titlePad });
            }
            if (form === 'weights') {
                const stack = values.reduce((h, v) => {
                    const w = Number(encodeOn(scale, v));
                    return h + Math.max(Number.isFinite(w) ? w : 0, fontSize) + gap;
                }, 0);
                return withTitle({ width: 2 * SPOKE + 6 + labelW, height: stack + titlePad });
            }
            if (form === 'ramp') {
                if (vertical) return withTitle({ width: rampThickness + 6 + labelW, height: rampLength + titlePad });
                return withTitle({ width: rampLength, height: rampThickness + 6 + fontSize + titlePad });
            }
            // Room for the per-category "×" and the trailing "+".
            const n = (values.length || 1) + (domainEditable ? 1 : 0);
            const removeW = domainEditable ? fontSize + 6 : 0;
            const box = swatchBox(channel, scale, values, swatchSize);
            if (vertical) {
                return { width: Math.max(box + 4 + labelW + removeW, titleW), height: n * (box + gap) + titlePad };
            }
            const itemW = box + 4 + labelW + removeW + gap;
            // A horizontal legend wraps at the plot width, as build() does.
            const perRow = dims && dims.width > 0 ? Math.max(1, Math.floor(dims.width / itemW)) : n;
            const rows = Math.ceil(n / perRow);
            return { width: Math.max(Math.min(n, perRow) * itemW, titleW), height: rows * (box + gap) + titlePad };
        },

        /**
         * @param {any[]} data
         * @param {import('../types').ScaleMap} scales
         * @param {number} width inner plot width
         * @param {number} height inner plot height
         * @returns {import('../types').FeatureNode[]}
         */
        build(data, scales, width, height) {
            const scale = scaleOf(scales);
            if (!scale || typeof scale.domain !== 'function') return [];
            const domain = scale.domain();
            if (!domain.length) return [];

            // An armed legend with no column to write would silently do nothing.
            if (editable && field == null && !((/** @type {any} */ (scale)).fields || []).length) {
                warn(
                    `legend:field:${channel}`,
                    `legend({ channel: "${channel}", edit: … }) can't tell which column to write: ` +
                    `no mark binds a field to "${channel}", so the scale carries none and the edit ` +
                    `is a no-op. Pin it with legend({ field: "…" }), or bind the channel on a mark.`
                );
            }

            const thm = themeOf(scales);
            const { swatchSize, gap, swatchRadius, titleWeight } = geometryOf(thm);
            const swatchStroke = strokeOpt ?? (thm.guide.legend.stroke || '#374151');
            const labelFill = fillOpt ?? (thm.guide.legend.labelFill || '#374151');
            const handleStyle = resolveHandles(scales, {
                handles: true,
                handleSize: handleSizeOpt,
                handleColor: handleColorOpt ?? thm.axis.handle,
            });
            const handleColor = handleStyle.fill;
            const handleSize = handleStyle.size;
            const handleStroke = handleStyle.stroke;
            const { form, values, format, labelW, fontSize } = readScale(scale, thm);
            const across = place.size || (this.measure(scales) || { width: 0, height: 0 })[vertical ? 'width' : 'height'];

            // Top-left of the content box, in the reserved band outside the plot.
            let cx0 = 0, cy0 = 0;
            if (anchor === 'right') cx0 = width + place.offset;
            else if (anchor === 'left') cx0 = -(place.offset + across);
            else if (anchor === 'bottom') cy0 = height + place.offset;
            else if (anchor === 'top') cy0 = -(place.offset + across);

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            let contentTop = cy0;
            const titleText = legendTitle(title, field, scale);
            if (titleText) {
                nodes.push({
                    type: 'text', x: cx0, y: cy0 + fontSize, text: titleText,
                    textAnchor: 'start', fill: labelFill, fontSize: fontSize + 1,
                    ...(titleWeight != null ? { fontWeight: titleWeight } : {}),
                    background: true, pointerEvents: 'none',
                });
                contentTop = cy0 + fontSize + 4;
            }

            // The row(s) the picker writes: `row` if pinned, else the selection in
            // this element's table, else the sole row of a one-row table, else none.
            const selected = /** @type {any} */ (scales).selection;
            const selectionAll = /** @type {any} */ (scales).selectionAll;
            const fromSelection = typeof selectionAll === 'function'
                ? selectionAll(this.table)
                : (selected != null ? [selected] : []);
            let wanted;
            if (row != null && row !== 'selection') {
                const r = typeof row === 'function' ? row(data, { selection: selected }) : row;
                wanted = r == null ? [] : (Array.isArray(r) ? r : [r]);
            } else if (fromSelection.length) {
                wanted = fromSelection;
            } else {
                wanted = data.length === 1 ? [0] : [];
            }
            const targetRows = wanted.filter(
                (/** @type {any} */ i) => Number.isInteger(i) && i >= 0 && i < data.length
            );
            const targetRow = targetRows.length ? targetRows[0] : null;

            // Never dim swatches to show picker state: the fill is the encoding. The
            // current-value ring carries it instead.
            const shared = {
                scale, values, format, cx0, cy0: contentTop, vertical, anchor,
                fontSize, swatchStroke, labelFill, editable, domainEditable,
                handleColor, data, channel, field, swatchRadius,
                targetRow, targetRows,
                currentStroke: thm.guide.legend.currentStroke || '#111827',
                currentWidth: thm.guide.legend.currentWidth ?? 2,
            };
            if (form === 'graduated') {
                buildGraduated(nodes, { ...shared, gap, labelW });
            } else if (form === 'fan') {
                buildFan(nodes, { ...shared, gap, labelW });
            } else if (form === 'weights') {
                buildWeights(nodes, { ...shared, gap, labelW });
            } else if (form === 'ramp') {
                buildRamp(nodes, {
                    ...shared, rampLength, rampThickness, handleColor, handleSize, handleStroke,
                });
            } else {
                buildSwatches(nodes, { ...shared, domain, swatchSize: swatchBox(channel, scale, domain, swatchSize), gap, labelW, plotWidth: width });
            }
            return nodes;
        },
    };
}

/**
 * The circles a graduated size legend draws: one per tick value with a usable
 * radius (from `scale.encode`), ascending. Shared by measure() and build().
 * @param {any} scale
 * @param {any[]} values tick values from readScale
 * @returns {{ v: any, r: number }[]}
 */
function graduatedRadii(scale, values) {
    const out = [];
    for (const v of values) {
        const r = Number(encodeOn(scale, v));
        // Skip radii too small to read.
        if (!Number.isFinite(r) || r < 1) continue;
        out.push({ v, r });
    }
    out.sort((a, b) => a.r - b.r);
    return out;
}

/**
 * A graduated size legend: labelled circles at tick values, biggest last.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildGraduated(nodes, o) {
    const { scale, values, format, cx0, cy0, vertical, gap, labelFill, fontSize, swatchStroke } = o;
    const radii = graduatedRadii(scale, values);
    if (!radii.length) return;
    const rMax = radii[radii.length - 1].r;

    let cursor = 0;
    for (const { v, r } of radii) {
        // Vertical: a shared centre line. Horizontal: a shared baseline.
        const cx = vertical ? cx0 + rMax : cx0 + cursor + r;
        const cy = vertical ? cy0 + cursor + r : cy0 + rMax;
        nodes.push({
            type: 'circle', cx, cy, r,
            fill: 'none', stroke: swatchStroke, strokeWidth: 1,
            background: true, pointerEvents: 'none',
        });
        nodes.push({
            type: 'text',
            x: vertical ? cx0 + 2 * rMax + 6 : cx,
            y: vertical ? cy + fontSize * 0.35 : cy0 + 2 * rMax + fontSize,
            text: String(format(v)), fill: labelFill, fontSize,
            textAnchor: vertical ? 'start' : 'middle',
            background: true, pointerEvents: 'none',
        });
        cursor += 2 * r + gap;
    }
}

/** Spoke length / segment length for the fan and weights forms. */
const SPOKE = 22;

/**
 * Where an angle legend's spokes and labels sit, relative to the hub, and the box
 * they occupy (measured, since the extent depends on the domain). Shared by
 * `measure` and `build`.
 * @param {any} scale @param {any[]} values @param {number} labelW @param {number} fontSize
 * @returns {{ spokes: any[], width: number, height: number, ox: number, oy: number }}
 */
function fanLayout(scale, values, labelW, fontSize) {
    const spokes = [];
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const v of values) {
        const deg = Number(encodeOn(scale, v));
        if (!Number.isFinite(deg)) continue;
        // Degrees are y-up, so screen y is negated.
        const rad = (deg * Math.PI) / 180;
        const tx = Math.cos(rad) * SPOKE, ty = -Math.sin(rad) * SPOKE;
        const lx = tx + Math.cos(rad) * 6, ly = ty - Math.sin(rad) * 6;
        const anchor = Math.cos(rad) < -0.1 ? 'end' : Math.cos(rad) > 0.1 ? 'start' : 'middle';
        spokes.push({ v, tx, ty, lx, ly, anchor });
        // The label's box, by anchor.
        const l = anchor === 'end' ? lx - labelW : anchor === 'middle' ? lx - labelW / 2 : lx;
        const r = anchor === 'end' ? lx : anchor === 'middle' ? lx + labelW / 2 : lx + labelW;
        minX = Math.min(minX, tx, l); maxX = Math.max(maxX, tx, r);
        minY = Math.min(minY, ty, ly - fontSize); maxY = Math.max(maxY, ty, ly + fontSize * 0.5);
    }
    return { spokes, width: maxX - minX, height: maxY - minY, ox: -minX, oy: -minY };
}

/**
 * An angle legend: one spoke per tick value at its encoded bearing, labelled past its tip.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildFan(nodes, o) {
    const { scale, values, format, cx0, cy0, labelFill, fontSize, swatchStroke, labelW } = o;
    const { spokes, ox, oy } = fanLayout(scale, values, labelW, fontSize);
    const cx = cx0 + ox, cy = cy0 + oy;
    for (const s of spokes) {
        nodes.push({
            type: 'line', x1: cx, y1: cy, x2: cx + s.tx, y2: cy + s.ty,
            stroke: swatchStroke, strokeWidth: 1.5,
            background: true, pointerEvents: 'none',
        });
        nodes.push({
            type: 'text', x: cx + s.lx, y: cy + s.ly + fontSize * 0.35,
            text: String(format(s.v)), fill: labelFill, fontSize,
            textAnchor: s.anchor, background: true, pointerEvents: 'none',
        });
    }
}

/**
 * A strokeWidth legend: one labelled segment per tick value at its encoded
 * thickness, thickest last.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildWeights(nodes, o) {
    const { scale, values, format, cx0, cy0, gap, labelFill, fontSize, swatchStroke } = o;
    const rows = [];
    for (const v of values) {
        const w = Number(encodeOn(scale, v));
        if (Number.isFinite(w) && w > 0) rows.push({ v, w });
    }
    rows.sort((a, b) => a.w - b.w);
    let cursor = 0;
    for (const { v, w } of rows) {
        const y = cy0 + cursor + w / 2;
        nodes.push({
            type: 'line', x1: cx0, y1: y, x2: cx0 + SPOKE * 2, y2: y,
            stroke: swatchStroke, strokeWidth: w,
            background: true, pointerEvents: 'none',
        });
        nodes.push({
            type: 'text', x: cx0 + SPOKE * 2 + 6, y: y + fontSize * 0.35,
            text: String(format(v)), fill: labelFill, fontSize,
            textAnchor: 'start', background: true, pointerEvents: 'none',
        });
        cursor += Math.max(w, fontSize) + gap;
    }
}

/**
 * A single swatch shape for a value: a colour chip, a sized dot, a glyph, an
 * opacity chip or a dash, whichever the channel encodes to. `ink` paints the
 * non-colour channels; `radius` rounds a colour or opacity chip.
 * @param {{ channel: string, x: number, y: number, size: number, encoded: any, stroke: string, ink: string, interactive: boolean, radius?: number }} o
 * @returns {any}
 */
function swatchNode({ channel, x, y, size, encoded, stroke, ink, interactive, radius = 0 }) {
    const round = radius > 0 ? { rx: Math.min(radius, size / 2) } : {};
    const base = interactive ? {} : { background: true, pointerEvents: 'none' };
    if (channel === 'symbol') {
        // A shape name or SVG path draws as a path chip; anything else as text.
        const unit = typeof encoded === 'string' && (/^\s*[Mm]/.test(encoded) || DEFAULT_SHAPES.includes(encoded.toLowerCase()))
            ? unitShape(encoded) : null;
        if (unit) {
            const { d, points } = placeShape(unit, x + size / 2, y + size / 2, size / 2);
            return { type: 'path', d, points, polygon: true, cx: x + size / 2, cy: y + size / 2, fill: ink, stroke, strokeWidth: 1, ...base };
        }
        return {
            type: 'text', x: x + size / 2, y: y + size / 2, text: String(encoded),
            fontSize: size, textAnchor: 'middle', dominantBaseline: 'central', ...base,
        };
    }
    if (channel === 'size') {
        // The encoded radius, unclamped; the caller sizes the row to fit.
        const r = Math.max(1, Number(encoded) || size / 2);
        return { type: 'circle', cx: x + size / 2, cy: y + size / 2, r, fill: ink, stroke, strokeWidth: 1, ...base };
    }
    if (channel === 'opacity') {
        return { type: 'rect', x, y, width: size, height: size, fill: ink, fillOpacity: Number(encoded), stroke, strokeWidth: 1, ...round, ...base };
    }
    if (channel === 'strokeDash') {
        return { type: 'line', x1: x, x2: x + size, y1: y + size / 2, y2: y + size / 2, stroke: ink, strokeWidth: 2, strokeDasharray: String(encoded), ...base };
    }
    return { type: 'rect', x, y, width: size, height: size, fill: encoded, stroke, strokeWidth: 1, ...round, ...base };
}

/**
 * Discrete swatches: one chip + label per domain value. A chip's click is the
 * picker (edit.legend.category) and its text commit is a rename
 * (edit.scale.categories); "×" and "+" remove and add categories.
 * `editText` goes on the chip, not the label, whose hit disc would eat the click.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildSwatches(nodes, o) {
    const { domain, cx0, cy0, vertical, swatchSize, gap, fontSize, swatchStroke, labelFill,
        editable, domainEditable, handleColor, targetRow, targetRows, scale, channel, data, field,
        currentStroke, currentWidth, swatchRadius } = o;
    // Interactive if either is armed: a picker needs a target row, a domain edit doesn't.
    const pickable = editable && targetRow != null;
    const interactive = pickable || domainEditable;
    // Dispatch keys on node.index; 0 is a sentinel for a domain-only legend.
    const nodeIndex = targetRow != null ? targetRow : 0;

    // The values the target rows hold now (ringed), read from the column the edit writes.
    const heldField = writtenField(field, scale);
    const held = new Set();
    if (pickable && heldField != null) {
        for (const i of targetRows) {
            const d = data && data[i];
            if (d && d[heldField] !== undefined) held.add(d[heldField]);
        }
    }

    const removeW = domainEditable ? fontSize + 6 : 0;
    // Vertical: stack down. Horizontal: flow right, one item = chip + label (+ ×).
    const itemPitch = swatchSize + 4 + o.labelW + removeW + gap;
    const stepY = swatchSize + gap;
    // A horizontal row wraps at the plot width, as in measure().
    const perRow = !vertical && o.plotWidth > 0 ? Math.max(1, Math.floor(o.plotWidth / itemPitch)) : Infinity;
    const posOf = (/** @type {number} */ i) => ({
        sx: vertical ? cx0 : cx0 + (i % perRow) * itemPitch,
        sy: vertical ? cy0 + i * stepY : cy0 + Math.floor(i / perRow) * stepY,
    });

    domain.forEach((/** @type {any} */ value, /** @type {number} */ i) => {
        const encoded = typeof scale.encode === 'function' ? scale.encode(value) : (typeof scale === 'function' ? scale(value) : value);
        const { sx, sy } = posOf(i);

        const chip = swatchNode({ channel, x: sx, y: sy, size: swatchSize, encoded, stroke: swatchStroke, ink: labelFill, interactive, radius: swatchRadius });
        if (interactive) {
            // The value a picker writes and the name a rename renames from.
            chip.category = value;
            // `index` for dispatch, `indices` for every row the click writes.
            chip.index = nodeIndex;
            chip.indices = targetRows;
            chip.cursor = domainEditable && !pickable ? 'text' : 'pointer';
            if (domainEditable) {
                chip.editText = true;
                // Seeds the editor, since the chip paints no text of its own.
                chip.editValue = String(value);
            }
        }
        nodes.push(chip);

        // The current-value ring: its own overlay node, so the chip's fill stays the encoding.
        if (held.has(value)) {
            nodes.push({
                type: 'rect',
                x: sx - 2.5, y: sy - 2.5, width: swatchSize + 5, height: swatchSize + 5,
                fill: 'none', stroke: currentStroke, strokeWidth: currentWidth,
                rx: 2, effect: true, background: true, pointerEvents: 'none',
            });
        }

        nodes.push({
            type: 'text', x: sx + swatchSize + 4, y: sy + swatchSize * 0.75,
            text: String(o.format(value)), fill: labelFill, fontSize,
            textAnchor: 'start', background: true, pointerEvents: 'none',
        });

        // The "×" remove affordance.
        if (domainEditable) {
            nodes.push({
                type: 'text',
                x: sx + swatchSize + 4 + o.labelW + fontSize * 0.5,
                y: sy + swatchSize * 0.75,
                text: '×', textAnchor: 'middle', fill: '#dc2626',
                fontSize: fontSize + 1, cursor: 'pointer',
                removeCategory: value, index: 0,
            });
        }
    });

    // The trailing "+": type a name to append a category.
    if (domainEditable) {
        const { sx, sy } = posOf(domain.length);
        nodes.push({
            type: 'text',
            x: sx + swatchSize / 2, y: sy + swatchSize * 0.75,
            text: '＋', textAnchor: 'middle', fill: handleColor,
            fontSize: fontSize + 4, cursor: 'pointer',
            addCategory: true, editText: true, index: 0,
        });
    }
}

/**
 * A continuous ramp: thin slices sampling the scale, tick labels, and (when
 * interactive) a handle at the target row's value. The handle carries the ramp
 * geometry so edit.legend.value() can invert a drag on a non-invertible colour scale.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildRamp(nodes, o) {
    const { scale, values, format, cx0, cy0, vertical, rampLength, rampThickness,
        fontSize, swatchStroke, labelFill, handleColor, handleSize, handleStroke,
        editable, data, targetRow, targetRows, channel, field } = o;
    const dom = scale.domain();
    const lo = Math.min(...dom.map(numOf));
    const hi = Math.max(...dom.map(numOf));
    const span = hi - lo || 1;
    const SLICES = 40;
    // A vertical ramp runs low→high bottom→top; a horizontal one low→high left→right.
    const along = vertical ? 'y' : 'x';
    const rampStart = vertical ? cy0 + rampLength : cx0; // pixel of `lo`
    const rampEnd = vertical ? cy0 : cx0 + rampLength;   // pixel of `hi`

    // Colour: the encoded colour. Opacity: the legend ink at that alpha. Anything
    // else: a neutral bar.
    const isColor = isColorChannel(channel);
    const isOpacity = channel === 'opacity' || channel === 'fillOpacity' || channel === 'strokeOpacity';
    const sliceOf = (/** @type {any} */ paint) => (isColor
        ? { fill: paint }
        : isOpacity
            ? { fill: labelFill, fillOpacity: Number(paint) }
            : { fill: '#94a3b8' });
    for (let j = 0; j < SLICES; j++) {
        const t0 = j / SLICES, t1 = (j + 1) / SLICES;
        const vMid = lo + ((t0 + t1) / 2) * span;
        const paint = encodeOn(scale, vMid);
        if (vertical) {
            const yTop = cy0 + (1 - t1) * rampLength;
            nodes.push({
                type: 'rect', x: cx0, y: yTop, width: rampThickness, height: rampLength / SLICES + 0.5,
                ...sliceOf(paint), stroke: 'none', background: true, pointerEvents: 'none',
            });
        } else {
            const xLeft = cx0 + t0 * rampLength;
            nodes.push({
                type: 'rect', x: xLeft, y: cy0, width: rampLength / SLICES + 0.5, height: rampThickness,
                ...sliceOf(paint), stroke: 'none', background: true, pointerEvents: 'none',
            });
        }
    }
    // Border around the ramp.
    nodes.push({
        type: 'rect', x: cx0, y: cy0, width: vertical ? rampThickness : rampLength,
        height: vertical ? rampLength : rampThickness, fill: 'none', stroke: swatchStroke,
        strokeWidth: 1, background: true, pointerEvents: 'none',
    });

    // Tick labels alongside the ramp.
    for (const v of values) {
        const t = (numOf(v) - lo) / span;
        if (t < -0.001 || t > 1.001) continue;
        if (vertical) {
            const y = cy0 + (1 - t) * rampLength;
            nodes.push({
                type: 'text', x: cx0 + rampThickness + 4, y: y + fontSize * 0.35,
                text: String(format(v)), fill: labelFill, fontSize, textAnchor: 'start',
                background: true, pointerEvents: 'none',
            });
        } else {
            const x = cx0 + t * rampLength;
            nodes.push({
                type: 'text', x, y: cy0 + rampThickness + fontSize + 2,
                text: String(format(v)), fill: labelFill, fontSize, textAnchor: 'middle',
                background: true, pointerEvents: 'none',
            });
        }
    }

    // Handle at the target row's value, read from the same column the edit writes.
    if (editable && targetRow != null) {
        const scaleField = writtenField(field, scale);
        const current = scaleField != null ? data[targetRow] && data[targetRow][scaleField] : null;
        const t = current == null ? 0.5 : Math.max(0, Math.min(1, (numOf(current) - lo) / span));
        const hx = vertical ? cx0 + rampThickness / 2 : cx0 + t * rampLength;
        const hy = vertical ? cy0 + (1 - t) * rampLength : cy0 + rampThickness / 2;
        nodes.push({
            type: 'circle', cx: hx, cy: hy, r: handleSize, fill: handleColor,
            stroke: handleStroke, strokeWidth: 1.5,
            // `index` for dispatch, `indices` for every row the drag writes.
            index: targetRow, indices: targetRows,
            along, rampStart, rampEnd, loValue: lo, hiValue: hi,
            cursor: vertical ? 'ns-resize' : 'ew-resize',
        });
    }
}

/** @param {any} [options] @returns {import('../types').Mark} */
export const legendColor = (options = {}) => legend({ ...options, channel: options.channel || 'fill' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const legendSize = (options = {}) => legend({ ...options, channel: 'size' });
/** @param {any} [options] @returns {import('../types').Mark} */
export const legendSymbol = (options = {}) => legend({ ...options, channel: 'symbol' });
