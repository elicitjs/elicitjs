// @ts-check
// move driver — the drag lifecycle for a RELATIVE `move` edit (edit.move with
// mode:'relative'). Absolute move is stateless and needs no driver; a relative one
// must remember where the grab began, and only a driver can stash that in the
// per-feature session.
//
// It is the same shape as the slide driver, one axis wider: at dragstart it freezes
// the grab pixel and, per FIELD the move writes, that field's current value. Each
// drag tick the edit re-encodes the frozen value, adds the pointer's displacement
// on that field's axis, and inverts — so the grab offset is preserved and the
// inversion still goes through the channel's own scale.
//
// Claimed by CAPABILITY (`type: 'move'` + relative), never by a pick name. A
// relative move is direct-pick by construction — it measures from the mark you
// pressed — so `ctx.index` already names the datum, no proximity search happens and
// the plane is never raised. That is what lets it sit beside the other direct edits
// on a mark (a sticker's `cycle` on fill, its `editText`, a `slide` resizing it).
//
// Anchors are keyed by FIELD rather than by axis+field (slide's key): one move edit
// owns both axes of one datum, and a field appears on exactly one of them.
//
// EVERYTHING it stores lives under the one `move` key, and dragend nulls THAT key
// rather than calling session.clear(). The session is per FEATURE, not per driver,
// and a mark can carry two lifecycles at once — a sticker on a network board has a
// relative move AND edit.network.connect. Drivers run in registry order, so a
// wholesale clear() here ran before the connect driver's dragend and deleted the
// `fromIndex` it was about to build the link from: shift-drag drew a rubber band the
// whole way across and then created nothing.

import { nearestMark, pickThreshold } from '../pick.js';
import { axisOf } from '../../core/encoding.js';

const GRAB_THRESHOLD = 40;

/** @type {import('./index.js').Driver} */
export const moveDriver = {
    name: 'move',
    wants: (e) => e.type === 'move' && /** @type {any} */ (e).mode === 'relative',
    onEvent({ feature, event, edits, marks, data, index, session, runEdit }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick already names the datum. The fallback is for a gesture that
            // arrives with no node (a mark whose nodes were re-keyed mid-drag).
            const target = index != null
                ? index
                : nearestMark(marks, event.x, event.y, pickThreshold(edits[0], GRAB_THRESHOLD));
            if (target == null) return false;
            const row = data[target];
            /** @type {Record<string, { startPx: number, startValue: any }>} */
            const anchors = {};
            for (const edit of edits) {
                for (const name of edit.channels || []) {
                    const spec = feature.channels && feature.channels[name];
                    const field = spec && spec.field;
                    if (!field || !row || row[field] === undefined) continue;
                    // Which pointer coordinate this field moves along is the
                    // CHANNEL's axis (axisOf, the one accessor) — a field on y must
                    // not follow pointer x.
                    anchors[field] = {
                        startPx: axisOf(name) === 'y' ? event.y : event.x,
                        startValue: row[field]
                    };
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
