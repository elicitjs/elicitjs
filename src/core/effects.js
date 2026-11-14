// @ts-check
import { color as d3color } from 'd3';
// effects.js — interaction effects: transient feedback for an interaction's state
// (hovered, selected, target, grabbed), separate from style channels and guides.
// See .claude/rules/guides-effects-rendering.md.
//
// Element effects restyle the mark's own node through `node.effectStyle`, applied
// as CSS style properties so the mark's paint attributes are never overwritten.
// `outline` is an overlay node tagged `effect: true` (topmost layer) and
// `guide: true` (non-interactive). The engine's state pass decides effects;
// renderers only apply them.
//
// Every state takes the same vocabulary; `false` disables it:
//   { filter, opacity, fill, stroke, strokeWidth, cursor,
//     outline: { color, darken, width, pad, dash, opacity } }


/** The element-effect properties, applied as CSS style props by the renderer. */
export const ELEMENT_EFFECT_PROPS = ['filter', 'opacity', 'fill', 'stroke', 'strokeWidth', 'cursor'];

/** The interaction states, in the order a mark in several of them resolves. */
export const EFFECT_STATES = ['hovered', 'selected', 'target', 'grabbed'];

/** @type {any} */
export const DEFAULT_EFFECTS = {
    // Pre-press: an outline on the mark's edge in a darker shade of its own colour,
    // lighter and thinner than `selected`.
    hovered: {
        outline: { color: 'auto', darken: 0.6, width: 3, pad: 0, dash: null, opacity: 1 },
    },
    // Committed selection: the same trace, a deeper shade and thicker.
    selected: {
        outline: { color: 'auto', darken: 1.5, width: 3.5, pad: 0, dash: null, opacity: 1 },
    },
    // Where the dragged thing would land if released now (a container about to
    // take a node).
    target: {
        outline: { color: '#2563eb', width: 2.5, pad: 3, dash: null, opacity: 0.9 },
    },
    // Mid-drag. An element effect, so it survives the re-render each drag tick.
    grabbed: { filter: 'brightness(0.82)' },
};

/**
 * The catchment ring a proximity driver draws at the pointer. It is a guide
 * (customized through `edit.guide.catchment`); this is its shared default look.
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
 * Merge a user `effects` spec over the defaults, one resolved config per state.
 * `base` lets a theme supply the defaults: spec.effects > theme > built-in.
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
        // A state the theme omits falls back to the built-in look.
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
 * EFFECT_STATES order so `grabbed` beats `selected` beats `hovered`. Null when no
 * state sets an element prop.
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
 *   'auto'    the mark's own colour (default): its fill, or its stroke when the fill
 *             is missing or near-white, darkened by `darken`.
 *   'fill'    the mark's fill, darkened.      'stroke'  the mark's stroke, darkened.
 *   a colour  used as is (`darken` does not apply).
 *   a fn      `(color, node) => string`, given the darkened colour and the node.
 *             Spec-only: a theme is data.
 *
 * `darken` is d3's `color.darker(k)` amount; negative lightens. `fallback` is used
 * when no paint can be read.
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
 * An outline overlay around one scene node, in a state's appearance. A datum drawn
 * as many nodes (a waffle's cells) declares its whole shape as `node.effectShape`,
 * and the outline traces that instead.
 * @param {any} mark the scene node to outline
 * @param {any} state a resolved state config
 * @returns {import('../types').FeatureNode[]}
 */
export function outlineNodes(mark, state) {
    if (!mark || !state || state.enabled === false || !state.outline) return [];
    // Trace the declared shape instead. It has no effectShape itself, so this
    // recurses once.
    if (mark.effectShape) {
        // It reads the mark's paint, so an `auto` outline takes the datum's colour.
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
    // A stroked-only node is re-stroked wider than itself so the trace engulfs the
    // stroke; a filled shape takes the plain width on its edge.
    const strokeOnly = !readColor(mark.fill) && mark.type !== 'text';
    const ownWidth = Number(mark.strokeWidth) || 1;
    // `effect: true` pins these into the topmost paint layer (above marks and
    // guides); `guide: true` keeps them on the engine's non-interactive path.
    const paint = {
        fill: 'none', stroke: outlineColor(mark, state.outline), strokeWidth: width, opacity,
        ...(dash ? { strokeDasharray: dash } : {}),
        // Carry the mark's rotation. Every overlay below is concentric with its
        // source, so `markCenter` gives the same pivot. Keep any new shape
        // concentric, or it needs a pivot too.
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
        // A path's geometry is opaque (an arc sector, a coastline), so re-stroke the
        // same `d`.
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
 * The overlay nodes for one feature in one state: outline every node whose datum
 * index (not position) is in `indices`. A feature may emit extra nodes, so the two differ.
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
