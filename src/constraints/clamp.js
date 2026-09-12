// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// clamp: restricts a field's value to a [min, max] range — a data invariant.
//
// The active datum's `field` is bounded to [min, max]. When a bound is omitted it
// falls back to that field's declared domain (in data space). `field` names the
// data field it governs (default 'y', the conventional value axis).

/**
 * @param {{ min?: number, max?: number, field?: string }} [options]
 * @returns {import('../types').Constraint}
 */
export function clamp(options = {}) {
    const { min, max, field } = constraintOptions('clamp', options);

    return defineConstraint(
        ({ value, domain }) => {
            let lo = min;
            let hi = max;
            if (lo === undefined && domain) lo = Math.min(...domain);
            if (hi === undefined && domain) hi = Math.max(...domain);

            let v = value;
            if (lo !== undefined && v !== undefined) v = Math.max(lo, v);
            if (hi !== undefined && v !== undefined) v = Math.min(hi, v);
            return v;
        },
        { type: 'clamp', options: { min, max }, field }
    );
}
