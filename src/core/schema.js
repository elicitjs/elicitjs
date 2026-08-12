// @ts-check
// schema.js — the OWNER of the elicited dataset's schema.
//
// The schema is the contract of the thing being elicited: for every column of the
// output dataset it declares the measurement TYPE and (optionally) the DOMAIN and a
// creation DEFAULT. Everything else in the library reads it and nothing else may
// define it — a channel has no `domain`/`range`, a mark has no data type of its own.
//
// Before this module existed the schema had no home: elicit.js cloned it,
// resolve.js inferred from it, edit/shared.js minted from it and elicit.js's axis
// edits wrote to it — four files, and NOWHERE that checked the data against it. So
// a typo'd column, a value outside a declared domain, or a whole spec with `data`
// and no `schema` all rendered a chart that quietly disagreed with its own contract.
// For a belief-elicitation library that is the worst class of bug available: the
// chart looks right and the elicited data is wrong.
//
// This module holds these and only these:
//   normalizeSchema(schema)         author spelling -> the canonical SchemaSpec
//   denormalizeSchema(spec)         the canonical form -> the author's spelling back
//   normalizeData(data, spec)       author `data` -> one rows array per table
//   schemaDefaults(schema)          the starting row a creator mints
//   inferSchema(data)               best-effort schema FROM rows (diagnostics only)
//   inferMeasureOfDomain(domain)    measure type of a domain an axis edit just wrote
//   validateDataset(schema, data)   the diagnostics below
//
// It deliberately does NOT resolve scales. `core/resolve.js` owns that and calls the
// inference helpers here; the split is "what the data IS" (here) vs "how a channel
// draws it" (there).
//
// ── STRUCTURE: which tables a dataset has ───────────────────────────────────
// A chart elicits ONE dataset, and the dataset's STRUCTURE says what shape it is:
// a set of named tables, each filling a ROLE the structure defines.
//
//   structure: 'table'    (the default)  one table, role `data`
//   structure: 'network'                 roles `nodes` and `links`
//
// The NAME is the data key; the ROLE is what the structure means by it. They are
// separate so an argument map can call its tables `claims` and `supports` and still
// have `link` marks and `edit.network.*` find them — those resolve by ROLE, never by
// name, which is what makes renaming free.
//
// `structure` is deliberately not spelled `type`: `type` is always a MeasureType
// here (see types.d.ts), and a third meaning inside a map of FieldSchemas is exactly
// the drift the API-consistency pass removed.
//
// Three sugars keep every pre-structure spec valid, forever:
//   1. a bare field map IS a single-table schema
//        { gdp: {…} }  ->  { structure:'table', tables:{ data:{ role:'data', … } } }
//   2. a table entry that is a bare field map takes its role from its own NAME
//        tables: { nodes: { id: {…} } }  ->  role 'nodes'
//   3. `spec.data` as a bare array is the primary table's rows
//
// Detection never guesses. A FieldSchema is always an OBJECT, so a string-valued
// `structure` cannot collide with a column called `structure`, and a string-valued
// `role` cannot collide with a column called `role` (a very plausible column name —
// `role: { type:'categorical', domain:['claim','reason'] }` stays a column). The one
// genuine collision is a column named `fields` in the bare-map sugar of a table
// entry, which is why that single name is reserved THERE and reported rather than
// misread. The wrapper form has no such restriction.
//
// ── When validation runs ────────────────────────────────────────────────────
// Once per Elicit() and once per setData()/reseed — on the SEED rows, not on every
// render and not after an edit. Seed rows are the author's input, so that is the
// only place a mismatch can originate: an edit mints rows from schemaDefaults and
// writes through a channel's own field, so it cannot invent a column.

import { warn } from './dev.js';
import { inferMeasureType, inferDomainFromValues } from './encoding.js';

// Rows scanned when checking columns/types/domains. A schema violation is a
// property of the dataset, not of a particular row, so a bounded scan finds it just
// as well as a full one — and keeps validation flat for a 100k-row seed.
const SAMPLE_ROWS = 200;

// ── Structures ──────────────────────────────────────────────────────────────
// A structure is nothing but a ROLE LIST plus which role is primary. That is the
// whole extension point: a new structure is a row in this table, not a branch
// anywhere else. (A role list of one is an ordinary single-table schema, which is
// why a future `hierarchy` — a self-`ref` on a `parent` column — needs no second
// table and no new machinery.)
//
// Values are singular nouns naming the data's STRUCTURE, never the visual:
// `network` rather than `graph`, because "graph" means "chart" in a viz library.
/** @type {Record<string, { roles: string[], primary: string }>} */
export const STRUCTURES = {
    table: { roles: ['data'], primary: 'data' },
    network: { roles: ['nodes', 'links'], primary: 'nodes' },
};

