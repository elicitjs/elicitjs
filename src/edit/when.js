// @ts-check
// when.js — predicates for an edit's `when`, which decides whether the edit claims
// a gesture (e.g. Alt-click deletes) without changing what it does.

import { nearestSeries, pickThreshold } from './pick.js';

/**
 * The proximity radius `when.near`/`when.far` arbitrate with: the active edit's
 * own `threshold` when it set one, else the shared pick default.
 * @param {import('../types').EditContext} ctx
 * @returns {number}
 */
const thresholdOf = (ctx) => pickThreshold(ctx.edit);

export const when = {
    /** @param {import('../types').EditContext} ctx */
    shift: (ctx) => !!(ctx.event && ctx.event.shiftKey),
    /** @param {import('../types').EditContext} ctx */
    noShift: (ctx) => !(ctx.event && ctx.event.shiftKey),
    /** @param {import('../types').EditContext} ctx */
    alt: (ctx) => !!(ctx.event && ctx.event.altKey),
    /** @param {import('../types').EditContext} ctx */
    noAlt: (ctx) => !(ctx.event && ctx.event.altKey),
    /** @param {string} key */
    modifier: (key) => (/** @type {import('../types').EditContext} */ ctx) => !!(ctx.event && ctx.event[key]),
    /** @param {string} key */
    noModifier: (key) => (/** @type {import('../types').EditContext} */ ctx) => !(ctx.event && ctx.event[key]),
    // Is the pointer near an existing line (within the edit's threshold)? E.g.
    // anchor({ when: when.near }) with newSeries({ when: when.far }).
    /** @param {import('../types').EditContext} ctx */
    near: (ctx) => nearestSeries(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, thresholdOf(ctx)) != null,
    /** @param {import('../types').EditContext} ctx */
    far: (ctx) => nearestSeries(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, thresholdOf(ctx)) == null,
    /** @param {number} t @returns {(ctx: import('../types').EditContext) => boolean} */
    nearWithin: (t) => (/** @type {import('../types').EditContext} */ ctx) => nearestSeries(ctx.marks || [], ctx.pointer.x, ctx.pointer.y, t) != null
};
