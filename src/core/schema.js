// @ts-check
// schema.js — the owner of the elicited dataset's schema: every column's measurement
// type, and optionally its domain and creation default. Nothing else defines it.
// It normalizes the author's spelling (normalizeSchema, normalizeData), mints
// creation defaults (schemaDefaults) and checks the seed rows once per Elicit() /
// setData() (validateTables). Scales are resolved in core/resolve.js.
//
// `structure` names the tables' roles (`table` -> `data`; `network` -> `nodes`,
// `links`; `hierarchy` -> `nodes`, `nesting`, optional `links`); readers resolve by
// role, never by name. Sugars: (1) a bare field map is a single-table schema, (2) a
// bare table entry takes its role from its name, (3) a bare-array `data` is the
// primary table. See .claude/rules/data-and-schema.md.

import { warn } from './dev.js';
import { inferMeasureType, inferDomainFromValues } from './encoding.js';
import { nestingOf, treeProblems } from './hierarchy.js';

// Rows scanned when validating. A violation is a property of the dataset, so a
// bounded scan finds it.
const SAMPLE_ROWS = 200;

// ── Structures ──────────────────────────────────────────────────────────────
// A structure is a role list plus its primary role; a new structure is a row here.
// `optional` roles may be left out (a hierarchy may have no links; a network must).
// Names describe the data, never the visual (`network`, not `graph`).
/** @type {Record<string, { roles: string[], primary: string, optional?: string[] }>} */
export const STRUCTURES = {
    table: { roles: ['data'], primary: 'data' },
    network: { roles: ['nodes', 'links'], primary: 'nodes' },
    hierarchy: { roles: ['nodes', 'nesting', 'links'], optional: ['links'], primary: 'nodes' },
};

/** The structure assumed when a schema declares none — one table, named `data`. */
const DEFAULT_STRUCTURE = 'table';

/**
 * The one name reserved inside a table entry's bare-map sugar. `role` is not
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
    // A field map's values are all objects; a FieldSchema holds primitives or
    // arrays. Testing key names would misread a column called `key` or `domain`.
    const values = Object.values(v);
    if (values.length && values.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return false;
    return typeof v.type === 'string'
        || 'domain' in v || 'default' in v || 'key' in v || 'open' in v;
}

/**
 * What a links table says about its pairs:
 *
 *   directed   source→target is a direction (tri-state; see normalizeTable)
 *   multi      one pair may be joined by more than one link
 *   selfLoops  a link may join a node to itself
 *
 * Facts about the data, read here so the network edits cannot disagree.
 */
const LINK_FACTS = ['directed', 'multi', 'selfLoops'];

/**
 * The keys a table wrapper may carry beside its columns. `role` is what the
 * structure means by the table; the LINK_FACTS are what a pair of its `ref` columns
 * means (see normalizeTable).
 */
const WRAPPER_KEYS = ['role', 'fields', ...LINK_FACTS];

/**
 * Is this a table entry in wrapper form (`{ role?, directed?, fields }`) rather than
 * the bare field-map sugar? A string `role` settles it. Otherwise every key must be
 * a wrapper key, so a table with a column called `fields` keeps its other columns.
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
 * The LINK_FACTS an entry states, each only when it is a boolean — an absent fact
 * stays absent, so "not stated" never reads as `false`.
 * @param {any} entry
 * @returns {{ directed?: boolean, multi?: boolean, selfLoops?: boolean }}
 */
function linkFactsOf(entry) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const fact of LINK_FACTS) {
        if (typeof entry[fact] === 'boolean') out[fact] = entry[fact];
    }
    return out;
}

