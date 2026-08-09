// @ts-check
// shared.js — the small kit every edit factory builds on: the descriptor
// normalizer (makeEdit) plus the datum/series helpers create-style edits reuse.
// Kept separate so the universal edits (basic.js) and the line-scoped edits
// (line.js) share one implementation of these primitives.

import { visualForChannel, axisOf } from '../core/encoding.js';
import { rangeExtent } from '../core/scales.js';
import { schemaDefaults } from '../core/schema.js';
import { warn } from '../core/dev.js';

/**
 * @param {any} v
 * @returns {any[]}
 */
export const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Compose an edit's OWN structural guard with an author-supplied `when`, so both
 * must pass.
 *
 * Several edits are only meaningful on a particular kind of node — `edit.arc.edge`
 * on a boundary handle, `edit.axis.categories`' three on a tick label / remove
 * glyph, `edit.face.expression` on a handle carrying a drag track. That guard is
 * part of what the edit IS, not a default the caller is choosing.
 *
 * Those factories used to drop the caller's options entirely rather than risk a
 * `when` overwriting the guard — which also silently swallowed `stage`, `guide`,
 * `name`, `threshold` and `constrain`, so an axis edit could not be staged or
 * guided at all. Composing is what lets the options through safely.
 * @param {(ctx: any) => boolean} guard the edit's own structural precondition
 * @param {((ctx: any) => boolean) | null | undefined} userWhen
 * @returns {(ctx: any) => boolean}
 */
export const andWhen = (guard, userWhen) =>
    (ctx) => guard(ctx) && (typeof userWhen === 'function' ? !!userWhen(ctx) : true);

/**
 * Strip a `pick` an edit cannot honour, and say so.
 *
 * A few edits are inseparable from one driver: `brushSpan`/`brushRect`/`geo.brush`
 * read a zone lock that only their own driver writes, so pointing them at another
 * strategy produces an edit that silently never fires. They already forced their
 * pick — but did it by quietly dropping the option, which is the same class of
 * silent no-op the drop was protecting against.
 * @param {any} options
 * @param {string} type the edit's type, for the message
 * @param {string} pick the driver it is bound to
 * @returns {any} the options without `pick`
 */
export function claimPick(options, type, pick) {
    const { pick: given, ...rest } = options || {};
    if (given != null && given !== pick) {
        warn(
            `fixedpick:${type}`,
            `${type} is bound to the "${pick}" driver — it reads a zone lock only that ` +
            `driver writes — so { pick: "${given}" } is ignored. Drop it, or use an edit ` +
            `that supports the strategy you want (move/moveSpan take any pick).`
        );
    }
    return rest;
}

/**
 * Normalize an edit spec into the canonical Edit descriptor the engine routes to.
 *
 * Unknown keys PASS THROUGH onto the descriptor: driver-specific knobs
 * (`edgeInset`, `resize`, `move`, …) ride on the edit where their driver reads
 * them (see edgeInsetOf in pick.js). Canonical keys are normalized below and
 * always win over a raw spread value. This is the one sanctioned way a custom
 * driver (registerDriver) carries per-edit options — no post-hoc attachment.
 * @param {any} spec
 * @returns {import('../types').Edit}
 */
