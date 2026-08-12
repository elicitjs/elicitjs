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
// Endpoint HANDLES appear only when `source`/`target` carries an edit — the same
// "inert until the spec names the column" rule every mark follows. Two handles on
// one feature means they arbitrate, so each is tagged `node.channel` and guarded by
// `claimEdge` (the trend/area pattern), never by a hand-written `when`.

import {
    encodeChannel, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, resolveHandles, markCommon,} from './mark.js';
import { textNodeAt, rawChannel } from './text.js';
import { measureBlock } from '../core/measure.js';
import { LINK_SHAPES, LINK_CURVES, LINK_SIDES } from './linkGeometry.js';
import { HIT_WIDTH } from './hitpath.js';
import { isDirected } from '../core/schema.js';
import { resolveFormat } from '../format.js';
import { warn } from '../core/dev.js';

// Apex offset, as a fraction of the chord, between adjacent links of one pair when
// `curvature: 'auto'` fans them apart.
const AUTO_SPREAD = 0.16;

// How far a self-loop reaches from its node, in px, when the spec names no size.
const LOOP_RADIUS = 22;

// Half-extent a routed connector assumes for a node whose size the spec never
// states, in px. Small enough to read as "just off the point", so a bare
// `curve: 'orthogonal'` on a dot network still leaves each node square-on.
const DEFAULT_EXTENT = 12;

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
    // The node column that holds identities. `key` is the schema's answer; `key:` on
    // the mark is the override for a table that declares none.
    const keyField = options.key || nodes.key;

    return {
        rows: (context.tables && context.tables[nodesName]) || [],
        nodesName,
        sourceField,
        targetField,
        keyField,
    };
}

/**
 * Which channels place a NODE. The link reads its endpoints through these against
 * the node row, so a link is self-contained: it does not depend on which mark
 * happens to draw the nodes, or on that mark existing at all.
 * @param {Record<string, any>} channels
 * @param {any} nodes the nodes TableSchema
 * @returns {Record<string, any>}
 */
