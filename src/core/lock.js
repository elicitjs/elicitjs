// @ts-check
// lock.js — read-only rows. `ElicitSpec.lock` marks rows as given rather than
// elicited: no gesture can change or delete them; creating rows stays free.
// Two halves:
//   data     a dataset invariant the engine runs last. It repairs rather than
//            rejects: locked rows snap back and the free part of the proposal
//            commits. Deleting a locked row cannot be repaired, so only that rejects.
//   pointer  the engine stamps `locked` on locked rows' nodes, making them
//            pointer-transparent and invisible to proximity picks. A line's
//            connector is locked when every row of its series is.

import { defineConstraint } from '../constraints/define.js';
import { warn } from './dev.js';

/**
 * Canonical value key for a row: key-order independent (an edit rebuilds a datum
 * by spreading, which can reorder its keys) and stable for Dates (JSON gives the
 * ISO string). Rows are flat records, so this is a cheap deep-equal.
 * @param {any} row
 * @returns {string}
 */
function rowKey(row) {
    if (row == null || typeof row !== 'object') return JSON.stringify(row) || 'null';
    return JSON.stringify(Object.keys(row).sort().map((k) => [k, row[k]]));
}

/**
 * Resolve `spec.lock` for one table into a row predicate.
 *   'seed' / true  -> the rows this table was seeded with. They stay at the head,
 *                     so indices are stable; `seedCount` is read live because
 *                     setData re-seeds.
 *   (datum, index, table) -> an arbitrary predicate.
 * @param {import('../types').LockSpec | undefined} lock
 * @param {() => number} seedCount how many rows of this table are currently seeded
 * @param {string} [table] the table's name, passed on to a predicate lock
 * @returns {((datum: any, index: number) => boolean) | null} null = nothing locked
 */
export function resolveLock(lock, seedCount, table) {
    if (lock == null || lock === false) return null;
    if (typeof lock === 'function') return (d, i) => !!lock(d, i, table);
    if (lock === true || lock === 'seed') return (_d, i) => i < seedCount();
    warn(
        'spec:lock',
        `spec.lock: expected "seed", true, or a (datum, index) => boolean ` +
        `predicate; got ${JSON.stringify(lock)}. Nothing is locked.`
    );
    return null;
}

/**
 * Resolve `spec.context` for one table into the predicate that picks its context
 * rows (reference data: drawn and locked, left out of what the chart reports).
 *   true                  -> every seeded row
 *   (datum, index, table) -> the seeded rows it accepts
 * Asked once, of the seed, and kept as row identity. Never re-ask it of live rows:
 * an answer dragged into the region would vanish from the reported data.
 * @param {import('../types').ContextSpec | undefined} context
 * @param {string} table
 * @returns {((datum: any, index: number) => boolean) | null} null = no context rows
 */
export function resolveContext(context, table) {
    if (context == null || context === false) return null;
    if (context === true) return () => true;
    if (typeof context === 'function') return (d, i) => !!context(d, i, table);
    warn(
        'spec:context',
        `spec.context: expected true (every seeded row) or a (datum, index, table) => ` +
        `boolean predicate over the seeded rows; got ${JSON.stringify(context)}. ` +
        `No row is context.`
    );
    return null;
}

/**
 * The dataset invariant behind a lock: locked rows survive every edit as the same
 * row object, so identity-keyed state (the context set) survives too.
 * @param {(datum: any, index: number) => boolean} isLocked
 * @returns {import('../types').Constraint}
 */
export function lockConstraint(isLocked) {
    return defineConstraint(({ data, oldData }) => {
        if (!oldData || !oldData.length) return undefined;

        // Indices no longer line up when rows were removed, or when a longer
        // proposal spliced a row in (an old row sits at a new index). Restoring by
        // index would overwrite a free row, so judge by survival instead.
        const aligned = data.length === oldData.length
            || (data.length > oldData.length
                && oldData.every((row, i) => data[i] === row || data.indexOf(row) < 0));
        if (!aligned) return survives(data, oldData, isLocked);

        // Indices line up (in-place edit, append, upsert): restore each locked row
        // the proposal touched (by identity) and keep the rest.
        /** @type {any[] | null} */
        let out = null;
        for (let i = 0; i < oldData.length; i++) {
            const row = oldData[i];
            if (!isLocked(row, i)) continue;
            if (data[i] === row) continue;
            out = out || data.slice();
            out[i] = row;
        }
        return out || undefined;
    }, { type: 'lock' });
}

/**
 * The survival half of the lock, for a delete or a splice. Every locked row must be
 * present, matched by identity then by value (each proposal row claimed once); a
 * value match is swapped back to the original object. `false` when one is gone.
 * @param {any[]} data
 * @param {any[]} oldData
 * @param {(datum: any, index: number) => boolean} isLocked
 * @returns {any[] | false | undefined}
 */
function survives(data, oldData, isLocked) {
    /** @type {Set<number>} */
    const claimed = new Set();
    /** @type {(string | undefined)[]} */
    const keys = [];
    const keyAt = (/** @type {number} */ j) => (keys[j] === undefined ? (keys[j] = rowKey(data[j])) : keys[j]);
    /** @type {any[] | null} */
    let out = null;
    for (let i = 0; i < oldData.length; i++) {
        const row = oldData[i];
        if (!isLocked(row, i)) continue;
        let j = data.indexOf(row);
        if (j >= 0 && claimed.has(j)) j = -1;
        if (j < 0) {
            const k = rowKey(row);
            for (let m = 0; m < data.length; m++) {
                if (!claimed.has(m) && keyAt(m) === k) { j = m; break; }
            }
        }
        if (j < 0) return false; // a locked row was deleted or changed
        claimed.add(j);
        if (data[j] !== row) { out = out || data.slice(); out[j] = row; }
    }
    return out || undefined;
}

/**
 * Is this scene node's row locked? A datum-bearing node (index) asks the predicate
 * directly. A connector node — a line's path, which has a `series` but no datum —
 * is locked when every row of its series is, so proximity picking sees a fully
 * locked line as not being there at all.
 * @param {any} node
 * @param {any} feature
 * @param {any[]} data the rows the scene was built from (preview or committed)
 * @param {(datum: any, index: number) => boolean} isLocked
 * @returns {boolean}
 */
export function isNodeLocked(node, feature, data, isLocked) {
    if (node.index != null) {
        const row = data[node.index];
        return row != null && isLocked(row, node.index);
    }
    if (node.series === undefined) return false;
    const sField = feature.seriesKey || null;
    let any = false;
    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (sField && row[sField] !== node.series) continue;
        any = true;
        if (!isLocked(row, i)) return false;
    }
    return any;
}
