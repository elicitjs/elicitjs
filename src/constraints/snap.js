// @ts-check
import { defineConstraint, constraintOptions } from './define.js';

// snap: quantizes a field's value to a discrete grid — a data invariant.
//
// The active datum's `field` is rounded to the nearest multiple of `step`,
// measured from `origin` (default 0). This is how a waffle picker lands on whole
// cells and a stepped slider lands on ticks: the gesture inverts to a continuous
// value in the edit's apply(), then this invariant snaps it — pure data, no
// pixels. `field` names the data field it governs (default 'y', the value axis).
//
// Its guide (edit/guide.js) is a tick per stop along the value axis: a snap has no
// single boundary line to draw, but it does have a grid, and showing it is what
// tells you WHY the handle you're dragging keeps landing between your fingers.

/**
 * @param {{ step?: number, origin?: number, field?: string }} [options]
 * @returns {import('../types').Constraint}
 */
export function snap(options = {}) {
    const { step = 1, origin = 0, field } = constraintOptions('snap', options);

    return defineConstraint(
        ({ value }) => {
            if (value === undefined || step <= 0) return value;
            return origin + Math.round((value - origin) / step) * step;
        },
        { type: 'snap', options: { step, origin }, field }
    );
}
