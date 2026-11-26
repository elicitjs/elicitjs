// @ts-check
import { warn } from '../core/dev.js';

/**
 * Warn about an option a part does not read.
 * @param {string} part
 * @param {any} options
 * @param {string[]} allowed
 */
export function warnUnknownUiOptions(part, options, allowed) {
    if (!options || typeof options !== 'object') return;
    for (const key of Object.keys(options)) {
        if (allowed.includes(key)) continue;
        warn(`ui:option:${part}:${key}`, `ui.${part}: unknown option "${key}". Options: ${allowed.join(', ')}.`);
    }
}
