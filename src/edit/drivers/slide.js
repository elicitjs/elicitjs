// @ts-check
// slide driver — the drag lifecycle for a RELATIVE `slide` edit (edit.slide with
// mode:'relative', the default). Absolute slide is stateless and needs no driver;
// relative slide must remember where the grab began, and only a driver can stash
// that in the per-feature session.
//
// At dragstart it freezes, per edit, the grab pixel (on that edit's axis) plus the
// datum's current field value; each drag tick it re-runs the edits against the
// locked datum, and each reads its own frozen anchor and moves the value
// proportionally to the pointer's displacement. The math lives in the edit
// (apply's relative branch), exactly as axisDrag leaves the domain math to
// edit.axis.scale — the driver owns only target selection and the lifecycle.
//
// It is claimed by CAPABILITY (`type: 'slide'` + relative), not only by a pick
// name, so it serves a DIRECT-pick slide too. That is the common case: a glyph
// part is grabbed by its own node, so `ctx.index` already names the datum, no
// proximity search happens and the plane is never raised — which is what lets a
// face's six parameters each carry a jump-free drag on the same chart. The
// plane form (`pick: 'slide'`) remains for a standalone magnitude chart where the
// gesture may start anywhere, and there the nearest mark is located instead.
//
// Anchors are keyed by axis+field (`slideAnchorKey`), so two relative slides on
// ONE feature — an eye's `rx` on x and `ry` on y — keep separate anchors and one
// diagonal drag drives both without either clobbering the other's start value.

import { nearestMark, pickThreshold } from '../pick.js';
import { slideAnchorKey } from '../basic.js';

const GRAB_THRESHOLD = 40;

/** @type {import('./index.js').Driver} */
export const slideDriver = {
    name: 'slide',
    wants: (e) => e.pick === 'slide'
        || (e.type === 'slide' && /** @type {any} */ (e).mode === 'relative'),
    onEvent({ feature, event, edits, marks, data, index, session, runEdit }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick already names the datum; the plane form has to find it.
            const target = index != null
                ? index
                : nearestMark(marks, event.x, event.y, pickThreshold(edits[0], GRAB_THRESHOLD));
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
            // Null this driver's own keys rather than clearing the feature's whole
            // session: it is shared with every other driver on the mark, and drivers
            // run in registry order — a wholesale clear() here would delete a connect
            // driver's `fromIndex` before its own dragend could build the link from
            // it (see drivers/move.js, where exactly that shipped).
            if (!session.get()) return false;
            session.set({ index: null, slide: null });
            changed = true;
        }
        return changed;
    }
};
