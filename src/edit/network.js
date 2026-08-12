// @ts-check
// network.js — the NETWORK-scoped edits: the two gestures that build a network's
// topology and that nothing general could express.
//
//   edit.network.connect()   drag from one node to another  -> a new link row
//   edit.network.rewire()    drag a link's endpoint onto a node -> that link re-points
//   edit.network.reverse()   click a link -> its two ends swap
//
// Everything else a diagram editor needs is already universal, and stays that way:
// `create` mints a node — with an identity, because the node table declares a `key`
// (see mintDatum) — `move` drags one and the links re-derive on the next render,
// `editText` writes a node's or a link's content, and `remove` deletes, the engine
// dropping the links a deleted node stranded because `type: 'ref'` declared that
// rule (see enforceRefs).
//
// ── Why the target is found in DATA, not in the scene ───────────────────────
// A driver only sees its OWN feature's scene nodes, and `rewire` lives on the link
// mark — so a scene search there would find links, never nodes. Both edits instead
// encode the node ROWS to pixels through the very channels a node is placed by, and
// take the nearest. That needs no cross-feature access, and it works whether or not
// any mark is drawing the nodes at all.
//
// ── Why connect writes a table its mark doesn't draw ────────────────────────
// `connect` is placed on the NODE mark, because that is what you grab. Its proposal
// is a LINK row. The descriptor says so (`table: 'links'`, a ROLE so a renamed
// schema resolves), and the engine keeps "where the gesture landed" and "what it
// writes" apart from there on — see computeEdit.

import { makeEdit, claimEdge, mintDatum } from './shared.js';
import { encodeChannel } from '../plot/mark.js';
import { nodeChannelsOf } from '../plot/link.js';
import { isDirected } from '../core/schema.js';
import { warn } from '../core/dev.js';

/** How near the pointer must come to a node for a drag to land on it. */
const CONNECT_THRESHOLD = 28;

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
 * The node nearest the pointer, as `{ row, index }`, or null. Positions come from
 * the same channels that place a node, resolved through `encodeChannel` — the one
 * positional path — so what the gesture snaps to is exactly what is drawn.
 * @param {import('../types').EditContext} ctx
 * @param {{ name: string, table: any, rows: any[] }} nodes
 * @param {number} threshold
 * @returns {{ row: any, index: number } | null}
 */
function nearestNodeRow(ctx, nodes, threshold) {
    const channels = nodeChannelsOf(ctx.markChannels || {}, nodes.table);
    let best = null;
    let bestDist = Infinity;
    nodes.rows.forEach((row, i) => {
        const x = encodeChannel(ctx.scales, channels, 'x', row, undefined, i, nodes.rows);
        const y = encodeChannel(ctx.scales, channels, 'y', row, undefined, i, nodes.rows);
        if (typeof x !== 'number' || typeof y !== 'number') return;
        const d = Math.hypot(x - ctx.pointer.x, y - ctx.pointer.y);
        if (d < bestDist) { bestDist = d; best = { row, index: i }; }
    });
    return best && bestDist <= threshold ? best : null;
}

/**
 * The link table's two `ref` columns, in declaration order — the same default
 * `link` draws with, so the gesture and the mark agree on which end is which
 * without either being configured.
 * @param {import('../types').EditContext} ctx
 * @param {any} options
 * @returns {{ source: string, target: string } | null}
 */
function endpointFields(ctx, options) {
    const spec = /** @type {any} */ (ctx).schemaSpec;
    const name = /** @type {any} */ (ctx).table;
    const table = spec && spec.tables[name];
    if (!table) return null;
    const refs = Object.keys(table.fields).filter((f) => table.fields[f] && table.fields[f].type === 'ref');
    const source = options.source || refs[0];
    const target = options.target || refs[1];
    return source && target ? { source, target } : null;
}

