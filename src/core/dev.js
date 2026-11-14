// @ts-check
// dev.js — the one switch for developer diagnostics and the one dedup store.
// Every diagnostic goes through `warn(key, message)`. Warnings are on by default;
// `enabled` is runtime state, not a foldable constant, so call sites survive bundling.
// `setWarnings(false)` or a production `process.env.NODE_ENV` turns them off.

/**
 * Warnings default on; only an explicit production NODE_ENV turns them off.
 * @returns {boolean}
 */
function detect() {
    try {
        // `process.env.NODE_ENV` must stay spelled literally: bundlers replace this exact text.
        // @ts-ignore `process` is Node/bundler-only; guarded by typeof, and we do not want @types/node in the lib's type space.
        const env = typeof process !== 'undefined' && process.env && process.env.NODE_ENV;
        if (env) return env !== 'production';
    } catch {
        // A hardened or sandboxed realm can throw on global access — warn anyway.
    }
    return true;
}

let enabled = detect();

/** Keys already warned about. Shared across every guard so one key means one line. */
const seen = new Set();

/**
 * Turn developer warnings on or off. Exported from the package root so an
 * embedder can silence the library without a bundler flag. Clears the dedup
 * store, so re-enabling reports a still-broken spec again.
 * @param {boolean} on
 * @returns {void}
 */
export function setWarnings(on) {
    enabled = !!on;
    seen.clear();
}

/**
 * True when diagnostics are live. Prefer `warn()`; use this only to skip work
 * that is expensive to compute purely for a message.
 * @returns {boolean}
 */
export function warningsEnabled() {
    return enabled;
}

/**
 * Warn once per `key`. The `[elicit]` prefix is added here — call sites pass the
 * message only.
 * @param {string} key dedup key; include the mark/feature so two bad marks both report
 * @param {string} message
 * @returns {void}
 */
export function warn(key, message) {
    if (!enabled || seen.has(key)) return;
    seen.add(key);
    console.warn(`[elicit] ${message}`);
}
