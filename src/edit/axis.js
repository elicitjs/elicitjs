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
//   edit.axis.categories()  categorical/ordinal — add / rename / remove categories
//
// Both are namespaced under `edit.axis.*` so the scope shows in the name, mirroring
// `edit.line.*`. The axis mark wires them (plot/axis.js): it forwards the edit and,
// per the scale's kind, emits the handle / label / add / remove affordance nodes.

import { makeEdit, numOf } from './shared.js';
import { warn } from '../core/dev.js';
import { categories as scaleCategories } from './scale.js';

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
 * @param {{ field?: string, mode?: 'rescale' | 'grow' }} [options]
 * @returns {import('../types').Edit}
 */
export function scale(options = {}) {
    const { field, mode = 'rescale', ...rest } = options;
    const MIN_PX = 6; // guard: never divide by a near-zero anchor→pointer distance
    return makeEdit({
        type: 'axisScale',
        gesture: 'drag',
        pick: 'axisDrag',
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
 * @deprecated Use `edit.scale.categories()`. Reshaping a category list is a
 * property of the SCALE, not of the chrome that draws it, so the same gesture now
 * works on a legend as well as an axis (`scope: 'scale'`). This wrapper keeps the
 * old spelling working and says so once, the way `edit.arc.edge` does.
 * @param {any} [options]
 * @returns {import('../types').Edit[]}
 */
export function categories(options = {}) {
    warn(
        'edit:axis:categories',
        'edit.axis.categories() is deprecated — use edit.scale.categories(). It is the ' +
        'same edit: a category list belongs to the SCALE, so it now works on any element ' +
        'that draws one (an axis or a legend), not just an axis.'
    );
    return scaleCategories(options);
}