/**
 * Bring a table entry to `{ role, fields, key, directed, multi, selfLoops }`.
 *
 * `directed` lives on the table (resolved via `byRole`) and is tri-state: `true`
 * (arrows, reciprocal pairs apart, `reverse` meaningful), `false` (A→B and B→A are
 * one edge), `undefined` (no opinion; must behave as before the flag existed).
 * `multi` and `selfLoops` say whether a gesture may add a parallel link or a loop;
 * both default to no. Existing rows still draw; only an explicit `false` reports
 * them (`validateTables`).
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
        // Undecidable: a lone `fields` whose value is itself a FieldSchema (a
        // wrapper, or a column named `fields`). Report it rather than guess.
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
            ...linkFactsOf(entry),
        };
    }
    // Bare field-map sugar: the role is the table's own name. A boolean under a
    // LINK_FACTS name is the table's fact (a FieldSchema is an object), not a column.
    const facts = linkFactsOf(entry);
    if (Object.keys(facts).length) {
        warn(
            `schema:${name}:fact-as-column`,
            `table "${name}" states ${Object.keys(facts).map((k) => `\`${k}\``).join(', ')} beside its ` +
            `columns. Read as the table's fact; the long form keeps the two apart: ` +
            `${name}: { ${Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join(', ')}, fields: { … } }.`
        );
        /** @type {Record<string, any>} */
        const columns = {};
        for (const k of Object.keys(entry)) if (!(k in facts)) columns[k] = entry[k];
        entry = columns;
    }
    if (Object.prototype.hasOwnProperty.call(entry, RESERVED_FIELD)) {
        throw new Error(
            `[elicit] table "${name}" declares a column named "${RESERVED_FIELD}", which is ` +
            `reserved in this short form — it is how a table entry says "here are my ` +
            `columns". Use the long form to keep the column: ` +
            `${name}: { fields: { ${RESERVED_FIELD}: … } }.`
        );
    }
    return { name, role: name, fields: entry, key: keyFieldOf(entry, name), ...facts };
}

/**
 * Bring any schema spelling to the canonical `SchemaSpec`, so no other module
 * re-sniffs how it was written. Applies the three sugars and validates the role
 * binding (every role filled once, no unknown roles, no duplicates). These throw:
 * without a role binding there is no dataset.
 *
 * @param {any} schema the author's `spec.schema`
 * @returns {import('../types').SchemaSpec}
 */
