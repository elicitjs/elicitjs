// @ts-check
// trend.js — edits on a `trend` / `trendBand` mark (scope 'trend'). Each inverts
// the pointer through the x/y scales and solves for one line parameter:
//   intercept       hold the slope; put the line's value at `anchor` under the pointer.
//   slope           rotate about the anchor point through the pointer.
//   interceptSpread band half-width: vertical gap from the line at the anchor.
//   slopeSpread     band half-width in slope units: tilt of the line through the pointer.
//
// Rotations measure against the pointer's x, except a `grip: 'probe'` handle, which
// uses its own probe x. Within VERTICAL_EPS_PX of the pivot column a rotation holds.
// A pinned parameter (no field) is never written.

import { makeEdit, claimEdge } from './shared.js';
import { anchorsOf, valueAt } from '../plot/trendGeometry.js';

// Pixel distance from the pivot column within which the line counts as vertical.
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
 * The frame every trend edit solves in: current params, the anchor and its value,
 * and the pointer in data units. Null when the y axis can't invert.
 *
 * `probeX` is the second x a rotation measures against; null when there is no
 * invertible x axis or the line would be vertical. Translations ignore it.
 * @param {import('../types').EditContext} ctx
 * @param {{ anchor?: number, probe?: number }} opts
 * @returns {{ a: number, b: number, anchor: number, probeX: number | null, yv: number, yAnchor: number } | null}
 */
function frameOf(ctx, opts) {
    const xScale = ctx.scales.x;
    const yScale = ctx.scales.y;
    if (!yScale || !yScale.invertible) return null;

    // Anchor/probe from the edit's options, else from the grabbed handle.
    const fromNode = ctx.node
        ? { anchor: ctx.node.anchor, probe: ctx.node.probe }
        : {};
    const { anchor, probe } = anchorsOf(ctx.scales, {
        anchor: opts.anchor != null ? opts.anchor : fromNode.anchor,
        probe: opts.probe != null ? opts.probe : fromNode.probe,
    });
    const a = paramOf(ctx, 'intercept', 0);
    const b = paramOf(ctx, 'slope', 0);

    // A `grip: 'probe'` handle uses its probe x; otherwise the pointer's x.
    const pinned = ctx.node && ctx.node.grip === 'probe';
    /** @type {number | null} */
    let probeX = probe;
    if (!pinned) {
        probeX = (xScale && xScale.invertible)
            ? Number(xScale.invertValue(ctx.pointer.x))
            : null;
    }
    if (probeX != null && !Number.isFinite(probeX)) probeX = null;
    // Within VERTICAL_EPS_PX of the pivot column, measured in pixels, a rotation holds.
    if (probeX != null) {
        const gapPx = (xScale && xScale.encode)
            ? Math.abs(Number(xScale.encode(probeX)) - Number(xScale.encode(anchor)))
            // No x scale: only the exact case counts.
            : (probeX === anchor ? 0 : Infinity);
        if (!(gapPx >= VERTICAL_EPS_PX)) probeX = null;
    }

    return { a, b, anchor, probeX, yv: Number(yScale.invertValue(ctx.pointer.y)), yAnchor: valueAt({ a, b }, anchor) };
}

/**
 * Write a partial onto the touched datum, or onto every row when there is none.
 * A pinned parameter (no field) is skipped.
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
 * edit.trend.intercept — translate the line: hold the slope and put the line's
 * value at `anchor` under the pointer.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function intercept(options = {}) {
    return trendEdit('trend.intercept', 'intercept',
        (f) => ({ intercept: f.yv - f.b * f.anchor }), options);
}

/**
 * edit.trend.slope — rotate the line about the anchor point through the pointer;
 * the intercept is recomputed to keep the pivot fixed.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function slope(options = {}) {
    return trendEdit('trend.slope', 'slope', (f) => {
        if (f.probeX == null) return undefined;
        const b = (f.yv - f.yAnchor) / (f.probeX - f.anchor);
        return { slope: b, intercept: f.yAnchor - b * f.anchor };
    }, options);
}

/**
 * edit.trend.interceptSpread — band half-width: the vertical gap between the
 * pointer and the line at the anchor.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function interceptSpread(options = {}) {
    return trendEdit('trend.interceptSpread', 'interceptSpread',
        (f) => ({ interceptSpread: Math.abs(f.yv - f.yAnchor) }), options);
}

/**
 * edit.trend.slopeSpread — band half-width in slope units: how far the line
 * through the pointer tilts from the committed one.
 * @param {import('../types').TrendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function slopeSpread(options = {}) {
    return trendEdit('trend.slopeSpread', 'slopeSpread', (f) => {
        if (f.probeX == null) return undefined;
        const through = (f.yv - f.yAnchor) / (f.probeX - f.anchor);
        return { slopeSpread: Math.abs(through - f.b) };
    }, options);
}
