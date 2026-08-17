// @ts-check
// legends.js — the layout-negotiation step for legends, kept out of the engine
// the same way core/axes.js keeps the axis desugar out of elicit.js.
//
// Legends are the first chrome in this codebase that RESERVES space: a legend on
// a side shrinks the plot so it never overlaps the marks. Nothing else does this —
// margins are otherwise a fixed author input, and axes merely draw into the slack
// the author already left. So this module measures every legend, sums the space
// each side needs, and hands back per-side band sizes the engine adds to the
// author margins (effective margins). It also stamps each legend's `_place` with
// where its band landed, so the mark's build() can position itself there without a
// widened signature (the same mutable-object transport `_place` documents).

import { legend } from '../plot/legend.js';
import { elementEdits } from '../plot/mark.js';
import { warn } from './dev.js';
import { frameSpecOf } from './encoding.js';
import { scaleKey } from './scales.js';

/** @typedef {{ top: number, right: number, bottom: number, left: number }} Sides */

/**
 * The channels a legend can describe: the non-positional ones a reader needs a key
 * for. x/y are excluded because an AXIS is the key for those.
 * @type {string[]}
 */
export const LEGENDABLE = ['fill', 'stroke', 'size', 'symbol', 'opacity', 'angle', 'strokeWidth'];

/**
 * Every ENCODING a legend could be a key for: one entry per (channel, field) pair
 * a data mark declares, in first-seen order, carrying the table it came from and
 * whatever the channel said about a legend.
 *
 * This is the list the whole module works from, because a legend is a key for one
 * ENCODING and not for a channel. Keyed by channel alone, two marks colouring by
 * different fields shared one legend that listed the union of both vocabularies
 * and could not say which it belonged to.
 *
 * Channels that resolve NO global scale are skipped: a constant (nothing to
 * explain), a composite's local `frame` geometry (its scale is per-datum, and
 * `autoLegends` used to mint a phantom legend for one), `scale: null`, and a raw
 * channel the mark reads itself.
 * @param {any[]} features the user's marks and elements (unflattened)
 * @returns {{ channel: string, field: string, table: any, tableRole: any, spec: any, feature: any }[]}
 */
