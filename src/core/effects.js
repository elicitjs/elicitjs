// @ts-check
import { color as d3color } from 'd3';
// effects.js — the interaction-EFFECTS layer: transient visual feedback for the
// STATE of an interaction, kept deliberately separate from a mark's STYLE channels
// (fill/stroke/opacity/…) and from its GUIDES.
//
// ── The three-way split ─────────────────────────────────────────────────────
// A chart says three different kinds of thing visually, and each has its own home:
//
//   STYLE    what the data IS.        channels — fill, stroke, size, opacity.
//   GUIDE    what the RULE is.        edit.guide — a clamp's bounds, a snap's
//                                     stops, a pick's catchment, a handle's track.
//                                     Persistent; describes what you MAY do.
//   EFFECT   what is HAPPENING now.   this file — hovered, selected, grabbed.
//                                     Transient; describes interaction state.
//
// The split was blurred before: `guide: true` on an edit drew constraint bounds
// (a rule) AND the proximity ring + selected-mark outline (a state), while
// `effects` separately owned `grab` and a `select` that overlapped the second half.
// So the same feedback had two owners, "guide" meant two things, and only its
// colour could be changed. Now a guide draws rules and an effect draws state.
//
// ── The states ──────────────────────────────────────────────────────────────
//   hovered   the pointer is over this mark, or a proximity driver has resolved it
//             as the one a gesture would take. Both routes feed this ONE state, so
//             "this is the mark you are about to touch" reads identically whether
//             it was found by pointing or by nearness.
//   selected  the mark is in the chart's selection (edit.select / el.select).
//   grabbed   a drag on this mark is in flight.
//
// ── How an effect is allowed to paint ───────────────────────────────────────
// Two mechanisms, and the constraint behind both is that an effect must NEVER
// destroy data-driven style:
//
//   element effects — the mark's OWN node, restyled: the engine stamps the state's
//                     filter/opacity/fill/stroke/strokeWidth/cursor onto the node as
//                     `node.effectStyle`, and the renderer applies them as CSS style
//                     PROPERTIES (SVG) or as a paint override (canvas). A CSS
//                     property beats an SVG presentation attribute, so the effect
//                     wins while it is set and the mark's real paint reappears the
//                     moment it is removed. The renderer writes `_applyStyle` to
//                     ATTRIBUTES, so the two never collide and a mid-drag
//                     re-render can't wipe the effect. (The original bug this
//                     rule comes from: a grab highlight that set the `stroke`
//                     attribute erased whatever stroke the mark's data had given
//                     it, permanently.)
//   overlay effects — extra scene nodes tagged `effect: true` (and `guide: true`
//                     so they stay non-interactive) that the renderer paints in
//                     the topmost layer. Without the `effect` pin an outline would
//                     land in the behind-marks guide layer and draw UNDER the mark
//                     it outlines.
//
// Why `outline` alone is an overlay: it is the one part of the vocabulary that needs
// geometry the mark does not have — padding OUTSIDE the shape. Everything else has to
// be the node itself, because a copy drawn on top cannot express half the vocabulary:
// you cannot DIM a mark by drawing over it (`opacity`, `filter: brightness()`), and a
// copied `fill` over a semi-transparent mark composites to the wrong colour. Restyling
// the node is also aligned by construction — it IS the node, so it carries the node's
// `angle` transform for free. An overlay has to be told (see `outlineNodes`).
//
// Every state accepts the same vocabulary, so there is one thing to learn:
//   { filter, opacity, fill, stroke, strokeWidth, cursor,
//     outline: { color, width, pad, dash, opacity } }
// `false` for a state disables it.
//
// ── One decider ─────────────────────────────────────────────────────────────
// The ENGINE's state pass owns both halves. It was split before: outlines came from
// the state pass, while the element half was applied by the D3 renderer straight off
// its own `pointerenter`/`d3.drag` — so `hovered: { fill }` painted only under SVG
// direct pick (never on a proximity driver's hover, never on canvas), `selected:
// { fill }` did nothing at all, and `grabbed` read `filter` and ignored the other
// five. The renderer is now a dumb applier of `node.effectStyle`, which is what makes
// the two hover sources paint identically the way this file always claimed.


/** The element-effect properties, applied as CSS style props by the renderer. */
export const ELEMENT_EFFECT_PROPS = ['filter', 'opacity', 'fill', 'stroke', 'strokeWidth', 'cursor'];

/** The interaction states, in the order a mark in several of them resolves. */
export const EFFECT_STATES = ['hovered', 'selected', 'target', 'grabbed'];

