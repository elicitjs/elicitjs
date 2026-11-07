// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { warn } from '../core/dev.js';
import { movedFields, numOf, shifted } from './shared.js';

// follow: columns that move WITH a lead column — a data invariant.
//
// When the lead column of a row moves by some delta, every listed column of that
// row the edit did not itself change moves by the same delta: a mean's interval
// travels with the mean, a box's whiskers with its median. Which column moved
// is read by diffing the proposal against the committed row (as `ordering`
// does), so one declaration covers every edit on the glyph; an edit that moves
// a listed column directly leaves the lead alone.
//
//   constraints: [follow({ field: ['lo', 'hi'], lead: 'mean' })]
//
// `field` is the columns the rule REPAIRS (the convention every constraint
// keeps); `lead` is the column they follow.

/**
 * @param {{ field?: string | string[], lead?: string }} [options]
 * @returns {import('../types').Constraint}
 */
export function follow(options = {}) {
    const { field, lead } = constraintOptions('follow', options);
    const followers = Array.isArray(field) ? field : (field != null ? [field] : []);
    if (!lead || !followers.length) {
        warn(
            'follow:fields',
            "follow() needs the columns that follow and the column they follow — " +
            "follow({ field: ['lo', 'hi'], lead: 'mean' }). Without them the constraint " +
            'accepts every edit unchanged.'
        );
        return defineConstraint(() => undefined, { type: 'follow', options: { lead }, field: followers });
    }

    return defineConstraint(
        ({ active, oldData, activeIndex }) => {
            if (!active || oldData == null || activeIndex == null) return undefined;
            const before = oldData[activeIndex];
            if (!before) return undefined;
            const moved = movedFields([lead, ...followers], active, before);
            if (!moved.includes(lead)) return undefined;
            const delta = numOf(active[lead]) - numOf(before[lead]);
            if (!Number.isFinite(delta) || delta === 0) return undefined;
            /** @type {Record<string, any>} */
            const out = {};
            for (const f of followers) {
                if (moved.includes(f)) continue;   // the edit set it itself
                if (active[f] == null) continue;
                out[f] = shifted(active[f], delta);
            }
            return Object.keys(out).length ? out : undefined;
        },
        { type: 'follow', options: { lead }, field: followers }
    );
}
