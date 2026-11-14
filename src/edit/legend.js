// @ts-check
// legend.js — edits that use a legend as an input (scope 'legend'). They read
// geometry only a legend stamps: a category picker on a discrete legend, a value
// picker on a colour ramp.
//
//   elements.legend({ channel: 'fill', edit: edit.legend.category() })
//   elements.legend({ channel: 'fill', edit: edit.legend.value() })

import { makeEdit } from './shared.js';

/**
 * Write `value` into `field` on every row the legend targets (`node.indices`,
 * from the legend's `row`, by default the selection). Returns one datum for a
 * single row, else the whole array.
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
 * category — click a swatch to set the channel's field to its `node.category`
 * on the legend's target row (by default the selection; see `edit.select`).
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
            // The column the legend's own encoding uses.
            const field = ctx.channels[0]?.field;
            if (!field || !ctx.node || ctx.datum == null) return undefined;
            const value = ctx.node.category;
            if (value === undefined) return undefined;
            return writeCategory(ctx, field, value);
        }
    });
}

/**
 * value — drag the handle on a colour ramp to set the channel's field. The pointer
 * is mapped linearly along the handle's ramp geometry and clamped to [lo, hi].
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
            const field = ctx.channels[0]?.field;
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
