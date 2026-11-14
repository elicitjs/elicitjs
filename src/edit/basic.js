// @ts-check
// basic.js — the universal edits, usable on any mark with the channels they govern.
// Each factory is a preset over `makeEdit` that fixes a `gesture` and an `apply`
// mapping the gesture back to data through the channel's scale.

import { makeEdit, markCenter, resolveMarkNode, invertChannel, recenterSpan, mintDatum, linearInvert, channelDomain, discreteDomain, claimPick } from './shared.js';
import { axisOf, pointerDegrees, unwrapDegrees } from '../core/encoding.js';
import { warn } from '../core/dev.js';
import { coerceToType } from '../core/schema.js';

/**
 * move — inverts the pointer on each positional channel through its scale.
 *
 * Modes:
 *   - `absolute` (default): the pointer's position is the value. Required by
 *     plane/nearest picks.
 *   - `relative`: the value moves by the drag delta from the grab, so the grab
 *     offset is kept. For marks with area. The `move` driver anchors it at
 *     dragstart, so it is always direct-pick.
 * @param {import('../types').MoveOptions} [options]
 * @returns {import('../types').Edit}
 */
export function move(options = {}) {
    const { mode = 'absolute', ...rest } = options;
    const relative = mode === 'relative';
    if (relative && rest.pick != null && rest.pick !== 'direct') {
        warn(
            'move:relative:pick',
            `move({ mode: "relative" }) is direct-pick: it measures from where you GRABBED ` +
            `the mark, so there has to be a mark under the press. { pick: "${rest.pick}" } is ` +
            `ignored. Use the default mode: "absolute" with that pick.`
        );
    }
    return makeEdit({
        type: 'move',
        inverts: true,
        gesture: 'drag',
        mode,
        ...rest,
        ...(relative ? { pick: 'direct' } : {}),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const next = { ...ctx.datum };
            const center = markCenter(resolveMarkNode(ctx));
            // Relative: re-encode the dragstart value, add the pointer's displacement
            // in pixels, and invert through the scale (so band axes still snap).
            const lock = relative ? (/** @type {any} */ (ctx.session || {}).move) : null;
            const anchor = lock && lock.anchors;
            for (const ch of ctx.channels) {
                if (relative) {
                    const a = anchor && anchor[ch.field];
                    const axis = axisOf(ch.name);
                    if (!a || !(axis || a.radial) || !ch.scale || !ch.scale.invertible) continue;
                    const from = ch.scale.encode(a.startValue);
                    if (typeof from !== 'number' || Number.isNaN(from)) continue;
                    const moved = a.radial
                        ? (center ? Math.hypot(ctx.pointer.x - center.cx, ctx.pointer.y - center.cy) : a.startPx) - a.startPx
                        : (axis === 'x' ? ctx.pointer.x : ctx.pointer.y) - a.startPx;
                    next[ch.field] = ch.scale.invertValue(from + moved);
                    continue;
                }
                const value = invertChannel(ch, ctx.pointer, center);
                if (value !== undefined) next[ch.field] = value;
            }
            return next;
        }
    });
}

/**
 * moveSpan — moves a pair of endpoint channels (x1+x2 or y1+y2) together, keeping
 * their distance. Each tick recenters the mark's current pixel span on the pointer.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function moveSpan(options = {}) {
    return makeEdit({
        type: 'moveSpan',
        inverts: true,
        gesture: 'drag',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const [chA, chB] = ctx.channels;
            const node = resolveMarkNode(ctx);
            const span = recenterSpan(node, chA, chB, ctx.pointer, ctx.datum);
            if (!span) return undefined;
            return { ...ctx.datum, [chA.field]: span.a, [chB.field]: span.b };
        }
    });
}

/**
 * brushSpan — grab near an endpoint to resize that edge, or the body to move both.
 * The `brush` driver picks the zone at dragstart and stores it in `ctx.session.zone`.
 *
 * The pair may invert mid-drag. Only at dragend does the driver call
 * `zone: 'canonicalize'` to swap them back; sorting per tick would overwrite an edge.
 * @param {import('../types').BrushSpanOptions} [options]
 * @returns {import('../types').Edit}
 */
