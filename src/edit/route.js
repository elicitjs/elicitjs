// @ts-check
// route.js — how the engine finds and prepares a feature's edits.
//
// Edits are declared in two places: co-located on a channel (channels[ch].edit,
// the common single-channel case) or at mark level (feature.edits, for joint /
// arbitrary edits). collectEdits unifies them into one list, injecting the
// placement channel for co-located edits so every edit knows the channel names
// it governs.
//
// resolveChannels then turns those names into { name, field, scale } using the
// feature's channels (name -> field) and the global scales (name -> scale) — the
// context an edit's apply() needs. Because the field comes from the channel the
// edit is attached to, there is no implicit valueKey to inherit (the P1 fix,
// now structural).

import { warn } from '../core/dev.js';

/**
 * Looks like an Edit descriptor (gesture + apply) rather than a ChannelSpec.
 * Used by the misplaced-edit guard — authors sometimes put `edit: move()` as
 * a sibling channel key instead of on a channel or in `feature.edits`.
 * @param {any} v
 * @returns {boolean}
 */
function looksLikeEdit(v) {
    return !!(v && typeof v === 'object' && typeof v.apply === 'function' && v.gesture);
}

/**
 * @param {any} feature
 * @returns {import('../types').Edit[]}
 */
export function collectEdits(feature) {
    /** @type {import('../types').Edit[]} */
    const edits = [];
    const channels = feature.channels || {};
    for (const [name, chSpec] of Object.entries(channels)) {
        if (chSpec && chSpec.edit) {
            // A derived channel (`{ fn }`) is read-only: it recomputes from the
            // committed rows on every render, so there is nothing to invert. Drop
            // any edit placed on it (warnMisplacedEdits explains why in DEV).
            if (typeof chSpec.fn === 'function' && chSpec.field == null) continue;
            const e = chSpec.edit;
            // Inject the placement channel when the edit didn't name its own.
            edits.push(e.channels ? e : { ...e, channels: [name] });
        }
    }
    for (const e of (feature.edits || [])) edits.push(e);
    return edits;
}

/**
 * Warn when a channel map looks like it misplaced an edit (a key named `edit`, or
 * a channel value that is itself an Edit descriptor). Those never reach
 * collectEdits, so the mark stays pointer-transparent and "drag does nothing".
 * Also catches an edit on a channel with nothing to write back to.
 * @param {any} feature
 * @param {(f: any) => string} [label] how to name the mark in the message
 */
export function warnMisplacedEdits(feature, label) {
    const channels = feature.channels || {};
    const name_ = label ? label(feature) : `"${feature.id || '?'}"`;
    const fid = feature.id || feature.markName || '?';
    for (const [name, chSpec] of Object.entries(channels)) {
        const key = `${fid}:${name}`;
        if (name === 'edit' || looksLikeEdit(chSpec)) {
            warn(
                key,
                `mark ${name_} has a misplaced edit under channels.${name}. ` +
                `Attach edits on a channel (y: { field, edit: move() }) or at mark level ` +
                `(edits: [move({ channels: ['x','y'] })]). A bare channels.edit key is ignored.`
            );
        } else if (chSpec && chSpec.edit && typeof chSpec.fn === 'function' && chSpec.field == null) {
            warn(
                key,
                `mark ${name_} puts an edit on the derived channel "${name}" ({ fn }). ` +
                `A derived channel is read-only — it recomputes from the committed rows on every ` +
                `render, so the edit is ignored. Attach the edit to the source field's channel ` +
                `(e.g. x: { field: "x", edit: move() }); the fn re-derives automatically after each commit.`
            );
        } else if (chSpec && chSpec.edit && chSpec.field == null && typeof chSpec.fn !== 'function') {
            // A CONSTANT channel ({ value } / { datum }) names no field, so an edit on
            // it has no column to write to. Left unguarded this is worse than a no-op:
            // if another mark puts a field on the same axis the scale exists and IS
            // invertible, so the edit "works" and writes to the key `undefined`,
            // quietly corrupting the elicited dataset.
            warn(
                `${key}:nofield`,
                `mark ${name_} puts an edit on channel "${name}", which has no field ` +
                `(it is a constant: ${chSpec.value !== undefined ? '{ value }' : '{ datum }'}). ` +
                `An edit writes back to a COLUMN, so give the channel a field ` +
                `(${name}: { field: "…", edit: … }) — otherwise there is nothing to elicit.`
            );
        }
    }
}

/**
 * Turn an edit's channel NAMES into the { name, field, scale } triples its
 * `apply` iterates.
 *
 * A channel the mark doesn't encode as a FIELD is dropped. An edit writes back to
 * a dataset column, so a channel with no field has nothing to write — and every
 * apply() in the library ends in some form of `datum[ch.field] = value`. Left in,
 * such a channel writes to the key `undefined`: usually inert (a constant channel
 * resolves no scale, so the invert bails first), but if ANOTHER mark puts a field
 * on the same axis, the scale exists and inverts, and dragging silently appends a
 * column literally named "undefined" to the elicited dataset. For a belief-
 * elicitation library that is the worst failure available — corrupt research data,
 * no error. Dropping here fixes it once, for every present and future edit,
 * instead of guarding ~14 write sites and hoping the next edit remembers.
 *
 * This is also the behaviour callers already assume: `create()` passes ['x','y']
 * and documents that a 1D chart "just omits the missing y".
 *
 * THE ONE EXCEPTION is a GUIDE (`views: 'scale'` — axis, grid, `plot.legend()`).
 * A guide draws a SCALE rather than columns of its own, so the scale is the only
 * place the field is known and it falls back to `scale.fields[0]`. That fallback
 * is deliberately NOT applied to a data mark: on a shared axis `scale.fields`
 * holds every field unioned onto it (an error bar's mean/lo/hi), so picking `[0]`
 * for a channel the author left constant would write to a NEIGHBOURING mark's
 * column instead of failing.
 * @param {string[] | null} names
 * @param {any} markChannels
 * @param {import('../types').ScaleMap} scales
 * @param {boolean} [viewsScale] the feature views a SCALE, not data — i.e. it is a
 *   chart ELEMENT (`views: 'scale'`). Named for what it is: this used to be called
 *   `isGuide`, from before the three feature kinds had separate names, and a guide
 *   (`views: 'state'`) is now a different thing entirely.
 * @returns {import('../types').ResolvedChannel[]}
 */
export function resolveChannels(names, markChannels, scales, viewsScale = false) {
    // Fall back to the shape-sniff when the caller doesn't say: a feature with no
    // channel map has no field of its own either, so the scale is the only place
    // the field is known.
    const mapless = viewsScale || !markChannels || Object.keys(markChannels).length === 0;
    /** @type {import('../types').ResolvedChannel[]} */
    const out = [];
    for (const name of names || []) {
        const scale = scales[name] || undefined;
        const spec = markChannels && markChannels[name];
        let field = spec && spec.field;
        if (field == null && mapless) {
            const fields = /** @type {any} */ (scale) && /** @type {any} */ (scale).fields;
            field = fields && fields[0];
        }
        if (field == null) continue;
        out.push({ name, field, scale });
    }
    return out;
}