/** The structure assumed when a schema declares none — one table, named `data`. */
export const DEFAULT_STRUCTURE = 'table';

/**
 * The one name reserved inside a table entry's BARE-MAP sugar. `role` is NOT
 * reserved: the wrapper's `role` is a string and a FieldSchema is an object, so a
 * column called `role` is unambiguous. `fields` is the only real collision.
 */
const RESERVED_FIELD = 'fields';

/**
 * Does this value look like a FieldSchema rather than a map of them? Used only to
 * turn the one genuinely undecidable table entry into an error instead of a silent
 * misread — see normalizeTable.
 * @param {any} v
 * @returns {boolean}
 */
function looksLikeFieldSchema(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return typeof v.type === 'string'
        || 'domain' in v || 'default' in v || 'key' in v || 'open' in v;
}

/**
 * The keys a table WRAPPER may carry beside its columns. `role` is what the
 * structure means by the table; `directed` is what an ordered pair of its `ref`
 * columns means (see normalizeTable).
 */
const WRAPPER_KEYS = ['role', 'fields', 'directed'];

/**
 * Is this a table entry in WRAPPER form (`{ role?, directed?, fields }`) rather than
 * the bare field-map sugar?
 *
 * A string `role` settles it: the wrapper's role is a string and a FieldSchema is
 * an object, so a COLUMN called `role` never trips this. Otherwise the entry must
 * consist of nothing BUT the wrapper keys — checking only for a `fields` key would
 * read `{ fields: {type:'quantitative'}, x: {…} }` (a table with a column called
 * `fields`) as a wrapper and silently drop every other column.
 * @param {any} entry
 * @returns {boolean}
 */
function isTableWrapper(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (typeof entry.role === 'string') return true;
    if (!entry.fields || typeof entry.fields !== 'object') return false;
    return Object.keys(entry).every((k) => WRAPPER_KEYS.includes(k));
}

/**
 * The single field flagged `key: true` in a table, or null. A key is what a `ref`
 * points at by default, and what a gesture mints a new identity into.
 * @param {Record<string, any>} fields
 * @param {string} name the table name, for the error message
 * @returns {string | null}
 */
function keyFieldOf(fields, name) {
    const keys = Object.keys(fields).filter((f) => fields[f] && fields[f].key === true);
    if (keys.length > 1) {
        throw new Error(
            `[elicit] table "${name}" declares more than one \`key: true\` field ` +
            `(${keys.map((k) => `"${k}"`).join(', ')}). A table has at most one key — ` +
            `it is the identity a \`ref\` points at.`
        );
    }
    return keys.length ? keys[0] : null;
}

/**
 * Bring a table entry to `{ role, fields, key, directed }`.
 *
 * `directed` is a fact about what an ORDERED PAIR of this table's `ref` columns
 * means, which is why it lives on the table rather than on a channel or on the
 * schema root: it survives renaming (it is resolved through `byRole` like
 * everything else), and it leaves room for further link semantics later without
 * adding a key to the root that only one structure would ever read.
 *
 * It is deliberately TRI-STATE. `true` says source→target is a direction (arrows
 * by default, reciprocal pairs drawn apart, `edit.network.reverse` meaningful);
 * `false` says the pair is unordered (A→B and B→A are the same edge, so `connect`
 * refuses the duplicate); `undefined` says the schema has no opinion, which is
 * every chart written before this existed and must keep behaving identically.
 *
 * @param {string} name the table's name (its data key)
 * @param {any} entry
 * @returns {import('../types').TableSchema}
 */
