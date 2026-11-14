// @ts-check
import { resolveLock, resolveContext, lockConstraint } from '../lock.js';
import { isBareForm } from '../schema.js';
import { warn } from '../dev.js';

/**
 * The dataset's accessors: which table a feature draws and an edit writes,
 * which rows are context or locked, what the chart reports, and each table's
 * constraints. Rows are read from `chart.tables` at call time.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{ spec: import('../../types').ElicitSpec, schemaSpec: import('../../types').SchemaSpec }} deps
 */
export function createTables(chart, deps) {
    const { spec, schemaSpec } = deps;

    // The one table a feature draws.
    /** @param {any} feature @returns {any[]} */
    const tableOf = (feature) => chart.tables[feature.table] || [];
    // The table an edit writes: its `table` role, else its mark's table. The one
    // resolver, so computeEdit and runEdit can't disagree.
    /** @param {any} feature @param {import('../../types').Edit} edit @returns {string} */
    const targetTableOf = (feature, edit) =>
        (edit && edit.table && schemaSpec.byRole[edit.table]) || feature.table;
    // The primary table's rows.
    const primaryRows = () => chart.tables[schemaSpec.primary];

    // Context rows (spec.context): drawn and locked, left out of what the chart
    // reports. Decided once over the seed and held by row identity, so an answer
    // dragged into the context region is never swallowed.
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
    // A table's rows minus context rows. The index-addressed API uses these
    // indices, so `getData()[i]` and `el.select(i)` name the same row.
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
    // The reported dataset for getData/onChange: a bare array for a single-table
    // chart, else keyed by table.
    const shapeData = () => {
        if (isBareForm(schemaSpec)) return reportedRows(schemaSpec.primary);
        /** @type {Record<string, any[]>} */
        const out = {};
        for (const name of Object.keys(chart.tables)) out[name] = reportedRows(name);
        return out;
    };

    // Locked rows (spec.lock, see core/lock.js), resolved per table and memoized.
    // Seed counts are read live because setData re-seeds.
    /** @type {Record<string, number>} */
    let seedCounts = {};
    // Count the rows each table was seeded with (at Elicit() and on setData).
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
            // Context rows are locked too. `contextRows` is read live; setData and undo rebuild it.
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

    // `spec.constraints`, bucketed by table (deduped by identity). A constraint
    // applies to the primary table unless `constraint.table` names a role or table.
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
