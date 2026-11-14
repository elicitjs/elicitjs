// @ts-check
// needle.js — a pivoted pointer (a gauge or dial). The value is on the `theta`
// channel; the sweep is the theta scale's range. Draws a tapered outline plus a
// hub handle about a pivot.
//
//   needle({
//     length: 100,
//     channels: {
//       theta: { field: 'n', scale: { range: [180, 0] },
//                edit: rotate({ pivot: 'mark' }) },
//       fill: { value: '#c00' },
//     },
//   })
//
// The pivot defaults to the plot centre; x/y channels place it. `length` (or the
// `size` channel) sets the length. `handles: false` emits no hub.
// arc/orient/start/end and an `angle` channel do nothing here and warn.

import { encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions, markDefaults, resolveHandles, markCommon, missingValue } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { needleTriangle, polarToXY } from './polar.js';

/**
 * The needle's outline: the tapered triangle, or — with a tip width — the
 * quadrilateral running from the base's width to the tip's.
 * @param {number} cx @param {number} cy @param {number} len @param {number} deg
 * @param {number} baseWidth @param {number} tipWidth
 * @returns {[number, number][]}
 */
function needleOutline(cx, cy, len, deg, baseWidth, tipWidth) {
    if (!(tipWidth > 0)) return needleTriangle(cx, cy, len, deg, baseWidth);
    const tip = polarToXY(cx, cy, len, deg);
    /** @type {(x: number, y: number, half: number, side: number) => [number, number]} */
    const off = (x, y, half, side) => {
        const p = polarToXY(x, y, half, deg + side);
        return [p.x, p.y];
    };
    return [
        off(tip.x, tip.y, tipWidth / 2, 90),
        off(cx, cy, baseWidth / 2, 90),
        off(cx, cy, baseWidth / 2, -90),
        off(tip.x, tip.y, tipWidth / 2, -90),
    ];
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function needle(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'needle', allow: MARK_OPTIONS.needle });
    // The sweep is the theta scale's range, so span options do nothing.
    for (const dead of ['arc', 'orient', 'start', 'end']) {
        if (options && options[dead] !== undefined) {
            warn(
                `needle:span:${dead}`,
                `needle({ ${dead}: … }) does nothing: a needle's sweep is the theta scale's ` +
                `range. Set it on the channel — channels: { theta: { field, scale: { range: ` +
                `[180, 0] } } } — or chart-wide with scales: { theta: { range } }; axisRadial ` +
                `takes arc/orient/start/end for the chrome.`
            );
        }
    }
    // The direction is `theta`. `angle` is accepted on every mark but this one
    // ignores it, so warn instead of pointing at 0° silently.
    if (opts.channels && opts.channels.angle && !opts.channels.theta) {
        warn(
            'needle:angle',
            'needle({ channels: { angle: … } }) — a needle\'s direction is `theta`, the '
            + 'polar angular POSITION (what axisRadial draws). `angle` is a mark\'s '
            + 'rotation in place and this mark does not read it, so the needle would '
            + 'point at 0°. Rename the channel to `theta`.'
        );
    }
    const {
        channels = {},
        length: lengthOpt,
        // The hub is the handle.
        handles = true,
        handleSize,
        handleColor,
        baseWidth = 10,
        // 0 tapers to a point; equal to baseWidth draws an even bar.
        tipWidth = 0,
    } = opts;

    // The value is `theta`; x/y only place the pivot.
    const thetaField = channels.theta && channels.theta.field;
    const xField = channels.x && channels.x.field;
    const yField = channels.y && channels.y.field;

    return {
        ...markCommon(opts),
        type: 'needle',
        channels,
        discreteScale: 'point',
        xKey: xField || thetaField,
        yKey: yField || thetaField,
        /**
         * @param {any[]} currentData
         * @param {any} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });

            currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                // No needle for a row missing its bearing or a bound pivot position.
                if (['theta', 'x', 'y'].some((c) => missingValue(channels, c, d))) return;
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                // Scaled theta inverts under rotate(); unscaled reads as raw degrees.
                const deg = encodeAngle(scales, channels, 'theta', d, 0, i, currentData);
                const len = lengthOpt != null
                    ? lengthOpt
                    : encodeChannel(scales, channels, 'size', d, Math.min(width, height) * 0.4, i, currentData);
                const style = resolveStyle(scales, channels, d,
                    markDefaults(scales, 'needle', { fill: '#1e293b', stroke: '#1e293b', strokeWidth: 1 }), i, currentData);
                const pts = needleOutline(cx, cy, len, deg, baseWidth, tipWidth);
                const dPath = `M ${pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')} Z`;

                nodes.push({
                    type: 'path',
                    d: dPath,
                    // The outline, so a geometric pick (canvas, tips) can hit the body.
                    points: pts,
                    polygon: true,
                    ...style,
                    cx, cy,
                    data: d,
                    index: i,
                    cursor: handleStyle.grabbable ? 'grab' : undefined,
                });

                // The hub: none for `handles: false`; invisible for 'hit'.
                if (handleStyle.grabbable) {
                    nodes.push({
                        type: 'circle',
                        cx, cy,
                        r: handleStyle.size,
                        fill: handleStyle.fill,
                        stroke: handleStyle.stroke,
                        strokeWidth: handleStyle.strokeWidth,
                        data: d,
                        index: i,
                        cursor: 'grab',
                    });
                }
            });

            return nodes;
        },
    };
}
