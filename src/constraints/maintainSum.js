// @ts-check
import { defineConstraint } from './define.js';

// maintainSum: keeps the total of a field related to `targetSum` — a cross-datum
// data invariant. Three strategies:
//   'cap' (default)     — bound the touched datum so total ≤ targetSum (drag freely
//                         up to the remaining budget, then stop)
//   'normalize'         — after the edit, scale ALL values so sum === targetSum
//   'redistribute'      — hold the edited value, proportionally adjust siblings so
//                         the total stays at targetSum
//
// `field` names the data field summed (default 'y'). Because this is a dataset
// invariant, it holds no matter which edit moved a value.

/**
 * @param {{ targetSum: number, field?: string, strategy?: 'cap' | 'normalize' | 'redistribute' }} options
 * @returns {import('../types').Constraint}
 */
export function maintainSum(options) {
    const { targetSum, field = 'y', strategy = 'cap' } = options;

    if (strategy === 'normalize') {
        return defineConstraint(
            ({ data, activeIndex, value }) => {
                const next = data.map((d, i) =>
                    (i === activeIndex && value !== undefined) ? { ...d, [field]: value } : { ...d }
                );
                const sum = next.reduce((s, d) => s + (Number(d[field]) || 0), 0);
                if (sum === 0) return next;
                const scale = targetSum / sum;
                return next.map((d) => ({ ...d, [field]: (Number(d[field]) || 0) * scale }));
            },
            { type: 'maintainSum', options: { targetSum, strategy }, field }
        );
    }

    if (strategy === 'redistribute') {
        return defineConstraint(
            ({ data, activeIndex, value }) => {
                if (activeIndex == null || value === undefined) return value;
                const held = Math.max(0, Math.min(targetSum, Number(value) || 0));
                const others = data
                    .map((d, i) => (i === activeIndex ? 0 : (Number(d[field]) || 0)))
                    .reduce((s, v) => s + v, 0);
                const remain = Math.max(0, targetSum - held);
                const scale = others > 0 ? remain / others : 0;
                return data.map((d, i) => {
                    if (i === activeIndex) return { ...d, [field]: held };
                    const v = Number(d[field]) || 0;
                    return { ...d, [field]: others > 0 ? v * scale : (data.length > 1 ? remain / (data.length - 1) : 0) };
                });
            },
            { type: 'maintainSum', options: { targetSum, strategy }, field }
        );
    }

    // strategy === 'cap' (default)
    return defineConstraint(
        ({ data, activeIndex, value }) => {
            if (activeIndex == null || value === undefined) return value;

            // Sum of every datum except the one just touched (by index, so ties on
            // the category key don't matter).
            const sumOthers = data.reduce(
                (sum, d, i) => (i === activeIndex ? sum : sum + (d[field] || 0)),
                0
            );
            const headroom = Math.max(0, targetSum - sumOthers);
            return Math.min(value, headroom);
        },
        { type: 'maintainSum', options: { targetSum, strategy: 'cap' }, field }
    );
}
