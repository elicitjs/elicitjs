// @ts-check
// composite.js — a GLYPH: a named group of ordinary marks over the chart's one
// dataset. Each part encodes some columns of the same rows; a part whose channel
// carries an `edit` is a handle. Editing a handle mutates its field; on the next
// render every other part rebuilds from the changed rows, so the glyph stays
// internally consistent with no per-part wiring.
//
// (`group` is an alias of this factory — it used to be a separate mark for the
// second mode below, back when the two had separate implementations.)
//
// ── Two modes, one rule apart ───────────────────────────────────────────────
// PLAIN — every part stands on the chart's own axes. Right for a glyph whose
// parts are all data values: an error bar's caps are positions on y.
//
//   composite({
//     id: 'errorbar',
//     constraints: [centerWithinEnds],
//     parts: [
//       ruleX({ channels: { x: {field:'g'}, y1: {field:'lo'}, y2: {field:'hi'} } }),
//       point({ channels: { x: {field:'g'}, y:  {field:'mean', edit: move()} } }),
//       tick({  channels: { x: {field:'g'}, y:  {field:'lo',   edit: move()} } }),
//       tick({  channels: { x: {field:'g'}, y:  {field:'hi',   edit: move()} } }),
//     ],
//   })
//
// BOX — the composite is a per-datum box, and parts place themselves INSIDE it.
// Right for a glyph whose parts are relative to the glyph rather than to the
// data: a face's eye is not "at y = 0.16 of the data", it is "16% of the way up
// this face". A part opts in by stating a channel in local units (`frame:`), and
// THAT is what switches the mode on — nothing else. The composite's own `x`/`y`/
// `size` then place and size the box instead of trickling down.
//
//   composite({
//     channels: { x: {field:'gdp'}, y: {field:'life'}, size: {value: 40} },
//     parts: [
//       point({   channels: { size: { frame: 1 } } }),          // fills the box
//       ellipse({ channels: { x: { frame: -0.4 }, y: { frame: 0.16 },
//                             rx: { field: 'openness', frame: [0.06, 0.19],
//                                   edit: slide({ axis: 'x', increase: 'right' }) } } }),
//     ],
//   })
//
// ── The box ─────────────────────────────────────────────────────────────────
// The composite's `x` / `y` / `size` define, FOR EACH ROW, an origin (cx, cy)
// and a half-size R. A local channel is resolved against that box: local +1 on x
// is cx + R, local +1 on y is cy - R (local y is UP), a magnitude of 1 is R.
// `frameFamilyOf` in core/encoding.js owns which channel reads the box which way;
// `createFrameScale` in core/scales.js turns each into a real linear scale.
//
// Real scale is the whole point. A local channel is not a pixel offset a mark
// computes and an edit has to un-compute with a bespoke track — it is an
// ordinary invertible Scale that happens to be built per datum, so:
//   · a mark encodes through `encodeChannel`, exactly as it always does, and
//   · an edit inverts through the SAME object (each node carries its frame map
//     as `node.frame`, and computeEdit overlays it — see core/elicit.js).
// So `slide` / `move` / `rotate` / `resize` work inside a box unchanged; there is
// no second inversion path, and "an edit is the inverse of encoding" is true per
// datum rather than approximately.
//
// `{ frame: -0.4 }` is a pinned local position; `{ field: 'f', frame: [lo, hi] }`
// maps the field's SCHEMA domain onto that slice of the box. `{ value }` still
// means PIXELS here as everywhere — it is the escape hatch, and inside a glyph
// you almost never want one, which is why the local spelling is the short one.
//
// ── What a composite emits ──────────────────────────────────────────────────
// Either way this is a DESUGARING, not a new kind of feature: it returns plain
// features and `Elicit` flattens them, exactly as the `axes` convenience desugars
// into axis/grid marks. The engine learns nothing. There is no scene-graph group:
// co-centered parts that share an `angle` channel each emit `node.angle` and the
// renderer rotates them about their own centers.
//
// In PLAIN mode it returns exactly the parts. In BOX mode it returns:
//
//   1. the BOX itself — a feature carrying the composite's x/y/size, drawing one
//      transparent circle per row at (cx, cy) with radius R. It is FIRST, so it
//      sits at the bottom of z-order: a part with its own edit is drawn above and
//      wins the direct pick, while an inert part is pointer-transparent and lets
//      the click through. That is what makes `x: { field, edit: move() }` on the
//      composite move the whole glyph while dragging an eye still edits the eye.
//      It also feeds the global resolver, so the frame's origin has axes to be
//      measured against.
//   2. the PARTS, each local one wrapped so its `build` runs once per row with
//      that row's frame scales substituted in. Each part stays its own feature,
//      so direct-pick dispatch keeps a drag on one part off its siblings.
//
// A local part that states no x/y sits at the box's ORIGIN. Parts do not inherit
// the composite's x/y/size in box mode — those mean "the box", not "each part's
// position" — so stating nothing is how you say "here, at the glyph".
//
// Two consequences of the per-row wrapping, both deliberate:
//   · a local part's `build` sees a ONE-ROW dataset, so a derived `{ fn }` channel
//     is called as `(d, 0, [d])` — it can't look across rows. Read the field.
//   · a series (line-family) mark cannot span rows inside a box, so it is
//     dev-warned rather than silently drawing one-point lines.
//
// A part with NO local channel inside a box composite keeps its ordinary build
// over the global scales — that is the escape hatch for a part that genuinely
// spans to a data value.
//
// ── Why the parts are real, separate features ───────────────────────────────
//   1. NO HANDLE ARBITRATION. Direct-pick dispatch routes a gesture to the feature
//      owning the touched node (elicit.js: `features.find(f => f.id ===
//      event.node.featureId)`), so a drag on the `hi` cap cannot reach the `lo`
//      cap's edit. A glyph whose handles share ONE feature does need arbitration —
//      see plot/trend.js, whose two handles sit on one datum.
//   2. NO CHANNEL GYMNASTICS. Each handle is its own mark, so each edits a plain
//      `y` (or `x`) channel. The x1/x2/y1/y2 span channels are left to the marks
//      that genuinely span, like the whisker's ruleX.
//   3. SHARED STATE FOR FREE. Every mark reads the chart's one dataset, so a
//      coupled edit (drag the mean, shift lo/hi with it) and a dataset constraint
//      (keep the mean between the caps) both work across parts with no plumbing.
//      The constraint gates and repairs whichever part's handle you grabbed.
//
// Parts that carry no edit are pure visuals; the engine gives them
// `pointerEvents:'none'` (a mark with no direct-pick edit can't consume a gesture,
// so it must not block one). Put visuals first and handles last in `parts` so
// handles paint on top; pointer-transparency still covers an inert part that
// overlaps a later handle.

