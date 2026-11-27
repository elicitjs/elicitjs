// @ts-check
// keywords.js: keyword -> factory, read off the live namespaces. A factory is a
// keyword the moment it is exported; nothing is listed by hand.

/**
 * @typedef {{ plot: any, elements: any, guides: any, looks: any, layout: any, constraints: any, edit: any,
 *   widgets: any, format: any, renderers: Record<string, new () => any> }} Namespaces
 * @typedef {Record<string, Map<string, Function>>} KeywordTables
 */

/** The `format` members that are not formatter factories. */
const NOT_FORMATS = ['resolveFormat'];

/**
 * A namespace's functions by name.
 * @param {Record<string, any>} ns
 * @param {string[]} [skip]
 * @returns {Map<string, Function>}
 */
function flat(ns, skip = []) {
    /** @type {Map<string, Function>} */
    const out = new Map();
    for (const [name, member] of Object.entries(ns || {})) {
        if (typeof member === 'function' && !skip.includes(name)) out.set(name, member);
    }
    return out;
}

/**
 * A namespace with scoped families: universal members by bare name, scoped ones
 * by dotted path (`edit.line.draw` -> `line.draw`, `layout.network.tree` ->
 * `network.tree`). `edit.when` holds predicates, not edits.
 * @param {Record<string, any>} ns
 * @returns {Map<string, Function>}
 */
function scoped(ns) {
    const out = flat(ns);
    for (const [family, members] of Object.entries(ns || {})) {
        if (family === 'when' || !members || typeof members !== 'object') continue;
        for (const [name, member] of Object.entries(members)) {
            if (typeof member === 'function') out.set(`${family}.${name}`, member);
        }
    }
    return out;
}

/**
 * Every keyword table, keyed by namespace.
 * @param {Namespaces} ns
 * @returns {KeywordTables}
 */
export function keywordTables(ns) {
    return {
        plot: flat(ns.plot),
        elements: flat(ns.elements),
        guides: flat(ns.guides),
        looks: flat(ns.looks),
        layout: scoped(ns.layout),
        constraints: flat(ns.constraints),
        widgets: flat(ns.widgets),
        edit: scoped(ns.edit),
        when: flat(ns.edit && ns.edit.when),
        format: flat(ns.format, NOT_FORMATS),
    };
}
