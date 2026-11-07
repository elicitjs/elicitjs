// @ts-check
// Helpers the row-coupling constraints share. A coupling rule has to know WHICH
// column the gesture moved, and it learns that the way `ordering` does: by
// diffing the proposed row against the committed one, so no rule ever has to be
// told which handle was grabbed.

/**
 * The columns of `fields` whose value differs between the proposed row and the
 * committed one. Empty when there is no committed row (a create) or nothing moved.
 * @param {string[]} fields
 * @param {any} active the proposed row
 * @param {any} before the same row before this edit, if any
 * @returns {string[]}
 */
export function movedFields(fields, active, before) {
    if (!active || !before) return [];
    return fields.filter((f) => numOf(before[f]) !== numOf(active[f]));
}

/** A value as a number for comparison (a Date by its time). @param {any} v */
export function numOf(v) {
    return v instanceof Date ? v.getTime() : Number(v);
}

/**
 * Add a delta to a cell, keeping a Date a Date.
 * @param {any} v @param {number} delta @returns {any}
 */
export function shifted(v, delta) {
    if (v instanceof Date) return new Date(v.getTime() + delta);
    const n = Number(v);
    return Number.isFinite(n) ? n + delta : v;
}
