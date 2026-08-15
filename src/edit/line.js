// @ts-check
// line.js — the line-scoped edits: authoring and reshaping a connected path. They
// only make sense on a mark that groups points into series (the `line` family),
// so they are exposed under `edit.line.*` and tagged `scope: 'line'` (the engine
// dev-warns if one lands on a mark without series support).
//
//   anchor    — add ONE point to a line (click)
//   newSeries — seed a WHOLE flat line from sampled positions (dblclick)
//   draw      — author a line by dragging (drag), edit-aware
//   sweep     — you-draw-it: repaint each point the pointer crosses (drag)

import { makeEdit, schemaDefaults, nextSeriesKey, numOf, invertChannel, mintDatum } from './shared.js';
import { nearestSeries, nearestMark, nearestMarkOnAxis, resolveThreshold } from './pick.js';
import { resolveSamples } from '../core/samples.js';
import { move } from './basic.js';

/**
 * anchor — add ONE point to a connected path (a line's bezier-style anchor). The
 * inverse of `remove` for paths, and proximity-aware where `create` is not: it
 * resolves WHICH line the gesture means.
 *   into 'nearest' -> attach to the closest line within `threshold`; if none is
 *                     near (empty space) it falls back to starting a fresh series,
 *                     so repeated clicks draw a new line point-by-point, then extend
 *                     it (each later click is now near the line it just started).
 *   into 'new'     -> always start a fresh series.
 * The new point's series is written to the feature's series field; its position is
 * the inverted pointer on each positional channel (2D by default). Order is handled
 * by the mark's `order` (domain sort or as-drawn), so anchor just appends.
 * @param {import('../types').AnchorOptions} [options]
 * @returns {import('../types').Edit}
 */
export function anchor(options = {}) {
    const { into = 'nearest', series: seriesField, ...rest } = options;
    const threshold = resolveThreshold(options.threshold);
    return makeEdit({
        type: 'anchor',
        gesture: 'click',
        channels: ['x', 'y'],
        pick: 'plane',
        scope: 'line',
        into,
        // The appended point is the one the gesture placed.
        cardinality: 'append',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const sField = seriesField || ctx.seriesKey || null;
            // Resolve the target line: the nearest one, or a fresh series when
            // 'new' (or 'nearest' found none within threshold — empty space).
            let seriesVal = null;
            if (into === 'nearest') {
                seriesVal = nearestSeries(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, threshold);
                // Freehand line (order: 'sequence'): no nearby line, but one already
                // exists — extend THAT line (append in draw order) rather than spawning
                // a new series, so a far click keeps a single path. Domain lines, and
                // into:'new', still start a fresh series.
                if (seriesVal == null && ctx.order === 'sequence' && sField && (ctx.data || []).length) {
                    seriesVal = ctx.data[ctx.data.length - 1][sField];
                }
            }
            if (seriesVal == null) seriesVal = nextSeriesKey(ctx.data, sField);

            // Same minting core as `create`; anchor's only extra is the resolved
            // series. It goes in `defaults` (not `seed`): a series key is a grouping,
            // not a position, so it must NOT count as "placed" — the point still needs
            // a real inverted position from the channels to exist.
            const datum = mintDatum(ctx, { defaults: sField ? { [sField]: seriesVal } : {} });
            if (!datum) return undefined;
            return [...ctx.data, datum];
        }
    });
}

/**
 * newSeries — seed a WHOLE new line at once: one anchor per sampled domain
 * position (see resolveSamples: the scale's ticks by default, or a count / explicit
 * positions / time interval), each starting at the pointer's value on the value
 * axis (a flat line you then sweep into shape). This is the draw-from-scratch
 * primitive; pair it with `sweep` to then shape the seeded line.
 *   along / value  : the positional axes ("x"/"y"); the independent axis the line
 *                    runs ALONG, and the axis it carries a value on. Defaults x/y.
 *   samples        : passed to resolveSamples for the anchor domain positions.
 * @param {import('../types').NewSeriesOptions} [options]
 * @returns {import('../types').Edit}
 */
