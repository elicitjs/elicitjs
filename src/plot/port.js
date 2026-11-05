// @ts-check
// port.js — the PORTS of a node: where a link may meet it.
//
//   sticker({ channels: { …, ports: { value: { out: ['right'], in: ['left'] },
//                                     edit: edit.network.connect() } } })
//
// Ports are a CHANNEL on the mark that draws the nodes, not a mark of their own. A
// port belongs to a node, so it is stated where the node is: the channel's value
// says which edges a link may use (per row, through `{ fn }` or `{ field }`), and
// its edit says what dragging one does. That is the whole API; this file is what
// the engine desugars it into.
//
// ── One channel, one extra feature ─────────────────────────────────────────
// The engine turns a `ports` channel into a sibling PORT feature over the host's
// table (`portFeature`, called once while features are flattened — the composite
// precedent: one declared mark, several features). It is a separate feature for the
// same reason a sticker's label is: dispatch is per feature, so a drag that starts
// on a port reaches the channel's `connect` and never the host's `move`.
//
// ── Placed on the host's own box ───────────────────────────────────────────
// The port reads its node's rectangle from the HOST's `nodeBox` rule — the box the
// host draws (a dot's radius, a sticker's paper). The same rule is what `link`
// docks to and what a drop is tested against, so a port sits exactly where a link
// pinned to its edge will end. The port restates no size.
//
// ── Shown only while usable ────────────────────────────────────────────────
// Every port node is `onHover`, and the ENGINE's state pass decides when one shows
// (a state, so the engine's call — see core/elicit.js): at rest, the ports a link
// can START from on the row you hover; during a drag, exactly the ports a release
// could land on. A port nobody can use is never drawn.

import { rawChannel, resolveHandles } from './mark.js';
import { anchorOn, LINK_SIDES } from './linkRouter.js';
import { isDirected } from '../core/schema.js';
import { warn } from '../core/dev.js';

/**
 * Which way a link may use each edge of one node, from a `ports` value: a map from
 * side to 'out' | 'in' | 'both', or null for no ports at all.
 *
 *   true                     all four, both ways
 *   'right' | ['left', …]    those sides, both ways
 *   { out: […], in: […] }    leave by `out`, enter by `in` (a side in both is 'both')
 *   false | [] | null        none
 *
 * On a links table declared `directed: false` there is no "out" or "in", so a split
 * collapses to its union, with a warning.
 * @param {any} value the channel's value for one row
 * @param {boolean | undefined} directed the links table's `directed`
 * @returns {Record<string, 'out' | 'in' | 'both'> | null}
 */
export function portRolesOf(value, directed) {
    if (value == null || value === false) return null;
    /** @type {Record<string, 'out' | 'in' | 'both'>} */
    const roles = {};
    const sidesOf = (/** @type {any} */ v, /** @type {string} */ where) => {
        const list = v === true ? LINK_SIDES : Array.isArray(v) ? v : v == null ? [] : [v];
        return list.filter((/** @type {any} */ s) => {
            if (LINK_SIDES.includes(s)) return true;
            warn(
                `ports:side:${s}`,
                `ports got ${JSON.stringify(s)}${where}, which is not an edge. Use any of ` +
                `${LINK_SIDES.map((x) => `"${x}"`).join(', ')}. Skipping it.`
            );
            return false;
        });
    };
    if (value === true || typeof value === 'string' || Array.isArray(value)) {
        for (const s of sidesOf(value, '')) roles[s] = 'both';
    } else if (typeof value === 'object') {
        const out = sidesOf(value.out, ' in `out`');
        const into = sidesOf(value.in, ' in `in`');
        if (directed === false && (value.out || value.in)) {
            warn(
                'ports:undirected',
                'ports splits its sides into `out` and `in`, but the links table is declared ' +
                'directed: false, so a link has no direction to leave or enter by. Using every ' +
                'side listed, both ways. List them as one array instead.'
            );
            for (const s of [...out, ...into]) roles[s] = 'both';
        } else {
            for (const s of out) roles[s] = 'out';
            for (const s of into) roles[s] = roles[s] === 'out' ? 'both' : 'in';
        }
    } else {
        warn(
            'ports:value',
            `ports got ${JSON.stringify(value)}. Use true, a side, a list of sides, or ` +
            '{ out: [...], in: [...] }.'
        );
        return null;
    }
    return Object.keys(roles).length ? roles : null;
}

/**
 * The identity of one port as a DROP TARGET: which node row of which table, and
 * which edge. A drag's driver lists the keys a release could land on, and the
 * engine lights the port nodes that carry them — across features, since the link
 * mark's rewire and the node mark's ports are different features.
 * @param {string} table @param {number} index @param {string} side
 */
export function portKey(table, index, side) {
    return `${table}\u0000${index}\u0000${side}`;
}

/**
 * Can a link END of this kind use `role`? A source end leaves, a target end enters.
 * @param {'out' | 'in' | 'both' | undefined} role
 * @param {'source' | 'target'} end
 */
export function roleAllows(role, end) {
    if (!role) return false;
    return role === 'both' || role === (end === 'source' ? 'out' : 'in');
}

/**
 * The PORT feature a `ports` channel desugars into. Called by the engine once per
 * host, after the host's table is resolved. The channel's edit becomes the port
 * feature's own (mark-level, because it writes the LINK table, not a column of
 * this one); the value is read raw, per row.
 * @param {any} host the feature carrying `channels.ports`
 * @param {any} spec that channel (`{ value | fn | field, edit? }`)
 * @returns {import('../types').Mark}
 */
export function portFeature(host, spec) {
    const { edit, ...value } = spec || {};
    const channels = { ports: value };
    return /** @type {any} */ ({
        id: `${host.id}/ports`,
        type: 'port',
        // Same table and same glyph as the node it belongs to, so overlapping notes
        // still paint as whole objects, ports included.
        table: host.table,
        ...(host.glyph ? { glyph: host.glyph } : {}),
        channels,
        edits: edit ? [edit] : [],
        rawChannels: ['ports'],
        discreteScale: 'point',
        portHost: host,

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @param {import('../types').MarkBuildContext} [context]
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height, context) => {
            if (typeof host.nodeBox !== 'function') return [];
            const handle = resolveHandles(scales, {});
            const directed = context && context.schema ? isDirected(context.schema) : undefined;
            /** @type {import('../types').FeatureNode[]} */
            const out = [];
            currentData.forEach((d, index) => {
                if (!d) return;
                const roles = portRolesOf(
                    rawChannel(channels, 'ports', d, false, index, currentData), directed
                );
                if (!roles) return;
                const box = host.nodeBox(d, index, currentData, scales, width, height);
                if (!box) return;
                for (const side of LINK_SIDES) {
                    const role = roles[side];
                    if (!role) continue;
                    const at = anchorOn(box, side, 0, 0);
                    out.push({
                        type: 'circle',
                        cx: at.x,
                        cy: at.y,
                        r: handle.size,
                        fill: handle.fill,
                        stroke: handle.stroke,
                        strokeWidth: handle.strokeWidth,
                        channel: 'port',
                        side,
                        portRole: role,
                        onHover: true,
                        data: d,
                        index,
                    });
                }
            });
            return out;
        },
    });
}
