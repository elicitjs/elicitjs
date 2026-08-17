// @ts-check
// legend.js — a legend for a NON-POSITIONAL channel (fill / stroke / size /
// symbol), built as a COMPOSABLE MARK the same way axes are (plot/axis.js). A
// legend is "an axis for a channel that has no plot position": it reads the
// GLOBAL scale for its channel (scales.fill, scales.size, …) and draws either a
// column/row of discrete swatches or a continuous colour ramp.
//
// Two things set it apart from a plain guide row:
//   1. It reserves space on a side. `anchor` ('right'|'left'|'top'|'bottom')
//      picks the side; the engine's reservation pass (core/legends.js) calls
//      `measure(scales)`, shrinks the plot to make room, and stamps this mark's
//      `_place` with where its band landed — so the legend never overlaps marks.
//   2. It can be interactive. Pass `edit: edit.legend.category()` (a category
//      picker: click a swatch to set the channel's field) or `edit:
//      edit.legend.value()` (a continuous value picker: drag the ramp handle).
//      Interactive nodes are ordinary MARK-layer nodes (not `background`), so the
//      renderer binds click/drag directly to them — even out in the reserved margin
//      band, where the interaction plane doesn't reach.
//
// A legend is a key for one ENCODING — a (channel, field) pair — not for a channel.
// That is what `field` names, and it settles both halves of the job at once:
//
//   DRAWING   the scale is `scales[scaleKey(channel, field)]`, so the swatches are
//             that encoding's own domain. There is no union to list and nothing to
//             slice out of one.
//   WRITING   a picker writes that same field, in `table`. There is no
//             `scale.fields[0]` to fall back to and no ordering accident to inherit.
//
// The remaining coordinate is the ROW, which a swatch cannot name because it names
// a VALUE: `row` (a number, an array, or `(data, { selection }) => index`), else the
// chart's SELECTION, else the sole row of a one-row belief.
//
// Legends are normally built for you from the encodings the marks declare
// (core/legends.js) — by `legend:` on the channel or the chart's `legends` key.
// Composing one by hand is the third way, and then `field` is how it says which
// encoding it is for; with one encoding on the channel it can be left out.

import * as d3 from 'd3';
import { themeOf } from '../core/theme.js';
import { tickData } from './axis.js';
import { warnUnknownElementOptions, resolveHandles, elementEdits } from './mark.js';
import { warn } from '../core/dev.js';
import { scaleKey } from '../core/scales.js';

/**
 * `legend`'s own option vocabulary, on top of the universal chart-element options
 * (id / edit / edits / constraints / field). Keep in sync with the destructure in
 * `legend` below — a wrong entry is a false positive, which is worse than none.
 * @type {string[]}
 */
export const LEGEND_OPTIONS = [
    'channel', 'anchor', 'orient', 'swatchSize', 'gap', 'labelWidth', 'rampLength',
    'rampThickness', 'ticks', 'tickFormat', 'title', 'row', 'stroke', 'fill',
    'fontSize', 'handleColor', 'handleSize',
];

/** Numeric view of a domain value (a Date sorts by its timestamp). */
const numOf = (/** @type {any} */ v) => (v instanceof Date ? v.getTime() : v);

/** A colour channel encodes to a paint; size to a radius; symbol to a glyph. */
const isColorChannel = (/** @type {string} */ ch) => ch === 'fill' || ch === 'stroke';

/**
 * Does this scale want a continuous RAMP (a gradient) rather than swatches?
 * A `sequential`/`diverging` colour scale, or any continuous (invertible) scale.
 * Read via the capability model, never a `scale.type` allowlist for control flow —
 * `type` is consulted only to tell a colour ramp from a numeric one.
 * @param {any} scale
 * @returns {boolean}
 */
function isRampScale(scale) {
    return scale.kind === 'continuous' || scale.type === 'sequential' || scale.type === 'diverging';
}

