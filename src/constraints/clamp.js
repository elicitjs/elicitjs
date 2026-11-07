// @ts-check
import { defineConstraint, constraintOptions, changedCells } from './define.js';

// clamp: restricts a field's value to a [min, max] range — a data invariant.
//
// Every cell the proposal changed in `field` is bounded to [min, max]. When a
// bound is omitted it falls back to that column's declared domain (in data
// space). `field` names the column(s) it governs; omitted, it is the column the
// dispatching edit writes.
//
// It clamps CELLS, not "the value": a rule that read only the active datum let a
// `monotonic` push carry a neighbour past the bound, and did nothing at all for
// an edit that appends several rows (there is no single active row).

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
