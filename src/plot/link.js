// @ts-check
// link.js — an EDGE of a network: one row of the links table, drawn between the two
// nodes it names.
//
// It is its own mark because its DATA MODEL is new, which is the discriminator for
// "mark or option" in this codebase. Every other mark's geometry comes from the row
// it draws; a link's comes from a JOIN — `rule`'s span mode reads y1/y2 off the same
// row, a link reads its endpoints out of a different table entirely. Nothing else
// here does that, and no option on an existing mark could.
//
//   plot.link()                              // the whole thing, on a standard network
//   plot.link({ channels: { stroke: { field: 'weight' } } })
//   plot.link({ curve: 'step', arrow: true })
//   plot.link({ channels: { curve: { field: 'kind' } } })   // per-row connector style
//
// ── Why it needs almost no options ─────────────────────────────────────────
// The schema already says everything: which table holds links (the `links` ROLE),
// which of its columns are references (`type: 'ref'`), which column identifies a
// node (`key: true`), and where a node sits (the node table's x/y). So a bare
// `link()` works, and every default below is a schema read rather than a convention
// baked into this file — a spec that renamed its tables to `claims`/`supports`
// needs no configuration at all.
//
// ── What it emits ──────────────────────────────────────────────────────────
// Per link row: a fat transparent HIT path, the visible path, any arrowheads, and
// optionally a label — all carrying that row's `index` and `data`, so the universal
// edits (`remove`, `set`, `cycle`, `editText`) act on a link exactly as they act on
// any other mark's datum. The channel map serves both surfaces, split by what the
// paint MEANS: `stroke`/`strokeWidth` are the connector (and an arrowhead's fill),
// `fill` is the label's colour. A row whose source or target names no node emits nothing:
// that is how a link mark over a mixed table draws only what it can, and why a
// half-formed row is invisible rather than drawn at the origin.
//
// The hit path is what makes a link BODY grabbable. A stroked line is a couple of
// pixels wide, and the pick layer measures along a node's `points` polyline and has
// no branch for a `d`-only path — so before it, a link could only be touched by its
// endpoint handles, and an edit like `edit.network.reverse` had nothing to land on.
// It is emitted FIRST so it stays beneath the real paint (see plot/hitpath.js).
//
// ── Shape and direction are per ROW ────────────────────────────────────────
// `curve` and `arrow` are read through `rawChannel`, so either can be a constant on
// the mark or a column: `channels: { curve: { field: 'kind' } }` is how a diagram
// says "supports are curved, objections are elbows" without a second link mark and
// without any new scale machinery. The shapes themselves live in linkGeometry.js —
// a new connector style is a row in that table, not a branch here.
//
// `arrow` defaults to `'auto'`, which means the target end iff the links table
// declares `directed: true`. That is the one path by which a statement about the
// DATA reaches the drawing: the schema says the network is directed, so the arrows
// appear, and a mark never hard-codes an opinion about it.
//
// Endpoint HANDLES appear only where an edit writes that end (`rewire` in `edits`,
// or an edit on the `source`/`target` channel) — the same "inert until the spec
// names the column" rule every mark follows. Each is tagged `node.channel` with its
// end, shown only while the link is lit, and painted above the nodes (`raise`).
//
// The node BOX comes from the mark that draws the nodes (`context.nodeBox`, its
// `Mark.nodeBox` rule), never from an option here, so a link end, a node's port and
// a drop target agree on where every edge is.

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

// Apex offset, as a fraction of the chord, between adjacent links of one pair when
// `curvature: 'auto'` fans them apart.
const AUTO_SPREAD = 0.16;
// The most `"auto"` will bow a labelled sibling to clear its neighbour's label: past
// this an arc stops reading as a link between two nodes.
const MAX_AUTO_BOW = 0.9;

// How far a self-loop reaches from its node, in px, when the spec names no size.
const LOOP_RADIUS = 22;

