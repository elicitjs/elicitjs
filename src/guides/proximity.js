// @ts-check
// guides.proximity: draw the CATCHMENT of a named feature's proximity pick — the
// dashed ring at the pointer showing how far it reaches to find a mark.
//
//   elicit.guides.proximity({ target: "my-feature" })
//
// It no longer draws the highlight around the snapped mark. That is interaction
// STATE, not a rule, so it is now the `hovered` effect, which the engine draws for
// every feature from one place (see core/effects.js and the state pass in
// core/elicit.js). That is what makes "the pointer is over this mark" and "a
// proximity pick resolved this mark" read identically, instead of only the second
// being drawn — and only for edits that had asked for a guide.
//
// Prefer the edit-owned form — `move({ pick: 'nearest', guide: { catchment: true } })`
// — which needs no feature id. This standalone version stays for a guide declared
// against a feature whose edit doesn't own it.
import { DEFAULT_CATCHMENT } from '../core/effects.js';
import { warnUnknownGuideOptions } from './shared.js';

/**
 * `proximity`'s option vocabulary. Exported so one list drives the diagnostics,
 * the docs table, and (later) the JSON grammar.
 * @type {string[]}
 */
export const PROXIMITY_OPTIONS = ['target', 'color', 'dash', 'width', 'opacity'];

/**
 * @param {{ target: string, color?: string, dash?: string, width?: number, opacity?: number }} options
 * @returns {import('../types').Guide}
 */
export function proximity(options) {
    warnUnknownGuideOptions('proximity', options, PROXIMITY_OPTIONS);
    const { target, ...style } = options;

    return {
        views: 'state',
        build: (_rows, _scales, _w, _h, ctx) => {
            const info = ctx.ui && ctx.ui.session && ctx.ui.session[target];
            if (!info || info.px == null || info.py == null || info.threshold == null) return [];
            const spec = { ...DEFAULT_CATCHMENT, ...style };
            return [{
                type: 'circle', cx: info.px, cy: info.py, r: info.threshold,
                fill: 'none', stroke: spec.color, strokeDasharray: spec.dash,
                strokeWidth: spec.width, opacity: spec.opacity,
                guide: true, effect: true, pointerEvents: 'none',
            }];
        }
    };
}