export function makeEdit(spec) {
    const { channel, channels, ...rest } = spec;
    return {
        ...rest,
        type: spec.type,
        // Stable handle for `el.control(name)` — the name an external controller
        // (a slider, a picker, a rotate icon) addresses this edit by. null (the
        // default) means the edit isn't externally addressable; it stays purely
        // pointer/keyboard-driven, unchanged. Naming an edit adds no dispatch path.
        name: spec.name || null,
        gesture: spec.gesture || 'drag',
        // `channel` is the single-channel spelling, folded into `channels` here so
        // EVERY factory accepts either without its own destructuring. The singular
        // wins: it's the more specific spelling, and it lets a factory default
        // (`channels: ['x']` in toggle) be overridden by a user's `channel: 'y'`.
        channels: channel ? [channel] : (channels || null),
        when: spec.when || null,
        pick: spec.pick || 'direct',
        threshold: spec.threshold != null ? spec.threshold : 0,
        // 'line' marks a mark-scoped edit (anchor/newSeries/draw/sweep) so the
        // engine can dev-warn when it's attached to a mark without series support.
        scope: spec.scope || null,
        // Path-authoring target policy: 'nearest' extends the closest line, 'new'
        // starts a fresh series. Read by the plane/draw dispatch.
        into: spec.into || null,
        constrain: asList(spec.constrain),
        guide: spec.guide || null,
        guideColor: spec.guideColor || null,
        // Multi-stage gate: an edit with a numeric stage is active only when it
        // equals the engine's current stage; null (the default) is always active.
        // A uniform descriptor filter — not a mode branch (see elicit.js activeEdits).
        stage: spec.stage != null ? spec.stage : null,
        // probe-pick only: does a click that settles this edit advance the stage?
        // Defaults to true for a staged edit (the "line, then cone" flow); set false
        // to commit repeatedly within one stage (the dot plot's create).
        advance: spec.advance !== false,
        // Write target: absent -> the dataset (a datum or array); 'domain' -> the
        // schema (edit.axis.*). Read as a capability flag by the engine's commit path.
        target: spec.target || undefined,
        // How this edit changes the dataset's SHAPE, declared so the engine can
        // resolve `activeIndex` (the datum a constraint repairs around) without
        // knowing what edit it's running:
        //   'append' -> the gesture minted a row; the active one is the last.
        //   'delete' -> the gesture dropped a row; no datum is active.
        //   null     -> the row at `index` is the active one (the common case).
        // An edit that mints AND drops (toggle), or appends many rows at once
        // (newSeries/draw), leaves this null: "the touched datum" is genuinely
        // ambiguous, and null means "resolve nothing around it".
        cardinality: spec.cardinality || null,
        apply: spec.apply
    };
}

/**
 * Claim an edit for ONE tagged handle of a multi-handle feature.
 *
 * When a feature emits several handles over one datum (an area's y1/y2 edges, a
 * trend's intercept/slope), direct-pick dispatch fans a gesture to EVERY direct
 * edit on the feature — so an unguarded drag on the lo handle also runs the hi
 * edge's edit. Each handle carries its `channel`, and this wraps an edit's `when`
 * so it only fires on its own.
 *
 * An UNTAGGED or ABSENT node passes: a mark-level edit spanning both edges still
 * sees every gesture, and a plane/probe-pick edit (which carries no node at all)
 * is not silently killed by a guard written for handles.
 * @param {any} edit
 * @param {string} name the `channel` tag this edit owns
 * @returns {any}
 */
export function claimEdge(edit, name) {
    const inner = edit.when;
    return {
        ...edit,
        when: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.node && ctx.node.channel;
            if (ch != null && ch !== name) return false;
            return inner ? inner(ctx) : true;
        }
    };
}

/**
 * A fresh series key not already present in the data — the identity of a new line.
 * Uses the smallest non-negative integer free among the existing keys, so colors
 * (an ordinal scale over the keys) stay stable as lines come and go.
 * @param {any[]} data
 * @param {string | null} seriesField
 * @returns {number}
 */
export function nextSeriesKey(data, seriesField) {
    if (!seriesField) return 0;
    const existing = new Set((data || []).map((d) => d[seriesField]));
    let n = 0;
    while (existing.has(n)) n++;
    return n;
}

/**
 * A category for a row an edit is minting — the categorical sibling of
 * `nextSeriesKey`, and the reason `edit.stack.cut` needs no keyboard.
 *
 * The schema owns the domain, and the domain says which categories COULD exist; the
 * data says which are in play. So a new segment takes the first declared category
 * nothing currently uses. Which leaves the case where they run out, and that is
 * where `FieldSchema.open` speaks:
 *
 *   closed (the default) — the domain is the whole vocabulary. Return undefined and
 *     let the caller refuse: minting a category the author didn't declare would put
 *     a value on an axis that has no room for it.
 *   open — the domain is a starting set. Mint a placeholder that collides with
 *     nothing, for the author (or the user, via edit.axis.categories) to rename.
 *     Creating and NAMING are separate acts; blocking the first on the second is
 *     what forces a gesture to become a text field.
 *
 * @param {any[]} data
 * @param {string | null | undefined} field
 * @param {any[]} domain the field's declared/resolved domain
 * @param {{ open?: boolean, label?: string }} [options] `label` is the placeholder stem
 * @returns {any} the category, or undefined when a closed domain is exhausted
 */
