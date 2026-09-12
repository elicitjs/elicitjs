// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// count: a dataset *cardinality* invariant — keeps the number of data elements
// within `max`. A whole-dataset rule (no field), so it returns a full dataset.
//
// When an interaction pushes the count over the limit:
//   strategy 'replace' (default) -> keep the newest `max` (drop the oldest)
//   strategy 'reject'            -> refuse the interaction entirely
//
// A Likert "one point on the scale" is just count({ max: 1 }): each create
// appends, then this trims back to the single newest point (a place-to-replace).
// count({ max: 5 }) gives "pick your top five", etc.

/**
 * @param {{ max?: number, strategy?: 'replace' | 'reject' }} [options]
 * @returns {import('../types').Constraint}
 */
export function count(options = {}) {
    const { max = Infinity, strategy = 'replace' } = constraintOptions('count', options);

    return defineConstraint(
        ({ data }) => {
            if (data.length <= max) return undefined;      // within budget: accept as-is
            if (strategy === 'reject') return false;       // refuse the whole interaction
            return data.slice(data.length - max);          // keep the newest `max`
        },
        { type: 'count', options: { max, strategy } }
    );
}
