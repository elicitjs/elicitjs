// @ts-check
// link.js — an edge of a network: one row of the links table, drawn between the
// two nodes it names. A mark because its geometry comes from a join with another
// table.
//
//   plot.link()                              // the whole thing, on a standard network
//   plot.link({ channels: { stroke: { field: 'weight' } } })
//   plot.link({ curve: 'step', arrow: true })
//   plot.link({ channels: { curve: { field: 'kind' } } })   // per-row connector style
//
// Defaults come from the schema: the links table (by role), its `ref` columns, the
// node table's `key` and x/y. Per row it emits a transparent hit path (first, so
// it sits beneath the paint), the visible path, arrowheads and an optional label.
// A row whose source or target names no node draws nothing. `curve`, `arrow`,
// sides and offsets are read raw per row; shapes live in linkGeometry.js and
// routing in linkRouter.js. Node boxes come from `context.nodeBox`. Endpoint
// handles appear only where an edit writes that end.

import { treeOf } from '../core/hierarchy.js';
import {
    encodeChannel, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, resolveHandles, markCommon, rawChannel,} from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { textNodeAt } from './text.js';
import { measureBlock } from '../core/measure.js';
import { LINK_SHAPES, LINK_CURVES, LINK_SIDES } from './linkGeometry.js';
import { routingGrid, resolveEnds, facingSide, loopSides, SIDE_NORMALS, MAX_SLIDE } from './linkRouter.js';
import { roleAllows } from './port.js';
import { nodeChannelsOf, nodeBoxesOf } from './nodeBox.js';
import { HIT_WIDTH } from './hitpath.js';
import { isDirected } from '../core/schema.js';
import { resolveFormat } from '../format.js';
import { warn } from '../core/dev.js';

// Apex offset (fraction of the chord) between adjacent links of one pair under `curvature: 'auto'`.
const AUTO_SPREAD = 0.16;
// The most `"auto"` will bow a labelled sibling to clear its neighbour's label.
const MAX_AUTO_BOW = 0.9;

// How far a self-loop reaches from its node, in px, when the spec names no size.
const LOOP_RADIUS = 22;

// Half-extent, in px, assumed for a node with no declared box.
const DEFAULT_EXTENT = 12;

// Default corner rounding of a routed connector, in px.
const CORNER_RADIUS = 8;

// Size of the inline editor box (`node.editBox`), centred on the label's midpoint.
const EDITOR_WIDTH = 140;
const EDITOR_PADDING = 10;

// Paint for the line that must not reach the label. `fill` colours the label.
const LABEL_EXCLUDES = ['stroke', 'strokeWidth', 'strokeOpacity'];

// The label's optional backing plate (`labelBackground`). `true` uses the theme
// background, which is null on a light theme, hence the literal fallback.
const LABEL_BACKGROUND = '#ffffff';
const LABEL_PADDING = 3;
const LABEL_RADIUS = 3;
const LABEL_OPACITY = 0.9;

/**
 * The link table's `ref` columns in declaration order: the default `source` and `target`.
 * @param {any} table the links TableSchema
 * @returns {string[]}
 */
function refFieldsOf(table) {
    if (!table) return [];
    return Object.keys(table.fields).filter((f) => table.fields[f] && table.fields[f].type === 'ref');
}

/**
 * Resolve the join from the schema and the channel map. Per build, since only the
 * engine knows the structure.
 * @param {Record<string, any>} channels
 * @param {import('../types').MarkBuildContext | undefined} context
 * @param {string} table this mark's table name
 * @returns {any | null}
 */
function resolveJoin(channels, context, table) {
    if (!context || !context.schema) return null;
    const spec = context.schema;
    const links = spec.tables[table];
    const nodesName = spec.byRole.nodes || spec.primary;
    const nodes = spec.tables[nodesName];
    if (!links || !nodes) return null;

    const refs = refFieldsOf(links);
    const sourceField = (channels.source && channels.source.field) || refs[0];
    const targetField = (channels.target && channels.target.field) || refs[1];
    // The node table's `key: true` field.
    const keyField = nodes.key;

    return {
        rows: (context.tables && context.tables[nodesName]) || [],
        nodesName,
        sourceField,
        targetField,
        keyField,
    };
}

