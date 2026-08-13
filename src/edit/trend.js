// @ts-check
// trend.js — the TREND-scoped edits (scope 'trend'). A parametric line has no
// per-datum handle the way a bar does: the belief is `{ intercept, slope }` and the
// gesture names one of those PARAMETERS, so every edit here inverts the pointer
// through the x/y scales and then solves for the parameter it owns.
//
// Namespaced under `edit.trend.*` (mirroring `edit.line.*` / `edit.arc.*`) so the
// scope shows in the name. They need a `trend` or `trendBand` mark — the engine
// dev-warns via SCOPE_CAPABILITY when they land anywhere else.
//
//   intercept       translate: hold the slope, put the line's value at `anchor`
//                   under the pointer.
//   slope           rotate about the anchor POINT: hold its value, pass the line
//                   through the pointer.
//   interceptSpread the band's half-width at the anchor — the vertical gap between
//                   the pointer and the line there.
//   slopeSpread     the band's half-width in slope units — how far the line through
//                   the pointer tilts away from the committed one. This is the
//                   "open the cone" gesture, stated in slope space rather than
//                   degrees (it is the slope-space sibling of rotate({ relativeTo })).
//
// ── Where the gesture measures from ─────────────────────────────────────────
// The two rotational edits need a second x besides the anchor, and the handle that
// was grabbed says which. A handle mounted on the line's own END (`grip: 'end'`, the
// mark default) rotates: the x is the POINTER's, so the line passes through the
// cursor and swings through the full circle. A handle PINNED to a column
// (`grip: 'probe'`) slides vertically at its own `probe`, capping the reachable
// slope at `ySpan / (probe - anchor)` — which is why it is no longer the default.
// When there is no node at all — a plane or probe pick, where the pointer roams
// free — it is the pointer's own x for the same reason. That last case is what
// makes the classic two-step elicitation work ("move to aim, click to set"): under
// `pick: 'probe'` there is no node to read a channel tag off, so an edit that
// insisted on one could never fire.
//
// A grip that reads the pointer's position outright would normally teleport its
// mark on grab (the reason `slide` and `move` default to relative). It doesn't here,
// because an end-mounted handle already sits ON the line: the pointer that presses
// it is already a point the line passes through.
//
// ── Vertical ───────────────────────────────────────────────────────────────
// A vertical line has no slope, so a ROTATION holds while the pointer is inside the
// pivot's own pixel column rather than writing an astronomical magnitude. The
// translational edits are unaffected — an intercept drag runs straight up that very
// column, which is why the frame reports "no probe x" rather than refusing to build.
// (Writing ±Infinity would be worse than useless: readParams' finite check would
// snap the line to slope 0, and JSON.stringify turns it into null.) The slope still
// grows without bound as the pointer approaches that column; bound it the declared
// way, with `clamp({ field: 'slope', min, max })` in `spec.constraints`.
//
// ── What gets written ───────────────────────────────────────────────────────
// Field names come from the mark's channel map, never from literals: an edit ends
// in `datum[field] = value`, and the field is whatever `channels.slope.field` says.
// A parameter with no field (a PINNED one, `intercept: { datum: 0 }`) is simply not
// written — which is how a correlation belief keeps its intercept at the origin
// without a constraint having to put it back.

import { makeEdit, claimEdge } from './shared.js';
import { anchorsOf, valueAt } from '../plot/trendGeometry.js';

// How close, in PIXELS, the pointer may come to the pivot's column before the line
// counts as vertical and the gesture holds. Stated in pixels rather than data units
// because it is a property of the GESTURE's precision, not of the field: one screen
// pixel means the same thing on every domain, where a data-unit epsilon would have
// to be re-tuned per chart.
const VERTICAL_EPS_PX = 1;

/**
 * The column a parameter channel names, or null when the channel is pinned to a
 * constant / absent (nothing to write).
 * @param {import('../types').EditContext} ctx
 * @param {string} name
 * @returns {string | null}
 */
