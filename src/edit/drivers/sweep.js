// @ts-check
// sweep driver — you-draw-it painting: like nearest, but the target is measured
// along the domain axis only (1D) or by euclidean distance (2D) and RE-RESOLVED
// every drag event (no dragstart lock), so one horizontal sweep paints each
// point's value as the pointer crosses its column. The drag is series-scoped: it
// locks onto the nearest line at dragstart so overlapping lines don't fight.
//
// On a BAND (an area with y1/y2 edges) it also locks onto an EDGE at dragstart —
// the edge whose handle is nearest in 2-D — and paints that edge alone: only the
// edits governing it run, and only its handles are candidates (both edges of a
// row share the domain coordinate the 1-D search measures). Without that lock
// every edit on the mark ran each tick and the band collapsed onto the pointer.

import { nearestMark, nearestMarkOnAxis, nearestNode, nearestSeries, pickThreshold } from '../pick.js';

/** @type {import('./index.js').Driver} */
export const sweepDriver = {
    name: 'sweep',
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex', 'series', 'channel'],
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

        /**
         * The target for this tick: the nearest point in the locked series, on the
         * locked edge when there is one.
         * @param {any} lockSeries @param {string | null} edge
         */
        const resolve = (lockSeries, edge) => twoD
            ? nearestMark(marks, event.x, event.y, threshold, lockSeries)
            : nearestMarkOnAxis(marks, event.x, event.y, threshold, axis, lockSeries,
                (m) => edge == null || m.channel == null || m.channel === edge);

        /**
         * Run the edits that govern this tick's edge. An edit placed at MARK level
         * names no channel, so its apply would resolve none and write nothing: it
         * runs with the channels this driver sweeps (the engine warns when that
         * default was taken — see warnMissingEditChannels). An edit naming several
         * channels runs a view narrowed to the locked edge.
         * @param {number} index @param {string | null} edge
         */
        const paint = (index, edge) => {
            let changed = false;
            for (const edit of edits) {
                const own = edit.channels && edit.channels.length ? edit.channels : chans;
                let view = edit.channels && edit.channels.length ? edit : { ...edit, channels: chans };
                if (edge != null) {
                    if (!own.includes(edge)) continue;
                    if (own.length > 1) view = { ...edit, channels: [edge] };
                }
                if (runEdit(view, index)) changed = true;
            }
            return changed;
        };

        let changed = false;
        if (event.type === 'hover') {
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const hit = resolve(s == null ? undefined : s, null);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit, series: s });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            // Lock onto the nearest line for the whole drag — and, on a band, onto
            // the edge whose handle is nearest in 2-D.
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const lock = s == null ? undefined : s;
            const near = nearestNode(marks, event.x, event.y, threshold, lock);
            const edge = near && near.channel != null ? near.channel : null;
            const index = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index, series: s, channel: edge });
            if (index != null && paint(index, edge)) changed = true;
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            if (info) { info.activeIndex = null; info.series = null; info.channel = null; }
            changed = true;
        } else if (event.type === 'drag') {
            // Paint: retarget within the locked series (and edge) each event, so one
            // stroke fills the whole line.
            const info = session.get();
            const lock = info && info.series != null ? info.series : undefined;
            const edge = info && info.channel != null ? info.channel : null;
            const index = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index });
            if (index != null && paint(index, edge)) changed = true;
            changed = true;
        }
        return changed;
    }
};