function normalizeTable(name, entry) {
    if (!entry || typeof entry !== 'object') {
        throw new Error(
            `[elicit] schema.tables.${name} must be a field map, or ` +
            `{ role, fields }. Got ${entry === null ? 'null' : typeof entry}.`
        );
    }
    if (isTableWrapper(entry)) {
        // The one genuinely undecidable case: a lone `fields` key whose value is
        // itself a FieldSchema. That is either a wrapper, or a one-column table
        // whose column is called `fields` — nothing in the value says which. Report
        // it rather than pick, because either reading silently produces the wrong
        // dataset, and a wrong dataset that still draws is the worst failure here.
        if (typeof entry.role !== 'string' && looksLikeFieldSchema(entry.fields)) {
            throw new Error(
                `[elicit] table "${name}" is ambiguous: \`fields\` is its only key and its ` +
                `value looks like a single FieldSchema, so this reads equally as the long ` +
                `form or as a one-column table whose column is called "fields". Say which: ` +
                `${name}: { fields: { fields: … } } for the column, or add \`role\` for the ` +
                `long form.`
            );
        }
        const fields = entry.fields || {};
        return {
            name,
            role: entry.role || name,
            fields,
            key: keyFieldOf(fields, name),
            ...(typeof entry.directed === 'boolean' ? { directed: entry.directed } : {}),
        };
    }
    // Bare field-map sugar: the role is the table's own name.
    if (Object.prototype.hasOwnProperty.call(entry, RESERVED_FIELD)) {
        throw new Error(
            `[elicit] table "${name}" declares a column named "${RESERVED_FIELD}", which is ` +
            `reserved in this short form — it is how a table entry says "here are my ` +
            `columns". Use the long form to keep the column: ` +
            `${name}: { fields: { ${RESERVED_FIELD}: … } }.`
        );
    }
    return { name, role: name, fields: entry, key: keyFieldOf(entry, name) };
}

/**
 * Bring any schema spelling to the canonical `SchemaSpec` — the shape every
 * internal reader takes, so no other module ever re-sniffs how it was written.
 *
 * Applies the three sugars (see the header) and VALIDATES the role binding: every
 * role of the structure filled exactly once, no unknown roles, no duplicates.
 * These are ERRORS, not warnings: unlike a bad value, an unbound role means there
 * is no dataset to build, so there is nothing to draw and nothing to elicit.
 *
 * @param {any} schema the author's `spec.schema`
 * @returns {import('../types').SchemaSpec}
 */
export function normalizeSchema(schema) {
    const declared = schema && typeof schema === 'object' ? schema : {};
    // A string-valued `structure` is the discriminator; anything else means the
    // whole object is a bare field map (sugar 1) — including a COLUMN called
    // `structure`, whose value is a FieldSchema object.
    const isCanonical = typeof declared.structure === 'string';
    const structure = isCanonical ? declared.structure : DEFAULT_STRUCTURE;

    const def = STRUCTURES[structure];
    if (!def) {
        throw new Error(
            `[elicit] unknown schema structure "${structure}". Known structures: ` +
            `${Object.keys(STRUCTURES).map((s) => `"${s}"`).join(', ')}.`
        );
    }

    /** @type {Record<string, any>} */
    let rawTables;
    if (!isCanonical) {
        // Sugar 1 — the bare field map is the primary table of a single-table chart.
        rawTables = { [def.primary]: declared };
    } else if (declared.tables && typeof declared.tables === 'object') {
        rawTables = declared.tables;
    } else if (declared.fields && typeof declared.fields === 'object') {
        // A near-miss worth naming precisely: `fields` at the TOP level looks right
        // but skips the table that owns them, so nothing can be named or referenced.
        throw new Error(
            `[elicit] schema declares \`fields\` at the top level. Columns belong to a ` +
            `named TABLE: schema: { structure: "${structure}", tables: { ` +
            `${def.primary}: { … } } }.`
        );
    } else {
        throw new Error(
            `[elicit] schema declares structure "${structure}" but no \`tables\`. ` +
            `A structure is a set of named tables: tables: { ` +
            `${def.roles.map((r) => `${r}: { … }`).join(', ')} }.`
        );
    }

    /** @type {Record<string, import('../types').TableSchema>} */
    const tables = {};
    /** @type {Record<string, string>} */
    const byRole = {};
    for (const [name, entry] of Object.entries(rawTables)) {
        const table = normalizeTable(name, entry);
        if (!def.roles.includes(table.role)) {
            throw new Error(
                `[elicit] table "${name}" claims role "${table.role}", which structure ` +
                `"${structure}" does not define. Its roles are ` +
                `${def.roles.map((r) => `"${r}"`).join(', ')}.`
            );
        }
        if (byRole[table.role]) {
            throw new Error(
                `[elicit] tables "${byRole[table.role]}" and "${name}" both claim role ` +
                `"${table.role}". Each role is filled by exactly one table.`
            );
        }
        byRole[table.role] = name;
        tables[name] = table;
    }

    const missing = def.roles.filter((r) => !byRole[r]);
    if (missing.length) {
        throw new Error(
            `[elicit] structure "${structure}" needs a table for ` +
            `${missing.map((r) => `"${r}"`).join(', ')}, but the schema declares none. ` +
            `The schema is the contract of the elicited dataset, and a table built ` +
            `entirely by gesture has no rows to infer one from — declare it, even empty.`
        );
    }

    // `directed` says what an ordered pair of `ref` columns means, so it is only
    // meaningful on the table that HAS such a pair. Declared anywhere else it reads
    // as a statement that quietly does nothing.
    for (const [name, table] of Object.entries(tables)) {
        if (table.directed !== undefined && table.role !== 'links') {
            warn(
                `schema:directed:${name}`,
                `table "${name}" declares \`directed\`, but that describes what an ordered ` +
                `pair of \`ref\` columns means and this table fills the "${table.role}" role. ` +
                `Move it to the table filling the "links" role, or drop it.`
            );
        }
    }

    return { structure, tables, byRole, primary: byRole[def.primary] };
}

