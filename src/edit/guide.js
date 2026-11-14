// @ts-check
// guide.js — draws an edit's own guide (`Edit.guide`): constraint bounds on the
// edit's channel scale, the catchment ring of a proximity pick, and handle tracks.
// Rebuilt every render, so bounds track live data.
import { resolveChannels, collectEdits } from './route.js';
import { driverFor } from './drivers/index.js';
import { isBand, isDiscrete, rangeExtent } from '../core/scales.js';
import { axisOf } from '../core/encoding.js';
import { markCenter } from './shared.js';

const DEFAULT_CONSTRAINT_COLOR = '#e4572e';

/**
 * The parts a guide can draw, with their default appearance.
 *
 *   guide: true                        bounds + catchment, at these defaults
 *   guide: false                       nothing
 *   guide: { bounds: true }            only the constraint bounds
 *   guide: { catchment: { opacity: 1 } }   keep the rest, restyle the ring
 *   guide: { color: '#0ea5e9' }        one colour for every part
 *
 * `bounds`   — constraint boundaries on the edit's value channel (clamp band and
 *              limits, snap stops, maintainSum cap).
 * `catchment`— the radius of a proximity pick. Only for drivers that `select`.
 * `track`    — where a handle can travel (from its `node.dm`).
 * @type {any}
 */
const GUIDE_PARTS = {
    bounds: {
        dash: '4 4', width: 1, opacity: 0.9,
        // The shaded allowed region behind a clamp's limits, and the tick labels.
        bandOpacity: 0.07, fontSize: 10, labelOpacity: 0.95,
        // Snap stops: a short tick per stop at the plot edge.
        tickLength: 6, tickOpacity: 0.5,
    },
    catchment: { dash: '2 4', width: 1, opacity: 0.45 },
    track: { dash: '3 3', width: 2, opacity: 0.35 },
};

/** Which parts `guide: true` turns on. `track` is opt-in. */
const GUIDE_TRUE_PARTS = ['bounds', 'catchment'];

/**
 * Resolve an edit's `guide` into one config per part, or `null` for a part that is off.
 *
 * Grammar:
 *   true                         → bounds + catchment (track stays opt-in)
 *   false                        → nothing
 *   null / omit                  → for a driver with `selects: true`, catchment
 *                                  alone (proximity signifier); otherwise nothing
 *   { bounds, catchment, track, color } → per-part on/off + style
 *
 * Colour precedence: the part's own > the guide's > the theme's constraint
 * colour > the built-in default.
 * Part defaults: GUIDE_PARTS < theme.guide[part] < part override.
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @returns {{ bounds: any, catchment: any, track: any }}
 */
export function resolveGuide(edit, ctx) {
    let spec = /** @type {any} */ (edit && edit.guide);
    // Unset `guide` on a selecting driver turns on the catchment alone.
    if (spec == null) {
        const driver = driverFor(edit);
        spec = (driver && driver.selects) ? { catchment: true } : false;
    }
    if (spec === false) {
        return { bounds: null, catchment: null, track: null };
    }

    const themeGuide = ctx?.theme?.guide;
    const themeColor = ctx?.theme?.constraint?.color;
    const baseColor = (spec && typeof spec === 'object' && spec.color)
        || themeColor
        || DEFAULT_CONSTRAINT_COLOR;

    /** @param {string} part @returns {any} */
    const resolvePart = (part) => {
        /** @type {any} */
        const on = spec === true
            ? GUIDE_TRUE_PARTS.includes(part)
            : (spec && typeof spec === 'object' ? /** @type {any} */ (spec)[part] : false);
        if (!on) return null;
        const themePart = themeGuide && themeGuide[part];
        return {
            color: baseColor,
            ...GUIDE_PARTS[part],
            ...(themePart && typeof themePart === 'object' ? themePart : {}),
            ...(typeof on === 'object' ? on : {}),
        };
    };

    return {
        bounds: resolvePart('bounds'),
        catchment: resolvePart('catchment'),
        track: resolvePart('track'),
    };
}

/**
 * Collect one guide per (feature, edit) that draws one: an edit with `guide` set,
 * or a selecting driver's edit with `guide` omitted. `guide: false` draws nothing.
 * @param {any[]} features
 * @returns {import('../types').Guide[]} guides (`views: 'state'`, read-only)
 */
