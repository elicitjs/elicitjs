// @ts-check
// brush driver — for a span pair (x1/x2 or y1/y2): grab an endpoint to resize that
// edge, or the body to move the span. The zone is classified once at dragstart and
// locked in the session.
//
// At dragend the edit runs once more with `zone: 'canonicalize'` to swap inverted
// values. Doing that per tick would overwrite the untouched edge once they cross.

import { nearestMark, pickThreshold, edgeInsetOf } from '../pick.js';
import { encodeChannel } from '../../plot/mark.js';
import { axisOf } from '../../core/encoding.js';

/**
 * Classify a grab against the mark's current span: near the low edge, near the
 * high edge, or the body. Returns the field now at the grabbed edge, resolved
 * from pixels since x1 may hold the larger value after a crossover.
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

/**
 * Drag tick of a zone-locked brush: track the pointer, run the edit on the locked row.
 * @param {any} session @param {{ x: number, y: number }} event
 * @param {import('../../types').Edit} edit @param {(edit: any, index: number) => any} runEdit
 */
export function brushDrag(session, event, edit, runEdit) {
    const info = session.get();
    if (!info) return;
    info.px = event.x;
    info.py = event.y;
    if (info.activeIndex != null && info.zone) runEdit(edit, info.activeIndex);
}

/**
 * Dragend tick: run the edit once with the zone forced to 'canonicalize', then
 * release the row. Returns the session info, for a driver with more to reset.
 * @param {any} session
 * @param {import('../../types').Edit} edit @param {(edit: any, index: number) => any} runEdit
 * @returns {any | null}
 */
export function brushRelease(session, edit, runEdit) {
    const info = session.get();
    if (!info) return null;
    if (info.activeIndex != null && info.zone) {
        info.zone = 'canonicalize';
        runEdit(edit, info.activeIndex);
    }
    info.activeIndex = null;
    return info;
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
            brushDrag(session, event, edit, runEdit);
            changed = true;
        } else if (event.type === 'dragend') {
            brushRelease(session, edit, runEdit);
            changed = true;
        }
        return changed;
    }
};
