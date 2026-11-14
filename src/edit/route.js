// @ts-check
// route.js — collects a feature's edits (channel-placed and mark-level) and
// resolves their channel names to { name, field, scale }.

import { warn } from '../core/dev.js';
import { scaleFor } from '../core/scales.js';

/**
 * Looks like an Edit descriptor (gesture + apply) rather than a ChannelSpec.
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
            // A derived channel (`{ fn }`) is read-only; drop its edit.
            if (typeof chSpec.fn === 'function' && chSpec.field == null) continue;
            const e = chSpec.edit;
            // Inject the placement channel when the edit didn't name its own.
            edits.push(e.channels ? e : { ...e, channels: [name] });
        }
    }
    for (const e of (feature.edits || [])) {
        // A `spans` edit with no channels takes the mark's span pair.
        if (!e.channels && /** @type {any} */ (e).spans) {
            const pair = channels.x1 && channels.x2 ? ['x1', 'x2']
                : channels.y1 && channels.y2 ? ['y1', 'y2'] : null;
            edits.push(pair ? { ...e, channels: pair } : e);
            continue;
        }
        edits.push(e);
    }
    return edits;
}

/**
 * Warn about a misplaced edit (a channel key named `edit`, or a channel value that
 * is an Edit), or an edit on a channel with no field to write.
 * @param {any} feature
 * @param {(f: any) => string} [label] how to name the mark in the message
 */
export function warnMisplacedEdits(feature, label) {
    const channels = feature.channels || {};
    const name_ = label ? label(feature) : `"${feature.id || '?'}"`;
    const fid = feature.id || feature.type || '?';
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
            // A constant channel names no field, so its edit has no column to write.
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
 * Turn an edit's channel names into the { name, field, scale } triples its
 * `apply` iterates.
 *
 * A channel with no field is dropped; otherwise an edit would write a column
 * named "undefined" into the elicited data.
 *
 * A chart element (`views: 'scale'`) has no channel map, so its field falls back
 * to `owner.field`, then `scale.fields[0]`. Data marks never take this fallback:
 * on a shared axis it would write another mark's column.
 * @param {string[] | null} names
 * @param {any} markChannels
 * @param {import('../types').ScaleMap} scales
 * @param {any} [owner] the feature these channels belong to; read for `views`
 *   and its pinned `field`
 * @returns {import('../types').ResolvedChannel[]}
 */
export function resolveChannels(names, markChannels, scales, owner = undefined) {
    const viewsScale = !!(owner && owner.views === 'scale');
    const pinned = owner && owner.field != null ? owner.field : undefined;
    // A feature with no channel map also takes the fallback.
    const mapless = viewsScale || !markChannels || Object.keys(markChannels).length === 0;
    /** @type {import('../types').ResolvedChannel[]} */
    const out = [];
    for (const name of names || []) {
        // Resolve the field first: a scale is keyed by (channel, field).
        const spec = markChannels && markChannels[name];
        let field = spec && spec.field;
        if (field == null && mapless) {
            if (pinned != null) field = pinned;
            else {
                const alias = /** @type {any} */ (scales[name]);
                const fields = alias && alias.fields;
                field = fields && fields[0];
            }
        }
        if (field == null) continue;
        const scale = scaleFor(scales, name, field);
        out.push({ name, field, scale });
    }
    return out;
}