export function normalizeSchema(schema) {
    const declared = schema && typeof schema === 'object' ? schema : {};
    // A string-valued `structure` is the discriminator; anything else means the
    // whole object is a bare field map (sugar 1) — including a column called
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

    // Context rows belong to the elicited table (`spec.context`), not a table of
    // their own; the table form is reported precisely.
    const entries = isCanonical && declared.tables && typeof declared.tables === 'object'
        ? Object.entries(declared.tables) : Object.entries(declared);
    for (const [name, entry] of entries) {
        if (entry && typeof entry === 'object' && entry.context === true) {
            throw new Error(
                `[elicit] schema entry "${name}" is \`{ context: true, … }\`. Context is not a ` +
                `table: put the reference rows in the elicited table and mark them with ` +
                `\`context\` on the spec — \`context: true\` (every seeded row) or a ` +
                `predicate, \`context: d => d.year <= 2020\`.`
            );
        }
    }

    /** @type {Record<string, any>} */
    let rawTables;
    if (!isCanonical) {
        // Sugar 1 — the bare field map is the primary table of a single-table chart.
        rawTables = { [def.primary]: declared };
    } else if (declared.tables && typeof declared.tables === 'object') {
        rawTables = declared.tables;
    } else if (declared.fields && typeof declared.fields === 'object') {
        // A near-miss worth naming precisely: `fields` at the top level looks right
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

    const optional = def.optional || [];
    const missing = def.roles.filter((r) => !byRole[r] && !optional.includes(r));
    if (missing.length) {
        throw new Error(
            `[elicit] structure "${structure}" needs a table for ` +
            `${missing.map((r) => `"${r}"`).join(', ')}, but the schema declares none. ` +
            `The schema is the contract of the elicited dataset, and a table built ` +
            `entirely by gesture has no rows to infer one from — declare it, even empty.`
        );
    }

    // The link facts only mean something on the links table; warn elsewhere.
    for (const [name, table] of Object.entries(tables)) {
        if (table.role === 'links') continue;
        for (const fact of LINK_FACTS) {
            if (/** @type {any} */ (table)[fact] === undefined) continue;
            warn(
                `schema:${fact}:${name}`,
                `table "${name}" declares \`${fact}\`, but that describes the pairs of ` +
                `\`ref\` columns in a links table, and this table fills the "${table.role}" role. ` +
                `Move it to the table filling the "links" role, or drop it.`
            );
        }
    }

    return { structure, tables, byRole, primary: byRole[def.primary] };
}

/**
 * Is the network this schema describes directed? The one reader of the flag.
 * `undefined` (no opinion) must stay distinct from `false` (unordered pairs).
 * @param {import('../types').SchemaSpec} spec
 * @returns {boolean | undefined}
 */
export function isDirected(spec) {
    const name = spec && spec.byRole && spec.byRole.links;
    const table = name ? spec.tables[name] : null;
    return table ? table.directed : undefined;
}

/**
 * What the links table allows a gesture to make: a second link between one pair
 * (`multi`) and a link from a node to itself (`selfLoops`). Read here, once, so
 * `connect` and `rewire` cannot disagree. Unstated means no.
 * @param {import('../types').SchemaSpec} spec
 * @returns {{ multi: boolean, selfLoops: boolean }}
 */
export function linkRulesOf(spec) {
    const name = spec && spec.byRole && spec.byRole.links;
    const table = /** @type {any} */ (name ? spec.tables[name] : null);
    return { multi: !!(table && table.multi), selfLoops: !!(table && table.selfLoops) };
}

/**
 * A table's field map; an unknown or missing name reads the primary table.
 * @param {import('../types').SchemaSpec} spec
 * @param {string | null} [table]
 * @returns {Record<string, import('../types').FieldSchema>}
 */
export function fieldsOf(spec, table) {
    return (spec.tables[/** @type {string} */ (table)] || spec.tables[spec.primary]).fields;
}

/**
 * Is this dataset in the short form (one table named `data` under the default
 * structure)? Decides whether getSchema()/getData() return bare or keyed by table.
 * @param {import('../types').SchemaSpec} spec
 * @returns {boolean}
 */
export function isBareForm(spec) {
    const def = STRUCTURES[spec.structure];
    const names = Object.keys(spec.tables);
    return spec.structure === DEFAULT_STRUCTURE && names.length === 1 && names[0] === def.primary;
}

/**
 * The canonical form back in the author's spelling (the inverse of sugar 1), so
 * `el.getSchema()` on a single-table chart returns the bare field map.
 * @param {import('../types').SchemaSpec} spec
 * @returns {any}
 */
export function denormalizeSchema(spec) {
    if (isBareForm(spec)) return spec.tables[spec.primary].fields;
    /** @type {Record<string, any>} */
    const tables = {};
    for (const [name, t] of Object.entries(spec.tables)) {
        const facts = linkFactsOf(t);
        const extra = Object.keys(facts).length ? facts : null;
        tables[name] = t.role === name && !extra
            ? t.fields
            : { ...(t.role === name ? {} : { role: t.role }), ...extra, fields: t.fields };
    }
    return { structure: spec.structure, tables };
}

/**
 * Where a `ref` field points: the table and column holding the identities it names.
 *
 *   omitted      -> the nodes-role table (or the primary), at its `key: true` field
 *   'id'         -> that same table, at the named column
 *   'links.id'   -> another table, at the named column
 *
 * @param {import('../types').SchemaSpec} spec
 * @param {import('../types').FieldSchema} field the `ref` field's schema
 * @returns {{ table: string, field: string } | null} null when it cannot be resolved
 */
function refTargetOf(spec, field) {
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
 * Drop every row whose `ref` names an identity that no longer exists (deleting a
 * node removes its links). Enforced by the engine because `type: 'ref'` declares
 * the rule, and it spans tables, which a constraint cannot. Repeats until a chain
 * of references settles.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables mutated in place
 * @returns {boolean} whether anything was dropped
 */
export function enforceRefs(spec, tables) {
    // Which (table, field) pairs are references, and where each points.
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
            // A ref that is not yet set (null) is a half-built row, not a dangling one.
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
 * Bring `spec.data` to one rows array per table, keyed by table name. A bare array
 * is the primary table (sugar 3); an omitted table seeds `[]`.
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
 * Best-effort measure type for a domain a caller left undeclared but an axis edit
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
 * Derive a schema from rows, only for the paste-ready "data but no schema" warning;
 * never a runtime substitute for a declared schema.
 * @param {any[]} data
 * @returns {Record<string, import('../types').FieldSchema>}
 */
function inferSchema(data) {
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
            // A discrete domain read off the seed is a guess, so mark it open; a
            // continuous [min, max] stays closed.
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
 * Does a value contradict a declared measure type? Lenient: a temporal field may
 * hold an epoch number or an ISO string. Only continuous measures are checked; any
 * value can be a category key (a geo mark declares GeoJSON categorical), so a
 * discrete field is constrained by its domain instead.
 * @param {any} value
 * @param {import('../types').MeasureType} type
 * @returns {boolean}
 */
function contradictsType(value, type) {
    if (type === 'quantitative') {
        // NaN is how a data file spells "missing" — it breaks a line like null.
        if (typeof value === 'number' && Number.isNaN(value)) return false;
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
 * Bring a value a gesture produced (a typed string, a snapped number) into the form
 * the field's measure stores: a number for quantitative (empty string -> null), a
 * Date for temporal, anything for discrete. `undefined` for a value the measure
 * cannot hold, so the caller refuses the write. The one coercion site.
 * @param {any} value
 * @param {import('../types').FieldSchema | undefined} field
 * @returns {any} the stored form, or `undefined` to refuse
 */
export function coerceToType(value, field) {
    const type = field && field.type;
    if (type === 'quantitative') {
        if (value == null) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
        if (typeof value === 'string') {
            if (value.trim() === '') return null;
            const n = Number(value);
            return Number.isFinite(n) ? n : undefined;
        }
        if (value instanceof Date) return value.getTime();
        return undefined;
    }
    if (type === 'temporal') {
        if (value == null) return null;
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
        if (typeof value === 'number' || typeof value === 'string') {
            if (typeof value === 'string' && value.trim() === '') return null;
            const d = new Date(value);
            return Number.isNaN(d.getTime()) ? undefined : d;
        }
        return undefined;
    }
    return value;
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
 * Compare a seed dataset against its schema and report every disagreement through
 * `warn`. Never throws or mutates; a chart with a bad seed still renders.
 *   schema:missing        data with no schema
 *   schema:extra:<col>    a column the schema doesn't declare (a minted row lacks it)
 *   schema:notype:<f>     a FieldSchema with a domain but no `type`
 *   schema:type:<f>       a value contradicting the declared measure type
 *   schema:domain:<f>     a value outside the declared domain; skipped for `open` fields
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
        // An open domain is a starting set, not a ceiling, so a value outside it is fine.
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
 * Run the seed checks over every table: `validateDataset` per table, plus refs,
 * link pairs and the tree. A table name enters a message only when there are several.
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
        if (spec.tables[name].role === 'links') validatePairs(spec, tables, name, scoped);
    }
    validateTree(spec, tables, label);
}

/**
 * What a hierarchy's nesting table must be to describe a tree: two `ref` columns,
 * one parent per child, nothing inside itself. The engine drops the offending rows
 * (`enforceTree`); this is what tells the author it did.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @param {string} label
 * @returns {void}
 */
function validateTree(spec, tables, label) {
    const name = spec.byRole.nesting;
    if (!name) return;
    if (!nestingOf(spec)) {
        warn(
            `schema:nesting:${name}`,
            `table "${name}" fills the "nesting" role, which needs two \`ref\` columns (the ` +
            `contained node, then its container) and a \`key: true\` column on the nodes ` +
            `table for them to name. Nothing can be nested until then.`
        );
        return;
    }
    const WHY = {
        'second-parent': 'already has a parent. A node sits inside at most one other',
        self: 'is nested inside itself',
        cycle: 'would sit inside one of its own descendants',
    };
    for (const p of treeProblems(spec, tables)) {
        warn(
            `schema:tree:${name}:${p.kind}`,
            `${label}.${name} nests ${JSON.stringify(p.child)} in ${JSON.stringify(p.parent)}, ` +
            `but ${JSON.stringify(p.child)} ${WHY[p.kind]}. The row is ignored.`
        );
    }
}

/**
 * A links table that declares `multi: false` or `selfLoops: false` and seeds a
 * parallel pair or a loop contradicts itself. Only an explicit `false` is checked.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @param {string} name @param {string} label
 * @returns {void}
 */
function validatePairs(spec, tables, name, label) {
    const table = /** @type {any} */ (spec.tables[name]);
    if (table.multi !== false && table.selfLoops !== false) return;
    const refs = Object.keys(table.fields).filter((f) => table.fields[f] && table.fields[f].type === 'ref');
    if (refs.length < 2) return;
    const [source, target] = refs;
    const seen = new Set();
    for (const row of tables[name] || []) {
        if (!row) continue;
        const a = row[source];
        const b = row[target];
        if (table.selfLoops === false && a != null && a === b) {
            warn(
                `schema:selfLoops:${name}`,
                `${label} has a link from ${JSON.stringify(a)} to itself, but the "${name}" table ` +
                `declares selfLoops: false. Remove the row, or declare selfLoops: true.`
            );
        }
        if (table.multi === false) {
            const ordered = table.directed === false && String(b) < String(a) ? [b, a] : [a, b];
            const key = JSON.stringify(ordered);
            if (seen.has(key)) {
                warn(
                    `schema:multi:${name}`,
                    `${label} links ${JSON.stringify(a)} and ${JSON.stringify(b)} more than once, ` +
                    `but the "${name}" table declares multi: false. Remove the duplicate, or ` +
                    `declare multi: true.`
                );
            }
            seen.add(key);
        }
    }
}

/**
 * A `ref` naming an identity that does not exist. Cross-table, so it lives here
 * rather than in validateDataset.
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