/**
 * Which shape a legend takes. The discriminator is what the channel ENCODES TO,
 * not the scale kind alone:
 *
 *   swatches   a discrete domain, whatever the channel — one chip per category
 *   ramp       continuous COLOUR — a gradient with ticks
 *   graduated  continuous SIZE — nested circles at tick values
 *   fan        continuous ANGLE — spokes at their encoded bearings
 *   weights    continuous STROKEWIDTH — segments at their encoded thicknesses
 *
 * Reading only the scale kind sent every continuous channel to the ramp, and the
 * ramp can paint nothing but colour: `legendSize()` over a quantitative field drew
 * a flat grey bar with numbers beside it, which reports the domain and says nothing
 * about size at all. A key for a channel has to show that channel.
 *
 * Every form reads `scale.encode`, so each reflects whichever scale the channel
 * actually resolved — a linear or a sqrt size, a reversed angle — rather than
 * re-deriving one and quietly disagreeing with the marks.
 * @param {string} channel
 * @param {any} scale
 * @returns {'swatches' | 'ramp' | 'graduated' | 'fan' | 'weights'}
 */
function legendForm(channel, scale) {
    if (!isRampScale(scale)) return 'swatches';
    if (channel === 'size') return 'graduated';
    if (channel === 'angle') return 'fan';
    if (channel === 'strokeWidth') return 'weights';
    return 'ramp';
}

/**
 * The box one discrete swatch occupies. `swatchSize` for every channel except
 * `size`, whose chip is a circle whose radius the SCALE decides — so the row has to
 * grow to fit the biggest one, or a domain encoding to radius 18 overlaps its
 * neighbours in a 14px row. (It used to be clamped to fit instead, which kept the
 * layout tidy by making the key unable to show the top of its own scale.)
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
        const r = Number(typeof scale.encode === 'function' ? scale.encode(v) : scale(v));
        if (Number.isFinite(r)) max = Math.max(max, r);
    }
    return Math.max(swatchSize, 2 * max);
}

/**
 * The caption above a legend: the `title` option, else the ENCODED FIELD's name. A
 * legend with no title makes the reader guess what the colours are about, and the
 * field is already the answer — it is the thing this legend is a key for.
 * `scale.fields[0]` remains only as the fallback for a legend bound to no encoding
 * (a hand-composed one on a channel no mark binds). `title: false` turns it off.
 * @param {any} title @param {string | undefined} field @param {any} scale
 * @returns {string | null}
 */
function legendTitle(title, field, scale) {
    if (title === false || title === null) return null;
    if (title != null) return String(title);
    const f = field ?? ((scale && scale.fields && scale.fields[0]) || null);
    return f == null ? null : String(f);
}

/**
 * Estimate a label column's pixel width from the longest label. Exact text
 * measurement would need a canvas; a char-count estimate is enough to reserve a
 * band, and `labelWidth` overrides it when a caller wants it exact.
 * @param {any[]} values
 * @param {(v: any) => string} format
 * @param {number} fontSize
 * @returns {number}
 */
function estimateLabelWidth(values, format, fontSize) {
    let max = 0;
    for (const v of values) max = Math.max(max, String(format(v)).length);
    return Math.ceil(max * fontSize * 0.6);
}