function fieldOf(ctx, name) {
    const spec = ctx.markChannels && ctx.markChannels[name];
    return spec && spec.field != null ? spec.field : null;
}

/** @param {import('../types').EditContext} ctx @param {string} name @param {number} fallback */
function paramOf(ctx, name, fallback) {
    const spec = ctx.markChannels && ctx.markChannels[name];
    if (!spec) return fallback;
    if (spec.field != null) {
        const v = ctx.datum ? Number(ctx.datum[spec.field]) : NaN;
        return Number.isFinite(v) ? v : fallback;
    }
    const constant = Number(spec.datum !== undefined ? spec.datum : spec.value);
    return Number.isFinite(constant) ? constant : fallback;
}

/**
 * The shared frame every trend edit solves in: the two scales, the anchor point's
 * current value, and the (x, y) the pointer names in data units. Returns null when
 * the gesture can't be inverted at all — a non-invertible y axis.
 *
 * `probeX` is the second x a ROTATION measures against, and it is null when there
 * isn't one: no invertible x axis, or a pointer inside the pivot's own column, where
 * the line is vertical and the slope undefined. Null rather than a bail, because the
 * translational edits solve perfectly well without it — an intercept drag runs
 * straight UP the anchor's column, so a frame-wide bail silently killed exactly the
 * gesture it was meant to leave alone.
 * @param {import('../types').EditContext} ctx
 * @param {{ anchor?: number, probe?: number }} opts
 * @returns {{ a: number, b: number, anchor: number, probeX: number | null, yv: number, yAnchor: number } | null}
 */
function frameOf(ctx, opts) {
    const xScale = ctx.scales.x;
    const yScale = ctx.scales.y;
    if (!yScale || !yScale.invertible) return null;

    // A grabbed handle carries the anchor/probe of the MARK that drew it, so the
    // pivot is always the point the handle is actually sitting on. The edit's own
    // options are the override (and the only source when there is no node — a plane
    // or probe pick). Before this, an author who moved a trend's `anchor` had to
    // repeat it on both edits or the line would pivot somewhere the handle wasn't.
    const fromNode = ctx.node
        ? { anchor: ctx.node.anchor, probe: ctx.node.probe }
        : {};
    const { anchor, probe } = anchorsOf(ctx.scales, {
        anchor: opts.anchor != null ? opts.anchor : fromNode.anchor,
        probe: opts.probe != null ? opts.probe : fromNode.probe,
    });
    const a = paramOf(ctx, 'intercept', 0);
    const b = paramOf(ctx, 'slope', 0);

    // A PINNED handle (grip: 'probe') pivots about its own probe x. An end-mounted
    // one — and a free pointer under a plane/probe pick — uses the pointer's own, so
    // the line follows the cursor and can be swung right round.
    const pinned = ctx.node && ctx.node.grip === 'probe';
    /** @type {number | null} */
    let probeX = probe;
    if (!pinned) {
        probeX = (xScale && xScale.invertible)
            ? Number(xScale.invertValue(ctx.pointer.x))
            : null;
    }
    if (probeX != null && !Number.isFinite(probeX)) probeX = null;
    // Inside the pivot's own column the line is vertical and the slope is undefined,
    // so a rotation holds. Measured in pixels: an exact `probeX === anchor` test
    // never fires on inverted floats, which let a hair's-breadth denominator write a
    // slope in the millions.
    if (probeX != null) {
        const gapPx = (xScale && xScale.encode)
            ? Math.abs(Number(xScale.encode(probeX)) - Number(xScale.encode(anchor)))
            // No x scale to measure the column in (a pinned grip on a chart that
            // never resolved one) — all that is left is the exact degenerate case.
            : (probeX === anchor ? 0 : Infinity);
        if (!(gapPx >= VERTICAL_EPS_PX)) probeX = null;
    }

    return { a, b, anchor, probeX, yv: Number(yScale.invertValue(ctx.pointer.y)), yAnchor: valueAt({ a, b }, anchor) };
}

