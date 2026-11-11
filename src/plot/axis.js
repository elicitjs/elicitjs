// @ts-check
import { ELEMENT_OPTIONS } from '../vocabulary.js';
// axis.js — axes and gridlines as CHART ELEMENTS (the Observable Plot model).
//
// An axis is scale chrome, not a data mark: `views: 'scale'`, singular `channel`,
// CHROME paint options (not desugared channels), domain-targeting edits
// (`edit.axis.*`). They are `elicit.elements.*`, and only there.
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
import { positionOnScale, isDiscrete, isBand, bandStartOf, bandwidthOf } from '../core/scales.js';
import { themeOf, axisToken } from '../core/theme.js';
import { measureText } from '../core/measure.js';
import { warnUnknownElementOptions, resolveHandles, elementEdits } from './mark.js';

/**
 * `axis`'s own option vocabulary, on top of the universal chart-element options
 * (id / edit / edits / field). Exported so core/axes.js can hand a
 * grid only the options a grid reads, instead of forwarding the whole axis config.
 * Keep in sync with the destructure in `axis` below.
 * @type {string[]}
 */
export const AXIS_OPTIONS = ELEMENT_OPTIONS.axis;

/**
 * `grid`'s option vocabulary. Keep in sync with the destructure in `grid` below.
 * @type {string[]}
 */
export const GRID_OPTIONS = ELEMENT_OPTIONS.grid;

/** Numeric view of a domain value (a Date sorts by its timestamp). */
const numOf = (/** @type {any} */ v) => (v instanceof Date ? v.getTime() : v);

/**
 * An interactive category label (editable DISCRETE axis): a foreground text node
 * that carries its `category` so edit.scale.categories() can rename it (dblclick ->
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
 * click routes to edit.scale.categories()'s remove edit, which drops the category
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
 * A per-tick option: a constant, or `(value, index) => constant` — the conditional
 * axis (a long tick and a bold label on January, a lighter one elsewhere). Only the
 * TICK-level options take the function form; the spine is one line and reads the
 * constant (or the theme) whatever the ticks do.
 * @param {any} opt
 * @param {any} v
 * @param {number} i
 * @returns {any}
 */
const perTick = (opt, v, i) => (typeof opt === 'function' ? opt(v, i) : opt);

/** A formatted tick label split into lines: a `\n` in the label is a line break,
 *  which is how a date axis puts the year under its January.
 * @param {any} label @returns {string[]} */
const linesOf = (label) => String(label).split('\n');

/**
 * The axis's chrome, resolved for ONE scale: the option, else the theme's
 * per-kind token (`axis.discrete` / `axis.continuous`), else the axis-wide token.
 * Shared by `measureTitle` and `build`, so what the engine reserves and what the
 * axis draws are one geometry.
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
 * A tick label's text-anchor: `labelAlign` when set, else the side's natural
 * anchor (centred under an x tick; flush against a y axis, so the text runs away
 * from the plot).
 * @param {boolean} isX @param {number} dir @param {any} c resolved chrome
 * @returns {'start' | 'middle' | 'end'}
 */
function labelAnchorOf(isX, dir, c) {
    if (c.labelAlign) return c.labelAlign;
    return isX ? 'middle' : (dir < 0 ? 'end' : 'start');
}

