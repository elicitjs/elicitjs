// @ts-check
// network.js — the network edits:
//   edit.network.connect()   drag from a node's port to another node -> a new link row
//   edit.network.rewire()    drag a link's end onto a node -> that end re-points;
//                            into empty space -> the link is removed
//   edit.network.reverse()   click a link -> its two ends swap
//
// Landing is tested against node geometry from `ctx.nodeBox` / `ctx.nodePorts`.
// A port drop pins that side; a body drop writes `null`. Link columns come from the
// link mark's channels (`ctx.targetChannels` for connect). See .claude/rules/network.md.

import { makeEdit, mintDatum, andWhen } from './shared.js';
import { HANDLE_DEFAULTS } from '../plot/mark.js';
import { pickThreshold, HIT_TOLERANCE } from './pick.js';
import { nodeBoxesOf, boxAt } from '../plot/nodeBox.js';
import { anchorOn, LINK_SIDES } from '../plot/linkRouter.js';
import { roleAllows, portKey } from '../plot/port.js';
import { isDirected, linkRulesOf } from '../core/schema.js';
import { warn } from '../core/dev.js';

/** How near the pointer must come to a node's CENTRE for a drag to land on it, when no mark declares the node's box. */
const CONNECT_THRESHOLD = 28;

/** Half-extent assumed for a node with no declared box — the same as link's. */
const DEFAULT_EXTENT = 12;

/** Pointer travel needed before a release on the starting node makes a loop. */
const LOOP_TRAVEL = 8;

/**
 * The nodes-role table's name, schema, rows and key column.
 * @param {import('../types').EditContext} ctx
 * @returns {{ name: string, table: any, rows: any[], key: string } | null}
 */
function nodesOf(ctx) {
    const spec = /** @type {any} */ (ctx).schemaSpec;
    if (!spec) return null;
    const name = spec.byRole.nodes || spec.primary;
    const table = spec.tables[name];
    if (!table || !table.key) return null;
    return { name, table, rows: (/** @type {any} */ (ctx).tables || {})[name] || [], key: table.key };
}

/**
 * The link columns, from the link mark's channels: `source`/`target` (else the
 * table's two `ref` columns, in order) and `sourceSide`/`targetSide` (only where a
 * channel names a field).
 * @param {import('../types').EditContext} ctx
 * @param {Record<string, any>} channels the link mark's channel map
 * @returns {{ source: string, target: string, sourceSide: string | null, targetSide: string | null } | null}
 */
function linkFieldsOf(ctx, channels) {
    const spec = /** @type {any} */ (ctx).schemaSpec;
    const name = spec && (spec.byRole.links || /** @type {any} */ (ctx).table);
    const table = spec && spec.tables[name];
    if (!table) return null;
    const refs = Object.keys(table.fields).filter((f) => table.fields[f] && table.fields[f].type === 'ref');
    const named = (/** @type {string} */ ch) => (channels[ch] && channels[ch].field != null ? channels[ch].field : null);
    const source = named('source') || refs[0];
    const target = named('target') || refs[1];
    if (!source || !target) return null;
    return { source, target, sourceSide: named('sourceSide'), targetSide: named('targetSide') };
}

/** @param {string} edit */
function warnRefs(edit) {
    warn(
        `${edit}:refs`,
        `edit.network.${edit}() cannot find the link table's endpoint columns. Declare them ` +
        'as references (source: { type: "ref" }, target: { type: "ref" }), or name them on the ' +
        'link mark: channels: { source: { field: … }, target: { field: … } }.'
    );
}

/**
 * Every node's box and allowed sides, from the engine's two rules. `roles` is null
 * for a row when the chart declares no ports at all (every side, both ways) and an
 * empty object when its ports allow nothing.
 * @param {import('../types').EditContext} ctx
 * @param {{ table: any, rows: any[] }} nodes
 */
function nodeGeometry(ctx, nodes) {
    const rule = /** @type {any} */ (ctx).nodeBox || null;
    const portsRule = /** @type {any} */ (ctx).nodePorts || null;
    const boxes = nodeBoxesOf(
        ctx.scales, {}, nodes.table, nodes.rows, rule,
        DEFAULT_EXTENT * 2, DEFAULT_EXTENT * 2, ctx.width || 0, ctx.height || 0
    );
    const roles = nodes.rows.map((row, i) => {
        if (!portsRule || !row) return null;
        return portsRule(row, i, nodes.rows) || {};
    });
    return { boxed: !!rule, ported: !!portsRule, boxes, roles };
}

