// @ts-check
// functions.js: the functions a JSON spec names. A spec holds no code, so a
// function option is written `{ "fn": "<name>" }` and resolved here.

/** The app-wide registry. A `functions` map passed to `compile()` wins over it.
 *  @type {Map<string, Function>} */
const registry = new Map();

/**
 * Register a function under the name a JSON spec refers to it by.
 * Registering a name again replaces it.
 * @param {string} name
 * @param {Function} fn
 * @returns {void}
 */
export function registerFunction(name, fn) {
    if (typeof name !== 'string' || !name) {
        throw new Error('[elicit] registerFunction(name, fn): `name` must be a non-empty string.');
    }
    if (typeof fn !== 'function') {
        throw new Error(`[elicit] registerFunction("${name}", fn): \`fn\` must be a function.`);
    }
    registry.set(name, fn);
}

/**
 * The function a name refers to: the per-compile map first, then the registry.
 * @param {string} name
 * @param {Record<string, Function> | undefined} local
 * @returns {Function | undefined}
 */
export function lookupFunction(name, local) {
    if (local && Object.prototype.hasOwnProperty.call(local, name)) return local[name];
    return registry.get(name);
}

/** Every registered name and its function. @returns {[string, Function][]} */
export function registeredFunctions() {
    return [...registry];
}
