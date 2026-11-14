// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';
import { movedFields, numOf, shifted } from './shared.js';

// symmetric: when exactly one of a pair moves, sets the other to its mirror
// about the centre column (`2·about − moved`). Does nothing if the centre moved.

/**
 * @param {{ field?: string[], about?: string }} [options]
 * @returns {import('../types').Constraint}
 */
export function symmetric(options = {}) {
    const { field, about } = constraintOptions('symmetric', options);
    const pair = Array.isArray(field) ? field : [];
    if (!about || pair.length !== 2) {
        warn(
            'symmetric:fields',
            "symmetric() needs a pair of columns and the column they mirror about — " +
            "symmetric({ field: ['lo', 'hi'], about: 'mean' }). Without them the constraint " +
            'accepts every edit unchanged.'
        );
        return defineConstraint(() => undefined, { type: 'symmetric', options: { about }, field: pair });
    }
    const [a, b] = pair;

    return defineConstraint(
        ({ active, oldData, activeIndex }) => {
            if (!active || oldData == null || activeIndex == null) return undefined;
            const before = oldData[activeIndex];
            if (!before) return undefined;
            const moved = movedFields([a, b, about], active, before);
            if (moved.includes(about)) return undefined;
            const movedA = moved.includes(a), movedB = moved.includes(b);
            if (movedA === movedB) return undefined;   // neither, or both
            const centre = numOf(active[about]);
            if (!Number.isFinite(centre)) return undefined;
            const [from, to] = movedA ? [a, b] : [b, a];
            const mirrored = 2 * centre - numOf(active[from]);
            if (!Number.isFinite(mirrored)) return undefined;
            return { [to]: shifted(active[to], mirrored - numOf(active[to])) };
        },
        { type: 'symmetric', options: { about }, field: pair }
    );
}
