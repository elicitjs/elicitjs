// @ts-check
import { resolveLock, resolveContext, lockConstraint } from '../lock.js';
import { isBareForm } from '../schema.js';
import { warn } from '../dev.js';

/**
 * The belief store's accessors: which table a feature draws and an edit writes,
 * which rows are CONTEXT, which are LOCKED, what the chart REPORTS, and which
 * invariants hold over each table.
 *
 * ONE dataset for the chart, whose STRUCTURE the schema declares. Every mark is a
 * view over one of its tables, encoding some columns and (where it carries an
 * edit) writing them back. The rows themselves live on `chart.tables`, because a
 * commit replaces them; everything here reads them at call time.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{ spec: import('../../types').ElicitSpec, schemaSpec: import('../../types').SchemaSpec }} deps
 */
export function createTables(chart, deps) {
    const { spec, schemaSpec } = deps;

    // Every mark draws exactly ONE table, so the engine hands `tableOf(feature)`
    // wherever it used to hand the single dataset — which is why no mark's build(),
    // no edit's apply() and no constraint body had to change for structures.
    /** @param {any} feature @returns {any[]} */
    const tableOf = (feature) => chart.tables[feature.table] || [];
    // WHICH TABLE an edit writes. THE one place this is decided — computeEdit reads
    // it to build the proposal and runEdit reads it to commit, so the two can never
    // disagree and splice a link proposal over the node rows. An edit names its
    // target by ROLE (`table: 'links'`) so a renamed schema still resolves; with none
    // it writes the table its own mark draws, which is every pre-structure edit.
    /** @param {any} feature @param {import('../../types').Edit} edit @returns {string} */
    const targetTableOf = (feature, edit) =>
        (edit && edit.table && schemaSpec.byRole[edit.table]) || feature.table;
    // The PRIMARY table: what a bare-array `data` seeds, what a mark with no `table`
    // draws, and what the index-addressed selection API means.
    const primaryRows = () => chart.tables[schemaSpec.primary];

    // CONTEXT rows (spec.context, see core/lock.js): reference rows of a table —
    // observed history behind a forecast — drawn and locked like any locked row,
    // and left out of everything the chart REPORTS. Context is not a table of its
    // own: the rows share the table's columns, so nothing is declared twice and the
    // two can never disagree on a type.
    //
    // Membership is decided ONCE, over the seed, and held as row IDENTITY: a
    // predicate re-asked of live rows would swallow an answer dragged into its
    // region. The lock keeps the identity stable (a locked row survives every
    // commit as the same object), undo carries it as indices, and setData keeps the
    // context rows. A table is a key here exactly when `spec.context` speaks for it.
    const seedContext = () => {
        chart.contextRows = {};
        let seen = 0;
        let matched = 0;
        for (const name of Object.keys(chart.tables)) {
            const pred = resolveContext(spec.context, name);
            if (!pred) continue;
            /** @type {WeakSet<object>} */
            const set = new WeakSet();
            chart.tables[name].forEach((d, i) => {
                seen++;
                if (d && typeof d === 'object' && pred(d, i)) { set.add(d); matched++; }
            });
            chart.contextRows[name] = set;
        }
        if (seen && !matched) {
            warn(
                'spec:context:none',
                `spec.context matched none of the ${seen} seeded rows, so nothing is drawn as ` +
                `context. It is asked once, of the rows in \`data\` (and kept by setData).`
            );
        }
    };
    /** @param {string} name @param {any} d @returns {boolean} */
    const isContextRow = (name, d) =>
        !!(chart.contextRows[name] && d && typeof d === 'object' && chart.contextRows[name].has(d));
    // What the chart REPORTS of a table: its rows minus the context rows. The
    // index-addressed public API (selection, control) speaks THESE indices, so
    // `getData()[i]` and `el.select(i)` always name the same row.
    /** @param {string} name @returns {any[]} */
    const reportedRows = (name) => {
        const rows = chart.tables[name] || [];
        return chart.contextRows[name] ? rows.filter((d) => !isContextRow(name, d)) : rows;
    };
    // A reported index -> the row's index in the table, or -1.
    /** @param {string} name @param {number} i @returns {number} */
    const rowIndexOf = (name, i) => {
        if (!chart.contextRows[name]) return i;
        const rows = chart.tables[name] || [];
        let k = -1;
        for (let j = 0; j < rows.length; j++) {
            if (isContextRow(name, rows[j])) continue;
            if (++k === i) return j;
        }
        return -1;
    };
    // A table index -> its reported index, or null for a context row.
    /** @param {string} name @param {number} j @returns {number | null} */
    const reportedIndexOf = (name, j) => {
        if (!chart.contextRows[name]) return j;
        const rows = chart.tables[name] || [];
        if (isContextRow(name, rows[j])) return null;
        let k = 0;
        for (let m = 0; m < j && m < rows.length; m++) if (!isContextRow(name, rows[m])) k++;
        return k;
    };
    // The dataset in the caller's own spelling, for getData/onChange: a bare array
    // when that is how it came in (every single-table chart), else keyed by table.
    // Context rows are drawn, never elicited, so they are left out.
    const shapeData = () => {
        if (isBareForm(schemaSpec)) return reportedRows(schemaSpec.primary);
        /** @type {Record<string, any[]>} */
        const out = {};
        for (const name of Object.keys(chart.tables)) out[name] = reportedRows(name);
        return out;
    };

    // Read-only rows (see core/lock.js). `lock: 'seed'` fixes the rows the chart was
    // seeded with — they are given, not elicited — while leaving every later row
    // free; a predicate locks rows by what they ARE. Two halves: a dataset invariant
    // (run last in computeEdit, so a lock has the final word) and a `locked` stamp on
    // those rows' scene nodes, which makes them pointer-transparent and invisible to
    // proximity picking.
    //
    // Seeding is PER TABLE — "the rows this table started with" — so the predicate
    // and its constraint are resolved per table and memoized. The counts are read
    // live because setData re-seeds.
    /** @type {Record<string, number>} */
    let seedCounts = {};
    // (Re)count the rows each table was seeded with: once at Elicit(), and again
    // whenever setData hands in a new seed.
    const recountSeed = () => {
        seedCounts = {};
        for (const name of Object.keys(chart.tables)) seedCounts[name] = chart.tables[name].length;
    };
    /** @type {Record<string, ((d: any, i: number) => boolean) | null>} */
    const lockPredicates = {};
    /** @type {Record<string, import('../../types').Constraint | null>} */
    const lockConstraints = {};
    /** @param {string} name @returns {((d: any, i: number) => boolean) | null} */
    const isLockedIn = (name) => {
        if (!(name in lockPredicates)) {
            // A CONTEXT row is read-only: the lock's two halves (the invariant, and
            // the pointer-transparent `locked` stamp) are exactly what "drawn, never
            // elicited" means. Reads `contextRows` live — setData and undo rebuild it.
            const lock = resolveLock(spec.lock, () => seedCounts[name] || 0, name);
            lockPredicates[name] = !(name in chart.contextRows) ? lock
                : lock ? (d, i) => isContextRow(name, d) || lock(d, i)
                : (d) => isContextRow(name, d);
        }
        return lockPredicates[name];
    };
    /** @param {string} name @returns {import('../../types').Constraint | null} */
    const lockRowsIn = (name) => {
        if (!(name in lockConstraints)) {
            const pred = isLockedIn(name);
            lockConstraints[name] = pred ? lockConstraint(pred) : null;
        }
        return lockConstraints[name];
    };

    // The dataset's invariants, gathered once, from `spec.constraints` — the ONE
    // place they are declared. An invariant holds for EVERY edit over the rows,
    // whichever mark fired it, which is what makes a rule gate a drag on any part of
    // a glyph. Deduped by identity so the same constraint object listed twice runs
    // once.
    //
    // A mark used to accept `constraints` as sugar and the engine promoted it here.
    // That was a lie the spec could not see through: it READ as scoped to the mark
    // that declared it and never was, so a `count({ max })` written on one of two
    // marks silently capped the whole dataset. The mark option is gone; the
    // correction is in MISTAKEN_OPTIONS (plot/mark.js).
    //
    // Bucketing is scoped to a TABLE, because a constraint is an invariant over ROWS
    // and two tables' rows are different things — a rule written about nodes must not
    // run on a link edit and see columns it has never heard of. A constraint takes
    // the primary table unless it names another (`constraint.table`, a role or a
    // name). On a single-table chart every constraint lands in the one bucket.
    /** @type {Record<string, import('../../types').Constraint[]>} */
    const constraintsByTable = {};
    /** @param {import('../../types').Constraint} c @param {string} table */
    const promoteConstraint = (c, table) => {
        const list = constraintsByTable[table] || (constraintsByTable[table] = []);
        if (!list.includes(c)) list.push(c);
    };
    for (const c of spec.constraints || []) {
        const named = /** @type {any} */ (c).table;
        promoteConstraint(c, (named && (schemaSpec.byRole[named] || (schemaSpec.tables[named] && named)))
            || schemaSpec.primary);
    }
    /** @param {string} table @returns {import('../../types').Constraint[]} */
    const constraintsIn = (table) => constraintsByTable[table] || [];

    return {
        tableOf, targetTableOf, primaryRows,
        seedContext, isContextRow, reportedRows, rowIndexOf, reportedIndexOf, shapeData,
        recountSeed, isLockedIn, lockRowsIn, constraintsIn,
    };
}
