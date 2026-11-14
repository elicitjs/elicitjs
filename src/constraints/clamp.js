// @ts-check
import { defineConstraint, constraintOptions, changedCells } from './define.js';

// clamp: bounds every changed cell of `field` to [min, max]. An omitted bound
// falls back to the column's declared domain.

/**
 * @param {{ min?: number, max?: number, field?: string | string[] }} [options]
 * @returns {import('../types').Constraint}
 */
export function clamp(options = {}) {
    const { min, max, field } = constraintOptions('clamp', options);

    return defineConstraint(
        (ctx) => {
            const cells = changedCells(ctx);
            if (!cells.length) return undefined;
            let out = ctx.data;
            let touched = false;
            for (const { i, field: f } of cells) {
                const v = out[i][f];
                if (v == null) continue;
                const domain = ctx.domains ? ctx.domains[f] : ctx.domain;
                let lo = min;
                let hi = max;
                if (lo === undefined && domain) lo = Math.min(...domain);
                if (hi === undefined && domain) hi = Math.max(...domain);
                const n = v instanceof Date ? v.getTime() : v;
                if (typeof n !== 'number' || !Number.isFinite(n)) continue;
                let c = n;
                if (lo !== undefined) c = Math.max(lo, c);
                if (hi !== undefined) c = Math.min(hi, c);
                if (c === n) continue;
                const stored = v instanceof Date ? new Date(c) : c;
                if (!touched) { out = out.slice(); touched = true; }
                out[i] = { ...out[i], [f]: stored };
            }
            return touched ? out : undefined;
        },
        { type: 'clamp', options: { min, max }, field }
    );
}