export function brushSpan(options = {}) {
    // Only the brush driver sets the zone, so `pick` is fixed. `edgeInset` passes
    // through onto the descriptor for the driver.
    const rest = claimPick(options, 'brushSpan', 'brush');
    return makeEdit({
        type: 'brushSpan',
        inverts: true,
        gesture: 'drag',
        // With no `channels`, collectEdits supplies the mark's span pair.
        spans: true,
        ...rest,
        pick: 'brush',
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const [chA, chB] = ctx.channels;
            const datum = ctx.datum;
            if (!chA || !chB || !datum) return undefined;
            const zone = ctx.session && ctx.session.zone;
            if (!zone) return undefined; // driver sets the lock on dragstart

            if (zone === 'canonicalize') {
                const a = datum[chA.field], b = datum[chB.field];
                if (a == null || b == null || a <= b) return undefined;
                return { ...datum, [chA.field]: b, [chB.field]: a };
            }

            if (zone === 'body') {
                const node = resolveMarkNode(ctx);
                const span = recenterSpan(node, chA, chB, ctx.pointer, ctx.datum);
                if (!span) return undefined;
                return { ...datum, [chA.field]: span.a, [chB.field]: span.b };
            }

            // zone is an edge lock: the driver names which physical field it grabbed.
            const lockedField = ctx.session && ctx.session.field;
            const target = lockedField === chA.field ? chA
                : lockedField === chB.field ? chB : null;
            if (!target) return undefined;
            const value = invertChannel(target, ctx.pointer);
            if (value === undefined) return undefined;
            return { ...datum, [target.field]: value };
        }
    });
}

/**
 * brushRect — 2-D brushSpan: grab an edge to resize one side, a corner to resize
 * two, or the body to move the rect. The brushRect driver locks the zone at
 * dragstart in `ctx.session.zone` / `ctx.session.fields`.
 *
 * Options (read by the driver):
 *   resize — 'both' (default) | 'x' | 'y' | 'none'. Which axes resize.
 *   move   — true (default) | false. Whether a body drag moves the rect.
 * A disabled resize zone falls back to `body` when `move` is on.
 *
 * As with brushSpan, inverted pairs are swapped back only at dragend
 * (`zone: 'canonicalize'`).
 * @param {import('../types').BrushRectOptions} [options]
 * @returns {import('../types').Edit}
 */
export function brushRect(options = {}) {
    // `pick` is fixed to the driver. `resize`/`move` are restated so their
    // defaults land on the descriptor, where the driver reads them.
    const { resize = 'both', move = true, ...rest } = claimPick(options, 'brushRect', 'brushRect');
    return makeEdit({
        type: 'brushRect',
        inverts: true,
        gesture: 'drag',
        channels: ['x1', 'x2', 'y1', 'y2'],
        ...rest,
        resize,
        move,
        pick: 'brushRect',
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const zone = ctx.session && ctx.session.zone;
            const datum = ctx.datum;
            if (!zone || !datum) return undefined;

            // Group the resolved endpoint channels by axis into [lo, hi] pairs.
            const xPair = ctx.channels.filter((ch) => axisOf(ch.name) === 'x');
            const yPair = ctx.channels.filter((ch) => axisOf(ch.name) === 'y');
            const node = resolveMarkNode(ctx);

            if (zone === 'canonicalize') {
                const out = { ...datum };
                let changed = false;
                for (const [a, b] of [xPair, yPair]) {
                    if (!a || !b) continue;
                    const va = datum[a.field], vb = datum[b.field];
                    if (va == null || vb == null || va <= vb) continue;
                    out[a.field] = vb;
                    out[b.field] = va;
                    changed = true;
                }
                return changed ? out : undefined;
            }

            if (zone === 'body') {
                // Recenter both spans on the pointer.
                const out = { ...datum };
                let placed = false;
                for (const [a, b] of [xPair, yPair]) {
                    if (!a || !b) continue;
                    const span = recenterSpan(node, a, b, ctx.pointer, ctx.datum);
                    if (!span) continue;
                    out[a.field] = span.a;
                    out[b.field] = span.b;
                    placed = true;
                }
                return placed ? out : undefined;
            }

            // edge / corner: the driver named which field(s) the grab locked.
            const fields = (ctx.session && ctx.session.fields) || [];
            const out = { ...datum };
            let placed = false;
            for (const ch of ctx.channels) {
                if (!ch.field || !fields.includes(ch.field)) continue;
                const value = invertChannel(ch, ctx.pointer);
                if (value === undefined) continue;
                out[ch.field] = value;
                placed = true;
            }
            return placed ? out : undefined;
        }
    });
}

