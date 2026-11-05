// @ts-check
// network.js — the NETWORK-scoped edits: the two gestures that build a network's
// topology and that nothing general could express.
//
//   edit.network.connect()   drag from a node's port to another node -> a new link row
//   edit.network.rewire()    drag a link's end onto a node -> that end re-points;
//                            into empty space -> the link is removed
//   edit.network.reverse()   click a link -> its two ends swap
//
// Everything else a diagram editor needs is already universal, and stays that way:
// `create` mints a node — with an identity, because the node table declares a `key`
// (see mintDatum) — `move` drags one and the links re-derive on the next render,
// `editText` writes a node's or a link's content, and `remove` deletes, the engine
// dropping the links a deleted node stranded because `type: 'ref'` declared that
// rule (see enforceRefs).
//
// ── Two rules, from the marks that draw the nodes ──────────────────────────
// Where a node's edges are and which of them a link may use are statements the
// NODE mark makes: its box (`Mark.nodeBox`) and its `ports` channel. The engine
// hands both to every edit as rules over the node table (`ctx.nodeBox`,
// `ctx.nodePorts`), because `rewire` lives on the LINK mark and could never see
// the node mark's channels. The pointer is then tested against DATA — the boxes and
// port positions those rules give for each node row — so a drop that looks like it
// landed on a dot did, whichever mark carries the edit.
//
// ── Ports pin, bodies leave it open ────────────────────────────────────────
// A drop lands on a PORT of a node (within a handle's radius of an edge midpoint
// the node allows for that end), inside a node's BOX, or near its CENTRE (a dot
// network with no box declared). A port pins that side. A body drop writes `null`:
// `link` then meets a node with ports at the usable port facing the other end, and
// slides along a node without ports — so a null end can never use a forbidden edge.
//
// ── The link mark names every column ───────────────────────────────────────
// `source`/`target` and `sourceSide`/`targetSide` are the LINK mark's channels.
// `connect` sits on a node's ports and writes a link row, so the engine hands it the
// link mark's channel map (`ctx.targetChannels`); `rewire` and `reverse` sit on the
// link and read their own. A side is written only where its channel names a field:
// a link that records no sides simply slides.

import { makeEdit, mintDatum } from './shared.js';
import { HANDLE_DEFAULTS } from '../plot/mark.js';
import { pickThreshold, HIT_TOLERANCE } from './pick.js';
import { nodeBoxesOf } from '../plot/nodeBox.js';
import { anchorOn, LINK_SIDES } from '../plot/linkRouter.js';
import { roleAllows, portKey } from '../plot/port.js';
import { isDirected, linkRulesOf } from '../core/schema.js';
import { warn } from '../core/dev.js';

/** How near the pointer must come to a node's CENTRE for a drag to land on it, when no mark declares the node's box. */
const CONNECT_THRESHOLD = 28;

/** Half-extent assumed for a node with no declared box — the same as link's. */
const DEFAULT_EXTENT = 12;

/**
 * How far the pointer must travel from the press before a release on the node it
 * started from makes a loop. A port sits ON its node's edge, so without this a
 * plain click on a port would land on that node's own body and draw a loop.
 */
const LOOP_TRAVEL = 8;

