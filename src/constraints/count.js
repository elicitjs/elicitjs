// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// count: keeps the number of rows within `max`.
//   strategy 'replace' (default) -> keep the newest `max`
//   strategy 'reject'            -> refuse the interaction

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
