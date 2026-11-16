// @ts-check
import { validateTables, normalizeSchema, normalizeData, denormalizeSchema, enforceRefs, coerceToType } from './schema.js';
import { nestingOf, enforceTree } from './hierarchy.js';
import { warn } from './dev.js';
import { createTables } from './engine/tables.js';
import { createHistory } from './engine/history.js';
import { createSelection } from './engine/selection.js';

/**
 * The data side of the engine: schema, rows, context, lock, constraints, undo
 * history, selection and the `change` / `select` listeners. Charts read and
 * write it; it knows them only through the hooks they attach. `api` is the
 * public `Dataset`.
 */

/**
 * The keys of a spec the dataset reads. Read live, so a later `spec.onChange`
 * is the one called.
 * @typedef {import('../types').DatasetSpec} DatasetSpec
 */

/**
 * The rows and context membership. Engine modules read these at call time.
 * @typedef {object} DataState
 * @property {Record<string, any[]>} tables  one array per table NAME
 * @property {Record<string, WeakSet<object>>} contextRows  context membership, by row identity (see core/lock.js)
 */

/**
 * What a chart drawing the dataset gives it.
 * @typedef {object} ChartHook
 * @property {() => void} update  re-render from the current data
 * @property {() => boolean} settles  can this chart settle a hierarchy (it draws node boxes)?
 * @property {() => any} snapshot  the chart's own state an undo step keeps (its size)
 * @property {(snap: any) => void} restore  put that state back on undo / redo
 * @property {(what: 'preview' | 'rows' | 'reseed') => void} drop  drop state that no
 *   longer matches the data. 'preview': the uncommitted preview (a domain change).
 *   'rows': also what indexes rows (hover, grab, driver sessions, a stroke), after
 *   another chart's commit. 'reseed': also draw a hierarchy's next layout at
 *   once, for data from outside (`setData`, `set`). Does not render.
 */

/**
 * What `attach` hands back: the chart's own way into the dataset. Commits made
 * through it are this chart's, so the dataset can tell it from the others.
 * @typedef {object} ChartPort
 * @property {() => void} detach
 * @property {() => void} notifyChange  after a commit: redraw the other charts, fire `change`
 * @property {(sel: any, table?: string) => boolean} commitSelectionEdit  a selection edit;
 *   redraws the other charts when it moved
 * @property {() => void} recordHistory  before a commit (engine/history.js)
 * @property {(type: string) => void} gestureTxn
 * @property {() => void} endTxn
 * @property {(stroking: boolean) => { space: boolean } | null} settleTurn  may this chart
 *   settle the hierarchy at render time, and push rows apart? (see `layout`)
 * @property {() => boolean} ownsLayout  were the node rows last settled by this chart?
 * @property {() => void} layoutMoved  this chart's render-time settle changed the rows:
 *   redraw the other charts
 */

/**
 * @param {DatasetSpec} spec
 * @param {(dataset: any, spec: import('../types').ChartSpec) => import('../types').Chart} makeChart
 *   builds a chart over this dataset (core/elicit.js's createChart)
 */
