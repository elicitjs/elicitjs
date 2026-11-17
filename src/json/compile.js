// @ts-check
// compile.js: a JSON spec -> the spec `Elicit()` takes.
//
//   { "type": "barY", "channels": { … } }   ->   plot.barY({ channels: { … } })
//
// The walk is directed by the tables in src/vocabulary.js: which keys hold factory
// results (SPEC_SLOTS), which options take a function (SPEC_FUNCTIONS), which
// arguments are positional (SPEC_POSITIONAL) and which keys hold the author's data
// and are never entered (SPEC_OPAQUE). A descriptor's namespace comes from where it
// sits, never from its keyword.

import {
    SPEC_SLOTS, SPEC_FUNCTIONS, SPEC_POSITIONAL, SPEC_OPAQUE, baseMark, baseElement,
} from '../vocabulary.js';
import { normalizeSchema } from '../core/schema.js';
import { compileExpr } from './expr.js';
import { lookupFunction } from './functions.js';
import { keywordTables } from './keywords.js';

/** @param {any} v @returns {v is Record<string, any>} */
export function isPlain(v) {
    if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

/**
 * A function reference: `{ "fn": "<name>" }` or `{ "expr": "<expression>" }`.
 * @param {any} v
 * @returns {v is { fn: string } | { expr: string }}
 */
export function isRef(v) {
    if (!isPlain(v)) return false;
    const keys = Object.keys(v);
    return keys.length === 1 && (keys[0] === 'fn' || keys[0] === 'expr') && typeof v[keys[0]] === 'string';
}

/** The kinds a keyword's options are looked up under, most specific first.
 *  @param {string} ns @param {string} type @returns {string[]} */
export function ownersOf(ns, type) {
    if (ns === 'plot') return [`plot.${baseMark(type) || type}`, 'mark'];
    if (ns === 'elements') return [baseElement(type) || type];
    if (ns === 'edit') return [`edit.${type}`, 'edit'];
    if (ns === 'widgets') return [`widgets.${type}`, 'widget'];
    if (ns === 'guides' || ns === 'constraints') return [`${ns}.${type}`];
    return [];
}

/** The signature of a function option, or undefined when the option takes none.
 *  @param {string[]} owners @param {string} key */
export function signatureOf(owners, key) {
    for (const owner of owners) {
        const table = SPEC_FUNCTIONS[owner];
        if (table && (table[key] || table['*'])) return table[key] || table['*'];
    }
    return undefined;
}

/** The owners an option object nested under `key` is read as, or null.
 *  @param {string[]} owners @param {string} key @returns {string[] | null} */
export function nestedOwners(owners, key) {
    if (key === 'outline') return ['outline'];
    if (key === 'tip' && owners.includes('mark')) return ['tip'];
    if (key === 'grid' && owners.includes('axis')) return ['grid'];
    return null;
}

/**
 * Build `compile` over a set of namespaces. The library passes its own; a test
 * passes spies.
 * @param {import('./keywords.js').Namespaces} namespaces
 * @returns {(json: any, options?: { functions?: Record<string, Function> }) => any}
 */
export function createCompiler(namespaces) {
    /** @type {import('./keywords.js').KeywordTables | null} */
    let tables = null;
    // Built on first use, so a bundle that never compiles keeps tree-shaking.
    const keywords = () => tables || (tables = keywordTables(namespaces));

    return function compile(json, { functions } = {}) {
        /** @param {string} path @param {string} message @returns {never} */
        function fail(path, message) {
            throw new Error(`[elicit] compile: ${path || 'spec'}: ${message}`);
        }

        /**
         * @param {{ fn?: string, expr?: string }} ref
         * @param {string[] | string | undefined} signature
         * @param {string} path
         * @returns {Function}
         */
        function resolveRef(ref, signature, path) {
            if (!signature) {
                fail(path, 'this option takes no function, so `fn` and `expr` mean nothing here.');
            }
            if (typeof ref.fn === 'string') {
                const fn = lookupFunction(ref.fn, functions);
                if (typeof fn !== 'function') {
                    fail(path, `no function is registered as "${ref.fn}". Pass it to ` +
                        `compile(json, { functions: { ${ref.fn} } }) or call registerFunction("${ref.fn}", fn).`);
                }
                return /** @type {Function} */ (fn);
            }
            if (signature === 'fn') {
                fail(path, 'this option takes a registered function, { "fn": "<name>" }, not an `expr`.');
            }
            try {
                return compileExpr(String(ref.expr), /** @type {string[] | string} */ (signature));
            } catch (err) {
                return fail(path, `expr ${JSON.stringify(ref.expr)}: ${/** @type {Error} */ (err).message}`);
            }
        }

        /**
         * One value in a slot: a descriptor, a named member, a function reference,
         * or a value that is already built.
         * @param {any} value
         * @param {string} key the slot's key
         * @param {string} path
         * @returns {any}
         */
        function slot(value, key, path) {
            const def = SPEC_SLOTS[key];
            if (Array.isArray(value)) {
                return value.map((v, i) => slot(v, key, `${path}[${i}]`)).flat(Infinity);
            }
            if (isRef(value)) return resolveRef(value, def.fn, path);
            const ns = def.ns[0];
            if (typeof value === 'string') {
                if (ns === 'format') return value;
                if (ns === 'when') {
                    const member = keywords().when.get(value);
                    if (!member) fail(path, `unknown predicate "${value}". Predicates are: ${[...keywords().when.keys()].join(', ')}.`);
                    if (SPEC_POSITIONAL[`when.${value}`]) {
                        fail(path, `"${value}" takes ${SPEC_POSITIONAL[`when.${value}`].join(', ')}: write { "type": "${value}", … }.`);
                    }
                    return member;
                }
                fail(path, `expected { "type": … }, got the string "${value}".`);
            }
            if (!isPlain(value)) return value;
            return descriptor(value, def.ns, path);
        }

        /**
         * `{ type, ...options }` -> `factory(...positional, options)`.
         * @param {Record<string, any>} value
         * @param {string[]} spaces the namespaces to look the keyword up in
         * @param {string} path
         * @returns {any}
         */
        function descriptor(value, spaces, path) {
            const { type, ...rest } = value;
            if (typeof type !== 'string') {
                fail(path, `a descriptor needs a "type" naming a ${spaces.join(' or ')} keyword.`);
            }
            const ns = spaces.find((space) => keywords()[space].has(type));
            if (!ns) {
                const known = spaces.flatMap((space) => [...keywords()[space].keys()]).sort();
                fail(path, `unknown ${spaces.join(' / ')} keyword "${type}". Keywords are: ${known.join(', ')}.`);
            }
            const space = /** @type {string} */ (ns);
            const factory = /** @type {Function} */ (keywords()[space].get(type));
            const owners = ownersOf(space, type);
            const positional = SPEC_POSITIONAL[`${space}.${type}`];

            // `when` and `format` members take positional arguments only.
            if (space === 'when' || space === 'format') {
                if (!positional) fail(path, `"${type}" takes no arguments: write "${type}" as a string.`);
                const extra = Object.keys(rest).filter((k) => !positional.includes(k));
                if (extra.length) fail(path, `${space}.${type} takes ${positional.join(', ')}, not ${extra.join(', ')}.`);
                const args = positional.map((name) => rest[name]);
                while (args.length && args[args.length - 1] === undefined) args.pop();
                return factory(...args);
            }

            /** @type {any[]} */
            const args = [];
            for (const name of positional || []) {
                if (name !== 'fn') {
                    args.push(rest[name]);
                } else if (typeof rest.fn === 'function') {
                    args.push(rest.fn);
                } else if (typeof rest.fn === 'string' && rest.expr === undefined) {
                    args.push(resolveRef({ fn: rest.fn }, signatureOf(owners, 'fn'), `${path}.fn`));
                } else if (typeof rest.expr === 'string' && rest.fn === undefined) {
                    args.push(resolveRef({ expr: rest.expr }, signatureOf(owners, 'fn'), `${path}.expr`));
                } else {
                    fail(path, `${space}.${type} needs its function: "fn": "<registered name>" or "expr": "<expression>".`);
                }
                delete rest[name];
                if (name === 'fn') delete rest.expr;
            }
            return factory(...args, options(rest, owners, path));
        }

        /**
         * An options object: a descriptor's options, or one nested in them.
         * @param {Record<string, any>} object
         * @param {string[]} owners empty for an object that holds no slots
         * @param {string} path
         * @returns {Record<string, any>}
         */
        function options(object, owners, path) {
            /** @type {Record<string, any>} */
            const out = {};
            for (const [key, value] of Object.entries(object)) {
                out[key] = option(key, value, owners, path ? `${path}.${key}` : key);
            }
            return out;
        }

        /**
         * @param {string} key
         * @param {any} value
         * @param {string[]} owners
         * @param {string} path
         * @returns {any}
         */
        function option(key, value, owners, path) {
            if (SPEC_OPAQUE.includes(key)) return value;
            if (key === 'channels' && owners.includes('mark') && isPlain(value)) return channelMap(value, path);
            if (SPEC_SLOTS[key] && owners.length) return slot(value, key, path);
            if (isRef(value)) return resolveRef(value, signatureOf(owners, key), path);
            if (Array.isArray(value)) return value.map((v, i) => option(String(i), v, [], `${path}[${i}]`));
            if (isPlain(value)) return options(value, nestedOwners(owners, key) || [], path);
            return value;
        }

        /**
         * A mark's channel map. Its keys are channel names, never options.
         * @param {Record<string, any>} channels
         * @param {string} path
         * @returns {Record<string, any>}
         */
        function channelMap(channels, path) {
            /** @type {Record<string, any>} */
            const out = {};
            for (const [channel, spec] of Object.entries(channels)) {
                out[channel] = isPlain(spec) ? channelSpec(spec, `${path}.${channel}`) : spec;
            }
            return out;
        }

        /**
         * @param {Record<string, any>} spec
         * @param {string} path
         * @returns {Record<string, any>}
         */
        function channelSpec(spec, path) {
            const { fn, expr, edit, legend, scale, ...out } = spec;
            if (fn !== undefined && expr !== undefined) fail(path, 'a channel takes `fn` or `expr`, not both.');
            if (typeof fn === 'string') out.fn = resolveRef({ fn }, signatureOf(['channel'], 'fn'), `${path}.fn`);
            else if (fn !== undefined) out.fn = fn;
            // Lowered to `fn`, so the core never sees an expression.
            if (typeof expr === 'string') out.fn = resolveRef({ expr }, signatureOf(['channel'], 'fn'), `${path}.expr`);
            else if (expr !== undefined) fail(`${path}.expr`, 'an expression is a string.');
            if (edit !== undefined) {
                out.edit = slot(edit, 'edit', `${path}.edit`);
                if (Array.isArray(out.edit)) {
                    fail(`${path}.edit`, 'a channel carries one edit. Put a list of edits in the mark\'s `edits`.');
                }
            }
            if (legend !== undefined) out.legend = isPlain(legend) ? options(legend, ['legend'], `${path}.legend`) : legend;
            if (scale !== undefined) out.scale = isRef(scale) ? resolveRef(scale, signatureOf(['channel'], 'scale'), `${path}.scale`) : scale;
            return out;
        }

        /**
         * One top-level key of a spec.
         * @param {string} key
         * @param {any} value
         * @returns {any}
         */
        function specValue(key, value) {
            if (SPEC_OPAQUE.includes(key)) return value;
            if (SPEC_SLOTS[key]) return slot(value, key, key);
            if (isRef(value)) return resolveRef(value, signatureOf(['spec'], key), key);
            // GeoJSON lives under `projection.domain`, so it is taken whole.
            if (key === 'projection') return value;
            if (key === 'renderer' && typeof value === 'string') {
                const Renderer = namespaces.renderers[value];
                if (!Renderer) fail(key, `unknown renderer "${value}". Renderers are: ${Object.keys(namespaces.renderers).join(', ')}.`);
                return new Renderer();
            }
            if (key === 'axes' && isPlain(value)) {
                return Object.fromEntries(Object.entries(value).map(([k, v]) =>
                    [k, isPlain(v) ? options(v, ['axis'], `axes.${k}`) : v]));
            }
            if (key === 'legends' && isPlain(value)) {
                return Object.fromEntries(Object.entries(value).map(([k, v]) =>
                    [k, isPlain(v) ? options(v, ['legend'], `legends.${k}`) : v]));
            }
            if (key === 'scales' && isPlain(value)) {
                return Object.fromEntries(Object.entries(value).map(([k, v]) =>
                    [k, isRef(v) ? resolveRef(v, signatureOf(['scales'], k), `scales.${k}`) : v]));
            }
            return option(key, value, [], key);
        }

        if (!isPlain(json)) fail('', 'a spec is an object.');
        /** @type {Record<string, any>} */
        const spec = {};
        /** @type {Record<string, any> | null} */
        let widget = null;
        for (const [key, value] of Object.entries(json)) {
            if (key === 'widget') {
                if (!isPlain(value)) fail(key, 'expected { "type": "<widget>", … }.');
                widget = descriptor(value, ['widgets'], key);
            } else {
                spec[key] = specValue(key, value);
            }
        }
        if (spec.data && spec.schema) spec.data = reviveDates(spec.data, spec.schema);
        // The widget is a whole spec; the keys beside it override its own.
        return widget ? { ...widget, ...spec } : spec;
    };
}

/**
 * JSON has no dates, so a `temporal` column arrives as ISO strings. Turn them back
 * into Dates, which is what a spec written in JavaScript would hold.
 * @param {any} data
 * @param {any} schema
 * @returns {any}
 */
function reviveDates(data, schema) {
    let canonical;
    try {
        canonical = normalizeSchema(schema);
    } catch {
        return data; // `Elicit()` reports a schema it cannot read.
    }
    /** @param {any[]} rows @param {string} table */
    const revive = (rows, table) => {
        const fields = canonical.tables[table] ? canonical.tables[table].fields : {};
        const temporal = Object.keys(fields).filter((f) => fields[f] && fields[f].type === 'temporal');
        if (!temporal.length || !Array.isArray(rows)) return rows;
        return rows.map((row) => {
            if (!isPlain(row) || !temporal.some((f) => typeof row[f] === 'string')) return row;
            const out = { ...row };
            for (const f of temporal) {
                if (typeof out[f] !== 'string') continue;
                const date = new Date(out[f]);
                if (!Number.isNaN(date.getTime())) out[f] = date;
            }
            return out;
        });
    };
    if (Array.isArray(data)) return revive(data, canonical.primary);
    if (!isPlain(data)) return data;
    return Object.fromEntries(Object.entries(data).map(([table, rows]) => [table, revive(rows, table)]));
}
