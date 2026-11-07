// @ts-check
// axis.js — the EDITABLE-AXIS edits (scope 'axis'). Unlike every other edit these
// write the SCHEMA's DOMAIN, not the dataset: they carry `target: 'domain'`, and
// their apply returns { domains, data?, resize? } for the engine's domain-commit
// path (see core/elicit.js). The domain is the data's own property, so reshaping it
// IS the edit — grids, guides and marks then reflow from it on the next render.
//
// Two edits, because a numeric axis and a categorical one want incompatible
// interaction models (a driven drag vs. direct clicks + inline typing) and one axis
// is only ever one kind:
//   edit.axis.scale()       numeric/temporal — drag an end-handle to rescale the range
//
// Both are namespaced under `edit.axis.*` so the scope shows in the name, mirroring
// `edit.line.*`. The axis mark wires them (plot/axis.js): it forwards the edit and,
// per the scale's kind, emits the handle / label / add / remove affordance nodes.

import { makeEdit, numOf } from './shared.js';
import { warn } from '../core/dev.js';

/**
 * The schema fields whose domain a domain edit writes: an explicit `field` (when the
 * axis pins one) else every field unioned onto the axis (scale.fields, stamped by
 * resolveScales). A single-field axis -> one field; an error bar's y -> mean/lo/hi.
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
 * edit.axis.scale — drag an end-handle of a numeric/temporal axis to grow or shrink
 * its range. The axisDrag driver locks the grabbed handle at dragstart (which end,
 * the anchored extreme's pixel+value, this extreme's pixel+value, the slope) into
 * ctx.session; this apply turns that snapshot + the live pointer into the new
 * [min,max]:
 *
 *   rescale (default) — the pixel range is fixed; the anchored extreme keeps its
 *     value, and the grabbed extreme moves so its handle follows the pointer. The
 *     chart stays the same size (marks compress/expand into it).
 *   grow — the pixels-per-unit is held constant and the chart RESIZES instead, so
 *     the data keeps its scale (a `resize` hint rides along in the result).
 *
 * @param {{ field?: string, mode?: 'rescale' | 'grow', pick?: string, [k: string]: any }} [options]
 * @returns {import('../types').Edit}
 */
export function scale(options = {}) {
    const { field, mode = 'rescale', ...rest } = options;
    const MIN_PX = 6; // guard: never divide by a near-zero anchor→pointer distance
    // The axisDrag driver claims this edit by CAPABILITY (its type), so it runs its
    // dragstart lock from the handle node the press landed on and the plane is
    // never raised — an axis you can rescale no longer silences every mark drag on
    // the chart. Under any other pick the edit would reach a driver by name too.
    if (rest.pick != null && rest.pick !== 'direct') {
        warn(
            'axis.scale:pick',
            `edit.axis.scale() is served by the axis-drag driver from its own handles, ` +
            `so { pick: "${rest.pick}" } is ignored (direct pick).`
        );
        delete rest.pick;
    }
    return makeEdit({
        type: 'axis.scale',
        gesture: 'drag',
        pick: 'direct',
        scope: 'axis',
        target: 'domain',
        // The rest of the caller's options — `name` (so el.control() can drive it),
        // `stage`, `guide`, `constrain`, `when`. This factory used to read only
        // `field`/`mode` and drop everything else without a word, so an axis edit
        // could not be staged, named or guided at all.
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
                // Hold the slope (pixels per data unit) constant; the grabbed extreme
                // tracks the pointer, and the chart grows to fit it (below).
                const k = /** @type {number} */ (lock.pxPerUnit) || (Lg / (gV - aV || 1));
                newExtreme = aV + Lp / (k || 1);
            } else {
                // Fixed pixel range: keep the anchored extreme's value, move the
                // grabbed value under the pointer -> the range end becomes newExtreme.
                newExtreme = aV + (gV - aV) * (Lg / Lp);
            }

            const loNum = Math.min(aV, newExtreme);
            const hiNum = Math.max(aV, newExtreme);
            if (!Number.isFinite(loNum) || !Number.isFinite(hiNum) || hiNum <= loNum) return undefined;
            const domain = temporal ? [new Date(loNum), new Date(hiNum)] : [loNum, hiNum];

            /** @type {import('../types').DomainEditResult} */
            const result = { domains: domainsFor(fields, domain) };

            if (mode === 'grow') {
                // Keep the data's pixels-per-unit: the inner axis length must span the
                // whole new domain at the locked slope. Report the OUTER size (inner +
                // the two margins on that axis) for the engine to resize the chart to.
                const k = Math.abs(/** @type {number} */ (lock.pxPerUnit) || 1);
                const inner = (hiNum - loNum) * k;
                const m = ctx.margins || { top: 20, right: 20, bottom: 30, left: 40 };
                result.resize = lock.axis === 'x'
                    ? { width: inner + m.left + m.right }
                    : { height: inner + m.top + m.bottom };
            }
            return result;
        }
    });
}