// Half-extent a routed connector assumes for a node whose size the spec never
// states, in px. Small enough to read as "just off the point", so a bare
// `curve: 'orthogonal'` on a dot network still leaves each node square-on.
const DEFAULT_EXTENT = 12;

// Corner rounding of a routed connector when the spec names none, in px. A
// square-cornered elbow reads as a wiring diagram; every board tool rounds by
// default, and both docs examples passed 8 or 10 before this became the default.
const CORNER_RADIUS = 8;

// The inline editor a link declares for itself (`node.editBox`): centred on the
// label's own midpoint, wide enough for a short phrase, and as tall as the label
// plus room for the input's chrome.
const EDITOR_WIDTH = 140;
const EDITOR_PADDING = 10;

// Paint that describes the LINE and must not reach the label. Everything else a
// style channel can carry — `fill`, `opacity`, `fillOpacity` — is the label's, so
// `link({ fill: 'crimson' })` recolours the text and leaves the connector alone.
const LABEL_EXCLUDES = ['stroke', 'strokeWidth', 'strokeOpacity'];

// The label's optional backing plate. A link's label sits ON its own connector, so
// the line runs straight through the text; a plate under it is what makes a labelled
// connector readable. Opt-in, because turning it on would repaint every network
// chart written before it existed. `labelBackground: true` takes the theme's own
// backdrop — which is null on a light theme, meaning "whatever the page is", so
// there has to be a literal to fall back to.
const LABEL_BACKGROUND = '#ffffff';
const LABEL_PADDING = 3;
const LABEL_RADIUS = 3;
const LABEL_OPACITY = 0.9;

/**
 * The link table's two `ref` columns, in declaration order — what `source` and
 * `target` mean when the spec doesn't say. Declaring a reference is already the
 * statement that this column points at a node; making the author repeat it in the
 * channel map would be a second place for the same fact to live.
 * @param {any} table the links TableSchema
 * @returns {string[]}
 */
function refFieldsOf(table) {
    if (!table) return [];
    return Object.keys(table.fields).filter((f) => table.fields[f] && table.fields[f].type === 'ref');
}

/**
 * Resolve everything this mark needs from the schema + the channel map. Done per
 * build (not per factory call) because only the engine knows the structure.
 * @param {Record<string, any>} channels
 * @param {any} options
 * @param {import('../types').MarkBuildContext | undefined} context
 * @param {string} table this mark's table name
 * @returns {any | null}
 */
function resolveJoin(channels, options, context, table) {
    if (!context || !context.schema) return null;
    const spec = context.schema;
    const links = spec.tables[table];
    const nodesName = spec.byRole.nodes || spec.primary;
    const nodes = spec.tables[nodesName];
    if (!links || !nodes) return null;

    const refs = refFieldsOf(links);
    const sourceField = (channels.source && channels.source.field) || refs[0];
    const targetField = (channels.target && channels.target.field) || refs[1];
    // The node column that holds identities: the node table's `key: true` field.
    // The schema's statement, and only the schema's — a `key:` option on the mark was
    // an option naming a data column, which `channels` alone may do.
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
 * Pull the segment's ends in by `inset` px, so a link stops short of a node instead
 * of running under it. Purely geometric — it never reads the node mark's geometry,
 * which would couple a mark to a mark.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} start @param {number} end
 * @returns {{ x1: number, y1: number, x2: number, y2: number } | null}
 */
function insetSegment(x1, y1, x2, y2, start, end) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    // Nothing sensible to draw between coincident nodes, or when the insets would
    // consume the whole segment (two nodes overlapping).
    if (!len || start + end >= len) return null;
    const ux = dx / len;
    const uy = dy / len;
    return {
        x1: x1 + ux * start, y1: y1 + uy * start,
        x2: x2 - ux * end, y2: y2 - uy * end,
    };
}