/**
 * The shared legend builder. `legendColor`/`legendSize`/`legendSymbol` pin
 * `channel`. Unlike a mark it encodes no datum row — it draws a SCALE — so it has
 * no channel map; its chrome (stroke/fill/fontSize) are plain options resolved
 * against the theme's legend tokens at build time.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function legend(options = {}) {
    // Validation without desugaring: a legend has no channel map to desugar INTO,
    // but it takes a dozen options and used to check none of them (see
    // plot/mark.js's warnUnknownElementOptions).
    warnUnknownElementOptions('legend', options, LEGEND_OPTIONS);
    const {
        channel = 'fill',
        anchor = 'right',
        // Vertical (a stacked column) on the sides, horizontal (a row) top/bottom;
        // overridable.
        orient: orientOpt,
        swatchSize = 14,
        gap = 6,
        labelWidth: labelWidthOpt,
        rampLength = 140,
        rampThickness = 12,
        ticks = 4,
        tickFormat,
        title,
        // Which dataset row the picker writes into. Left undefined, it tracks the
        // chart's SELECTION (edit.select / el.select) — click a bar to select it,
        // then the legend edits that row; with nothing selected it falls back to the
        // sole row of a one-row belief, else targets nothing (inert until you pick).
        // A number pins a fixed row; a function `(data, { selection }) => index`
        // computes one.
        row,
        // Chrome — theme legend tokens unless overridden (resolved at build time).
        stroke: strokeOpt,
        fill: fillOpt,
        fontSize: fontSizeOpt,
        handleColor: handleColorOpt,
        handleSize: handleSizeOpt,
        // Opt-in interactivity: edit.legend.category() (discrete category pick) or
        // edit.legend.value() (continuous value pick), or a list. Both `edit` and
        // `edits` are read (elementEdits).
        //
        // `field` and `table` are WHAT such an edit writes. A legend has no channel
        // map, so with neither stated the field falls back to `scale.fields[0]` —
        // whichever mark was declared first — and the table to the structure's
        // primary. Pin them and the spec says which column of which table a swatch
        // click lands in.
        field,
        table,
        id,
        // Forwarded, not dropped — the engine promotes a feature's constraints into
        // the one dataset-wide set.
        constraints,
    } = options;

    const orient = orientOpt || (anchor === 'left' || anchor === 'right' ? 'vertical' : 'horizontal');
    const vertical = orient === 'vertical';
    const edits = elementEdits(options, channel);
    const editable = edits.length > 0;
    // A DOMAIN edit (edit.scale.categories) reshapes the vocabulary the legend is
    // drawing, so it needs affordances a picker does not: a typable swatch, a "×"
    // per category and a "+" at the end. Read as a capability off the edits rather
    // than as an option, the same way the axis decides — and separately from
    // `editable`, because the two kinds of edit arm under different conditions: a
    // picker needs a target ROW, a domain edit needs nothing but the scale.
    const domainEditable = edits.some((e) => /** @type {any} */ (e).target === 'domain');

    // THE scale this legend is a key for. A scale is one ENCODING — (channel, field)
    // — so the field is what finds it; the bare channel name is the fallback for a
    // positional scale and for a legend bound to no encoding at all.
    /** @param {import('../types').ScaleMap} scales */
    const scaleOf = (scales) => /** @type {any} */ (scales)[scaleKey(channel, field)] || scales[channel];

    // Filled by core/legends.js's reservation pass each render: `offset` is the
    // gap from the plot edge to this legend's near edge (past any axis in the
    // author margin), `size` its extent across the side. A mutable object the
    // build closure reads, so the engine can place the legend without widening
    // build()'s signature.
    const place = { offset: 0, size: 0 };

    /**
     * The domain values a discrete legend lists, or the [lo,hi] a ramp spans, plus
     * a formatter — the one place the scale is read, shared by measure() and build().
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
            // A colour ramp scale sniffs as `discrete` (no invert), so tickData would
            // return only its domain endpoints. Build nice ticks off a linear proxy
            // over [lo, hi] instead — the ramp is a continuous axis in disguise.
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
        markName: 'legend',
        constraints,
        isLegend: true,
        views: 'scale',
        channel,
        anchor,
        orient,
        layer: 'background',
        // Read by resolveChannels (edit/route.js) ahead of the emergent
        // `scale.fields[0]`, and by the engine's table-binding pass.
        edits,
        field,
        table,
        _place: place,

        /**
         * Bounding box of the legend content, so the reservation pass knows how much
         * to shrink the plot. `across` (width for a vertical legend, height for a
         * horizontal one) is what it reserves on the side.
         * @param {import('../types').ScaleMap} scales
         * @returns {{ width: number, height: number } | null}
         */
        measure(scales) {
            const scale = scaleOf(scales);
            if (!scale || typeof scale.domain !== 'function') return null;
            const thm = themeOf(scales);
            const { form, values, labelW, fontSize } = readScale(scale, thm);
            const titleText = legendTitle(title, field, scale);
            const titlePad = titleText ? fontSize + 4 : 0;

            if (form === 'graduated') {
                // Nested circles: the band is as wide as the biggest one, and as tall
                // as the stack. Radii come from the scale, so a wider size range
                // reserves more room without a second constant to keep in step.
                const radii = graduatedRadii(scale, values);
                if (!radii.length) return { width: labelW, height: fontSize + titlePad };
                const rMax = radii[radii.length - 1].r;
                const stack = radii.reduce((h, g) => h + 2 * g.r + gap, 0);
                if (vertical) return { width: 2 * rMax + 6 + labelW, height: stack + titlePad };
                return { width: radii.reduce((w, g) => w + 2 * g.r + 6 + labelW + gap, 0), height: 2 * rMax + fontSize + titlePad };
            }
            if (form === 'fan') {
                // Measured from the actual spoke/label extents, not a square box —
                // the sweep decides how much room a fan needs.
                const fan = fanLayout(scale, values, labelW, fontSize);
                return { width: fan.width, height: fan.height + titlePad };
            }
            if (form === 'weights') {
                const stack = values.reduce((h, v) => {
                    const w = Number(typeof scale.encode === 'function' ? scale.encode(v) : scale(v));
                    return h + Math.max(Number.isFinite(w) ? w : 0, fontSize) + gap;
                }, 0);
                return { width: 2 * SPOKE + 6 + labelW, height: stack + titlePad };
            }
            if (form === 'ramp') {
                if (vertical) return { width: rampThickness + 6 + labelW, height: rampLength + titlePad };
                return { width: rampLength, height: rampThickness + 6 + fontSize + titlePad };
            }
            // A domain-editable legend reserves room for the per-category "×" and
            // the trailing "+". Measured here as well as drawn, or the affordances
            // render outside the band the reservation pass shrank the plot by.
            const n = (values.length || 1) + (domainEditable ? 1 : 0);
            const removeW = domainEditable ? fontSize + 6 : 0;
            const box = swatchBox(channel, scale, values, swatchSize);
            if (vertical) {
                return { width: box + 4 + labelW + removeW, height: n * (box + gap) + titlePad };
            }
            const itemW = box + 4 + labelW + removeW + gap;
            return { width: n * itemW, height: box + gap + titlePad };
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

            // An armed legend that resolves NO column is a silent no-op: the swatches
            // draw, the cursor turns into a pointer, the click dispatches, and
            // `apply` bails because there is nothing to write to. That happens
            // whenever the channel resolves no scale of its own (`scale: null`, a raw
            // channel a mark reads itself) so `scale.fields` is empty and no `field`
            // was pinned. Say so — this is the one case the author cannot see.
            if (editable && field == null && !((/** @type {any} */ (scale)).fields || []).length) {
                warn(
                    `legend:field:${channel}`,
                    `legend({ channel: "${channel}", edit: … }) can't tell which column to write: ` +
                    `no mark binds a field to "${channel}", so the scale carries none and the edit ` +
                    `is a no-op. Pin it with legend({ field: "…" }), or bind the channel on a mark.`
                );
            }

            const thm = themeOf(scales);
            const swatchStroke = strokeOpt ?? (thm.guide.legend.stroke || '#374151');
            const labelFill = fillOpt ?? (thm.guide.legend.labelFill || '#374151');
            // Shared handle contract (plot/mark.js) — legend used to hard-code size
            // and bypass resolveHandles for ramp grips.
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

            // Top-left of the content box, in inner-plot g-coordinates. The legend
            // sits in the reserved band just outside the plot on `anchor`'s side.
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
                    background: true, pointerEvents: 'none',
                });
                contentTop = cy0 + fontSize + 4;
            }

            // The row(s) the picker writes into. A swatch names a VALUE, not a row,
            // so the row always comes from somewhere else:
            //   row: a number / an array / (data, { selection }) => …  — pinned
            //   row: 'selection' or unset  — the chart's SELECTION, which may hold
            //     several rows (edit.select({ multi: true }), el.select([…]))
            //   nothing selected, and the table has exactly ONE row  — that row. A
            //     one-row belief is a schema fact, not a guess among many.
            //   otherwise  — none, and the legend renders visibly disarmed below.
            // `this.table` is the table the engine bound this element to, so a
            // multi-table chart reads the right table's selection.
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

            // A legend is a KEY first and a picker second, so its unarmed state is
            // not allowed to cost legibility. Fading the swatches was the obvious
            // move and it is wrong twice over: a swatch's fill IS the encoding, so
            // dimming it makes the key report a colour the marks do not have, and
            // the whole legend then reads as absent rather than as pending — which
            // is the same mistake as an effect painted over a mark's own paint.
            //
            // The state is carried by the current-value ring instead: it appears
            // when there is a row to write and marks what a click would replace, so
            // "no ring" is "nothing to write to" without touching the key. Whether
            // that state is also a BUG — a picker nothing can ever arm — is a
            // cross-feature question the engine asks (warnUnreachableLegendRow).
            const shared = {
                scale, values, format, cx0, cy0: contentTop, vertical, anchor,
                fontSize, swatchStroke, labelFill, editable, domainEditable,
                handleColor, data, channel, field,
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
                buildSwatches(nodes, { ...shared, domain, swatchSize: swatchBox(channel, scale, domain, swatchSize), gap, labelW });
            }
            return nodes;
        },
    };
}

