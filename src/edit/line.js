// @ts-check
// line.js — edits on series marks (scope 'line'):
//   anchor       — add one point to a line (click)
//   newSeries    — seed a whole flat line from sampled positions (dblclick)
//   draw         — author a line by dragging, or reshape one near the press
//   sweep        — repaint each point the pointer crosses (drag)
//   removeSeries — delete a whole line (click)

import { warn } from '../core/dev.js';
import { makeEdit, schemaDefaults, nextSeriesKey, lastFreeSeries, seriesKeyOf, numOf, invertChannel, mintDatum } from './shared.js';
import { nearestSeries, nearestMark, nearestMarkOnAxis, resolveThreshold } from './pick.js';
import { resolveSamples } from '../core/samples.js';
import { move } from './basic.js';

/**
 * anchor — add one point to a line, at the inverted pointer.
 *   into 'nearest' -> attach to the closest line within `threshold`, else start a
 *                     new series.
 *   into 'new'     -> always start a new series.
 * Appends; the mark's `order` sorts the points.
 * @param {import('../types').AnchorOptions} [options]
 * @returns {import('../types').Edit}
 */
export function anchor(options = {}) {
    const { into = 'nearest', series: seriesField, ...rest } = options;
    const threshold = resolveThreshold(options.threshold);
    return makeEdit({
        type: 'line.anchor',
        gesture: 'click',
        channels: ['x', 'y'],
        pick: 'plane',
        scope: 'line',
        into,
        cardinality: 'append',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const sField = seriesField || ctx.seriesKey || null;
            let seriesVal = null;
            if (into === 'nearest') {
                // Appending breaks no locked row, so locked lines count here.
                seriesVal = nearestSeries(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, threshold, { includeLocked: true });
                // Freehand (connect: 'sequence'): a far click extends the last free line.
                if (seriesVal == null && ctx.connect === 'sequence' && sField && (ctx.data || []).length) {
                    seriesVal = lastFreeSeries(ctx.data, sField, ctx.locked);
                }
            }
            if (seriesVal == null) seriesVal = nextSeriesKey(ctx.data, sField, ctx.schema);
            if (seriesVal === undefined) return undefined; // closed domain exhausted

            // The series goes in `defaults`, not `seed`: it must not count as placed.
            const datum = mintDatum(ctx, { defaults: sField ? { [sField]: seriesVal } : {} });
            if (!datum) return undefined;
            return [...ctx.data, datum];
        }
    });
}

/**
 * newSeries — seed a whole flat line: one point per sampled domain position, all
 * at the pointer's value. Pair with `sweep` to shape it.
 *   along / value  : the axis the line runs along, and the value axis. Default x/y.
 *   samples        : passed to resolveSamples (default: the scale's ticks).
 * @param {import('../types').NewSeriesOptions} [options]
 * @returns {import('../types').Edit}
 */
export function newSeries(options = {}) {
    const { along = 'x', value = 'y', samples, series: seriesField, ...rest } = options;
    return makeEdit({
        type: 'line.newSeries',
        gesture: 'dblclick',
        // Many rows at once, so no single active datum.
        cardinality: 'appendMany',
        channels: [along, value],
        pick: 'plane',
        scope: 'line',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const sField = seriesField || ctx.seriesKey || null;
            // Resolved channels only: one the mark doesn't encode as a field has no column.
            const domainField = ctx.channels.find((c) => c.name === along)?.field;
            const valueField = ctx.channels.find((c) => c.name === value)?.field;
            const domainScale = ctx.scales[along];
            const valueScale = ctx.scales[value];
            if (!domainScale || !domainField) return undefined;

            const positions = resolveSamples(domainScale, samples);
            if (!positions.length) return undefined;

            // Flat line at the clicked value, else the value domain's start.
            const seedVisual = value === 'x' ? ctx.pointer.x : ctx.pointer.y;
            const seedValue = valueScale && valueScale.invertible
                ? valueScale.invertValue(seedVisual)
                : (valueScale && valueScale.domain ? valueScale.domain()[0] : null);
            const seriesVal = nextSeriesKey(ctx.data, sField, ctx.schema);
            if (seriesVal === undefined) return undefined; // closed domain exhausted

            const seeded = positions.map((pos) => {
                const datum = { ...schemaDefaults(ctx.schema) };
                if (sField) datum[sField] = seriesVal;
                datum[domainField] = pos;
                if (valueField) datum[valueField] = seedValue;
                return datum;
            });
            return [...ctx.data, ...seeded];
        }
    });
}

