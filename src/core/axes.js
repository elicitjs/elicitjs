// @ts-check
// axes.js — the IMPLICIT layer of the Observable-Plot axis model: resolve the
// global `axes` convenience into composable axis/grid marks. Kept out of the
// engine so elicit.js stays setup + render loop.

import { axis, axisX, axisY, gridX, gridY, GRID_OPTIONS } from '../plot/axis.js';

/**
 * The subset of an axis config a GRID reads. `axes: { y: { grid: true, ticks: 8,
 * title: '…' } }` is one config describing both, so forwarding it wholesale would
 * hand the grid `title`/`anchor`/`tickFormat` — options it does not read, which its
 * option validation would (correctly) report as unknown.
 * @param {any} opts
 * @returns {any}
 */
function gridOptionsOf(opts) {
    /** @type {any} */
    const out = {};
    for (const key of GRID_OPTIONS) {
        if (opts[key] !== undefined) out[key] = opts[key];
    }
    return out;
}

/**
 * Flatten nested feature arrays (composite / a mark that returns parts) so
 * capability flags like `isAxis` / `isTrend` are visible to autoAxes.
 * @param {any[]} features
 * @returns {any[]}
 */
function flattenFeatures(features) {
    return /** @type {any[]} */ (features || []).flat(Infinity).filter(
        (f) => f && typeof f === 'object'
    );
}

/**
 * Origin-crossing transforms for a trend chart: pin each axis to 0 on the other
 * scale. Falls back to no override when 0 isn't encodable (e.g. missing scale).
 * @param {'x' | 'y'} ch
 * @returns {(ctx: any) => { x?: number, y?: number }}
 */
function originTransform(ch) {
    return ({ scales }) => {
        if (ch === 'x') {
            const yScale = scales.y;
            if (!yScale) return {};
            const y = typeof yScale.encode === 'function' ? yScale.encode(0) : yScale(0);
            return y != null && !Number.isNaN(Number(y)) ? { y: Number(y) } : {};
        }
        const xScale = scales.x;
        if (!xScale) return {};
        const x = typeof xScale.encode === 'function' ? xScale.encode(0) : xScale(0);
        return x != null && !Number.isNaN(Number(x)) ? { x: Number(x) } : {};
    };
}

/**
 * Resolve the global `axes` convenience into composable axis/grid marks. Only
 * channels the user did not already compose an explicit axis mark for are
 * auto-injected, so an explicit `axisX(...)` in `features` always wins. `axesOpt`:
 *   undefined -> default axis on both positional channels; when a trend mark is
 *                present, axes cross at the origin (intercept/slope frame)
 *   false     -> no axes at all
 *   { x, y, origin } -> per-channel config object (`false` suppresses a channel),
 *                plus `origin` to STATE the frame explicitly rather than let it
 *                follow from which marks happen to be present.
 *
 * `origin` is the escape hatch for that inference: `true` forces the
 * origin-crossing frame (useful beyond trend — any chart whose domains span
 * zero on both axes), `false` forces the ordinary left/bottom frame even
 * alongside a `trend`/`trendBand` mark. Left unset, the default above still
 * applies, so every existing spec that never mentions `axes` is unaffected.
 * @param {any[]} features
 * @param {any} axesOpt
 * @returns {any[]} the axis/grid marks to prepend (drawn behind marks)
 */
export function autoAxes(features, axesOpt) {
    if (axesOpt === false) return [];
    const flat = flattenFeatures(features);
    const origin = axesOpt && typeof axesOpt === 'object' ? axesOpt.origin : undefined;
    // Trend's natural frame is axes through the origin. An explicit `origin` wins
    // outright; otherwise it's inferred, and only when `axes` was left unspecified
    // — any other explicit axes:{} always wins.
    const originCross = origin === true
        || (origin === undefined && axesOpt == null && flat.some((f) => f.isTrend));
    /** @type {any[]} */
    const injected = [];
    /** @param {string} ch */
    const hasExplicit = (ch) => flat.some((f) => (f.isAxis || f.isGrid) && f.channel === ch);
    const builders = { x: { axis: axisX, grid: gridX }, y: { axis: axisY, grid: gridY } };
    // A count axis, only when asked for. It draws on the screen side the counting
    // mark stacks along, which the mark itself declares.
    if (axesOpt && axesOpt.count && !hasExplicit('count')) {
        const counter = flat.find((f) => f.countAxis);
        if (counter) {
            const cfg = axesOpt.count === true ? {} : { ...axesOpt.count };
            // Built through `axis` directly, not axisX/axisY: those pin `channel`
            // AFTER the spread, so they would overwrite 'count' with 'x'/'y'. The
            // anchor is what carries the direction here.
            injected.push(axis({
                anchor: counter.countAxis === 'x' ? 'bottom' : 'left',
                ...cfg,
                channel: 'count',
            }));
        }
    }
    for (const ch of /** @type {const} */ (['x', 'y'])) {
        const cfg = axesOpt ? axesOpt[ch] : undefined;
        if (cfg === false) continue;           // channel suppressed
        if (hasExplicit(ch)) continue;         // user composed their own
        /** @type {any} */
        const opts = cfg ? { ...cfg } : {};
        if (originCross && opts.transform == null) {
            opts.transform = originTransform(ch);
        }
        injected.push(builders[ch].axis(opts));
        if (opts.grid) injected.push(builders[ch].grid(gridOptionsOf(opts)));
    }
    return injected;
}
