// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';

// maintainSum: holds the sum of `field` to `total`.
//   'cap' (default)  bound the touched row by the remaining budget
//   'normalize'      scale every value so the sum equals `total`
//   'redistribute'   hold the edited value, scale the others to fill the rest
// `field` defaults to the column the dispatching edit writes.

/**
 * @param {{ total?: number, field?: string, strategy?: 'cap' | 'normalize' | 'redistribute' }} options
 * @returns {import('../types').Constraint}
 */
export function maintainSum(options = {}) {
    const { total, field, strategy = 'cap' } = constraintOptions('maintainSum', options);
    if (typeof total !== 'number') {
        warn(
            'maintainSum:target',
            'maintainSum() needs the total the rows must sum to — maintainSum({ total: 100 }). ' +
            'Without one the constraint accepts every edit unchanged.'
        );
        return defineConstraint(() => undefined, { type: 'maintainSum', options: { total, strategy }, field });
    }

    if (strategy === 'normalize') {
        return defineConstraint(
            ({ data, field }) => {
                if (field == null) return undefined;
                const sum = data.reduce((s, d) => s + (Number(d[field]) || 0), 0);
                if (sum === 0) return data.map((d) => ({ ...d }));
                const scale = total / sum;
                return data.map((d) => ({ ...d, [field]: (Number(d[field]) || 0) * scale }));
            },
            { type: 'maintainSum', options: { total, strategy }, field }
        );
    }

    if (strategy === 'redistribute') {
        return defineConstraint(
            ({ data, activeIndex, value, field }) => {
                if (field == null || activeIndex == null || value === undefined) return undefined;
                // The budget window is [min(0, total), max(0, total)], so a negative
                // total works too.
                const lo = Math.min(0, total), hi = Math.max(0, total);
                const held = Math.max(lo, Math.min(hi, Number(value) || 0));
                const others = data
                    .map((d, i) => (i === activeIndex ? 0 : (Number(d[field]) || 0)))
                    .reduce((s, v) => s + v, 0);
                const remain = Math.max(lo, Math.min(hi, total - held));
                const scale = others !== 0 ? remain / others : 0;
                return data.map((d, i) => {
                    if (i === activeIndex) return { ...d, [field]: held };
                    const v = Number(d[field]) || 0;
                    return { ...d, [field]: others !== 0 ? v * scale : (data.length > 1 ? remain / (data.length - 1) : 0) };
                });
            },
            { type: 'maintainSum', options: { total, strategy }, field }
        );
    }

    // strategy === 'cap' (default)
    return defineConstraint(
        ({ data, activeIndex, value, field }) => {
            if (field == null || activeIndex == null || value === undefined) return undefined;

            // Sum of every row except the touched one.
            const sumOthers = data.reduce(
                (sum, d, i) => (i === activeIndex ? sum : sum + (d[field] || 0)),
                0
            );
            // Headroom runs toward the total's sign.
            if (total < 0) {
                const headroom = Math.min(0, total - sumOthers);
                return Math.max(value, headroom);
            }
            const headroom = Math.max(0, total - sumOthers);
            return Math.min(value, headroom);
        },
        { type: 'maintainSum', options: { total, strategy: 'cap' }, field }
    );
}
