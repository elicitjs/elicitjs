// @ts-check
// Helpers shared by the row-coupling constraints.

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
 * A number stored the way the cell held it: a Date stays a Date.
 * @param {any} prev the cell's current value @param {number} n @returns {any}
 */
export function rewrap(prev, n) {
    return prev instanceof Date ? new Date(n) : n;
}

/**
 * Row indices grouped by key, in row order.
 * @param {any[]} data
 * @param {(row: any) => any} keyOf
 * @param {(row: any) => boolean} [accept] rows to include (default all)
 * @returns {Map<any, number[]>}
 */
export function groupRows(data, keyOf, accept) {
    /** @type {Map<any, number[]>} */
    const groups = new Map();
    data.forEach((d, i) => {
        if (accept && !accept(d)) return;
        const key = keyOf(d);
        const g = groups.get(key);
        if (g) g.push(i); else groups.set(key, [i]);
    });
    return groups;
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
