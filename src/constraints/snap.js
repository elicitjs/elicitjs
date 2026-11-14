// @ts-check
import { defineConstraint, constraintOptions, changedCells } from './define.js';

// snap: rounds every changed cell of `field` to the nearest multiple of `step`
// from `origin`. A Date stays a Date (the grid is in milliseconds).

/**
 * @param {{ step?: number, origin?: number, field?: string | string[] }} [options]
 * @returns {import('../types').Constraint}
 */
export function snap(options = {}) {
    const { step = 1, origin = 0, field } = constraintOptions('snap', options);
    const originMs = /** @type {any} */ (origin) instanceof Date ? /** @type {any} */ (origin).getTime() : origin;

    return defineConstraint(
        (ctx) => {
            if (!(step > 0)) return undefined;
            const cells = changedCells(ctx);
            if (!cells.length) return undefined;
            let out = ctx.data;
            let touched = false;
            for (const { i, field: f } of cells) {
                const v = out[i][f];
                if (v == null) continue;
                const n = v instanceof Date ? v.getTime() : v;
                if (typeof n !== 'number' || !Number.isFinite(n)) continue;
                const snapped = originMs + Math.round((n - originMs) / step) * step;
                if (snapped === n) continue;
                const stored = v instanceof Date ? new Date(snapped) : snapped;
                if (!touched) { out = out.slice(); touched = true; }
                out[i] = { ...out[i], [f]: stored };
            }
            return touched ? out : undefined;
        },
        { type: 'snap', options: { step, origin }, field }
    );
}