/**
 * An edge an author named, or null — the end SLIDES along the box toward the
 * other node (`'auto'` is the older spelling of the same thing).
 *
 * A side is read raw like `curve` and `arrow`: a mark option, a derived `{ fn }`,
 * or a column when the spec points it at a `{ field }` or the links table declares
 * `sides`. A pinned side is the one thing that stops an end sliding.
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
 * Where along its edge a port sits, as a signed fraction of that edge from the
 * midpoint. Read raw like a side, for the same reason: a position on an edge is
 * PRESENTATION, a mark option by default and a column only when the spec points
 * it at one. Clamped so a link never leaves from a corner.
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
 * Which ends carry an arrowhead, from whatever the spec (or a column) said.
 *
 * `'auto'` is the interesting value: it defers to the SCHEMA, so declaring the
 * links table `directed: true` is what puts arrows on the picture. With no
 * declaration it resolves to none — which is every chart written before the flag
 * existed, and why `directed` is tri-state rather than a boolean.
 *
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
 * @param {{ x: number, y: number }} dir unit vector pointing OUT of the end
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
 * How far each row bows, so links sharing a pair of nodes don't draw on top of
 * each other. Computed once per build over the whole link table, because "how many
 * links join these two nodes" is a question about the TABLE — a row cannot answer
 * it alone, which is why this is a pass and not a channel.
 *
 * Two regimes, and the difference is the whole point of declaring `directed`:
 *
 *   DIRECTED — every link bows to the same side of its OWN direction of travel, so
 *     out-edges read as consistently convex. A reciprocal pair separates for free:
 *     B→A's chord normal is A→B's flipped, so the same positive bow puts them on
 *     opposite sides. Same-direction siblings fan outward from there.
 *   UNDIRECTED — no direction to be consistent with, so the group fans
 *     symmetrically about the chord.
 *
 * A pair joined by exactly one link stays perfectly straight either way: bowing a
 * lone edge buys nothing and makes a simple diagram look hand-drawn.
 *
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
                // Rank within this row's OWN direction, so A→B and B→A each start
                // at the first offset and land on opposite sides of the chord.
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
 * Each self-loop's place among the loops on its node (0, 1, …), and -1 for a row that
 * is not a loop — so several loops on one node take different edges, then nest.
 * Like separationBows, a question about the TABLE.
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
        channels = {}, id, edits, table,
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
    // Which ends get a handle: an end whose column an edit WRITES — an edit placed on
    // that channel, or a mark-level edit naming it (`edit.network.rewire()` names
    // both ends). The same "inert until an edit names the column" rule as every mark.
    /** @param {string} name */
    const endEdited = (name) => !!(channels[name] && channels[name].edit)
        || (Array.isArray(edits) && edits.some((e) => e && Array.isArray(e.channels) && e.channels.includes(name)));
    /** @type {Record<string, boolean>} */
    const handleEdits = { source: endEdited('source'), target: endEdited('target') };

    return {
        ...markCommon(opts),
        type: 'link',
        channels,
        // Explicit name wins; otherwise the table filling the `links` role — which is
        // what lets a renamed schema work with no `table:` anywhere.
        table,
        tableRole: 'links',
        // Declares the capability the `network`-scoped edits check for.
        supportsNetwork: true,
        // Channels this mark resolves ITSELF, with no scale: a side is a literal edge
        // name, an offset a fraction of an edge. Every channel `link` reads through
        // `rawChannel` belongs here — the list was four of seven once, so `curve`,
        // `arrow` and the label's `fontSize` resolved a global scale nothing read.
        rawChannels: [
            'sourceSide', 'targetSide',
            'sourceOffset', 'targetOffset', 'curve', 'arrow', 'fontSize',
        ],
        // A link spans between two positions; it has no opinion about the discrete
        // scale of an axis it crosses (same reasoning as rule).
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
            const join = resolveJoin(channels, opts, context, context ? context.table : '');
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
                    'table with `key: true` (e.g. id: { type: "categorical", key: true }), or pass ' +
                    'link({ key: "id" }). No links are drawn until it can.'
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
            // The node table's box rule: the box the mark DRAWING the nodes declares
            // (`Mark.nodeBox` — a dot's radius, a sticker's paper), handed over by the
            // engine. The same rule places the ports and tests a drop, so a link end,
            // a port and a drop target agree on where an edge is.
            const rule = (context && context.nodeBox) || null;
            // The node table's PORTS rule (a `ports` channel on the node mark): an end
            // on a node with ports meets it AT a port.
            const portsRule = (context && context.nodePorts) || null;
            // With no rule a node still needs a box to dock to. `inset` is the spec's
            // own "how far off a node does a link stop", so it doubles as the
            // half-extent.
            const extentW = (inset || DEFAULT_EXTENT) * 2;
            const extentH = (inset || DEFAULT_EXTENT) * 2;
            // Only a declared box makes a chord kind dock at the box instead of
            // insetting along the chord: the fallback is a guess, and clipping every
            // dot network's links at a guessed 12px square would shorten all of them.
            const sized = !!rule;

            // Whether source→target is a DIRECTION is the schema's statement, read
            // once here and passed down — never re-derived per row, and never
            // guessed from the column names.
            const directed = isDirected(spec);
            // `curvature: 'auto'` asks the TABLE how much to bow each row; a number
            // is the author overriding that with one value for every link.
            const autoBows = curvature === 'auto'
                ? separationBows(currentData, join.sourceField, join.targetField, directed, spread)
                : null;
            const loopRank = loopRanks(currentData, join.sourceField, join.targetField);

            // The label is NOT the line. `stroke`/`strokeWidth` on a link describe the
            // CONNECTOR, and resolveStyle sweeps the style channels onto every node a
            // mark emits — so a 2px connector stroke was painting a 2px outline around
            // every glyph of its own label, which reads as a smeared bold rather than
            // as text. The stroke family is dropped here for the same reason a
            // sticker's box channels stop at its label: one channel map, two surfaces,
            // and the paint that describes one is not the paint that describes the
            // other. What is left through is `fill` (with `opacity`), so `fill` is the
            // LABEL's colour on a link — a path's fill is 'none' by construction, and
            // an arrowhead takes the STROKE, so nothing else was reading it. With none
            // stated the label falls back to the text mark's own themed ink.
            const labelChannels = channels.text ? { ...channels } : null;
            if (labelChannels) {
                for (const key of LABEL_EXCLUDES) delete labelChannels[key];
            }
            // `true` means "the chart's own backdrop": a plate that reads as a hole in
            // the connector rather than as a coloured tag.
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

            // Every node's box, for a routed kind to dock to and to detour around.
            // Built on the first row that needs it — a chart of straight links never
            // pays for it — and ONCE per build, because "what else sits between these
            // two nodes" is a question about the TABLE, exactly like separationBows.
            // The routing grid is derived from the same boxes and shared the same way.
            /** @type {(import('./linkRouter.js').LinkBox | null)[] | null} */
            let boxes = null;
            /** @type {import('./linkRouter.js').LinkBox[]} */
            let obstacles = [];
            /** @type {import('./linkRouter.js').RoutingGrid | undefined} */
            let grid;
            const nodeBoxes = () => {
                if (boxes) return boxes;
                const built = nodeBoxesOf(
                    scales, channels, nodesTable, join.rows, rule, extentW, extentH, width, height
                );
                obstacles = /** @type {import('./linkRouter.js').LinkBox[]} */ (built.filter(Boolean));
                grid = routingGrid(obstacles);
                boxes = built;
                return built;
            };

            /** @type {import('../types').FeatureNode[]} */
            const out = [];

            currentData.forEach((d, index) => {
                const from = byKey.get(d ? d[join.sourceField] : undefined);
                const to = byKey.get(d ? d[join.targetField] : undefined);
                // A reference naming no node draws nothing. Half-formed rows are
                // invisible rather than drawn at the origin — with one exception: in
                // a GHOST build of a proposal, a row with ONE end resolving to nothing
                // is a link being drawn or rewired, and that free end is the pointer.
                // The band is routed exactly as the finished link would be, so what
                // you see while aiming is what you get on release.
                const pointer = context && context.ghost && context.ghost.pointer
                    ? context.ghost.pointer
                    : null;
                const freeFrom = !from && to && pointer ? pointer : null;
                const freeTo = !to && from && pointer ? pointer : null;
                const free = freeFrom || freeTo;
                if ((!from && !freeFrom) || (!to && !freeTo)) return;

                // Endpoints resolve through encodeChannel against the NODE row — the
                // one positional-resolution path, applied to the row that actually
                // carries the position. No direct scale() call, and no second
                // inversion path for an edit to have to mirror.
                // With a box rule, a node's centre is its box's — wherever the node
                // mark put it.
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

                // A row referencing one node twice has no chord to draw along, so it
                // takes the loop whatever the spec asked for — the alternative was
                // drawing nothing, which made a self-reference silently invisible.
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
                // A straight line cannot bow, so a pair that needs separating is
                // promoted to an arc. This is what makes `curvature: 'auto'` visible
                // on a default link() — the shape follows from the data having two
                // links between one pair, not from the spec naming a curve.
                if (kind === 'line' && bow) kind = 'arc';

                // How the shape wants to be fed is the SHAPE's statement, not a branch
                // on its name here: a point-to-point kind takes the chord already
                // pulled in, a box-docking kind takes the two centres and the boxes.
                const entry = LINK_SHAPES[kind];
                let seg;
                /** @type {import('./linkGeometry.js').LinkShapeOptions} */
                const shapeOpts = { loopRadius, cornerRadius: +cornerRadius || 0 };
                // Where each end meets its node: a pinned edge, or null to slide
                // along the box toward the other end. Read per row for every kind —
                // a straight or curved link honours a pinned side too.
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
                // The fallback boxes only guard a row byKey has already vetted: the
                // same encodeChannel reads as x1/y1 above, so a box IS its endpoint.
                const boxOf = (/** @type {number} */ i, /** @type {number} */ cx, /** @type {number} */ cy) =>
                    nodeBoxes()[i] || { cx, cy, hw: extentW / 2, hh: extentH / 2 };
                // A free end is a point, so a route runs straight to the pointer.
                const sourceBox = from ? boxOf(from.index, x1, y1) : { cx: x1, cy: y1, hw: 0, hh: 0 };
                const targetBox = to ? boxOf(to.index, x2, y2) : { cx: x2, cy: y2, hw: 0, hh: 0 };

                // A node with PORTS is met at a port: an unpinned end takes the usable
                // port facing the other end (leaving by an `out` side, arriving by an
                // `in`). A node without ports has none to take, and its ends slide.
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
                    // A loop has no other end to face: `loopSides` picks its edges
                    // from what the node allows and how many loops it already has.
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

                // The clearance each end needs: the CONNECTION BUFFER (`inset`, how far
                // off the node's shape a link stops), plus room for an arrowhead where
                // one is drawn. An end at a PORT takes no buffer — it connects to the
                // port itself. A chord shape gets it subtracted along the chord; a box
                // shape gets it as a gap off the edge it docks to.
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
                    // Docked on the node's box when one is declared; a guessed box
                    // would put the loop on a square nothing draws.
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
                    // A chord kind docks at the box: the chord is clipped where it
                    // leaves each node (plus the gap), or at a pinned edge's midpoint.
                    // That is what makes a straight link to a wide sticker end at the
                    // sticker, and what lets a curve leave a pinned edge square-on.
                    const ends = resolveEnds(
                        sourceBox, sourcePort, startGap,
                        targetBox, targetPort, endGap
                    );
                    // A ROUND node (a dot, an ellipse, a glyph's head) is met on its
                    // curve, not on the box around it: an unpinned end clipped at the
                    // box's corner stopped up to 41% of the radius further out on a
                    // diagonal. The gap grows both radii alike.
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

                // `"auto"` fans siblings a fraction of the chord apart, which on a short
                // chord puts two LABELLED siblings' labels on top of each other. Widen
                // the fan just enough that each step clears a label — for every
                // sibling of the pair alike, since they share the chord.
                if (autoBows && bow && labelChannels && entry.anchors === 'chord' && !selfLoop) {
                    const chord = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                    const step = spread * chord / 2;
                    const fontPx = +rawChannel(channels, 'fontSize', d, 12, index, currentData) || 12;
                    const need = fontPx + labelPadding * 2 + 2;
                    if (step > 0 && step < need) {
                        bow = Math.sign(bow) * Math.min(Math.abs(bow) * (need / step), MAX_AUTO_BOW);
                    }
                }

                const style = resolveStyle(scales, channels, d, defaults, index, currentData);
                const shape = entry.build(seg, bow, shapeOpts);
                // A shape may decline the row — two concentric boxes have no side
                // facing anything — the same way an inset consumed by overlap does.
                if (!shape) return;

                // FIRST, so it stays beneath the paint. A thin stroke is nearly
                // impossible to grab and a `d`-only path is invisible to the pick
                // layer entirely; this is what gives a link body something to hit.
                // It leaves `pointerEvents` unset so the engine can silence it when
                // the mark carries no direct-pick edit.
                // Where an inline editor goes, stated because a PATH cannot be asked.
                // The renderer's fallback reads `d.x`/`d.y` off the node — a label
                // hanging off a dot — and a path has neither, so double-clicking a
                // connector to retype it mounted the editor at x="NaN". A link's
                // typable surface is its BODY (the same reason a sticker's is its box,
                // not its letters: the label is a few px of glyph on a line you can
                // grab anywhere), so every node of the row declares the one box, at the
                // midpoint where the label itself sits.
                const labelSize = +rawChannel(channels, 'fontSize', d, 12, index, currentData) || 12;
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
                        // Round, so the hit area covers the very ends: an end handle
                        // sits ON the end, and is shown only while the link is
                        // hovered — pointing straight at it must hover the link.
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
                    ...(shape.d ? { d: shape.d } : { points: shape.points, curve: shape.curve }),
                    ...style,
                    fill: 'none',
                    // A link with no target yet is a distinct STATE, not a theme
                    // choice: dashed, so the band reads as "not yet a link".
                    ...(free ? { strokeDasharray: '4 3' } : {}),
                    editBox,
                    data: d,
                    index,
                });

                // Direction, as a filled triangle at whichever ends carry one. The
                // tangent comes from the shape, so an arrow caps a step's axis-aligned
                // approach and an arc's true tangent without either being special-cased.
                // At the SHAPE's own endpoints, not the segment's. The two are the same
                // for a chord kind and differ for a box-docking one, and using the
                // segment meant pairing a point on the chord with a tangent that no
                // longer ran along it — which is why a step's arrowhead sat off the
                // end of its own line.
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

                // A link's own content, on the path rather than on the chord — a
                // label at the chord midpoint of a strongly bowed arc sits off the
                // line entirely.
                if (labelChannels) {
                    const label = Object.assign(
                        textNodeAt(scales, labelChannels, d, index, shape.mid.x, shape.mid.y, {
                            format, data: currentData,
                        }),
                        // The same box, so the editor lands in one place whether the
                        // double-click caught the label or the line under it.
                        { editBox }
                    );
                    // The plate goes in FIRST, so it masks the connector and the label
                    // sits on it. Sized from the SAME measurement the text is drawn at
                    // (core/measure.js, the one measuring path) and placed off the
                    // label's own anchors — a plate that assumed a centred label would
                    // slide off the moment a spec set `textAnchor`.
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

                // Endpoint handles — only where an edit writes that end, tagged with the
                // end so the edit knows which column it moves. Shown only while the
                // link is hovered, selected or grabbed, and painted above the nodes
                // (`raise`): an end sits on a node's edge, beside that node's port, and
                // hidden it takes no pointer events, so it never steals a press meant
                // for the port.
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