/**
 * Is the network this schema describes DIRECTED? The one place the flag is read, so
 * `link`, `connect` and `reverse` cannot disagree about it — and so nothing outside
 * here has to know it lives on a table rather than on the structure.
 *
 * Returns `undefined` when the schema has no opinion, which callers must keep
 * distinct from `false`: "unordered pair" and "not stated" ask for different
 * defaults (see link's `arrow: 'auto'`).
 * @param {import('../types').SchemaSpec} spec
 * @returns {boolean | undefined}
 */
export function isDirected(spec) {
    const name = spec && spec.byRole && spec.byRole.links;
    const table = name ? spec.tables[name] : null;
    return table ? table.directed : undefined;
}

/**
 * Is this dataset spelled the SHORT way — exactly what sugars 1 and 3 produce, one
 * table named `data` under the default structure? That is every pre-structure chart,
 * and it is what decides whether the schema and the rows go back out to the caller
 * bare (`getSchema()` -> a field map, `getData()` -> an array) or keyed by table.
 * @param {import('../types').SchemaSpec} spec
 * @returns {boolean}
 */
export function isBareForm(spec) {
    const def = STRUCTURES[spec.structure];
    const names = Object.keys(spec.tables);
    return spec.structure === DEFAULT_STRUCTURE && names.length === 1 && names[0] === def.primary;
}

/**
 * The canonical form back in the author's spelling — the inverse of sugar 1, so
 * `el.getSchema()` on an ordinary single-table chart returns the bare field map it
 * has always returned. Without this the engine going canonical internally would be
 * a silent breaking change for every existing consumer.
 * @param {import('../types').SchemaSpec} spec
 * @returns {any}
 */
export function denormalizeSchema(spec) {
    if (isBareForm(spec)) return spec.tables[spec.primary].fields;
    /** @type {Record<string, any>} */
    const tables = {};
    for (const [name, t] of Object.entries(spec.tables)) {
        const extra = t.directed !== undefined ? { directed: t.directed } : null;
        tables[name] = t.role === name && !extra
            ? t.fields
            : { ...(t.role === name ? {} : { role: t.role }), ...extra, fields: t.fields };
    }
    return { structure: spec.structure, tables };
}

/**
 * Where a `ref` field points: the table and column that hold the identities it
 * names. `to` is optional because the answer is almost always "the nodes table's
 * key", and a reference you have to spell out twice is one that can disagree with
 * itself.
 *
 *   omitted      -> the NODES-role table (or the primary), at its `key: true` field
 *   'id'         -> that same table, at the named column
 *   'links.id'   -> another table, at the named column
 *
 * @param {import('../types').SchemaSpec} spec
 * @param {import('../types').FieldSchema} field the `ref` field's schema
 * @returns {{ table: string, field: string } | null} null when it cannot be resolved
 */
export function refTargetOf(spec, field) {
    const to = field && typeof field.to === 'string' ? field.to : null;
    const defaultTable = spec.byRole.nodes || spec.primary;

    if (to && to.includes('.')) {
        const dot = to.indexOf('.');
        const table = to.slice(0, dot);
        const column = to.slice(dot + 1);
        return spec.tables[table] ? { table, field: column } : null;
    }
    const table = spec.tables[defaultTable];
    if (!table) return null;
    const column = to || table.key;
    return column ? { table: defaultTable, field: column } : null;
}

