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
 * Resolve `spec.context` for one table into the predicate that picks its CONTEXT
 * rows out of the SEED. Context rows are reference — observed history behind a
 * forecast, the record a guess is made against — drawn and locked like any locked
 * row, and left out of what the chart reports (`getData()`, `onChange`, the
 * index-addressed selection and control API).
 *
 *   true           -> every row the table was seeded with is context.
 *   (datum, index, table) -> the seeded rows it accepts are context.
 *
 * The predicate is asked ONCE, of the seed, and the answer is kept as the rows'
 * identity (the engine holds the row objects). It is never re-asked of live rows:
 * an answer dragged into the predicate's region (a forecast point pulled back to
 * 2015 under `d => d.year <= 2020`) must not silently become context and vanish
 * from the reported data — for an elicitation library that is the worst failure
 * available. The lock is what keeps the identity stable: a locked row always
 * survives a commit as the SAME object (see lockConstraint).
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
 * The dataset invariant behind a lock: locked rows survive every edit unchanged —
 * as the SAME row object, not merely an equal one, so anything keyed by a row's
 * identity (the engine's context set) survives an edit that rebuilt every row.
 * Pure data — it judges a proposal against the committed rows and never sees a
 * pixel, like every other constraint.
 * @param {(datum: any, index: number) => boolean} isLocked
 * @returns {import('../types').Constraint}
 */
export function lockConstraint(isLocked) {
    return defineConstraint(({ data, oldData }) => {
        if (!oldData || !oldData.length) return undefined;

        // Rows were REMOVED, so indices no longer line up and there is nothing to
        // restore in place. Judge the lock by SURVIVAL instead: every locked row
        // must still be present. Anything else is a free row being deleted —
        // allowed.
        //
        // Or the longer proposal SPLICED (a stack cut inserts its new segment
        // beside the one it split, shifting every later row by one): then index i
        // addresses a neighbour, and "restoring" would overwrite a free row with a
        // locked row's copy. A splice keeps the untouched rows' IDENTITY, so it is
        // detectable: some old row sits in the proposal at a different index. Judge
        // it by survival too — a modified locked row is refused, since where to
        // restore it cannot be known.
        const aligned = data.length === oldData.length
            || (data.length > oldData.length
                && oldData.every((row, i) => data[i] === row || data.indexOf(row) < 0));
        if (!aligned) return survives(data, oldData, isLocked);

        // Same length (an in-place edit) or longer (a create appended, a draw
        // upserted): index i still addresses the same row. Restore every locked row
        // the proposal touched and keep the rest of it — so one gesture that spans
        // locked and free rows still commits its free half. "Touched" is identity,
        // not value: a whole-dataset edit that rebuilt an unchanged locked row gets
        // the original object back.
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
 * The survival half of the lock, for a proposal whose indices no longer line up
 * with the committed rows (a delete, a splice). Every locked row must be present,
 * matched by identity first and then by value — each proposal row claimed once, so
 * deleting one of two identical locked rows is still caught — and a match by value
 * is swapped back to the original object. `false` when a locked row is gone.
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
