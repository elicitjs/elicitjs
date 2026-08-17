// @ts-check
// guide.js — an edit self-draws its guide when declared `guide: true`. This
// retires the old `target: <featureId>` indirection: instead of a standalone
// guide reaching back into a feature to introspect its constraints, the edit —
// which already owns its channel(s) and constraints — draws them directly.
//
// Two things get drawn:
//   1. Constraint boundaries, on the edit's OWN channel scale (axis-aware), so a
//      clamp/maintainSum on a y-edit draws horizontal, on an x-edit vertical.
//   2. For `pick: 'nearest'` edits, the proximity snap ring + selected-mark
//      highlight, read from the transient `ui` selection the dispatch writes.
//
// Rebuilt every render (via the engine), so bounds track live data.
import { resolveChannels, collectEdits } from './route.js';
import { driverFor } from './drivers/index.js';
import { isBand, isDiscrete, rangeExtent } from '../core/scales.js';
import { axisOf } from '../core/encoding.js';
import { markCenter } from './shared.js';

const DEFAULT_CONSTRAINT_COLOR = '#e4572e';

/**
 * The parts a guide can draw, with their default appearance.
 *
 * A GUIDE shows a RULE — what you may do — as distinct from an EFFECT, which shows
 * interaction STATE (see core/effects.js). `guide: true` used to draw two unrelated
 * things (constraint bounds AND the proximity ring + selected-mark outline) with
 * every dash, width, opacity and offset hard-coded and only `guideColor` adjustable.
 * Naming the parts is what makes each one addressable:
 *
 *   guide: true                        bounds + catchment, at these defaults
 *   guide: false                       nothing
 *   guide: { bounds: true }            only the constraint bounds
 *   guide: { catchment: { opacity: 1 } }   keep the rest, restyle the ring
 *   guide: { color: '#0ea5e9' }        one colour for every part
 *
 * `bounds`   — the constraint boundaries on the edit's own value channel: a clamp's
 *              band and limit lines, a snap's stops, a maintainSum cap.
 * `catchment`— the reach of a proximity pick: the radius within which a free
 *              pointer resolves to a mark. Only drawn by drivers that select one.
 * `track`    — where a handle can travel. Marks that derive a handle's range
 *              (trend, arc, axis, legend) compute it already; this draws it.
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

/** Which parts `guide: true` turns on. `track` is opt-in — it is extra ink on a
 *  chart that already shows the handle, and only reads as help when the travel
 *  range isn't obvious from the mark itself. */
const GUIDE_TRUE_PARTS = ['bounds', 'catchment'];

/**
 * Resolve an edit's `guide` into one config per part, or `null` for a part that is
 * off.
 *
 * Grammar:
 *   true                         → bounds + catchment (track stays opt-in)
 *   false                        → nothing
 *   null / omit                  → for a driver with `selects: true`, catchment
 *                                  alone (proximity signifier); otherwise nothing
 *   { bounds, catchment, track, color } → per-part on/off + style
 *
 * Colour precedence: the part's own > the guide's > the edit's legacy
 * `guideColor` > the theme's constraint colour > the built-in default.
 * Part defaults: GUIDE_PARTS < theme.guide[part] < part override.
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @returns {{ bounds: any, catchment: any, track: any }}
 */