import { normalizeMarkOptions, encodeChannel, positionalKeys, themeOf } from './mark.js';
import { createFrameScale, bandwidthOf, isBand } from '../core/scales.js';
import {
    frameSpecOf, normalizeFrameKey, frameFamilyOf, frameLocalRange, channelRange
} from '../core/encoding.js';
import { warn } from '../core/dev.js';

// The composite's own channels — the ones that DEFINE the box rather than
// describe a part. In box mode they stay off the trickle-down list: inheriting
// them would place every part at the origin AND at the box's full size, which is
// the opposite of a local frame. (A local part reaches the origin by stating
// nothing; see the origin defaults below.)
const FRAME_KEYS = ['x', 'y', 'size'];

/**
 * Shallow-merge composite channels under part channels. Part keys win entirely
 * (replace the ChannelSpec). When `keepEdit` is false, any channel that came
 * from the composite and still carries an `edit` has that edit stripped — so only
 * the last part keeps inherited edits.
 * @param {Record<string, any>} groupChannels
 * @param {Record<string, any>} partChannels
 * @param {boolean} keepEdit
 * @returns {Record<string, any>}
 */
export function mergeChannels(groupChannels, partChannels, keepEdit) {
    /** @type {Record<string, any>} */
    const merged = {};
    for (const [name, spec] of Object.entries(groupChannels || {})) {
        if (!spec) continue;
        if (!keepEdit && spec.edit) {
            const { edit: _edit, ...rest } = spec;
            merged[name] = rest;
        } else {
            merged[name] = spec;
        }
    }
    // Part wins on name conflict — including its own edit, if any.
    for (const [name, spec] of Object.entries(partChannels || {})) {
        if (spec !== undefined) merged[name] = spec;
    }
    return merged;
}

