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
import {
    markLabel,
    warnScaleRequirements, warnScopeMismatch, warnProjectionCartesianMix,
    warnDuplicatePlaneEdits, warnUnreachableLegendRow, warnConnectConflict, warnNestAlone,
    warnCreateOnNonMark, warnCreateEmptyExtent, warnDeadEditChannels, warnMissingEditChannels, warnHiddenHandles,
    warnUnclaimedPick, warnUnknownEditOptions,
} from '../guards.js';

/**
 * Dim a ghost-preview node in place. Multiplies its existing opacity by the theme's
 * ghost opacity (so an already-faint mark stays proportionally faint) and, when the
 * theme names them, overrides fill/stroke/dash so the preview reads as tentative.
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
 * @property {() => boolean} hasAxisTitles
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
 * Rendering: the chart's container and size, and `update()` — which rebuilds the
 * scene graph from current state and hands it to the renderer. Every render
 * reserves layout space (legends, axis titles, chart titles), re-resolves the
 * scales from the live data, builds every feature, layers the ghost of any
 * uncommitted proposal, builds the guides, and runs the one interaction-STATE
 * pass that decides every effect.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {RenderDeps} deps
 */
export function createRender(chart, deps) {
    const {
        features, ui, spec, theme, effects, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, boxHosts, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, portAvailable, handleKey, clipNow, visibleAt,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);

    // Set up container. 'fixed' pins pixel dims; the responsive modes fill the
    // parent's width (the SVG scales via viewBox in 'scale', or is redrawn at the
    // measured size in 'reflow').
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

    // Recompute the margin-subtracted dims from the current outer dims, and (reflow
    // only) re-measure the container's width from the parent. Returns whether the
    // width actually changed, so a resize can skip a redundant re-render.
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

    // Grow-the-chart: adopt new outer pixel dims (numeric axis drag in `grow` mode),
    // mirror them onto the container the way the initial sizing does, and recompute
    // the inner rect so the next render draws at the new size.
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

    // 3. Coordinator - rebuild the scene graph from current state and render.
    const update = () => {
        measure(); // reflow: pick up the container's current width before drawing
        scene.clear();

        // Legend reservation: a legend on a side shrinks the plot to make room. A
        // legend's band depends only on its scale's DOMAIN (label count / extent),
        // not on the pixel dims — so one provisional resolve gives the domains, we
        // reserve the bands, inflate the author margins, and recompute the inner
        // rect before the real resolve below. No feedback loop, so no iteration.
        // Titles are the OUTERMOST bands — plot, then the author's margin (where
        // an axis draws), then any legend, then the title block / caption at the
        // very edge — so a title never costs the plot its declared size and never
        // collides with an axis or a legend.
        // Titles wrap to the chart width from the plot's left edge.
        const titleWidth = Math.max(0, chart.curW - authorMargins.left - 4);
        const titleBands = reserveTitles(spec, theme, titleWidth);
        chart.effectiveMargins = { ...authorMargins };
        recomputeInner();
        let legendBands = { top: 0, right: 0, bottom: 0, left: 0 };
        // An axis title reserves what it needs BEYOND the author's margin on its
        // side (the axis draws inside that margin), so a rotated y title past wide
        // tick labels is never clipped — the same rule a legend's band follows.
        /** @type {Record<string, number>} */
        const axisBands = { top: 0, right: 0, bottom: 0, left: 0 };
        if (hasLegends || hasAxisTitles()) {
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
            top: authorMargins.top + axisBands.top + legendBands.top + titleBands.top,
            right: authorMargins.right + axisBands.right + legendBands.right,
            bottom: authorMargins.bottom + axisBands.bottom + legendBands.bottom + titleBands.bottom,
            left: authorMargins.left + axisBands.left + legendBands.left,
        };
        recomputeInner();

        // Re-resolve global scales so inferred domains follow the live data, and
        // an edited schema domain (edit.axis.*) reshapes every axis/grid/mark.
        chart.scales = resolveScales(features, chart.tables, liveSpec, dims);
        // Chart-level geographic projection (Plot model): shared apply/invert/path
        // for every geo mark and edit.geo.*. Attached on the scale map so build()
        // and edit ctx see the same object without a second argument.
        const projection = createProjection(liveSpec.projection, dims);
        // Attached on the scale map as a reserved non-Scale key (cast) so build()
        // and edit ctx share one object without widening ScaleMap's channel types.
        if (projection) /** @type {any} */ (chart.scales).projection = projection;
        // The resolved theme rides on the scale map as another reserved non-Scale
        // key, so every mark's build() and the guide/edit ctx read default colours,
        // fonts and affordance tokens from one object (see core/theme.js: themeOf).
        /** @type {any} */ (chart.scales).theme = theme;
        // The selection rides on the scale map as reserved non-Scale keys, so a
        // legend/mark reads "the selected row" from the same object it already gets,
        // without a widened build() signature. Two views of the one Set:
        //   selection    the FIRST selected primary row, or null — the scalar every
        //                mark and `legend`'s `row` has always read. Kept scalar so
        //                multi-select is a widening, not a break.
        //   selectionAll every selected row, per table, for anything that reflects a
        //                multi-row selection rather than narrowing it (a legend
        //                marking which categories the selection currently holds).
        /** @type {any} */ (chart.scales).selection = selectionPrimary();
        /** @type {any} */ (chart.scales).selectionAll = selectionList;
        // The dataset schema rides along as one more reserved non-Scale key. A
        // composite's frame scales are built inside build() (one per datum), and the
        // DOMAIN of a frame channel is the field's — which only the schema knows.
        /** @type {any} */ (chart.scales).schema = schema;
        warnProjectionCartesianMix(features, chart.scales);
        // Data from outside a gesture (setData) and a resized plot both change what
        // a container's contents measure, so every render settles the hierarchy
        // against the scales it is about to draw with. It returns the same rows when
        // nothing moved, so the common render costs one pass over the tree. Rows are
        // pushed apart only for data that just arrived from outside: a re-render
        // (a hover, a resize) must never move an answer.
        settleNodes(null, heldStill(), chart.spaceNext && !chart.stroking ? {} : null);
        if (!chart.stroking) chart.spaceNext = false;

        // Plane-on-top mode: when an ACTIVE edit resolves its target from an
        // arbitrary pointer position (nearest/sweep/draw/brush), the plane must sit
        // above the marks and own the gesture. Computed per render because the
        // active edit set — and thus this flag — can change with the stage.
        const planeOnTop = features.some(feature => needsPlaneOnTop(activeEdits(feature)));
        // Does an ACTIVE edit listen to the wheel (edit.axis.zoom)? Then the renderer
        // reports it and keeps the page from scrolling; otherwise the chart never
        // touches the wheel.
        const hasWheel = features.some(feature => activeEdits(feature).some(e => e.gesture === 'wheel'));
        // Plane-on-top drivers (brushRect, nearest, …) may stash a cursor hint in
        // their per-feature session so the interaction plane can show edge/body
        // affordances without a second interaction system.
        chart.planeRaised = planeOnTop;
        let planeCursor = 'pointer';
        // Over a mark a press would grab (see handleEvent's hover routing), the
        // plane shows that mark's cursor rather than the plane edit's.
        const hoveredNode = planeOnTop && ui.hover && ui.hover.node;
        if (hoveredNode && hoveredNode.editable) planeCursor = hoveredNode.cursor || 'move';
        else if (planeOnTop && ui.session) {
            for (const fid of Object.keys(ui.session)) {
                const cur = ui.session[fid] && ui.session[fid].cursor;
                if (cur) { planeCursor = cur; break; }
            }
        }

        warnDuplicatePlaneEdits(features, activeEdits, targetTableOf);
        warnUnreachableLegendRow(features, activeEdits, tableOf);

        // Built nodes per feature, in feature order, so paint order can be decided
        // once the whole scene is known. It is the FEATURE order for everything
        // except a glyph, whose parts paint as one object per row — see
        // `paintOrder`. Collected rather than added straight to the scene because
        // that decision spans several features.
        /** @type {{ glyph?: string, nodes: any[] }[]} */
        const built = [];

        features.forEach(feature => {
            // The committed rows of the feature's OWN table are always what it draws.
            // A hover/drag preview no longer substitutes them (that made committed
            // marks jump/flicker — worst on a matrix); instead the proposal is drawn
            // as an inert ghost of only the rows it would change, by the pass below.
            const currentData = tableOf(feature);
            const isLocked = isLockedIn(feature.table);
            // A mark that joins ACROSS tables (link) needs more than its own rows: the
            // whole dataset, the canonical schema (to find another table by ROLE), and
            // which table it is itself drawing. Passed as a 5th argument, so every
            // existing mark's four-parameter build() is untouched.
            // A ROW HANDLE (`node.rowHandle`) exists only to be grabbed, so it is drawn
            // only where a gesture could move it: not on a locked or context row, and
            // not while every edit on the mark waits for a later stage. A mark decides
            // at factory time WHETHER it draws handles (it has edits); only the engine
            // knows the lock and the stage, so it decides WHICH rows keep them. Dropped
            // before featureNodes is written, so picking never sees them either.
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
            warnCreateEmptyExtent(feature, declaredEdits, liveSpec.schema);
            warnDeadEditChannels(feature, declaredEdits, chart.scales);
            warnMissingEditChannels(feature, declaredEdits);
            warnHiddenHandles(feature, declaredEdits);
            warnConnectConflict(feature, declaredEdits);
            warnNestAlone(feature, declaredEdits);
            warnUnclaimedPick(feature, declaredEdits);
            warnUnknownEditOptions(feature, declaredEdits);

            // A feature with an ACTIVE direct-pick edit is interactive on its marks,
            // so the renderer should show an editable cursor on them. Plane-pick
            // edits (nearest/sweep/draw) put the cursor on the plane instead, so
            // they don't mark nodes editable.
            const editable = activeEdits(feature).some(e => e.pick === 'direct');
            // A node mark whose only edit lives on its PORTS (desugared into a
            // sibling feature) carries no edit of its own, yet its ports show on
            // HOVER of the host — so the host must still answer the pointer. Hoverable
            // is not editable: no cursor, no drag, no hit-test target.
            const portHosted = features.some((f) => f.portHost === feature);

            // An edit completed by TYPING (`inline`) makes this feature's nodes
            // typable — the renderer opens its inline editor on a double-click of a
            // node flagged `editText`. A declared CAPABILITY, read the same way
            // `editable` reads `pick`, so the engine never asks whether an edit is
            // an editText and a mark never sniffs its own edit list to find out.
            //
            // Which SHAPE gets it matters: a glyph whose typable surface is a box
            // (a sticker) puts the edit on the box, and the text it contains stays
            // inert — otherwise the label's nodes keep the pointer, and pick.js
            // gives a text node a fontSize-radius hit disc that sits dead centre of
            // the shape and swallows the drag that should move it.
            const inlineEdit = activeEdits(feature).find(e => e.inline);

            // What that editor OPENS WITH, for a typable node that paints no text.
            // A label carries its string (`node.text`) and always did; the box of a
            // sticker does not — its text is drawn by a SIBLING mark — so the editor
            // opened empty and every double-click silently became "retype the note
            // from scratch". The COLUMN is the truth in both cases, so resolve it
            // from the edit's own channel (the one place a field is named) and stamp
            // the current value where the renderer can find it.
            const inlineField = inlineEdit
                ? (resolveChannels(inlineEdit.channels, feature.channels || {}, chart.scales, feature)[0] || {}).field
                : null;

            // Tag every node with its feature so gesture events can find the
            // feature's edits, and flag interactive marks for the cursor.
            //
            // A mark with no direct-pick edit can't consume a gesture, so it must not
            // BLOCK one: the renderer defaults nodes to pointer-events:auto and paints
            // later features/parts on top, so an inert rule listed after a handle (or
            // any overlapping inert chrome) would swallow its drag. Silence it unless
            // the mark asked for a specific value.
            //
            // A node over a LOCKED row is inert for the same reason, one level down:
            // its row is read-only, so it is not grabbable, shows no editable cursor,
            // and pick.js skips it when resolving a proximity target.
            const tree = feature.table === hierarchyNodes ? treeOf(schemaSpec, chart.tables) : null;
            const carried = tree ? inFlight() : null;
            const lifted = tree && carried
                ? new Set(carried.flatMap((i) => [i, ...tree.descendantsOf(i)]))
                : null;
            nodes.forEach((/** @type {any} */ node) => {
                node.featureId = feature.id;
                // A container paints beneath what it holds, whichever mark draws
                // either and wherever their rows sit in the table (see paintOrder).
                if (tree && typeof node.index === 'number') {
                    node.depth = tree.depthOf(node.index);
                    // What is being carried paints above everything it passes over.
                    if (lifted && lifted.has(node.index)) node.raise = true;
                }
                // A chart element draws a SCALE in the chart's chrome (an axis
                // handle on the edge, a legend in the margin): the mark clip is
                // for the data, never for these. A mark opts out with `clip:
                // false` — an annotation meant to sit in the margin.
                if ((feature.views === 'scale' || feature.clip === false) && node.unclipped == null) node.unclipped = true;
                const locked = isLocked && isNodeLocked(node, feature, currentData, isLocked);
                if (locked) node.locked = true;
                if (editable && !locked) node.editable = true;
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
            titleNodes(spec, theme, { innerWidth: chart.innerWidth, outerHeight: chart.curH, effectiveMargins: chart.effectiveMargins, authorMargins, maxWidth: Math.max(0, chart.curW - chart.effectiveMargins.left - 4) })
                .forEach((/** @type {any} */ node) => scene.add(node));
        }

        // Ghost-preview pass. For each feature carrying an uncommitted proposal, build
        // it from the PROPOSED rows and add only the nodes that DIFFER from committed —
        // a changed/added row (by identity, since computeEdit's splice preserves the
        // untouched rows' object identity), or a feature's series chrome (index == null,
        // e.g. a line path) when any of its rows changed. Ghosts are inert: not written
        // to featureNodes (so picking/guides see committed geometry only), never
        // editable, pointer-transparent, and styled with theme.ghost so they read as
        // tentative. Building every feature from the proposal keeps "the ghost is
        // exactly what a commit would draw" across sibling marks and constraint repairs.
        if (ui.preview) {
            // A proposal is about the DATASET, not about the mark that produced it:
            // every feature is a view over the same rows, so a SIBLING has to ghost
            // it too. Splitting a glyph into two marks otherwise leaves half of it
            // frozen until the click — a trendBand whose spread is being probed on
            // the trend line shows no feedback at all while the pointer moves.
            //
            // The parking spot stays keyed by feature id (two probe marks must not
            // clobber each other's ghost); this only decides who DRAWS one. With
            // exactly one proposal in flight it is THE proposal and every feature
            // renders it. With two, each proposing feature keeps its own — there is
            // no single answer for a bystander, so it stays out of it.
            //
            // A proposal names the TABLE it is about, because an edit can propose
            // rows for a table other than the one its mark draws — `edit.network.connect`
            // fires on a node mark and proposes a LINK row. Only features over that
            // table ghost it, which is both what makes the rubber band appear on the
            // link mark and what stops a node mark from ghosting rows that aren't its.
            const inFlight = Object.values(ui.preview);
            const sole = inFlight.length === 1 ? inFlight[0] : null;
            // Ghosts paint in the same order committed nodes do — a ghosted glyph
            // is one object too, so its parts group by row (`paintOrder`).
            /** @type {{ glyph?: string, nodes: any[] }[]} */
            const ghostBuilt = [];
            for (const feature of features) {
                // A chart element draws a SCALE, not rows, so it has no ghost to show.
                if (feature.views === 'scale') continue;
                const proposal = ui.preview[feature.id] || sole;
                if (!proposal || proposal.table !== feature.table) continue;
                const proposed = proposal.rows;
                const committed = tableOf(feature);

                // Which rows the proposal changes, by reference identity.
                /** @type {Set<number>} */
                const changedIdx = new Set();
                let anyChanged = proposed.length !== committed.length;
                const n = Math.max(proposed.length, committed.length);
                for (let i = 0; i < n; i++) {
                    if (proposed[i] !== committed[i]) { changedIdx.add(i); anyChanged = true; }
                }
                if (!anyChanged) continue;

                const ghostNodes = feature.build(proposed, chart.scales, chart.innerWidth, chart.innerHeight, {
                    // A ghosted LINK has to resolve its endpoints against the proposed
                    // rows too — otherwise a preview that moves a node draws the ghost
                    // link to where the node used to be.
                    tables: { ...chart.tables, [proposal.table]: proposed },
                    schema: schemaSpec,
                    table: feature.table,
                    // A ghost build may draw a FREE end at the pointer.
                    ghost: { pointer: proposal.pointer },
                    nodeBox: nodeBoxRule(),
                    nodePorts: nodePortsRule,
                });
                const kept = ghostNodes.filter((/** @type {any} */ node) => {
                    const keep = node.index != null ? changedIdx.has(node.index) : anyChanged;
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

        // Build guides last so they can read the freshly-updated data. Guides are
        // purely visual (non-interactive) annotations.
        // The row under the pointer, for the guides that read it — resolved from
        // the scene just built, so a tip over a locked or context row works too.
        if (tracksPointer && ui.pointer) {
            // One hit per feature, topmost first — so a tip bound to a mark finds
            // its own row under an inert label drawn over it, and an unbound tip
            // takes the topmost.
            /** @type {{ featureId: string, index: number, node: any }[]} */
            const hits = [];
            for (let i = features.length - 1; i >= 0; i--) {
                const nodesAt = visibleAt(featureNodes[features[i].id] || [], ui.pointer.x, ui.pointer.y);
                let hit = hitTestAny(nodesAt, ui.pointer.x, ui.pointer.y);
                // A geo region is a projected `d` path: test the pointer against its
                // rings in SCREEN space (even-odd over every ring, so holes and
                // multipolygons count) — right under every projection, including an
                // identity over pre-projected coordinates, where inverting to lon/lat
                // would hand degrees-shaped pixels to a spherical test.
                if (!hit && features[i].supportsGeo) {
                    const nodesHere = nodesAt;
                    const ptr = /** @type {{ x: number, y: number }} */ (ui.pointer);
                    for (let k = nodesHere.length - 1; k >= 0; k--) {
                        const n = nodesHere[k];
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
                // A path (a line, an area band) has no row of its own: name the row of
                // its nearest vertex.
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

        const guideCtx = {
            scales: chart.scales,
            // The primary table's rows — what a chart-level guide means by "the data".
            // A guide drawn about a MARK reads that mark's own table (and that table's
            // invariants) through tableOf / constraintsIn.
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
            // The current stage, so an edit's auto-guide can suppress itself when
            // its edit is inactive (one guide path, gated by the same rule as edits).
            stage: getStage()
        };
        // One build signature for all three kinds of feature. A mark and an element
        // are `build(rows, scales, width, height, ctx)`; a guide is the same five,
        // so "what a feature is" differs only in what it VIEWS (`views`), never in
        // how the engine calls it. The rows are the primary table's — what a
        // chart-level guide means by "the data".
        allGuides.forEach(guide => {
            const nodes = guide.build(
                guideCtx.data, chart.scales, chart.innerWidth, chart.innerHeight, guideCtx,
            ) || [];
            nodes.forEach((/** @type {any} */ node) => {
                node.guide = true;
                scene.add(node);
            });
        });

        // ── The interaction-STATE pass ───────────────────────────────────────
        // ONE place decides what every interaction state looks like, for every
        // feature, however the state arose — and for BOTH of the effects layer's
        // mechanisms (the mark's own restyle and the outline overlay). The renderer
        // used to own the restyle half off its own pointerenter/d3.drag, which is why
        // `hovered: { fill }` painted only under SVG direct pick and `selected:
        // { fill }` did nothing at all; it is a dumb applier of `node.effectStyle` now.
        //
        // That matters most for HOVER, which has two sources that must be
        // indistinguishable to a reader:
        //
        //   · a proximity driver resolved this row as the one a gesture would take
        //     (session.activeIndex ?? session.hoverIndex), and
        //   · the pointer is simply over the mark (ui.hover, from the renderer).
        //
        // Both mean "this is the mark you are about to touch", so both feed the same
        // effect rather than one being a driver's private guide and the other not
        // existing at all. Selection is the committed answer and outranks hover, so a
        // selected row is not also drawn as hovered. `grabbed` (ui.grab, bracketed by
        // dragstart/dragend) is the in-flight one, and it STACKS: a mark you are
        // dragging is still the selected one, so the two merge rather than compete
        // (effectStyleFor resolves the overlap in EFFECT_STATES order).
        //
        // Drawn per FEATURE and keyed by DATUM index, so hovering a bar lights its
        // label up too — and per TABLE, so selecting node 3 does not also light up
        // link 3 in a network.
        /** @type {Record<string, Set<number>>} */
        const selectedByTable = {};

        // Rows LIT by hover or grab, per TABLE rather than per feature: a node tagged
        // `onHover` (a port) paints only while its row is lit, and the row it belongs
        // to is lit by hovering ANY feature over that table — the sticker body as
        // much as the port itself. Hover stays per feature for the `hovered` effect
        // (a bar's label lights with the bar, not a link with the same index).
        /** @type {Record<string, Set<number>>} */
        const litByTable = {};
        const light = (/** @type {any} */ ref) => {
            if (!ref || ref.index == null) return;
            const f = features.find((x) => x.id === ref.featureId);
            if (!f || f.table == null) return;
            (litByTable[f.table] || (litByTable[f.table] = new Set())).add(ref.index);
        };
        light(ui.hover);
        light(ui.grab);
        chart.sceneHasOnHover = false;
        // While a drag that ends ON something is in flight (connect, rewire), its
        // driver lists the ports a release could land on (`session.targets`). Then
        // exactly those ports show, across features: a rewire on the link mark
        // lights the node mark's ports.
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
        const flying = flyingRoots
            ? new Set(flyingRoots.flatMap((i) => [i, ...treeOf(schemaSpec, chart.tables).descendantsOf(i)]))
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
            // A node in flight takes its contents with it, so they are held too —
            // on whichever marks draw them.
            if (flying && feature.table === hierarchyNodes) {
                for (const i of flying) grabbed.add(i);
            }
            // Where a release now would put the node in flight: the container a
            // parked nesting proposal names. Only a drop the trial commit ACCEPTED
            // is ever parked, so a refused container never lights.
            /** @type {Set<number>} */
            // Lit on the SHAPE that receives it (a box host), not on a label drawn
            // over the same rows.
            const target = boxHosts.includes(feature) ? dropInto : new Set();

            /** @type {[Set<number>, any][]} */
            const byState = [
                [hovered, effects.hovered],
                [selected, effects.selected],
                [target, effects.target],
                [grabbed, effects.grabbed],
            ];

            // The HANDLE hover names, when a row draws several (a band's y1 and y2
            // edges, a trend's intercept and slope). The pointer names one directly
            // (ui.hover.node); a proximity driver names one by the `channel` its
            // session locked or would lock (a band sweep's edge). Found by tags, not
            // identity — this pass runs on freshly built nodes. Without it the row's
            // FIRST node was outlined, so hovering a band's upper edge lit the lower.
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

            // Restyle half: merge the element props of every state a datum is in onto
            // that datum's own nodes. Stamped on the node so it survives into both
            // renderers and, being the mark's own node, lands on the mark's actual
            // position however it is transformed.
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
                // Hover names ONE handle of the row; its sibling is not the mark
                // a gesture would take, so it keeps its own paint.
                if (isOtherHandle(node)) states = states.filter((s) => s !== effects.hovered);
                const style = effectStyleFor(states);
                if (style) node.effectStyle = style;
            }

            // Visibility half: an `onHover` node is hidden until its row is lit — by
            // this feature's own states, or by hover/grab on any feature over the
            // same table. A PORT is shown only where it is usable: at rest, the ports
            // a link can start from (and only if one could land somewhere); during a
            // drag, exactly the drop targets. Hidden is opacity 0 and no pointer
            // events, so a hidden port never swallows a press meant for the node.
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

            // Overlay half: the padded outline, the one part of the vocabulary that
            // needs geometry the mark itself doesn't have. A hovered HANDLE — one of
            // several nodes a feature draws for one row — is outlined itself, found
            // by its tags rather than by identity (this pass runs on freshly built
            // nodes); every other case outlines the row's first node, as before.
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

    return { container, scene, recomputeInner, measure, applyResize, update };
}
