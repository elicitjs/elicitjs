// @ts-check
/**
 * Undo history as snapshots, one per gesture (dragstart to dragend; a click or
 * typed commit is its own). The first commit in a gesture records the state
 * before it. Snapshots also carry the schema and chart size, which axis edits change.
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

    // Snapshot every table's schema, plus context membership as row indices
    // (the clone has new row objects, and the context set is keyed by identity).
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
        // Replace each schema's contents in place; closures hold the field maps.
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

    // Open a transaction if none is open. The snapshot is taken lazily by
    // recordHistory, so a gesture that never commits clones nothing.
    const beginTxn = () => { if (!txn) txn = { recorded: false }; };
    const endTxn = () => { txn = null; };

    // Called by every commit path before it mutates state. The first commit in a
    // transaction snapshots the state and drops the redo stack.
    const recordHistory = () => {
        if (!txn) beginTxn();
        if (!txn || txn.recorded) return;
        past.push(snapshot());
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
        txn.recorded = true;
    };

    // Decide which transaction an incoming event belongs to. A dragstart always
    // opens a fresh one, so a lost dragend can't leak into the next gesture.
    /** @param {string} type the event's type */
    const gestureTxn = (type) => {
        // A wheel burst is one transaction, closed by a timer once the wheel goes quiet.
        if (type === 'wheel') {
            if (!txn || wheelTimer == null) { endTxn(); beginTxn(); }
            if (wheelTimer != null) clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelTimer = null; endTxn(); }, 350);
        } else if (type === 'dragstart') { endTxn(); beginTxn(); }
        else if (!txn) beginTxn();
    };

    // Clear history on a reseed (setData).
    const reset = () => {
        past = [];
        future = [];
        endTxn();
    };

    // Undo / redo one gesture. Both return whether they moved and fire `change`.
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

    return { endTxn, recordHistory, gestureTxn, reset, canUndo, canRedo, undo, redo };
}