// Whether the value grows toward smaller pixels. Defaults: `right` on x, `up` on y.
/** @param {'x'|'y'} axis @param {string|undefined} increase */
function slideAxis(axis, increase) {
    const inc = increase || (axis === 'x' ? 'right' : 'up');
    return { axis, towardSmaller: inc === 'left' || inc === 'up' };
}

/**
 * Pixels of travel that sweep the whole domain: `extent`, else the composite
 * frame's `frameExtent`, else 120.
 * @param {number | undefined} extent @param {any} ch @returns {number}
 */
function slideExtent(extent, ch) {
    if (typeof extent === 'number' && extent > 0) return extent;
    const frame = ch && ch.scale && /** @type {any} */ (ch.scale).frameExtent;
    return typeof frame === 'number' && frame > 0 ? frame : 120;
}

/**
 * Session key for a relative slide's dragstart anchor. Keyed by axis + field so
 * several slides on one feature keep separate anchors.
 * @param {'x'|'y'} axis @param {string} field @returns {string}
 */
export const slideAnchorKey = (axis, field) => `${axis}:${field}`;

/**
 * slide — maps pointer travel along one axis linearly across the channel's domain.
 * The recommended edit for a magnitude channel like `size`. Always direct-pick.
 *
 * Modes:
 *   - `relative` (default): the value changes by the travel since the grab. The
 *     `slide` driver anchors it at dragstart.
 *   - `absolute`: the pointer's position on a track of ±`extent` px centred on
 *     the mark is the value.
 *
 * `increase` is the direction that raises the value: `'left'|'right'` on x,
 * `'up'|'down'` on y (default `'right'` / `'up'`). `extent` is the pixel span of
 * the full domain (see `slideExtent`).
 * @param {import('../types').EditOptions & { axis?: 'x'|'y', increase?: 'left'|'right'|'up'|'down', extent?: number, mode?: 'absolute'|'relative' }} [options]
 * @returns {import('../types').Edit}
 */
export function slide(options = {}) {
    const { axis = 'x', increase, extent, mode = 'relative', ...rest } = options;
    const { towardSmaller } = slideAxis(axis, increase);
    // A relative slide needs the slide driver's anchor: only `direct` or `slide`
    // picks work. Any other pick would run it twice per tick, so drop it.
    if (mode === 'relative' && rest.pick != null && rest.pick !== 'direct' && rest.pick !== 'slide') {
        warn(
            'slide:relative:pick',
            `slide({ mode: "relative" }) needs the slide driver's dragstart anchor, so it is ` +
            `served by that driver alone. { pick: "${rest.pick}" } is ignored (direct pick); ` +
            `use mode: "absolute" with that pick, or pick: "slide" for the plane form.`
        );
        delete rest.pick;
    }
    return makeEdit({
        type: 'slide',
        // Interpolates across the domain without the scale's invert, so it works
        // on a colour ramp. A string, not `true`: the dead-channel guard skips it.
        inverts: 'domain',
        gesture: 'drag',
        // The slide driver claims relative mode by capability, so the plane stays down.
        pick: 'direct',
        // makeEdit passes unknown keys through, so the driver reads these too.
        axis, increase, extent, mode,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            if (!ch || !ch.field) return undefined;
            const [loVal, hiVal] = channelDomain(ch);
            const px = axis === 'x' ? ctx.pointer.x : ctx.pointer.y;
            const span = slideExtent(extent, ch);

            if (mode === 'relative') {
                // Move proportionally from the dragstart anchor.
                const anchors = /** @type {any} */ (ctx.session || {}).slide;
                const a = anchors && anchors[slideAnchorKey(axis, ch.field)];
                if (!a || typeof a.startValue !== 'number') return undefined;
                const moved = (px - a.startPx) * (towardSmaller ? -1 : 1);
                const range = hiVal - loVal;
                const lo = Math.min(loVal, hiVal), hi = Math.max(loVal, hiVal);
                const v = Math.max(lo, Math.min(hi, a.startValue + (moved / span) * range));
                return { ...ctx.datum, [ch.field]: v };
            }

            // absolute: a track centred on the mark, oriented so `increase` grows the value.
            const c = markCenter(resolveMarkNode(ctx));
            if (!c) return undefined;
            const centre = axis === 'x' ? c.cx : c.cy;
            const pxLo = towardSmaller ? centre + span : centre - span; // value = loVal here
            const pxHi = towardSmaller ? centre - span : centre + span; // value = hiVal here
            const v = linearInvert(px, pxLo, pxHi, loVal, hiVal);
            if (v === undefined) return undefined;
            return { ...ctx.datum, [ch.field]: v };
        }
    });
}

