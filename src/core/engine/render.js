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
import { stateEffectNodes, outlineNodes, effectStyleFor } from '../effects.js';
import { panelNodes } from '../panel.js';
import { reserveLegends } from '../legends.js';
import { reserveTitles, titleNodes } from '../titles.js';
import { treeOf } from '../hierarchy.js';
import { fieldsOf } from '../schema.js';
import { cursorFor, planeCursorFor } from '../../edit/cursor.js';
import {
    markLabel,
    warnScaleRequirements, warnScopeMismatch, warnProjectionCartesianMix,
    warnDuplicatePlaneEdits, warnUnreachableLegendRow, warnConnectConflict, warnNestAlone,
    warnCreateOnNonMark, warnCreateEmptyExtent, warnDeadEditChannels, warnMissingEditChannels, warnHiddenHandles,
    warnUnclaimedPick, warnUnknownEditOptions,
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
 * @property {import('../../types').ElicitSpec} spec
 * @property {any} theme
 * @property {any} effects
 * @property {any} renderer
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
 * @property {any[]} boxHosts
 * @property {(feature: any) => any[]} tableOf
 * @property {(feature: any, edit: import('../../types').Edit) => string} targetTableOf
 * @property {() => any[]} primaryRows
 * @property {(name: string) => ((d: any, i: number) => boolean) | null} isLockedIn
 * @property {(table: string) => import('../../types').Constraint[]} constraintsIn
 * @property {() => import('../../types').NodeBoxRule | null} nodeBoxRule
 * @property {((row: any, i: number, rows: any[]) => Record<string, string> | null) | null} nodePortsRule
 * @property {(before?: any[] | null, frozen?: Set<number> | null, dodge?: any) => void} settleNodes
 * @property {() => Set<number> | null} heldStill
 * @property {() => number[] | null} inFlight
 * @property {(feature: any) => import('../../types').Edit[]} activeEdits
 * @property {() => number} getStage
 * @property {(table: string) => Set<number>} selectionIn
 * @property {(table?: string) => number[]} selectionList
 * @property {() => number | null} selectionPrimary
 * @property {(feature: any, node: any) => boolean} portAvailable
 * @property {(node: any) => string} handleKey
 * @property {() => any} clipNow
 * @property {(nodes: any[], x: number, y: number) => any[]} visibleAt
 * @property {(event: any) => any} handleEvent
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
        features, featureById, ui, spec, theme, effects, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, boxHosts, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, portAvailable, handleKey, clipNow, visibleAt,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);

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
    // the scale map, and settle a hierarchy.
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
        // Settle the hierarchy against the current scales. Rows are pushed apart only
        // for data that just arrived from outside; a hover or resize never moves an answer.
        settleNodes(null, heldStill(), chart.spaceNext && !chart.stroking ? {} : null);
        if (!chart.stroking) chart.spaceNext = false;
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

    // BUILD: build every feature from its committed rows, tag its nodes for dispatch, and
    // add them to the scene in paint order with the panel and titles.
    const buildPass = () => {
        warnDuplicatePlaneEdits(features, activeEdits, targetTableOf);
        warnUnreachableLegendRow(features, activeEdits, tableOf);

        // Built nodes per feature, ordered by `paintOrder` once all are known.
        /** @type {{ glyph?: string, nodes: any[] }[]} */
        const built = [];

        features.forEach(feature => {
            // A feature always draws its committed rows; a proposal is drawn by ghostPass.
            const currentData = tableOf(feature);
            const isLocked = isLockedIn(feature.table);
            // Row handles are dropped on locked rows and when no edit is active.
            // Dropped before featureNodes is written, so picking never sees them.
            const hasLiveEdit = activeEdits(feature).length > 0;
            const nodes = feature.build(currentData, chart.scales, chart.innerWidth, chart.innerHeight, {
                tables: chart.tables, schema: schemaSpec, table: feature.table,
                nodeBox: nodeBoxRule(), nodePorts: nodePortsRule,
            }).filter((/** @type {any} */ node) => !(node && node.rowHandle && (!hasLiveEdit
                || (isLocked && isNodeLocked(node, feature, currentData, isLocked)))));
            featureNodes[feature.id] = nodes;

            const declaredEdits = collectEdits(feature);
            warnScaleRequirements(feature, chart.scales);
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
            const lifted = tree && carried
                ? new Set(carried.flatMap((i) => [i, ...tree.descendantsOf(i)]))
                : null;
            nodes.forEach((/** @type {any} */ node) => {
                node.featureId = feature.id;
                // A container paints beneath what it holds (see paintOrder).
                if (tree && typeof node.index === 'number') {
                    node.depth = tree.depthOf(node.index);
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
                // Chart elements draw scales, not rows: no ghost.
                if (feature.views === 'scale') continue;
                const proposal = ui.preview[feature.id] || sole;
                if (!proposal || proposal.table !== feature.table) continue;
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
        allGuides.forEach(guide => {
            const nodes = guide.build(
                guideCtx.data, chart.scales, chart.innerWidth, chart.innerHeight, guideCtx,
            ) || [];
            nodes.forEach((/** @type {any} */ node) => {
                node.guide = true;
                scene.add(node);
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
            if (feature.views === 'scale') continue;
            const selected = selectedByTable[feature.table]
                || (selectedByTable[feature.table] = selectionIn(feature.table));
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
            for (const node of marks) {
                if (!node || node.ghost || node.index == null) continue;
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

    // 3. Coordinator - rebuild the scene graph from current state and render.
    const update = () => {
        measure(); // reflow: pick up the container's current width before drawing
        scene.clear();
        layoutPass();
        resolvePass();
        const { planeOnTop, hasWheel, planeCursor } = planeState();
        buildPass();
        ghostPass();
        pointerPass();
        guidePass();
        statePass();

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
            theme,
            onEvent: handleEvent
        });
    };

    return { container, measure, applyResize, update };
}