function encodingsOf(features) {
    const flat = /** @type {any[]} */ (features || []).flat(Infinity).filter(
        (f) => f && typeof f === 'object'
    );
    /** @type {any[]} */
    const out = [];
    for (const f of flat) {
        if (f.views === 'scale' || !f.channels) continue;
        const raw = new Set(f.rawChannels || []);
        for (const [channel, spec] of Object.entries(f.channels)) {
            const chSpec = /** @type {any} */ (spec);
            if (!chSpec || chSpec.field == null) continue;
            if (chSpec.scale === null || raw.has(channel) || frameSpecOf(chSpec)) continue;
            if (out.some((e) => e.channel === channel && e.field === chSpec.field)) continue;
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
 * Build the chart's legends from the ENCODINGS its marks declare.
 *
 * Replaces the two passes that used to do this by channel — `autoLegends` (the
 * `legends:` key) and `relocateLegendEdits` (an edit declared on a mark's channel,
 * moved to that channel's legend). Both are now the same act: a legend is minted
 * for an encoding, and it is asked for in one of three places, most specific first.
 *
 *   1. an ELEMENT the author composed — `legendColor({ field: 'group' })`
 *   2. the CHANNEL — `fill: { field: 'group', legend: { anchor: 'bottom' } }`
 *   3. the chart — `legends: true`
 *
 * An element wins for its encoding and suppresses the minted one, exactly as an
 * explicit `axisX()` wins over the injected axis; the channel's options and any
 * legend-scoped edit merge INTO it, so the mark says what is edited and the element
 * says how it looks. `legend: false | null` on the channel suppresses, whatever the
 * chart-level key says.
 *
 * A legend-scoped edit is STRIPPED from the channel on the way out. Left there it
 * would make the mark's own nodes pointer-active and fire on a click that landed on
 * a bar, where `node.category` is undefined and the apply bails — a mark that eats
 * gestures and does nothing.
 *
 * @param {any[]} features the user's marks and elements (unflattened)
 * @param {any} legendsOpt the `legends` spec key
 * @returns {any[]} the legend features to append
 */
export function legendsFromChannels(features, legendsOpt) {
    const flat = /** @type {any[]} */ (features || []).flat(Infinity).filter(
        (f) => f && typeof f === 'object'
    );
    const encodings = encodingsOf(features);
    /** @param {string} ch */
    const onChannel = (ch) => encodings.filter((e) => e.channel === ch);

    // Bind every composed element to an ENCODING. One that names a field says which;
    // one that doesn't can only be unambiguous when the channel carries a single
    // encoding — and now that each is its own scale, the engine KNOWS when it isn't,
    // so this is a precise message rather than the old silent `scale.fields[0]` pick.
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

        // A legend-scoped edit written straight on the channel — `fill: { field,
        // edit: edit.legend.category() }` — is itself a request for a legend: the
        // gesture happens on a legend, so one has to exist. Resolved BEFORE the
        // "is a legend wanted" question, because it can answer it.
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
            // `legends: true` means "keys for everything that has one", so a channel
            // with no legend FORM is skipped in silence — asking for all the keys is
            // not asking for a wrong one. Naming it explicitly does warn, below.
            if (!LEGENDABLE.includes(channel)) continue;
            cfg = perChannel || {};
        }

        // An explicitly requested legend on a channel with no SHAPE would draw a
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

        // The edit travels to the legend and is STRIPPED from the channel, or the
        // mark's own nodes go pointer-active and eat a click where the edit's node
        // geometry (a swatch's `category`) is undefined and the apply bails.
        if (moving.length) {
            const staying = list.filter((e) => /** @type {any} */ (e).scope !== 'legend');
            const next = { ...spec };
            if (staying.length) next.edit = staying.length === 1 ? staying[0] : staying;
            else delete next.edit;
            enc.feature.channels[channel] = next;
        }

        const existing = explicitFor(channel, field);
        if (existing) {
            // The element already draws this encoding: merge what the channel said
            // INTO it rather than minting a second key for one scale. The mark says
            // WHAT is edited, the element says how it looks — so the element's own
            // options win and only unstated ones are filled in.
            //
            // Edits go through `elementEdits`, never through the option merge:
            // `legend()` folds `edit`/`edits` into its `edits` list at construction,
            // so assigning `existing.edit` afterwards would be read by nothing. That
            // is both the channel's `legend: { edit }` and a legend-scoped edit
            // written directly on the channel.
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
        // Both spellings of "this legend is editable" merge into one list: the edit
        // inside `legend: { edit }`, and a legend-scoped edit written directly on the
        // channel. Passing `edit: moving` alone would silently drop the first.
        const { edit: _e, edits: _es, ...look } = cfg;
        const lg = legend({
            ...look, channel, field, table: enc.table,
            edits: [...elementEdits(cfg, channel), ...moving],
        });
        // Not an option (a legend has no role of its own) — carried so the engine's
        // binding pass lands the legend on the same table as the mark that declared
        // the encoding, whatever that table is named.
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
 * @returns {Sides} band size to add to each side
 */
export function reserveLegends(features, scales, authorMargins, gap = 8) {
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
        // May be absent at runtime (channel not bound to a field); the ScaleMap
        // index type says otherwise, so read it loosely.
        // A legend is a key for one ENCODING, so its scale is found by
        // (channel, field) — the same lookup its build() does, or the band it
        // reserves would not be the legend it draws.
        const scale = /** @type {any} */ (scales)[scaleKey(lg.channel, lg.field)]
            || /** @type {any} */ (scales)[lg.channel];
        const box = scale ? lg.measure(scales) : null;
        if (!box) { lg._place.offset = 0; lg._place.size = 0; continue; }
        // A vertical legend reserves its WIDTH on the side; a horizontal one its HEIGHT.
        const across = lg.orient === 'vertical' ? box.width : box.height;
        lg._place.offset = offset[side];
        lg._place.size = across;
        offset[side] += across + gap;
        bands[side] += across + gap;
    }
    return bands;
}