export function nextCategory(data, field, domain, { open = false, label = 'Category' } = {}) {
    if (!field) return undefined;
    const used = new Set((data || []).map((d) => d[field]));
    for (const c of domain || []) if (!used.has(c)) return c;
    if (!open) return undefined;
    // Number from the domain's length so the first minted name follows the declared
    // ones, and step past anything already taken (including a previous placeholder).
    let n = (domain || []).length + 1;
    while (used.has(`${label} ${n}`) || (domain || []).includes(`${label} ${n}`)) n++;
    return `${label} ${n}`;
}

// The starting values a minted datum gets from the schema. The SCHEMA owns that
// (core/schema.js), not the edit layer — but a creator reaches for it constantly
// (mintDatum below, line.js), so it stays part of the authoring kit re-exported from
// here and edit/index.js. Imported as well as re-exported: `export … from` creates no
// local binding, and this module calls it.
export { schemaDefaults };

/**
 * Mint ONE new datum — the single seed-and-invert core every creator builds on
 * (`create`, `toggle`, `anchor`, `draw`'s freehand branch, `geo.create`). Creation
 * is mark-agnostic: a datum is generated from the scales/axes, then whatever mark
 * views the dataset encodes it. This is that generation, in one place:
 *   1. `schemaDefaults(ctx.schema)` — every declared field at its default (else null,
 *      present-but-unset), so a minted row matches the elicited shape.
 *   2. `defaults` — the creator's explicit non-positional seed (group, mag, …), AND
 *      the extent an `rect`/area needs (`width`/`height`, `x2`/`y2`) so it isn't minted
 *      zero-size. These win over the schema.
 *   3. `seed` — values a creator already resolved outside the pointer inversion: geo's
 *      projected lon/lat, a line's series key. These win last and, being present, count
 *      as "placed" on their own.
 *   4. the inverted pointer, per positional channel — the exact inverse of `encode`.
 * Returns the datum, or `undefined` when nothing could be placed (no invertible
 * positional channel and no `seed`) — the "this mark can't create here" signal a
 * caller turns into a no-op (see also warnCreateOnNonMark in elicit.js).
 * @param {import('../types').EditContext} ctx
 * @param {{ defaults?: Record<string, any>, seed?: Record<string, any> }} [opts]
 * @returns {Record<string, any> | undefined}
 */
export function mintDatum(ctx, { defaults = {}, seed = {} } = {}) {
    const datum = { ...schemaDefaults(ctx.schema), ...defaults, ...seed };
    let placed = Object.keys(seed).length > 0;
    for (const ch of ctx.channels) {
        const value = invertChannel(ch, ctx.pointer);
        if (value === undefined) continue;
        datum[ch.field] = value;
        placed = true;
    }
    return placed ? datum : undefined;
}

/**
 * The scene node an edit is currently acting on, regardless of pick strategy:
 * `ctx.node` is set for a direct-pick gesture (the DOM element it landed on),
 * but a plane-pick gesture (nearest/sweep) resolves its target by datum index
 * with no node attached — so fall back to looking the current mark up in
 * `ctx.marks` by `ctx.index`, the same by-datum-index lookup guide.js's
 * `selectEffectNodes` already does for the proximity highlight.
 * @param {import('../types').EditContext} ctx
 * @returns {any | null}
 */
export function resolveMarkNode(ctx) {
    if (ctx.node) return ctx.node;
    if (ctx.index == null || !ctx.marks) return null;
    return ctx.marks.find((m) => m && m.index === ctx.index) || null;
}

/**
 * Centre of a scene node: circles / needles carry cx/cy; rects carry
 * x/y/width/height; paths may stamp cx/cy for angular edits about a pivot; a text
 * mark carries a bare x/y anchor.
 * @param {any} node
 * @returns {{ cx: number, cy: number } | null}
 */
