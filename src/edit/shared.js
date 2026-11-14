// @ts-check
// shared.js — the kit every edit factory builds on: the descriptor normalizer
// (makeEdit) plus datum, series and inversion helpers.

import { visualForChannel, axisOf } from '../core/encoding.js';
import { rangeExtent } from '../core/scales.js';
import { schemaDefaults } from '../core/schema.js';
import { warn } from '../core/dev.js';
import { EDIT_UNIVERSAL_OPTIONS, EDIT_OPTIONS } from '../vocabulary.js';

/**
 * Option keys the edit's vocabulary doesn't know, stamped on the descriptor so
 * `warnUnknownEditOptions` can check them against the driver's `options`.
 * A symbol so it survives spread but not JSON.stringify.
 */
export const UNVERIFIED = Symbol('elicit.unverifiedOptions');

/**
 * @param {any} v
 * @returns {any[]}
 */
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Combine an edit's own structural guard with an author-supplied `when`; both
 * must pass. Lets an edit that only works on certain nodes (e.g. `edit.stack.edge`
 * on a boundary handle) still accept the caller's options.
 * @param {(ctx: any) => boolean} guard the edit's own structural precondition
 * @param {((ctx: any) => boolean) | null | undefined} userWhen
 * @returns {(ctx: any) => boolean}
 */
export const andWhen = (guard, userWhen) =>
    (ctx) => guard(ctx) && (typeof userWhen === 'function' ? !!userWhen(ctx) : true);

/**
 * Strip a `pick` an edit bound to one driver cannot honour, and warn.
 * Used by edits that read a zone lock only their driver writes
 * (`brushSpan`, `brushRect`, `geo.brush`).
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
 * Unknown keys pass through onto the descriptor, which is how a driver reads its
 * per-edit options (`edgeInset`, `resize`, …). Canonical keys always win over a
 * raw spread value.
 * @param {any} spec
 * @returns {import('../types').Edit}
 */
export function makeEdit(spec) {
    const { channel, channels, ...rest } = spec;
    // Keys the vocabulary does not know. A type with no entry is not checked.
    const allow = EDIT_OPTIONS[spec.type];
    const unverified = allow
        ? Object.keys(rest).filter((k) => !EDIT_UNIVERSAL_OPTIONS.includes(k) && !allow.includes(k))
        : [];
    return {
        ...rest,
        ...(unverified.length ? { [UNVERIFIED]: unverified } : {}),
        type: spec.type,
        // Handle for `el.control(name)`; null means not externally addressable.
        name: spec.name || null,
        gesture: spec.gesture || 'drag',
        // The singular `channel` wins, so it overrides a factory's `channels` default.
        channels: channel ? [channel] : (channels || null),
        when: spec.when || null,
        pick: spec.pick || 'direct',
        threshold: spec.threshold != null ? spec.threshold : 0,
        // Required mark capability (e.g. 'line'), checked by warnScopeMismatch.
        scope: spec.scope || null,
        // Path-authoring target: 'nearest' extends the closest line, 'new' starts one.
        into: spec.into || null,
        constrain: asList(spec.constrain),
        guide: spec.guide || null,
        // Active only when equal to the engine's current stage; null is always active.
        stage: spec.stage != null ? spec.stage : null,
        // probe-pick only: whether a settling click advances the stage.
        advance: spec.advance !== false,
        // Write target: absent -> the dataset; 'domain' -> the schema; 'selection'.
        target: spec.target || undefined,
        // How the edit changes the dataset's shape, so the engine can resolve the
        // row a constraint repairs around:
        //   'append' -> minted one row; the active row is the last.
        //   'delete' -> dropped a row; no active row.
        //   'appendMany' / 'toggle' -> no single active row.
        //   null     -> the row at `index` is active.
        cardinality: spec.cardinality || null,
        // Whether the edit inverts a pointer through the scale (checked by the
        // dead-drag guard). 'domain' stays a string: slide never inverts a pixel.
        inverts: spec.inverts === 'domain' ? 'domain' : !!spec.inverts,
        // Moves a positional domain as a window (zoom, pan); turns on clipping.
        viewport: !!spec.viewport,
        apply: spec.apply
    };
}

/**
 * Restrict an edit to one tagged handle of a multi-handle feature (an area's
 * y1/y2 edges), by wrapping its `when` to match the node's `channel` tag.
 * An untagged or absent node passes, so plane/probe picks still fire.
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
 * A series key not already in the data, for a new line.
 *
 * With a declared domain, the first unused category (`nextCategory`, honouring
 * `open`); a closed, exhausted domain returns undefined and warns. Without one,
 * the smallest unused non-negative integer.
 * @param {any[]} data
 * @param {string | null} seriesField
 * @param {Record<string, any> | null} [schema] the table's field schema
 * @returns {any} the key, or undefined when a closed domain is exhausted
 */