export function newSeries(options = {}) {
    const { along = 'x', value = 'y', samples, series: seriesField, ...rest } = options;
    return makeEdit({
        type: 'newSeries',
        gesture: 'dblclick',
        channels: [along, value],
        pick: 'plane',
        scope: 'line',
        // No `cardinality`: this seeds a WHOLE line (one row per sample), so there
        // is no single "row the gesture touched" for a constraint to hold fixed.
        // Same for `draw` below.
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const sField = seriesField || ctx.seriesKey || null;
            const domainField = (ctx.markChannels[along] && ctx.markChannels[along].field)
                || (along === 'x' ? ctx.xKey : ctx.yKey);
            const valueField = (ctx.markChannels[value] && ctx.markChannels[value].field)
                || (value === 'x' ? ctx.xKey : ctx.yKey);
            const domainScale = ctx.scales[along];
            const valueScale = ctx.scales[value];
            if (!domainScale || !domainField) return undefined;

            const positions = resolveSamples(domainScale, samples);
            if (!positions.length) return undefined;

            // Flat line at the clicked value (or the value-domain start if the
            // value axis can't invert here).
            const seedVisual = value === 'x' ? ctx.pointer.x : ctx.pointer.y;
            const seedValue = valueScale && valueScale.invertible
                ? valueScale.invertValue(seedVisual)
                : (valueScale && valueScale.domain ? valueScale.domain()[0] : null);
            const seriesVal = nextSeriesKey(ctx.data, sField);

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
 * draw — author lines by dragging, edit-aware: the missing corner of the creation
 * matrix (anchor = click one point, newSeries = dblclick a seeded line, draw = drag
 * a line). On dragstart it resolves proximity to existing lines and picks a mode for
 * the whole drag:
 *   near an existing line (within `threshold`) -> EDIT it (sweep): each drag event
 *       repaints the line the drag started nearest to — a domain line's value along
 *       its column, a freehand line's nearest point in 2D.
 *   in empty space (or `into: 'new'`)          -> DRAW a new line, laying points down
 *       as the pointer moves. It specializes by the line's `order`:
 *         order 'domain'   (lineY/lineX)          -> YOU-DRAW-IT FROM SCRATCH: the
 *             pointer crossing each `samples` column upserts that point at the
 *             pointer value, so one sweep draws the curve (re-cross to repaint).
 *         order 'sequence' (the `path` mark) -> FREEHAND: sample the pointer by
 *             pixel distance (`minDist`) and append points in creation order (a 2D
 *             path, e.g. a route over a map).
 * So one gesture both draws new lines and reshapes drawn ones — near edits, far draws.
 * The engine (draw driver) owns the per-drag lock; this apply reads it from
 * ctx.session (mode + locked series) and ctx.order.
 *   along / value  : the positional axes ("x"/"y"); the independent axis the line
 *                    runs ALONG, and the axis it carries a value on. Defaults x/y.
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
        type: 'draw',
        gesture: 'drag',
        channels: [along, value],
        pick: 'draw',
        scope: 'line',
        into,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const st = ctx.session;
            if (!st) return undefined; // engine sets the per-drag lock on dragstart
            const sField = seriesField || ctx.seriesKey || null;
            const seriesVal = st.drawSeries;
            const freehandLine = ctx.order === 'sequence';

            /** @type {Record<string, import('../types').ResolvedChannel>} */
            const byName = {};
            for (const c of ctx.channels) byName[c.name] = c;

            // EDIT MODE (drag started near an existing line): sweep that line. Grab
            // its nearest point — by column (domain axis) for a domain line, in 2D
            // for a freehand one — and rewrite it from the pointer. Locked to the
            // series so overlapping lines don't fight over the drag.
            if (st.mode === 'edit') {
                const idx = freehandLine
                    ? nearestMark(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, Infinity, seriesVal)
                    : nearestMarkOnAxis(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, Infinity, along, seriesVal);
                if (idx == null || ctx.data[idx] == null) return undefined;
                const datum = { ...ctx.data[idx] };
                for (const ch of ctx.channels) {
                    // A domain line keeps its column fixed — paint only the value axis;
                    // a freehand line moves the whole point (both axes).
                    if (!freehandLine && ch.name !== value) continue;
                    const v = invertChannel(ch, ctx.pointer);
                    if (v !== undefined) datum[ch.field] = v;
                }
                return ctx.data.map((d, i) => (i === idx ? datum : d));
            }

            // FREEHAND: append a pointer sample when it has moved far enough.
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

            // YOU-DRAW-IT: upsert the sample column(s) the pointer has crossed.
            const dCh = byName[along], vCh = byName[value];
            if (!dCh || !vCh || !dCh.scale || !vCh.scale
                || !dCh.scale.invertible || !vCh.scale.invertible) return undefined;
            const positions = resolveSamples(ctx.scales[along], samples);
            if (!positions.length) return undefined;

            const dCur = dCh.scale.invertValue(along === 'x' ? ctx.pointer.x : ctx.pointer.y);
            const v = vCh.scale.invertValue(value === 'x' ? ctx.pointer.x : ctx.pointer.y);

            // Which grid columns to fill: those between the previous pointer domain
            // and the current one (so a fast drag doesn't skip columns); on the first
            // event just the nearest column.
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
                    (!sField || row[sField] === seriesVal) && numOf(row[dCh.field]) === numOf(pos));
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
 * sweep — you-draw-it painting: a drag that repaints the value of each point the
 * pointer crosses (series-scoped in the engine). Convenience over `move`.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function sweep(options = {}) {
    return move({ pick: 'sweep', guide: true, scope: 'line', ...options });
}

/**
 * removeSeries — delete a WHOLE line at once: the series-scoped counterpart to
 * `remove` (which deletes one datum / anchor). The gesture resolves a target datum
 * the usual way (direct pick = the clicked handle, or pick:'nearest'), reads its
 * series key, and filters out every datum in that series — so clicking any point
 * on a line removes the entire line. Restores create/remove symmetry: anchor +
 * newSeries + draw build lines, remove + removeSeries take them apart.
 *   gesture : default 'click'; pair with `when` if another click edit shares
 *             the mark (e.g. remove one point vs the whole series).
 * @param {import('../types').AnchorOptions} [options]
 * @returns {import('../types').Edit}
 */
export function removeSeries(options = {}) {
    const { series: seriesField, ...rest } = options;
    return makeEdit({
        type: 'removeSeries',
        gesture: 'click',
        scope: 'line',
        // The rows are gone; nothing is active for a constraint to resolve around.
        cardinality: 'delete',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (ctx.datum == null) return undefined; // no target resolved
            const sField = seriesField || ctx.seriesKey || null;
            // No series field (a single-series line): fall back to deleting the
            // one targeted datum, so removeSeries never silently no-ops.
            if (!sField) return ctx.data.filter((_, i) => i !== ctx.index);
            const key = ctx.datum[sField];
            return ctx.data.filter((d) => d[sField] !== key);
        }
    });
}
