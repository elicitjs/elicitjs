// @ts-check
import { SceneGraph, paintOrder } from '../scene.js';
import { resolveScales } from '../resolve.js';
import { createProjection } from '../projection.js';
import { parsePath, flatten } from '../../plot/shapes.js';
import { isNodeLocked } from '../lock.js';
import { collectEdits, resolveChannels, warnMisplacedEdits } from '../../edit/route.js';
import { hitTestAny, pointInPolygon } from '../../edit/pick.js';
import { portKey } from '../../plot/port.js';
import { needsPlaneOnTop } from '../../edit/drivers/index.js';
import { stateEffectNodes, outlineNodes, effectStyleFor, othersOf } from '../effects.js';
import { neighboursOf } from '../neighbours.js';
import { panelNodes } from '../panel.js';
import { reserveLegends } from '../legends.js';
import { reserveTitles, titleNodes } from '../titles.js';
import { treeOf } from '../hierarchy.js';
import { layoutIO } from '../fit.js';
import { createMotion, easeRows } from '../motion.js';
import { createNodeMotion } from './carry.js';
import { fieldsOf } from '../schema.js';
import { cursorFor, planeCursorFor } from '../../edit/cursor.js';
import {
    markLabel,
    warnScaleRequirements, warnScopeMismatch, warnProjectionCartesianMix, warnImageSupport,
    warnDuplicatePlaneEdits, warnUnreachableLegendRow, warnConnectConflict, warnNestAlone,
    warnCreateOnNonMark, warnCreateEmptyExtent, warnDeadEditChannels, warnMissingEditChannels, warnHiddenHandles,
    warnUnclaimedPick, warnUnknownEditOptions, warnNoTextEditor,
} from '../guards.js';

/**
 * Dim a ghost-preview node in place: scale its opacity by theme.ghost's and apply
 * any ghost fill/stroke/dash.
 * @param {any} node @param {any} ghost the theme.ghost tokens
 */
function applyGhostStyle(node, ghost) {
    const g = ghost || {};
    const base = node.opacity != null ? node.opacity : 1;
    node.opacity = base * (g.opacity != null ? g.opacity : 0.45);
    if (g.fill != null) node.fill = g.fill;
    if (g.stroke != null) node.stroke = g.stroke;
    if (g.strokeDash != null) node.strokeDasharray = g.strokeDash;
}


/**
 * @typedef {object} RenderDeps
 * @property {any[]} features
 * @property {Map<string, any>} featureById
 * @property {any} ui
 * @property {import('../../types').ChartSpec} spec
 * @property {any} theme
 * @property {any} effects
 * @property {any} renderer
 * @property {import('../../types').Look[]} looks
 * @property {'fixed' | 'scale' | 'reflow'} mode
 * @property {any} overflow
 * @property {any} focusOutline
 * @property {number} designW
 * @property {{ top: number, right: number, bottom: number, left: number }} authorMargins
 * @property {{ width: number, height: number }} dims
 * @property {any} liveSpec
 * @property {Record<string, import('../../types').FieldSchema>} schema
 * @property {import('../../types').SchemaSpec} schemaSpec
 * @property {any[]} allGuides
 * @property {import('../../types').Constraint[]} datasetConstraints
 * @property {boolean} tracksPointer
 * @property {boolean} hasLegends
 * @property {boolean} hasAxisTitles
 * @property {Record<string, any[]>} featureNodes
 * @property {string | null} hierarchyNodes
 * @property {boolean} hasLayout
 * @property {string[]} layoutTables
 * @property {any[]} boxHosts
 * @property {(table: string) => any[]} boxHostsOf
 * @property {(feature: any) => any[]} tableOf
 * @property {(feature: any, edit: import('../../types').Edit) => string} targetTableOf
 * @property {() => any[]} primaryRows
 * @property {(name: string) => ((d: any, i: number) => boolean) | null} isLockedIn
 * @property {(table: string) => import('../../types').Constraint[]} constraintsIn
 * @property {() => import('../../types').NodeBoxRule | null} nodeBoxRule
 * @property {((row: any, i: number, rows: any[]) => Record<string, string> | null) | null} nodePortsRule
 * @property {() => boolean} settleOwn  settle at render time when this chart may (engine/nodes.js)
 * @property {() => void} layoutMoved  that settle changed the rows: redraw the other charts
 * @property {(from: Record<string, any[]>, before: any[] | null, frozen: Set<number> | null, dodge?: any, table?: string | null) => any[]} settledNodes
 * @property {() => Set<number> | null} heldStill
 * @property {() => number[] | null} inFlight
 * @property {(feature: any) => import('../../types').Edit[]} activeEdits
 * @property {() => number} getStage
 * @property {(table: string) => Set<number>} selectionIn
 * @property {(table?: string) => number[]} selectionList
 * @property {() => number | null} selectionPrimary
 * @property {() => { table: string, index: number } | null} hoverRow  the dataset's hovered row
 * @property {() => true | false | 'receive'} hoverLink  is this chart's hover the dataset's?
 * @property {() => boolean} hoverWide  does a hover light its row in every mark over the table?
 * @property {(feature: any, node: any) => boolean} portAvailable
 * @property {(node: any) => string} handleKey
 * @property {() => any} clipNow
 * @property {(nodes: any[], x: number, y: number) => any[]} visibleAt
 * @property {(event: any) => any} handleEvent
 * @property {number} motionDuration  ms an eased change takes to settle; 0 for none
 */

