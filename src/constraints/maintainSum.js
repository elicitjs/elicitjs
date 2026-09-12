// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';

// maintainSum: keeps the total of a field related to `total` — a cross-datum
// data invariant. Three strategies:
//   'cap' (default)     — bound the touched datum so total ≤ total (drag freely
//                         up to the remaining budget, then stop)
//   'normalize'         — after the edit, scale ALL values so sum === total
//   'redistribute'      — hold the edited value, proportionally adjust siblings so
//                         the total stays at total
//
// `field` names the data field summed (default 'y'). Because this is a dataset
// invariant, it holds no matter which edit moved a value.

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
            ({ data, activeIndex, value, field }) => {
                if (field == null) return undefined;
                const next = data.map((d, i) =>
                    (i === activeIndex && value !== undefined) ? { ...d, [field]: value } : { ...d }
                );
                const sum = next.reduce((s, d) => s + (Number(d[field]) || 0), 0);
                if (sum === 0) return next;
                const scale = total / sum;
                return next.map((d) => ({ ...d, [field]: (Number(d[field]) || 0) * scale }));
            },
            { type: 'maintainSum', options: { total, strategy }, field }
        );
    }

    if (strategy === 'redistribute') {
        return defineConstraint(
            ({ data, activeIndex, value, field }) => {
                if (field == null) return undefined;
                if (activeIndex == null || value === undefined) return value;
                const held = Math.max(0, Math.min(total, Number(value) || 0));
                const others = data
                    .map((d, i) => (i === activeIndex ? 0 : (Number(d[field]) || 0)))
                    .reduce((s, v) => s + v, 0);
                const remain = Math.max(0, total - held);
                const scale = others > 0 ? remain / others : 0;
                return data.map((d, i) => {
                    if (i === activeIndex) return { ...d, [field]: held };
                    const v = Number(d[field]) || 0;
                    return { ...d, [field]: others > 0 ? v * scale : (data.length > 1 ? remain / (data.length - 1) : 0) };
                });
            },
            { type: 'maintainSum', options: { total, strategy }, field }
        );
    }

    // strategy === 'cap' (default)
    return defineConstraint(
        ({ data, activeIndex, value, field }) => {
                if (field == null) return undefined;
            if (activeIndex == null || value === undefined) return value;

            // Sum of every datum except the one just touched (by index, so ties on
            // the category key don't matter).
            const sumOthers = data.reduce(
                (sum, d, i) => (i === activeIndex ? sum : sum + (d[field] || 0)),
                0
            );
            const headroom = Math.max(0, total - sumOthers);
            return Math.min(value, headroom);
        },
        { type: 'maintainSum', options: { total, strategy: 'cap' }, field }
    );
}
