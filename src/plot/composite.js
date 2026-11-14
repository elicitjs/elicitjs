// @ts-check
// composite.js — a glyph: a named group of ordinary marks over the chart's one
// dataset. A part whose channel carries an `edit` is a handle; the other parts
// rebuild from the edited rows on the next render.
//
// Plain mode: every part uses the chart's scales. Box mode: a part that states a
// channel in local units (`frame:`) switches it on; the composite's own x/y/size
// then define a per-row box, and local channels encode through a real per-row
// scale (`createFrameScale`) stamped as `node.frame` so edits invert through it.
// In box mode the output is [box, ...parts]; the box is first so it sits at the
// bottom of the glyph. Each part stays its own feature, so a drag on one part
// cannot reach another. See MARK_CONTRACTS.md and .claude/rules/marks.md.

import { normalizeMarkOptions, encodeChannel, positionalKeys, themeOf, withoutEdit } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { createFrameScale, bandwidthOf, isBand, scaleKey } from '../core/scales.js';
import {
    frameSpecOf, normalizeFrameKey, frameFamilyOf, frameLocalRange, channelRange
} from '../core/encoding.js';
import { warn } from '../core/dev.js';

// The channels that define the box. In box mode they don't trickle to parts.
const FRAME_KEYS = ['x', 'y', 'size'];

// Channels about the glyph as one node. They go on one feature (the box in box
// mode, else the first shaped part), never on every part.
const GLYPH_KEYS = ['ports', 'contains', 'dodge'];

// Counts composite calls so every glyph gets its own paint group.
let glyphSeq = 0;

/**
 * Shallow-merge composite channels under part channels; part keys win. Unless
 * `keepEdit`, inherited channels lose their `edit`, so only the last part keeps them.
 * @param {Record<string, any>} groupChannels
 * @param {Record<string, any>} partChannels
 * @param {boolean} keepEdit
 * @returns {Record<string, any>}
 */
function mergeChannels(groupChannels, partChannels, keepEdit) {
    /** @type {Record<string, any>} */
    const merged = {};
    for (const [name, spec] of Object.entries(groupChannels || {})) {
        if (!spec) continue;
        merged[name] = !keepEdit && spec.edit ? withoutEdit(spec) : spec;
    }
    for (const [name, spec] of Object.entries(partChannels || {})) {
        if (spec !== undefined) merged[name] = spec;
    }
    return merged;
}

/**
 * Desugar every `frame:` shorthand in a channel map, in place: marks close over
 * their channels object, so it must not be replaced.
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
 * The box's default half-size when no `size` is given: half a category slot, else
 * 35% of the smaller plot side.
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
 * One row's box (origin and half-size), shared by the box feature and every part.
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
 * Whether a local channel's field is categorical or ordinal (channel `type`, else
 * the schema's).
 * @param {any} spec the ChannelSpec
 * @param {Record<string, any>} schema
 * @returns {boolean}
 */
function isDiscreteField(spec, schema) {
    if (!spec || spec.field == null) return false;
    const fieldSpec = schema && schema[spec.field];
    const measure = spec.type || (fieldSpec && fieldSpec.type);
    return measure === 'categorical' || measure === 'ordinal';
}

/**
 * The value domain of one local channel: the schema's domain for a `{ field }`,
 * the local range itself for a `{ datum }` constant.
 * @param {any} spec the ChannelSpec
 * @param {number[]} localRange
 * @param {Record<string, any>} schema
 * @returns {any[]}
 */
function frameDomain(spec, localRange, schema) {
    if (spec.field == null) return localRange;
    const fieldSpec = schema && schema[spec.field];
    const domain = fieldSpec && fieldSpec.domain;
    // A discrete field keeps every category as a stop.
    if (Array.isArray(domain) && domain.length && isDiscreteField(spec, schema)) return domain.slice();
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
 * The frame scale map for one row: one scale per local channel of this part.
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
        // A channel with no local box (angle, curvature) uses its default range.
        const localRange = frameSpec.range
            || frameLocalRange(name)
            || channelRange(name, 'linear', dims, theme);
        const scale = createFrameScale({
            domain: frameDomain(spec, localRange, schema),
            localRange,
            origin: family === 'x' ? box.cx : family === 'y' ? box.cy : 0,
            halfSize: box.r,
            family,
            discrete: isDiscreteField(spec, schema),
        });
        // Published under both keys so it shadows the global scale either way
        // it is looked up; otherwise the part would encode through the chart's scale.
        if (scale) {
            out[name] = scale;
            if (spec && spec.field != null) out[scaleKey(name, spec.field)] = scale;
        }
    }
    return out;
}