export function markCenter(node) {
    if (!node) return null;
    if (node.cx != null && node.cy != null) return { cx: node.cx, cy: node.cy };
    if (node.x != null && node.width != null) {
        return { cx: node.x + node.width / 2, cy: node.y + (node.height || 0) / 2 };
    }
    // A line segment (tick / rule): midpoint of the two endpoints.
    if (node.x1 != null && node.y1 != null && node.x2 != null && node.y2 != null) {
        return { cx: (node.x1 + node.x2) / 2, cy: (node.y1 + node.y2) / 2 };
    }
    // A bare x/y node (text): its anchor IS its position.
    if (node.x != null && node.y != null) return { cx: node.x, cy: node.y };
    return null;
}

// One keyboard step along a continuous axis, as a fraction of its pixel range.
// Arbitrary by nature (there is no "natural" step on a continuous scale), so it's
// named rather than sprinkled: fine enough to place a value, coarse enough that
// crossing the axis doesn't take a hundred presses. A `snap` constraint quantizes
// the result on commit, which is how a stepped field gets exact stops for free.
const NUDGE_FRACTION = 0.01;
const NUDGE_FRACTION_COARSE = 0.1;

/**
 * Where the pointer would be if you nudged it one step along `scale` — the pixel a
 * keyboard press stands in for, so an arrow key drives the SAME edit a drag does
 * (the edit still just inverts a pointer through a scale; it never learns there was
 * a keyboard).
 *
 * The step has to be asked of the scale, which is why this can't live in the
 * renderer: on a discrete axis a step is "the next category" (a fixed pixel nudge
 * would do nothing at all until it happened to cross a band edge), and on a
 * continuous one it's a fraction of the range.
 * @param {any} scale the axis scale (may be null / non-invertible)
 * @param {number} at current pixel position on that axis
 * @param {-1 | 0 | 1} dir step direction in PIXEL space
 * @param {boolean} [coarse] a bigger step (Shift)
 * @returns {number} the new pixel position (unchanged when it can't step)
 */
export function nudgeTarget(scale, at, dir, coarse = false) {
    if (!scale || !dir || !scale.invertible) return at;

    if (scale.kind === 'band' || scale.kind === 'point') {
        const domain = scale.domain();
        if (domain.length < 2) return at;
        const current = scale.invertValue(at);
        const i = domain.indexOf(current);
        if (i < 0) return at;
        // A domain isn't always drawn low-to-high (a reversed range, or y's inverted
        // pixels), so ask the scale which way its categories actually run before
        // deciding which one "one step right/down" means.
        const ascends = scale.encode(domain[domain.length - 1]) > scale.encode(domain[0]);
        const next = i + (ascends ? dir : -dir);
        if (next < 0 || next >= domain.length) return at;
        return scale.encode(domain[next]);
    }

    const [lo, hi] = rangeExtent(scale);
    const step = (hi - lo) * (coarse ? NUDGE_FRACTION_COARSE : NUDGE_FRACTION);
    return Math.max(lo, Math.min(hi, at + dir * step));
}

// Compare two domain positions numerically (a Date sorts by its timestamp), so a
// linear or time domain grid can be matched/ordered the same way.
/** @param {any} p @returns {number} */
export const numOf = (p) => (p instanceof Date ? p.getTime() : p);

/**
 * Map a pixel position on a straight track [pxAt0 → pxAt1] to a value, LINEARLY
 * across the channel's domain [loVal → hiVal]. `pxAt0` is the pixel where the
 * value is `loVal`, `pxAt1` where it is `hiVal`; the position is clamped to the
 * track, so the value never runs past the domain. This is "drag along an axis =
 * a value" — the single linear pointer→value mapping the `slide` edit and the
 * face's direct-manipulation handles both build on, so the two never drift.
 *
 * Deliberately domain-linear (not `scale.invertValue`): a `slide` track is an
 * arbitrary UI segment anchored at the handle, NOT the scale's own pixel range,
 * so the scale is consulted only for the domain extremes (via `domainConfig`),
 * never as geometry. For a plain linear channel this equals the scale's own
 * inversion; for a non-positional [0,1] param (a face channel) it maps the track
 * straight onto the field's units.
 * @param {number} px current pixel position on the track
 * @param {number} pxAt0 the pixel where the value is `loVal`
 * @param {number} pxAt1 the pixel where the value is `hiVal`
 * @param {number} loVal domain value at `pxAt0`
 * @param {number} hiVal domain value at `pxAt1`
 * @returns {number | undefined} the value, or undefined for a zero-length track
 */