/**
 * resize — inverts the pointer's distance from the mark centre to the channel's
 * value. The radial counterpart to `slide`, which is usually preferred.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function resize(options = {}) {
    return makeEdit({
        type: 'resize',
        inverts: true,
        gesture: 'drag',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            // resolveMarkNode, not ctx.node: a plane pick carries no node.
            const c = markCenter(resolveMarkNode(ctx));
            if (!ch || !ch.scale || !ch.scale.invertible || !c) return undefined;
            const radius = Math.hypot(ctx.pointer.x - c.cx, ctx.pointer.y - c.cy);
            return { ...ctx.datum, [ch.field]: ch.scale.invertValue(radius) };
        }
    });
}

/**
 * rotate — inverts the pointer's angle about a pivot through the channel's scale
 * (whose range is in degrees).
 *
 * Options:
 *   pivot: 'plot' (default) — plot centre; 'mark' — markCentre of the hit node
 *   fold:  true (default) — fold into (-90, 90] for direction-agnostic lines;
 *          false — full-circle degrees for gauges/dials
 *   pick:  'plane' (default) updates the whole dataset; 'direct' updates the
 *          hit datum only (needle handle); 'probe' keeps the hover/click flow
 *   relativeTo: another angular channel; the value is the absolute angle from it.
 * @param {import('../types').RotateOptions} [options]
 * @returns {import('../types').Edit}
 */
export function rotate(options = {}) {
    const { relativeTo, pivot = 'plot', fold = true, ...rest } = options;
    const pick = rest.pick || 'plane';
    const pointerAngle = (/** @type {import('../types').EditContext} */ ctx) => {
        let cx = (ctx.width || 0) / 2;
        let cy = (ctx.height || 0) / 2;
        if (pivot === 'mark') {
            const c = markCenter(resolveMarkNode(ctx));
            if (c) { cx = c.cx; cy = c.cy; }
        }
        let deg = pointerDegrees(ctx.pointer, { cx, cy });
        if (fold) {
            if (deg > 90) deg -= 180;
            else if (deg <= -90) deg += 180;
        } else {
            // Unwrap onto the channel's degree span so dragging past an end clamps
            // there instead of wrapping across ±180°.
            const scale = /** @type {any} */ (ctx.channels[0] && ctx.channels[0].scale);
            const range = scale && typeof scale.range === 'function' ? scale.range() : null;
            if (range && range.length >= 2
                && typeof range[0] === 'number' && typeof range[range.length - 1] === 'number') {
                deg = unwrapDegrees(deg, range[0], range[range.length - 1]);
            }
        }
        return deg;
    };
    return makeEdit({
        type: 'rotate',
        inverts: true,
        gesture: 'drag',
        pick: 'plane',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            const scale = ch && ch.scale;
            if (!scale || !scale.invertible) return undefined;
            const deg = pointerAngle(ctx);
            const writeOne = (/** @type {any} */ d) => {
                if (!relativeTo) {
                    return { ...d, [ch.field]: scale.invertValue(deg) };
                }
                const refSpec = ctx.markChannels[relativeTo];
                const refField = refSpec ? refSpec.field : null;
                const refScale = ctx.scales[relativeTo];
                const refDeg = refField != null && refScale?.encode ? refScale.encode(d[refField]) : 0;
                const delta = Math.abs(deg - refDeg);
                return { ...d, [ch.field]: scale.invertValue(delta) };
            };
            // Direct-pick (needle): write the hit datum only.
            if (pick === 'direct') {
                if (!ctx.datum) return undefined;
                return writeOne(ctx.datum);
            }
            if (!ctx.data.length) return undefined;
            return ctx.data.map(writeOne);
        }
    });
}

