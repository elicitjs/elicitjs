// @ts-check
// shared.js: helpers every guide uses.
//
// A guide option is a literal or a function of the chart context:
//
//   guides.rule({ y: 25 })                                   // literal
//   guides.rule({ y: ({ data }) => d3.mean(data, d => d.y),  // derived
//                 label: ({ data }) => `mean of ${data.length}` })
//
// The context is `build`'s 5th argument: { scales, data, constraints, features,
// featureNodes, ui, effects, theme, width, height, stage } (`guideCtx` in
// core/engine/render.js). Guides never mutate it.

import { warn, warningsEnabled } from '../core/dev.js';
import { GUIDE_UNIVERSAL_OPTIONS } from '../vocabulary.js';

/**
 * Call a guide option with the chart context if it's a function, else return it.
 * @template T
 * @param {T | ((ctx: any) => T)} value
 * @param {any} ctx
 * @returns {T}
 */
function resolveGuideOption(value, ctx) {
    return typeof value === 'function'
        ? /** @type {(ctx: any) => T} */ (value)(ctx)
        : value;
}

/**
 * Resolve every value of an options object with resolveGuideOption.
 * @param {Record<string, any>} options
 * @param {any} ctx
 * @returns {Record<string, any>}
 */
export function resolveGuideOptions(options, ctx) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [key, value] of Object.entries(options)) out[key] = resolveGuideOption(value, ctx);
    return out;
}

/**
 * Mistaken guide keys, with the correction to show. Most confuse a guide with a mark.
 * @type {Record<string, string>}
 */
const MISTAKEN_GUIDE_OPTIONS = {
    channels: 'a guide has no channel map — it views STATE, not columns. Its options take a literal or a function of the chart context: guides.rule({ y: ({ data }) => … }).',
    field: 'a guide names no field: it draws a statement about the chart, not a column. Read the rows in a function option instead: ({ data }) => …',
    edit: 'a guide is read-only by construction — it can never carry an edit. Put the edit on the MARK whose data the gesture should change.',
    edits: 'a guide is read-only by construction. Put edits on a mark.',
    table: 'a guide views chart STATE, so it has no table. It is handed the primary table\'s rows and may read any of them through the context.',
    data: 'a guide never owns data. It is handed the rows: guides.rule({ y: ({ data }) => … }).',
    constraints: 'invariants belong to the DATASET (spec.constraints), not to a guide. A guide can READ them: ({ constraints }) => …',
};

/**
 * Warn on guide options outside `allow`.
 * @param {string} guide the factory name, for the message
 * @param {any} options
 * @param {string[]} allow the guide's own option vocabulary
 * @returns {void}
 */
export function warnUnknownGuideOptions(guide, options, allow) {
    if (!options || !warningsEnabled()) return;
    const known = new Set([...GUIDE_UNIVERSAL_OPTIONS, ...allow]);
    for (const key of Object.keys(options)) {
        if (known.has(key)) continue;
        const fix = MISTAKEN_GUIDE_OPTIONS[key];
        if (fix) {
            warn(`guideopt:${guide}:${key}`, `guides.${guide}({ ${key}: … }): ${fix}`);
            continue;
        }
        warn(
            `guideopt:${guide}:${key}`,
            `guides.${guide}({ ${key}: … }) is not an option this guide reads, so it is ` +
            `ignored. ${guide} options are: ${[...known].sort().join(', ')}.`,
        );
    }
}

/**
 * A value as plain readout text: a Date as a local date, a number rounded to
 * `1 / scale`, anything else as a string.
 * @param {any} v
 * @param {number} scale 100 keeps two decimals
 * @returns {string}
 */
export function plainValue(v, scale) {
    if (v instanceof Date) return v.toLocaleDateString();
    if (typeof v === 'number') return String(Math.round(v * scale) / scale);
    return String(v);
}