/**
 * Write a partial onto the touched datum, or onto every row when the gesture
 * carries none (a plane pick has no index). Keys whose field is null — a pinned
 * parameter — are dropped rather than written to `undefined`.
 * @param {import('../types').EditContext} ctx
 * @param {Record<string, number>} byChannel channel name -> value
 * @returns {any}
 */
function writeParams(ctx, byChannel) {
    /** @type {Record<string, number>} */
    const patch = {};
    let any = false;
    for (const [name, value] of Object.entries(byChannel)) {
        const field = fieldOf(ctx, name);
        if (field == null || !Number.isFinite(value)) continue;
        patch[field] = value;
        any = true;
    }
    if (!any) return undefined;
    if (ctx.datum) return { ...ctx.datum, ...patch };
    if (!ctx.data.length) return undefined;
    return ctx.data.map((d) => ({ ...d, ...patch }));
}

/**
 * Build one trend edit: the scope, the handle tag it claims, and its solve.
 * @param {string} type
 * @param {string} claims the `channel` tag on the handle this edit owns
 * @param {(frame: NonNullable<ReturnType<typeof frameOf>>, ctx: import('../types').EditContext) => Record<string, number> | undefined} solve
 * @param {any} options
 * @returns {import('../types').Edit}
 */
function trendEdit(type, claims, solve, options) {
    const { anchor, probe, ...rest } = options || {};
    return claimEdge(makeEdit({
        type,
        gesture: 'drag',
        pick: 'direct',
        scope: 'trend',
        channels: [claims],
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const frame = frameOf(ctx, { anchor, probe });
            if (!frame) return undefined;
            const out = solve(frame, ctx);
            return out ? writeParams(ctx, out) : undefined;
        }
    }), claims);
}

/**
 * edit.trend.intercept — translate the line. Holds the slope and puts the line's
 * value at `anchor` under the pointer, so with the default anchor of 0 this is the
 * classic "drag the y-intercept".
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function intercept(options = {}) {
    return trendEdit('trendIntercept', 'intercept',
        (f) => ({ intercept: f.yv - f.b * f.anchor }), options);
}

/**
 * edit.trend.slope — rotate the line about the anchor POINT. The anchor's value is
 * held and the line is passed through the pointer, so the intercept is recomputed
 * to keep the pivot fixed. (When the intercept is pinned the recomputed value is
 * the pinned one, and `writeParams` drops it.)
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function slope(options = {}) {
    return trendEdit('trendSlope', 'slope', (f) => {
        if (f.probeX == null) return undefined;
        const b = (f.yv - f.yAnchor) / (f.probeX - f.anchor);
        return { slope: b, intercept: f.yAnchor - b * f.anchor };
    }, options);
}

/**
 * edit.trend.interceptSpread — open the band vertically. The half-width is the gap
 * between the pointer and the line AT THE ANCHOR, so the band edge sits under the
 * cursor when the pointer is over the pivot.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function interceptSpread(options = {}) {
    return trendEdit('trendInterceptSpread', 'interceptSpread',
        (f) => ({ interceptSpread: Math.abs(f.yv - f.yAnchor) }), options);
}

/**
 * edit.trend.slopeSpread — open the band angularly ("open the cone"). The
 * half-width, in slope units, is how far the line through the pointer tilts away
 * from the committed one — so the edge of the fan is exactly the line the reader
 * pointed at.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function slopeSpread(options = {}) {
    return trendEdit('trendSlopeSpread', 'slopeSpread', (f) => {
        if (f.probeX == null) return undefined;
        const through = (f.yv - f.yAnchor) / (f.probeX - f.anchor);
        return { slopeSpread: Math.abs(through - f.b) };
    }, options);
}
