// @ts-check
// lock.js — READ-ONLY ROWS. `ElicitSpec.lock` declares which rows of the chart's
// one dataset are given rather than elicited: a locked row cannot be changed or
// deleted by any gesture, while everything else stays free — including CREATING
// new rows. That is the "here is the data we have; you supply the rest" policy
// behind a you-draw-it chart (the seeded history is fact, the future is belief).
//
// A lock is a property of the DATA, not of a mark or an edit, so it lives on the
// spec beside `data` and `schema`. It has two halves, and both live in this file:
//
//   data     an ordinary dataset invariant (built with defineConstraint, so it
//            stays on the one constraint path). The engine runs it LAST, so a lock
//            has the final word over any other repair. It REPAIRS rather than
//            rejects: a proposal that touched locked rows keeps its changes to the
//            free ones and snaps the locked ones back — so a you-draw-it drag that
//            sweeps back across the locked past still paints the future, instead of
//            the whole gesture dying. Deleting a locked row has no repair, so that
//            (and only that) is rejected outright.
//
//   pointer  the engine stamps `locked` on the scene nodes of locked rows. A
//            locked node is pointer-transparent (not grabbable, no editable
//            cursor) and invisible to proximity picking (see pick.js), so a
//            `nearest` / `sweep` / `draw` gesture never even targets one. A line's
//            connector path carries no datum, so it is locked when every row of
//            its series is — which is what lets `edit.line.draw()` next to a
//            locked line resolve "no line here" and draw a new one, rather than
//            grabbing a frozen one and doing nothing.
//
// The invariant is what makes the guarantee unbypassable (it runs on every edit
// from every mark); the stamp is what makes it feel right.

import { defineConstraint } from '../constraints/define.js';

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

/** @param {any} a @param {any} b @returns {boolean} */
const sameRow = (a, b) => a === b || (a != null && b != null && rowKey(a) === rowKey(b));

/**
 * Resolve `spec.lock` into the row predicate everything else reads.
 *   'seed' / true  -> the rows the chart was SEEDED with are fixed; anything an
 *                     edit adds is free. Seeded rows sit at the head of the array
 *                     (creates append) and a locked row can't be removed, so their
 *                     indices are stable — `seedCount` is read live because
 *                     setData re-seeds the chart.
 *   (datum, index) -> an arbitrary predicate, for a lock that is a property of the
 *                     row itself (`d => d.year <= 1990`, `d => d.source === 'observed'`).
 *
 * A lock is declared once for the whole dataset but resolved PER TABLE: "seeded"
 * means "the rows THIS table started with", so the caller passes that table's live
 * seed count and its name. A predicate gets the name as a third argument, which is
 * how one `lock` can say different things about nodes and links.
 * @param {import('../types').LockSpec | undefined} lock
 * @param {() => number} seedCount how many rows of this table are currently seeded
 * @param {string} [table] the table's name, passed on to a predicate lock
 * @returns {((datum: any, index: number) => boolean) | null} null = nothing locked
 */
export function resolveLock(lock, seedCount, table) {
    if (lock == null || lock === false) return null;
    if (typeof lock === 'function') return (d, i) => !!lock(d, i, table);
    if (lock === true || lock === 'seed') return (_d, i) => i < seedCount();
    console.warn(
        `[elicit] spec.lock: expected "seed", true, or a (datum, index) => boolean ` +
        `predicate; got ${JSON.stringify(lock)}. Nothing is locked.`
    );
    return null;
}

/**
 * The dataset invariant behind a lock: locked rows survive every edit unchanged.
 * Pure data — it judges a proposal against the committed rows and never sees a
 * pixel, like every other constraint.
 * @param {(datum: any, index: number) => boolean} isLocked
 * @returns {import('../types').Constraint}
 */
export function lockConstraint(isLocked) {
    return defineConstraint(({ data, oldData }) => {
        if (!oldData || !oldData.length) return undefined;

        // Rows were REMOVED, so indices no longer line up and there is nothing to
        // restore in place. Judge the lock by survival instead: every locked row
        // must still be present, by value. (A multiset, so deleting one of two
        // identical locked rows is still caught.) Anything else is a free row
        // being deleted — allowed.
        if (data.length < oldData.length) {
            /** @type {Map<string, number>} */
            const need = new Map();
            oldData.forEach((row, i) => {
                if (!isLocked(row, i)) return;
                const k = rowKey(row);
                need.set(k, (need.get(k) || 0) + 1);
            });
            if (!need.size) return undefined;
            for (const row of data) {
                const k = rowKey(row);
                const n = need.get(k);
                if (n) n === 1 ? need.delete(k) : need.set(k, n - 1);
            }
            return need.size === 0 ? undefined : false; // a locked row was deleted
        }

        // Same length (an in-place edit) or longer (a create appended, a draw
        // upserted): index i still addresses the same row. Restore every locked row
        // the proposal changed and keep the rest of it — so one gesture that spans
        // locked and free rows still commits its free half.
        /** @type {any[] | null} */
        let out = null;
        for (let i = 0; i < oldData.length; i++) {
            const row = oldData[i];
            if (!isLocked(row, i)) continue;
            if (sameRow(data[i], row)) continue;
            out = out || data.slice();
            out[i] = row;
        }
        return out || undefined;
    }, { type: 'lock' });
}

/**
 * Is this scene node's row locked? A datum-bearing node (index) asks the predicate
 * directly. A connector node — a line's path, which has a `series` but no datum —
 * is locked when EVERY row of its series is, so proximity picking sees a fully
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
