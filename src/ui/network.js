// @ts-check
import { warn } from '../core/dev.js';
import { UI_OPTIONS } from '../vocabulary.js';
import { findEdit, rootOf, rowsIn, valueOf } from './bind.js';
import { driveStroke } from './stroke.js';
import { hoverGroup } from './hover.js';
import { contextMenu } from './parts/contextMenu.js';
import { handles } from './parts/handles.js';
import { warnUnknownUiOptions } from './guard.js';

// How far from a port a link's end may sit and still be docked there, in pixels:
// several ends at one port spread out along the node's edge.
const DOCKED = 16;
// How near a port the pointer must come for its icons, in pixels: under half a
// small node's height, so the middle of a node is near no port.
const PORT_REACH = 14;
// How near a link, in pixels.
const LINK_REACH = 8;
// The clear space left between a node and the one "+" adds beside it, in pixels.
const SPAWN_GAP = 56;
// The least space between that new node and any other, in pixels.
const SPAWN_CLEAR = 8;
const OUTWARD = /** @type {Record<string, { x: number, y: number }>} */ ({
    top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
});

/**
 * The tables a network dataset names for its nodes and its links.
 * @param {import('../types').Chart} chart
 * @returns {{ nodes: string | null, links: string | null }}
 */
function rolesOf(chart) {
    const schema = /** @type {any} */ (chart.getSchema());
    const tables = (schema && schema.tables) || {};
    /** @type {{ nodes: string | null, links: string | null }} */
    const out = { nodes: null, links: null };
    for (const name of Object.keys(tables)) {
        // A table states its role, or takes it from its name.
        const role = (tables[name] && tables[name].role) || name;
        if (role === 'nodes') out.nodes = name;
        if (role === 'links') out.links = name;
    }
    return out;
}

/**
 * The UI a node-link chart needs, built from the edits its spec names:
 *
 * - beside a port, "+" adds a new node on that side, linked to this one; a link
 *   icon connects to a node that is already there (drag it, or click and then
 *   click the node); and at a port that holds a link, a third icon detaches it;
 * - on a link, icons to reverse and to remove it;
 * - a right-click menu: add a node (of a chosen category) on empty space, a
 *   node's category and Remove on a node, Reverse and Remove on a link;
 * - grips to resize a node whose width or height is data.
 *
 * Each piece appears only where the spec declares the edit behind it.
 * @param {import('../types').NetworkOptions} [options]
 * @returns {import('../types').UiPart}
 */