/**
 * Desugar every `frame:` shorthand in a channel map, IN PLACE — marks close over
 * their channels object inside build(), so replacing it would leave build() on
 * the old one (the same load-bearing detail the merge below documents).
 * @param {Record<string, any>} channels
 * @returns {Record<string, any>} the same object
 */
function desugarFrame(channels) {
    for (const [name, spec] of Object.entries(channels || {})) {
        const next = normalizeFrameKey(spec);
        if (next !== spec) channels[name] = next;
    }
    return channels;
}

/** @param {Record<string, any>} channels @returns {boolean} */
function hasFrameChannel(channels) {
    return Object.values(channels || {}).some((spec) => !!frameSpecOf(spec));
}

/**
 * The box's default half-size when the composite declares no `size`: half a
 * category slot when the glyph sits in one (so a face fills its band, the same
 * rule `arc` uses to fit a slot), else a comfortable share of the plot.
 * @param {import('../types').ScaleMap} scales
 * @param {number} width @param {number} height
 * @returns {number}
 */
function defaultHalfSize(scales, width, height) {
    /** @type {number[]} */
    const slots = [];
    if (isBand(scales.x)) slots.push(bandwidthOf(scales.x, 0));
    if (isBand(scales.y)) slots.push(bandwidthOf(scales.y, 0));
    const slot = slots.filter((s) => s > 0);
    return slot.length ? Math.min(...slot) / 2 : Math.min(width, height) * 0.35;
}

/**
 * One row's box: where the glyph sits and how big it is. The single definition,
 * shared by the box feature's own nodes and by every part wrapped inside it — so
 * what you grab and what is drawn inside it cannot drift apart.
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} groupChannels
 * @param {any} d @param {number} index @param {any[]} data
 * @param {number} width @param {number} height
 * @returns {{ cx: number, cy: number, r: number }}
 */
function frameBox(scales, groupChannels, d, index, data, width, height) {
    const fallbackR = defaultHalfSize(scales, width, height);
    return {
        cx: encodeChannel(scales, groupChannels, 'x', d, width / 2, index, data),
        cy: encodeChannel(scales, groupChannels, 'y', d, height / 2, index, data),
        r: encodeChannel(scales, groupChannels, 'size', d, fallbackR, index, data),
    };
}

/**
 * The value domain of one local channel. A `{ field }` channel is in the field's
 * own units, so the SCHEMA owns its domain exactly as it does everywhere else; a
 * `{ datum }` constant is already stated in local units, so the local range IS
 * its domain (making the scale the identity local -> pixel mapping).
 * @param {any} spec the ChannelSpec
 * @param {number[]} localRange
 * @param {Record<string, any>} schema
 * @returns {any[]}
 */
function frameDomain(spec, localRange, schema) {
    if (spec.field == null) return localRange;
    const fieldSpec = schema && schema[spec.field];
    const domain = fieldSpec && fieldSpec.domain;
    if (Array.isArray(domain) && domain.length) return [domain[0], domain[domain.length - 1]];
    warn(
        `frame:domain:${spec.field}`,
        `field "${spec.field}" is encoded in a composite's local frame, but the schema ` +
        `declares no domain for it — a frame maps the field's DOMAIN onto the glyph's local ` +
        `box, so without one it falls back to [0, 1]. Declare it: ` +
        `schema: { ${spec.field}: { type: "quantitative", domain: [lo, hi] } }.`
    );
    return [0, 1];
}