/**
 * cycle — on click, advance the channel to the next value in its domain.
 * The domain comes from `discreteDomain`, which falls back to the schema when
 * the channel has no scale.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function cycle(options = {}) {
    return makeEdit({
        type: 'cycle',
        gesture: 'click',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            if (!ch || !ctx.datum) return undefined;
            const domain = discreteDomain(ch, ctx.schema);
            if (!domain || !domain.length) return undefined;
            const i = domain.indexOf(ctx.datum[ch.field]);
            return { ...ctx.datum, [ch.field]: domain[(i + 1) % domain.length] };
        }
    });
}

// ── The creator contract ────────────────────────────────────────────────────
// Every creator is a thin wrapper over `mintDatum` (shared.js):
//   1. Pick the gesture and `pick`; set `scope: 'line'` for series grouping.
//   2. Auxiliary fields (a series key) go in `defaults`; an already-resolved
//      position goes in `seed`. Only `seed` counts as a placed position.
//   3. `const datum = mintDatum(ctx, { defaults, seed });`
//   4. `return datum ? [...ctx.data, datum] : undefined;`
// Set `cardinality: 'append'` only when the gesture mints a single row.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * create — a plane gesture that mints a new datum: the pointer is inverted through
 * each positional channel, and `defaults` fill the other fields. `gesture` is
 * 'click' (default) or 'dblclick'.
 * @param {import('../types').CreateOptions} [options]
 * @returns {import('../types').Edit}
 */
export function create(options = {}) {
    const { defaults = {}, ...rest } = options;
    return makeEdit({
        type: 'create',
        gesture: 'click',
        // resolveChannels drops any the feature doesn't encode.
        channels: ['x', 'y', 'xOffset', 'yOffset'],
        pick: 'plane',
        cardinality: 'append',
        // On the descriptor for the create guards.
        defaults,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            // undefined => no positionable channel, nothing to append.
            const datum = mintDatum(ctx, { defaults });
            return datum ? [...ctx.data, datum] : undefined;
        }
    });
}

/**
 * toggle — the pointer names a slot; a datum in that slot is removed, otherwise
 * one is minted there. A slot is the tuple of the governed channels' values.
 * `pick: 'probe'` previews the toggle on hover.
 * @param {import('../types').ToggleOptions} [options]
 * @returns {import('../types').Edit}
 */
export function toggle(options = {}) {
    const { defaults = {}, ...rest } = options;
    return makeEdit({
        type: 'toggle',
        gesture: 'click',
        channels: ['x', 'xOffset'],
        pick: 'plane',
        // Mints or drops a row per click, so there is no single active datum.
        cardinality: 'toggle',
        defaults, // exposed on the descriptor for the create guards (see create)
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const datum = mintDatum(ctx, { defaults });
            if (!datum) return undefined; // no positionable channel: no slot named

            const keys = ctx.channels.map((ch) => ch.field);
            const occupant = ctx.data.findIndex((d) => keys.every((k) => d[k] === datum[k]));
            return occupant >= 0
                ? ctx.data.filter((_, i) => i !== occupant)
                : [...ctx.data, datum];
        }
    });
}

/**
 * remove — deletes the targeted datum. `pick` is 'direct' (the clicked mark) or
 * 'nearest'. When another click edit is on the mark, split them with `when`
 * (e.g. `cycle({ when: when.noAlt })` + `remove({ when: when.alt })`).
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function remove(options = {}) {
    return makeEdit({
        type: 'remove',
        gesture: 'click',
        cardinality: 'delete',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (ctx.index == null) return undefined; // no target resolved
            return ctx.data.filter((_, i) => i !== ctx.index);
        }
    });
}

/**
 * The apply shared by `set` and `editText`: write `ctx.value` into the first
 * channel's field.
 * @param {import('../types').EditContext} ctx
 * @returns {any}
 */
function writeValue(ctx) {
    const ch = ctx.channels[0];
    if (!ch || !ch.field || ctx.value === undefined || !ctx.datum) return undefined;
    // Coerce to the field's measure; refuse a value the measure can't hold.
    const value = coerceToType(ctx.value, ctx.schema ? ctx.schema[ch.field] : undefined);
    if (value === undefined) return undefined;
    return { ...ctx.datum, [ch.field]: value };
}

