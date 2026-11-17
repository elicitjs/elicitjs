// @ts-check
// record.js: a spec written in JavaScript -> its JSON spec.
//
//   const rec = recorder();
//   const spec = { marks: [rec.plot.barY({ … })] };   // descriptors, not marks
//   const { json, functions } = rec.toJSON(spec);
//
// The recorder's namespaces look like the library's, but a factory returns its
// descriptor. A built mark cannot be read back (it keeps its options in closures),
// so recording the calls is the only way from JavaScript to JSON.

import {
    SPEC_SLOTS, SPEC_POSITIONAL, SPEC_OPAQUE,
} from '../vocabulary.js';
import { themes } from '../core/themes.js';
import { liftExpr } from './expr.js';
import { registeredFunctions } from './functions.js';
import { keywordTables } from './keywords.js';
import { isPlain, ownersOf, signatureOf, nestedOwners } from './compile.js';

/** The namespace a recorded descriptor came from. Enumerable, so a spread keeps it. */
const NAMESPACE = Symbol('elicit.namespace');

/**
 * Build `recorder` over a set of namespaces (see `createCompiler`).
 * @param {import('./keywords.js').Namespaces} namespaces
 */
export function createRecorder(namespaces) {
    /**
     * @param {{ functions?: Record<string, Function> }} [options] names for the
     *   functions the spec uses; one that is not named here is named after its option
     */
    return function recorder({ functions = {} } = {}) {
        const tables = keywordTables(namespaces);
        // While live, a factory builds for real: a function the spec keeps (a custom
        // guide, say) may call one long after the spec was recorded.
        let live = false;
        /** `when` and `format` values, which are real functions, by identity.
         *  @type {WeakMap<Function, any>} */
        const named = new WeakMap();

        /**
         * @param {string} ns
         * @param {string} type
         * @param {Function} factory
         */
        const recording = (ns, type, factory) => (/** @type {any[]} */ ...args) => {
            if (live) return factory(...args);
            const positional = SPEC_POSITIONAL[`${ns}.${type}`] || [];
            /** @type {Record<string | symbol, any>} */
            const d = { type };
            positional.forEach((name, i) => { if (args[i] !== undefined) d[name] = args[i]; });
            Object.assign(d, args[positional.length]);
            d[NAMESPACE] = ns;
            // Some factories return a list (`composite`, `edit.scale.categories`), so
            // an author may spread the result. Spreading a descriptor yields itself.
            Object.defineProperty(d, Symbol.iterator, { value: function* () { yield d; } });
            return ns === 'widgets' ? { widget: d } : d;
        };

        /** @param {string} ns @returns {Record<string, any>} */
        const lookalike = (ns) => Object.fromEntries(
            [...tables[ns]].filter(([type]) => !type.includes('.')).map(([type, factory]) => [type, recording(ns, type, factory)]),
        );

        // `when` and `format` members stay real functions, since a spec may call
        // them; each remembers how it is written.
        /** @param {string} ns */
        const callable = (ns) => Object.fromEntries([...tables[ns]].map(([type, member]) => {
            const positional = SPEC_POSITIONAL[`${ns}.${type}`];
            if (!positional) {
                const same = (/** @type {any[]} */ ...args) => member(...args);
                named.set(same, type);
                return [type, same];
            }
            return [type, (/** @type {any[]} */ ...args) => {
                const real = member(...args);
                const made = (/** @type {any[]} */ ...inner) => real(...inner);
                /** @type {Record<string, any>} */
                const d = { type };
                positional.forEach((name, i) => { if (args[i] !== undefined) d[name] = args[i]; });
                named.set(made, d);
                return made;
            }];
        }));

        const when = callable('when');
        /** @type {Record<string, any>} */
        const edit = { ...lookalike('edit'), when };
        for (const [type, factory] of tables.edit) {
            if (!type.includes('.')) continue;
            const [family, name] = type.split('.');
            (edit[family] ||= {})[name] = recording('edit', type, factory);
        }

        /** @type {Map<Function, string>} */
        const names = new Map();
        for (const [name, fn] of registeredFunctions()) names.set(fn, name);
        for (const [name, fn] of Object.entries(functions)) names.set(fn, name);

        /**
         * The JSON for a recorded spec, and the functions it names.
         * Throws, with the path, for a value that has no JSON form.
         * @param {any} spec
         * @returns {{ json: any, functions: Record<string, Function> }}
         */
        function toJSON(spec) {
            /** @type {Record<string, Function>} */
            const used = {};

            /** @param {string} path @param {string} message @returns {never} */
            function fail(path, message) {
                throw new Error(`[elicit] recorder: ${path || 'spec'}: ${message}`);
            }

            /**
             * A function, as a reference: an `expr` when the arrow reads as one,
             * else the name it is registered under.
             * @param {Function} fn
             * @param {string[] | string | undefined} signature
             * @param {string} path
             * @param {string} hint what to call it when it has no name
             * @returns {{ fn: string } | { expr: string }}
             */
            function ref(fn, signature, path, hint) {
                if (!signature) fail(path, 'a function here has no JSON form.');
                const known = names.get(fn);
                if (known === undefined && signature !== 'fn') {
                    const expr = liftExpr(fn, /** @type {string[] | string} */ (signature));
                    if (expr != null) return { expr };
                }
                let name = known;
                if (name === undefined) {
                    const taken = new Set(names.values());
                    name = hint;
                    for (let n = 2; taken.has(name); n++) name = `${hint}${n}`;
                    names.set(fn, name);
                }
                used[name] = fn;
                return { fn: name };
            }

            /**
             * A value that is data: kept, with a Date as its ISO string.
             * @param {any} value
             * @param {string} path
             * @returns {any}
             */
            function plain(value, path) {
                if (value instanceof Date) return value.toISOString();
                if (typeof value === 'number') return Number.isFinite(value) ? value : null;
                if (typeof value === 'function') fail(path, 'a function here has no JSON form.');
                if (Array.isArray(value)) return value.map((v, i) => plain(v, `${path}[${i}]`));
                if (isPlain(value)) {
                    /** @type {Record<string, any>} */
                    const out = {};
                    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = plain(v, `${path}.${k}`);
                    return out;
                }
                if (value !== null && typeof value === 'object') fail(path, `a ${value.constructor ? value.constructor.name : 'value'} has no JSON form.`);
                return value;
            }

            /** @param {any} value @param {string} key @param {string} path @returns {any} */
            function slot(value, key, path) {
                const def = SPEC_SLOTS[key];
                if (Array.isArray(value)) return value.map((v, i) => slot(v, key, `${path}[${i}]`));
                if (typeof value === 'function') {
                    const written = named.get(value);
                    if (written !== undefined) return written;
                    return ref(value, def.fn, path, key);
                }
                if (value && typeof value === 'object') {
                    const ns = value[NAMESPACE];
                    if (!ns) fail(path, 'this is not the result of a spec keyword: it was built with `authoring` or by hand.');
                    if (!def.ns.includes(ns)) {
                        fail(path, `${ns}.${value.type} sits where a ${def.ns.join(' or ')} keyword belongs.`);
                    }
                    return descriptor(value, ns, path);
                }
                return value;
            }

            /** @param {Record<string, any>} d @param {string} ns @param {string} path */
            function descriptor(d, ns, path) {
                const owners = ownersOf(ns, d.type);
                /** @type {Record<string, any>} */
                const out = { type: d.type };
                for (const [key, value] of Object.entries(d)) {
                    if (key === 'type' || value === undefined) continue;
                    const positional = (SPEC_POSITIONAL[`${ns}.${d.type}`] || []).includes(key);
                    if (positional && key === 'fn' && typeof value === 'function') {
                        // `fn` and `expr` sit directly in a `custom` descriptor.
                        Object.assign(out, ref(value, signatureOf(owners, 'fn'), `${path}.fn`, d.type));
                    } else {
                        out[key] = option(key, value, owners, `${path}.${key}`);
                    }
                }
                return out;
            }

            /** @param {Record<string, any>} object @param {string[]} owners @param {string} path */
            function options(object, owners, path) {
                /** @type {Record<string, any>} */
                const out = {};
                for (const [key, value] of Object.entries(object)) {
                    if (value !== undefined) out[key] = option(key, value, owners, path ? `${path}.${key}` : key);
                }
                return out;
            }

            /** @param {string} key @param {any} value @param {string[]} owners @param {string} path @returns {any} */
            function option(key, value, owners, path) {
                if (SPEC_OPAQUE.includes(key)) return plain(value, path);
                if (key === 'channels' && owners.includes('mark') && isPlain(value)) {
                    return Object.fromEntries(Object.entries(value).map(([channel, spec]) =>
                        [channel, isPlain(spec) ? channelSpec(spec, channel, `${path}.${channel}`) : plain(spec, `${path}.${channel}`)]));
                }
                if (SPEC_SLOTS[key] && owners.length) return slot(value, key, path);
                if (typeof value === 'function') return ref(value, signatureOf(owners, key), path, key);
                if (Array.isArray(value)) return value.map((v, i) => option(String(i), v, [], `${path}[${i}]`));
                if (isPlain(value)) {
                    const ns = /** @type {any} */ (value)[NAMESPACE];
                    if (ns) fail(path, `${ns}.${value.type} is not an option here.`);
                    return options(value, nestedOwners(owners, key) || [], path);
                }
                return plain(value, path);
            }

            /** @param {Record<string, any>} spec @param {string} channel @param {string} path */
            function channelSpec(spec, channel, path) {
                /** @type {Record<string, any>} */
                const out = {};
                for (const [key, value] of Object.entries(spec)) {
                    if (value === undefined) continue;
                    if (key === 'fn' && typeof value === 'function') Object.assign(out, ref(value, signatureOf(['channel'], 'fn'), `${path}.fn`, channel));
                    else if (key === 'edit') out.edit = slot(value, 'edit', `${path}.edit`);
                    else if (key === 'legend' && isPlain(value)) out.legend = options(value, ['legend'], `${path}.legend`);
                    else if (key === 'scale' && typeof value === 'function') out.scale = ref(value, signatureOf(['channel'], 'scale'), `${path}.scale`, `${channel}Scale`);
                    else out[key] = plain(value, `${path}.${key}`);
                }
                return out;
            }

            /** @param {string} key @param {any} value @returns {any} */
            function specValue(key, value) {
                if (key === 'theme') {
                    const builtIn = Object.keys(themes).find((name) => /** @type {Record<string, any>} */ (themes)[name] === value);
                    return builtIn || plain(value, key);
                }
                if (SPEC_OPAQUE.includes(key)) return plain(value, key);
                if (SPEC_SLOTS[key]) return slot(value, key, key);
                if (typeof value === 'function') return ref(value, signatureOf(['spec'], key), key, key);
                if (key === 'projection') return plain(value, key);
                if (key === 'renderer' && value && typeof value === 'object') {
                    const name = Object.keys(namespaces.renderers).find((n) => value.constructor === namespaces.renderers[n]);
                    return name || fail(key, 'a custom renderer has no JSON form.');
                }
                if ((key === 'axes' || key === 'legends') && isPlain(value)) {
                    const owner = key === 'axes' ? 'axis' : 'legend';
                    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) =>
                        [k, isPlain(v) ? options(v, [owner], `${key}.${k}`) : plain(v, `${key}.${k}`)]));
                }
                if (key === 'scales' && isPlain(value)) {
                    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
                        [k, typeof v === 'function' ? ref(v, signatureOf(['scales'], k), `scales.${k}`, `${k}Scale`) : plain(v, `scales.${k}`)]));
                }
                return option(key, value, [], key);
            }

            if (!isPlain(spec)) fail('', 'a spec is an object.');
            /** @type {Record<string, any>} */
            const json = {};
            for (const [key, value] of Object.entries(spec)) {
                if (value === undefined) continue;
                if (key === 'widget') {
                    if (!value || value[NAMESPACE] !== 'widgets') fail(key, 'expected a widget.');
                    json.widget = descriptor(value, 'widgets', key);
                } else {
                    json[key] = specValue(key, value);
                }
            }
            return { json, functions: used };
        }

        return {
            plot: lookalike('plot'),
            elements: lookalike('elements'),
            guides: lookalike('guides'),
            constraints: lookalike('constraints'),
            widgets: lookalike('widgets'),
            edit,
            format: callable('format'),
            toJSON,
            /** Run `fn` with the namespaces building for real. @template T @param {() => T} fn @returns {T} */
            live(fn) {
                const before = live;
                live = true;
                try { return fn(); } finally { live = before; }
            },
            /** From now on the namespaces build for real. */
            stop() { live = true; },
        };
    };
}