/**
 * Where the tick LABELS reach, measured outward from the axis line, and the widest
 * label — the one geometry both the title placement and the layout reservation
 * read. A rotated label reaches by its projection on the axis normal; a multi-line
 * one by its line count.
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
    // Unrotated: an x label's baseline sits 0.7em past the padding (its cap height),
    // every further line one line-height lower. A y label reaches by the part of its
    // width that runs AWAY from the plot, which its alignment decides: all of it
    // flush against the axis, none of it when `labelAlign` turns it inward (the
    // space-saving axis, whose labels sit inside the plot on a negative padding).
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
        title,
        titleAngle,
        // Chrome. Every one defaults to the theme's axis token of the same name
        // (per scale kind — see chromeOf), resolved at build time because a factory
        // can't see the chart's theme. An explicit option still wins.
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
        // Where the title sits ALONG the axis ('start' | 'middle' | 'end' — 'end' is
        // the right of an x axis and the top of a y axis), and where each label
        // sits: `labelAlign` its text-anchor, `labelOffset` px along the axis.
        titleAnchor,
        labelAlign,
        labelOffset,
        offset,
        grid = false,
        // Opt-in interactivity: an edit (edit.axis.scale / edit.scale.categories) or
        // a list of them, and an optional single field the edit pins (defaults to
        // every field on the axis). Axes are inert unless `edit`/`edits` is given.
        field,
        // Which TABLE an edit on this axis writes. Resolved by NAME in the engine's
        // one binding pass, like a mark's.
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

    // Which way this axis RUNS. For x/y the channel says it. A `count` axis runs
    // along whichever screen direction its mark stacks in, which the channel name
    // cannot carry (it is `count` either way), so the ANCHOR decides — and the
    // anchor is the visual truth for any channel that is not x or y.
    const isX = channel === 'x'
        || (channel !== 'y' && (anchor === 'bottom' || anchor === 'top'));
    const edits = elementEdits(options, channel);
    // Handles and category affordances serve DIRECT edits (a handle drag, a
    // rename); a plane or driver edit (the wheel zoom, a pan) draws nothing to grab.
    const editable = edits.some((e) => e.pick === 'direct');

    /**
     * Resolved chrome + tick data + label reach for this render — one pass that
     * measure and build both read.
     * @param {any} scales
     * @param {any} scale
     */
    const layout = (scales, scale) => {
        // A per-tick FUNCTION is resolved tick by tick below; the constant chrome
        // (the spine, the title, a tick the function leaves undefined) takes the
        // theme's value in its place.
        const constant = { ...chromeOpts };
        for (const k of /** @type {const} */ (['tickSize', 'fontWeight', 'stroke'])) {
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
        // The side this axis draws on, and how far past the plot edge its labels
        // and title reach — so the engine can reserve that room the way it does a
        // legend's, instead of a rotated y title falling outside a tight margin.
        anchor,
        /**
         * How far past the plot edge this axis reaches when it reaches further
         * than the default margin plans for: a title, rotated or multi-line labels,
         * an offset. 0 otherwise, so an unstyled axis reserves nothing new.
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
            // A flat title at an END of a y axis sits above (or below) the plot, not
            // beside the labels: the side only needs room for the labels.
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

            // Tick/label direction: axes on bottom/right push ticks in the positive
            // direction (down / right), top/left in the negative.
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

            // An editable DISCRETE axis makes its category labels interactive (rename
            // by dblclick-typing, remove via an × affordance); an editable CONTINUOUS
            // axis grows draggable end-handles. Both leave the spine/ticks inert.
            const discrete = editable && isDiscrete(scale);
            const continuous = editable && scale.kind === 'continuous';

            // Domain spine — spans the scale's pixel range along the axis.
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
                const labelFill = perTick(c.fill, v, i);
                const weight = perTick(fontWeight, v, i) ?? c.fontWeight;
                const text = String(format(v));
                const lines = linesOf(text);
                const paint = {
                    fill: labelFill, fontSize: c.fontSize, ...font,
                    ...(weight != null ? { fontWeight: weight } : {}),
                    ...(lines.length > 1 ? { lines, lineHeight: lineH } : {}),
                };
                // Labels sit one row past the LONGEST tick, so a long tick on one
                // value doesn't knock its label out of line.
                const reachOut = maxTick + c.tickPadding;
                if (size > 0) {
                    nodes.push(isX
                        ? { type: 'line', x1: t.x + p, x2: t.x + p, y1: t.y, y2: t.y + dir * size, stroke: tickStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' }
                        : { type: 'line', x1: t.x, x2: t.x + dir * size, y1: t.y + p, y2: t.y + p, stroke: tickStroke, strokeWidth: c.strokeWidth, background: true, pointerEvents: 'none' });
                }
                /** @type {any} */
                let label;
                if (c.labelAngle) {
                    // Rotated about the point just past the tick, with the text running
                    // AWAY from the axis: its end sits at the tick when it rises to
                    // the right of an x axis below the plot (or to the left of a y
                    // axis), its start otherwise.
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
                    // A multi-line label grows away from the axis: down below the
                    // plot, up above it.
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

            // Editable affordances past the ticks: a "+" to add a category, or the two
            // numeric end-handles the axisDrag driver grabs.
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
            // A y title runs ALONG its axis (rotated, reading bottom to top on the
            // left, top to bottom on the right) and sits past the widest tick label,
            // measured — it used to be horizontal at a fixed offset, so it crossed
            // the labels or was clipped, and nearly every author dropped it.
            // `titleAngle` overrides the rotation (0 for a horizontal y title).
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
                        // Flat, at an end: past the end of the axis, starting at the
                        // axis line and running over the plot — Plot's "↑ Frequency",
                        // Vega-Lite's titleX/titleY. 'end' is the top. Leave room for
                        // it in the margin on that side.
                        nodes.push({
                            type: 'text', x: t.x,
                            y: at === 'end'
                                ? t.y - c.titlePadding - c.titleFontSize * 0.5
                                : t.y + height + c.titlePadding + c.titleFontSize * 1.2,
                            text: title, textAnchor: dir < 0 ? 'start' : 'end', ...titlePaint,
                        });
                    } else {
                        const gap = angle ? c.fontSize * 0.9 : c.fontSize * 1.2;
                        // Rotated, the title runs along the axis: 'end' puts it at the
                        // top, whichever way it reads. Flat and centred, it hangs AWAY
                        // from the labels so it never sits on top of them.
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
 * The shared grid builder — full-span lines across the plot, one per tick.
 *
 * An `auto` grid is one the THEME asked for (`theme.grid.show`), which the
 * implicit axes add on every positional channel: it draws its lines only when the
 * theme's `show` covers its scale's kind, and its zero line whenever the theme sets
 * one. Written by hand, a grid always draws.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function grid(options = {}) {
    warnUnknownElementOptions('grid', options, GRID_OPTIONS);
    const {
        channel = 'x',
        ticks = 5,
        tickValues,
        // Line paint defaults to the theme's grid tokens (build-time). `stroke`,
        // `strokeWidth` and `strokeDash` also take `(value, index) => …`.
        stroke: strokeOpt,
        strokeWidth: strokeWidthOpt,
        strokeDash: strokeDashOpt,
        opacity: opacityOpt,
        // An emphasised line at 0 (continuous scales only): `true` for the theme's
        // zero style, an object for one of its own, `false` for none.
        zero: zeroOpt,
        // Where in a BAND a gridline sits: 0 its start edge, 1 its end, 0.5 (the
        // default) its centre — Vega-Lite's `bandPosition`. 0 draws the lines
        // BETWEEN the categories instead of through them. Ignored off a band scale.
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
        // Set by the implicit-axes layer (core/axes.js) on a grid the THEME asked for.
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
            // 'value' is the axis the VALUE runs along: the continuous one, or y
            // when both are (a line over time grids its values, not its dates).
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
