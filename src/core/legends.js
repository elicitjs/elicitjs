// @ts-check
// legends.js — builds legends from the encodings marks declare, and reserves their
// space: each side's band is added to the author margins, and each legend's
// `_place` is stamped with where its band landed.

import { legend } from '../plot/legend.js';
import { elementEdits } from '../plot/mark.js';
import { warn } from './dev.js';
import { frameSpecOf } from './encoding.js';
import { scaleFor } from './scales.js';
import { flattenFeatures } from './axes.js';

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Sides */

/**
 * The channels a legend can describe: the non-positional ones a reader needs a key
 * for. x/y are excluded because an axis is the key for those.
 * @type {string[]}
 */
// `theta` is legendable (a fan of spokes); `angle`, a rotation in place, is not.
export const LEGENDABLE = ['fill', 'stroke', 'size', 'symbol', 'opacity', 'theta', 'strokeWidth', 'strokeDash'];

/**
 * Every encoding a legend could be a key for: one entry per (channel, field) a
 * data mark declares, in first-seen order, with its table and the channel's legend
 * request. Skips channels with no global scale (constant, `frame`, `scale: null`, raw).
 * @param {any[]} features the user's marks and elements (unflattened)
 * @returns {{ channel: string, field: string, table: any, tableRole: any, spec: any, feature: any }[]}
 */
function encodingsOf(features) {
    const flat = flattenFeatures(features);
    /** @type {any[]} */
    const out = [];
    for (const f of flat) {
        if (f.views === 'scale' || !f.channels) continue;
        const raw = new Set(f.rawChannels || []);
        for (const [channel, spec] of Object.entries(f.channels)) {
            const chSpec = /** @type {any} */ (spec);
            if (!chSpec || chSpec.field == null) continue;
            if (chSpec.scale === null || raw.has(channel) || frameSpecOf(chSpec)) continue;
            const prior = out.find((e) => e.channel === channel && e.field === chSpec.field);
            if (prior) {
                // Prefer a mark that names no table (the primary one), so an
                // editable legend writes the chart's default rows.
                if (prior.table != null && f.table == null) {
                    prior.table = f.table; prior.tableRole = f.tableRole; prior.feature = f;
                }
                // Two marks stating one encoding share its legend; a later mark's
                // `legend` options merge in.
                if (chSpec.legend && typeof chSpec.legend === 'object') {
                    const base = prior.spec.legend && typeof prior.spec.legend === 'object' ? prior.spec.legend : {};
                    prior.spec = { ...prior.spec, legend: { ...base, ...chSpec.legend } };
                } else if (chSpec.legend != null && prior.spec.legend == null) {
                    prior.spec = { ...prior.spec, legend: chSpec.legend };
                }
                continue;
            }
            out.push({
                channel, field: chSpec.field,
                table: f.table, tableRole: f.tableRole,
                spec: chSpec, feature: f,
            });
        }
    }
    return out;
}

/**
 * Build the chart's legends from the encodings its marks declare. A legend is
 * requested by, most specific first: a composed element, the channel
 * (`fill: { field, legend: {…} }`), or `legends: true`. An element wins for its
 * encoding and takes the channel's options and edits. `legend: false | null` on
 * the channel suppresses. A legend-scoped edit is stripped from the channel so the
 * mark's own nodes stay inert. See .claude/rules/elements-and-legends.md.
 *
 * @param {any[]} features the user's marks and elements (unflattened)
 * @param {any} legendsOpt the `legends` spec key
 * @returns {any[]} the legend features to append
 */