/**
 * draw — author or reshape lines by dragging. The draw driver picks the mode at
 * dragstart and stores it in ctx.session:
 *   near a line (within `threshold`) -> edit: repaint that line's nearest point.
 *   empty space (or `into: 'new'`)   -> draw a new line:
 *       domain order   -> upsert each `samples` column the pointer crosses.
 *       sequence order -> append a point every `minDist` px (freehand).
 *   along / value  : the axis the line runs along, and the value axis. Default x/y.
 *   channels       : governed channels (default [along, value]); freehand needs both.
 *   samples        : domain grid for you-draw-it (resolveSamples; default = ticks).
 *   minDist        : freehand pointer-sampling distance in px (default 8).
 *   threshold      : proximity radius for the edit-vs-draw decision (default 40).
 *   into           : 'nearest' (default, near edits / far draws) | 'new' (always draw).
 * @param {import('../types').DrawOptions} [options]
 * @returns {import('../types').Edit}
 */
export function draw(options = {}) {
    const {
        along = 'x', value = 'y', samples, minDist = 8,
        into = 'nearest', series: seriesField, ...rest
    } = options;
    return makeEdit({
        type: 'line.draw',
        gesture: 'drag',
        cardinality: 'appendMany',
        inverts: true,
        channels: [along, value],
        pick: 'draw',
        scope: 'line',
        into,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const st = ctx.session;
            if (!st) return undefined; // engine sets the per-drag lock on dragstart
            const sField = seriesField || ctx.seriesKey || null;
            const freehandLine = ctx.connect === 'sequence';
            // A new line's series key is resolved on the first tick.
            let seriesVal = st.drawSeries;
            if (st.mode === 'draw' && seriesVal == null) {
                seriesVal = st.drawContinue ? lastFreeSeries(ctx.data, sField, ctx.locked) : undefined;
                if (seriesVal === undefined) seriesVal = nextSeriesKey(ctx.data, sField, ctx.schema);
                if (seriesVal === undefined) return undefined; // closed domain exhausted
                st.drawSeries = seriesVal;
            }

            /** @type {Record<string, import('../types').ResolvedChannel>} */
            const byName = {};
            for (const c of ctx.channels) byName[c.name] = c;

            // Edit mode: rewrite the locked series' nearest point (by column, or in
            // 2D for freehand).
            if (st.mode === 'edit') {
                const idx = freehandLine
                    ? nearestMark(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, Infinity, seriesVal)
                    : nearestMarkOnAxis(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, Infinity, along, seriesVal);
                if (idx == null || ctx.data[idx] == null) return undefined;
                const datum = { ...ctx.data[idx] };
                for (const ch of ctx.channels) {
                    // A domain line paints only the value axis.
                    if (!freehandLine && ch.name !== value) continue;
                    const v = invertChannel(ch, ctx.pointer);
                    if (v !== undefined) datum[ch.field] = v;
                }
                return ctx.data.map((d, i) => (i === idx ? datum : d));
            }

            // Freehand: append a pointer sample once it has moved `minDist`.
            if (freehandLine) {
                const px = ctx.pointer.x, py = ctx.pointer.y;
                if (st.lastX != null && st.lastY != null) {
                    const moved = Math.hypot(px - st.lastX, py - st.lastY);
                    if (moved < minDist) return undefined; // too close — skip
                }
                const datum = mintDatum(ctx, { defaults: sField ? { [sField]: seriesVal } : {} });
                if (!datum) return undefined;
                st.lastX = px; st.lastY = py;
                return [...ctx.data, datum];
            }

            // Domain line: upsert the sample columns the pointer has crossed.
            const dCh = byName[along], vCh = byName[value];
            if (!dCh || !vCh || !dCh.scale || !vCh.scale
                || !dCh.scale.invertible || !vCh.scale.invertible) return undefined;
            const positions = resolveSamples(ctx.scales[along], samples);
            if (!positions.length) return undefined;

            const dCur = dCh.scale.invertValue(along === 'x' ? ctx.pointer.x : ctx.pointer.y);
            const v = vCh.scale.invertValue(value === 'x' ? ctx.pointer.x : ctx.pointer.y);

            // Fill every column since the last tick, so a fast drag skips none.
            const nearest = () => {
                let best = null, bd = Infinity;
                for (const p of positions) {
                    const d = Math.abs(numOf(p) - numOf(dCur));
                    if (d < bd) { bd = d; best = p; }
                }
                return best == null ? [] : [best];
            };
            let targets;
            if (st.lastDomain == null) {
                targets = nearest();
            } else {
                const lo = Math.min(numOf(st.lastDomain), numOf(dCur));
                const hi = Math.max(numOf(st.lastDomain), numOf(dCur));
                targets = positions.filter((p) => numOf(p) >= lo && numOf(p) <= hi);
                if (!targets.length) targets = nearest();
            }
            st.lastDomain = dCur;

            const data = ctx.data.slice();
            for (const pos of targets) {
                const idx = data.findIndex((row) =>
                    (!sField || seriesKeyOf(row[sField]) === seriesKeyOf(seriesVal)) && numOf(row[dCh.field]) === numOf(pos));
                const datum = { ...schemaDefaults(ctx.schema), ...(idx >= 0 ? data[idx] : {}) };
                if (sField) datum[sField] = seriesVal;
                datum[dCh.field] = pos;
                datum[vCh.field] = v;
                if (idx >= 0) data[idx] = datum; else data.push(datum);
            }
            return data;
        }
    });
}