/**
 * Pull the segment's ends in by `start` / `end` px, so a link stops short of a node.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} start @param {number} end
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
function insetSegment(x1, y1, x2, y2, start, end) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    // Nothing to draw if the nodes coincide or the insets consume the segment.
    if (!len || start + end >= len) return null;
    const ux = dx / len;
    const uy = dy / len;
    return {
        x1: x1 + ux * start, y1: y1 + uy * start,
        x2: x2 - ux * end, y2: y2 - uy * end,
    };
}

/**
 * A pinned edge, or null (also for `'auto'`) for an end that slides along the box
 * toward the other node.
 * @param {any} value @param {string} which the option's name, for the message
 * @returns {string | null}
 */
function resolveSide(value, which) {
    if (value === undefined || value === null || value === 'auto') return null;
    const v = String(value);
    if (LINK_SIDES.includes(v)) return v;
    warn(
        `link:side:${v}`,
        `link() got ${which}: ${JSON.stringify(value)}, which is not an edge. Use ` +
        `${LINK_SIDES.map((s) => `"${s}"`).join(', ')}, or null to let the end slide ` +
        `along the box toward the other node. Sliding.`
    );
    return null;
}

/**
 * Where along its edge a port sits, as a signed fraction of the edge from its
 * midpoint. Clamped so a link never leaves from a corner.
 * @param {any} value @param {string} which the option's name, for the message
 * @returns {number}
 */
function resolveOffset(value, which) {
    if (value === undefined || value === null) return 0;
    const v = +value;
    if (!Number.isFinite(v)) {
        warn(
            `link:offset:${which}`,
            `link() got ${which}: ${JSON.stringify(value)}, which is not a number. It is a ` +
            `fraction of the edge from its midpoint, between ${-MAX_SLIDE} and ${MAX_SLIDE}. ` +
            `Using the midpoint.`
        );
        return 0;
    }
    return Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, v));
}

/**
 * Which ends carry an arrowhead. `'auto'` means the target end when the links
 * table declares `directed: true`, else none.
 * @param {any} value
 * @param {boolean | undefined} directed
 * @returns {{ source: boolean, target: boolean }}
 */
function resolveArrow(value, directed) {
    let v = value;
    if (v === undefined || v === null || v === 'auto') v = directed === true ? 'target' : 'none';
    else if (v === true) v = 'target';
    else if (v === false) v = 'none';

    switch (v) {
        case 'none': return { source: false, target: false };
        case 'target': return { source: false, target: true };
        case 'source': return { source: true, target: false };
        case 'both': return { source: true, target: true };
        default:
            warn(
                `link:arrow:${v}`,
                `link() got arrow: ${JSON.stringify(v)}, which it doesn't know. Use ` +
                `"none", "target", "source", "both", or "auto" (the target end when the ` +
                `links table declares directed: true). Drawing no arrowhead.`
            );
            return { source: false, target: false };
    }
}

/**
 * A filled triangle capping one end of a link, its tip `size` px beyond the
 * endpoint along `dir`. The mark insets that end by the same amount, so the tip
 * lands where the link would otherwise have stopped.
 * @param {number} x @param {number} y
 * @param {{ x: number, y: number }} dir unit vector pointing out of the end
 * @param {number} size
 * @returns {string}
 */
function arrowPath(x, y, dir, size) {
    const w = size * 0.5;
    return `M${x + dir.x * size},${y + dir.y * size}`
        + `L${x - dir.y * w},${y + dir.x * w}`
        + `L${x + dir.y * w},${y - dir.x * w}Z`;
}

/**
 * How far each row bows, so links sharing a pair of nodes don't overlap. A pass
 * over the whole table. Directed: each link bows to the same side of its own
 * direction, so a reciprocal pair lands on opposite sides. Undirected: the group
 * fans symmetrically. A lone link stays straight.
 * @param {any[]} rows @param {string} sourceField @param {string} targetField
 * @param {boolean | undefined} directed @param {number} spread
 * @returns {number[]} one signed bow per row, aligned by index
 */
