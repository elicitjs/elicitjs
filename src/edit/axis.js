// @ts-check
// axis.js — edits on a numeric/temporal axis (scope 'axis'). They write the
// schema's domain (`target: 'domain'`), returning { domains, resize? }:
//   edit.axis.scale()       drag an end-handle to rescale the range
//   edit.axis.zoom()        the wheel narrows / widens the domain about the pointer
//   edit.axis.pan()         drag the plot to slide the domain along
// Zoom and pan declare `viewport: true`, which turns on clipping.

import { makeEdit, numOf } from './shared.js';
import { warn } from '../core/dev.js';
import { DEFAULT_MARGINS } from '../core/scene.js';

/**
 * The fields whose domain the edit writes: `field` if given, else every field on
 * the axis's scale (`scale.fields`).
 * @param {any} scale @param {string | undefined} field @returns {string[]}
 */
function targetFields(scale, field) {
    if (field) return [field];
    return (scale && scale.fields) || [];
}

/** Set the same domain on every target field. @param {string[]} fields @param {any[]} domain */
function domainsFor(fields, domain) {
    /** @type {Record<string, any[]>} */
    const domains = {};
    for (const f of fields) domains[f] = domain;
    return domains;
}

/**
 * The widest window a zoom or pan may show: the field's domain as declared at
 * Elicit() (`'declared'`, the default), an explicit [lo, hi], or null for none.
 * @param {'declared' | any[] | false | undefined} limit
 * @param {import('../types').EditContext} ctx
 * @param {string[]} fields
 * @returns {any[] | null}
 */
function ceilingOf(limit, ctx, fields) {
    if (limit === 'declared' || limit === undefined) {
        const f = ctx.seedSchema && ctx.seedSchema[fields[0]];
        return (f && f.domain) || null;
    }
    return Array.isArray(limit) ? limit : null;
}

/**
 * Fit the window [lo, hi] inside the ceiling, keeping its span where it can: too
 * wide becomes the ceiling, an overhang slides back inside.
 * @param {number} lo @param {number} hi @param {any[] | null} ceiling
 * @returns {[number, number]}
 */
function fitWithin(lo, hi, ceiling) {
    if (!ceiling || ceiling.length < 2) return [lo, hi];
    const a = numOf(ceiling[0]);
    const b = numOf(ceiling[ceiling.length - 1]);
    const clo = Math.min(a, b);
    const chi = Math.max(a, b);
    if (!Number.isFinite(clo) || !Number.isFinite(chi)) return [lo, hi];
    if (hi - lo >= chi - clo) return [clo, chi];
    if (lo < clo) return [clo, hi + (clo - lo)];
    if (hi > chi) return [lo - (hi - chi), chi];
    return [lo, hi];
}

/**
 * edit.axis.scale — drag an end-handle to change the axis's range. The axisDrag
 * driver stores the grabbed handle's dragstart snapshot in ctx.session.
 *
 *   rescale (default) — the pixel range is fixed; the other end keeps its value
 *     and the grabbed end follows the pointer.
 *   grow — pixels-per-unit is fixed and the chart resizes (`resize` in the result).
 *
 * @param {{ field?: string, mode?: 'rescale' | 'grow', pick?: string, [k: string]: any }} [options]
 * @returns {import('../types').Edit}
 */
