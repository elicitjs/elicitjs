// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';

// ordering: keeps several fields of a row in a fixed order — a data invariant.
//
//   ordering({ fields: ['lo', 'mean', 'hi'] })   // lo <= mean <= hi
//   ordering({ lower: 'start', upper: 'end' })   // the two-field case
//
// This is the rule an interval glyph lives or dies by. An error bar's caps and its
// mean dot are separate marks over separate FIELDS of one row (the composite
// pattern), and nothing stops you dragging the low cap up past the high one —
// after which the glyph draws inside-out and the elicited "interval" says the
// opposite of what the person meant.
//
// Being a DATASET invariant rather than an edit guard is what makes it hold: the
// order survives whichever handle you grab, and survives a create or a keyboard
// nudge too. Declare it once on the spec and it covers every mark in the glyph.
//
// It REPAIRS rather than rejects, and repairs by pushing the OTHER fields out of
// the way — the field you are dragging is the one you meant, so it wins and its
// neighbours give. Dragging `mean` past `hi` carries `hi` along; that reads as the
// interval moving, where rejecting reads as the handle sticking. (`strategy: 'block'`
// rejects instead, for an elicitation where the bounds are given and only the
// estimate inside them moves.)

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
 * Which ordered field this edit moved, found by diffing the proposal against the
 * row as it was — `oldData` is exactly what makes this knowable, so the constraint
 * never has to be told which handle was grabbed. -1 when it can't tell (a create
 * has no previous row; a paste may move several at once).
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
            order.forEach((f, i) => { out[f] = next[i]; });
            return out;
        },
        // The guide draws on the value axis, so name the first ordered field; an
        // edit on any of them shares that axis (they're bucketed onto one scale).
        { type: 'ordering', options: { strategy }, field: order }
    );
}