function separationBows(rows, sourceField, targetField, directed, spread) {
    /** @type {Map<string, number[]>} */
    const pairs = new Map();
    /** @type {Map<string, number>} */
    const seen = new Map();

    const pairKey = (/** @type {any} */ d) => {
        const a = String(d[sourceField]);
        const b = String(d[targetField]);
        return a < b ? `${a}\0${b}` : `${b}\0${a}`;
    };

    rows.forEach((d, i) => {
        if (!d) return;
        const key = pairKey(d);
        const group = pairs.get(key);
        if (group) group.push(i); else pairs.set(key, [i]);
    });

    /** @type {number[]} */
    const bows = new Array(rows.length).fill(0);
    for (const members of pairs.values()) {
        if (members.length < 2) continue;
        members.forEach((i, k) => {
            const d = rows[i];
            if (directed) {
                // Rank within this row's own direction.
                const orient = `${d[sourceField]}\0${d[targetField]}`;
                const n = seen.get(orient) || 0;
                seen.set(orient, n + 1);
                bows[i] = spread * (n + 1);
            } else {
                // Symmetric fan: …, -1.5, -0.5, +0.5, +1.5, … times the spread.
                bows[i] = spread * ((2 * k - (members.length - 1)) / 2);
            }
        });
    }
    return bows;
}

/**
 * Each self-loop's rank among the loops on its node (0, 1, …), or -1 for a non-loop,
 * so several loops on one node take different edges, then nest.
 * @param {any[]} rows @param {string} sourceField @param {string} targetField
 * @returns {number[]}
 */
function loopRanks(rows, sourceField, targetField) {
    /** @type {Map<string, number>} */
    const count = new Map();
    return rows.map((d) => {
        if (!d || d[sourceField] == null || d[sourceField] !== d[targetField]) return -1;
        const key = String(d[sourceField]);
        const n = count.get(key) || 0;
        count.set(key, n + 1);
        return n;
    });
}

