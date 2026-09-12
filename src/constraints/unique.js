// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// unique: a per-category cardinality invariant — at most `max` data elements may
// share the same category KEY. Where `count` caps the whole dataset, `unique`
// caps each category *group* independently.
//
// The motivating cases:
//   - one band axis: `unique({ field: 'x' })` -> "one bar per category".
//   - two band axes (a categorical grid): `unique({ field: ['x', 'y'] })` -> "one
//     mark per CELL" — the key is the tuple, so two marks may share a column or a
//     row, just not the same (x, y) cell.
// A create on an occupied slot, or a drag that moves a mark onto one, is resolved
// by strategy:
//   strategy 'reject'  (default) -> refuse the interaction (slot stays as it was)
//   strategy 'replace'           -> keep the just-touched mark, drop the resident
//
// `field` names the category field(s) in DATA terms — a string, or an array for a
// composite (multi-axis) key (default 'x'). Because it is a dataset invariant it
// holds for every edit — create, drag onto a slot, paste — not just the one it
// was declared next to.

/**
 * @param {{ field?: string | string[], max?: number, strategy?: 'reject' | 'replace' }} [options]
 * @returns {import('../types').Constraint}
 */
export function unique(options = {}) {
    const { field, max = 1, strategy = 'reject' } = constraintOptions('unique', options);
    // Composite category key for a datum. The unit-separator won't appear in a
    // category label, so the join is collision-free.

    return defineConstraint(
        ({ data, activeIndex, fields }) => {
            // The columns whose combination must be unique: the rule's own, else
            // the one column the dispatching edit writes.
            const keyOf = (/** @type {any} */ d) => fields.map((f) => d[f]).join('\u001f');
            // Group datum indices by their category key (insertion order within
            // each group == age, oldest first).
            /** @type {Map<any, number[]>} */
            const groups = new Map();
            data.forEach((d, i) => {
                const k = keyOf(d);
                let g = groups.get(k);
                if (!g) { g = []; groups.set(k, g); }
                g.push(i);
            });

            let over = false;
            for (const idxs of groups.values()) {
                if (idxs.length > max) { over = true; break; }
            }
            if (!over) return undefined;              // every slot within budget
            if (strategy === 'reject') return false;  // refuse the whole interaction

            // replace: in each over-full group keep the newest `max`, but always
            // preserve the datum the gesture just touched/created.
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