/**
 * The identities a `ref` may name: the target column's declared domain, widened by
 * the values actually present. Widened because a key is normally `open` — a gesture
 * mints new ones — so the declared list is a starting set, not a ceiling.
 * @param {import('../types').SchemaSpec} spec
 * @param {import('../types').FieldSchema} field
 * @param {Record<string, import('../types').Datum[]>} tables
 * @returns {any[]}
 */
export function refDomain(spec, field, tables) {
    const target = refTargetOf(spec, field);
    if (!target) return [];
    const declared = spec.tables[target.table].fields[target.field];
    const out = [...((declared && declared.domain) || [])];
    for (const row of (tables && tables[target.table]) || []) {
        const v = row ? row[target.field] : undefined;
        if (v !== undefined && v !== null && !out.includes(v)) out.push(v);
    }
    return out;
}

/**
 * Drop every row whose `ref` names an identity that no longer exists.
 *
 * This is enforced by the ENGINE off the schema, not by a constraint the author
 * opts into, because `type: 'ref'` already declares the rule — a reference that
 * names nothing is not a preference about the data, it is a contradiction of what
 * the schema says the column IS. Deleting a node has to take its links with it, and
 * making that optional would mean the default behaviour of a graph editor is to
 * accumulate invisible garbage in the elicited output.
 *
 * A plain constraint could not do this anyway: constraints judge ONE table's rows
 * and return that table's rows, while a dangling reference is created in one table
 * (delete a node) and repaired in another (drop its links).
 *
 * Runs after a commit, and repeatedly, so a chain of references settles (a ref to a
 * row that was itself dropped for a dangling ref goes too).
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables mutated in place
 * @returns {boolean} whether anything was dropped
 */
export function enforceRefs(spec, tables) {
    // Which (table, field) pairs are references, and where each points. Computed
    // once per call — the schema doesn't change mid-commit.
    /** @type {{ table: string, field: string, target: { table: string, field: string } }[]} */
    const refs = [];
    for (const [name, table] of Object.entries(spec.tables)) {
        for (const [field, fieldSpec] of Object.entries(table.fields)) {
            if (!fieldSpec || fieldSpec.type !== 'ref') continue;
            const target = refTargetOf(spec, fieldSpec);
            if (target) refs.push({ table: name, field, target });
        }
    }
    if (!refs.length) return false;

    let dropped = false;
    // Bounded by the number of ref edges: each pass either removes rows or stops,
    // and a cascade can only be as deep as the reference graph.
    for (let pass = 0; pass <= refs.length; pass++) {
        let passDropped = false;
        for (const ref of refs) {
            const rows = tables[ref.table];
            if (!rows || !rows.length) continue;
            const known = new Set();
            for (const row of tables[ref.target.table] || []) {
                const v = row ? row[ref.target.field] : undefined;
                if (v !== undefined && v !== null) known.add(v);
            }
            // A ref that is not yet SET (null) is a half-built row, not a dangling
            // one — a gesture mints the row before it names the far end. Only a
            // value that IS set and names nothing is a contradiction.
            const kept = rows.filter((row) => {
                const v = row ? row[ref.field] : undefined;
                return v === undefined || v === null || known.has(v);
            });
            if (kept.length !== rows.length) {
                tables[ref.table] = kept;
                passDropped = true;
                dropped = true;
            }
        }
        if (!passDropped) break;
    }
    return dropped;
}

/**
 * Bring `spec.data` to one rows array per table, keyed by table NAME.
 *
 * A bare array is the primary table (sugar 3) — which is why every existing chart
 * passes its data unchanged. A table the author omits seeds `[]`, so a blank-canvas
 * diagram (build the whole graph by gesture) needs no `data` at all.
 * @param {any} data
 * @param {import('../types').SchemaSpec} spec
 * @returns {Record<string, import('../types').Datum[]>}
 */
