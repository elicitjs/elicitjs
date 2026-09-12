// @ts-check
// needle.js — a pivoted pointer (NYT-style gauge / software dial). Encodes a
// value on the `angle` channel (degrees via the channel's scale) and draws a
// tapered triangle + hub about a pivot. Pair with axisRadial for chrome and
// text for a center readout — compose via composite / features.
//
//   needle({
//     orient: 'top',         // default semi: left → right through the top
//     // orient: 'right' | 'bottom' | 'left', or arc: 'full', or start/end
//     length: 100,
//     channels: {
//       angle: { field: 'n', scale: { range: [180, 0] },
//                edit: rotate({ pivot: 'mark', fold: false, pick: 'direct' }) },
//       fill: { value: '#c00' },
//     },
//   })
//
// Pivot defaults to the plot centre; optional x/y channels place it on a
// categorical or linear axis (many small needles across a chart).
// discreteScale is 'point' so categorical fields land on ticks.
//
// Affordance map (pair with rotate({ pivot:'mark', pick:'direct' }) on angle):
//   tapered path + hub → the mark itself; hub is the shared-contract handle
//   handles: true|false|'hit' — false emits no hub and silences the path

import { encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions, markDefaults, resolveHandles, markCommon} from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { needleTriangle } from './polar.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function needle(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'needle', allow: MARK_OPTIONS.needle });
    // A needle's SPAN is its theta scale's RANGE — `[180, 0]` by default, the left
    // semicircle through the top. It used to accept arc/orient/start/end here too,
    // and computed a span it never applied: a scale is resolved by the engine, not
    // owned by a mark. Say where the knob actually is.
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
    // A needle's direction is `theta` — a POLAR POSITION, which is what axisRadial
    // draws and what a fan legend keys. `angle` is a mark's rotation in place, and
    // it is a universal style shorthand, so it reaches every mark: left unchecked, a
    // needle given `angle` would accept the channel, read nothing from it, and point
    // at 0° in silence. That is the exact failure this library treats as worst.
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
        id,
        edits,
        length: lengthOpt,
        // The hub is this needle's handle (the pivot you grab), so it takes the
        // library-wide sub-element radius name — `handleSize`, as on line/area/
        // trend/arc/face — not a per-mark synonym.
        handles = true,
        handleSize,
        handleColor,
        baseWidth = 10,
    } = opts;

    // The belief sits on `theta`; x/y only place the pivot. The keys used to be
    // derived from `angle` — the very channel the warning above says this mark
    // does not read — so with the documented spelling both were undefined.
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
            // Shared handle contract (plot/mark.js). The hub IS this mark's handle,
            // so it takes the same radius default and themed paint as every other.
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });

            currentData.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
                const cx = encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const cy = encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                // Through encodeAngle like every other angle-reading mark, so a scaled
                // angle field inverts exactly under rotate() and an unscaled one still
                // reads as raw degrees. (needle used to call encodeChannel directly —
                // the only mark that read this channel a different way.)
                const deg = encodeAngle(scales, channels, 'theta', d, 0, i, currentData);
                const len = lengthOpt != null
                    ? lengthOpt
                    : encodeChannel(scales, channels, 'size', d, Math.min(width, height) * 0.4, i, currentData);
                const style = resolveStyle(scales, channels, d,
                    markDefaults(scales, 'needle', { fill: '#1e293b', stroke: '#1e293b', strokeWidth: 1 }), i, currentData);
                const pts = needleTriangle(cx, cy, len, deg, baseWidth);
                const dPath = `M ${pts[0][0]} ${pts[0][1]} L ${pts[1][0]} ${pts[1][1]} L ${pts[2][0]} ${pts[2][1]} Z`;

                nodes.push({
                    type: 'path',
                    d: dPath,
                    ...style,
                    cx, cy,
                    data: d,
                    index: i,
                    cursor: handleStyle.grabbable ? 'grab' : undefined,
                });

                // Hub = this mark's handle. Respect the shared contract: false emits
                // nothing; 'hit' keeps an invisible grab target.
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