export function network(options = {}) {
    warnUnknownUiOptions('network', options, UI_OPTIONS.network);
    const { ports = true, links = true, menu = true, resize = true, edits: names = {} } = options;
    return {
        type: 'network',
        mount(ctx) {
            const { chart } = ctx;
            const roles = rolesOf(chart);
            if (!roles.nodes || !roles.links) {
                warn('ui:network:structure', 'ui.network: this chart\'s dataset is not a network (structure: "network" with a nodes and a links table), so there is nothing to attach to.');
                return () => {};
            }
            // The edits, by what they do: the author's name, else the declared capability.
            /** @param {keyof NonNullable<import('../types').NetworkOptions['edits']>} key @param {(e: import('../types').EditInfo) => boolean} where */
            const edit = (key, where) => findEdit(chart, 'network', { name: names[key], where });
            const connect = edit('connect', (e) => e.type === 'network.connect');
            const rewire = edit('rewire', (e) => e.type === 'network.rewire');
            const reverse = edit('reverse', (e) => e.type === 'network.reverse');
            const unlink = edit('unlink', (e) => e.cardinality === 'delete' && e.table === roles.links && e.pick === 'direct');
            const remove = edit('remove', (e) => e.cardinality === 'delete' && e.table === roles.nodes && e.pick === 'direct');
            const create = edit('create', (e) => e.cardinality === 'append' && e.table === roles.nodes && e.pick !== 'direct' && e.type !== 'network.connect');

            // The mark that draws the nodes.
            const nodePiece = chart.scene({ table: roles.nodes }).find((v) => v.index != null && v.channel == null);
            const nodeMark = connect ? rootOf(connect.mark) : nodePiece ? rootOf(nodePiece.mark) : null;

            /** @type {(() => void)[]} */
            const offs = [];
            /** @param {import('../types').UiPart} part */
            const add = (part) => { const off = part.mount(ctx); if (typeof off === 'function') offs.push(off); };

            // The channel a node's category is chosen on: the one asked for, else a discrete fill.
            const asked = typeof menu === 'object' && menu.channel != null ? menu.channel : null;
            const fill = nodeMark ? chart.scale(asked || 'fill', { mark: nodeMark }) : null;
            const channel = asked || (fill && fill.field != null && fill.kind && fill.kind !== 'continuous' && fill.domain && fill.domain.length ? 'fill' : null);
            const category = channel && nodeMark && fill && fill.field != null ? { channel, mark: nodeMark } : null;

            const showPorts = ports && !!(connect || rewire || unlink);
            const showLinks = links && !!(reverse || unlink);
            if (showPorts || showLinks) {
                offs.push(mountIcons(ctx, {
                    roles, nodeMark, category,
                    connect: showPorts ? connect : null,
                    rewire: showPorts ? rewire : null,
                    create: showPorts ? create : null,
                    unlink, reverse, showPorts, showLinks,
                }));
            }

            if (menu) {
                if (asked && !(fill && fill.field != null)) {
                    warn(`ui:network:channel:${asked}`, `ui.network: the node mark binds no field on its "${asked}" channel, so the menu offers no categories.`);
                }
                /** @type {import('../types').MenuEntry[]} */
                const entries = [
                    ...(create && create.name ? [category ? { edit: create.name, ...category, label: 'Add' } : { edit: create.name, label: 'Add node' }] : []),
                    ...(category ? [category] : []),
                    { separator: true },
                    ...(reverse && reverse.name ? [{ edit: reverse.name, label: 'Reverse', icon: 'swap' }] : []),
                    ...(unlink && unlink.name ? [{ edit: unlink.name, label: 'Remove link' }] : []),
                    ...(remove && remove.name ? [{ edit: remove.name, label: 'Remove' }] : []),
                ];
                if (entries.length > 1) add(contextMenu({ items: entries }));
            }

            if (resize && nodeMark && (chart.scale('width', { mark: nodeMark }) || chart.scale('height', { mark: nodeMark }))) {
                add(handles({ on: { mark: nodeMark }, resize: true }));
            }

            return () => { offs.splice(0).forEach((off) => off()); };
        },
    };
}

/**
 * The icons beside a port and on a link: one set at a time, the port's first.
 *
 * At a port: "+" adds a node on that side, linked from this one; the link icon
 * connects to a node already there; detach shows where a link is docked.
 * On a link: reverse and remove.
 * @param {import('../types').UiContext} ctx
 * @param {{
 *   roles: { nodes: string | null, links: string | null },
 *   nodeMark: string | null,
 *   category: { channel: string, mark: string } | null,
 *   connect: import('../types').EditInfo | null,
 *   rewire: import('../types').EditInfo | null,
 *   create: import('../types').EditInfo | null,
 *   unlink: import('../types').EditInfo | null,
 *   reverse: import('../types').EditInfo | null,
 *   showPorts: boolean,
 *   showLinks: boolean,
 * }} found
 * @returns {() => void}
 */
