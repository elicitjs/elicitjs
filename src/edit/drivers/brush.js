// @ts-check
// brush driver — the combined Gantt-bar interaction for a span pair (x1/x2 or
// y1/y2): grab near one endpoint to resize just that edge; grab the body to
// translate the whole span. The grab zone is classified ONCE at dragstart and
// locked in the feature's session for the gesture (mirrors nearest.js's
// dragstart lock), so a continuous drag doesn't re-decide zone mid-gesture —
// which matters, because the two endpoint fields can cross (an edge dragged
// past the other) without breaking anything: bar.js's render always takes
// min/max of the pair, so it never cares which field holds which value.
//
// At dragend, the SAME edit is re-invoked once more with the locked zone
// forced to 'canonicalize' — a one-time data cleanup that swaps the two field
// VALUES if they ended up inverted. This can't happen mid-gesture (re-sorting
// every tick while a fixed field keeps receiving the pointer's value would
// silently overwrite the untouched edge the moment they cross), but doing it
// once at rest is invisible on screen, since rendering never depended on
// which field was which.

import { nearestMark, pickThreshold, edgeInsetOf } from '../pick.js';
import { encodeChannel } from '../../plot/mark.js';
import { axisOf } from '../../core/encoding.js';

/**
 * Classify a grab point against a mark's CURRENT rendered span on the pair's
 * shared axis: near the low-pixel edge, near the high-pixel edge, or in the
 * body between. Returns the FIELD NAME currently at the grabbed edge (not a
 * fixed channel position) — after a prior crossover, x1 may not hold the
 * smaller value, so "which field is at the low pixel" must be re-resolved
 * fresh each gesture, not assumed from the channel's declared name.
 * @param {any} feature
 * @param {import('../../types').ScaleMap} scales
 * @param {any} datum
 * @param {string[]} channelNames
 * @param {number} px @param {number} py
 * @param {number} edgeInset
 * @returns {{ zone: 'edgeA' | 'edgeB' | 'body', field?: string } | null}
 */
function classifyZone(feature, scales, datum, channelNames, px, py, edgeInset) {
    const markChannels = feature.channels || {};
    const [nameA, nameB] = channelNames;
    const specA = markChannels[nameA], specB = markChannels[nameB];
    if (!specA || !specB || !datum) return null;
    const axis = axisOf(nameA);
    if (!axis) return null;

    const posA = encodeChannel(scales, markChannels, nameA, datum);
    const posB = encodeChannel(scales, markChannels, nameB, datum);
    if (posA == null || posB == null) return null;

    const lo = Math.min(posA, posB), hi = Math.max(posA, posB);
    const loField = posA <= posB ? specA.field : specB.field;
    const hiField = posA <= posB ? specB.field : specA.field;
    const pointerCoord = axis === 'x' ? px : py;

    const distLo = Math.abs(pointerCoord - lo);
    const distHi = Math.abs(pointerCoord - hi);
    if (Math.min(distLo, distHi) <= edgeInset) {
        return distLo <= distHi ? { zone: 'edgeA', field: loField } : { zone: 'edgeB', field: hiField };
    }
    return { zone: 'body' };
}

/** @type {import('./index.js').Driver} */
export const brushDriver = {
    name: 'brush',
    options: ['edgeInset'],
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex', 'zone', 'field'],
    selects: true,
    onEvent({ feature, event, edits, marks, data, scales, session, runEdit }) {
        const edit = edits[0];
        const threshold = pickThreshold(edit);
        const edgeInset = edgeInsetOf(edit);
        const channelNames = edit.channels || [];
        let changed = false;

        if (event.type === 'hover') {
            const hit = nearestMark(marks, event.x, event.y, threshold);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            const hit = nearestMark(marks, event.x, event.y, threshold);
            const zone = hit != null
                ? classifyZone(feature, scales, data[hit], channelNames, event.x, event.y, edgeInset)
                : null;
            session.set({
                px: event.x, py: event.y, threshold,
                hoverIndex: hit, activeIndex: hit,
                zone: zone ? zone.zone : null,
                field: zone ? zone.field : null
            });
            changed = true;
        } else if (event.type === 'drag') {
            const info = session.get();
            if (info) { info.px = event.x; info.py = event.y; }
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                if (runEdit(edit, index)) changed = true;
            }
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                // One-time cleanup tick: force the zone to canonicalize, then commit.
                info.zone = 'canonicalize';
                runEdit(edit, index);
            }
            if (info) info.activeIndex = null;
            changed = true;
        }
        return changed;
    }
};
