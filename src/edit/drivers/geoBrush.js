// @ts-check
// geoBrush driver — the geographic sibling of brushRect: edge / corner / body
// editing of a geoRect's west/south/east/north.
//
// Why a driver and not a per-tick classification: the zone MUST be decided once,
// at dragstart, and locked for the gesture. Classifying every tick against the
// rendered AABB looks equivalent but isn't — as the pointer travels it drifts
// near the box's *other* edges and the zone silently flips (a body move turns
// into a corner resize halfway through the drag). Same lesson as brush.js /
// brushRect.js; see the `zone` lock they keep in the feature's session.
//
// The session also latches the grab anchor (pointer lon/lat) and the box as it
// stood at dragstart, so a body move TRANSLATES by the geographic delta instead
// of teleporting its center onto the pointer.
//
// At dragend the edit is re-invoked once with zone 'canonicalize' to swap any
// pair the drag inverted (dragging the west edge past the east one) — a one-time
// data cleanup, invisible because the mark already draws min/max.

import { edgeInsetOf } from '../pick.js';
import { invertPoint } from '../../core/projection.js';

/**
 * The topmost geoRect hit-node containing the pointer (grown by `inset`),
 * addressed by its datum index. geoRect emits a transparent `rect` as the
 * hit-target alongside the projected ring path.
 * @param {any[]} marks
 * @param {number} px @param {number} py
 * @param {number} inset
 * @returns {number | null}
 */
function hitRect(marks, px, py, inset) {
    /** @type {number | null} */
    let hit = null;
    (marks || []).forEach((m) => {
        if (m.type !== 'rect' || m.index == null || m.width == null) return;
        if (px >= m.x - inset && px <= m.x + m.width + inset
            && py >= m.y - inset && py <= m.y + m.height + inset) {
            hit = m.index; // last match wins: drawn on top
        }
    });
    return hit;
}

/**
 * Classify a grab against a rect node's rendered bounds. Edge names are
 * geographic (west/east/south/north); the node's AABB is screen space, where
 * north is the LOW y (a projection flips latitude).
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

/**
 * Field names for the four extents, read off the mark's channels.
 * @param {any} feature
 * @returns {{ west: string, south: string, east: string, north: string }}
 */
function boundsFields(feature) {
    const ch = (feature && feature.channels) || {};
    return {
        west: (ch.west && ch.west.field) || 'west',
        south: (ch.south && ch.south.field) || 'south',
        east: (ch.east && ch.east.field) || 'east',
        north: (ch.north && ch.north.field) || 'north',
    };
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
            const hit = hitRect(marks, px, py, edgeInset);
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
            const f = boundsFields(feature);
            session.set({
                px: event.x, py: event.y,
                hoverIndex: hit,
                activeIndex: zone ? hit : null,
                zone: zone ? zone.zone : null,
                edges: zone ? zone.edges : null,
                // Latched at dragstart: a body move is a translation from HERE.
                grab,
                box0: datum ? {
                    west: datum[f.west], south: datum[f.south],
                    east: datum[f.east], north: datum[f.north],
                } : null,
                cursor: cursorForZone(zone ? zone.zone : null, zone ? zone.edges : []),
            });
            changed = true;
        } else if (event.type === 'drag') {
            const info = session.get();
            if (info) { info.px = event.x; info.py = event.y; }
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                if (runEdit(edit, index)) changed = true;
            }
            changed = true;
        } else if (event.type === 'dragend') {
            const info = session.get();
            const index = info ? info.activeIndex : null;
            if (index != null && info && info.zone) {
                // One-time cleanup tick: un-invert any pair the drag crossed.
                info.zone = 'canonicalize';
                runEdit(edit, index);
            }
            if (info) {
                info.activeIndex = null;
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