/**
 * link — one row of the links table drawn between the nodes it references.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function link(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'link',
        allow: MARK_OPTIONS.link,
    });
    const {
        channels = {}, edits, table,
        curve = 'line', curvature = 'auto', spread = AUTO_SPREAD,
        arrow = 'auto', arrowSize = 6, loopRadius = LOOP_RADIUS,
        inset = 0, sourceInset, targetInset, format: formatOpt,
        cornerRadius = CORNER_RADIUS,
        sourceSide = 'auto', targetSide = 'auto',
        sourceOffset = 0, targetOffset = 0,
        labelBackground, labelPadding = LABEL_PADDING,
        labelRadius = LABEL_RADIUS, labelOpacity = LABEL_OPACITY,
    } = opts;

    const format = resolveFormat(formatOpt);
    // An end gets a handle when an edit writes its column (on the channel, or a
    // mark-level edit naming it, like `edit.network.rewire()`).
    /** @param {string} name */
    const endEdited = (name) => !!(channels[name] && channels[name].edit)
        || (Array.isArray(edits) && edits.some((e) => e && Array.isArray(e.channels) && e.channels.includes(name)));
    /** @type {Record<string, boolean>} */
    const handleEdits = { source: endEdited('source'), target: endEdited('target') };

    return {
        ...markCommon(opts),
        type: 'link',
        channels,
        // Explicit name wins; otherwise the table filling the `links` role.
        table,
        tableRole: 'links',
        // Declares the capability the `network`-scoped edits check for.
        supportsNetwork: true,
        // Every channel read through `rawChannel` (no scale) must be listed here.
        rawChannels: [
            'sourceSide', 'targetSide',
            'sourceOffset', 'targetOffset', 'curve', 'arrow', 'fontSize',
        ],
        // A link only spans, so it leaves the discrete scale to others (like rule).
        discreteScale: undefined,

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @param {import('../types').MarkBuildContext} [context]
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height, context) => {
            const join = resolveJoin(channels, context, context ? context.table : '');
            if (!join) {
                warn(
                    'link:structure',
                    'link() needs a network dataset: declare schema: { structure: "network", ' +
                    'tables: { nodes: {…}, links: {…} } }. Without a links table there is nothing ' +
                    'for it to draw.'
                );
                return [];
            }
            if (!join.keyField) {
                warn(
                    'link:key',
                    'link() cannot find the column that identifies a node. Mark one in the node ' +
                    'table with `key: true` (e.g. id: { type: "categorical", key: true }). ' +
                    'No links are drawn until it can.'
                );
                return [];
            }
            if (!join.sourceField || !join.targetField) {
                warn(
                    'link:refs',
                    'link() cannot find the link table\'s endpoint columns. Declare them as ' +
                    'references — source: { type: "ref" }, target: { type: "ref" } — or name them ' +
                    'with channels: { source: { field: … }, target: { field: … } }.'
                );
                return [];
            }

            const spec = /** @type {any} */ (context).schema;
            const nodesTable = spec.tables[join.nodesName];
            const nodeChannels = nodeChannelsOf(channels, nodesTable);
            const theme = themeOf(scales);
            const defaults = markDefaults(scales, 'link', { stroke: theme.ink, fill: 'none' });
            const handle = resolveHandles(scales, opts);
            const startInset = sourceInset != null ? sourceInset : inset;
            const endInset = targetInset != null ? targetInset : inset;
            // The node mark's `nodeBox` rule, handed over by the engine.
            const rule = (context && context.nodeBox) || null;
            // The node mark's `ports` rule: an end on a node with ports meets it at one.
            const portsRule = (context && context.nodePorts) || null;
            // Fallback box size with no rule; `inset` doubles as the half-extent.
            const extent = (inset || DEFAULT_EXTENT) * 2;
            // Only a declared box makes a chord kind dock at the box; the fallback is a guess.
            const sized = !!rule;

            const directed = isDirected(spec);
            // `curvature: 'auto'` bows per row; a number applies to every link.
            const autoBows = curvature === 'auto'
                ? separationBows(currentData, join.sourceField, join.targetField, directed, spread)
                : null;
            const loopRank = loopRanks(currentData, join.sourceField, join.targetField);

            // The label's channels: the stroke family describes the connector and is
            // dropped, so the label isn't outlined. `fill` colours the label.
            const labelChannels = channels.text ? { ...channels } : null;
            if (labelChannels) {
                for (const key of LABEL_EXCLUDES) delete labelChannels[key];
            }
            // `true` means the chart's own background.
            const labelPlate = labelChannels && labelBackground
                ? (labelBackground === true ? (theme.background || LABEL_BACKGROUND) : String(labelBackground))
                : null;
            const labelFont = (theme.font && theme.font.family) || undefined;

            // Identity -> node row, once per build rather than once per link.
            /** @type {Map<any, { row: any, index: number }>} */
            const byKey = new Map();
            join.rows.forEach((/** @type {any} */ row, /** @type {number} */ i) => {
                const k = row ? row[join.keyField] : undefined;
                if (k !== undefined && k !== null && !byKey.has(k)) byKey.set(k, { row, index: i });
            });

            // Every node's box and the routing grid, built lazily once per build.
            /** @type {(import('./linkRouter.js').LinkBox | null)[] | null} */
            let boxes = null;
            /** @type {import('./linkRouter.js').LinkBox[]} */
            let obstacles = [];
            /** @type {import('./linkRouter.js').RoutingGrid | undefined} */
            let grid;
            const nodeBoxes = () => {
                if (boxes) return boxes;
                const built = nodeBoxesOf(
                    scales, channels, nodesTable, join.rows, rule, extent, extent, width, height
                );
                // A container (a hierarchy row with children) is not an obstacle.
                const tree = treeOf(spec, /** @type {any} */ (context).tables);
                obstacles = /** @type {import('./linkRouter.js').LinkBox[]} */ (
                    built.filter((box, i) => box && !tree.hasChildren(i))
                );
                grid = routingGrid(obstacles);
                boxes = built;
                return built;
            };

            /** @type {import('../types').FeatureNode[]} */
            const out = [];
            // The free end of a link being drawn or rewired, in a ghost build.
            const pointer = context && context.ghost && context.ghost.pointer
                ? context.ghost.pointer
                : null;

            currentData.forEach((d, index) => {
                const from = byKey.get(d ? d[join.sourceField] : undefined);
                const to = byKey.get(d ? d[join.targetField] : undefined);
                // A reference naming no node draws nothing, except in a ghost build,
                // where one unresolved end is the pointer (a link being drawn or rewired).
                const freeFrom = !from && to && pointer ? pointer : null;
                const freeTo = !to && from && pointer ? pointer : null;
                const free = freeFrom || freeTo;
                if ((!from && !freeFrom) || (!to && !freeTo)) return;

                // Endpoints: the node's box centre, else encodeChannel on the node row.
                const fromBox = rule && from ? nodeBoxes()[from.index] : null;
                const toBox = rule && to ? nodeBoxes()[to.index] : null;
                const x1 = fromBox ? fromBox.cx
                    : from ? encodeChannel(scales, nodeChannels, 'x', from.row, width / 2, from.index, join.rows)
                        : /** @type {{x:number,y:number}} */ (freeFrom).x;
                const y1 = fromBox ? fromBox.cy
                    : from ? encodeChannel(scales, nodeChannels, 'y', from.row, height / 2, from.index, join.rows)
                        : /** @type {{x:number,y:number}} */ (freeFrom).y;
                const x2 = toBox ? toBox.cx
                    : to ? encodeChannel(scales, nodeChannels, 'x', to.row, width / 2, to.index, join.rows)
                        : /** @type {{x:number,y:number}} */ (freeTo).x;
                const y2 = toBox ? toBox.cy
                    : to ? encodeChannel(scales, nodeChannels, 'y', to.row, height / 2, to.index, join.rows)
                        : /** @type {{x:number,y:number}} */ (freeTo).y;

                const selfLoop = !!to && !!from && from.index === to.index;
                const arrows = resolveArrow(
                    rawChannel(channels, 'arrow', d, arrow, index, currentData), directed
                );
                let bow = autoBows ? autoBows[index] : +curvature || 0;

                // A row referencing one node twice is always a loop.
                let kind = selfLoop
                    ? 'loop'
                    : String(rawChannel(channels, 'curve', d, curve, index, currentData));
                if (!LINK_SHAPES[kind]) {
                    warn(
                        `link:curve:${kind}`,
                        `link() got curve: "${kind}", which it doesn't know. Use one of ` +
                        `${LINK_CURVES.map((c) => `"${c}"`).join(', ')}. Drawing a straight line.`
                    );
                    kind = 'line';
                }
                // A straight line cannot bow, so a bowed line becomes an arc.
                if (kind === 'line' && bow) kind = 'arc';

                // The shape's `anchors` says how to feed it: an inset chord or centres plus boxes.
                const entry = LINK_SHAPES[kind];
                let seg;
                /** @type {import('./linkGeometry.js').LinkShapeOptions} */
                const shapeOpts = { loopRadius, cornerRadius: +cornerRadius || 0 };
                // Where each end meets its node: a pinned edge, or null to slide.
                const sourcePort = {
                    side: resolveSide(
                        rawChannel(channels, 'sourceSide', d, sourceSide, index, currentData), 'sourceSide'
                    ),
                    offset: resolveOffset(
                        rawChannel(channels, 'sourceOffset', d, sourceOffset, index, currentData), 'sourceOffset'
                    ),
                };
                const targetPort = {
                    side: resolveSide(
                        rawChannel(channels, 'targetSide', d, targetSide, index, currentData), 'targetSide'
                    ),
                    offset: resolveOffset(
                        rawChannel(channels, 'targetOffset', d, targetOffset, index, currentData), 'targetOffset'
                    ),
                };
                // A node's box, or a fallback box about its endpoint.
                const boxOf = (/** @type {number} */ i, /** @type {number} */ cx, /** @type {number} */ cy) =>
                    nodeBoxes()[i] || { cx, cy, hw: extent / 2, hh: extent / 2 };
                // A free end is a point, so a route runs straight to the pointer.
                const sourceBox = from ? boxOf(from.index, x1, y1) : { cx: x1, cy: y1, hw: 0, hh: 0 };
                const targetBox = to ? boxOf(to.index, x2, y2) : { cx: x2, cy: y2, hw: 0, hh: 0 };

                // On a node with ports, an unpinned end takes the usable port facing
                // the other end. Without ports, it slides.
                /** @param {any} node @param {'source' | 'target'} end @returns {string[] | null} */
                const portSides = (node, end) => {
                    if (!portsRule || !node) return null;
                    const roles = portsRule(node.row, node.index, join.rows) || {};
                    const sides = LINK_SIDES.filter((s) => roleAllows(roles[s], end));
                    return sides.length ? sides : null;
                };
                const sourcePorts = portSides(from, 'source');
                const targetPorts = portSides(to, 'target');
                if (selfLoop) {
                    // `loopSides` picks a loop's edges from the ports and its rank.
                    const sides = loopSides(
                        sourcePorts, targetPorts, sourcePort.side, targetPort.side, Math.max(0, loopRank[index])
                    );
                    shapeOpts.loopOut = sides.out;
                    shapeOpts.loopIn = sides.in;
                    shapeOpts.nest = sides.nest;
                } else if (sourcePorts && !sourcePort.side) {
                    sourcePort.side = facingSide(sourceBox, sourcePorts, { x: targetBox.cx, y: targetBox.cy });
                }
                if (!selfLoop && targetPorts && !targetPort.side) {
                    targetPort.side = facingSide(targetBox, targetPorts, { x: sourceBox.cx, y: sourceBox.cy });
                }

                // Each end's clearance: `inset` (none at a port) plus any arrowhead.
                const startGap = (sourcePorts ? 0 : startInset) + (arrows.source ? arrowSize : 0);
                const endGap = (targetPorts ? 0 : endInset) + (arrows.target ? arrowSize : 0);

                if (entry.anchors === 'box') {
                    seg = { x1, y1, x2, y2 };
                    shapeOpts.source = sourceBox;
                    shapeOpts.target = targetBox;
                    shapeOpts.sourceGap = startGap;
                    shapeOpts.targetGap = endGap;
                    shapeOpts.obstacles = obstacles;
                    shapeOpts.grid = grid;
                    shapeOpts.sourcePort = sourcePort;
                    shapeOpts.targetPort = targetPort;
                } else if (selfLoop) {
                    seg = { x1, y1, x2: x1, y2: y1 };
                    // Docked on the node's box only when one is declared.
                    if (sized) {
                        shapeOpts.source = sourceBox;
                        shapeOpts.sourceGap = startGap;
                        shapeOpts.targetGap = endGap;
                    } else {
                        // Above the centre, a pair separated by the bow's sign.
                        delete shapeOpts.loopOut;
                        shapeOpts.nest = Math.floor(Math.max(0, loopRank[index]) / 2);
                    }
                } else if (sized || sourcePort.side || targetPort.side) {
                    // A chord kind docks at the box: clipped where it leaves each node
                    // (plus the gap), or at a pinned edge.
                    const ends = resolveEnds(
                        sourceBox, sourcePort, startGap,
                        targetBox, targetPort, endGap
                    );
                    // A round node is met on its ellipse, not its box; the gap grows both radii.
                    const onCircle = (/** @type {any} */ box, /** @type {number} */ gap, /** @type {{ x: number, y: number }} */ toward) => {
                        const dx = toward.x - box.cx;
                        const dy = toward.y - box.cy;
                        const rx = box.hw + gap;
                        const ry = box.hh + gap;
                        const t = 1 / (Math.hypot(dx / (rx || 1e-6), dy / (ry || 1e-6)) || 1);
                        return { x: box.cx + dx * t, y: box.cy + dy * t };
                    };
                    const a = !sourcePort.side && /** @type {any} */ (sourceBox).round
                        ? onCircle(sourceBox, startGap, targetPort.side ? ends.b : { x: targetBox.cx, y: targetBox.cy })
                        : ends.a;
                    const b = !targetPort.side && /** @type {any} */ (targetBox).round
                        ? onCircle(targetBox, endGap, sourcePort.side ? ends.a : { x: sourceBox.cx, y: sourceBox.cy })
                        : ends.b;
                    seg = Math.hypot(b.x - a.x, b.y - a.y) < 1 ? null : { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
                    if (sourcePort.side) shapeOpts.sourceNormal = SIDE_NORMALS[sourcePort.side];
                    if (targetPort.side) shapeOpts.targetNormal = SIDE_NORMALS[targetPort.side];
                } else {
                    seg = insetSegment(x1, y1, x2, y2, startGap, endGap);
                }
                if (!seg) return;
                const labelSize = +rawChannel(channels, 'fontSize', d, 12, index, currentData) || 12;

                // Widen the auto fan so labelled siblings' labels clear each other.
                if (autoBows && bow && labelChannels && entry.anchors === 'chord' && !selfLoop) {
                    const chord = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                    const step = spread * chord / 2;
                    const need = labelSize + labelPadding * 2 + 2;
                    if (step > 0 && step < need) {
                        bow = Math.sign(bow) * Math.min(Math.abs(bow) * (need / step), MAX_AUTO_BOW);
                    }
                }

                const style = resolveStyle(scales, channels, d, defaults, index, currentData);
                const shape = entry.build(seg, bow, shapeOpts);
                // A shape may decline the row (e.g. two concentric boxes).
                if (!shape) return;

                // Where the inline editor opens, at the label's midpoint. A path has no
                // x/y for the renderer to fall back on, so every node of the row states it.
                const editBox = {
                    x: shape.mid.x - EDITOR_WIDTH / 2,
                    y: shape.mid.y - (labelSize + EDITOR_PADDING) / 2,
                    width: EDITOR_WIDTH,
                    height: labelSize + EDITOR_PADDING,
                };

                const hitPoints = shape.hit || shape.points;
                if (hitPoints) {
                    out.push({
                        type: 'path',
                        points: hitPoints,
                        curve: shape.hit ? 'linear' : shape.curve,
                        stroke: 'transparent',
                        strokeWidth: Math.max(HIT_WIDTH, +style.strokeWidth || 0),
                        // Round caps, so pointing at an end handle hovers the link.
                        strokeLinecap: 'round',
                        fill: 'none',
                        hit: true,
                        editBox,
                        data: d,
                        index,
                    });
                }

                out.push({
                    type: 'path',
                    // A curved body draws `d`; its sampled polyline lets a tip measure to it.
                    ...(shape.d
                        ? { d: shape.d, ...(shape.hit ? { points: shape.hit } : {}) }
                        : { points: shape.points, curve: shape.curve }),
                    ...style,
                    fill: 'none',
                    // Dashed while one end is free.
                    ...(free ? { strokeDasharray: '4 3' } : {}),
                    editBox,
                    data: d,
                    index,
                });

                // Arrowheads at the shape's own endpoints (not the segment's), along its tangents.
                const arrowFill = style.stroke || defaults.stroke;
                if (arrows.target) {
                    out.push({
                        type: 'path',
                        d: arrowPath(shape.end.x, shape.end.y, shape.tangentOut, arrowSize),
                        fill: arrowFill, stroke: 'none', data: d, index,
                    });
                }
                if (arrows.source) {
                    out.push({
                        type: 'path',
                        d: arrowPath(shape.start.x, shape.start.y, { x: -shape.tangentIn.x, y: -shape.tangentIn.y }, arrowSize),
                        fill: arrowFill, stroke: 'none', data: d, index,
                    });
                }

                // The label sits at the shape's midpoint, on the path.
                if (labelChannels) {
                    const label = Object.assign(
                        textNodeAt(scales, labelChannels, d, index, shape.mid.x, shape.mid.y, {
                            format, data: currentData,
                        }),
                        { editBox }
                    );
                    // The plate goes first, under the label, sized by measurement and
                    // placed by the label's own anchors.
                    if (labelPlate && label.text !== '' && label.text != null) {
                        const block = measureBlock(String(label.text), {
                            fontSize: +(label.fontSize || 0) || 12,
                            fontFamily: labelFont,
                        });
                        const w = block.width + labelPadding * 2;
                        const h = block.height + labelPadding * 2;
                        const lx = label.x || 0;
                        const ly = label.y || 0;
                        out.push({
                            type: 'rect',
                            x: label.textAnchor === 'start' ? lx
                                : label.textAnchor === 'end' ? lx - w
                                    : lx - w / 2,
                            y: label.lineAnchor === 'top' ? ly
                                : label.lineAnchor === 'bottom' ? ly - h
                                    : ly - h / 2,
                            width: w,
                            height: h,
                            rx: labelRadius,
                            fill: labelPlate,
                            fillOpacity: labelOpacity,
                            stroke: 'none',
                            ...(label.angle ? { angle: label.angle } : {}),
                            editBox,
                            data: d,
                            index,
                        });
                    }
                    out.push(label);
                }

                // Endpoint handles where an edit writes that end, tagged with the end.
                // `onHover` + `raise`: shown only while the link is lit, above the nodes.
                for (const [name, pt] of /** @type {[string, {x:number,y:number}][]} */ ([
                    ['source', shape.start],
                    ['target', shape.end],
                ])) {
                    if (!handleEdits[name] || !handle.grabbable) continue;
                    out.push({
                        type: 'circle',
                        cx: pt.x,
                        cy: pt.y,
                        r: handle.size,
                        fill: handle.fill,
                        stroke: handle.stroke,
                        strokeWidth: handle.strokeWidth,
                        channel: name,
                        onHover: true,
                        raise: true,
                        data: d,
                        index,
                    });
                }
            });

            return out;
        },
    };
}