export function autoEditGuides(features) {
    /** @type {any[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const feature of features) {
        collectEdits(feature).forEach((edit, i) => {
            if (edit.guide === false) return;
            if (!edit.guide) {
                const driver = driverFor(edit);
                if (!(driver && driver.selects)) return;
            }
            const key = `${feature.id}:edit-${edit.type}-${i}`;
            if (seen.has(key)) return;
            seen.add(key);
            /** @type {import('../types').Guide} */
            const g = {
                views: 'state',
                build: (_rows, _scales, _w, _h, ctx) => buildEditGuide(feature, edit, ctx),
            };
            out.push(g);
        });
    }
    return out;
}

/**
 * @param {any} feature
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @returns {import('../types').FeatureNode[]}
 */
function buildEditGuide(feature, edit, ctx) {
    const { scales, width, height } = ctx;
    // Read the mark's own table and that table's constraints.
    const data = ctx.tableOf ? ctx.tableOf(feature) : ctx.data;
    const constraints = ctx.constraintsIn ? ctx.constraintsIn(feature.table) : ctx.constraints;
    const markChannels = feature.channels || {};
    const resolved = resolveChannels(edit.channels, markChannels, scales, feature);
    const primary = resolved[0];
    const parts = resolveGuide(edit, ctx);
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    // Bounds of every constraint on the primary channel's field, plus the edit's `constrain`.
    if (parts.bounds && primary && primary.scale) {
        const style = parts.bounds;
        // A bare function constraint can't be drawn.
        const invariants = /** @type {import('../types').ConstraintSpec[]} */ (
            [...(constraints || []), ...edit.constrain].filter((c) => typeof c !== 'function')
        );
        for (const constraint of invariants) {
            // Skip constraints about other fields; one naming no field applies.
            const about = constraint.field == null
                ? null
                : /** @type {string[]} */ ([]).concat(constraint.field);
            if (about && primary.field && !about.includes(primary.field)) continue;
            nodes.push(...constraintGuide(constraint, {
                feature, data, scales, width, height, primary, color: style.color, style
            }));
        }
        // 2-D clamp box when this edit governs both axes and each has a clamp.
        if (resolved.length >= 2) {
            nodes.push(...clampBoxGuide(invariants, resolved, {
                feature, data, scales, width, height, primary, color: style.color, style
            }));
        }
    }

    // The catchment ring, for any driver that declares `selects`.
    const driver = driverFor(edit);
    if (driver && driver.selects) {
        nodes.push(...catchmentGuide(feature, ctx, parts.catchment));
    }

    // Where each of this feature's handles can travel.
    if (parts.track) nodes.push(...trackGuide(feature, edit, ctx, parts.track));

    return nodes;
}

/**
 * Draw the track each of a feature's handles moves along, from the handle's
 * `node.dm` (`{ x?, y? }`, each `{ channel, field, pxAt0, pxAt1, loVal, hiVal }`,
 * the descriptor `linearInvert` uses).
 * @param {any} feature
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @param {any} style the resolved `track` guide config
 * @returns {import('../types').FeatureNode[]}
 */
function trackGuide(feature, edit, ctx, style) {
    const marks = (ctx.featureNodes && ctx.featureNodes[feature.id]) || [];
    // If the edit names channels, draw only their tracks.
    const claims = edit.channels && edit.channels.length ? edit.channels : null;
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];
    const paint = {
        stroke: style.color, strokeWidth: style.width,
        strokeDasharray: style.dash, opacity: style.opacity,
        fill: 'none', guide: true, pointerEvents: 'none',
    };
    for (const mark of marks) {
        const dm = mark && mark.dm;
        if (!dm) continue;
        // The cross-axis coordinate is the handle's current centre.
        const c = markCenter(mark);
        if (!c) continue;
        for (const axis of /** @type {const} */ (['x', 'y'])) {
            const spec = dm[axis];
            if (!spec || spec.pxAt0 == null || spec.pxAt1 == null) continue;
            if (claims && !claims.includes(spec.channel)) continue;
            nodes.push(axis === 'x'
                ? { type: 'line', x1: spec.pxAt0, x2: spec.pxAt1, y1: c.cy, y2: c.cy, ...paint }
                : { type: 'line', x1: c.cx, x2: c.cx, y1: spec.pxAt0, y2: spec.pxAt1, ...paint });
        }
    }
    return nodes;
}