export function linearInvert(px, pxAt0, pxAt1, loVal, hiVal) {
    if (pxAt1 === pxAt0) return undefined;
    let t = (px - pxAt0) / (pxAt1 - pxAt0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return loVal + t * (hiVal - loVal);
}

/**
 * The domain extremes [lo, hi] of a resolved channel, read off its scale's
 * `domainConfig` (the declared field domain). Falls back to [0, 1] — the neutral
 * range a non-positional param uses — when the channel carries no domain. The
 * one place `slide` and the face read a channel's value range, so a track always
 * spans the same [lo, hi] the encoding drew from.
 * @param {import('../types').ResolvedChannel | { scale?: any } | null | undefined} ch
 * @returns {[number, number]}
 */
export function channelDomain(ch) {
    const dom = ch && ch.scale && ch.scale.domainConfig;
    if (Array.isArray(dom) && dom.length) return [dom[0], dom[dom.length - 1]];
    return [0, 1];
}

/**
 * Invert the pointer through ONE channel's scale — the single-field half of
 * `move()`, factored out so `brushSpan`'s edge-zone tick can reuse the
 * exact same computation instead of a second copy. Pass `center` for radial
 * channels (`size`, `angle`) that need a pivot.
 * @param {import('../types').ResolvedChannel} ch
 * @param {{ x: number, y: number }} pointer
 * @param {{ cx: number, cy: number } | null} [center]
 * @returns {any}
 */
export function invertChannel(ch, pointer, center = null) {
    if (!ch || !ch.scale || !ch.scale.invertible) return undefined;
    const visual = visualForChannel(ch.name, pointer, center);
    if (visual === undefined) return undefined;
    return ch.scale.invertValue(visual);
}

/**
 * Recenter a mark's CURRENT pixel span (read off its rendered node) on the
 * pointer, then invert both new endpoints back to data — the whole-span-move
 * computation `moveSpan` and `brushSpan`/`brushRect`'s body zone both use.
 * Stateless: no dragstart/delta tracking, just "the gesture sets the absolute
 * position", the same model `move()`/`invertChannel` already use for a single
 * field.
 *
 * The span's WIDTH is preserved when the pointer pushes it against the scale's
 * pixel range: the whole interval shifts as a unit rather than each endpoint
 * clamping independently (which would shrink the span to zero at the edge and
 * leave it stuck). If the span is already wider than the range, it pins to the
 * full range.
 * @param {any} node the mark's current scene node (rect: x/y/width/height)
 * @param {import('../types').ResolvedChannel} chA
 * @param {import('../types').ResolvedChannel} chB
 * @param {{ x: number, y: number }} pointer
 * @returns {{ a: any, b: any } | undefined}
 */
export function recenterSpan(node, chA, chB, pointer) {
    if (!node || !chA || !chB || !chA.scale || !chB.scale) return undefined;
    if (!chA.scale.invertible || !chB.scale.invertible) return undefined;
    const axis = axisOf(chA.name);
    if (!axis || axis !== axisOf(chB.name)) return undefined; // must share an axis

    const visual = axis === 'x' ? pointer.x : pointer.y;
    const span = axis === 'x' ? node.width : node.height;
    if (visual === undefined || span == null) return undefined;

    let p1 = visual - span / 2;
    let p2 = visual + span / 2;

    // Keep the span rigid inside the scale's pixel range. invertValue clamps each
    // endpoint on its own — without this shift, a body-drag into the wall shrinks
    // the interval (and a zero-width span can never grow again).
    const [r0, r1] = rangeExtent(chA.scale);
    const rLo = Math.min(r0, r1);
    const rHi = Math.max(r0, r1);
    const rangeSpan = rHi - rLo;
    if (span >= rangeSpan) {
        p1 = rLo;
        p2 = rHi;
    } else {
        if (p1 < rLo) { p2 += rLo - p1; p1 = rLo; }
        if (p2 > rHi) { p1 -= p2 - rHi; p2 = rHi; }
    }

    return { a: chA.scale.invertValue(p1), b: chB.scale.invertValue(p2) };
}