/**
 * connect — drag from one node to another to create a link.
 *
 * Placed on the NODE mark, and stays `pick: 'direct'`: the drag starts ON a node, so
 * there is nothing to search for and no reason to raise the interaction plane. The
 * connect driver claims it by CAPABILITY (the slide precedent), which is what lets
 * it sit beside an ordinary `move` on the same mark — one reads the drag's start
 * node, the other its displacement.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function connect(options = {}) {
    const { defaults = {}, source, target, threshold, selfLoops = false, ...rest } = options;
    return makeEdit({
        type: 'connect',
        gesture: 'drag',
        pick: 'direct',
        // The proposal is a LINK row even though the gesture landed on a node.
        table: 'links',
        cardinality: 'append',
        threshold: threshold != null ? threshold : CONNECT_THRESHOLD,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const nodes = nodesOf(ctx);
            const session = /** @type {any} */ (ctx).session;
            if (!nodes || !session || session.fromIndex == null) return undefined;
            const fields = endpointFields(ctx, { source, target });
            if (!fields) {
                warn(
                    'connect:refs',
                    'edit.network.connect() cannot find the link table\'s endpoint columns. ' +
                    'Declare them as references — source: { type: "ref" }, target: { type: "ref" } ' +
                    '— or name them: connect({ source: "from", target: "to" }).'
                );
                return undefined;
            }

            const from = nodes.rows[session.fromIndex];
            const to = nearestNodeRow(ctx, nodes, (ctx.edit && ctx.edit.threshold) || CONNECT_THRESHOLD);
            // Released over empty space: no link.
            if (!from || !to) return undefined;
            // Released back on the node it started from. Meaningless in an argument
            // map and meaningful in a flowchart, so it is an OPTION rather than a
            // rule — and `link` draws the loop when it happens.
            if (to.index === session.fromIndex && !selfLoops) return undefined;

            const fromId = from[nodes.key];
            const toId = to.row[nodes.key];
            if (fromId == null || toId == null) return undefined;
            // Already connected: nothing to add. What counts as "already" is the
            // schema's statement — on an undirected table B→A IS the edge A→B, and
            // adding its mirror would draw two lines over one relationship.
            const undirected = isDirected(/** @type {any} */ (ctx).schemaSpec) === false;
            const exists = ctx.data.some((d) => {
                if (!d) return false;
                if (d[fields.source] === fromId && d[fields.target] === toId) return true;
                return undirected && d[fields.source] === toId && d[fields.target] === fromId;
            });
            if (exists) return undefined;

            // mintDatum seeds every declared column of the LINK table from its
            // schema (ctx.schema is the target table's — see computeEdit), so a link
            // arrives with its weight/label defaults rather than two columns.
            const datum = mintDatum(ctx, {
                defaults,
                seed: { [fields.source]: fromId, [fields.target]: toId },
            });
            return datum ? [...ctx.data, datum] : undefined;
        },
    });
}

/**
 * rewire — drag a link's endpoint handle onto a different node.
 *
 * Placed on the `source` / `target` channel of a `link` mark, which is what makes
 * that end grow a handle (a mark is inert until an edit names the column it writes).
 * Both ends can carry one at once: each is guarded by `claimEdge`, so a drag on one
 * handle cannot reach the other's edit.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function rewire(options = {}) {
    const { threshold, ...rest } = options;
    const edit = makeEdit({
        type: 'rewire',
        gesture: 'drag',
        pick: 'direct',
        scope: 'network',
        threshold: threshold != null ? threshold : CONNECT_THRESHOLD,
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const nodes = nodesOf(ctx);
            if (!nodes || ctx.index == null || !ctx.datum) return undefined;
            // WHICH end: the handle's own tag, else the channel the edit was placed
            // on. Both are the same fact stated in the two places it can be stated.
            const which = (ctx.node && ctx.node.channel)
                || (ctx.channels[0] && ctx.channels[0].name);
            const field = ctx.channels[0] && ctx.channels[0].field;
            if (!which || !field) return undefined;

            const to = nearestNodeRow(ctx, nodes, (ctx.edit && ctx.edit.threshold) || CONNECT_THRESHOLD);
            if (!to) return undefined;
            const toId = to.row[nodes.key];
            if (toId == null || ctx.datum[field] === toId) return undefined;
            return { ...ctx.datum, [field]: toId };
        },
    });
    // The tag is the channel the edit sits on, so `source` and `target` handles
    // arbitrate without either needing a hand-written `when`.
    return claimEdge(edit, options.channel || (options.channels && options.channels[0]) || 'source');
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
    const { source, target, ...rest } = options;
    return makeEdit({
        type: 'reverse',
        gesture: 'click',
        pick: 'direct',
        scope: 'network',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            if (!ctx.datum) return undefined;
            const fields = endpointFields(ctx, { source, target });
            if (!fields) {
                warn(
                    'reverse:refs',
                    'edit.network.reverse() cannot find the link table\'s endpoint columns. ' +
                    'Declare them as references — source: { type: "ref" }, target: { type: "ref" } ' +
                    '— or name them: reverse({ source: "from", target: "to" }).'
                );
                return undefined;
            }
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