/**
 * Build the frame scale map for ONE row: one linear scale per local channel of
 * this part, closed over that row's origin and half-size.
 * @param {Record<string, any>} channels the part's channel map
 * @param {string[]} names the local channel names
 * @param {{ cx: number, cy: number, r: number }} box
 * @param {Record<string, any>} schema
 * @param {{ width: number, height: number }} dims
 * @param {any} theme
 * @returns {Record<string, any>}
 */
function frameScales(channels, names, box, schema, dims, theme) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const name of names) {
        const spec = channels[name];
        const frameSpec = frameSpecOf(spec) || {};
        const family = frameFamilyOf(name);
        // Where in the box this channel's extremes land. A 'plain' channel (angle,
        // curvature) has no local box — its units are its own — so it falls back to
        // the channel's ordinary default output range.
        const localRange = frameSpec.range
            || frameLocalRange(name)
            || channelRange(name, 'linear', dims, theme);
        const scale = createFrameScale({
            domain: frameDomain(spec, localRange, schema),
            localRange,
            origin: family === 'x' ? box.cx : family === 'y' ? box.cy : 0,
            halfSize: box.r,
            family,
        });
        if (scale) out[name] = scale;
    }
    return out;
}

/**
 * The travel descriptors (`node.dm`) for a part's editable local channels, so
 * `guide: { track: true }` can draw where a handle may go.
 *
 * Only the POSITIONAL families get one, and only for a channel carrying an edit.
 * The contract is that a track IS the mapping the edit inverts through — so it is
 * drawn for the case where that is exactly true (a positional local channel: its
 * scale's pixel range is its travel) and left off where it would be a plausible
 * lie (a magnitude or an angle has no straight track, and an edit like `slide`
 * anchors its own).
 * @param {Record<string, any>} channels
 * @param {string[]} names the local channel names
 * @param {Record<string, any>} frame the per-datum frame scales
 * @returns {{ x?: any, y?: any } | null}
 */
function frameTracks(channels, names, frame) {
    /** @type {Record<string, any>} */
    const dm = {};
    for (const name of names) {
        const spec = channels[name];
        const scale = frame[name];
        if (!spec || !spec.edit || spec.field == null || !scale) continue;
        const axis = frameFamilyOf(name);
        if (axis !== 'x' && axis !== 'y') continue;
        const domain = scale.domainConfig || [];
        if (domain.length < 2 || dm[axis]) continue;
        const loVal = domain[0];
        const hiVal = domain[domain.length - 1];
        dm[axis] = {
            channel: name,
            field: spec.field,
            pxAt0: scale.encode(loVal),
            pxAt1: scale.encode(hiVal),
            loVal,
            hiVal,
        };
    }
    return Object.keys(dm).length ? dm : null;
}

/**
 * @param {import('../types').CompositeOptions} [options]
 * @returns {any[]} the parts (plus the box, in box mode), as features for
 *   Elicit's flattened `features` list
 */