/**
 * The circles a graduated size legend draws: one per tick value the scale maps to a
 * usable radius, ascending. Shared by measure() and build() so the reserved band and
 * the drawn content cannot disagree.
 *
 * Radii come from `scale.encode`, which is the whole point — the legend reports
 * whichever scale the size channel resolved (linear radius by default, `sqrt` for
 * linear area) rather than re-deriving one and quietly disagreeing with the marks.
 * @param {any} scale
 * @param {any[]} values tick values from readScale
 * @returns {{ v: any, r: number }[]}
 */
function graduatedRadii(scale, values) {
    const out = [];
    for (const v of values) {
        const r = Number(typeof scale.encode === 'function' ? scale.encode(v) : scale(v));
        // A tick below the domain's floor (a linear ticks() run often starts at 0)
        // encodes to a dot too small to read; it would draw a smudge with a number
        // beside it and say nothing.
        if (!Number.isFinite(r) || r < 1) continue;
        out.push({ v, r });
    }
    out.sort((a, b) => a.r - b.r);
    return out;
}

/**
 * A graduated symbol legend: nested circles at tick values, biggest last, each
 * labelled. The size counterpart of the colour ramp — a continuous size scale has
 * no gradient to draw, so it shows the sizes themselves.
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
        // Circles share a vertical centre line (vertical) so the nesting reads as one
        // family; horizontally they sit on a common baseline for the same reason.
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
 * Where an ANGLE legend's spokes and labels sit, in a local frame whose origin is
 * the fan's hub, plus the bounding box that frame occupies.
 *
 * Laid out by MEASURING rather than by assuming a centred square, because a fan's
 * extent depends entirely on its domain: the default [180, 0] sweeps the upper half
 * only, so half a square box is empty while the topmost label runs up into the
 * title. Sharing one layout between `measure` and `build` is also what keeps the
 * reserved band and the drawn content in agreement.
 * @param {any} scale @param {any[]} values @param {number} labelW @param {number} fontSize
 * @returns {{ spokes: any[], width: number, height: number, ox: number, oy: number }}
 */
