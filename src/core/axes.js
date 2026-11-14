// @ts-check
// axes.js — the implicit `axes` layer: turns the global `axes` option into axis/grid marks.

import { axis, axisX, axisY, gridX, gridY, GRID_OPTIONS } from '../plot/axis.js';

/**
 * The subset of an axis config a grid reads (a grid warns on axis-only options like `title`).
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
export function flattenFeatures(features) {
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
    // An x axis is pinned on y, and a y axis on x.
    const other = ch === 'x' ? 'y' : 'x';
    return ({ scales }) => {
        const scale = scales[other];
        if (!scale) return {};
        const at = scale.encode(0);
        return at != null && !Number.isNaN(Number(at)) ? { [other]: Number(at) } : {};
    };
}

/**
 * Resolve the global `axes` option into axis/grid marks for each channel with no
 * explicit axis mark. `axesOpt`:
 *   undefined -> both axes, crossing at the origin when a trend mark is present
 *   false     -> no axes
 *   { x, y, count, origin } -> per-channel config (`false` suppresses one);
 *                `origin: true | false` forces the origin-crossing frame on or off.
 * A theme grid (`theme.grid.show` / `theme.grid.zero`) gives each implicit axis an `auto` grid.
 * @param {any[]} features
 * @param {any} axesOpt
 * @param {any} [theme] the resolved theme
 * @returns {any[]} the axis/grid marks to prepend (drawn behind marks)
 */
export function autoAxes(features, axesOpt, theme) {
    if (axesOpt === false) return [];
    const flat = flattenFeatures(features);
    const origin = axesOpt && typeof axesOpt === 'object' ? axesOpt.origin : undefined;
    // An explicit `origin` wins; otherwise origin crossing is inferred from a trend
    // mark, only when `axes` is unset.
    const originCross = origin === true
        || (origin === undefined && axesOpt == null && flat.some((f) => f.isTrend));
    /** @type {any[]} */
    const injected = [];
    // Grids go first so spines and ticks paint over them.
    /** @type {any[]} */
    const grids = [];
    /** @param {string} ch */
    const hasExplicit = (ch) => flat.some((f) => (f.isAxis || f.isGrid) && f.channel === ch);
    const builders = { x: { axis: axisX, grid: gridX }, y: { axis: axisY, grid: gridY } };
    const themeGrid = theme && theme.grid;
    const themeWantsGrid = !!themeGrid && ((themeGrid.show && themeGrid.show !== 'none') || !!themeGrid.zero);
    // A count axis, only when asked for, on the side the counting mark declares.
    if (axesOpt && axesOpt.count && !hasExplicit('count')) {
        const counter = flat.find((f) => f.countAxis);
        if (counter) {
            const cfg = axesOpt.count === true ? {} : { ...axesOpt.count };
            // Built through `axis`: axisX/axisY set `channel` after the spread and
            // would overwrite 'count'.
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
        // `grid: true` borrows the axis's tick options; `grid: { … }` adds its own
        // paint (`strokeDash`, `zero`, …) on top.
        if (opts.grid) grids.push(builders[ch].grid({ ...gridOptionsOf(opts), ...(typeof opts.grid === 'object' ? opts.grid : {}) }));
        else if (opts.grid === undefined && themeWantsGrid) {
            const themed = builders[ch].grid(opts.ticks !== undefined || opts.tickValues !== undefined
                ? { ...(opts.ticks !== undefined ? { ticks: opts.ticks } : {}), ...(opts.tickValues !== undefined ? { tickValues: opts.tickValues } : {}) }
                : {});
            themed.auto = true;
            grids.push(themed);
        }
    }
    return [...grids, ...injected];
}