/**
 * edit.axis.zoom — the wheel over the plot narrows or widens a positional
 * axis's DOMAIN about the value under the pointer. Zoom is a schema change: a
 * domain describes the data, so zooming writes the field's domain exactly as a
 * handle drag (`edit.axis.scale`) does, and everything downstream — scales,
 * axes, marks, guides — reflows from it. It goes through the same domain-commit
 * path, so it is undoable (wheel ticks coalesce into one entry) and
 * `el.setDomain(field, domain)` is its external twin.
 *
 * A wheel tick has no press and no lifecycle, so it is a plain PLANE edit
 * (`pick: 'plane'`): the plane driver runs it on its gesture and the plane is
 * never raised above the marks. Place it on an axis (`axes: { x: { edit:
 * edit.axis.zoom() } }`), one per axis; gate one with a modifier for one-axis
 * zoom (`when: when.shift`).
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
    if (rest.pick != null && rest.pick !== 'plane') {
        warn(
            'axis.zoom:pick',
            `edit.axis.zoom() is a plane gesture (a wheel tick has no press), so ` +
            `{ pick: "${rest.pick}" } is ignored.`
        );
        delete rest.pick;
    }
    return makeEdit({
        type: 'axis.zoom',
        gesture: 'wheel',
        pick: 'plane',
        scope: 'axis',
        target: 'domain',
        inverts: true,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            if (!ch || !ch.scale || ch.scale.kind !== 'continuous' || !ch.scale.invertible) return undefined;
            const fields = targetFields(ch.scale, field);
            if (!fields.length) return undefined;
            const axis = ch.name === 'y' ? 'y' : 'x';
            const dom = typeof ch.scale.domain === 'function' ? ch.scale.domain() : null;
            if (!dom || dom.length < 2) return undefined;
            const temporal = dom[0] instanceof Date || dom[dom.length - 1] instanceof Date;
            const lo = numOf(dom[0]);
            const hi = numOf(dom[dom.length - 1]);
            const delta = Number(ctx.deltaY) || 0;
            if (!delta) return undefined;
            // The value under the pointer stays put; the span scales about it.
            const p = axis === 'x' ? ctx.pointer.x : ctx.pointer.y;
            const anchor = numOf(ch.scale.invertValue(p));
            if (!Number.isFinite(anchor)) return undefined;
            const k = Math.pow(factor, delta / 100);
            let nlo = anchor + (lo - anchor) * k;
            let nhi = anchor + (hi - anchor) * k;
            // Zoom-out ceiling: the declared domain (or an explicit one).
            const ceiling = limit === 'declared'
                ? (ctx.seedSchema && ctx.seedSchema[fields[0]] && ctx.seedSchema[fields[0]].domain) || null
                : Array.isArray(limit) ? limit : null;
            if (ceiling && ceiling.length >= 2) {
                const clo = Math.min(numOf(ceiling[0]), numOf(ceiling[ceiling.length - 1]));
                const chi = Math.max(numOf(ceiling[0]), numOf(ceiling[ceiling.length - 1]));
                if (nhi - nlo >= chi - clo) { nlo = clo; nhi = chi; }
                else {
                    if (nlo < clo) { nhi += clo - nlo; nlo = clo; }
                    if (nhi > chi) { nlo -= nhi - chi; nhi = chi; }
                }
            }
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