/**
 * sweep — a drag that repaints the value of each point the pointer crosses.
 * An absolute `move` with `pick: 'sweep'`.
 * @param {import('../types').MoveOptions} [options]
 * @returns {import('../types').Edit}
 */
export function sweep(options = {}) {
    // The sweep driver sets no grab anchor, so only absolute mode works.
    if (options.mode === 'relative') {
        warn(
            'sweep:relative',
            'edit.line.sweep({ mode: "relative" }) is not a mode a sweep has — the pointer\'s ' +
            'POSITION is the value it paints. Ignoring mode.'
        );
        options = { ...options, mode: 'absolute' };
    }
    // A scoped edit's type is its dotted path, so drivers that claim `move` skip it.
    return move(/** @type {any} */ ({ pick: 'sweep', guide: true, scope: 'line', ...options, type: 'line.sweep' }));
}

/**
 * removeSeries — delete every row in the target datum's series.
 *   gesture : default 'click'; split with `when` if another click edit shares the mark.
 * @param {import('../types').AnchorOptions} [options]
 * @returns {import('../types').Edit}
 */
export function removeSeries(options = {}) {
    const { series: seriesField, ...rest } = options;
    return makeEdit({
        type: 'line.removeSeries',
        gesture: 'click',
        scope: 'line',
        cardinality: 'delete',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (ctx.datum == null) return undefined; // no target resolved
            const sField = seriesField || ctx.seriesKey || null;
            // No series field: delete just the targeted row.
            if (!sField) return ctx.data.filter((_, i) => i !== ctx.index);
            const key = seriesKeyOf(ctx.datum[sField]);
            return ctx.data.filter((d) => seriesKeyOf(d[sField]) !== key);
        }
    });
}
