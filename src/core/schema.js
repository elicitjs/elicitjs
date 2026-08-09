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
// This module holds four things and only these:
//   schemaDefaults(schema)          the starting row a creator mints
//   inferSchema(data)               best-effort schema FROM rows (diagnostics only)
//   inferMeasureOfDomain(domain)    measure type of a domain an axis edit just wrote
//   validateDataset(schema, data)   the diagnostics below
//
// It deliberately does NOT resolve scales. `core/resolve.js` owns that and calls the
// inference helpers here; the split is "what the data IS" (here) vs "how a channel
// draws it" (there).
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