/**
 * Dispatch a constraint to its boundary drawer. A constraint may carry its own
 * drawer via defineConstraint's meta.guide (takes precedence).
 * @param {import('../types').ConstraintSpec} constraint
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function constraintGuide(constraint, gctx) {
    if (typeof constraint.guide === 'function') {
        return constraint.guide(gctx) || [];
    }
    switch (constraint.type) {
        case 'clamp': return clampGuide(constraint.options || {}, gctx);
        case 'maintainSum': return maintainSumGuide(constraint.options || {}, gctx);
        case 'snap': return snapGuide(constraint.options || {}, gctx);
        // No guide for the rest: count/unique are not value bounds, and
        // ordering/monotonic/spacing are bounded by a neighbour already on screen.
        default: return [];
    }
}

// Beyond this many stops a snap grid draws no ticks.
const MAX_SNAP_TICKS = 200;

/**
 * snap -> a tick per stop along the value axis, at the plot edge. Continuous
 * value axes only.
 * @param {{ step?: number, origin?: number }} options
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function snapGuide({ step = 1, origin = 0 }, gctx) {
    const { primary, width, height, color, style } = gctx;
    const scale = primary.scale;
    if (!scale || !(step > 0) || isDiscrete(scale)) return [];

    const domain = scale.domain().map(Number);
    const lo = Math.min(...domain);
    const hi = Math.max(...domain);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
    if ((hi - lo) / step > MAX_SNAP_TICKS) return [];

    const onX = axisOf(primary.name) === 'x';
    const [rLo, rHi] = rangeExtent(scale);
    const len = style.tickLength || 6;
    const tickOpacity = style.tickOpacity ?? 0.5;
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    // Walk by index (origin + n * step) so float error doesn't accumulate.
    const firstN = Math.ceil((lo - origin) / step);
    const lastN = Math.floor((hi - origin) / step);
    for (let n = firstN; n <= lastN; n++) {
        const at = scale(origin + n * step);
        if (!Number.isFinite(at) || at < rLo - 0.5 || at > rHi + 0.5) continue;
        nodes.push(onX
            ? { type: 'line', x1: at, x2: at, y1: height, y2: height - len,
                stroke: color, strokeWidth: 1, opacity: tickOpacity,
                pointerEvents: 'none', guide: true }
            : { type: 'line', x1: 0, x2: len, y1: at, y2: at,
                stroke: color, strokeWidth: 1, opacity: tickOpacity,
                pointerEvents: 'none', guide: true });
    }
    return nodes;
}

/**
 * A value-axis boundary line spanning the perpendicular extent. On a y-edit the
 * line is horizontal (full width); on an x-edit it is vertical (full height).
 * @param {number | undefined} value
 * @param {string} label
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function boundaryLine(value, label, gctx) {
    const { primary, width, height, color, style: st } = gctx;
    if (value === undefined) return [];
    const at = primary.scale(value);
    const line = {
        stroke: color, strokeDasharray: st.dash, strokeWidth: st.width,
        opacity: st.opacity, pointerEvents: 'none', guide: true,
    };
    const text = {
        fill: color, fontSize: st.fontSize, opacity: st.labelOpacity,
        pointerEvents: 'none', guide: true,
    };
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];
    if (axisOf(primary.name) === 'x') {
        nodes.push({ type: 'line', x1: at, x2: at, y1: 0, y2: height, ...line });
        nodes.push({ type: 'text', x: at + 4, y: 12, text: label, textAnchor: 'start', ...text });
    } else {
        nodes.push({ type: 'line', x1: 0, x2: width, y1: at, y2: at, ...line });
        nodes.push({ type: 'text', x: width - 4, y: at - 4, text: label, textAnchor: 'end', ...text });
    }
    return nodes;
}

/**
 * clamp -> min/max boundary lines + a shaded allowed band, on the value axis.
 * @param {{ min?: number, max?: number }} bounds
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function clampGuide({ min, max }, gctx) {
    const { primary, width, height, color } = gctx;
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];
    const onX = axisOf(primary.name) === 'x';

    if (min !== undefined && max !== undefined) {
        const a = primary.scale(min);
        const b = primary.scale(max);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const bandOpacity = gctx.style.bandOpacity ?? 0.07;
        nodes.push(onX
            ? { type: 'rect', x: lo, y: 0, width: hi - lo, height,
                fill: color, opacity: bandOpacity, pointerEvents: 'none', guide: true }
            : { type: 'rect', x: 0, y: lo, width, height: hi - lo,
                fill: color, opacity: bandOpacity, pointerEvents: 'none', guide: true });
    }

    nodes.push(...boundaryLine(min, `min ${min}`, gctx));
    nodes.push(...boundaryLine(max, `max ${max}`, gctx));
    return nodes;
}

/**
 * 2-D clamp box when an edit governs both x and y and each has a clamp invariant.
 * @param {import('../types').Constraint[]} invariants
 * @param {import('../types').ResolvedChannel[]} resolved
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function clampBoxGuide(invariants, resolved, gctx) {
    const xCh = resolved.find((ch) => axisOf(ch.name) === 'x');
    const yCh = resolved.find((ch) => axisOf(ch.name) === 'y');
    if (!xCh || !yCh || !xCh.scale || !yCh.scale) return [];
    const specs = /** @type {import('../types').ConstraintSpec[]} */ (invariants.filter((c) => typeof c !== 'function'));
    const xClamp = specs.find((c) => c.type === 'clamp' && c.field === xCh.field);
    const yClamp = specs.find((c) => c.type === 'clamp' && c.field === yCh.field);
    if (!xClamp || !yClamp) return [];
    const xo = xClamp.options || {}, yo = yClamp.options || {};
    if (xo.min == null || xo.max == null || yo.min == null || yo.max == null) return [];
    const x0 = xCh.scale(xo.min), x1 = xCh.scale(xo.max);
    const y0 = yCh.scale(yo.min), y1 = yCh.scale(yo.max);
    const { color } = gctx;
    return [{
        type: 'rect',
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        fill: color,
        opacity: gctx.style.bandOpacity ?? 0.08,
        stroke: color,
        strokeWidth: gctx.style.width || 1,
        strokeDasharray: gctx.style.dash || '4 4',
        pointerEvents: 'none',
        guide: true
    }];
}