/**
 * The sides of one node an END may use, or null for "any, sliding".
 * @param {Record<string, string> | null} roles
 * @param {'source' | 'target'} end
 * @returns {string[] | null}
 */
function allowedSides(roles, end) {
    if (!roles) return null;
    return LINK_SIDES.filter((s) => roleAllows(/** @type {any} */ (roles[s]), end));
}

/**
 * The node a link end would land on and its side: an allowed port, else a node's
 * body, else (no box declared) the node whose centre is within `threshold`.
 * @param {import('../types').EditContext} ctx
 * @param {{ name: string, table: any, rows: any[] }} nodes
 * @param {'source' | 'target'} end which end is being placed
 * @param {number | null} exclude a row that may not be chosen (the other end's node, with no self-loops)
 * @param {{ index: number, side: string | null, body: boolean } | null} [self] the node a
 *   loop would return to: its starting port never lands, its body only when `body` is set
 * @returns {{ row: any, index: number, side: string | null } | null}
 */
function landingOf(ctx, nodes, end, exclude, self = null) {
    const geo = nodeGeometry(ctx, nodes);
    const p = ctx.pointer;
    const bodyOff = (/** @type {number} */ i) => i === exclude || (!!self && i === self.index && !self.body);
    /** @type {{ row: any, index: number, side: string | null } | null} */
    let best = null;
    let bestDist = Infinity;
    // A port first, at the radius the ports are drawn with.
    if (geo.ported) {
        const reach = HANDLE_DEFAULTS.size + HIT_TOLERANCE;
        geo.boxes.forEach((box, i) => {
            if (!box || i === exclude) return;
            for (const side of allowedSides(geo.roles[i], end) || []) {
                if (self && i === self.index && side === self.side) continue;
                const at = anchorOn(box, side, 0, 0);
                const d = Math.hypot(at.x - p.x, at.y - p.y);
                if (d <= reach && d < bestDist) { bestDist = d; best = { row: nodes.rows[i], index: i, side }; }
            }
        });
        if (best) return best;
    }
    // Then a body. A node whose ports allow this end nowhere is skipped.
    if (geo.boxed) {
        const inside = boxAt(p, nodes.rows, (_, i) => geo.boxes[i], {
            accepts: (i) => {
                if (bodyOff(i)) return false;
                const sides = allowedSides(geo.roles[i], end);
                return !(sides && !sides.length);
            },
        });
        if (inside !== null) return { row: nodes.rows[inside], index: inside, side: null };
    }
    // A dot network with no box: the centre within reach.
    const threshold = pickThreshold(ctx.edit, CONNECT_THRESHOLD);
    geo.boxes.forEach((box, i) => {
        if (!box || bodyOff(i)) return;
        const sides = allowedSides(geo.roles[i], end);
        if (sides && !sides.length) return;
        const d = Math.hypot(box.cx - p.x, box.cy - p.y);
        if (d <= threshold && d < bestDist) {
            bestDist = d;
            best = { row: nodes.rows[i], index: i, side: null };
        }
    });
    return best;
}

/**
 * The ports a drop for this end could land on, as `{ x, y, key }`, for the engine
 * to probe (`Edit.targets`). Null when the chart has no ports.
 * @param {import('../types').EditContext} ctx
 * @param {'source' | 'target'} end
 * @returns {{ x: number, y: number, key: string }[] | null}
 */
function portTargets(ctx, end) {
    const nodes = nodesOf(ctx);
    if (!nodes) return null;
    const geo = nodeGeometry(ctx, nodes);
    if (!geo.ported) return null;
    /** @type {{ x: number, y: number, key: string }[]} */
    const out = [];
    geo.boxes.forEach((box, i) => {
        if (!box) return;
        for (const side of allowedSides(geo.roles[i], end) || []) {
            const at = anchorOn(box, side, 0, 0);
            out.push({ x: at.x, y: at.y, key: portKey(nodes.name, i, side) });
        }
    });
    return out;
}