/**
 * Rendering: the chart's container and size, and `update()`, which rebuilds the
 * scene graph from current state in named passes and hands it to the renderer.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {RenderDeps} deps
 */
export function createRender(chart, deps) {
    const {
        features, featureById, ui, spec, theme, effects, looks, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, hasLayout, layoutTables, boxHosts, boxHostsOf, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleOwn, layoutMoved, settledNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, hoverRow, hoverLink, hoverWide, portAvailable, handleKey, clipNow, visibleAt, motionDuration,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);
    // Does this feature draw the dataset's rows? Elements draw a scale, and map
    // chrome (`views: 'state'` on a mark) draws its own shapes.
    const drawsRows = (/** @type {any} */ f) => !f.views || f.views === 'data';

    // Set up container. 'fixed' pins pixel dims; 'scale' and 'reflow' fill the parent's width.
    const container = document.createElement('div');
    container.style.position = 'relative';
    if (mode === 'scale') {
        container.style.width = '100%';
        container.style.height = 'auto';
    } else if (mode === 'reflow') {
        container.style.width = '100%';
        container.style.height = `${chart.curH}px`;
    } else {
        container.style.width = `${chart.curW}px`;
        container.style.height = `${chart.curH}px`;
    }

    // recomputeInner: inner dims from outer dims minus margins. measure (reflow only):
    // re-read the container width; returns whether it changed.
    const recomputeInner = () => {
        chart.innerWidth = chart.curW - chart.effectiveMargins.left - chart.effectiveMargins.right;
        chart.innerHeight = chart.curH - chart.effectiveMargins.top - chart.effectiveMargins.bottom;
        dims.width = chart.innerWidth;
        dims.height = chart.innerHeight;
    };
    const measure = () => {
        if (mode !== 'reflow') return false;
        const w = container.clientWidth || designW;
        if (w > 0 && w !== chart.curW) {
            chart.curW = w;
            recomputeInner();
            return true;
        }
        return false;
    };

    // Adopt new outer pixel dims (axis drag in `grow` mode) on the chart and container.
    /** @param {{ width?: number, height?: number }} size */
    const applyResize = (size) => {
        if (typeof size.width === 'number' && size.width > 0) chart.curW = size.width;
        if (typeof size.height === 'number' && size.height > 0) chart.curH = size.height;
        if (mode === 'fixed') {
            container.style.width = `${chart.curW}px`;
            container.style.height = `${chart.curH}px`;
        } else if (mode === 'reflow') {
            container.style.height = `${chart.curH}px`;
        }
        recomputeInner();
    };

    const scene = new SceneGraph();

    // Titles wrap to the chart width from the plot's left edge.
    const titleWidth = () => Math.max(0, chart.curW - chart.effectiveMargins.left - 4);

    // LAYOUT: reserve the legend, axis-title and chart-title bands, and size the plot
    // rect.
    const layoutPass = () => {
        // Legend bands depend only on scale domains, so one provisional resolve is
        // enough. Bands from inside out: author margin (axes), legends, titles.
        chart.effectiveMargins = { ...authorMargins };
        recomputeInner();
        let legendBands = { top: 0, right: 0, bottom: 0, left: 0 };
        // An axis title reserves only what it needs beyond the author's margin.
        /** @type {Record<string, number>} */
        const axisBands = { top: 0, right: 0, bottom: 0, left: 0 };
        if (hasLegends || hasAxisTitles) {
            const provisional = resolveScales(features, chart.tables, liveSpec, dims);
            /** @type {any} */ (provisional).theme = theme; // measure reads legend font tokens
            if (hasLegends) legendBands = reserveLegends(features, provisional, authorMargins, 8, dims);
            for (const f of features) {
                if (!f || !f.isAxis || typeof f.measureTitle !== 'function') continue;
                const side = f.anchor || (f.channel === 'y' ? 'left' : 'bottom');
                if (!(side in axisBands)) continue;
                const need = f.measureTitle(provisional) || 0;
                const short = need - /** @type {any} */ (authorMargins)[side];
                if (short > axisBands[side]) axisBands[side] = short;
            }
        }
        chart.effectiveMargins = {
            top: authorMargins.top + axisBands.top + legendBands.top,
            right: authorMargins.right + axisBands.right + legendBands.right,
            bottom: authorMargins.bottom + axisBands.bottom + legendBands.bottom,
            left: authorMargins.left + axisBands.left + legendBands.left,
        };
        // Reserved once the left margin is known, at the width the titles are drawn at.
        const titleBands = reserveTitles(spec, theme, titleWidth());
        chart.effectiveMargins.top += titleBands.top;
        chart.effectiveMargins.bottom += titleBands.bottom;
        recomputeInner();
    };

    // SCALES: re-resolve the global scales from the live data, stamp the reserved keys on
    // the scale map, and settle a hierarchy. Returns whether the settle moved rows.
    const resolvePass = () => {
        chart.scales = resolveScales(features, chart.tables, liveSpec, dims);
        // Reserved non-Scale keys on the scale map, shared by build() and edit ctx:
        // projection, theme, selection (first selected primary row, or null),
        // selectionAll (every selected row per table), and schema.
        const projection = createProjection(liveSpec.projection, dims);
        if (projection) /** @type {any} */ (chart.scales).projection = projection;
        /** @type {any} */ (chart.scales).theme = theme;
        /** @type {any} */ (chart.scales).selection = selectionPrimary();
        /** @type {any} */ (chart.scales).selectionAll = selectionList;
        /** @type {any} */ (chart.scales).schema = schema;
        warnProjectionCartesianMix(features, chart.scales);
        // Settle the hierarchy against the current scales, if this chart's pixels
        // are the ones its rows are settled in. Another chart's rows are drawn as stored.
        return settleOwn();
    };

    // PLANE: whether the interaction plane sits on top, listens to the wheel, and which
    // cursor it shows.
    const planeState = () => {
        // The plane sits on top when an active edit picks from the pointer position
        // (nearest/sweep/draw/brush). Per render, since the active set changes with the stage.
        const planeOnTop = features.some(feature => needsPlaneOnTop(activeEdits(feature)));
        const hasWheel = features.some(feature => activeEdits(feature).some(e => e.gesture === 'wheel'));
        chart.planeRaised = planeOnTop;
        // Resting cursor from the plane-picked edits; a hover or session overrides it.
        let planeCursor = planeOnTop
            ? planeCursorFor(features.map(feature => ({
                feature, edits: activeEdits(feature).filter(e => e.pick !== 'direct'),
            })), chart.scales)
            : 'pointer';
        // Over a grabbable mark, show its cursor; else a driver's session cursor hint.
        const hoveredNode = planeOnTop && ui.hover && ui.hover.node;
        if (hoveredNode && hoveredNode.editable) planeCursor = hoveredNode.cursor || 'move';
        else if (planeOnTop && ui.session) {
            for (const fid of Object.keys(ui.session)) {
                const cur = ui.session[fid] && ui.session[fid].cursor;
                if (cur) { planeCursor = cur; break; }
            }
        }
        return { planeOnTop, hasWheel, planeCursor };
    };

    // Motion (core/motion.js): what is drawn eases to where it belongs. Each client
    // opens a track; `update()` starts the frame and keeps rendering until all arrive.
    const motion = motionDuration > 0 ? createMotion(motionDuration) : null;
    // Spatial layouts are one client: each layout table's rows ease to where they settle.
    /** @type {Map<string, any>} */
    const layoutTracks = new Map();
    if (motion && hasLayout) {
        for (const t of layoutTables) layoutTracks.set(t, motion.track(`layout:${t}`));
    }
    /** A container that is changing size takes this much longer, so its contents are seen to move first. */
    const CONTAINER_LAG = 1.4;
    /** @type {Map<string, string>} */
    const layoutSigs = new Map();
    /** Changes when a scale or the plot size does: pixels before and after are not comparable.
     *  @param {string} table */
    const layoutSignature = (table) => layoutIO(chart.scales, boxHostsOf(table))
        .map((io) => `${io.field}:${io.invert(0)}:${io.invert(100)}`).join('|')
        + `|${chart.innerWidth}|${chart.innerHeight}`;
    // The other client: a mark with `motion: true` eases its built nodes (engine/carry.js).
    const nodeMotion = createNodeMotion(chart, {
        motion, features, featureById, ui, featureNodes, activeEdits, handleKey, schemaSpec,
    });
    /**
     * The rows of `table` to draw this frame, on their way to `rows`.
     * @param {string} table
     * @param {any[]} rows @param {Set<number>} flying rows the pointer carries
     * @param {(i: number) => boolean} isContainer
     * @param {boolean} snapAll data arrived from outside: draw at once
     */
    const easedLayout = (table, rows, flying, isContainer, snapAll) => {
        const track = layoutTracks.get(table);
        const hosts = boxHostsOf(table);
        const columns = layoutIO(chart.scales, hosts);
        const sig = `${layoutSignature(table)}|${rows.length}`;
        const snap = sig !== (layoutSigs.get(table) || '') || snapAll;
        layoutSigs.set(table, sig);
        const sizes = columns.filter((c) => c.extent).map((c) => c.field);
        const keyCol = schemaSpec.tables[table] && schemaSpec.tables[table].key;
        return easeRows(track, rows, columns, {
            keyOf: (row, i) => (keyCol && row[keyCol] != null ? row[keyCol] : `#${i}`),
            snap,
            fixed: (i) => flying.has(i),
            slow: (i, was, goal) => (isContainer(i) && sizes.some((f) => Math.abs(was[f] - goal[f]) > 0.25) ? CONTAINER_LAG : 1),
        });
    };
    /** The pending animation frame, or 0. */
    let frame = 0;
    const raf = (/** @type {() => void} */ cb) => (typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(cb) : /** @type {any} */ (setTimeout(cb, 16)));
    const stopMotion = () => {
        if (!frame) return;
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); else clearTimeout(frame);
        frame = 0;
    };
    /** The stroke's settled rows per table, kept between frames while nothing they read changed. */
    /** @type {Map<string, { key: any[], rows: any[] }>} */
    const strokeMemos = new Map();
    /** @param {string} table */
    const strokeRows = (table) => {
        const isHierarchy = table === hierarchyNodes;
        const held = isHierarchy ? heldStill() : null;
        const settle = () => settledNodes(chart.tables, null, null, {
            since: chart.strokeNodes, preview: true, keepSize: held,
            yields: chart.strokeRow != null ? new Set([chart.strokeRow]) : null,
        }, table);
        if (!layoutTracks.has(table)) return settle();
        const nesting = isHierarchy ? schemaSpec.byRole.nesting : null;
        const key = [chart.tables[table], nesting ? chart.tables[nesting] : null,
            chart.strokeNodes, chart.strokeRow, held ? [...held].join() : '', layoutSignature(table)];
        const memo = strokeMemos.get(table);
        if (!memo || key.some((k, i) => k !== memo.key[i])) {
            const next = { key, rows: settle() };
            strokeMemos.set(table, next);
            return next.rows;
        }
        return memo.rows;
    };

    // The tables as drawn. While a row of a layout table is dragged, its rows are
    // drawn as a release would leave them: a nest proposal's layout (`live`) when a
    // hierarchy node would change container, else the committed rows settled around
    // the stroke. So the drag shows containers growing/shrinking and siblings making
    // room. Rows in flight stay committed, so the dragged mark follows the pointer.
    /** @param {boolean} snapAll */
    const liveTables = (snapAll) => {
        if (!hasLayout) return chart.tables;
        /** @type {Record<string, any[]> | null} */
        let overrides = null;
        const grabbed = ui.grab ? featureById.get(ui.grab.featureId) : null;
        for (const table of layoutTables) {
            const committed = chart.tables[table] || [];
            const isHierarchy = table === hierarchyNodes;
            const live = isHierarchy ? Object.values(ui.preview || {}).find((p) => p && p.live && p.table === table) : null;
            /** @type {any[] | null} */
            let rows = live && live.rows.length === committed.length ? live.rows : null;
            if (!rows && chart.stroking && chart.strokeTable === table && chart.strokeNodes) {
                rows = strokeRows(table);
            }
            const hasTrack = layoutTracks.has(table);
            if (!hasTrack && (!rows || rows === committed)) continue;
            const tree = isHierarchy ? treeOf(schemaSpec, chart.tables) : null;
            const roots = isHierarchy ? [...(inFlight() || [])] : [];
            if (grabbed && grabbed.table === table && ui.grab.index != null) roots.push(ui.grab.index);
            const flying = new Set(tree ? roots.flatMap((i) => [i, ...tree.descendantsOf(i)]) : roots);
            // Any other row the stroke itself is writing follows the pointer too.
            const before = chart.stroking && chart.strokeTable === table ? chart.strokeNodes : null;
            if (before && before.length === committed.length) {
                committed.forEach((row, i) => { if (row !== before[i]) flying.add(i); });
            }
            let drawn = rows && rows !== committed
                ? rows.map((row, i) => (flying.has(i) ? committed[i] : row))
                : committed;
            if (hasTrack) drawn = easedLayout(table, drawn, flying, (i) => (tree ? tree.hasChildren(i) : false), snapAll);
            if (drawn !== committed) (overrides || (overrides = {}))[table] = drawn;
        }
        return overrides ? { ...chart.tables, ...overrides } : chart.tables;
    };

    // BUILD: build every feature from its committed rows, tag its nodes for dispatch, and
    // add them to the scene in paint order with the panel and titles.
    const buildPass = () => {
        warnDuplicatePlaneEdits(features, activeEdits, targetTableOf);
        warnUnreachableLegendRow(features, activeEdits, tableOf);

        // Built nodes per feature, ordered by `paintOrder` once all are known.
        /** @type {{ glyph?: string, nodes: any[] }[]} */
        const built = [];
        // Data from outside is drawn at once by both motion clients.
        const snapAll = chart.snapNext;
        chart.snapNext = false;
        const drawn = liveTables(snapAll);

        features.forEach(feature => {
            // A feature draws its committed rows, or a live proposal's. Any other
            // proposal is drawn by ghostPass.
            const currentData = drawn[feature.table] || [];
            const isLocked = isLockedIn(feature.table);
            // Row handles are dropped on locked rows and when no edit is active.
            // Dropped before featureNodes is written, so picking never sees them.
            const hasLiveEdit = activeEdits(feature).length > 0;
            const nodes = feature.build(currentData, chart.scales, chart.innerWidth, chart.innerHeight, {
                tables: drawn, schema: schemaSpec, table: feature.table,
                nodeBox: nodeBoxRule(), nodePorts: nodePortsRule,
            }).filter((/** @type {any} */ node) => !(node && node.rowHandle && (!hasLiveEdit
                || (isLocked && isNodeLocked(node, feature, currentData, isLocked)))));
            featureNodes[feature.id] = nodes;

            const declaredEdits = collectEdits(feature);
            warnScaleRequirements(feature, chart.scales);
            warnImageSupport(feature);
            warnScopeMismatch(feature, declaredEdits);
            warnMisplacedEdits(feature, markLabel);
            warnCreateOnNonMark(feature, declaredEdits, chart.scales);
            warnCreateEmptyExtent(feature, declaredEdits, fieldsOf(schemaSpec, feature.table));
            warnDeadEditChannels(feature, declaredEdits, chart.scales);
            warnMissingEditChannels(feature, declaredEdits);
            warnHiddenHandles(feature, declaredEdits);
            warnConnectConflict(feature, declaredEdits);
            warnNestAlone(feature, declaredEdits);
            warnUnclaimedPick(feature, declaredEdits);
            warnUnknownEditOptions(feature, declaredEdits);

            // Only direct-pick edits make nodes editable; plane picks own the cursor.
            const directEdits = activeEdits(feature).filter(e => e.pick === 'direct');
            const editable = directEdits.length > 0;
            // The cursor the edits imply. Per node only when an edit `grabs` some nodes.
            const perNode = directEdits.some(e => typeof e.grabs === 'function');
            const authored = directEdits.some(e => e.cursor);
            const sharedCursor = perNode ? null : cursorFor(directEdits, feature, chart.scales);
            // A host whose only edit lives on its ports still answers hover (not drag).
            const portHosted = features.some((f) => f.portHost === feature);

            // An `inline` (typed) edit flags nodes `editText` for the renderer's editor.
            const inlineEdit = activeEdits(feature).find(e => e.inline);
            if (inlineEdit) warnNoTextEditor(feature, inlineEdit, renderer);

            // The edited column's current value, so the editor opens with it even
            // on a node that paints no text (a sticker's box).
            const inlineField = inlineEdit
                ? (resolveChannels(inlineEdit.channels, feature.channels || {}, chart.scales, feature)[0] || {}).field
                : null;

            // Tag nodes with their feature and flag editable ones. Inert nodes (no
            // direct-pick edit, or a locked row) get pointerEvents 'none' so they never
            // swallow a drag meant for a node beneath them.
            const tree = feature.table === hierarchyNodes ? treeOf(schemaSpec, chart.tables) : null;
            const carried = tree ? inFlight() : null;
            // A row-wide hover is reported by every mark that draws rows.
            const rowHover = hoverWide() && drawsRows(feature);
            const lifted = tree && carried
                ? new Set(carried.flatMap((i) => [i, ...tree.descendantsOf(i)]))
                : null;
            nodes.forEach((/** @type {any} */ node) => {
                node.featureId = feature.id;
                // Each node row paints as one unit, a container beneath what it holds (see paintOrder).
                if (tree && typeof node.index === 'number') {
                    node.stack = tree.paintRank(node.index);
                    // What is being carried paints above everything it passes over.
                    if (lifted && lifted.has(node.index)) node.raise = true;
                }
                // Chart elements and `clip: false` marks are never clipped.
                if ((feature.views === 'scale' || feature.clip === false) && node.unclipped == null) node.unclipped = true;
                const locked = isLocked && isNodeLocked(node, feature, currentData, isLocked);
                if (locked) node.locked = true;
                if (editable && !locked) {
                    node.editable = true;
                    // An edit's own cursor, then the node's, then the heuristic.
                    const implied = perNode ? cursorFor(directEdits, feature, chart.scales, node) : sharedCursor;
                    if (authored && implied) node.cursor = implied;
                    else if (!node.cursor) node.cursor = implied || 'default';
                }
                else if (portHosted && !locked && node.pointerEvents == null) node.hoverable = true;
                else if (rowHover && node.index != null && node.pointerEvents == null) node.hoverable = true;
                else if (node.pointerEvents == null) node.pointerEvents = 'none';
                if (inlineEdit && !locked) {
                    node.editText = true;
                    if (inlineEdit.multiline) node.multiline = true;
                    if (inlineField != null && node.data) {
                        const current = node.data[inlineField];
                        if (current != null) node.editValue = String(current);
                    }
                }
            });
            built.push({ glyph: feature.glyph, nodes });
        });

        // Ease the nodes of `motion` marks before anything reads or orders them.
        nodeMotion.apply(snapAll);

        // The plot area's own surface (theme.panel), first so it is the floor.
        panelNodes(theme, chart.innerWidth, chart.innerHeight).forEach((/** @type {any} */ node) => scene.add(node));
        paintOrder(built).forEach((/** @type {any} */ node) => scene.add(node));
        // The chart's title block and caption, as background chrome.
        if (spec.title || spec.subtitle || spec.caption) {
            titleNodes(spec, theme, { outerHeight: chart.curH, effectiveMargins: chart.effectiveMargins, maxWidth: titleWidth() })
                .forEach((/** @type {any} */ node) => scene.add(node));
        }
    };

    // GHOST: draw the uncommitted proposal, if any, as inert ghosts of the rows it would
    // change.
    const ghostPass = () => {
        // Build each feature from the proposed rows and add only nodes for changed rows
        // (by identity) plus series chrome (index == null). Ghosts are inert and never
        // written to featureNodes, so picking and guides see committed geometry only.
        if (ui.preview) {
            // Previews are parked per feature id. With exactly one proposal (`sole`),
            // every feature over its table ghosts it; with several, each proposer
            // ghosts its own. A proposal is matched by table, not feature, since an
            // edit can propose rows for another table (connect proposes a link row).
            const proposals = Object.values(ui.preview);
            const sole = proposals.length === 1 ? proposals[0] : null;
            /** @type {{ glyph?: string, nodes: any[] }[]} */
            const ghostBuilt = [];
            for (const feature of features) {
                // Chart elements and chrome draw no rows: no ghost.
                if (!drawsRows(feature)) continue;
                const proposal = ui.preview[feature.id] || sole;
                if (!proposal || proposal.live || proposal.table !== feature.table) continue;
                const proposed = proposal.rows;
                const committed = tableOf(feature);

                // Which rows the proposal changes, by reference identity.
                /** @type {Set<number>} */
                const changedIdx = new Set();
                const n = Math.max(proposed.length, committed.length);
                for (let i = 0; i < n; i++) {
                    if (proposed[i] !== committed[i]) changedIdx.add(i);
                }
                if (!changedIdx.size) continue;

                const ghostNodes = feature.build(proposed, chart.scales, chart.innerWidth, chart.innerHeight, {
                    // Links resolve endpoints against the proposed rows too.
                    tables: { ...chart.tables, [proposal.table]: proposed },
                    schema: schemaSpec,
                    table: feature.table,
                    // A ghost build may draw a FREE end at the pointer.
                    ghost: { pointer: proposal.pointer },
                    nodeBox: nodeBoxRule(),
                    nodePorts: nodePortsRule,
                });
                const kept = ghostNodes.filter((/** @type {any} */ node) => {
                    const keep = node.index != null ? changedIdx.has(node.index) : true;
                    if (!keep) return false;
                    node.ghost = true;
                    node.featureId = feature.id;
                    node.editable = false;
                    node.pointerEvents = 'none';
                    applyGhostStyle(node, theme.ghost);
                    return true;
                });
                ghostBuilt.push({ glyph: feature.glyph, nodes: kept });
            }
            paintOrder(ghostBuilt).forEach((/** @type {any} */ node) => scene.add(node));
        }
    };

    // POINTER: resolve the row under the pointer (ui.hit / ui.hits) for the guides that
    // read it.
    const pointerPass = () => {
        if (tracksPointer && ui.pointer) {
            // One hit per feature, topmost first, so a tip bound to a mark finds its
            // row under a label drawn over it.
            /** @type {{ featureId: string, index: number, node: any }[]} */
            const hits = [];
            for (let i = features.length - 1; i >= 0; i--) {
                const nodesAt = visibleAt(featureNodes[features[i].id] || [], ui.pointer.x, ui.pointer.y);
                let hit = hitTestAny(nodesAt, ui.pointer.x, ui.pointer.y);
                // Geo regions: even-odd test against the projected rings in screen space.
                if (!hit && features[i].supportsGeo) {
                    const ptr = /** @type {{ x: number, y: number }} */ (ui.pointer);
                    for (let k = nodesAt.length - 1; k >= 0; k--) {
                        const n = nodesAt[k];
                        if (!n || !n.geoShape || typeof n.d !== 'string') continue;
                        if (!n.geoRings) {
                            const segs = parsePath(n.d);
                            n.geoRings = segs ? flatten(segs) : [];
                        }
                        let inside = false;
                        for (const ring of n.geoRings) if (pointInPolygon(ring, ptr.x, ptr.y)) inside = !inside;
                        if (inside) { hit = n; break; }
                    }
                }
                if (!hit) continue;
                // A path has no row of its own: use its nearest vertex's row.
                let index = hit.index;
                if (index == null && Array.isArray(hit.pointRows) && Array.isArray(hit.points)) {
                    let best = Infinity;
                    hit.points.forEach((/** @type {any} */ p, /** @type {number} */ k) => {
                        if (!p) return;
                        const ptr = /** @type {{ x: number, y: number }} */ (ui.pointer);
                        const dd = Math.hypot(p[0] - ptr.x, p[1] - ptr.y);
                        if (dd < best) { best = dd; index = hit.pointRows[k]; }
                    });
                }
                if (index == null && hit.data == null) continue;
                hits.push({ featureId: hit.featureId, index, node: hit });
            }
            ui.hits = hits;
            ui.hit = hits[0] || null;
        } else {
            ui.hits = [];
            ui.hit = null;
        }
    };

    // GUIDES: build every guide against the chart state.
    const guidePass = () => {
        const guideCtx = {
            scales: chart.scales,
            // The primary table's rows; a guide about a mark reads its table via tableOf.
            data: primaryRows(),
            tableOf,
            constraintsIn,
            constraints: datasetConstraints,
            features,
            featureNodes,
            ui,
            effects,
            theme,
            width: chart.innerWidth,
            height: chart.innerHeight,
            // So an edit's guide can hide while its edit is inactive.
            stage: getStage()
        };
        // A guide's `background` node (guides.image) is the floor: after the
        // panel, before gridlines and marks.
        let floor = scene.children.findIndex((/** @type {any} */ n) => !n.panel);
        if (floor < 0) floor = scene.children.length;
        allGuides.forEach(guide => {
            const nodes = guide.build(
                guideCtx.data, chart.scales, chart.innerWidth, chart.innerHeight, guideCtx,
            ) || [];
            nodes.forEach((/** @type {any} */ node) => {
                node.guide = true;
                if (node.background) scene.children.splice(floor++, 0, node);
                else scene.add(node);
            });
        });
    };

    // STATE: decide every interaction effect (hovered / selected / target / grabbed) and
    // port visibility.
    const statePass = () => {
        // The one place that decides every effect, as a node restyle
        // (`effectStyle`) or an outline overlay. Hover comes from a proximity
        // driver's session or from ui.hover. A selected row is not also hovered;
        // grabbed stacks with selected (effectStyleFor merges them). Keyed by datum
        // index per feature, and selection per table.
        /** @type {Record<string, Set<number>>} */
        const selectedByTable = {};

        // Rows lit by hover or grab, per table: an `onHover` node (a port) shows
        // while any feature over its table lights its row.
        /** @type {Record<string, Set<number>>} */
        const litByTable = {};
        const light = (/** @type {any} */ ref) => {
            if (!ref || ref.index == null) return;
            const f = featureById.get(ref.featureId);
            if (!f || f.table == null) return;
            (litByTable[f.table] || (litByTable[f.table] = new Set())).add(ref.index);
        };
        light(ui.hover);
        light(ui.grab);
        chart.sceneHasOnHover = false;

        /** @param {Record<string, Set<number>>} byTable @param {string} table @param {number} index */
        const addRow = (byTable, table, index) => { (byTable[table] || (byTable[table] = new Set())).add(index); };
        // A state's rows plus, under `neighbours`, the rows linked to them.
        /** @param {any} state @param {Record<string, Set<number>>} byTable */
        const withNeighbours = (state, byTable) => {
            if (!state || state.enabled === false || !state.neighbours) return byTable;
            for (const [table, rows] of Object.entries(byTable).map(([t, set]) => /** @type {[string, number[]]} */ ([t, [...set]]))) {
                for (const i of rows) {
                    for (const n of neighboursOf(schemaSpec, chart.tables, table, i)) addRow(byTable, n.table, n.index);
                }
            }
            return byTable;
        };

        // Rows hovered per table: the dataset's hover when this chart shows it,
        // and this chart's own when its hover is row-wide.
        const showsHover = hoverLink() !== false;
        /** @type {Record<string, Set<number>>} */
        const hoveredByTable = {};
        const shared = showsHover ? hoverRow() : null;
        if (shared) addRow(hoveredByTable, shared.table, shared.index);
        if (hoverWide()) {
            for (const f of features) {
                if (f.table == null || !drawsRows(f)) continue;
                const s = ui.session && ui.session[f.id];
                const near = s ? (s.activeIndex != null ? s.activeIndex : s.hoverIndex) : null;
                if (near != null) addRow(hoveredByTable, f.table, near);
                if (ui.hover && ui.hover.featureId === f.id && ui.hover.index != null) addRow(hoveredByTable, f.table, ui.hover.index);
            }
        }
        withNeighbours(effects.hovered, hoveredByTable);

        // Neighbours of the selected and the grabbed rows, per table.
        /** @type {Record<string, Set<number>>} */
        const selectedNear = {};
        if (effects.selected && effects.selected.enabled !== false && effects.selected.neighbours) {
            for (const table of Object.keys(schemaSpec.tables)) {
                for (const i of selectionIn(table)) addRow(selectedNear, table, i);
            }
            withNeighbours(effects.selected, selectedNear);
        }
        /** @type {Record<string, Set<number>>} */
        const grabbedNear = {};
        const grabbedFeature = ui.grab ? featureById.get(ui.grab.featureId) : null;
        if (effects.grabbed && effects.grabbed.enabled !== false && effects.grabbed.neighbours
            && grabbedFeature && grabbedFeature.table != null && ui.grab.index != null) {
            addRow(grabbedNear, grabbedFeature.table, ui.grab.index);
            withNeighbours(effects.grabbed, grabbedNear);
        }
        // During a connect/rewire drag, the ports a release could land on
        // (`session.targets`), across features.
        /** @type {Set<string> | null} */
        let dropTargets = null;
        for (const s of Object.values(ui.session || {})) {
            if (s && Array.isArray(s.targets)) {
                dropTargets = dropTargets || new Set();
                for (const k of s.targets) dropTargets.add(k);
            }
        }

        /** @type {Set<number>} */
        const dropInto = new Set();
        for (const p of Object.values(ui.preview || {})) {
            if (p && p.dropInto != null) dropInto.add(p.dropInto);
        }
        const flyingRoots = inFlight();
        const flyTree = flyingRoots && flyingRoots.length ? treeOf(schemaSpec, chart.tables) : null;
        const flying = flyingRoots
            ? new Set(flyingRoots.flatMap((i) => [i, .../** @type {any} */ (flyTree).descendantsOf(i)]))
            : null;

        for (const feature of features) {
            if (!drawsRows(feature)) continue;
            const selected = selectedByTable[feature.table]
                || (selectedByTable[feature.table] = new Set([
                    ...selectionIn(feature.table), ...(selectedNear[feature.table] || []),
                ]));
            const marks = featureNodes[feature.id] || [];

            /** @type {Set<number>} */
            const hovered = new Set();
            const session = ui.session && ui.session[feature.id];
            const viaProximity = session
                ? (session.activeIndex != null ? session.activeIndex : session.hoverIndex)
                : null;
            if (viaProximity != null) hovered.add(viaProximity);
            if (ui.hover && ui.hover.featureId === feature.id && ui.hover.index != null) {
                hovered.add(ui.hover.index);
            }
            for (const i of hoveredByTable[feature.table] || []) hovered.add(i);
            for (const i of selected) hovered.delete(i);

            /** @type {Set<number>} */
            const grabbed = new Set();
            if (ui.grab && ui.grab.featureId === feature.id && ui.grab.index != null) {
                grabbed.add(ui.grab.index);
            }
            // A node in flight carries its descendants.
            if (flying && feature.table === hierarchyNodes) {
                for (const i of flying) grabbed.add(i);
            }
            for (const i of grabbedNear[feature.table] || []) grabbed.add(i);
            // The container a parked nesting proposal would drop into, lit on box hosts only.
            /** @type {Set<number>} */
            const target = boxHosts.includes(feature) ? dropInto : new Set();

            /** @type {[Set<number>, any][]} */
            const byState = [
                [hovered, effects.hovered],
                [selected, effects.selected],
                [target, effects.target],
                [grabbed, effects.grabbed],
            ];

            // The hovered handle when a row draws several (a band's y1 and y2), named by
            // ui.hover.node or the session's `channel`. Matched by handleKey, not
            // identity, since nodes are freshly built.
            const hoverRef = ui.hover && ui.hover.featureId === feature.id && ui.hover.node
                && ui.hover.node.channel != null
                ? ui.hover.node
                : (viaProximity != null && session && session.channel != null
                    ? { index: viaProximity, channel: session.channel }
                    : null);
            const hoverHandle = hoverRef
                ? marks.find((m) => m && !m.ghost && handleKey(m) === handleKey(hoverRef)) || null
                : null;
            /** A sibling handle of the hovered one: same row, a different channel. */
            const isOtherHandle = (/** @type {any} */ node) => !!hoverHandle && node.channel != null
                && node.index === hoverHandle.index && node.channel !== hoverHandle.channel;

            // Restyle: merge every state a datum is in onto its nodes' `effectStyle`.
            /** @type {Map<number, any[]>} */
            const statesByIndex = new Map();
            for (const [indices, state] of byState) {
                for (const i of indices) {
                    const list = statesByIndex.get(i) || [];
                    list.push(state);
                    statesByIndex.set(i, list);
                }
            }
            // The mute: while a state has a row here, rows in no state take its `others`.
            const rowCount = tableOf(feature).length;
            /** @type {Record<string, any>[]} */
            const mutes = [];
            for (const [indices, state] of byState) {
                if (![...indices].some((i) => i >= 0 && i < rowCount)) continue;
                const others = othersOf(state, state === effects.hovered && showsHover);
                if (others) mutes.push(others);
            }
            for (const node of marks) {
                if (!node || node.ghost || node.index == null) continue;
                if (mutes.length && !statesByIndex.has(node.index)) {
                    node.effectStyle = Object.assign({}, ...mutes);
                    continue;
                }
                let states = statesByIndex.get(node.index) || [];
                // A sibling of the hovered handle is not hovered.
                if (isOtherHandle(node)) states = states.filter((s) => s !== effects.hovered);
                const style = effectStyleFor(states);
                if (style) node.effectStyle = style;
            }

            // Visibility: an `onHover` node is hidden until its row is lit. A port shows
            // at rest only if a link can start there, and during a drag only as a drop
            // target. Hidden means opacity 0 and no pointer events.
            const lit = litByTable[feature.table];
            for (const node of marks) {
                if (!node || node.ghost || !node.onHover || node.index == null) continue;
                chart.sceneHasOnHover = true;
                const i = node.index;
                const rowOn = (lit && lit.has(i)) || hovered.has(i) || selected.has(i) || grabbed.has(i)
                    || viaProximity === i;
                let on = rowOn;
                if (node.portRole) {
                    if (dropTargets) {
                        const source = !!session && session.fromIndex === i && session.fromSide === node.side;
                        on = source || dropTargets.has(portKey(feature.table, i, node.side));
                    } else {
                        on = rowOn && node.portRole !== 'in' && portAvailable(feature, node);
                    }
                }
                if (!on) {
                    node.effectStyle = { ...(node.effectStyle || {}), opacity: 0 };
                    node.pointerEvents = 'none';
                }
            }

            // Overlay: the outline. A hovered handle is outlined itself; otherwise the
            // row's first node.
            for (const [indices, state] of byState) {
                if (!indices.size) continue;
                /** @type {any[]} */
                let overlays;
                if (state === effects.hovered && hoverHandle && indices.has(hoverHandle.index)) {
                    const rest = new Set(indices);
                    rest.delete(hoverHandle.index);
                    overlays = [...outlineNodes(hoverHandle, state), ...stateEffectNodes(marks, rest, state)];
                } else {
                    overlays = stateEffectNodes(marks, indices, state);
                }
                overlays.forEach((/** @type {any} */ node) => { node.guide = true; scene.add(node); });
            }
        }
    };

    // 2g. Look pass - a geometry look redraws the finished scene. It runs last and
    // only on what the renderer is handed: `featureNodes`, which picking, guides and
    // edits read, keep the true geometry.
    const geometryLooks = looks.filter((look) => look.kind === 'geometry' && typeof look.transform === 'function');
    const lookPass = () => {
        for (const look of geometryLooks) {
            scene.children = /** @type {any} */ (look.transform)(scene.children);
        }
    };

    // 3. Coordinator - rebuild the scene graph from current state and render.
    const update = () => {
        measure(); // reflow: pick up the container's current width before drawing
        if (motion) motion.begin();
        scene.clear();
        layoutPass();
        const moved = resolvePass();
        const { planeOnTop, hasWheel, planeCursor } = planeState();
        buildPass();
        ghostPass();
        pointerPass();
        guidePass();
        statePass();
        lookPass();

        renderer.render({
            container,
            scene,
            width: chart.curW,
            height: chart.curH,
            margins: chart.effectiveMargins,
            scales: chart.scales,
            spec,
            planeOnTop,
            planeCursor,
            tracksPointer,
            hasWheel,
            clip: clipNow(),
            responsive: mode,
            overflow,
            focusOutline,
            effects,
            looks,
            theme,
            onEvent: handleEvent
        });
        // Keep drawing until everything eased has arrived.
        if (motion && motion.moving() && !frame) frame = raf(() => { frame = 0; update(); });
        // The other charts draw what this settle wrote; they do not settle it again.
        if (moved) layoutMoved();
    };

    return { container, measure, applyResize, update, stopMotion, followsPointer: nodeMotion.followsPointer };
}
