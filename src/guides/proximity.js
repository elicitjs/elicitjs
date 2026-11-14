// @ts-check
import { GUIDE_OPTIONS } from '../vocabulary.js';
// guides.proximity: the dashed ring at the pointer showing how far a named
// feature's proximity pick reaches.
//
//   elicit.guides.proximity({ target: "my-feature" })
//
// The edit-owned form, `move({ pick: 'nearest', guide: { catchment: true } })`,
// needs no feature id. The snapped mark's highlight is the `hovered` effect.
import { DEFAULT_CATCHMENT } from '../core/effects.js';
import { warnUnknownGuideOptions } from './shared.js';
import { warn } from '../core/dev.js';
import { catchmentRing } from '../edit/guide.js';

/**
 * Paint options use the `guides.*` names (`stroke` / `strokeDash` / `strokeWidth`),
 * mapped internally onto the catchment defaults.
 * @param {{ target?: string, stroke?: string, strokeDash?: string, strokeWidth?: number, opacity?: number }} [options]
 * @returns {import('../types').Guide}
 */
export function proximity(options = {}) {
    warnUnknownGuideOptions('proximity', options, GUIDE_OPTIONS.proximity);
    const { target, stroke, strokeDash: strokeDasharray, strokeWidth, opacity } = options;
    if (target == null) {
        warn(
            'proximity:target',
            'guides.proximity() needs `target`: the id of the mark whose proximity ' +
            'catchment it draws (guides.proximity({ target: "line" }) beside ' +
            'lineY({ id: "line", … })). Without one it draws nothing.'
        );
    }

    return {
        views: 'state',
        type: 'proximity',
        build: (_rows, _scales, _w, _h, ctx) => {
            const info = target != null && ctx.ui && ctx.ui.session ? ctx.ui.session[target] : null;
            return catchmentRing(info, {
                ...DEFAULT_CATCHMENT,
                ...(stroke !== undefined ? { color: stroke } : {}),
                ...(strokeDasharray !== undefined ? { dash: strokeDasharray } : {}),
                ...(strokeWidth !== undefined ? { width: strokeWidth } : {}),
                ...(opacity !== undefined ? { opacity } : {}),
            });
        }
    };
}
