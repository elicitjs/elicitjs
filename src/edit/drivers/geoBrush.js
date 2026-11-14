// @ts-check
// geoBrush driver — edge / corner / body editing of a geoRect's
// west/south/east/north. Locks the zone at dragstart, along with the grab lon/lat
// and the starting box so a body move translates. At dragend re-runs the edit
// with `zone: 'canonicalize'`.

import { edgeInsetOf, rectAt } from '../pick.js';
import { boundsFields } from '../geo.js';
import { brushDrag, brushRelease } from './brush.js';
import { invertPoint } from '../../core/projection.js';

/**
 * Classify a grab against a rect node's screen bounds, naming edges
 * geographically (north is the low y).
 * @param {any} node
 * @param {number} px @param {number} py
 * @param {number} edgeInset
 * @param {boolean} move
 * @returns {{ zone: 'corner' | 'edge' | 'body', edges: string[] } | null}
 */
function classifyZone(node, px, py, edgeInset, move) {
    const left = node.x, right = node.x + node.width;
    const top = node.y, bottom = node.y + node.height;

    /** @type {string[]} */
    const edges = [];
    const dl = Math.abs(px - left), dr = Math.abs(px - right);
    if (Math.min(dl, dr) <= edgeInset) edges.push(dl <= dr ? 'west' : 'east');
    const dt = Math.abs(py - top), db = Math.abs(py - bottom);
    if (Math.min(dt, db) <= edgeInset) edges.push(dt <= db ? 'north' : 'south');

    if (edges.length === 2) return { zone: 'corner', edges };
    if (edges.length === 1) return { zone: 'edge', edges };
    if (move) return { zone: 'body', edges: [] };
    return null;
}

/**
 * @param {'corner' | 'edge' | 'body' | null} zone
 * @param {string[]} edges
 * @returns {string}
 */
function cursorForZone(zone, edges) {
    if (zone === 'corner') {
        const nwse = (edges.includes('west') && edges.includes('north'))
            || (edges.includes('east') && edges.includes('south'));
        return nwse ? 'nwse-resize' : 'nesw-resize';
    }
    if (zone === 'edge') return edges[0] === 'west' || edges[0] === 'east' ? 'ew-resize' : 'ns-resize';
    if (zone === 'body') return 'move';
    return 'default';
}

/** @type {import('./index.js').Driver} */
export const geoBrushDriver = {
    name: 'geoBrush',
    options: ['edgeInset', 'move'],
    sessionKeys: ['px', 'py', 'hoverIndex', 'activeIndex', 'zone', 'edges', 'grab', 'box0', 'cursor'],
    selects: true,
    onEvent({ feature, event, edits, marks, data, scales, session, runEdit }) {
        const edit = edits[0];
        const edgeInset = edgeInsetOf(edit);
        const move = /** @type {any} */ (edit).move !== false;
        const projection = /** @type {any} */ (scales).projection || null;
        let changed = false;

        /** @param {number} px @param {number} py */
        const classifyAt = (px, py) => {
            // geoRect emits a transparent `rect` hit node beside its projected ring.
            const hit = rectAt(marks, px, py, edgeInset);
            if (hit == null) return { hit: null, zone: null };
            const node = marks.find((m) => m.index === hit && m.type === 'rect');
            if (!node) return { hit: null, zone: null };
            return { hit, zone: classifyZone(node, px, py, edgeInset, move) };
        };

        if (event.type === 'hover') {
            const { hit, zone } = classifyAt(event.x, event.y);
            session.set({
                px: event.x, py: event.y,
                hoverIndex: hit,
                cursor: cursorForZone(zone ? zone.zone : null, zone ? zone.edges : []),
            });
            changed = true;
        } else if (event.type === 'hoverout') {
            session.clear();
            changed = true;
        } else if (event.type === 'dragstart') {
            const { hit, zone } = classifyAt(event.x, event.y);
            const datum = hit != null ? data[hit] : null;
            const grab = invertPoint(projection, { x: event.x, y: event.y });
            const f = boundsFields((feature && feature.channels) || {});
            session.set({
                px: event.x, py: event.y,
                hoverIndex: hit,
                activeIndex: zone ? hit : null,
                zone: zone ? zone.zone : null,
                edges: zone ? zone.edges : null,
                // A body move translates from this grab point.
                grab,
                box0: datum ? {
                    west: datum[f.west], south: datum[f.south],
                    east: datum[f.east], north: datum[f.north],
                } : null,
                cursor: cursorForZone(zone ? zone.zone : null, zone ? zone.edges : []),
            });
            changed = true;
        } else if (event.type === 'drag') {
            brushDrag(session, event, edit, runEdit);
            changed = true;
        } else if (event.type === 'dragend') {
            const info = brushRelease(session, edit, runEdit);
            if (info) {
                info.zone = null;
                info.edges = null;
                info.grab = null;
                info.box0 = null;
                info.cursor = 'default';
            }
            changed = true;
        }
        return changed;
    },
};