function mountIcons(ctx, found) {
    const { chart } = ctx;
    const { roles, nodeMark, category, connect, rewire, create, unlink, reverse, showPorts, showLinks } = found;
    const nodes = /** @type {string} */ (roles.nodes);
    const linksTable = /** @type {string} */ (roles.links);
    const gap = chart.theme.ui.gap;
    const nameOf = (/** @type {import('../types').EditInfo | null} */ e) => (e && e.name != null ? e.name : null);
    const connectName = nameOf(connect), rewireName = nameOf(rewire), createName = nameOf(create);
    const unlinkName = nameOf(unlink), reverseName = nameOf(reverse);
    // Any named edit on the link mark, to light a link with.
    const linkLighter = unlinkName || reverseName || rewireName;

    /** @typedef {{ kind: 'port', view: import('../types').SceneView } | { kind: 'link', view: import('../types').SceneView, at: import('../types').Point }} Target */

    const samePort = (/** @type {any} */ a, /** @type {any} */ b) => !!a && !!b && a.mark === b.mark && a.index === b.index && a.side === b.side;
    const portsNow = () => chart.scene({ table: nodes, channel: 'port' }).filter((p) => p.index != null && p.center);
    // The link ends docked at a port: those it is the nearest port to.
    /** @param {import('../types').SceneView} port */
    const dockedAt = (port) => {
        const all = portsNow();
        return chart.scene({ table: linksTable }).filter((v) => {
            if ((v.channel !== 'source' && v.channel !== 'target') || v.index == null || !v.center) return false;
            const c = v.center;
            let nearest = null;
            let best = Infinity;
            for (const p of all) {
                const d = Math.hypot(c.x - /** @type {any} */ (p.center).x, c.y - /** @type {any} */ (p.center).y);
                if (d < best) { best = d; nearest = p; }
            }
            return best <= DOCKED && samePort(nearest, port);
        });
    };

    // A node's box: the largest piece its mark draws for the row.
    /** @param {number} index */
    const boxOf = (index) => {
        const boxes = chart.scene({ table: nodes, index }).filter((v) => v.box && v.channel == null)
            .map((v) => /** @type {import('../types').Box} */ (v.box));
        return boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
    };
    // Is a node drawn at this point?
    /** @param {import('../types').Point} p */
    const nodeAt = (p) => { const v = chart.hit(p, { reach: 6 }); return !!v && v.table === nodes; };
    // Every node's box, to keep a new one clear of them.
    const allBoxes = () => {
        /** @type {Map<number, import('../types').Box>} */
        const byRow = new Map();
        for (const v of chart.scene({ table: nodes })) {
            if (v.index == null || !v.box || v.channel != null) continue;
            const had = byRow.get(v.index);
            if (!had || v.box.width * v.box.height > had.width * had.height) byRow.set(v.index, v.box);
        }
        return [...byRow.values()];
    };

    // Where a new node goes beside a port: one gap out from that side, kept
    // inside the plot, and moved along the side until it overlaps no node.
    /** @param {import('../types').SceneView} port */
    const spotBeside = (port) => {
        const out = OUTWARD[/** @type {string} */ (port.side)] || OUTWARD.right;
        const box = boxOf(/** @type {number} */ (port.index)) || { x: 0, y: 0, width: 80, height: 40 };
        const c = /** @type {import('../types').Point} */ (port.center);
        const along = out.x ? box.width : box.height;
        const across = out.x ? box.height : box.width;
        const m = chart.metrics();
        const hw = box.width / 2, hh = box.height / 2;
        // The new node is the size of this one: keep its whole box in the plot.
        const fit = (/** @type {import('../types').Point} */ p) => ({
            x: Math.max(hw, Math.min(m.innerWidth - hw, p.x)),
            y: Math.max(hh, Math.min(m.innerHeight - hh, p.y)),
        });
        const others = allBoxes();
        const free = (/** @type {import('../types').Point} */ p) => others.every((b) => p.x + hw + SPAWN_CLEAR <= b.x || b.x + b.width + SPAWN_CLEAR <= p.x - hw
            || p.y + hh + SPAWN_CLEAR <= b.y || b.y + b.height + SPAWN_CLEAR <= p.y - hh);
        const base = { x: c.x + out.x * (SPAWN_GAP + along / 2), y: c.y + out.y * (SPAWN_GAP + along / 2) };
        // Nearest first: straight out, then stepped across the side (down or up
        // for a left/right port, sideways for a top/bottom one), then a row further out.
        for (const far of [0, 1, 2]) {
            for (const k of [0, 1, -1, 2, -2, 3, -3]) {
                const further = far * (along + SPAWN_CLEAR * 2);
                const step = k * (across + SPAWN_CLEAR * 2);
                const p = fit({
                    x: base.x + out.x * further + (out.x ? 0 : step),
                    y: base.y + out.y * further + (out.x ? step : 0),
                });
                if (free(p)) return p;
            }
        }
        return fit(base);
    };

    // Add a node and link this port to it, as one undo step. The new node is
    // like the one it grows from: same category, same size.
    /** @param {import('../types').SceneView} port @param {import('../types').Point} [at] */
    const spawn = (port, at) => {
        if (!createName || !connectName || !create || port.index == null) return;
        const from = port.index;
        const side = /** @type {string} */ (port.side);
        const spot = at || spotBeside(port);
        const linksBefore = rowsIn(chart, linksTable).length;
        const end = chart.transaction();
        let linked = false;
        try {
            const before = rowsIn(chart, nodes).length;
            chart.control(createName).emit({ type: create.gesture, x: spot.x, y: spot.y });
            if (rowsIn(chart, nodes).length !== before + 1) return;
            if (nodeMark) {
                for (const ch of [category ? category.channel : null, 'width', 'height']) {
                    if (!ch || !chart.scale(ch, { mark: nodeMark })) continue;
                    const v = valueOf(chart, 'network', { mark: nodeMark, channel: ch });
                    if (v && v.read(from) != null) v.write(before, v.read(from));
                }
            }
            // Land on the new node's port nearest this one (the facing side, when
            // the node sits straight out), else on its body.
            const here = port.center || spot;
            const facing = chart.scene({ table: nodes, index: before, channel: 'port' })
                .filter((p) => p.center)
                .sort((a, b) => Math.hypot(/** @type {any} */ (a.center).x - here.x, /** @type {any} */ (a.center).y - here.y)
                    - Math.hypot(/** @type {any} */ (b.center).x - here.x, /** @type {any} */ (b.center).y - here.y))[0];
            const body = boxOf(before);
            const to = facing && facing.center ? facing.center
                : body ? { x: body.x + body.width / 2, y: body.y + body.height / 2 } : spot;
            const c = chart.control(connectName, { index: from, channel: 'port', side });
            c.begin();
            c.emit({ type: 'drag', x: to.x, y: to.y });
            c.end();
            linked = rowsIn(chart, linksTable).length === linksBefore + 1;
        } finally { end(); }
        // A node the link could not reach is not what was asked for: take it back.
        if (!linked && chart.canUndo()) {
            chart.undo();
            warn('ui:network:spawn', 'ui.network: "+" added a node but the link to it was refused (a constraint, or a port that only takes incoming links), so the node was removed again.');
        }
    };

    const group = hoverGroup(ctx, {
        /** @returns {Target | null} */
        find(point) {
            if (showPorts) {
                /** @type {import('../types').SceneView | null} */
                let near = null;
                let best = Infinity;
                for (const v of portsNow()) {
                    const d = Math.hypot(point.x - /** @type {any} */ (v.center).x, point.y - /** @type {any} */ (v.center).y);
                    if (d < best) { best = d; near = v; }
                }
                if (near && best <= PORT_REACH) return { kind: 'port', view: near };
            }
            if (showLinks) {
                const under = chart.hit(point, { reach: LINK_REACH });
                if (under && under.table === linksTable && under.index != null) return { kind: 'link', view: under, at: point };
            }
            return null;
        },
        same: (a, b) => a.kind === b.kind && (a.kind === 'port' ? samePort(a.view, b.view) : a.view.index === b.view.index),
        // A port's icons go outward from it. A link's sit where the pointer met it.
        anchor(t) {
            if (t.kind === 'link') return t.at;
            const p = chart.scene({ mark: t.view.mark, index: /** @type {number} */ (t.view.index), channel: 'port', side: /** @type {string} */ (t.view.side) })[0];
            return p ? p.center : null;
        },
        placement(t) {
            if (t.kind === 'port') return { at: /** @type {any} */ (t.view.side), offset: gap + 6 };
            // Off the link's line: out along its normal, on the upper side.
            const far = gap + 6 + chart.theme.ui.size / 2;
            const ends = chart.scene({ mark: t.view.mark, index: /** @type {number} */ (t.view.index) })
                .filter((v) => (v.channel === 'source' || v.channel === 'target') && v.center);
            if (ends.length < 2) return { at: 'top', offset: gap + 6 };
            const a = /** @type {import('../types').Point} */ (ends[0].center), b = /** @type {import('../types').Point} */ (ends[1].center);
            const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
            let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
            if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
            return { at: 'center', dx: Math.round(nx * far), dy: Math.round(ny * far) };
        },
        // Mark what the icons belong to, as the chart marks a hovered piece.
        light(t, lit) {
            const type = lit ? 'pointerover' : 'pointerout';
            if (t.view.index == null) return;
            if (t.kind === 'port' && connectName) chart.control(connectName, { index: t.view.index, channel: 'port', side: t.view.side }).emit({ type });
            if (t.kind === 'link' && linkLighter) chart.control(linkLighter, t.view.index).emit({ type });
        },
        build(t, add, onClear) {
            const stroke = { onStart: () => group.busy(true), onDone: () => { group.busy(false); group.show(null); } };
            if (t.kind === 'link') {
                const index = /** @type {number} */ (t.view.index);
                if (reverseName) {
                    const btn = ctx.button({ icon: 'swap', label: 'Reverse link' });
                    btn.addEventListener('click', () => { group.show(null); chart.control(reverseName, index).fire(); });
                    add(btn);
                }
                if (unlinkName) {
                    const btn = ctx.button({ icon: 'trash', label: 'Remove link', tone: 'danger' });
                    btn.addEventListener('click', () => { group.show(null); chart.control(unlinkName, index).fire(); });
                    add(btn);
                }
                return;
            }

            const port = t.view;
            const index = /** @type {number} */ (port.index);
            const side = /** @type {string} */ (port.side);
            const here = connect && connectName
                ? chart.edits({ mark: connect.mark, index, channel: 'port', side }).find((e) => e.name === connectName) || null
                : null;

            // "+": a new node on this side, linked from here. Dragged, it draws a
            // link instead, and makes the node where the link is dropped on nothing.
            if (here && connectName && createName) {
                const btn = ctx.button({ icon: 'plus', label: 'Add a linked node' });
                /** @type {import('../types').EditControl | null} */
                let live = null;
                let linksBefore = 0;
                onClear(ctx.drag(btn, {
                    click: () => { group.show(null); spawn(port); },
                    start: ({ point }) => {
                        group.busy(true);
                        linksBefore = rowsIn(chart, linksTable).length;
                        live = chart.control(connectName, { index, channel: 'port', side });
                        live.begin(point);
                    },
                    move: ({ point }) => { if (live) live.emit({ type: 'drag', x: point.x, y: point.y }); },
                    end: ({ point }) => {
                        const c = live;
                        live = null;
                        if (c) { c.emit({ type: 'drag', x: point.x, y: point.y }); c.end(); }
                        group.busy(false);
                        group.show(null);
                        if (rowsIn(chart, linksTable).length === linksBefore && !nodeAt(point)) spawn(port, point);
                    },
                    cancel: () => { if (live) live.cancel(); live = null; group.busy(false); group.show(null); },
                }));
                add(btn);
            }

            // Link: to a node that is already there.
            if (here && here.available && connectName) {
                const btn = ctx.button({ icon: 'link', label: 'Link to a node' });
                onClear(driveStroke(ctx, btn, connectName, () => ({ index, channel: 'port', side }), stroke));
                add(btn);
            }

            // Detach: drag re-points the docked end, a click removes the link.
            const docked = dockedAt(port);
            if (docked.length && (rewireName || unlinkName)) {
                const btn = ctx.button({ icon: 'unlink', label: docked.length > 1 ? 'Detach a link' : 'Detach link' });
                const first = docked[0];
                /** @param {import('../types').SceneView} end */
                const removeLink = (end) => { if (unlinkName && end.index != null) chart.control(unlinkName, end.index).fire(); };
                // With several links here, say which.
                const choose = () => {
                    const rows = rowsIn(chart, linksTable);
                    ctx.menu(docked.map((end) => {
                        const row = /** @type {any} */ (rows[/** @type {number} */ (end.index)] || {});
                        const other = end.channel === 'source' ? row.target : row.source;
                        return { label: `Remove link ${end.channel === 'source' ? 'to' : 'from'} ${other != null ? other : '?'}`, tone: /** @type {const} */ ('danger'), onSelect: () => removeLink(end) };
                    }), port.center || { x: 0, y: 0 });
                };
                const click = () => { group.show(null); if (docked.length > 1) choose(); else removeLink(first); };
                if (rewireName) {
                    onClear(driveStroke(ctx, btn, rewireName, () => ({ index: first.index, channel: first.channel }), stroke));
                    // A click removes when the spec lets a link be removed; else it arms the re-point.
                    if (unlinkName) btn.addEventListener('click', (e) => { e.stopImmediatePropagation(); click(); }, true);
                } else {
                    btn.addEventListener('click', click);
                }
                add(btn);
            }
        },
    });

    return () => group.dispose();
}
