// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { groupRows } from './shared.js';

// unique: at most `max` rows share a key. `field` is one column or a list for a
// composite key (`['x', 'y']` = one mark per cell); omitted, it is the column the
// dispatching edit writes.
//   strategy 'reject'  (default) -> refuse the interaction
//   strategy 'replace'           -> keep the touched row, drop the resident

/**
 * @param {{ field?: string | string[], max?: number, strategy?: 'reject' | 'replace' }} [options]
 * @returns {import('../types').Constraint}
 */
export function unique(options = {}) {
    const { field, max = 1, strategy = 'reject' } = constraintOptions('unique', options);

    return defineConstraint(
        ({ data, activeIndex, fields }) => {
            if (!fields.length) return undefined;
            // Joined with the unit separator, which won't appear in a label.
            const keyOf = (/** @type {any} */ d) => fields.map((f) => d[f]).join('\u001f');
            // Groups are oldest first. `null` is "unfilled", not a category.
            const groups = groupRows(data, keyOf, (d) => !fields.some((f) => d[f] == null));

            let over = false;
            for (const idxs of groups.values()) {
                if (idxs.length > max) { over = true; break; }
            }
            if (!over) return undefined;              // every slot within budget
            if (strategy === 'reject') return false;  // refuse the whole interaction

            // replace: keep the newest `max` per group, always including the touched row.
            /** @type {Set<number>} */
            const drop = new Set();
            for (const idxs of groups.values()) {
                if (idxs.length <= max) continue;
                let keep;
                if (activeIndex != null && idxs.includes(activeIndex)) {
                    const others = idxs.filter(i => i !== activeIndex);
                    keep = new Set([activeIndex, ...others.slice(others.length - (max - 1))]);
                } else {
                    keep = new Set(idxs.slice(idxs.length - max));
                }
                idxs.forEach(i => { if (!keep.has(i)) drop.add(i); });
            }
            return data.filter((_, i) => !drop.has(i));
        },
        { type: 'unique', options: { field, max, strategy }, field }
    );
}