export function createDataset(spec, makeChart) {
    // The dataset owns a clone of the schema: a domain edit (edit.axis.*) writes it,
    // never the caller's spec. `normalizeSchema` applies the author-side sugars
    // once; `getSchema()` denormalizes on the way out.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The schema as declared: the ceiling a zoom widens back to, and what
    // `setDomain(field, null)` restores.
    const seedSchemaSpec = structuredClone(schemaSpec);

    // structuredClone keeps seed `Date` values; `normalizeData` splits rows per table.
    /** @type {DataState} */
    const state = {
        tables: normalizeData(structuredClone(spec.data ?? null), schemaSpec),
        contextRows: {},
    };

    const accessors = createTables(state, { spec, schemaSpec });
    const {
        seedContext, isContextRow, recountSeed, shapeData, primaryRows, reportedRows,
        rowIndexOf, reportedIndexOf, isLockedIn, checkRows,
    } = accessors;

    // Context rows (spec.context) are decided once, over the seed.
    seedContext();
    // Seed row counts for `lock: 'seed'`.
    recountSeed();
    // Check the seed rows against the schema once. An edit cannot add an
    // undeclared column, so the seed is the only source of a mismatch.
    validateTables(schemaSpec, state.tables);
    // A hierarchy must be a tree: drop the rows validateTables flagged.
    enforceTree(schemaSpec, state.tables);

    /** @type {ChartHook[]} */
    const charts = [];
    // A hierarchy's node rows are settled in one chart's pixels (core/fit.js).
    // `owner` is the chart whose pixels they were last settled in: it committed
    // them, or took data from outside. Only the owner re-settles at render time;
    // every other chart draws the stored boxes. `pending`: data from outside
    // (the seed, `setData`, `set`) waits to be spaced by the first chart that
    // settles it.
    /** @type {{ owner: ChartHook | null, pending: boolean }} */
    const layout = { owner: null, pending: true };
    const refresh = () => { for (const c of [...charts]) c.update(); };
    // Redraw every chart but `from` (the one that committed and renders itself),
    // first dropping what `what` names (see ChartHook.drop).
    /** @param {ChartHook | null} from @param {'preview' | 'rows' | 'reseed'} what */
    const refreshOthers = (from, what) => {
        for (const c of [...charts]) {
            if (c === from) continue;
            c.drop(what);
            c.update();
        }
    };

    // `change` per committed edit; `select` on a selection change (no data moved).
    /** @type {{ change: Set<Function>, select: Set<Function> }} */
    const listeners = { change: new Set(), select: new Set() };

    // Notify a committed change; undo/redo notify through it too.
    const notifyChange = () => {
        if (spec.onChange) spec.onChange(shapeData());
        for (const cb of listeners.change) cb(structuredClone(shapeData()));
    };

    // The selected rows, as table-qualified keys (engine/selection.js).
    /** @type {Set<string>} */
    const selected = new Set();
    const { api: selectionApi, ...selectionFns } = createSelection(state, {
        schemaSpec, selected, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf,
        update: refresh,
    });

    // One snapshot per gesture (engine/history.js).
    const history = createHistory(state, { schemaSpec, charts, layout, isContextRow, notifyChange, update: refresh });

    // Attach a chart; returns its port. Rendering the other charts never commits,
    // so a fan-out cannot loop back.
    /** @param {ChartHook} hook @returns {ChartPort} */
    const attach = (hook) => {
        charts.push(hook);
        return {
            detach: () => {
                const i = charts.indexOf(hook);
                if (i >= 0) charts.splice(i, 1);
                // The rows keep its layout; no chart re-settles them until a commit.
                if (layout.owner === hook) layout.owner = null;
            },
            notifyChange: () => {
                // A commit settles in the committing chart's pixels (compute.js).
                if (hook.settles()) layout.owner = hook;
                refreshOthers(hook, 'rows');
                notifyChange();
            },
            commitSelectionEdit: (sel, table) => {
                const moved = selectionFns.commitSelectionEdit(sel, table);
                if (moved) for (const c of [...charts]) if (c !== hook) c.update();
                return moved;
            },
            recordHistory: () => history.recordHistory(hook),
            gestureTxn: (type) => history.gestureTxn(type, hook),
            endTxn: () => history.endTxn(hook),
            settleTurn: (stroking) => {
                // Nothing is spaced mid-stroke; outside data waits for the release.
                if (layout.pending && !stroking) {
                    layout.pending = false;
                    layout.owner = hook;
                    return { space: true };
                }
                return layout.owner === hook ? { space: false } : null;
            },
            ownsLayout: () => layout.owner === hook,
            layoutMoved: () => refreshOthers(hook, 'rows'),
        };
    };

    // ── The public Dataset (types.d.ts) ────────────────────────────────────────

    // Replaces the rows and re-seeds. Skips constraints (they gate gestures);
    // under `lock: 'seed'` the new rows become the read-only seed.
    /** @param {any[] | Record<string, any[]>} data */
    const setData = (data) => {
        // A bare array is the primary table; an object names its tables.
        const next = normalizeData(structuredClone(data ?? null), schemaSpec);
        // Keep the context rows (same objects, so membership survives) ahead of
        // the new rows.
        for (const name of Object.keys(state.contextRows)) {
            const keep = (state.tables[name] || []).filter((d) => isContextRow(name, d));
            if (keep.length) next[name] = [...keep, ...(next[name] || [])];
        }
        state.tables = next;
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, state.tables, 'setData()');
        // A hierarchy gets the same ref and tree repairs a commit gets.
        if (nestingOf(schemaSpec)) {
            enforceRefs(schemaSpec, state.tables);
            enforceTree(schemaSpec, state.tables);
        }
        recountSeed();
        layout.pending = true;
        for (const c of charts) c.drop('reseed');
        selected.clear(); // a reseed's row indices are new; drop the old selection
        // A reseed is a new starting point, so undo history is cleared.
        history.reset();
        refresh();
    };

    // Sets a field's domain as one undoable step. `null` restores the declared domain.
    /** @param {string} field @param {any[] | null} domain @param {{ table?: string }} [options] */
    const setDomain = (field, domain, options = {}) => {
        const table = options && options.table != null ? options.table : schemaSpec.primary;
        const t = schemaSpec.tables[table];
        if (!t || !t.fields[field]) {
            warn(
                `setDomain:field:${table}.${field}`,
                `setDomain("${field}"): table "${table}" declares no field "${field}". ` +
                `Declared fields: ${t ? Object.keys(t.fields).map((f) => `"${f}"`).join(', ') : 'none'}.`
            );
            return false;
        }
        const seed = seedSchemaSpec.tables[table] && seedSchemaSpec.tables[table].fields[field];
        const next = domain == null ? (seed && seed.domain) : domain;
        if (!Array.isArray(next)) {
            warn(`setDomain:domain:${field}`, `setDomain("${field}"): no domain to set (none declared to restore).`);
            return false;
        }
        history.endTxn();
        history.recordHistory();
        t.fields[field] = { ...t.fields[field], domain: structuredClone(next) };
        for (const c of charts) c.drop('preview');
        notifyChange();
        history.endTxn();
        refresh();
        return true;
    };

    // Writes one cell from outside any chart, as one undoable step. The proposal
    // runs the table's invariants (constraints, then the lock) like an edit's; a
    // rejection changes nothing. `index` counts reported rows, like `select`.
    /** @param {string} field @param {any} value @param {{ index?: number, table?: string }} [options] */
    const set = (field, value, options = {}) => {
        const table = options && options.table != null ? options.table : schemaSpec.primary;
        const index = options && options.index != null ? options.index : 0;
        const t = schemaSpec.tables[table];
        if (!t || !t.fields[field]) {
            warn(
                `set:field:${table}.${field}`,
                `set("${field}"): table "${table}" declares no field "${field}". ` +
                `Declared fields: ${t ? Object.keys(t.fields).map((f) => `"${f}"`).join(', ') : 'none'}.`
            );
            return false;
        }
        const rows = state.tables[table] || [];
        const i = Number.isInteger(index) && index >= 0 ? rowIndexOf(table, index) : -1;
        if (i < 0 || i >= rows.length) {
            warn(
                `set:index:${table}`,
                `set("${field}", …, { index: ${index} }): table "${table}" has ` +
                `${reportedRows(table).length} rows; index counts them from 0, context rows left out.`
            );
            return false;
        }
        // The value in the form the field stores (a typed "250" is the number 250).
        const stored = coerceToType(value, t.fields[field]);
        if (stored === undefined) {
            warn(
                `set:value:${table}.${field}`,
                `set("${field}", ${JSON.stringify(value)}): a ${t.fields[field].type} field cannot hold this value.`
            );
            return false;
        }
        if (Object.is(rows[i][field], stored)) return false;
        const locked = isLockedIn(table);
        if (locked && locked(rows[i], i)) return false;
        const proposed = rows.map((d, j) => (j === i ? { ...d, [field]: stored } : d));
        const checked = checkRows(table, proposed, { activeIndex: i, field });
        if (!checked) return false;
        // A repair may rebuild rows with the values they already had: nothing to commit.
        const same = (/** @type {any} */ a, /** @type {any} */ b) => a === b || (!!a && !!b
            && Object.keys(a).length === Object.keys(b).length
            && Object.keys(a).every((k) => Object.is(a[k], b[k])));
        if (checked.length === rows.length && checked.every((d, j) => same(d, rows[j]))) return false;
        history.endTxn();
        history.recordHistory();
        state.tables[table] = checked;
        // Drop rows whose `ref` no longer resolves, as a commit does.
        enforceRefs(schemaSpec, state.tables);
        history.endTxn();
        // Data from outside: every chart redraws; the first to render settles a hierarchy.
        layout.pending = true;
        refreshOthers(null, 'reseed');
        notifyChange();
        return true;
    };

    // Subscribe to `change` or `select`; returns an unsubscribe function.
    /** @param {string} type @param {Function} cb */
    const on = (type, cb) => {
        if (type !== 'change' && type !== 'select') {
            warn(`on:${type}`, `on("${type}"): no such event. A dataset fires "change" and "select"; a chart also fires "stage".`);
            return () => false;
        }
        listeners[type].add(cb);
        return () => listeners[type].delete(cb);
    };

    /** @type {import('../types').Dataset} */
    const api = {
        chart: (chartSpec) => makeChart(dataset, chartSpec),
        // A deep copy; structuredClone keeps Date values.
        getData: () => structuredClone(shapeData()),
        // A deep copy of the live schema, in the spelling the author gave.
        getSchema: () => structuredClone(denormalizeSchema(schemaSpec)),
        setData,
        setDomain,
        set,
        undo: history.undo,
        redo: history.redo,
        canUndo: history.canUndo,
        canRedo: history.canRedo,
        on,
        ...selectionApi,
    };

    const dataset = {
        api,
        get tables() { return state.tables; },
        set tables(v) { state.tables = v; },
        get contextRows() { return state.contextRows; },
        set contextRows(v) { state.contextRows = v; },
        schemaSpec, seedSchemaSpec,
        ...accessors,
        selection: selected,
        selectionIn: selectionFns.selectionIn,
        selectionPrimary: selectionFns.selectionPrimary,
        selectionList: selectionFns.selectionList,
        selectionApi,
        listeners,
        // Commits, history and selection edits go through a chart's port.
        attach,
    };
    return dataset;
}

/** @typedef {ReturnType<typeof createDataset>} Dataset */