export function normalizeData(data, spec) {
    /** @type {Record<string, import('../types').Datum[]>} */
    const tables = {};
    for (const name of Object.keys(spec.tables)) tables[name] = [];

    if (data == null) return tables;

    if (Array.isArray(data)) {
        tables[spec.primary] = data;
        return tables;
    }

    if (typeof data !== 'object') {
        throw new Error(
            `[elicit] data must be an array of rows, or an object keyed by table name ` +
            `(${Object.keys(spec.tables).map((n) => `"${n}"`).join(', ')}). Got ${typeof data}.`
        );
    }

    for (const [name, rows] of Object.entries(data)) {
        if (!tables[name]) {
            warn(
                `data:table:${name}`,
                `data has a table "${name}" that the schema does not declare. The schema is ` +
                `the contract of the elicited dataset, so every table belongs in it; these ` +
                `rows are ignored. Declared tables: ` +
                `${Object.keys(spec.tables).map((n) => `"${n}"`).join(', ')}.`
            );
            continue;
        }
        if (!Array.isArray(rows)) {
            throw new Error(
                `[elicit] data.${name} must be an array of rows. Got ` +
                `${rows === null ? 'null' : typeof rows}.`
            );
        }
        tables[name] = rows;
    }
    return tables;
}

/**
 * The starting values a minted datum gets from the dataset schema: every declared
 * field, set to its explicit `default` when given, else `null` (present but unset,
 * to be set later by an edit). Returns {} when no schema is declared.
 * @param {Record<string, import('../types').FieldSchema> | undefined} schema
 * @returns {Record<string, any>}
 */
export function schemaDefaults(schema) {
    /** @type {Record<string, any>} */
    const out = {};
    if (!schema) return out;
    for (const [field, spec] of Object.entries(schema)) {
        out[field] = spec && spec.default !== undefined ? spec.default : null;
    }
    return out;
}

/**
 * Best-effort measure type for a DOMAIN a caller left undeclared but an axis edit
 * just wrote (a numeric range, or a discrete value list). Only used to synthesize a
 * missing schema entry — a declared field keeps its own type.
 * @param {any[]} domain
 * @returns {import('../types').MeasureType}
 */
export function inferMeasureOfDomain(domain) {
    const vals = domain || [];
    if (vals.some((v) => v instanceof Date)) return 'temporal';
    if (vals.every((v) => typeof v === 'number')) return 'quantitative';
    return 'categorical';
}

/**
 * Every column name present across a bounded sample of rows.
 * @param {any[]} data
 * @returns {string[]}
 */
function columnsOf(data) {
    /** @type {Set<string>} */
    const cols = new Set();
    for (const row of data.slice(0, SAMPLE_ROWS)) {
        if (row && typeof row === 'object') for (const k of Object.keys(row)) cols.add(k);
    }
    return [...cols];
}

/**
 * The non-null values of one column, from a bounded sample.
 * @param {any[]} data
 * @param {string} field
 * @returns {any[]}
 */
function valuesOf(data, field) {
    const out = [];
    for (const row of data.slice(0, SAMPLE_ROWS)) {
        const v = row ? row[field] : undefined;
        if (v !== undefined && v !== null) out.push(v);
    }
    return out;
}

/**
 * Derive a schema from rows: the shape the author should have declared. Used to
 * make the "you passed data but no schema" warning actionable (it prints a
 * paste-ready schema) — NOT as a runtime substitute for a declared schema, which
 * stays the contract. Scale resolution does its own per-channel inference.
 * @param {any[]} data
 * @returns {Record<string, import('../types').FieldSchema>}
 */
export function inferSchema(data) {
    /** @type {Record<string, import('../types').FieldSchema>} */
    const out = {};
    if (!Array.isArray(data) || !data.length) return out;
    for (const field of columnsOf(data)) {
        const values = valuesOf(data, field);
        const type = inferMeasureType(values);
        const discrete = type === 'categorical' || type === 'ordinal';
        out[field] = {
            type,
            domain: inferDomainFromValues(discrete ? 'band' : 'linear', values),
            // A discrete domain read off the seed rows is a GUESS — the categories
            // that happened to be present — not a vocabulary the author fixed. Mark
            // it open so the suggestion doesn't quietly become a ceiling the moment
            // it's pasted in (a continuous [min,max] is a genuine extent, so it
            // stays closed).
            ...(discrete ? { open: true } : {})
        };
    }
    return out;
}

/**
 * Render an inferred schema as source an author can paste into their spec.
 * @param {Record<string, import('../types').FieldSchema>} schema
 * @returns {string}
 */
function schemaSource(schema) {
    const body = Object.entries(schema)
        .map(([f, s]) => `  ${JSON.stringify(f)}: { type: ${JSON.stringify(s.type)}, domain: ${JSON.stringify(s.domain)}`
            + `${s.open ? ', open: true' : ''} }`)
        .join(',\n');
    return `schema: {\n${body}\n}`;
}

