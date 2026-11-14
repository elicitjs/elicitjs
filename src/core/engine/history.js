// @ts-check
/**
 * Undo history.
 *
 * An elicitation is someone's belief being drafted, so "take that back" is a
 * primitive, not a nicety. A snapshot store rather than inverse operations:
 * an edit's apply() is already a pure data -> data function, so the state
 * before it IS the undo, and no edit has to describe how to reverse itself.
 *
 * The unit is a GESTURE, not a commit. A drag commits on every pointermove, so
 * per-commit history would make undo replay the drag backwards one pixel at a
 * time. Instead a transaction opens at dragstart and closes at dragend (both
 * renderers emit them for mark and plane drags alike), and the first commit
 * inside it records the pre-gesture state — once. A click or a typed commit is
 * its own transaction.
 *
 * Snapshots carry the schema and the chart size too, because edit.axis.* writes
 * the schema's domain and can grow the chart: undoing a category-add has to put
 * the domain, the rows AND the size back.
 */

const MAX_HISTORY = 100;

/**
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   isContextRow: (name: string, d: any) => boolean,
 *   applyResize: (size: { width?: number, height?: number }) => any,
 *   notifyChange: () => void,
 *   update: () => void,
 * }} deps
 */
export function createHistory(chart, deps) {
    const { schemaSpec, ui } = deps;
    /** @type {any[]} */
    let past = [];
    /** @type {any[]} */
    let future = [];
    /** @type {{ recorded: boolean } | null} */
    let txn = null;
    /** @type {any} */
    let wheelTimer = null;

    // The schema of EVERY table rides in a snapshot (a cross-table rename writes
    // two tables' domains; a snapshot of the primary's alone could not undo it).
    // So does context membership, as row indices: the clone has new row objects,
    // and the context set is keyed by identity.
    const snapshot = () => {
        /** @type {Record<string, any>} */
        const schemas = {};
        for (const name of Object.keys(schemaSpec.tables)) schemas[name] = structuredClone(schemaSpec.tables[name].fields);
        /** @type {Record<string, number[]>} */
        const context = {};
        for (const name of Object.keys(chart.contextRows)) {
            context[name] = [];
            (chart.tables[name] || []).forEach((d, i) => { if (deps.isContextRow(name, d)) context[name].push(i); });
        }
        return { tables: structuredClone(chart.tables), schemas, context, width: chart.curW, height: chart.curH };
    };

    /** @param {any} snap */
    const restoreSnapshot = (snap) => {
        chart.tables = structuredClone(snap.tables);
        for (const [name, idx] of Object.entries(snap.context)) {
            /** @type {WeakSet<object>} */
            const set = new WeakSet();
            for (const i of /** @type {number[]} */ (idx)) if (chart.tables[name] && chart.tables[name][i]) set.add(chart.tables[name][i]);
            chart.contextRows[name] = set;
        }
        // Replace each schema's CONTENTS: `schema` (the primary's field map) is
        // captured by closures (and read by resolveScales each render), so
        // rebinding the name would strand them.
        for (const [name, fields] of Object.entries(snap.schemas)) {
            const live = schemaSpec.tables[name] && schemaSpec.tables[name].fields;
            if (!live) continue;
            for (const k of Object.keys(live)) delete live[k];
            Object.assign(live, structuredClone(fields));
        }
        if (snap.width !== chart.curW || snap.height !== chart.curH) {
            deps.applyResize({ width: snap.width, height: snap.height });
        }
        ui.preview = null;
    };

    // Open a transaction if none is open. No snapshot here: a gesture that never
    // commits (a hover that only PREVIEWS, firing beginTxn on every pointermove) must
    // not clone the dataset. The snapshot is taken lazily by recordHistory, on the
    // first commit — which is safe because every commit path calls recordHistory
    // BEFORE it mutates `dataset`/`schema`, so "now" is still the pre-gesture state.
    const beginTxn = () => { if (!txn) txn = { recorded: false }; };
    const endTxn = () => { txn = null; };

    // Called by every commit path, BEFORE it mutates state. The first commit in a
    // transaction snapshots the (still pre-gesture) state and drops the redo stack —
    // a new edit after an undo forks the history, so the old future is gone.
    const recordHistory = () => {
        if (!txn) beginTxn();
        if (!txn || txn.recorded) return;
        past.push(snapshot());
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
        txn.recorded = true;
    };

    // Called by handleEvent for every incoming gesture event, before dispatch:
    // decides which transaction the event belongs to.
    /** @param {string} type the event's type */
    const gestureTxn = (type) => {
        // A wheel burst is one gesture for undo: each tick keeps the transaction
        // open and re-arms a short timer that closes it once the wheel goes quiet.
        if (type === 'wheel') {
            if (!txn || wheelTimer == null) { endTxn(); beginTxn(); }
            if (wheelTimer != null) clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelTimer = null; endTxn(); }, 350);
        } else if (type === 'dragstart') { endTxn(); beginTxn(); }
        else if (!txn) beginTxn();
    };

    // A reseed (setData) is a new starting point, not an edit: there is nothing
    // sensible to undo BACK to.
    const reset = () => {
        past = [];
        future = [];
        endTxn();
    };

    // Undo / redo one GESTURE. Both return whether they moved, so a caller can drive
    // a button's disabled state; both fire the ordinary `change` notification,
    // because as far as anything downstream is concerned the data just changed.
    const canUndo = () => past.length > 0;
    const canRedo = () => future.length > 0;
    const undo = () => {
        if (!past.length) return false;
        future.push(snapshot());
        restoreSnapshot(/** @type {any} */(past.pop()));
        endTxn();
        deps.notifyChange();
        deps.update();
        return true;
    };
    const redo = () => {
        if (!future.length) return false;
        past.push(snapshot());
        restoreSnapshot(/** @type {any} */(future.pop()));
        endTxn();
        deps.notifyChange();
        deps.update();
        return true;
    };

    return { snapshot, restoreSnapshot, beginTxn, endTxn, recordHistory, gestureTxn, reset, canUndo, canRedo, undo, redo };
}
