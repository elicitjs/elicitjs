// @ts-check
// track — a value drawn as a length along a route (Du Bois's wrapped bars, a
// coil, a spiral). The route is the `path` option: an SVG path, or a function of
// the row returning one. Each `M` starts a lane; only lanes hold value, and
// `join` draws what connects them ('round' | 'straight' | 'none').
//
// The `length` channel is the fraction of the route drawn: its scale's range is
// [0, 1], so the schema domain spans the whole route. With no `length` channel
// the whole route is drawn.
//
// The path is in plot pixels. When x, y or size is bound, it is in unit form
// instead and placed the way `shape` places one (centre, radius, angle).
//
// Each row draws two nodes: an invisible hit path over the whole route, so a
// bar at zero can still be grabbed, and the bar. Both stamp `track` (the route
// as plain data) for `move` to invert the pointer through.
import { encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, positionalKeys, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { unitShape, placeShape } from './shapes.js';
import { routeOf, alongRoute, pathOfLines } from './trackGeometry.js';
import { HIT_WIDTH } from './hitpath.js';

const JOINS = ['round', 'straight', 'none'];

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function track(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'track', allow: MARK_OPTIONS.track });
    const { channels = {}, path, join: joinOpt = 'none' } = opts;
    const placed = !!(channels.x || channels.y || channels.size);

    if (path == null) {
        warn('track:path', 'track() has no `path`, so it has no route to draw. Pass an SVG path, or a function of the row returning one.');
    }
    let join = joinOpt;
    if (!JOINS.includes(join)) {
        warn(`track:join:${join}`, `track({ join: "${join}" }) is not one of ${JOINS.join(', ')}; using "none".`);
        join = 'none';
    }
    if (channels.fill) {
        warn('track:fill', 'track() draws a stroke along its route and never fills it, so its `fill` channel does nothing. Colour the bar with `stroke`.');
    }
    if (channels.angle && !placed) {
        warn('track:angle', 'track() turns its path by `angle` only when x, y or size places it. A path in plot pixels is drawn as written.');
    }

    /**
     * The route of one row, in pixels.
     * @param {any} d @param {number} i @param {any[]} rows
     * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
     */
    const routeFor = (d, i, rows, scales, width, height) => {
        const spec = typeof path === 'function' ? path(d, i, rows) : path;
        if (spec == null) return null;
        let pathD = String(spec);
        if (placed) {
            const unit = unitShape(pathD);
            if (unit) {
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, rows);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, rows);
                const r = Math.max(0, +encodeChannel(scales, channels, 'size', d, 6, i, rows) || 0);
                const angle = encodeAngle(scales, channels, 'angle', d, 0, i, rows);
                pathD = placeShape(unit, cx, cy, r, angle || 0).d;
            }
        }
        const route = routeOf(pathD);
        if (!route) {
            warn(
                `track:path:unparsed:${pathD.slice(0, 24)}`,
                `track(): "${pathD.slice(0, 40)}" is not an SVG path this mark can read; the row draws nothing.`
            );
        }
        return route;
    };

    return {
        ...markCommon(opts),
        type: 'track',
        channels,
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            const defaults = markDefaults(scales, 'track', { stroke: themeOf(scales).ink, strokeWidth: 2 });
            /** @type {import('../types').FeatureNode[][]} */
            const rows = [];
            currentData.forEach((d, i) => {
                if (placed && (missingValue(channels, 'x', d) || missingValue(channels, 'y', d))) return;
                // A row with no value draws no bar, but its route can still be grabbed.
                const empty = missingValue(channels, 'length', d);
                const route = routeFor(d, i, currentData, scales, width, height);
                if (!route) return;
                const style = resolveStyle(scales, channels, d, defaults, i, currentData);
                const fraction = empty ? 0 : +encodeChannel(scales, channels, 'length', d, 1, i, currentData);
                const bar = alongRoute(route, Number.isFinite(fraction) ? fraction : 0, /** @type {any} */ (join));
                const whole = alongRoute(route, 1, join === 'none' ? 'straight' : /** @type {any} */ (join));
                const barPoints = bar.flat();
                const barD = pathOfLines(bar);

                // The route's centre, steady while the bar grows.
                const all = whole.flat();
                const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
                const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
                const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
                const grab = Math.max(HIT_WIDTH, +style.strokeWidth || 0);
                const trackData = { lanes: route.lanes.map((l) => l.pts), total: route.total, slack: grab };

                rows.push([
                    {
                        type: 'path',
                        points: whole[0],
                        curve: 'linear',
                        stroke: 'transparent',
                        strokeWidth: grab,
                        fill: 'none',
                        hit: true,
                        cx, cy,
                        track: trackData,
                        // A hover outline traces the bar, not this wide path.
                        effectShape: { type: 'path', d: barD, points: barPoints, strokeWidth: style.strokeWidth },
                        data: d,
                        index: i,
                    },
                    {
                        type: 'path',
                        d: barD,
                        points: barPoints,
                        ...style,
                        fill: 'none',
                        cx, cy,
                        track: trackData,
                        data: d,
                        index: i,
                    },
                ]);
            });
            // Every hit path beneath every bar: routes may overlap other rows'
            // bars (nested spirals, lanes that run under the next row).
            return [...rows.map((r) => r[0]), ...rows.map((r) => r[1])];
        },
    };
}