export function nextSeriesKey(data, seriesField, schema) {
    if (!seriesField) return 0;
    const fs = schema && schema[seriesField];
    if (fs && Array.isArray(fs.domain) && fs.domain.length) {
        const key = nextCategory(data, seriesField, fs.domain, { open: !!fs.open, label: seriesField });
        if (key === undefined) {
            warn(
                `series:exhausted:${seriesField}`,
                `every declared category of "${seriesField}" already has a line, and the domain is ` +
                `closed, so no new series can be started. Declare more categories, or ` +
                `\`open: true\` on the field.`
            );
        }
        return key;
    }
    const existing = new Set((data || []).map((d) => seriesKeyOf(d[seriesField])));
    let n = 0;
    while (existing.has(n)) n++;
    return n;
}

/**
 * The series of the last row that is not locked, which a freehand stroke may
 * continue. Undefined when every row is locked, so the caller mints a new key.
 * @param {any[]} data
 * @param {string | null} seriesField
 * @param {((row: any, i: number) => boolean) | null | undefined} locked
 * @returns {any}
 */
export function lastFreeSeries(data, seriesField, locked) {
    for (let i = (data || []).length - 1; i >= 0; i--) {
        if (locked && locked(data[i], i)) continue;
        return seriesField ? data[i][seriesField] : 0;
    }
    return undefined;
}

/**
 * A series value as a grouping key: a Date groups by its time.
 * @param {any} v
 * @returns {any}
 */
export function seriesKeyOf(v) {
    return v instanceof Date ? v.getTime() : v;
}

/**
 * A category for a row an edit is minting: the first declared category no row uses.
 * When they run out:
 *   closed (default) — return undefined so the caller refuses.
 *   open — mint a placeholder name that collides with nothing, to rename later.
 *
 * @param {any[]} data
 * @param {string | null | undefined} field
 * @param {any[]} domain the field's declared/resolved domain
 * @param {{ open?: boolean, label?: string | ((n: number) => string) }} [options]
 *   `label` is the placeholder stem, or a function of the placeholder's number
 * @returns {any} the category, or undefined when a closed domain is exhausted
 */
export function nextCategory(data, field, domain, { open = false, label = 'Category' } = {}) {
    if (!field) return undefined;
    const used = new Set((data || []).map((d) => d[field]));
    for (const c of domain || []) if (!used.has(c)) return c;
    if (!open) return undefined;
    /** @param {number} n */
    const name = (n) => (typeof label === 'function' ? label(n) : `${label} ${n}`);
    // Number after the declared ones, skipping names already taken.
    let n = (domain || []).length + 1;
    while (used.has(name(n)) || (domain || []).includes(name(n))) n++;
    return name(n);
}

// Re-exported for creators. Imported too, since `export … from` creates no local binding.
export { schemaDefaults };

/**
 * Mint one new datum, the core every creator builds on. Layers, later wins:
 *   1. `schemaDefaults(ctx.schema)` — every declared field at its default.
 *   2. `defaults` — the creator's non-positional seed and any extent a rect needs.
 *   3. `seed` — values already resolved (geo lon/lat, a series key). Counts as placed.
 *   4. the inverted pointer, per positional channel.
 *   5. the identity key, when the table declares one (`nextCategory` placeholder).
 * Returns undefined when nothing could be placed, or when a closed key vocabulary
 * is exhausted.
 * @param {import('../types').EditContext} ctx
 * @param {{ defaults?: Record<string, any>, seed?: Record<string, any>, label?: string }} [opts]
 * @returns {Record<string, any> | undefined}
 */
export function mintDatum(ctx, { defaults = {}, seed = {}, label } = {}) {
    const datum = { ...schemaDefaults(ctx.schema), ...defaults, ...seed };
    let placed = Object.keys(seed).length > 0;
    for (const ch of ctx.channels) {
        const value = invertChannel(ch, ctx.pointer);
        if (value === undefined) continue;
        datum[ch.field] = value;
        placed = true;
    }
    if (!placed) return undefined;

    const key = keyFieldOf(ctx.schema);
    if (key && datum[key] == null) {
        const spec = /** @type {import('../types').FieldSchema} */ ((ctx.schema && ctx.schema[key]) || {});
        const id = nextCategory(ctx.data, key, spec.domain || [], {
            // A key is open unless it says `open: false`.
            open: spec.open !== false,
            label: label || 'Item',
        });
        if (id === undefined) return undefined;   // closed vocabulary, exhausted
        datum[key] = id;
    }
    return datum;
}

/**
 * The field a table's field map declares as its identity key, or null.
 * @param {Record<string, import('../types').FieldSchema> | undefined} schema
 * @returns {string | null}
 */
function keyFieldOf(schema) {
    if (!schema) return null;
    for (const [field, spec] of Object.entries(schema)) {
        if (spec && spec.key === true) return field;
    }
    return null;
}