function fanLayout(scale, values, labelW, fontSize) {
    const spokes = [];
    // The hub is the local origin; every extent below is relative to it.
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const v of values) {
        const deg = Number(typeof scale.encode === 'function' ? scale.encode(v) : scale(v));
        if (!Number.isFinite(deg)) continue;
        // Degrees are math convention (y-up) — `channelRange`'s [180, 0] default and
        // what every angle-consuming mark reads — so screen y is negated.
        const rad = (deg * Math.PI) / 180;
        const tx = Math.cos(rad) * SPOKE, ty = -Math.sin(rad) * SPOKE;
        const lx = tx + Math.cos(rad) * 6, ly = ty - Math.sin(rad) * 6;
        const anchor = Math.cos(rad) < -0.1 ? 'end' : Math.cos(rad) > 0.1 ? 'start' : 'middle';
        spokes.push({ v, tx, ty, lx, ly, anchor });
        // The label's own box, by anchor, so a left-pointing spoke reserves room to
        // its left rather than to its right.
        const l = anchor === 'end' ? lx - labelW : anchor === 'middle' ? lx - labelW / 2 : lx;
        const r = anchor === 'end' ? lx : anchor === 'middle' ? lx + labelW / 2 : lx + labelW;
        minX = Math.min(minX, tx, l); maxX = Math.max(maxX, tx, r);
        minY = Math.min(minY, ty, ly - fontSize); maxY = Math.max(maxY, ty, ly + fontSize * 0.5);
    }
    return { spokes, width: maxX - minX, height: maxY - minY, ox: -minX, oy: -minY };
}

