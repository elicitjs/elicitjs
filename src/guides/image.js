// @ts-check
import { GUIDE_OPTIONS } from '../vocabulary.js';
import { imageSettings } from '../plot/mark.js';
import { warn } from '../core/dev.js';
// guides.image: a picture behind the marks and gridlines, like a CSS
// background-image on the plot. With no x/y it fills the plot; `x: [lo, hi]` /
// `y: [lo, hi]` place it in data space, so it moves with the scales.
//
//   guides.image({ src: 'room.png' })                        // the whole plot
//   guides.image({ src: 'logo.png', x: [0, 10], y: [80, 100] })
//
// `fit` defaults to 'fill': the picture fills its box exactly, so a data
// position on it is where the author placed it. `position` and `repeat` are as
// in CSS.

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * One axis's pixel span: the [lo, hi] pair through the scale, else the full extent.
 * @param {any} span
 * @param {any} scale
 * @param {number} full
 * @param {'x' | 'y'} axis
 * @returns {[number, number] | null}
 */
function spanOf(span, scale, full, axis) {
    if (span == null) return [0, full];
    if (!Array.isArray(span) || span.length !== 2) {
        warn(`guides.image:${axis}`, `guides.image({ ${axis}: … }) takes a [lo, hi] pair in data units; ` +
            `drawing the image across the whole plot on ${axis}.`);
        return [0, full];
    }
    if (!scale) {
        warn(`guides.image:${axis}:noscale`, `guides.image({ ${axis}: […] }): the chart has no ${axis} scale ` +
            `to place it with; drawing the image across the whole plot on ${axis}.`);
        return [0, full];
    }
    const a = scale.encode(span[0]);
    const b = scale.encode(span[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.min(a, b), Math.max(a, b)];
}

/**
 * @param {import('../types').ImageGuideOptions} [options]
 * @returns {import('../types').Guide}
 */
export function image(options = {}) {
    warnUnknownGuideOptions('image', options, GUIDE_OPTIONS.image);
    const { fit, position, repeat } = options;
    const settings = imageSettings({ fit, position, repeat }, 'guides.image()', 'fill', true);
    return {
        views: 'state',
        type: 'image',
        build: (_rows, _scales, _w, _h, ctx) => {
            const { scales, width, height } = ctx;
            const { src, x, y, opacity } = resolveGuideOptions(options, ctx);
            if (src == null || src === '') {
                warn('guides.image:src', 'guides.image() has no `src`, so it draws nothing.');
                return [];
            }
            const xs = spanOf(x, scales.x, width, 'x');
            const ys = spanOf(y, scales.y, height, 'y');
            if (!xs || !ys) return [];
            return [{
                type: 'rect',
                x: xs[0], y: ys[0], width: xs[1] - xs[0], height: ys[1] - ys[0],
                fill: 'none', stroke: 'none',
                fillImage: /** @type {import('../types').FillImage} */ ({ href: String(src), ...settings }),
                ...(opacity != null ? { opacity } : {}),
                // The floor: above the panel, beneath gridlines and marks.
                background: true,
                pointerEvents: 'none',
            }];
        }
    };
}