/** @type {any} */
export const DEFAULT_EFFECTS = {
    // Pre-press: an outline traced ON the mark's edge (pad 0), in a darker shade of
    // the mark's own colour (`color: 'auto'`), so a teal bar lights up in deep teal
    // and a coral dot in deep coral rather than every mark in one signal orange.
    // Deliberately lighter than `selected` — hover is a question, selection is an
    // answer — so it is a shallower shade and a hair thinner.
    hovered: {
        outline: { color: 'auto', darken: 0.6, width: 3, pad: 0, dash: null, opacity: 1 },
    },
    // Committed selection: the same trace, a deeper shade and thicker.
    selected: {
        outline: { color: 'auto', darken: 1.5, width: 3.5, pad: 0, dash: null, opacity: 1 },
    },
    // Where the thing in flight would LAND if released now — a container about to
    // take the node being dragged into it. Distinct from hover (which mark a press
    // would take) and from selection, so it has its own colour.
    target: {
        outline: { color: '#2563eb', width: 2.5, pad: 3, dash: null, opacity: 0.9 },
    },
    // Mid-drag. An element effect, so it survives the re-render each drag tick
    // triggers without being re-derived from scene state.
    grabbed: { filter: 'brightness(0.82)' },
};

/**
 * The catchment ring a proximity driver draws at the pointer. It is a GUIDE, not an
 * effect — it shows the pick's reach (a rule about what a gesture will grab), not
 * the state of any mark — so it lives with the other guide defaults and is
 * customized through `edit.guide.catchment`. Kept here only as the shared default
 * appearance, next to the state it accompanies.
 * @type {any}
 */
export const DEFAULT_CATCHMENT = { color: '#ff9800', dash: '2 4', width: 1, opacity: 0.45 };

/**
 * Normalize one state's appearance. `false` disables it; a bare string is a filter
 * (the `grabbed: 'brightness(1.1)'` shorthand); an object merges over the default,
 * with `outline` merged one level deeper so `{ outline: { color } }` keeps the
 * default geometry.
 * @param {any} user
 * @param {any} base
 * @returns {any}
 */
function resolveState(user, base) {
    const d = base || {};
    if (user === false) return { enabled: false };
    if (typeof user === 'string') return { ...d, enabled: true, filter: user };
    const u = user || {};
    const outline = u.outline === false
        ? null
        : (d.outline || u.outline) ? { ...d.outline, ...(u.outline || {}) } : null;
    return { ...d, ...u, outline, enabled: true };
}

/**
 * Merge a user `effects` spec over the defaults, returning one resolved config per
 * interaction state.
 *
 * `base` lets a theme supply the defaults (theme.effects) that a chart's own
 * `effects` spec then layers over — so precedence is spec.effects > theme > built-in.
 * @param {any} [user]
 * @param {any} [base]
 * @returns {any}
 */
export function resolveEffects(user = {}, base = DEFAULT_EFFECTS) {
    const spec = user || {};
    const d = base || DEFAULT_EFFECTS;
    /** @type {any} */
    const out = {};
    for (const state of EFFECT_STATES) {
        // A theme written before a state existed states nothing for it; the
        // built-in look stands in, or a new state would be invisible under a theme.
        out[state] = resolveState(spec[state], d[state] || DEFAULT_EFFECTS[state]);
    }
    return out;
}

/**
 * The element-effect CSS properties for a state, or null when it sets none. The
 * renderer applies these as style properties and removes them on state exit.
 * @param {any} state a resolved state config
 * @returns {Record<string, any> | null}
 */
export function elementEffectOf(state) {
    if (!state || state.enabled === false) return null;
    /** @type {Record<string, any>} */
    const props = {};
    let any = false;
    for (const key of ELEMENT_EFFECT_PROPS) {
        if (state[key] == null) continue;
        props[key] = state[key];
        any = true;
    }
    return any ? props : null;
}

/**
 * The element-effect props for a node in several states at once, merged in
 * EFFECT_STATES order so `grabbed` beats `selected` beats `hovered` — the more
 * committed the interaction, the more it gets to say. Returns null when none of the
 * states sets an element prop, so a caller can skip stamping anything.
 * @param {any[]} states resolved state configs the node is currently in
 * @returns {Record<string, any> | null}
 */
export function effectStyleFor(states) {
    /** @type {Record<string, any>} */
    const out = {};
    let any = false;
    for (const state of states || []) {
        const props = elementEffectOf(state);
        if (!props) continue;
        Object.assign(out, props);
        any = true;
    }
    return any ? out : null;
}

/** The outline colour used when nothing on the mark can be read (a gradient fill, a
 *  CSS variable, no paint at all). A neutral slate, legible on any data colour. */