/**
 * An ANGLE legend: one spoke per tick value, drawn at the bearing that value
 * encodes to and labelled past its tip.
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
 * A STROKEWIDTH legend: one segment per tick value, drawn at the thickness that
 * value encodes to, labelled beside it. Thickest last, so the stack reads as a
 * progression the way the graduated circles do.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildWeights(nodes, o) {
    const { scale, values, format, cx0, cy0, gap, labelFill, fontSize, swatchStroke } = o;
    const rows = [];
    for (const v of values) {
        const w = Number(typeof scale.encode === 'function' ? scale.encode(v) : scale(v));
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
 * A single swatch shape for a value: a colour chip, a sized dot, a glyph, or an
 * opacity chip — whichever the channel encodes to.
 * `ink` is the theme's legend ink, for the channels that encode to something other
 * than a colour and so need a colour to be shown IN (a size dot, an opacity chip).
 * Those two used to be literals — `#64748b` and `#334155` — so a themed chart got
 * two slate shapes that matched nothing else on the page.
 * @param {{ channel: string, x: number, y: number, size: number, encoded: any, stroke: string, ink: string, interactive: boolean }} o
 * @returns {any}
 */
function swatchNode({ channel, x, y, size, encoded, stroke, ink, interactive }) {
    const base = interactive ? {} : { background: true, pointerEvents: 'none' };
    if (channel === 'symbol') {
        return {
            type: 'text', x: x + size / 2, y: y + size / 2, text: String(encoded),
            fontSize: size, textAnchor: 'middle', dominantBaseline: 'central', ...base,
        };
    }
    if (channel === 'size') {
        // `size` on a DISCRETE domain encodes to a radius per category. The chip used
        // to clamp that to swatchSize/2 = 7px while the size range runs to 18, so
        // every category above 7 collapsed to one dot and the key could not show the
        // top of its own scale. The caller sizes the row from the radii instead.
        const r = Math.max(1, Number(encoded) || size / 2);
        return { type: 'circle', cx: x + size / 2, cy: y + size / 2, r, fill: ink, stroke, strokeWidth: 1, ...base };
    }
    if (channel === 'opacity') {
        return { type: 'rect', x, y, width: size, height: size, fill: ink, fillOpacity: Number(encoded), stroke, strokeWidth: 1, ...base };
    }
    return { type: 'rect', x, y, width: size, height: size, fill: encoded, stroke, strokeWidth: 1, ...base };
}

/**
 * Discrete swatches: one chip + label per domain value.
 *
 * A chip can carry two unrelated interactions, and they coexist without
 * arbitration because they read different GESTURES:
 *   picker (edit.legend.category)     click  -> writes `category` into the target row
 *   rename (edit.scale.categories)    commit -> renames the domain entry
 * plus a "×" per category and a trailing "+" for the other two domain edits.
 *
 * `editText` goes on the CHIP, never on the label beside it: an edit makes its
 * node pointer-active, and a text node gets a hit area of `fontSize + 4` about its
 * ANCHOR — a disc sitting dead centre of the swatch row that would swallow the
 * click meant for the chip. Put the edit on the shape you mean to grab.
 * @param {any[]} nodes
 * @param {any} o
 */
