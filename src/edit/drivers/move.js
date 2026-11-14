// @ts-check
// move driver — the lifecycle for a relative `move`. Claimed by capability; the
// edit is direct-pick, so `ctx.index` names the datum and the plane stays down.
// At dragstart it stores, per field, the grab pixel and the field's value under
// the `move` session key; dragend nulls only that key (see drivers/index.js).

import { nearestMark, pickThreshold } from '../pick.js';
import { axisOf } from '../../core/encoding.js';
import { markCenter } from '../shared.js';

/** @type {import('./index.js').Driver} */
export const moveDriver = {
    name: 'move',
    sessionKeys: ['move'],
    // Exactly `edit.move`; scoped edits have dotted types ('geo.move').
    wants: (e) => e.type === 'move' && /** @type {any} */ (e).mode === 'relative',
    onEvent({ feature, event, edits, marks, data, index, session, runEdit }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick names the datum; fall back to the nearest mark.
            const target = index != null
                ? index
                : nearestMark(marks, event.x, event.y, pickThreshold(edits[0]));
            if (target == null) return false;
            const row = data[target];
            /** @type {Record<string, { startPx: number, startValue: any, radial?: boolean }>} */
            const anchors = {};
            // A radial channel (`radius`, `size`) anchors on distance from the centre.
            const node = (marks || []).find((m) => m && m.index === target);
            const centre = node ? markCenter(node) : null;
            for (const edit of edits) {
                for (const name of edit.channels || []) {
                    const spec = feature.channels && feature.channels[name];
                    const field = spec && spec.field;
                    if (!field || !row || row[field] === undefined) continue;
                    // The pointer coordinate is the channel's axis.
                    const axis = axisOf(name);
                    const radial = axis === 'radius' || name === 'size';
                    if (radial && !centre) continue;
                    anchors[field] = radial && centre
                        ? { startPx: Math.hypot(event.x - centre.cx, event.y - centre.cy), startValue: row[field], radial: true }
                        : { startPx: axis === 'y' ? event.y : event.x, startValue: row[field] };
                }
            }
            if (!Object.keys(anchors).length) return false;
            session.set({ move: { index: target, anchors } });
            changed = true;
        } else if (event.type === 'drag') {
            const lock = (session.get() || {}).move;
            if (!lock || lock.index == null) return false;
            for (const edit of edits) if (runEdit(edit, lock.index)) changed = true;
        } else if (event.type === 'dragend' || event.type === 'hoverout') {
            if (!(session.get() || {}).move) return false;
            session.set({ move: null });
            changed = true;
        }
        return changed;
    }
};