export const OUTLINE_FALLBACK = '#475569';

/** A parsed, visible colour, or null for none / transparent / unparseable paint
 *  (`url(#gradient)`, `var(--x)`, `currentColor`).
 * @param {any} paint */
function readColor(paint) {
    if (typeof paint !== 'string' || paint === 'none' || paint === 'transparent') return null;
    const c = d3color(paint);
    return c && (c.opacity == null || c.opacity > 0) ? c : null;
}

/** Is this colour so pale that a ring in it (or a shade of it) would not read as the
 *  mark? A white-filled hollow dot should take its stroke, not its fill.
 * @param {any} c a d3 colour */
function isPale(c) {
    const { r, g, b } = c.rgb();
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.93;
}

/**
 * The colour an outline paints a node in.
 *
 *   'auto'    the mark's own colour: its fill, or its stroke when the fill is missing
 *             or near-white (a hollow dot, a line, a tick) — then darkened by
 *             `darken`. This is the default, so the highlight belongs to the mark.
 *   'fill'    the mark's fill, darkened.      'stroke'  the mark's stroke, darkened.
 *   a colour  used as is (`darken` does not apply): the fixed look.
 *   a fn      `(color, node) => string`, given the darkened mark colour (or the
 *             fallback) and the node, for any other rule. Spec-only — a theme is data.
 *
 * `darken` is d3's `color.darker(k)` amount; a negative value lightens instead (for
 * dark marks on a dark surface). `fallback` is used when no paint can be read.
 * @param {any} node the scene node being outlined
 * @param {any} outline the resolved outline config
 * @returns {string}
 */
export function outlineColor(node, outline) {
    const { color = 'auto', darken = 0.6, fallback = OUTLINE_FALLBACK } = outline || {};
    if (typeof color === 'string' && !['auto', 'fill', 'stroke'].includes(color)) return color;
    const fill = readColor(node && node.fill);
    const stroke = readColor(node && node.stroke);
    let base = null;
    if (color === 'fill') base = fill;
    else if (color === 'stroke') base = stroke;
    else base = fill && !(isPale(fill) && stroke) ? fill : (stroke || fill);
    const shaded = base
        ? (darken >= 0 ? base.darker(darken) : base.brighter(-darken)).formatHex()
        : fallback;
    return typeof color === 'function' ? color(shaded, node) : shaded;
}

/**
 * An outline overlay around one scene node, in a state's appearance.
 *
 * Handles every node type a mark can emit. `circle`/`rect`/`line` were the only
 * three before, so outlining a `path` (an arc slice, a geo polygon, a needle), an
 * `ellipse` (a face's eye, a 2-D uncertainty blob) or a `text` label produced nothing
 * at all — the mark simply didn't respond, which reads as a broken interaction rather
 * than an unimplemented one.
 *
 * A datum drawn as MANY nodes (a waffle's grid of cells) states the shape of the
 * WHOLE datum as `node.effectShape`, and the outline traces that instead of the one
 * node it happened to be handed — see the FeatureNode field for why the mark, not
 * this file, is the one that knows it.
 * @param {any} mark the scene node to outline
 * @param {any} state a resolved state config
 * @returns {import('../types').FeatureNode[]}
 */