export function scale(options = {}) {
    const { field, mode = 'rescale', ...rest } = options;
    const MIN_PX = 6; // guard: never divide by a near-zero anchor→pointer distance
    // Direct-pick, claimed by the axisDrag driver by type, so the plane stays down.
    dropPick(rest, 'axis.scale', 'direct', 'is served by the axis-drag driver from its own handles,', ' (direct pick)');
    return makeEdit({
        type: 'axis.scale',
        gesture: 'drag',
        pick: 'direct',
        scope: 'axis',
        target: 'domain',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const lock = ctx.session;
            const ch = ctx.channels[0];
            if (!lock || !lock.grabEnd || !ch || !ch.scale) return undefined;
            const fields = targetFields(ch.scale, field);
            if (!fields.length) return undefined;

            const aP = /** @type {number} */ (lock.anchorPixel);
            const aV = numOf(lock.anchorValue);
            const gV = numOf(lock.grabValue);
            const temporal = lock.anchorValue instanceof Date || lock.grabValue instanceof Date;
            const p = lock.axis === 'x' ? ctx.pointer.x : ctx.pointer.y;

            // Signed pixel distances from the anchored extreme.
            let Lp = p - aP;
            const Lg = /** @type {number} */ (lock.grabPixel) - aP;
            if (Math.abs(Lp) < MIN_PX) Lp = Lp < 0 ? -MIN_PX : MIN_PX;

            let newExtreme;
            if (mode === 'grow') {
                // Hold pixels per data unit; the chart grows to fit (below).
                const k = /** @type {number} */ (lock.pxPerUnit) || (Lg / (gV - aV || 1));
                newExtreme = aV + Lp / (k || 1);
            } else {
                // Fixed pixel range: put the grabbed value under the pointer.
                newExtreme = aV + (gV - aV) * (Lg / Lp);
            }

            const loNum = Math.min(aV, newExtreme);
            const hiNum = Math.max(aV, newExtreme);
            if (!Number.isFinite(loNum) || !Number.isFinite(hiNum) || hiNum <= loNum) return undefined;
            const domain = temporal ? [new Date(loNum), new Date(hiNum)] : [loNum, hiNum];

            /** @type {import('../types').DomainEditResult} */
            const result = { domains: domainsFor(fields, domain) };

            if (mode === 'grow') {
                // Outer chart size that fits the new domain at the locked slope.
                const k = Math.abs(/** @type {number} */ (lock.pxPerUnit) || 1);
                const inner = (hiNum - loNum) * k;
                const m = ctx.margins || DEFAULT_MARGINS;
                result.resize = lock.axis === 'x'
                    ? { width: inner + m.left + m.right }
                    : { height: inner + m.top + m.bottom };
            }
            return result;
        }
    });
}

/**
 * Drop a `pick` an axis edit cannot honour, and say so.
 * @param {any} rest the caller's options (mutated)
 * @param {string} type @param {string} pick the pick the edit is bound to
 * @param {string} why @param {string} [note]
 */
function dropPick(rest, type, pick, why, note = '') {
    if (rest.pick == null || rest.pick === pick) return;
    warn(`${type}:pick`, `edit.${type}() ${why} so { pick: "${rest.pick}" } is ignored${note}.`);
    delete rest.pick;
}

/**
 * What zoom and pan read off the axis: the fields it writes, its scale, and the
 * current domain with its pixel ends. Null when the axis can't be moved.
 * @param {import('../types').EditContext} ctx
 * @param {string | undefined} field
 */
function axisWindow(ctx, field) {
    const ch = ctx.channels[0];
    if (!ch || !ch.scale || ch.scale.kind !== 'continuous' || !ch.scale.invertible) return null;
    const fields = targetFields(ch.scale, field);
    if (!fields.length) return null;
    const sc = /** @type {any} */ (ch.scale);
    const dom = typeof sc.domain === 'function' ? sc.domain() : null;
    if (!dom || dom.length < 2 || typeof sc.invert !== 'function') return null;
    const r0 = Number(sc.encode(dom[0]));
    const r1 = Number(sc.encode(dom[dom.length - 1]));
    if (!Number.isFinite(r0) || !Number.isFinite(r1)) return null;
    return {
        fields, sc, r0, r1,
        axis: ch.name === 'y' ? 'y' : 'x',
        lo: numOf(dom[0]),
        hi: numOf(dom[dom.length - 1]),
        temporal: dom[0] instanceof Date || dom[dom.length - 1] instanceof Date,
    };
}

/**
 * edit.axis.zoom — the wheel narrows or widens an axis's domain about the value
 * under the pointer. Undoable (ticks coalesce); `el.setDomain` is its external twin.
 * A plane edit that never raises the plane. Place one per axis
 * (`axes: { x: { edit: edit.axis.zoom() } }`); gate with `when` for one-axis zoom.
 *
 *   factor   how much one notch (100 px of wheel delta) scales the span (default 1.2)
 *   limit    the widest the domain may zoom OUT to: 'declared' (the field's domain
 *            as declared at Elicit(), the default), an explicit [lo, hi], or
 *            false for no limit
 *   minSpan  the narrowest span it may zoom IN to, in data units (default: none)
 * @param {{ field?: string, factor?: number, limit?: 'declared' | any[] | false, minSpan?: number, [k: string]: any }} [options]
 * @returns {import('../types').Edit}
 */
