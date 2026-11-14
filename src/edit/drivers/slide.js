// @ts-check
// slide driver — the lifecycle for a relative `slide`. Claimed by capability for a
// direct-pick slide (`ctx.index` names the datum, the plane stays down), or by
// name for `pick: 'slide'`, which finds the nearest mark. At dragstart it stores
// `{ startPx, startValue }` per `slideAnchorKey(axis, field)`; the edit's apply
// does the math.

import { nearestMark, pickThreshold } from '../pick.js';
import { slideAnchorKey } from '../basic.js';

/** @type {import('./index.js').Driver} */
export const slideDriver = {
    name: 'slide',
    sessionKeys: ['index', 'slide'],
    wants: (e) => e.type === 'slide' && /** @type {any} */ (e).mode === 'relative',
    onEvent({ feature, event, edits, marks, data, index, session, runEdit }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick already names the datum; the plane form has to find it.
            const target = index != null
                ? index
                : nearestMark(marks, event.x, event.y, pickThreshold(edits[0]));
            if (target == null) return false;
            const row = data[target];
            /** @type {Record<string, { startPx: number, startValue: number }>} */
            const anchors = {};
            for (const edit of edits) {
                const axis = /** @type {any} */ (edit).axis === 'y' ? 'y' : 'x';
                const name = (edit.channels && edit.channels[0]) || null;
                const spec = name && feature.channels && feature.channels[name];
                const field = spec && spec.field;
                if (!field) continue;
                const startValue = row && row[field];
                if (typeof startValue !== 'number') continue;
                anchors[slideAnchorKey(axis, field)] = {
                    startPx: axis === 'x' ? event.x : event.y,
                    startValue
                };
            }
            if (!Object.keys(anchors).length) return false;
            session.set({ index: target, slide: anchors });
            changed = true;
        } else if (event.type === 'drag') {
            const lock = session.get();
            if (!lock || lock.index == null || !lock.slide) return false;
            for (const edit of edits) if (runEdit(edit, lock.index)) changed = true;
        } else if (event.type === 'dragend' || event.type === 'hoverout') {
            // Null only this driver's keys (see drivers/index.js).
            if (!session.get()) return false;
            session.set({ index: null, slide: null });
            changed = true;
        }
        return changed;
    }
};
