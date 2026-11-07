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
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex', 'series', 'channel', 'lastX', 'lastY'],
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
         * @param {number} index @param {string | null} edge @param {{ x: number, y: number }} [at]
         */
        const paint = (index, edge, at) => {
            let changed = false;
            for (const edit of edits) {
                const own = edit.channels && edit.channels.length ? edit.channels : chans;
                let view = edit.channels && edit.channels.length ? edit : { ...edit, channels: chans };
                if (edge != null) {
                    if (!own.includes(edge)) continue;
                    if (own.length > 1) view = { ...edit, channels: [edge] };
                }
                if (runEdit(view, index, at)) changed = true;
            }
            return changed;
        };

        /**
         * The rows a 1-D stroke PASSED between the previous pointer event and this
         * one, each with the pointer interpolated to its column — so a fast swipe
         * paints every column it crossed, not only the one under each event.
         * @param {number} x0 @param {number} y0 @param {any} lockSeries @param {string | null} edge
         * @returns {{ index: number, at: { x: number, y: number } }[]}
         */
        const crossed = (x0, y0, lockSeries, edge) => {
            if (twoD) return [];
            const a0 = axis === 'x' ? x0 : y0, a1 = axis === 'x' ? event.x : event.y;
            const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
            if (hi - lo < 1) return [];
            /** @type {{ index: number, at: { x: number, y: number }, c: number }[]} */
            const out = [];
            const seen = new Set();
            for (const m of marks || []) {
                if (!m || m.index == null || m.locked || seen.has(m.index)) continue;
                if (lockSeries !== undefined && m.series !== lockSeries) continue;
                if (edge != null && m.channel != null && m.channel !== edge) continue;
                const c = axis === 'x' ? m.cx : m.cy;
                if (c == null || c < lo || c > hi) continue;
                const t = (c - a0) / ((a1 - a0) || 1);
                const v0 = axis === 'x' ? y0 : x0, v1 = axis === 'x' ? event.y : event.x;
                const v = v0 + (v1 - v0) * t;
                seen.add(m.index);
                out.push({ index: m.index, at: axis === 'x' ? { x: c, y: v } : { x: v, y: c }, c });
            }
            return out.sort((p, q) => (a1 >= a0 ? p.c - q.c : q.c - p.c));
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
            // The nearest EDGE handle wins wherever the press lands — above the band
            // or below it — so a band sweep always paints one edge. (A press outside
            // the catchment used to run both edges' edits and collapse the band.)
            const edged = (marks || []).filter((m) => m && m.channel != null);
            const near = edged.length
                ? nearestNode(edged, event.x, event.y, Infinity, lock)
                : nearestNode(marks, event.x, event.y, threshold, lock);
            const edge = near && near.channel != null ? near.channel : null;
            const index = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index, series: s, channel: edge, lastX: event.x, lastY: event.y });
            if (index != null && paint(index, edge)) changed = true;
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            if (info) { info.activeIndex = null; info.series = null; info.channel = null; info.lastX = null; info.lastY = null; }
            changed = true;
        } else if (event.type === 'drag') {
            // Paint: retarget within the locked series (and edge) each event, so one
            // stroke fills the whole line.
            const info = session.get();
            const lock = info && info.series != null ? info.series : undefined;
            const edge = info && info.channel != null ? info.channel : null;
            // Every column crossed since the last event, then the one under the pointer.
            if (info && info.lastX != null && info.lastY != null) {
                for (const { index: i, at } of crossed(info.lastX, info.lastY, lock, edge)) {
                    if (paint(i, edge, at)) changed = true;
                }
            }
            const index = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index, lastX: event.x, lastY: event.y });
            if (index != null && paint(index, edge)) changed = true;
            changed = true;
        }
        return changed;
    }
};