export function legendsFromChannels(features, legendsOpt) {
    const flat = flattenFeatures(features);
    const encodings = encodingsOf(features);
    /** @param {string} ch */
    const onChannel = (ch) => encodings.filter((e) => e.channel === ch);

    // Bind each composed element with no `field` to its channel's sole encoding;
    // with several, warn and take the first.
    const elements = flat.filter((f) => f.isLegend);
    for (const el of elements) {
        if (el.field != null) continue;
        const here = onChannel(el.channel);
        if (!here.length) continue;      // no encoding at all: legend.build warns
        if (here.length > 1) {
            warn(
                `legend:ambiguous:${el.channel}`,
                `legend({ channel: "${el.channel}" }) — "${el.channel}" carries ` +
                `${here.length} encodings (${here.map((e) => `"${e.field}"`).join(', ')}), and a ` +
                `legend is a key for one. Name which: legend({ channel: "${el.channel}", ` +
                `field: "${here[0].field}" }). Using "${here[0].field}".`
            );
        }
        el.field = here[0].field;
        if (el.table == null) el.table = here[0].table;
        if (el.tableRole == null) el.tableRole = here[0].tableRole;
    }
    /** @param {string} ch @param {string} field */
    const explicitFor = (ch, field) =>
        elements.find((f) => f.channel === ch && f.field === field);

    /** @type {any[]} */
    const minted = [];
    for (const enc of encodings) {
        const { channel, field, spec } = enc;
        const asked = spec.legend;
        if (asked === false || asked === null) continue;   // suppressed at the channel

        // A legend-scoped edit on the channel is itself a request for a legend, so
        // it is resolved first.
        const list = [spec.edit].flat(Infinity).filter(
            (e) => e && typeof (/** @type {any} */ (e).apply) === 'function'
        );
        const moving = list.filter((e) => /** @type {any} */ (e).scope === 'legend');

        // Otherwise the chart-level key decides. `legends: true` takes every
        // legendable encoding; the object form takes the channels it names.
        let cfg;
        if (asked !== undefined) {
            cfg = asked === true ? {} : asked;
        } else if (moving.length) {
            cfg = {};
        } else {
            if (!legendsOpt) continue;
            const perChannel = legendsOpt === true ? undefined : legendsOpt[channel];
            if (perChannel === false) continue;
            if (legendsOpt !== true && perChannel === undefined) continue;
            // `legends: true` skips a channel with no legend form silently; naming
            // one explicitly warns below.
            if (!LEGENDABLE.includes(channel)) continue;
            cfg = perChannel || {};
        }

        // An explicitly requested legend on a channel with no shape would draw a
        // misleading grey bar; say so instead of drawing one.
        if (!LEGENDABLE.includes(channel)) {
            warn(
                `legend:channel:${channel}`,
                `a legend was asked for on channel "${channel}", which has no legend form. ` +
                `Legendable channels are ${LEGENDABLE.join(', ')}.` +
                (channel === 'x' || channel === 'y' ? ' An axis is the key for x/y.' : '')
            );
            continue;
        }

        // Strip the edit from the channel, or the mark's nodes go pointer-active and
        // eat clicks the edit cannot apply.
        if (moving.length) {
            const staying = list.filter((e) => /** @type {any} */ (e).scope !== 'legend');
            const next = { ...spec };
            if (staying.length) next.edit = staying.length === 1 ? staying[0] : staying;
            else delete next.edit;
            enc.feature.channels[channel] = next;
        }

        const existing = explicitFor(channel, field);
        if (existing) {
            // The element already draws this encoding: fill in only the options it
            // leaves unstated. Edits go through `elementEdits`, never the option
            // merge: `legend()` folds `edit`/`edits` at construction, so assigning
            // `existing.edit` now would be read by nothing.
            const fromChannel = [...moving, ...elementEdits(cfg, channel)];
            if (fromChannel.length) {
                existing.edits = [...(existing.edits || []), ...elementEdits({ edits: fromChannel }, channel)];
            }
            for (const [k, v] of Object.entries(cfg)) {
                if (k === 'edit' || k === 'edits') continue;
                if (existing[k] === undefined) existing[k] = v;
            }
            continue;
        }
        // Merge both spellings of an editable legend: `legend: { edit }` and a
        // legend-scoped edit on the channel.
        const { edit: _e, edits: _es, ...look } = cfg;
        const lg = legend({
            ...look, channel, field, table: enc.table,
            edits: [...elementEdits(cfg, channel), ...moving],
        });
        // Not an option; carried so the binding pass puts the legend on the mark's table.
        lg.tableRole = enc.tableRole;
        minted.push(lg);
    }
    return minted;
}

/**
 * Measure the legends in `features` against the resolved `scales` and return the
 * extra space each side needs. Each legend's `_place` is stamped with `offset`
 * (distance from the plot edge to the legend's near edge, past the author margin
 * and any earlier legend on that side) and `size` (its extent across the side).
 *
 * @param {any[]} features
 * @param {import('../types').ScaleMap} scales
 * @param {Sides} authorMargins the author's declared margins (outer padding / axis room)
 * @param {number} [gap] pixels between the plot edge (and stacked legends) and a legend
 * @param {{ width: number, height: number }} [dims] the plot's inner size, so a
 *   horizontal legend can wrap its items into rows
 * @returns {Sides} band size to add to each side
 */
export function reserveLegends(features, scales, authorMargins, gap = 8, dims = undefined) {
    /** @type {Sides} */
    const bands = { top: 0, right: 0, bottom: 0, left: 0 };
    const legends = (features || []).filter((f) => f && f.isLegend && typeof f.measure === 'function');
    if (!legends.length) return bands;

    // Running near-edge offset per side: start past the author's margin (where an
    // axis lives) so a bottom legend clears the x-axis, a left legend the y-axis.
    /** @type {Sides} */
    const offset = {
        top: authorMargins.top + gap,
        right: authorMargins.right + gap,
        bottom: authorMargins.bottom + gap,
        left: authorMargins.left + gap,
    };

    for (const lg of legends) {
        const side = /** @type {keyof Sides} */ (lg.anchor || 'right');
        // Found by (channel, field), the same lookup build() does, so the reserved
        // band matches the drawn legend.
        const scale = scaleFor(scales, lg.channel, lg.field);
        const box = scale ? lg.measure(scales, dims) : null;
        if (!box) { lg._place.offset = 0; lg._place.size = 0; continue; }
        // A vertical legend reserves its width on the side; a horizontal one its height.
        const across = lg.orient === 'vertical' ? box.width : box.height;
        lg._place.offset = offset[side];
        lg._place.size = across;
        offset[side] += across + gap;
        bands[side] += across + gap;
    }
    return bands;
}