/**
 * maintainSum -> a cap tick over each mark at the highest value it can reach given
 * the others' total. Drawn only when the category axis is a band.
 * @param {{ total?: number }} options
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function maintainSumGuide({ total }, gctx) {
    if (typeof total !== 'number') return [];
    const { feature, data, scales, primary, color } = gctx;
    const valueName = primary.name;
    const valueAxis = axisOf(valueName) || (valueName === 'x' ? 'x' : 'y');
    const catName = valueAxis === 'y' ? 'x' : 'y';
    const valueKey = valueAxis === 'y' ? (feature.yKey || 'y') : (feature.xKey || 'x');
    const catKey = catName === 'y' ? (feature.yKey || 'y') : (feature.xKey || 'x');
    const valueScale = primary.scale;
    const catScale = scales[catName];
    if (!catScale || !isBand(catScale)) return [];

    const [dMin, dMax] = [Math.min(...valueScale.domain()), Math.max(...valueScale.domain())];
    const band = catScale.bandwidth();
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    data.forEach((/** @type {any} */ d) => {
        const sumOthers = data.reduce(
            (/** @type {number} */ s, /** @type {any} */ o) => (o[catKey] === d[catKey] ? s : s + (o[valueKey] || 0)), 0
        );
        const cap = total - sumOthers;
        if (cap < dMin || cap > dMax) return; // off-chart

        const catPos = catScale(d[catKey]);
        const at = valueScale(cap);
        const cap$ = {
            stroke: color,
            strokeDasharray: gctx.style.dash || '3 3',
            strokeWidth: (gctx.style.width || 1) * 1.5,
            opacity: gctx.style.opacity ?? 0.9,
            pointerEvents: 'none', guide: true,
        };
        nodes.push(valueAxis === 'y'
            ? { type: 'line', x1: catPos - 2, x2: catPos + band + 2, y1: at, y2: at, ...cap$ }
            : { type: 'line', x1: at, x2: at, y1: catPos - 2, y2: catPos + band + 2, ...cap$ });
    });
    return nodes;
}

/**
 * The catchment ring of a proximity pick: a circle of the pick's threshold at the
 * pointer, read from the session a selecting driver writes. Empty with no session.
 * @param {any} info the feature's driver session
 * @param {{ color?: string, dash?: string, width?: number, opacity?: number }} spec
 * @returns {import('../types').FeatureNode[]}
 */
export function catchmentRing(info, spec) {
    if (!info || info.px == null || info.py == null || info.threshold == null) return [];
    return [{
        type: 'circle', cx: info.px, cy: info.py, r: info.threshold,
        fill: 'none', stroke: spec.color, strokeDasharray: spec.dash,
        strokeWidth: spec.width, opacity: spec.opacity,
        guide: true, effect: true, pointerEvents: 'none',
    }];
}

/**
 * The catchment ring for one feature, styled by the edit's resolved `guide.catchment`.
 * @param {any} feature
 * @param {any} ctx
 * @param {any} spec the resolved catchment part, or null when it is off
 * @returns {import('../types').FeatureNode[]}
 */
function catchmentGuide(feature, ctx, spec) {
    if (!spec) return [];
    return catchmentRing(ctx.ui && ctx.ui.session && ctx.ui.session[feature.id], spec);
}