export function zoom(options = {}) {
    const { field, factor = 1.2, limit = 'declared', minSpan, ...rest } = options;
    dropPick(rest, 'axis.zoom', 'plane', 'is a plane gesture (a wheel tick has no press),');
    return makeEdit({
        type: 'axis.zoom',
        gesture: 'wheel',
        pick: 'plane',
        scope: 'axis',
        target: 'domain',
        inverts: true,
        viewport: true,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const win = axisWindow(ctx, field);
            if (!win) return undefined;
            const { fields, sc, axis, r0, r1, lo, hi, temporal } = win;
            // A Shift-wheel arrives as horizontal travel in most browsers.
            const delta = Number(ctx.deltaY) || Number(ctx.deltaX) || 0;
            if (!delta) return undefined;
            // Scale the span about the pointer in pixel space, so log/time axes work.
            const p = axis === 'x' ? ctx.pointer.x : ctx.pointer.y;
            const k = Math.pow(factor, delta / 100);
            const a = numOf(sc.invert(p + (r0 - p) * k));
            const b = numOf(sc.invert(p + (r1 - p) * k));
            let nlo = Math.min(a, b);
            let nhi = Math.max(a, b);
            // Zoom-out ceiling: the declared domain (or an explicit one).
            [nlo, nhi] = fitWithin(nlo, nhi, ceilingOf(limit, ctx, fields));
            if (typeof minSpan === 'number' && minSpan > 0 && nhi - nlo < minSpan) {
                const mid = (nlo + nhi) / 2;
                nlo = mid - minSpan / 2;
                nhi = mid + minSpan / 2;
            }
            if (!Number.isFinite(nlo) || !Number.isFinite(nhi) || nhi <= nlo) return undefined;
            if (nlo === lo && nhi === hi) return undefined;
            const domain = temporal ? [new Date(nlo), new Date(nhi)] : [nlo, nhi];
            return { domains: domainsFor(fields, domain) };
        }
    });
}

/**
 * edit.axis.pan — drag the plot to slide an axis's domain. One drag is one undo
 * step. Served by the pan driver (`pick: 'pan'`); a press on a mark with an
 * accepting direct edit still grabs the mark. Put one on each axis to pan.
 *
 * Each tick shifts by the pointer's travel since the last tick, through the live
 * scale, so a mid-drag zoom composes.
 *
 *   limit   how far it may pan: 'declared' (the declared domain, the default),
 *           an explicit [lo, hi], or false for no limit
 * @param {{ field?: string, limit?: 'declared' | any[] | false, [k: string]: any }} [options]
 * @returns {import('../types').Edit}
 */
export function pan(options = {}) {
    const { field, limit = 'declared', ...rest } = options;
    dropPick(rest, 'axis.pan', 'pan', 'is served by the pan driver (it moves the whole view, so it picks no target),');
    return makeEdit({
        type: 'axis.pan',
        gesture: 'drag',
        pick: 'pan',
        scope: 'axis',
        target: 'domain',
        inverts: true,
        viewport: true,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const from = ctx.session && ctx.session.panFrom;
            if (!from) return undefined;
            const win = axisWindow(ctx, field);
            if (!win) return undefined;
            const { fields, sc, axis, r0, r1, lo, hi, temporal } = win;
            const d = axis === 'x' ? ctx.pointer.x - from.x : ctx.pointer.y - from.y;
            if (!d || !Number.isFinite(d)) return undefined;
            // The window moves against the pointer.
            const a = numOf(sc.invert(r0 - d));
            const b = numOf(sc.invert(r1 - d));
            let [nlo, nhi] = fitWithin(Math.min(a, b), Math.max(a, b), ceilingOf(limit, ctx, fields));
            if (!Number.isFinite(nlo) || !Number.isFinite(nhi) || nhi <= nlo) return undefined;
            if (nlo === Math.min(lo, hi) && nhi === Math.max(lo, hi)) return undefined;
            const domain = temporal ? [new Date(nlo), new Date(nhi)] : [nlo, nhi];
            return { domains: domainsFor(fields, domain) };
        }
    });
}
