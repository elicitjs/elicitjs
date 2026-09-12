// @ts-check
// sweep driver — you-draw-it painting: like nearest, but the target is measured
// along the domain axis only (1D) or by euclidean distance (2D) and RE-RESOLVED
// every drag event (no dragstart lock), so one horizontal sweep paints each
// point's value as the pointer crosses its column. The drag is series-scoped: it
// locks onto the nearest line at dragstart so overlapping lines don't fight.

import { nearestMark, nearestMarkOnAxis, nearestSeries, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const sweepDriver = {
    name: 'sweep',
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex', 'series'],
    selects: true,
    onEvent({ event, edits, marks, session, runEdit }) {
        const threshold = pickThreshold(edits[0]);
        // The channels the sweep governs: one positional axis -> paint that value
        // along the OTHER (a function line); both x AND y -> a 2D sweep (connected
        // scatter), retargeting by euclidean distance.
        const chans = edits[0].channels || ['y'];
        const twoD = chans.includes('x') && chans.includes('y');
        const valueName = chans[0] || 'y';
        /** @type {'x' | 'y'} */
        const axis = valueName === 'x' ? 'y' : 'x'; // sweep (domain) axis, 1D case

        /** @param {any} lockSeries */
        const resolve = (lockSeries) => twoD
            ? nearestMark(marks, event.x, event.y, threshold, lockSeries)
            : nearestMarkOnAxis(marks, event.x, event.y, threshold, axis, lockSeries);

        let changed = false;
        if (event.type === 'hover') {
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const hit = resolve(s == null ? undefined : s);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit, series: s });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            // Lock onto the nearest line for the whole drag.
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const index = resolve(s == null ? undefined : s);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index, series: s });
            if (index != null) {
                edits.forEach((edit) => { if (runEdit(edit, index)) changed = true; });
            }
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            if (info) { info.activeIndex = null; info.series = null; }
            changed = true;
        } else if (event.type === 'drag') {
            // Paint: retarget within the locked series each event (no per-point
            // lock), so one stroke fills the whole line.
            const info = session.get();
            const lock = info && info.series != null ? info.series : undefined;
            const index = resolve(lock);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index });
            if (index != null) {
                edits.forEach((edit) => { if (runEdit(edit, index)) changed = true; });
            }
            changed = true;
        }
        return changed;
    }
};