export function composite(options = {}) {
    // Desugar top-level shorthands (fill, angle, size, …) into composite channels
    // so `composite({ fill: 'steelblue', angle: 45, parts })` works like a mark.
    const opts = normalizeMarkOptions(options, { mark: 'composite', allow: ['parts', 'discreteScale', 'table'] });
    const {
        id,
        parts = [],
        constraints,
        edits,
        // Which TABLE this glyph is a view over. A composite DESUGARS into separate
        // features that each resolve their own table, so it has to be stamped onto
        // the box and every part — otherwise a composite({ table }) would draw its
        // parts from the primary table while its box drew the named one.
        table,
        channels: groupChannels = {},
        // Glyphs usually sit in category slots; a band gives each part a centred
        // slot. Stamped onto parts that don't state their own preference. (Scale
        // resolution lets 'band' win a disagreement between marks anyway.)
        discreteScale = 'band'
    } = opts;

    const name = id || 'composite';
    const last = parts.length - 1;

    // `frame:` is sugar for a `scale` form; fold it away before anything reads a
    // channel, so `frameSpecOf` stays the one reader of "is this local".
    desugarFrame(groupChannels);
    for (const part of parts) desugarFrame(part.channels || (part.channels = {}));

    // BOX MODE is switched on by a part asking for local coordinates — never by a
    // channel the composite happens to declare. Several plain glyphs set x/y (and
    // angle) on the composite precisely so the parts INHERIT them; reading that as
    // "this is a box" would silently reinterpret every constant inside them.
    const boxed = parts.some((/** @type {any} */ p) => hasFrameChannel(p.channels))
        || Object.entries(groupChannels).some(
            ([key, spec]) => !FRAME_KEYS.includes(key) && frameSpecOf(spec)
        );

    // In plain mode everything trickles. In box mode x/y/size describe the BOX,
    // so they are withheld and the parts state local coordinates instead.
    /** @type {Record<string, any>} */
    const trickle = {};
    for (const [key, spec] of Object.entries(groupChannels)) {
        if (boxed && FRAME_KEYS.includes(key)) continue;
        trickle[key] = spec;
    }

    const wrapped = parts.map((/** @type {any} */ part, /** @type {number} */ i) => {
        // Marks close over their factory `channels` object in build() (arrow
        // functions). Mutate that object in place so encoding sees the merge;
        // replacing the property with a new map would leave build() on the old one.
        const closed = part.channels;
        const merged = mergeChannels(trickle, { ...closed }, i === last);
        for (const key of Object.keys(closed)) delete closed[key];
        Object.assign(closed, merged);

        let framed = Object.keys(closed).filter((ch) => frameSpecOf(closed[ch]));

        if (framed.length) {
            // A local part that states no position sits at the box's origin. This is
            // what lets a part say "here, at the glyph" by saying nothing, instead of
            // repeating the composite's own x/y on every part.
            for (const axis of ['x', 'y']) {
                if (closed[axis] === undefined) {
                    closed[axis] = { datum: 0, scale: 'frame' };
                    framed.push(axis);
                }
            }
        }

        if (framed.length && part.supportsSeries) {
            warn(
                `composite:series:${name}:${i}`,
                `composite "${name}" contains a series mark (${part.markName || 'a line-family mark'}) ` +
                `with local (frame) channels. A frame is per ROW, so the mark is built one row at a ` +
                `time and cannot group rows into a series. Position it on the global scales, or ` +
                `move it out of the composite.`
            );
        }

        const inner = part.build;
        const build = !framed.length ? inner : (
            /**
             * @param {any[]} currentData
             * @param {import('../types').ScaleMap} scales
             * @param {number} width @param {number} height
             * @returns {import('../types').FeatureNode[]}
             */
            (currentData, scales, width, height) => {
                const schema = /** @type {any} */ (scales).schema || {};
                const theme = themeOf(scales);
                const dims = { width, height };
                /** @type {import('../types').FeatureNode[]} */
                const out = [];
                for (let index = 0; index < currentData.length; index++) {
                    const d = currentData[index];
                    const box = frameBox(scales, groupChannels, d, index, currentData, width, height);
                    const frame = frameScales(closed, framed, box, schema, dims, theme);
                    const tracks = frameTracks(closed, framed, frame);
                    const nodes = inner([d], { ...scales, ...frame }, width, height) || [];
                    for (const node of nodes) {
                        // The inner build saw a one-row dataset, so its index is 0.
                        node.index = index;
                        node.data = d;
                        // The scales this node was encoded through, so an edit on it
                        // inverts through the same objects (core/elicit.js).
                        node.frame = frame;
                        if (tracks && node.dm == null) node.dm = tracks;
                        out.push(node);
                    }
                }
                return out;
            }
        );

        return {
            ...part,
            channels: closed,
            build,
            // Inherited x/y may arrive after the mark factory stamped xKey/yKey
            // from its own (then-empty) channels — refresh from the merge.
            xKey: (closed.x && closed.x.field) || part.xKey,
            yKey: (closed.y && closed.y.field) || part.yKey,
            // Deterministic, stable ids so a part keeps its identity across renders
            // (the engine keys scene nodes and driver sessions by feature id).
            id: part.id || `${name}/${i}`,
            // A part states its own table only to override the glyph's; otherwise
            // the whole composite is one view over one table.
            table: part.table || table,
            discreteScale: part.discreteScale || discreteScale,
            // Composite-level invariants ride on the first part in plain mode (in box
            // mode the box feature carries them). Placement is immaterial — the engine
            // promotes every feature's `constraints` into one dataset-wide set — but
            // attaching them once keeps the set clean before it dedupes.
            constraints: !boxed && i === 0
                ? [...(constraints || []), ...(part.constraints || [])]
                : part.constraints,
            // Composite-level edits land on the LAST part, the same rule an inherited
            // channel edit follows: one dataset, so a whole-dataset edit declared on
            // every part would fire once per part. In box mode they go to the box
            // instead — an edit declared on the glyph is about the GLYPH, and the box
            // is the feature that holds its placement columns.
            edits: !boxed && i === last && edits ? [...edits, ...(part.edits || [])] : part.edits,
        };
    });

    if (!boxed) return wrapped;

    // ── The box ────────────────────────────────────────────────────────────
    // A real feature, drawn FIRST so it is beneath every part: it carries the
    // composite's global x/y/size (so the resolver builds the axes the origin is
    // measured against) and one transparent circle per row (so an edit on those
    // channels has a node to grab and moves the whole glyph).
    /** @type {Record<string, any>} */
    const boxChannels = {};
    for (const key of FRAME_KEYS) {
        const spec = groupChannels[key];
        // A local composite channel would be circular — the box measured against
        // itself — so it never defines the box.
        if (!spec || frameSpecOf(spec)) continue;
        boxChannels[key] = spec;
    }

    // Whether the box is something you can GRAB. A hit node is set up only when an
    // edit names one of the box's own columns; otherwise the node is left for the
    // engine's pointer-transparency pass to silence, exactly like any other mark
    // with no direct-pick edit. Setting `pointerEvents` unconditionally would opt
    // the box OUT of that pass and let an immovable glyph swallow the plane
    // gesture aimed past it (a create, a sweep).
    const grabbable = !!(edits && edits.length)
        || FRAME_KEYS.some((key) => boxChannels[key] && boxChannels[key].edit);

    const box = {
        id: `${name}/frame`,
        markName: 'composite',
        channels: boxChannels,
        constraints,
        edits,
        table,
        discreteScale,
        ...positionalKeys(boxChannels),
        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => currentData.map((d, index) => {
            const b = frameBox(scales, groupChannels, d, index, currentData, width, height);
            return /** @type {any} */ ({
                type: 'circle',
                cx: b.cx,
                cy: b.cy,
                r: b.r,
                // Invisible but hit-testable: `pointer-events: all` picks up the fill
                // area even when there is no fill, so the whole glyph — including the
                // gaps between its parts — is one grab target.
                fill: 'none',
                stroke: 'none',
                // Paints nothing, so say so: the renderer tags it `data-hit` and a
                // `circle.mark` selector can tell it from a part it sits under.
                hit: true,
                ...(grabbable ? { pointerEvents: 'all' } : {}),
                data: d,
                index,
            });
        }),
    };

    return [box, ...wrapped];
}

/**
 * A composite with a local frame. Kept as an alias because the box mode above
 * used to be a separate mark; there is one implementation now.
 * @type {typeof composite}
 */
export const group = composite;