/**
 * Does a value contradict a declared measure type? Deliberately lenient — this
 * reports contradictions, not style. A temporal field may legitimately hold an
 * epoch number or an ISO string (createScale coerces both), so neither is flagged.
 *
 * Only the CONTINUOUS measures are checkable. For `categorical`/`ordinal` there is
 * no value that contradicts the type — anything can serve as a category key, and a
 * geo mark legitimately declares a whole GeoJSON geometry object as a categorical
 * column. What actually constrains a discrete field is its DOMAIN, which is checked
 * separately; a runtime-type check there is a false positive by construction.
 * @param {any} value
 * @param {import('../types').MeasureType} type
 * @returns {boolean}
 */
function contradictsType(value, type) {
    if (type === 'quantitative') {
        return typeof value !== 'number' || !Number.isFinite(value);
    }
    if (type === 'temporal') {
        if (value instanceof Date) return Number.isNaN(value.getTime());
        if (typeof value === 'number') return !Number.isFinite(value);
        if (typeof value === 'string') return Number.isNaN(new Date(value).getTime());
        return true;
    }
    return false;
}

/**
 * Is a value outside a declared domain? A continuous domain is [min, max]; a
 * discrete one is the allowed value list.
 * @param {any} value
 * @param {import('../types').MeasureType} type
 * @param {any[]} domain
 * @returns {boolean}
 */
function outsideDomain(value, type, domain) {
    if (!Array.isArray(domain) || !domain.length) return false;
    if (type === 'quantitative' || type === 'temporal') {
        if (domain.length < 2) return false;
        const n = value instanceof Date ? value.getTime() : Number(value);
        if (!Number.isFinite(n)) return false;      // a type violation, reported separately
        const bounds = domain.map((d) => (d instanceof Date ? d.getTime() : Number(d)));
        const lo = Math.min(...bounds);
        const hi = Math.max(...bounds);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
        return n < lo || n > hi;
    }
    return !domain.includes(value);
}

/**
 * Compare a seed dataset against the schema that is supposed to describe it, and
 * report every disagreement through `warn` (on by default, deduped per key, off via
 * setWarnings(false)). Never throws and never mutates — a chart with a bad seed
 * still renders; the author just gets told.
 *
 * The five checks, and why each is a real defect:
 *   schema:missing        data with no schema — the elicited output has no contract.
 *   schema:extra:<col>    a data column the schema doesn't declare. The schema is the
 *                         contract of the OUTPUT dataset, so an undeclared column
 *                         either belongs in the schema or doesn't belong in the data;
 *                         it also silently escapes domain unioning and creation
 *                         defaults, so a minted row won't have it.
 *   schema:notype:<f>     a FieldSchema with a domain but no `type`. `type` is
 *                         required, and without it the measure is inferred from data
 *                         — which can disagree with the domain that was declared.
 *   schema:type:<f>       a value contradicting the declared measure type.
 *   schema:domain:<f>     a value outside the declared domain. The domain is what
 *                         the axis spans, so such a row draws clipped or off-plot.
 *                         Skipped for an `open` field, whose domain is a starting
 *                         set rather than a ceiling.
 *
 * @param {Record<string, import('../types').FieldSchema> | undefined} schema
 * @param {any[]} data
 * @param {string} [label] how this dataset is named in a message ('data' | 'setData()')
 * @returns {void}
 */