/**
 * set — write the value carried on the `commit` gesture (`ctx.value`) into the
 * channel's field. External controls drive it with `el.control(name).set(value)`;
 * `el.control(name).accepts()` reads the scale's domain for valid choices.
 *
 * Placed on any channel (`fill: { field:'group', edit: set() }`) or at mark level
 * (`edits: [set({ channels:['fill'] })]`).
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function set(options = {}) {
    return makeEdit({
        type: 'set',
        gesture: 'commit',
        pick: 'direct',
        ...options,
        apply: writeValue
    });
}

/**
 * editText — write a typed string into the text channel's field. The renderer runs
 * the inline editor (double-click, Enter/blur commits, Esc cancels) and emits one
 * `commit` gesture with the value in `ctx.value`.
 *
 * Placed on the text channel (`text: { field:'label', edit: editText() }`) or at
 * mark level (`edits: [editText({ channels:['text'] })]`).
 *
 * `inline: true` opens the editor on every node of the feature carrying the edit,
 * so the typable shape is wherever the edit is placed.
 *
 * `multiline: true` uses a textarea where Enter inserts a newline
 * (Cmd/Ctrl+Enter or blur commits; Escape cancels).
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function editText(options = {}) {
    return makeEdit({
        type: 'editText',
        gesture: 'commit',
        pick: 'direct',
        channels: ['text'],
        inline: true,
        ...options,
        apply: writeValue
    });
}

/**
 * rank — reorder by dragging along a rank axis. Inverts the pointer to a slot and
 * shifts the rows in between by one place, so ranks stay unique. Returns the full
 * dataset. Place on the rank channel: `y: { field: 'rank', edit: rank() }`.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function rank(options = {}) {
    return makeEdit({
        type: 'rank',
        inverts: true,
        gesture: 'drag',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const ch = ctx.channels[0];
            if (!ch || !ctx.datum || ctx.index == null) return undefined;
            const f = ch.field;
            if (!f) return undefined;
            const nextRank = invertChannel(ch, ctx.pointer);
            if (nextRank === undefined) return undefined;
            const oldRank = ctx.datum[f];
            if (oldRank === nextRank) return undefined;
            // Shift, not swap, so the result doesn't depend on drag speed. Slot
            // order is the declared domain, else the ranks in play, sorted.
            const declared = discreteDomain(ch, ctx.schema);
            const order = declared && declared.length
                ? declared
                : [...new Set(ctx.data.map((d) => d[f]))].sort((a, b) => Number(a) - Number(b));
            const from = order.indexOf(oldRank);
            const to = order.indexOf(nextRank);
            if (from < 0 || to < 0) {
                // Unknown slots: fall back to the swap, which is always a permutation.
                return ctx.data.map((d, i) => {
                    if (i === ctx.index) return { ...d, [f]: nextRank };
                    if (d[f] === nextRank) return { ...d, [f]: oldRank };
                    return d;
                });
            }
            return ctx.data.map((d, i) => {
                if (i === ctx.index) return { ...d, [f]: nextRank };
                const k = order.indexOf(d[f]);
                if (k < 0) return d;
                if (from < to && k > from && k <= to) return { ...d, [f]: order[k - 1] };
                if (from > to && k >= to && k < from) return { ...d, [f]: order[k + 1] };
                return d;
            });
        }
    });
}

/**
 * select — click a mark to make it the selected row. Selection is engine state
 * (ui.selection), not a data column: apply() returns `{ index, exclusive, toggle }`
 * under `target: 'selection'`, so no `change` fires and nothing enters undo.
 *
 * By default a click replaces the selection and clicking the selected row clears
 * it. `toggle: false` never deselects; `exclusive: false` always adds.
 * `multi: true` adds on shift- or meta-click and replaces on a plain click.
 *
 * `edit.legend.category()` targets the selected row by default.
 * @param {import('../types').SelectEditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function select(options = {}) {
    const { exclusive = true, toggle = true, multi = false, ...rest } = options;
    return makeEdit({
        type: 'select',
        gesture: 'click',
        pick: 'direct',
        target: 'selection',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (ctx.index == null) return undefined;
            // Under `multi`, the modifier decides per click.
            const e = /** @type {any} */ (ctx.event) || {};
            const additive = multi && !!(e.shiftKey || e.metaKey);
            return { index: ctx.index, exclusive: additive ? false : exclusive, toggle };
        }
    });
}

/**
 * custom — an arbitrary apply over the full EditContext.
 * @param {(ctx: import('../types').EditContext) => any} fn
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function custom(fn, options = {}) {
    return makeEdit({
        type: 'custom',
        gesture: 'drag',
        ...options,
        apply: fn
    });
}