export function resolveGuide(edit, ctx) {
    let spec = /** @type {any} */ (edit && edit.guide);
    // Proximity picks that select a target need a pre-press signifier. Auto-enable
    // catchment when the author left `guide` unset; `guide: false` stays fully off,
    // and `guide: true` still means bounds + catchment (sweep's historical default).
    if (spec == null) {
        const driver = driverFor(edit);
        spec = (driver && driver.selects) ? { catchment: true } : false;
    }
    if (spec === false) {
        return { bounds: null, catchment: null, track: null };
    }

    const themeGuide = ctx && ctx.theme && ctx.theme.guide;
    const themeColor = ctx && ctx.theme && ctx.theme.constraint && ctx.theme.constraint.color;
    const baseColor = (spec && typeof spec === 'object' && spec.color)
        || (edit && edit.guideColor)
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
 * Collect the auto-guides for every feature: an edit with `guide: true` / an
 * object form self-draws via buildEditGuide. Proximity picks that `selects` also
 * register when `guide` is omitted (auto-catchment — see resolveGuide); `guide:
 * false` stays fully off. Deduped per (feature, edit).
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
export function buildEditGuide(feature, edit, ctx) {
    const { scales, width, height } = ctx;
    // A guide is drawn ABOUT a mark, so it reads that mark's own table and that
    // table's invariants — a bounds rule over node rows must not be computed from
    // link rows. On a single-table chart both resolve to what ctx.data/ctx.constraints
    // already held, so nothing changes there.
    const data = ctx.tableOf ? ctx.tableOf(feature) : ctx.data;
    const constraints = ctx.constraintsIn ? ctx.constraintsIn(feature.table) : ctx.constraints;
    const markChannels = feature.channels || {};
    const resolved = resolveChannels(edit.channels, markChannels, scales, feature);
    const primary = resolved[0];
    const parts = resolveGuide(edit, ctx);
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    // Constraint boundaries on the edit's own value channel. Constraints are DATASET
    // invariants, so an edit draws every one whose field matches its primary channel
    // — including constraints declared on a sibling mark, since they gate this edit
    // too. Plus any edit-scoped guard sugar.
    if (parts.bounds && primary && primary.scale) {
        const style = parts.bounds;
        const invariants = [...(constraints || []), ...edit.constrain];
        for (const constraint of invariants) {
            if (constraint.field && primary.field && constraint.field !== primary.field) continue;
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

    // The pick's CATCHMENT — how far a free pointer reaches to find a mark — for any
    // edit whose driver resolves a target from an arbitrary pointer position. Asked
    // of the driver registry (`selects`) rather than matched against a list of pick
    // names here — that list had drifted, covering `brush` but not its 2-D siblings
    // brushRect/geoBrush, which keep the same hover state and so drew nothing.
    //
    // The mark HIGHLIGHT that used to be drawn alongside it is gone from here: which
    // mark a pointer has resolved is interaction STATE, not a rule, so it is now the
    // `hovered` effect — and it looks the same whether the mark was found by
    // proximity or by pointing straight at it (see core/elicit.js's effects pass).
    const driver = driverFor(edit);
    if (driver && driver.selects) {
        nodes.push(...catchmentGuide(feature, edit, ctx));
    }

    // Where each of this feature's handles can travel.
    if (parts.track) nodes.push(...trackGuide(feature, edit, ctx, parts.track));

    return nodes;
}

/**
 * Draw the TRACK each of a feature's handles moves along.
 *
 * A handle declares its own travel range by stamping `node.dm` — `{ x?, y? }`, each
 * `{ channel, field, pxAt0, pxAt1, loVal, hiVal }`, the descriptor `linearInvert`
 * already uses to map a pointer back to a value. So the track is not re-derived
 * here: it IS the mapping the edit will use, drawn.
 *
 * A mark with a handle whose travel range isn't a scale opts in this way — which is
 * the point of making it a declared contract rather than a per-mark drawing. (A
 * handle whose range IS a scale needs nothing: `group`'s frame channels are real
 * scales, so a glyph part's travel is already the mapping.)
 * @param {any} feature
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @param {any} style the resolved `track` guide config
 * @returns {import('../types').FeatureNode[]}
 */
function trackGuide(feature, edit, ctx, style) {
    const marks = (ctx.featureNodes && ctx.featureNodes[feature.id]) || [];
    // When the edit names channels, draw only the tracks it can actually write —
    // otherwise a guide on one parameter would advertise every handle's range.
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
        // The track runs ALONG one axis, so the other coordinate is wherever the
        // handle currently sits. `markCenter` rather than a raw cx/cy read, so a
        // handle drawn as a line or a rect (a glyph's brow, a bar) gets a track too
        // — a bare cx/cy read put those at NaN and drew nothing.
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
 * @param {import('../types').Constraint} constraint
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function constraintGuide(constraint, gctx) {
    if (typeof constraint.guide === 'function') {
        return constraint.guide(gctx) || [];
    }
    switch (constraint.constraintType) {
        case 'clamp': return clampGuide(constraint.options, gctx);
        case 'maintainSum': return maintainSumGuide(constraint.options, gctx);
        case 'snap': return snapGuide(constraint.options, gctx);
        // No guide, by design, for the rest:
        //   count / unique  cardinality rules (how many rows / per category), not
        //                   value bounds — there's no line on a value axis to draw.
        //   ordering / monotonic / spacing
        //                   their bound is the NEIGHBOUR's current value, which is
        //                   already on screen: the other handle, or the next point.
        //                   Drawing a line on top of a mark you can see says nothing.
        // A custom constraint can still supply its own drawer via meta.guide above.
        default: return [];
    }
}

// A snap grid denser than this is unreadable as ticks — and at that point it isn't
// telling you anything a continuous axis doesn't already say.
const MAX_SNAP_TICKS = 200;

/**
 * snap -> a tick per stop along the value axis, drawn at the plot edge. Unlike a
 * clamp (two bounds) a snap has no boundary to draw; what's worth showing is WHERE
 * the value can land, so the handle appearing to lag the pointer reads as a grid
 * rather than as lost input.
 *
 * Only for a continuous value axis: a band/point scale already draws its own slots,
 * and its categories aren't `step` apart in pixels anyway.
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
    // A stop's tick sits at the plot edge, which is also where the axis spine is,
    // so the default is short and faint deliberately — raise `bounds.tickLength` /
    // `bounds.tickOpacity` to pull the stops clear of the axis.
    const len = (style && style.tickLength) || 6;
    const tickOpacity = (style && style.tickOpacity) != null ? style.tickOpacity : 0.5;
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    // Walk by index, not by accumulating `v += step` — repeated float addition
    // drifts off the stops the constraint itself computes (origin + n * step).
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
    const { primary, width, height, color, style } = gctx;
    if (value === undefined) return [];
    const at = primary.scale(value);
    // Appearance comes from the RESOLVED guide (resolveGuide), so `guide: { bounds:
    // { dash, width, opacity, fontSize } }` reaches the ink. These were literals.
    const st = style || {};
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
        const bandOpacity = (gctx.style && gctx.style.bandOpacity) != null
            ? gctx.style.bandOpacity : 0.07;
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
    const xClamp = invariants.find((c) => c.constraintType === 'clamp' && c.field === xCh.field);
    const yClamp = invariants.find((c) => c.constraintType === 'clamp' && c.field === yCh.field);
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
        opacity: (gctx.style && gctx.style.bandOpacity) != null ? gctx.style.bandOpacity : 0.08,
        stroke: color,
        strokeWidth: (gctx.style && gctx.style.width) || 1,
        strokeDasharray: (gctx.style && gctx.style.dash) || '4 4',
        pointerEvents: 'none',
        guide: true
    }];
}

/**
 * maintainSum -> a cap tick over each mark at the highest value it can reach given
 * the current total of the others. The category axis is the non-value positional
 * channel; the tick sits at that mark's slot, on the value axis.
 *
 * The per-mark cap tick only makes sense when the category axis is a BAND (bars /
 * ticks — discrete slots to sit a cap over). On two continuous axes (a line /
 * scatter) there is no slot geometry, so the guide draws nothing (the maintainSum
 * data invariant still holds; only its visualization is band-specific).
 * @param {{ targetSum: number }} options
 * @param {any} gctx
 * @returns {import('../types').FeatureNode[]}
 */
function maintainSumGuide({ targetSum }, gctx) {
    const { feature, data, scales, primary, color } = gctx;
    const valueName = primary.name;
    const valueAxis = axisOf(valueName) || (valueName === 'x' ? 'x' : 'y');
    const catName = valueAxis === 'y' ? 'x' : 'y';
    const valueKey = valueAxis === 'y' ? (feature.yKey || 'y') : (feature.xKey || 'x');
    const catKey = catName === 'y' ? (feature.yKey || 'y') : (feature.xKey || 'x');
    const valueScale = primary.scale;
    const catScale = scales[catName];
    // Band category axis only — otherwise there is no slot to draw a cap over.
    if (!catScale || !isBand(catScale)) return [];

    const [dMin, dMax] = [Math.min(...valueScale.domain()), Math.max(...valueScale.domain())];
    const band = catScale.bandwidth();
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];

    data.forEach((/** @type {any} */ d) => {
        const sumOthers = data.reduce(
            (/** @type {number} */ s, /** @type {any} */ o) => (o[catKey] === d[catKey] ? s : s + o[valueKey]), 0
        );
        const cap = targetSum - sumOthers;
        if (cap < dMin || cap > dMax) return; // off-chart

        const catPos = catScale(d[catKey]);
        const at = valueScale(cap);
        const cap$ = {
            stroke: color,
            strokeDasharray: (gctx.style && gctx.style.dash) || '3 3',
            strokeWidth: ((gctx.style && gctx.style.width) || 1) * 1.5,
            opacity: (gctx.style && gctx.style.opacity) != null ? gctx.style.opacity : 0.9,
            pointerEvents: 'none', guide: true,
        };
        nodes.push(valueAxis === 'y'
            ? { type: 'line', x1: catPos - 2, x2: catPos + band + 2, y1: at, y2: at, ...cap$ }
            : { type: 'line', x1: at, x2: at, y1: catPos - 2, y2: catPos + band + 2, ...cap$ });
    });
    return nodes;
}

/**
 * The `select` interaction effect: a snap ring at the pointer + a highlight
 * outline around the selected mark, read from the transient nearest-selection
 * state the drivers write into ui.session. Appearance comes from the customizable
 * appearance comes from the edit's own `guide.catchment`.
 * @param {any} feature
 * @param {import('../types').Edit} edit
 * @param {any} ctx
 * @returns {import('../types').FeatureNode[]}
 */
function catchmentGuide(feature, edit, ctx) {
    const info = ctx.ui && ctx.ui.session && ctx.ui.session[feature.id];
    if (!info || info.px == null || info.py == null || info.threshold == null) return [];
    const spec = resolveGuide(edit, ctx).catchment;
    if (!spec) return [];
    return [{
        type: 'circle', cx: info.px, cy: info.py, r: info.threshold,
        fill: 'none', stroke: spec.color, strokeDasharray: spec.dash,
        strokeWidth: spec.width, opacity: spec.opacity,
        guide: true, effect: true, pointerEvents: 'none',
    }];
}