export function validateDataset(schema, data, label = 'data') {
    if (!Array.isArray(data) || !data.length) return;
    const declared = schema || {};
    const fields = Object.keys(declared);

    if (!fields.length) {
        warn(
            'schema:missing',
            `${label} was given but the spec declares no schema. The schema is the contract ` +
            `of the elicited dataset — it owns each field's measurement type and domain, and ` +
            `is what a created row is minted from. Inferring both from the data for now; ` +
            `declare it:\n${schemaSource(inferSchema(data))}`
        );
        return;
    }

    for (const col of columnsOf(data)) {
        if (declared[col]) continue;
        warn(
            `schema:extra:${col}`,
            `${label} has a column "${col}" that the schema does not declare. The schema is ` +
            `the contract of the elicited dataset, so every column belongs in it — an ` +
            `undeclared one gets no domain, no type and no creation default, so a row made ` +
            `by an edit will be missing it. Declare it: schema: { ${JSON.stringify(col)}: ` +
            `{ type: ${JSON.stringify(inferMeasureType(valuesOf(data, col)))} } }.`
        );
    }

    for (const [field, spec] of Object.entries(declared)) {
        if (!spec) continue;
        const values = valuesOf(data, field);

        if (!spec.type) {
            if (spec.domain) {
                warn(
                    `schema:notype:${field}`,
                    `schema.${field} declares a domain but no \`type\`. A field's measurement ` +
                    `type is required — without it the type is inferred from the data and can ` +
                    `disagree with the domain you declared. Add ` +
                    `type: ${JSON.stringify(inferMeasureOfDomain(spec.domain))}.`
                );
            }
            continue;
        }

        const bad = values.find((v) => contradictsType(v, spec.type));
        if (bad !== undefined) {
            warn(
                `schema:type:${field}`,
                `${label} has a value in "${field}" (${JSON.stringify(bad)}) that contradicts its ` +
                `declared type "${spec.type}". The schema owns the data type; either fix the ` +
                `value or declare the type the data actually has.`
            );
            continue;   // a type mismatch makes the domain check meaningless
        }

        const domain = spec.domain;
        // An OPEN domain is a starting set, not a ceiling: it admits values it has
        // not seen (edit.stack.cut appends one, and resolveScales widens the scale on
        // the next render), so a value outside it is the declared behaviour rather
        // than a defect. Every other check above still applies.
        if (!domain || spec.open) continue;
        const out = values.find((v) => outsideDomain(v, spec.type, domain));
        if (out !== undefined) {
            warn(
                `schema:domain:${field}`,
                `${label} has a value in "${field}" (${JSON.stringify(out)}) outside its declared ` +
                `domain ${JSON.stringify(spec.domain)}. The domain is what the axis spans, so ` +
                `that row draws clipped or off-plot. Widen the domain or fix the data.`
            );
        }
    }
}

/**
 * Run the seed checks over every table of a dataset. The per-table checker is
 * `validateDataset` above and is unchanged — this only says WHICH rows go with
 * WHICH field map, which is the whole difference a structure makes.
 *
 * The table name only enters a message when there is more than one table to
 * confuse it with, so a single-table chart's diagnostics read exactly as before.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @param {string} [label] how this dataset is named in a message ('data' | 'setData()')
 * @returns {void}
 */
export function validateTables(spec, tables, label = 'data') {
    const names = Object.keys(spec.tables);
    for (const name of names) {
        const scoped = names.length > 1 ? `${label}.${name}` : label;
        validateDataset(spec.tables[name].fields, tables[name] || [], scoped);
        validateRefs(spec, tables, name, scoped);
    }
}

/**
 * The sixth check, and the one a structure adds: a `ref` naming an identity that
 * does not exist. It is the schema-level defect a network can have — the row draws
 * (or, for a link, silently doesn't) while the dataset says a thing is connected to
 * something that isn't there.
 *
 * Only reachable across tables, which is why it lives in validateTables rather than
 * in the per-table checker.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @param {string} name the table being checked
 * @param {string} label how it is named in a message
 * @returns {void}
 */
function validateRefs(spec, tables, name, label) {
    const fields = spec.tables[name].fields;
    const rows = tables[name] || [];
    if (!rows.length) return;

    for (const [field, fieldSpec] of Object.entries(fields)) {
        if (!fieldSpec || fieldSpec.type !== 'ref') continue;
        const target = refTargetOf(spec, fieldSpec);
        if (!target) {
            warn(
                `schema:ref:${name}:${field}`,
                `schema.${name}.${field} is a \`ref\` but its target cannot be resolved` +
                `${fieldSpec.to ? ` (to: ${JSON.stringify(fieldSpec.to)})` : ''}. A ref points at ` +
                `a table's \`key: true\` column — declare one, or name the column with ` +
                `\`to\`. Nothing references anything until then.`
            );
            continue;
        }
        const known = new Set(refDomain(spec, fieldSpec, tables));
        const bad = valuesOf(rows, field).find((v) => !known.has(v));
        if (bad !== undefined) {
            warn(
                `schema:dangling:${name}:${field}`,
                `${label} has a value in "${field}" (${JSON.stringify(bad)}) that names no row of ` +
                `"${target.table}" (its ${JSON.stringify(target.field)}). A \`ref\` must name an ` +
                `existing identity — a link to a node that isn't there connects nothing, and ` +
                `draws nothing.`
            );
        }
    }
}
