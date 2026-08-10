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
//   plot.link({ curve: 'arc', arrow: true })
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
// One path per link row, carrying that row's `index` and `data`, so the universal
// edits (`remove`, `set`, `cycle`, `editText`) act on a link exactly as they act on
// any other mark's datum. A row whose source or target names no node emits nothing:
// that is how a link mark over a mixed table draws only what it can, and why a
// half-formed row is invisible rather than drawn at the origin.
//
// Endpoint HANDLES appear only when `source`/`target` carries an edit — the same
// "inert until the spec names the column" rule every mark follows. Two handles on
// one feature means they arbitrate, so each is tagged `node.channel` and guarded by
// `claimEdge` (the trend/area pattern), never by a hand-written `when`.

import {
    encodeChannel, resolveStyle, normalizeMarkOptions, themeOf, markDefaults, resolveHandles, markCommon,} from './mark.js';
import { textNodeAt, hasEditText } from './text.js';
import { resolveFormat } from '../format.js';
import { warn } from '../core/dev.js';

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
 * A quadratic arc bowed to one side, for parallel links that would otherwise overlap.
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {number} curvature
 * @returns {{ d: string, mx: number, my: number }}
 */
function arcPathBetween(x1, y1, x2, y2, curvature) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    // Control point offset along the segment's normal.
    const cx = mx - dy * curvature;
    const cy = my + dx * curvature;
    return { d: `M${x1},${y1}Q${cx},${cy} ${x2},${y2}`, mx: (mx + cx) / 2, my: (my + cy) / 2 };
}

/**
 * link — one row of the links table drawn between the nodes it references.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function link(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'link',
        allow: ['key', 'curve', 'curvature', 'arrow', 'arrowSize', 'inset', 'sourceInset', 'targetInset', 'table', 'format'],
    });
    const {
        channels = {}, id, edits, constraints, table,
        key, curve = 'line', curvature = 0.2, arrow = false, arrowSize = 6,
        inset = 0, sourceInset, targetInset, format: formatOpt,
    } = opts;

    const canEditText = hasEditText(edits, channels);
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

                const seg = insetSegment(x1, y1, x2, y2, startInset, endInset + (arrow ? arrowSize : 0));
                if (!seg) return;

                const style = resolveStyle(scales, channels, d, defaults, index, currentData);
                const arced = curve === 'arc';
                const geom = arced
                    ? arcPathBetween(seg.x1, seg.y1, seg.x2, seg.y2, curvature)
                    : { d: `M${seg.x1},${seg.y1}L${seg.x2},${seg.y2}`, mx: (seg.x1 + seg.x2) / 2, my: (seg.y1 + seg.y2) / 2 };

                out.push({
                    type: 'path',
                    d: geom.d,
                    ...style,
                    fill: 'none',
                    data: d,
                    index,
                });

                // Direction, as a filled triangle at the target end. Drawn from the
                // segment's own vector so it points the way the line actually goes,
                // arc included.
                if (arrow) {
                    const ax = seg.x2;
                    const ay = seg.y2;
                    const dx = ax - (arced ? geom.mx : seg.x1);
                    const dy = ay - (arced ? geom.my : seg.y1);
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    const w = arrowSize * 0.5;
                    out.push({
                        type: 'path',
                        d: `M${ax + ux * arrowSize},${ay + uy * arrowSize}`
                            + `L${ax - uy * w},${ay + ux * w}`
                            + `L${ax + uy * w},${ay - ux * w}Z`,
                        fill: style.stroke || defaults.stroke,
                        stroke: 'none',
                        data: d,
                        index,
                    });
                }

                // A link's own content, at the midpoint. Same text plumbing every
                // other mark uses, so editText() works on a link unchanged.
                if (channels.text) {
                    out.push(textNodeAt(scales, channels, d, index, geom.mx, geom.my, {
                        format, canEditText, data: currentData,
                    }));
                }

                // Endpoint handles — only where the spec put an edit, and tagged so
                // claimEdge can keep a drag on one end off the other.
                for (const [name, pt] of /** @type {[string, {x:number,y:number}][]} */ ([
                    ['source', { x: seg.x1, y: seg.y1 }],
                    ['target', { x: seg.x2, y: seg.y2 }],
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
