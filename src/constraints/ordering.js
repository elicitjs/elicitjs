// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';
import { rewrap } from './shared.js';

// ordering: keeps several fields of one row in order.
//
//   ordering({ field: ['lo', 'mean', 'hi'] })   // lo <= mean <= hi
//
// 'push' (default) keeps the moved field and pushes its neighbours aside;
// 'block' rejects the edit.

/**
 * Is this list non-decreasing?
 * @param {number[]} values
 * @returns {boolean}
 */
function ordered(values) {
    for (let i = 1; i < values.length; i++) if (values[i] < values[i - 1]) return false;
    return true;
}

/**
 * Which ordered field this edit moved, by diffing against the old row. -1 when
 * there is no old row or more than one field moved.
 * @param {string[]} order
 * @param {any} active the proposed row
 * @param {any} before the same row before this edit, if any
 * @returns {number}
 */
function movedIndex(order, active, before) {
    if (!before) return -1;
    let found = -1;
    for (let i = 0; i < order.length; i++) {
        if (Number(before[order[i]]) === Number(active[order[i]])) continue;
        if (found >= 0) return -1; // more than one moved: no single field to pin
        found = i;
    }
    return found;
}

/**
 * @param {{ field?: string | string[], strategy?: 'push' | 'block' }} [options]
 *   field   the row's columns, in the order they must stay in (>= 2).
 *   strategy  'push' (default) moves the neighbours aside; 'block' rejects the edit.
 * @returns {import('../types').Constraint}
 */
export function ordering(options = {}) {
    const { field, strategy = 'push' } = constraintOptions('ordering', options);
    const order = Array.isArray(field) ? field : (field != null ? [field] : []);

    if (order.length < 2) {
        warn(
            'ordering:fields',
            'ordering() needs at least two columns, in order — ' +
            "ordering({ field: ['lo', 'mean', 'hi'] }). " +
            'Without them the constraint accepts every edit unchanged.'
        );
        return defineConstraint(() => undefined, { type: 'ordering', options: { strategy }, field: order });
    }

    return defineConstraint(
        ({ active, oldData, activeIndex }) => {
            if (!active) return undefined;
            const values = order.map((f) => Number(active[f]));
            if (values.some((v) => !Number.isFinite(v))) return undefined;
            if (ordered(values)) return undefined;          // the common case
            if (strategy === 'block') return false;

            const before = (oldData && activeIndex != null) ? oldData[activeIndex] : null;
            const pinned = movedIndex(order, active, before);

            const next = values.slice();
            if (pinned >= 0) {
                // Hold the field the gesture moved; shove its neighbours to make room.
                for (let i = pinned - 1; i >= 0; i--) next[i] = Math.min(next[i], next[i + 1]);
                for (let i = pinned + 1; i < next.length; i++) next[i] = Math.max(next[i], next[i - 1]);
            } else {
                // Can't tell what moved: settle the row into order from the bottom up.
                for (let i = 1; i < next.length; i++) next[i] = Math.max(next[i], next[i - 1]);
            }

            const out = { ...active };
            order.forEach((f, i) => { out[f] = rewrap(active[f], next[i]); });
            return out;
        },
        { type: 'ordering', options: { strategy }, field: order }
    );
}