function buildSwatches(nodes, o) {
    const { domain, cx0, cy0, vertical, swatchSize, gap, fontSize, swatchStroke, labelFill,
        editable, domainEditable, handleColor, targetRow, targetRows, scale, channel, data, field,
        currentStroke, currentWidth } = o;
    // A picker needs a target ROW; a domain edit needs only the scale. So the chip
    // is a live mark-layer node if EITHER is armed — reading one flag for both is
    // what would leave a rename-only legend inert on a chart with no selection.
    const pickable = editable && targetRow != null;
    const interactive = pickable || domainEditable;
    // Direct-pick dispatch keys on node.index, so a domain-only legend still needs
    // one; 0 is the sentinel the axis uses, and a domain edit ignores it.
    const nodeIndex = targetRow != null ? targetRow : 0;

    // Which domain values the target row(s) currently hold — what a click would
    // REPLACE. With several rows selected they may hold different values, so this is
    // a set and more than one swatch can be ringed. Read through the same column the
    // edit writes (the pinned `field`, else the scale's own).
    const heldField = field ?? ((scale.fields && scale.fields[0]) || null);
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
    const posOf = (/** @type {number} */ i) => ({
        sx: vertical ? cx0 : cx0 + i * itemPitch,
        sy: vertical ? cy0 + i * stepY : cy0,
    });

    domain.forEach((/** @type {any} */ value, /** @type {number} */ i) => {
        const encoded = typeof scale.encode === 'function' ? scale.encode(value) : (typeof scale === 'function' ? scale(value) : value);
        const { sx, sy } = posOf(i);

        const chip = swatchNode({ channel, x: sx, y: sy, size: swatchSize, encoded, stroke: swatchStroke, ink: labelFill, interactive });
        if (interactive) {
            // `category` is read by BOTH interactions — as the value a picker click
            // writes, and as the name a rename commit renames FROM. One key, because
            // it is one fact about the swatch; they never collide because a click and
            // a commit are different gestures.
            chip.category = value;
            // `index` is what direct-pick dispatch keys on (one row); `indices` is
            // every row the click should write, so a multi-row selection moves
            // together instead of only its first member.
            chip.index = nodeIndex;
            chip.indices = targetRows;
            chip.cursor = domainEditable && !pickable ? 'text' : 'pointer';
            if (domainEditable) {
                chip.editText = true;
                // The chip PAINTS no text — it is a colour box, and its name is the
                // sibling label — so the editor has nothing to seed from and would
                // open empty, turning every rename into "retype it from scratch".
                // `editValue` is the string the edit is actually about.
                chip.editValue = String(value);
            }
        }
        nodes.push(chip);

        // The current-value ring. An OVERLAY (its own node, tagged `effect`) rather
        // than paint on the chip, for the reason every effect is: the chip's fill IS
        // the datum's encoding, and restyling it would overwrite what the legend is
        // there to show. Drawn around the chip, so it reads on a swatch of any colour.
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

        // The "×" remove affordance, mirroring the axis's. Its own node so the click
        // is unambiguous — the chip means "this category", the × means "drop it".
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

    // The trailing "+": double-click it, type a name, and the category is appended.
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
 * A continuous colour ramp: a stack of thin slices sampling the scale, tick
 * labels, and (when interactive) a draggable handle at the target row's current
 * value. The handle carries the ramp band geometry so edit.legendValue can map a
 * drag position back to a value — the by-hand inversion a non-invertible colour
 * scale forces.
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

    // A colour ramp paints the encoded colour. An OPACITY ramp paints the legend's
    // own ink and varies its alpha, so the gradient shows the thing being encoded.
    // Anything else continuous and non-colour has no visual to fade, so it keeps the
    // neutral bar and lets the tick labels carry the domain.
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
        const paint = typeof scale.encode === 'function' ? scale.encode(vMid) : scale(vMid);
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

    // Draggable handle at the target row's current value (edit.legend.value). Read
    // through the SAME column the edit writes — the legend's pinned `field` ahead of
    // the emergent `scale.fields[0]` — or the grip sits at one mark's value while the
    // drag writes another's.
    if (editable && targetRow != null) {
        const scaleField = field ?? ((scale.fields && scale.fields[0]) || null);
        const current = scaleField != null ? data[targetRow] && data[targetRow][scaleField] : null;
        const t = current == null ? 0.5 : Math.max(0, Math.min(1, (numOf(current) - lo) / span));
        const hx = vertical ? cx0 + rampThickness / 2 : cx0 + t * rampLength;
        const hy = vertical ? cy0 + (1 - t) * rampLength : cy0 + rampThickness / 2;
        nodes.push({
            // Placement: along the ramp at the target row's current value.
            type: 'circle', cx: hx, cy: hy, r: handleSize, fill: handleColor,
            stroke: handleStroke, strokeWidth: 1.5,
            // `index` for dispatch (one row), `indices` for the write — a drag with
            // several rows selected moves them all to the value under the grip.
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
