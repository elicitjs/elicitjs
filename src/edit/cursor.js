// @ts-check
// cursor.js — the default pointer cursor for a set of edits, read from what the
// edits declare: gesture, travel axis, channels. An edit's own `cursor` wins.

import { axisOf, offsetParentOf } from '../core/encoding.js';
import { resolveChannels } from './route.js';
import { driverFor } from './drivers/index.js';

/** @type {Record<string, string>} */
const AXIS_CURSOR = { x: 'ew-resize', y: 'ns-resize' };

/**
 * The axes a drag edit moves the pointer along. A declared travel `axis` (slide)
 * wins; otherwise the axes of the channels it writes. Empty when unknown.
 * @param {any} edit
 * @param {any} feature
 * @param {import('../types').ScaleMap} scales
 * @returns {string[]}
 */
function travelAxes(edit, feature, scales) {
    if (edit.axis === 'x' || edit.axis === 'y') return [edit.axis];
    return resolveChannels(edit.channels, (feature && feature.channels) || {}, scales, feature)
        .map((ch) => axisOf(ch.name) || offsetParentOf(ch.name) || '')
        .filter(Boolean);
}

/**
 * One cursor for the drag edits: a resize arrow when they all travel one
 * cartesian axis, else `move`.
 * @param {any[]} drags
 * @param {any} feature
 * @param {import('../types').ScaleMap} scales
 * @returns {string}
 */
function dragCursor(drags, feature, scales) {
    const axes = new Set();
    for (const e of drags) {
        const own = travelAxes(e, feature, scales);
        if (!own.length) return 'move';
        own.forEach((a) => axes.add(a));
    }
    const [only] = axes;
    return axes.size === 1 && AXIS_CURSOR[only] ? AXIS_CURSOR[only] : 'move';
}

/**
 * The cursor for a node given the direct edits on its mark, or null when no
 * edit acts on the node.
 *
 * Order: an edit's own `cursor`; a drag's travel axis (x → `ew-resize`,
 * y → `ns-resize`, both or unknown → `move`); a typed edit → `text`; a click → `pointer`.
 * An edit with `grabs` counts only on the nodes it accepts.
 * @param {import('../types').Edit[]} edits the mark's active direct edits
 * @param {any} feature
 * @param {import('../types').ScaleMap} scales
 * @param {any} [node]
 * @returns {string | null}
 */
export function cursorFor(edits, feature, scales, node) {
    const live = node
        ? edits.filter((e) => typeof e.grabs !== 'function' || e.grabs(node))
        : edits;
    if (!live.length) return null;
    const own = live.find((e) => e.cursor);
    if (own) return /** @type {string} */ (own.cursor);
    const drags = live.filter((e) => e.gesture === 'drag');
    if (drags.length) return dragCursor(drags, feature, scales);
    if (live.some((e) => /** @type {any} */ (e).inline)) return 'text';
    return 'pointer';
}

/**
 * The raised plane's resting cursor, from the plane-picked edits of every mark.
 *
 * Order: an edit's own `cursor`; its driver's `cursor` (draw → `crosshair`); the
 * travel axis of drags whose driver only chooses a row (nearest, sweep); `pointer`.
 * @param {{ feature: any, edits: import('../types').Edit[] }[]} groups active
 *   non-direct edits per feature
 * @param {import('../types').ScaleMap} scales
 * @returns {string}
 */
export function planeCursorFor(groups, scales) {
    for (const { edits } of groups) {
        const own = edits.find((e) => e.cursor);
        if (own) return /** @type {string} */ (own.cursor);
    }
    for (const { edits } of groups) {
        for (const e of edits) {
            const d = driverFor(e);
            if (d && d.cursor) return d.cursor;
        }
    }
    /** @type {Set<string>} */
    const cursors = new Set();
    for (const { feature, edits } of groups) {
        const drags = edits.filter((e) => {
            const d = driverFor(e);
            return e.gesture === 'drag' && !!(d && d.targetsRow);
        });
        if (drags.length) cursors.add(dragCursor(drags, feature, scales));
    }
    if (!cursors.size) return 'pointer';
    const [only] = cursors;
    return cursors.size === 1 ? only : 'move';
}
