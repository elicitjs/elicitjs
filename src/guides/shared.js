// @ts-check
// shared.js — what every guide has in common.
//
// A guide views chart STATE (`views: 'state'`): it draws the RULE and the STATE
// rather than the data. It is therefore allowed to DEPEND on the rows — a "mean"
// line has to read them to know where it goes — while never writing any. So every
// guide option may be either a literal or a function of the chart context:
//
//   guides.rule({ y: 25 })                                   // literal
//   guides.rule({ y: ({ data }) => d3.mean(data, d => d.y),  // derived
//                 label: ({ data }) => `mean of ${data.length}` })
//
// Note this is what a guide has INSTEAD of a channel map, and why "derived" is not
// what distinguishes a guide from a mark: a mark channel can already be derived
// (`{ fn }`). The difference is ARITY and WRITABILITY — a `{ fn }` channel is
// per-ROW and its mark may still carry an `edit`; these expressions are per-CHART
// and a guide carries none. See the `Guide` interface in types.d.ts.
//
// The context is the one `build` receives as its 5th argument: { scales, data,
// constraints, features, featureNodes, ui, effects, theme, width, height, stage }
// (see elicit.js's guideCtx). Guides never mutate it, and are never interactive.

import { warn, warningsEnabled } from '../core/dev.js';

/**
 * Resolve one guide option against the chart context: call it if it's a function,
 * otherwise hand it back untouched.
 * @template T
 * @param {T | ((ctx: any) => T)} value
 * @param {any} ctx
 * @returns {T}
 */
export function resolveGuideOption(value, ctx) {
    return typeof value === 'function'
        ? /** @type {(ctx: any) => T} */ (value)(ctx)
        : value;
}

/**
 * Resolve a whole options object at once — every value goes through
 * resolveGuideOption. Guide factories call this at the top of build().
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
 * Options every guide accepts, whatever it draws.
 * @type {string[]}
 */
const UNIVERSAL_GUIDE_OPTIONS = ['id'];

/**
 * Guide keys that are WRONG in a specific, diagnosable way. The guide-layer
 * counterpart of `MISTAKEN_OPTIONS` (plot/mark.js) and `MISTAKEN_SPEC_KEYS`
 * (core/elicit.js) — the corrections here are all about the KIND confusion, since
 * that is the mistake a guide invites.
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
 * Validate a guide's options.
 *
 * Guides had no option checking at all — the one feature kind with none — so
 * `guides.rule({ colour: 'red' })` or `guides.region({ field: 'y' })` drew a
 * default and said nothing. This is the same diagnostics half that
 * `warnUnknownOptions` gives marks and `warnUnknownElementOptions` gives chart
 * elements; there is nothing to DESUGAR into, so it is the check alone.
 * @param {string} guide the factory name, for the message
 * @param {any} options
 * @param {string[]} allow the guide's own option vocabulary
 * @returns {void}
 */
export function warnUnknownGuideOptions(guide, options, allow) {
    if (!options || !warningsEnabled()) return;
    const known = new Set([...UNIVERSAL_GUIDE_OPTIONS, ...allow]);
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
