// @ts-check
// sweep driver — re-resolves the target every drag event (along the domain axis,
// or in 2D), so one stroke paints each point it crosses. At dragstart it locks the
// nearest series and, on a band, the nearest edge, which it then paints alone.

import { nearestMark, nearestMarkOnAxis, nearestNode, nearestSeries, pickThreshold } from '../pick.js';
import { markCenter } from '../shared.js';

/** @type {import('./index.js').Driver} */
export const sweepDriver = {
    name: 'sweep',
    sessionKeys: ['px', 'py', 'threshold', 'hoverIndex', 'activeIndex', 'series', 'channel', 'lastX', 'lastY'],
    selects: true,
    // The edit's apply is an ordinary per-row write; this driver only finds the row.
    targetsRow: true,
    onEvent({ event, edits, marks, session, runEdit }) {
        const threshold = pickThreshold(edits[0]);
        // One positional channel: sweep along the other axis. Both x and y: 2D.
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
         * The edge a press here locks onto: the tagged handle nearest in 2D, with no
         * distance limit. Null on a mark with untagged handles.
         * @param {any} lockSeries
         * @returns {string | null}
         */
        const edgeAt = (lockSeries) => {
            const edged = (marks || []).filter((m) => m && m.channel != null);
            const near = edged.length
                ? nearestNode(edged, event.x, event.y, Infinity, lockSeries)
                : nearestNode(marks, event.x, event.y, threshold, lockSeries);
            return near && near.channel != null ? near.channel : null;
        };

        /**
         * Run the edits that govern this tick's edge. An edit with no channels runs
         * with the swept channels; one naming several is narrowed to the edge.
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
         * The rows a 1D stroke crossed since the last event, each with the pointer
         * interpolated to its column.
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
                // markCenter, so a bar's rect counts as well as a handle circle.
                const centre = markCenter(m);
                if (!centre) continue;
                const c = axis === 'x' ? centre.cx : centre.cy;
                if (c < lo || c > hi) continue;
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
            // Resolve as a press would (edge included), so hover matches the stroke.
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const lock = s == null ? undefined : s;
            const edge = edgeAt(lock);
            const hit = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: hit, series: s, channel: edge });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            // Lock the nearest line, and on a band the nearest edge.
            const s = nearestSeries(marks, event.x, event.y, threshold);
            const lock = s == null ? undefined : s;
            const edge = edgeAt(lock);
            const index = resolve(lock, edge);
            session.set({ px: event.x, py: event.y, threshold, hoverIndex: index, activeIndex: index, series: s, channel: edge, lastX: event.x, lastY: event.y });
            if (index != null && paint(index, edge)) changed = true;
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            if (info) { info.activeIndex = null; info.series = null; info.channel = null; info.lastX = null; info.lastY = null; }
            changed = true;
        } else if (event.type === 'drag') {
            // Retarget within the locked series (and edge) each event.
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