export function outlineNodes(mark, state) {
    if (!mark || !state || state.enabled === false || !state.outline) return [];
    // The declared shape is an ordinary geometry node, so it goes through the very
    // same cases below (and carries the mark's rotation with it). It never declares
    // one of its own, so this recurses exactly once.
    if (mark.effectShape) {
        // The declared shape carries no paint of its own; it reads the mark's, so an
        // `auto` outline still takes the colour of the datum it rings.
        return outlineNodes(
            {
                fill: mark.fill, stroke: mark.stroke,
                ...mark.effectShape, ...(mark.angle ? { angle: mark.angle } : {}),
            },
            state,
        );
    }
    const { width, dash, opacity } = state.outline;
    const pad = state.outline.pad || 0;
    // A stroked-only node (a line, a tick, an unfilled path) is outlined by
    // re-stroking it WIDER than itself, so the trace engulfs the stroke rather than
    // running down its middle; a filled shape takes the plain width on its edge.
    const strokeOnly = !readColor(mark.fill) && mark.type !== 'text';
    const ownWidth = Number(mark.strokeWidth) || 1;
    // `effect: true` pins these into the topmost paint layer (above marks and
    // guides); `guide: true` keeps them on the engine's non-interactive path.
    const paint = {
        fill: 'none', stroke: outlineColor(mark, state.outline), strokeWidth: width, opacity,
        ...(dash ? { strokeDasharray: dash } : {}),
        // Carry the mark's rotation. Both renderers rotate a node by -angle about
        // `markCenter`, and every overlay below is CONCENTRIC with its source — a
        // padded box keeps the box's centre, a line's bbox centre IS the segment
        // midpoint, a text ring sits on the anchor, which is its own pivot — so
        // markCenter resolves the same point for both and the outline turns in
        // lockstep. Without this an outline stayed axis-aligned at the mark's
        // unrotated position, which read as the effect tracking the wrong mark.
        // Keep any new shape concentric with its source, or it needs a pivot too.
        ...(mark.angle ? { angle: mark.angle } : {}),
        // An outline about chrome (an axis handle) escapes the mark clip with it.
        ...(mark.unclipped ? { unclipped: true } : {}),
        guide: true, effect: true, pointerEvents: 'none',
    };

    if (mark.type === 'circle') {
        return [{ type: 'circle', cx: mark.cx, cy: mark.cy, r: (mark.r || 5) + pad, ...paint }];
    }
    if (mark.type === 'ellipse') {
        // Pad each radius in its own units, so a thin squinting eye gets a thin
        // outline rather than being swallowed by a circular one.
        return [{
            type: 'ellipse', cx: mark.cx, cy: mark.cy,
            rx: (mark.rx != null ? mark.rx : 5) + pad,
            ry: (mark.ry != null ? mark.ry : 5) + pad, ...paint,
        }];
    }
    if (mark.type === 'rect') {
        // Keep the mark's corner radius (grown by the pad), so a rounded bar is traced
        // with rounded corners rather than boxed.
        const rx = mark.rx != null ? mark.rx + pad : null;
        const ry = mark.ry != null ? mark.ry + pad : rx;
        return [{
            type: 'rect', x: mark.x - pad, y: mark.y - pad,
            width: mark.width + pad * 2, height: mark.height + pad * 2,
            ...(rx != null ? { rx, ry } : {}), ...paint,
        }];
    }
    if (mark.type === 'line') {
        // On the shape (no pad): re-stroke the segment itself, wider than the mark,
        // so a diagonal line is traced along its length rather than boxed.
        if (!pad) {
            return [{
                type: 'line', x1: mark.x1, y1: mark.y1, x2: mark.x2, y2: mark.y2,
                ...paint, strokeWidth: ownWidth + width, strokeLinecap: 'round',
            }];
        }
        // Padded: outline its span (a thin padded box around the segment), so a
        // selected tick reads the same as a highlighted bar.
        const lx = Math.min(mark.x1, mark.x2);
        const ly = Math.min(mark.y1, mark.y2);
        return [{
            type: 'rect', x: lx - pad, y: ly - pad,
            width: Math.abs(mark.x2 - mark.x1) + pad * 2,
            height: Math.abs(mark.y2 - mark.y1) + pad * 2, ...paint,
        }];
    }
    if (mark.type === 'path') {
        // A path's geometry is opaque (it may be an arc sector or a coastline), so
        // re-stroke the SAME `d` rather than inventing a box around it: the outline
        // then traces the actual shape, which is the only reading that makes sense
        // for a slice or a polygon.
        return mark.d
            ? [{ type: 'path', d: mark.d, ...paint, ...(strokeOnly ? { strokeWidth: ownWidth + width, strokeLinecap: 'round' } : {}) }]
            : [];
    }
    if (mark.type === 'text') {
        // No measured text metrics here, so outline a ring at the label's anchor —
        // enough to say "this one", without pretending to know the glyph box.
        const r = (mark.fontSize || 12) * 0.9 + pad;
        return [{ type: 'circle', cx: mark.x, cy: mark.y, r, ...paint }];
    }
    return [];
}

/**
 * The overlay nodes for one feature in one state: outline every node whose DATUM
 * index is in `indices`.
 *
 * Indices are datum indices, not positions — a feature may emit extra nodes (a
 * line's connecting path, a face's chrome) that offset a handle from its row.
 * @param {any[]} marks the feature's current scene nodes
 * @param {Iterable<number>} indices datum indices in this state
 * @param {any} state a resolved state config
 * @returns {import('../types').FeatureNode[]}
 */
export function stateEffectNodes(marks, indices, state) {
    if (!state || state.enabled === false || !state.outline) return [];
    /** @type {import('../types').FeatureNode[]} */
    const out = [];
    for (const index of indices) {
        if (index == null) continue;
        const mark = (marks || []).find((m) => m && m.index === index) || (marks || [])[index];
        if (!mark || mark.ghost) continue;
        out.push(...outlineNodes(mark, state));
    }
    return out;
}
