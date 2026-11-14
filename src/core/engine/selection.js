// @ts-check
import { isBareForm } from '../schema.js';

/**
 * Selection: which rows the reader has picked, and the API that drives it.
 *
 * Selection is stored QUALIFIED BY TABLE. A bare row index is ambiguous the
 * moment a dataset has more than one table — node 3 and link 3 are different
 * rows — and the effects pass keys its highlight by index, so an unqualified set
 * would light up a link because a node with the same index was selected.
 *
 * The public surface stays index-based: every existing chart has one table, and
 * `el.select(3)` / `getSelection()` mean that table's row 3. The qualification is
 * internal, and only a multi-table chart ever sees it.
 *
 * Selection is not the belief data, so it is a SEPARATE channel from `change` — a
 * `select` listener hears it, `onChange`/`getData` never do, and it bypasses undo.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   listeners: { select: Set<Function> },
 *   primaryRows: () => any[],
 *   reportedRows: (name: string) => any[],
 *   rowIndexOf: (name: string, i: number) => number,
 *   reportedIndexOf: (name: string, j: number) => number | null,
 *   update: () => void,
 * }} deps
 */
export function createSelection(chart, deps) {
    const { schemaSpec, ui, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf } = deps;

    /** @param {string} table @param {number} index @returns {string} */
    const selKey = (table, index) => `${table}\u0000${index}`;
    /** @param {string} key @returns {{ table: string, index: number }} */
    const selParse = (key) => {
        const at = key.indexOf('\u0000');
        return { table: key.slice(0, at), index: Number(key.slice(at + 1)) };
    };
    /** The selected row indices belonging to one table, as a Set. */
    /** @param {string} table @returns {Set<number>} */
    const selectionIn = (table) => {
        /** @type {Set<number>} */
        const out = new Set();
        for (const key of ui.selection) {
            const s = selParse(key);
            if (s.table === table) out.add(s.index);
        }
        return out;
    };

    // The primary selected datum index (the FIRST member — under multi-select there
    // may be several), or null. Stale indices — a selected row later removed — read
    // as null rather than pointing at a shifted row. Reads the PRIMARY table, which
    // is what a single-table chart's "the selection" has always meant.
    const selectionPrimary = () => {
        for (const i of selectionIn(schemaSpec.primary)) {
            if (i >= 0 && i < primaryRows().length) return i;
        }
        return null;
    };

    // EVERY live selected index in one table, ascending. The counterpart to
    // selectionPrimary for anything that has to reflect a multi-row selection rather
    // than narrow it to one — a legend marking which categories the selection holds,
    // or a caller reading getSelectionAll(). Same staleness rule.
    /** @param {string} [table] @returns {number[]} */
    const selectionList = (table = schemaSpec.primary) => {
        const n = (chart.tables[table] || []).length;
        return [...selectionIn(table)].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
    };

    // The selection as the caller sees it: REPORTED indices (see reportedRows), so
    // a selected row and `getData()` agree. A selected context row has no reported
    // index and is left out.
    /** @param {string} [table] @returns {number[]} */
    const reportedSelection = (table = schemaSpec.primary) => /** @type {number[]} */ (
        selectionList(table).map((i) => reportedIndexOf(table, i)).filter((i) => i != null)
    );
    // Notify a selection change.
    const notifySelect = () => {
        const list = reportedSelection();
        const primary = list.length ? list[0] : null;
        // A single-table chart reports bare row indices, as it always has. A
        // multi-table one reports {table, index}, because a bare number there names
        // no particular row.
        const all = isBareForm(schemaSpec)
            ? [...selectionIn(schemaSpec.primary)].map((i) => reportedIndexOf(schemaSpec.primary, i)).filter((i) => i != null)
            : [...ui.selection].map(selParse)
                .map((sel) => ({ ...sel, index: reportedIndexOf(sel.table, sel.index) }))
                .filter((sel) => sel.index != null);
        for (const cb of listeners.select) cb(primary, /** @type {any} */ (all));
    };

    // Commit a SELECTION edit's proposal. Like a domain edit it writes engine state
    // that ISN'T the dataset — here `ui.selection` — so it bypasses the datum
    // splice, the data-layer constraints, AND undo history: nothing about the belief
    // data changed, so there is nothing to take back and `onChange` stays silent.
    // The descriptor is `{ index, exclusive, toggle }` (see edit.select). Returns
    // whether the selection actually moved, so the dispatch reports it as a render
    // (via shouldRender) exactly as it does for a data edit — no self-render here, so
    // the gesture path renders once. The external el.select* wrappers, which call
    // this OUTSIDE a dispatch, render themselves.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const commitSelectionEdit = (sel, table = schemaSpec.primary) => {
        const before = [...ui.selection].join(',');
        applySelection(sel, table);
        const after = [...ui.selection].join(',');
        if (before === after) return false;
        notifySelect();
        return true;
    };

    // Mutate ui.selection from a selection descriptor. `clear` empties it; an
    // `exclusive` write replaces the set; otherwise the write is ADDITIVE.
    //
    // `toggle` means "clicking what is already selected deselects it", and that
    // reads differently in the two modes — which is the whole point of having them:
    //   exclusive — deselect only when the row is the SOLE selection. Clicking one
    //     of several replaces the set with it, which is what a plain click means.
    //   additive  — deselect the row from the set, sole or not. Shift-clicking a
    //     member is the only way to take it back out.
    // Getting that second case wrong is invisible: `has && size === 1` is false for
    // a member of a multi-row selection, so the row was re-added and shift-click
    // could add but never remove.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const applySelection = (sel, table = schemaSpec.primary) => {
        if (sel.clear || sel.index == null) { ui.selection.clear(); return; }
        const key = selKey(table, sel.index);
        const has = ui.selection.has(key);
        if (sel.exclusive !== false) {
            const sole = has && ui.selection.size === 1;
            ui.selection.clear();
            if (sel.toggle && sole) return; // toggled the sole selection off — leave empty
        } else if (sel.toggle && has) {
            ui.selection.delete(key);
            return;
        }
        ui.selection.add(key);
    };

    // ── The public selection API ──────────────────────────────────────────────
    // Each goes through the SAME applySelection the edit.select gesture does, so an
    // external <select>, a keyboard, or a click all leave the selection in one shape.

    // The primary selected index (number) or null. The counterpart of getData for
    // selection; a caller reads it to drive its own UI (which row is highlighted).
    // Stays scalar under multi-select — it reports the FIRST selected row, so a
    // caller written against a single selection keeps working.
    const getSelection = () => { const list = reportedSelection(); return list.length ? list[0] : null; };

    // EVERY selected index, ascending. What to read when the chart can hold more
    // than one (edit.select({ multi: true }), el.select([…]), el.selectAll()).
    const getSelectionAll = () => reportedSelection();

    // Drive the selection from outside, then render. Each wrapper renders itself (it
    // runs OUTSIDE the dispatch, which is what renders the gesture path), and returns
    // whether the selection moved.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const driveSelection = (sel) => {
        const moved = commitSelectionEdit(sel);
        if (moved) deps.update();
        return moved;
    };

    // Select a SPECIFIC ITEM by dataset index (the external counterpart of clicking
    // a mark). `null` (or a negative / out-of-range index) clears the selection.
    // Exclusive: the named row becomes the sole selection, replacing whatever was
    // selected. An ARRAY selects exactly those rows — the whole set is replaced, so
    // the call is idempotent and there is no clear-then-add for a caller to get
    // half-right. An empty array clears, like `null`.
    /** @param {number | number[] | null} index */
    const select = (index) => {
        // Reported indices in, table indices from here on (see reportedRows).
        const rows = reportedRows(schemaSpec.primary);
        const ok = (/** @type {any} */ i) => typeof i === 'number' && i >= 0 && i < rows.length;
        const row = (/** @type {number} */ i) => rowIndexOf(schemaSpec.primary, i);
        if (Array.isArray(index)) {
            const list = index.filter(ok).map(row);
            if (!list.length) return driveSelection({ index: null, clear: true });
            // One commit, so `select` fires once and the render happens once: clear
            // through the same descriptor path, then add the rest additively.
            const before = [...ui.selection].join(',');
            applySelection({ index: list[0], exclusive: true, toggle: false });
            for (const i of list.slice(1)) applySelection({ index: i, exclusive: false, toggle: false });
            if ([...ui.selection].join(',') === before) return false;
            notifySelect();
            deps.update();
            return true;
        }
        const i = ok(index) ? row(/** @type {number} */ (index)) : null;
        return driveSelection({ index: i, exclusive: true, toggle: false, clear: i == null });
    };

    // Add or remove ONE row, leaving the rest of the selection alone — the external
    // counterpart of a shift-click (edit.select({ multi: true })).
    /** @param {number} index */
    const toggleSelection = (index) => {
        const i = typeof index === 'number' ? rowIndexOf(schemaSpec.primary, index) : -1;
        return i < 0 ? false : driveSelection({ index: i, exclusive: false, toggle: true });
    };

    // Select every row of the primary table.
    const selectAll = () => select(reportedRows(schemaSpec.primary).map((_, i) => i));

    // Select by CATEGORY / predicate: pick rows matching `{ field: value }` (or a
    // predicate function) and select them. This is the "select a category" entry
    // point — an external control names a value, the chart finds and selects the
    // rows carrying it. No match clears the selection.
    //
    // `{ all: true }` selects EVERY match; the default is the first one only. A
    // category is usually several rows, so `all` is what "select a category"
    // normally means — but changing the default would silently widen every existing
    // caller's selection, so it is opt-in.
    /** @param {any} where @param {any} [value] @param {any} [options] */
    const selectWhere = (where, value, options) => {
        const match = typeof where === 'function'
            ? /** @type {(d: any, i: number) => boolean} */ (where)
            : (/** @type {any} */ d) => d && d[where] === value;
        const rows = reportedRows(schemaSpec.primary);
        if (options && options.all) {
            const hits = rows.map((d, i) => (match(d, i) ? i : -1)).filter((i) => i >= 0);
            return select(hits.length ? hits : null);
        }
        const i = rows.findIndex(match);
        return select(i < 0 ? null : i);
    };

    // Clear the selection entirely.
    const clearSelection = () => driveSelection({ index: null, clear: true });

    return {
        selKey, selParse, selectionIn, selectionPrimary, selectionList,
        reportedSelection, notifySelect, commitSelectionEdit, applySelection, driveSelection,
        api: { getSelection, getSelectionAll, select, toggleSelection, selectAll, selectWhere, clearSelection },
    };
}