export function nodeChannelsOf(channels, nodes) {
    const has = (/** @type {string} */ f) => !!(nodes && nodes.fields[f]);
    return {
        x: channels.x || (has('x') ? { field: 'x' } : undefined),
        y: channels.y || (has('y') ? { field: 'y' } : undefined),
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
 * A node's half-extents, for the kinds that dock to a BOX rather than to a point.
 *
 * Read off the NODE row through `rawChannel`, so `nodeWidth` is a constant on the
 * mark, a column on the node table, or a derived `{ fn }` — the same three forms
 * `curve` and `arrow` already take. This is the only way the size can reach here:
 * asking the mark that draws the nodes what it drew would be a mark reading another
 * feature's geometry, which nothing in this library is allowed to do.
 * @param {Record<string, any>} channels
 * @param {any} row the NODE row @param {number} index its index in the node table
 * @param {any[]} rows the node table
 * @param {number} w default width @param {number} h default height
 * @returns {{ hw: number, hh: number }}
 */
function nodeExtentOf(channels, row, index, rows, w, h) {
    const width = +rawChannel(channels, 'nodeWidth', row, w, index, rows);
    const height = +rawChannel(channels, 'nodeHeight', row, h, index, rows);
    return {
        hw: (Number.isFinite(width) ? width : w) / 2,
        hh: (Number.isFinite(height) ? height : h) / 2,
    };
}

/**
 * An edge an author named, or `'auto'`.
 *
 * A side is PRESENTATION, not data. It is read raw like `curve` and `arrow`, so it
 * is a mark option by default and becomes a column only if the spec points it at a
 * `{ field }` — which is what keeps a drawing preference out of an elicited dataset
 * unless the author decides it belongs there.
 * @param {any} value @param {string} which the option's name, for the message
 * @returns {string}
 */
function resolveSide(value, which) {
    if (value === undefined || value === null || value === 'auto') return 'auto';
    const v = String(value);
    if (LINK_SIDES.includes(v)) return v;
    warn(
        `link:side:${v}`,
        `link() got ${which}: ${JSON.stringify(value)}, which is not an edge. Use ` +
        `${LINK_SIDES.map((s) => `"${s}"`).join(', ')}, or "auto" to let the two nodes' ` +
        `relative position choose. Routing automatically.`
    );
    return 'auto';
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
 * link — one row of the links table drawn between the nodes it references.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function link(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'link',
        allow: [
            'key', 'curve', 'curvature', 'spread', 'arrow', 'arrowSize',
            'inset', 'sourceInset', 'targetInset', 'loopRadius', 'table', 'format',
            'labelBackground', 'labelPadding', 'labelRadius', 'labelOpacity',
            'nodeWidth', 'nodeHeight', 'cornerRadius', 'sourceSide', 'targetSide',
        ],
    });
    const {
        channels = {}, id, edits, constraints, table,
        key, curve = 'line', curvature = 'auto', spread = AUTO_SPREAD,
        arrow = 'auto', arrowSize = 6, loopRadius = LOOP_RADIUS,
        inset = 0, sourceInset, targetInset, format: formatOpt,
        nodeWidth, nodeHeight, cornerRadius = 0,
        sourceSide = 'auto', targetSide = 'auto',
        labelBackground, labelPadding = LABEL_PADDING,
        labelRadius = LABEL_RADIUS, labelOpacity = LABEL_OPACITY,
    } = opts;

    const format = resolveFormat(formatOpt);
    /** @type {Record<string, boolean>} */
    const handleEdits = {
        source: !!(channels.source && channels.source.edit),
        target: !!(channels.target && channels.target.edit),
    };

    return {
        ...markCommon(opts),
        markName: 'link',
        channels,
        // Explicit name wins; otherwise the table filling the `links` role — which is
        // what lets a renamed schema work with no `table:` anywhere.
        table,
        tableRole: 'links',
        // Declares the capability the `network`-scoped edits check for.
        supportsNetwork: true,
        // Channels this mark resolves ITSELF, with no scale. The node extents name
        // columns of the NODE table — which the chart's scale pass cannot see, since
        // it resolves a mark's channels against the mark's own table — and a side is
        // a literal edge name. Declaring them keeps a well-declared `nodeWidth` from
        // being reported as an undeclared field.
        rawChannels: ['nodeWidth', 'nodeHeight', 'sourceSide', 'targetSide'],
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
            // A node with no stated size still needs a box to dock to. `inset` is the
            // spec's own "how far off a node does a link stop", so it doubles as the
            // half-extent when nothing better is declared.
            const extentW = +nodeWidth || (inset || DEFAULT_EXTENT) * 2;
            const extentH = +nodeHeight || (inset || DEFAULT_EXTENT) * 2;

            // Whether source→target is a DIRECTION is the schema's statement, read
            // once here and passed down — never re-derived per row, and never
            // guessed from the column names.
            const directed = isDirected(spec);
            // `curvature: 'auto'` asks the TABLE how much to bow each row; a number
            // is the author overriding that with one value for every link.
            const autoBows = curvature === 'auto'
                ? separationBows(currentData, join.sourceField, join.targetField, directed, spread)
                : null;

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

            /** @type {import('../types').FeatureNode[]} */
            const out = [];

            currentData.forEach((d, index) => {
                const from = byKey.get(d ? d[join.sourceField] : undefined);
                const to = byKey.get(d ? d[join.targetField] : undefined);
                // A reference naming no node draws nothing. Half-formed rows are
                // invisible rather than drawn at the origin.
                if (!from || !to) return;

                // Endpoints resolve through encodeChannel against the NODE row — the
                // one positional-resolution path, applied to the row that actually
                // carries the position. No direct scale() call, and no second
                // inversion path for an edit to have to mirror.
                const x1 = encodeChannel(scales, nodeChannels, 'x', from.row, width / 2, from.index, join.rows);
                const y1 = encodeChannel(scales, nodeChannels, 'y', from.row, height / 2, from.index, join.rows);
                const x2 = encodeChannel(scales, nodeChannels, 'x', to.row, width / 2, to.index, join.rows);
                const y2 = encodeChannel(scales, nodeChannels, 'y', to.row, height / 2, to.index, join.rows);

                const selfLoop = from.index === to.index;
                const arrows = resolveArrow(
                    rawChannel(channels, 'arrow', d, arrow, index, currentData), directed
                );
                const bow = autoBows ? autoBows[index] : +curvature || 0;

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

                // The clearance each end needs: the spec's inset, plus room for an
                // arrowhead where one is drawn. A chord shape gets it subtracted along
                // the chord; a box shape gets it as a gap off the edge it docks to.
                const startGap = startInset + (arrows.source ? arrowSize : 0);
                const endGap = endInset + (arrows.target ? arrowSize : 0);

                // How the shape wants to be fed is the SHAPE's statement, not a branch
                // on its name here: a point-to-point kind takes the chord already
                // pulled in, a box-docking kind takes the two centres and the boxes.
                const entry = LINK_SHAPES[kind];
                let seg;
                /** @type {import('./linkGeometry.js').LinkShapeOptions} */
                const shapeOpts = { loopRadius, cornerRadius: +cornerRadius || 0 };
                if (entry.anchors === 'box') {
                    seg = { x1, y1, x2, y2 };
                    const a = nodeExtentOf(channels, from.row, from.index, join.rows, extentW, extentH);
                    const b = nodeExtentOf(channels, to.row, to.index, join.rows, extentW, extentH);
                    shapeOpts.source = { cx: x1, cy: y1, hw: a.hw, hh: a.hh };
                    shapeOpts.target = { cx: x2, cy: y2, hw: b.hw, hh: b.hh };
                    shapeOpts.sourceGap = startGap;
                    shapeOpts.targetGap = endGap;
                    shapeOpts.sourceSide = resolveSide(
                        rawChannel(channels, 'sourceSide', d, sourceSide, index, currentData), 'sourceSide'
                    );
                    shapeOpts.targetSide = resolveSide(
                        rawChannel(channels, 'targetSide', d, targetSide, index, currentData), 'targetSide'
                    );
                } else {
                    seg = selfLoop
                        ? { x1, y1, x2: x1, y2: y1 }
                        : insetSegment(x1, y1, x2, y2, startGap, endGap);
                }
                if (!seg) return;

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

                // Endpoint handles — only where the spec put an edit, and tagged so
                // claimEdge can keep a drag on one end off the other.
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
                        data: d,
                        index,
                    });
                }
            });

            return out;
        },
    };
}