/**
 * The scene node an edit is acting on: `ctx.node` for a direct pick, else the
 * mark in `ctx.marks` at `ctx.index` (a plane pick carries no node).
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

// One keyboard step on a continuous axis, as a fraction of its pixel range.
const NUDGE_FRACTION = 0.01;
const NUDGE_FRACTION_COARSE = 0.1;

/**
 * The pixel one keyboard step along `scale` moves the pointer to, so an arrow key
 * drives the same edit a drag does. On a discrete axis a step is the next
 * category; on a continuous one it is a fraction of the range.
 * @param {any} scale the axis scale (may be null / non-invertible)
 * @param {number} at current pixel position on that axis
 * @param {-1 | 0 | 1} dir step direction in pixel space
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
        // Ask the scale which way its categories run in pixels.
        const ascends = scale.encode(domain[domain.length - 1]) > scale.encode(domain[0]);
        const next = i + (ascends ? dir : -dir);
        if (next < 0 || next >= domain.length) return at;
        return scale.encode(domain[next]);
    }

    const [lo, hi] = rangeExtent(scale);
    const step = (hi - lo) * (coarse ? NUDGE_FRACTION_COARSE : NUDGE_FRACTION);
    return Math.max(lo, Math.min(hi, at + dir * step));
}

// A domain position as a number (a Date as its timestamp).
/** @param {any} p @returns {number} */
export const numOf = (p) => (p instanceof Date ? p.getTime() : p);

/**
 * Map a pixel on a track [pxAt0 → pxAt1] linearly to a value in [loVal → hiVal],
 * clamped to the track. Used by `slide`. Domain-linear on purpose: the track is a
 * UI segment, not the scale's pixel range.
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
 * The domain extremes [lo, hi] of a resolved channel, from its scale's
 * `domainConfig`. Falls back to [0, 1].
 * @param {import('../types').ResolvedChannel | { scale?: any } | null | undefined} ch
 * @returns {[number, number]}
 */
export function channelDomain(ch) {
    const dom = ch && ch.scale && ch.scale.domainConfig;
    if (Array.isArray(dom) && dom.length) return [dom[0], dom[dom.length - 1]];
    return [0, 1];
}

/**
 * The discrete values a channel steps through (what `cycle` advances along): the
 * scale's domain, else the field's schema domain. Channels with `scale: null` or
 * raw channels have no scale, so the schema fallback is the normal path for them.
 * @param {import('../types').ResolvedChannel | null | undefined} ch
 * @param {Record<string, any> | undefined} [schema] the target table's field map
 * @returns {any[] | null}
 */
export function discreteDomain(ch, schema) {
    const fromScale = ch && ch.scale && typeof ch.scale.domain === 'function'
        ? ch.scale.domain()
        : null;
    if (Array.isArray(fromScale) && fromScale.length) return fromScale;
    const spec = ch && ch.field != null && schema ? schema[ch.field] : null;
    const declared = spec && spec.domain;
    return Array.isArray(declared) && declared.length ? declared : null;
}

/**
 * Invert the pointer through one channel's scale. Pass `center` for radial
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
 * Recenter a mark's pixel span on the pointer and invert both endpoints to data.
 * Used by `moveSpan` and the body zone of `brushSpan` / `brushRect`.
 *
 * The span width comes from the datum (the node is the fallback) and stays rigid
 * at the range edges; a span wider than the range pins to it. Returns a ≤ b.
 * @param {any} node the mark's current scene node (rect: x/y/width/height)
 * @param {import('../types').ResolvedChannel} chA
 * @param {import('../types').ResolvedChannel} chB
 * @param {{ x: number, y: number }} pointer
 * @param {any} [datum] the row, for the span's data-space width
 * @returns {{ a: any, b: any } | undefined}
 */
export function recenterSpan(node, chA, chB, pointer, datum) {
    if (!chA || !chB || !chA.scale || !chB.scale) return undefined;
    if (!chA.scale.invertible || !chB.scale.invertible) return undefined;
    const axis = axisOf(chA.name);
    if (!axis || axis !== axisOf(chB.name)) return undefined; // must share an axis

    const visual = axis === 'x' ? pointer.x : pointer.y;
    let span = null;
    if (datum && datum[chA.field] != null && datum[chB.field] != null
        && typeof chA.scale.encode === 'function' && typeof chB.scale.encode === 'function') {
        const pa = chA.scale.encode(datum[chA.field]);
        const pb = chB.scale.encode(datum[chB.field]);
        if (Number.isFinite(pa) && Number.isFinite(pb)) span = Math.abs(pa - pb);
    }
    if (span == null && node) span = axis === 'x' ? node.width : node.height;
    if (visual === undefined || span == null) return undefined;

    let p1 = visual - span / 2;
    let p2 = visual + span / 2;

    // Shift the whole span inside the range; invertValue would clamp each end alone.
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

    const va = chA.scale.invertValue(p1);
    const vb = chB.scale.invertValue(p2);
    return numOf(va) <= numOf(vb) ? { a: va, b: vb } : { a: vb, b: va };
}