/**
 * The nodes-role table, its rows, and its key column — the three things every network
 * edit needs, read off the canonical schema so a renamed table still resolves.
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
 * The link columns a network edit reads and writes, from the LINK mark's channels:
 * `source`/`target` (else the link table's two `ref` columns, in order — what
 * `link` draws with) and `sourceSide`/`targetSide` (only where a channel names a
 * field).
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
 * The node a link END would land on, and the side it would take: a port of a node
 * that allows that end there, else a node's body, else (no box declared) the node
 * whose centre is within `threshold`.
 * @param {import('../types').EditContext} ctx
 * @param {{ name: string, table: any, rows: any[] }} nodes
 * @param {'source' | 'target'} end which end is being placed
 * @param {number | null} exclude a row that may not be chosen (the other end's node, with no self-loops)
 * @param {{ index: number, side: string | null, body: boolean } | null} [self] the node a
 *   loop would return to, when loops are allowed: its starting port is never a landing
 *   (a click on it is not a loop), and its body only once `body` says the pointer left
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
    // Then a body: inside the box, nearest centre wins where boxes overlap. A node
    // whose ports allow this end nowhere is not a target at all.
    if (geo.boxed) {
        geo.boxes.forEach((box, i) => {
            if (!box || bodyOff(i)) return;
            const sides = allowedSides(geo.roles[i], end);
            if (sides && !sides.length) return;
            if (Math.abs(p.x - box.cx) > box.hw || Math.abs(p.y - box.cy) > box.hh) return;
            const d = Math.hypot(box.cx - p.x, box.cy - p.y);
            if (d < bestDist) {
                bestDist = d;
                best = { row: nodes.rows[i], index: i, side: null };
            }
        });
        if (best) return best;
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
 * The PORTS a drop for this end could land on, as `{ x, y, key }` — the points the
 * engine probes to decide which ports to show during a drag (`Edit.targets`). A
 * chart with no ports returns null — not "nowhere to land" but "nothing to probe":
 * a drop on any node body is fair, and there is nothing to light.
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
 * Would a link a→b be a PARALLEL link the table doesn't allow? Never on a multigraph
 * (`multi: true`). Otherwise, does the table already hold this pair — where, on an
 * undirected table, B→A IS the edge A→B. `skip` is the row being rewired, which may
 * keep its own pair.
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
 * edit.network.connect() }`. The drag starts on a port, so it is `pick: 'direct'`,
 * and the connect driver claims it by CAPABILITY. It writes a LINK row
 * (`table: 'links'`, a ROLE) into the columns the link mark's channels name.
 *
 * What it may make is the links table's statement: a second link between one pair
 * only with `multi: true`, and a link from a node back to itself only with
 * `selfLoops: true` — released on another of that node's ports, or on its body once
 * the pointer has moved off the port it started from.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function connect(options = {}) {
    const { defaults = {}, threshold, ...rest } = options;
    return makeEdit({
        type: 'network.connect',
        gesture: 'drag',
        pick: 'direct',
        // The proposal is a LINK row even though the gesture landed on a node.
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
            // A drag that starts on a port a link may not LEAVE by makes nothing —
            // not even a band. (A hidden port is still under the pointer.)
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
            // A half-made row, for the PREVIEW only: the link being drawn, with no
            // target yet. Its free end is the pointer (the ghost pass hands it to
            // the link mark). On commit the same gesture makes nothing.
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

            // mintDatum seeds every declared column of the LINK table from its
            // schema (ctx.schema is the target table's — see computeEdit), so a link
            // arrives with its weight/label defaults rather than two columns.
            const datum = mintDatum(ctx, {
                defaults,
                seed: { [fields.source]: fromId, [fields.target]: toId, ...sideSeed(to.side) },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}

/**
 * rewire — drag a link's END to reconnect it, or off into space to remove it.
 *
 * Goes in a `link` mark's `edits`, which is what gives each end a handle. The
 * handle is tagged with its end, so the edit knows which column to write;
 * `rewire({ channels: ['target'] })` limits it to one end. Where you drop decides:
 * a port re-points the end and pins that side, a body re-points it (sliding, or the
 * allowed side facing the other end), and empty space removes the link.
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
        // The ends it moves: the link mark draws a handle for each. The fields
        // themselves come from the link's channel map (or its ref columns).
        channels: endsAllowed,
        when: (/** @type {import('../types').EditContext} */ ctx) => {
            // A gesture on the link BODY is not a rewire; only an end handle is.
            const end = endOf(ctx);
            if (!end || !endsAllowed.includes(end)) return false;
            return userWhen ? !!userWhen(ctx) : true;
        },
        // The ports the moved end could land on — never the OTHER end's node: a drop
        // there lands on nothing, and "nothing" is a removal, which a probe would
        // otherwise count as a place to land.
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
                // Off every node: the end follows the pointer while you aim, and the
                // link is removed if you let go here — a link cannot dangle.
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
 * reverse — swap a link's two ends.
 *
 * The missing directed gesture: `rewire` re-points ONE end at a different node, and
 * `connect` builds a new edge, but nothing could turn A→B into B→A. That is the one
 * thing a reader of a directed diagram most often wants to correct, and re-drawing
 * the link is a poor substitute — it loses every other column on the row.
 *
 * Goes on the `link` mark, which declares `supportsNetwork`, so `scope: 'network'`
 * is a real capability check here (unlike `connect`, which sits on an ordinary node
 * mark and therefore sets none). It lands on the link's hit path — which is why
 * `link` draws one.
 *
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
            // On an unordered table the two ends mean the same thing, so this
            // rewrites the row and changes nothing anyone can see. Say so rather
            // than letting a gesture that appears to do nothing look broken.
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
