// @ts-check
// legend.js — the two edits that turn a LEGEND into an input.
//
// Scope goes in the name. Both of these read geometry that only a legend element
// stamps — `node.category` on a swatch, `node.rampStart`/`rampEnd`/`loValue`/
// `hiValue`/`along` on a ramp handle — so neither works on any other feature.
// They used to sit in the UNIVERSAL namespace (`edit.legend`, `edit.legendValue`)
// beside `move` and `create`, which said they applied to any mark; they don't.
// Namespaced here, they read the same way `edit.waffle.fill` and `edit.stack.cut`
// already did, and the engine's capability guard can check the mark:
// `scope: 'legend'` resolves to the `isLegend` flag the legend element sets.
//
// The pair splits the way a legend itself does — a DISCRETE legend is a list of
// swatches, so its edit is a category picker; a CONTINUOUS legend is a colour
// ramp, so its edit is a value picker along that ramp.
//
//   elements.legend({ channel: 'fill', edit: edit.legend.category() })
//   elements.legend({ channel: 'fill', edit: edit.legend.value() })

import { makeEdit } from './shared.js';

/**
 * The column a legend edit writes into: the one its ENCODING uses.
 *
 * There is nothing to choose any more. A legend is a key for one (channel, field)
 * pair, so `resolveChannels` resolves that field from the legend itself and the
 * edit simply writes it. This used to be a three-step fallback ending in
 * `scale.fields[0]` — the union of every field on the channel, in declaration
 * order — because a legend drew a channel rather than an encoding.
 * @param {import('../types').ResolvedChannel} ch
 * @returns {string | undefined}
 */
function legendField(ch) {
    return ch ? ch.field : undefined;
}

/**
 * Write `value` into `field` on every row the legend is targeting.
 *
 * A swatch names a VALUE, not a row, so the rows come from the legend's `row` —
 * which defaults to the chart's SELECTION and can therefore hold several. The
 * swatch carries them as `node.indices`; `node.index` is only the first, because
 * direct-pick dispatch keys on a single index.
 *
 * Returns one datum when a single row is targeted (the engine splices it at
 * ctx.index) and the whole array when several are, which is the shape a
 * whole-dataset edit returns. Falling back to `ctx.datum` keeps a legend built
 * before `indices` existed working unchanged.
 * @param {import('../types').EditContext} ctx
 * @param {string} field
 * @param {any} value
 * @returns {any}
 */
function writeCategory(ctx, field, value) {
    const rows = (ctx.node && /** @type {any} */ (ctx.node).indices) || [];
    if (rows.length > 1) {
        const set = new Set(rows);
        return ctx.data.map((/** @type {any} */ d, /** @type {number} */ i) =>
            (set.has(i) ? { ...d, [field]: value } : d));
    }
    return { ...ctx.datum, [field]: value };
}

/**
 * category — a discrete CATEGORY PICKER: click a swatch to set the channel's field
 * to that category. A direct-pick click on the swatch node, which carries the value
 * it stands for (`node.category`), so the box you click IS the swatch you see with
 * no separate hit-test geometry to keep in sync. The legend injects the channel;
 * the value is written into the target datum (the legend's `row`, which defaults to
 * the chart's selection — see `edit.select`).
 * @param {import('../types').LegendEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function category(options = {}) {
    return makeEdit({
        type: 'legend.category',
        gesture: 'click',
        pick: 'direct',
        scope: 'legend',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const field = legendField(ctx.channels[0]);
            if (!field || !ctx.node || ctx.datum == null) return undefined;
            const value = ctx.node.category;
            if (value === undefined) return undefined;
            return writeCategory(ctx, field, value);
        }
    });
}

/**
 * value — a continuous VALUE PICKER: drag the handle on a colour ramp to set the
 * channel's field to a number. The handle node carries the ramp's band geometry
 * (`rampStart`/`rampEnd`/`loValue`/`hiValue`/`along`), and the pointer is mapped
 * along that band BY HAND — a colour scale isn't invertible, so `invertChannel`
 * can't do it, which is the whole reason this edit exists rather than a `slide`.
 * The value is clamped into [lo, hi] and written into the target datum.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function value(options = {}) {
    return makeEdit({
        type: 'legend.value',
        gesture: 'drag',
        pick: 'direct',
        scope: 'legend',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const node = ctx.node;
            if (!node || node.rampStart == null || node.rampEnd == null) return undefined;
            const field = legendField(ctx.channels[0]);
            if (!field || ctx.datum == null) return undefined;
            const span = node.rampEnd - node.rampStart;
            if (!span) return undefined;
            const pos = node.along === 'y' ? ctx.pointer.y : ctx.pointer.x;
            const t = Math.max(0, Math.min(1, (pos - node.rampStart) / span));
            const v = node.loValue + t * (node.hiValue - node.loValue);
            return writeCategory(ctx, field, v);
        }
    });
}