/**
 * Whether a→b would be a disallowed parallel link: false when `multi: true`, else
 * whether the pair already exists (either way round when undirected). `skip` is
 * the row being rewired.
 * @param {import('../types').EditContext} ctx
 * @param {{ source: string, target: string }} fields
 * @param {any} a @param {any} b @param {number | null} skip
 */
function linked(ctx, fields, a, b, skip) {
    const spec = /** @type {any} */ (ctx).schemaSpec;
    if (linkRulesOf(spec).multi) return false;
    const undirected = isDirected(spec) === false;
    return ctx.data.some((d, i) => {
        if (!d || i === skip) return false;
        if (d[fields.source] === a && d[fields.target] === b) return true;
        return undirected && d[fields.source] === b && d[fields.target] === a;
    });
}

/**
 * connect — drag from a node's port to another node to create a link.
 *
 * Goes on a node mark's `ports` channel: `ports: { value: …, edit:
 * edit.network.connect() }`. Direct-pick, claimed by the connect driver. Writes a
 * row to the `links` role table. Parallel links need `multi: true`; self-loops
 * need `selfLoops: true`.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function connect(options = {}) {
    const { defaults = {}, threshold, ...rest } = options;
    return makeEdit({
        type: 'network.connect',
        gesture: 'drag',
        pick: 'direct',
        table: 'links',
        cardinality: 'append',
        threshold: threshold != null ? threshold : CONNECT_THRESHOLD,
        ...rest,
        targets: (/** @type {import('../types').EditContext} */ ctx) => portTargets(ctx, 'target'),
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const nodes = nodesOf(ctx);
            const session = /** @type {any} */ (ctx).session;
            if (!nodes || !session || session.fromIndex == null) return undefined;
            const fields = linkFieldsOf(ctx, /** @type {any} */ (ctx).targetChannels || {});
            if (!fields) { warnRefs('connect'); return undefined; }

            const from = nodes.rows[session.fromIndex];
            if (!from) return undefined;
            const fromId = from[nodes.key];
            if (fromId == null) return undefined;
            // Nothing from a port a link may not leave by.
            const portsRule = /** @type {any} */ (ctx).nodePorts;
            if (portsRule) {
                const roles = portsRule(from, session.fromIndex, nodes.rows) || {};
                const sides = allowedSides(roles, 'source') || [];
                if (session.fromSide != null ? !sides.includes(session.fromSide) : !sides.length) return undefined;
            }
            /** @param {string | null} toSide */
            const sideSeed = (toSide) => ({
                ...(fields.sourceSide ? { [fields.sourceSide]: session.fromSide != null ? session.fromSide : null } : {}),
                ...(fields.targetSide ? { [fields.targetSide]: toSide } : {}),
            });
            // Preview only: a link with no target yet, its free end at the pointer.
            const dangling = () => {
                if (!ctx.preview) return undefined;
                const datum = mintDatum(ctx, {
                    defaults,
                    seed: { [fields.source]: fromId, [fields.target]: null, ...sideSeed(null) },
                });
                return datum ? [...ctx.data, datum] : undefined;
            };

            const loops = linkRulesOf(/** @type {any} */ (ctx).schemaSpec).selfLoops;
            const start = session.fromPoint;
            const travelled = !start || Math.hypot(ctx.pointer.x - start.x, ctx.pointer.y - start.y) >= LOOP_TRAVEL;
            const to = loops
                ? landingOf(ctx, nodes, 'target', null, { index: session.fromIndex, side: session.fromSide, body: travelled })
                : landingOf(ctx, nodes, 'target', session.fromIndex);
            if (!to) return dangling();
            const toId = to.row[nodes.key];
            if (toId == null) return dangling();
            if (linked(ctx, fields, fromId, toId, null)) return dangling();

            const datum = mintDatum(ctx, {
                defaults,
                seed: { [fields.source]: fromId, [fields.target]: toId, ...sideSeed(to.side) },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}

/**
 * rewire — drag a link's end to reconnect it, or into empty space to remove it.
 *
 * Goes in a `link` mark's `edits`; each end handle is tagged with its end.
 * `rewire({ channels: ['target'] })` limits it to one end. A port drop pins that
 * side; a body drop writes a null side.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function rewire(options = {}) {
    const { threshold, when: userWhen, channel, channels, ...rest } = options;
    const endsAllowed = channel ? [channel] : Array.isArray(channels) ? channels : ['source', 'target'];
    /** @param {import('../types').EditContext} ctx @returns {'source' | 'target' | null} */
    const endOf = (ctx) => {
        const tag = ctx.node && ctx.node.channel;
        return tag === 'source' || tag === 'target' ? tag : null;
    };
    return makeEdit({
        type: 'network.rewire',
        gesture: 'drag',
        pick: 'direct',
        scope: 'network',
        threshold: threshold != null ? threshold : CONNECT_THRESHOLD,
        ...rest,
        channels: endsAllowed,
        // Only an end handle, not the link body.
        when: andWhen((ctx) => {
            const end = endOf(ctx);
            return !!end && endsAllowed.includes(end);
        }, userWhen),
        // Ports the moved end could land on, excluding the other end's node
        // (a drop there removes the link).
        targets: (/** @type {import('../types').EditContext} */ ctx) => {
            const end = endOf(ctx);
            const nodes = nodesOf(ctx);
            const places = end ? portTargets(ctx, end) : null;
            if (!places || !nodes || !ctx.datum) return places;
            // With loops allowed, the other end's node IS a place to land: a loop.
            if (linkRulesOf(/** @type {any} */ (ctx).schemaSpec).selfLoops) return places;
            const fields = linkFieldsOf(ctx, ctx.markChannels || {});
            const otherId = fields && ctx.datum[end === 'source' ? fields.target : fields.source];
            const other = nodes.rows.findIndex((r) => r && r[nodes.key] === otherId);
            return places.filter((t) => !t.key.startsWith(portKey(nodes.name, other, '')));
        },
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const nodes = nodesOf(ctx);
            const end = endOf(ctx);
            if (!nodes || !end || ctx.index == null || !ctx.datum) return undefined;
            const fields = linkFieldsOf(ctx, ctx.markChannels || {});
            if (!fields) { warnRefs('rewire'); return undefined; }
            const field = end === 'source' ? fields.source : fields.target;
            const sideField = end === 'source' ? fields.sourceSide : fields.targetSide;
            const otherId = ctx.datum[end === 'source' ? fields.target : fields.source];
            const otherIndex = nodes.rows.findIndex((r) => r && r[nodes.key] === otherId);

            const loops = linkRulesOf(/** @type {any} */ (ctx).schemaSpec).selfLoops;
            const to = landingOf(ctx, nodes, end, !loops && otherIndex >= 0 ? otherIndex : null);
            if (!to || to.row[nodes.key] == null) {
                // Off every node: preview follows the pointer; commit removes the link.
                if (ctx.preview) return { ...ctx.datum, [field]: null };
                return ctx.data.filter((_, i) => i !== ctx.index);
            }
            const toId = to.row[nodes.key];
            const sameSide = !sideField || ctx.datum[sideField] === to.side;
            if (ctx.datum[field] === toId && sameSide) return undefined;
            const pair = end === 'source' ? [toId, otherId] : [otherId, toId];
            if (ctx.datum[field] !== toId && linked(ctx, fields, pair[0], pair[1], ctx.index)) return undefined;
            return {
                ...ctx.datum,
                [field]: toId,
                ...(sideField ? { [sideField]: to.side } : {}),
            };
        },
    });
}

/**
 * reverse — click a link to swap its two ends. Goes on the `link` mark.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function reverse(options = {}) {
    return makeEdit({
        type: 'network.reverse',
        gesture: 'click',
        pick: 'direct',
        scope: 'network',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum) return undefined;
            const fields = linkFieldsOf(ctx, ctx.markChannels || {});
            if (!fields) { warnRefs('reverse'); return undefined; }
            // Undirected: swapping has no visible effect, so warn instead.
            if (isDirected(/** @type {any} */ (ctx).schemaSpec) === false) {
                warn(
                    'reverse:undirected',
                    'edit.network.reverse() is on a links table declared directed: false, ' +
                    'where source and target name the same relationship either way round — ' +
                    'so swapping them has no visible effect. Declare directed: true, or drop ' +
                    'the edit.'
                );
                return undefined;
            }
            return {
                ...ctx.datum,
                [fields.source]: ctx.datum[fields.target],
                [fields.target]: ctx.datum[fields.source],
            };
        },
    });
}