/**
 * The travel descriptors (`node.dm`) for a part's editable local channels, drawn
 * by `guide: { track: true }`. Only positional (x/y) channels get one; a magnitude
 * or angle has no straight track.
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
    // This glyph's paint group, per call (not per id) so two id-less composites stay apart.
    const glyph = `glyph#${++glyphSeq}`;
    // Desugar top-level shorthands (fill, angle, size, …) into composite channels.
    const opts = normalizeMarkOptions(options, { mark: 'composite', allow: MARK_OPTIONS.composite });
    const {
        id,
        parts = [],
        edits,
        // Stamped onto the box and every part, since each resolves its own table.
        table,
        // Stamped on the box and every part that does not state its own.
        clip,
        channels: groupChannels = {},
        // Stamped onto parts that don't state their own.
        discreteScale = 'band'
    } = opts;

    const name = id || 'composite';
    const last = parts.length - 1;

    // Fold `frame:` sugar away first so `frameSpecOf` is the one reader of "is this local".
    desugarFrame(groupChannels);
    for (const part of parts) desugarFrame(part.channels || (part.channels = {}));

    // Box mode comes from a part's local channel, never from the composite's own
    // x/y: plain glyphs set those so parts inherit them.
    const boxed = parts.some((/** @type {any} */ p) => hasFrameChannel(p.channels))
        || Object.entries(groupChannels).some(
            ([key, spec]) => !FRAME_KEYS.includes(key) && frameSpecOf(spec)
        );

    // In box mode x/y/size describe the box, so they don't trickle.
    /** @type {Record<string, any>} */
    const trickle = {};
    for (const [key, spec] of Object.entries(groupChannels)) {
        if (boxed && FRAME_KEYS.includes(key)) continue;
        if (GLYPH_KEYS.includes(key)) continue;
        trickle[key] = spec;
    }
    if (!boxed && GLYPH_KEYS.some((key) => groupChannels[key])) {
        // The glyph's shape, not its label: a `node()`'s dot, not its name.
        const shaped = parts.filter((/** @type {any} */ p) => typeof p.nodeBox === 'function');
        const host = shaped.find((/** @type {any} */ p) => !p.labelBox) || shaped[0] || parts[0];
        for (const key of GLYPH_KEYS) {
            if (host && groupChannels[key]) (host.channels || (host.channels = {}))[key] = groupChannels[key];
        }
    }

    const wrapped = parts.map((/** @type {any} */ part, /** @type {number} */ i) => {
        // Mutate `channels` in place: build() closes over this object, so a new
        // map would leave build() on the old one.
        const closed = part.channels;
        const merged = mergeChannels(trickle, { ...closed }, i === last);
        for (const key of Object.keys(closed)) delete closed[key];
        Object.assign(closed, merged);

        let framed = Object.keys(closed).filter((ch) => frameSpecOf(closed[ch]));

        if (framed.length) {
            // A local part that states no position sits at the box's origin.
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
                `composite "${name}" contains a series mark (${part.type || 'a line-family mark'}) ` +
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
                        // So an edit inverts through the scales this node was encoded with.
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
            // A local part has no box in scene pixels, so it cannot stand for a node.
            nodeBox: framed.length ? undefined : part.nodeBox,
            labelBox: part.labelBox,
            // Paint group: the engine orders it by row, then part, so each glyph
            // paints whole (core/scene.js `paintOrder`).
            glyph,
            // Refresh xKey/yKey from the merge, which may have added x/y.
            xKey: (closed.x && closed.x.field) || part.xKey,
            yKey: (closed.y && closed.y.field) || part.yKey,
            // Stable ids: the engine keys scene nodes and driver sessions by feature id.
            id: part.id || `${name}/${i}`,
            table: part.table || table,
            clip: part.clip != null ? part.clip : clip,
            discreteScale: part.discreteScale || discreteScale,
            // Composite-level edits go on the last part only, so they fire once.
            // In box mode they go on the box instead.
            edits: !boxed && i === last && edits ? [...edits, ...(part.edits || [])] : part.edits,
        };
    });

    if (!boxed) return wrapped;

    // The box: drawn first so it sits beneath every part. It carries the global
    // x/y/size and one transparent circle per row to grab the whole glyph.
    /** @type {Record<string, any>} */
    const boxChannels = {};
    for (const key of FRAME_KEYS) {
        const spec = groupChannels[key];
        // A local channel would measure the box against itself.
        if (!spec || frameSpecOf(spec)) continue;
        boxChannels[key] = spec;
    }
    for (const key of GLYPH_KEYS) if (groupChannels[key]) boxChannels[key] = groupChannels[key];

    // Set `pointerEvents` only when grabbable; otherwise the engine makes the box
    // inert, so an immovable glyph doesn't swallow plane gestures.
    const grabbable = !!(edits && edits.length)
        || FRAME_KEYS.some((key) => boxChannels[key] && boxChannels[key].edit);

    const box = {
        id: `${name}/frame`,
        type: 'composite',
        // As a `hit` node it stays at the bottom of the paint group.
        glyph,
        channels: boxChannels,
        edits,
        table,
        clip,
        discreteScale,
        ...positionalKeys(boxChannels),
        /**
         * The glyph as a network node: its box. Links and `ports` dock to it.
         * @param {any} row @param {number} index @param {any[]} rows
         * @param {import('../types').ScaleMap} scales @param {number} width @param {number} height
         */
        nodeBox: (row, index, rows, scales, width, height) => {
            const b = frameBox(scales, groupChannels, row, index, rows, width, height);
            return { cx: b.cx, cy: b.cy, hw: b.r, hh: b.r, round: true };
        },
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
                // Invisible but hit-testable across the whole box.
                fill: 'none',
                stroke: 'none',
                // Tagged `data-hit` by the renderer.
                hit: true,
                ...(grabbable ? { pointerEvents: 'all' } : {}),
                data: d,
                index,
            });
        }),
    };

    return [box, ...wrapped];
}
