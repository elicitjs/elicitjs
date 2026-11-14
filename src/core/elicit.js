// @ts-check
import { SceneGraph, paintOrder, clipRect, clipProblem } from './scene.js';
import { resolveScales } from './resolve.js';
import { createProjection } from './projection.js';
import { parsePath, flatten } from '../plot/shapes.js';
import { isNodeLocked } from './lock.js';
import { collectEdits, resolveChannels, warnMisplacedEdits } from '../edit/route.js';
import { markCenter } from '../edit/shared.js';
import { hitTestAny, pointInPolygon, clipVisible } from '../edit/pick.js';
import { encodeChannel } from '../plot/mark.js';
import { portKey } from '../plot/port.js';
import { needsPlaneOnTop } from '../edit/drivers/index.js';
import { autoEditGuides } from '../edit/guide.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { resolveEffects, stateEffectNodes, outlineNodes, effectStyleFor } from './effects.js';
import { resolveTheme } from './theme.js';
import { panelNodes } from './panel.js';
import { reserveLegends } from './legends.js';
import { reserveTitles, titleNodes } from './titles.js';
import {
    validateTables,
    normalizeSchema, denormalizeSchema, normalizeData, enforceRefs,
} from './schema.js';
import { axisOf, pointerForChannel } from './encoding.js';
import { nestingOf, treeOf, enforceTree } from './hierarchy.js';
import { warn } from './dev.js';
import { createChartState } from './engine/state.js';
import { createHistory } from './engine/history.js';
import { createTables } from './engine/tables.js';
import { createSelection } from './engine/selection.js';
import { createStages } from './engine/stages.js';
import { createNodes } from './engine/nodes.js';
import { createCompute } from './engine/compute.js';
import { createDispatch } from './engine/dispatch.js';
import {
    assembleFeatures, bindFeatureTables, desugarPorts, desugarContainers, tipGuidesOf, viewerChannelsOf,
} from './engine/features.js';
import {
    markLabel,
    warnScaleRequirements, warnScopeMismatch, warnProjectionCartesianMix,
    warnDuplicatePlaneEdits, warnUnreachableLegendRow, warnConnectConflict, warnNestAlone,
    warnCreateOnNonMark, warnCreateEmptyExtent, warnDeadEditChannels, warnMissingEditChannels, warnHiddenHandles,
    warnUnknownSpecKeys, warnUnclaimedPick, warnUnknownEditOptions,
} from './guards.js';

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
 * @param {import('../types').ElicitSpec} spec
 * @returns {import('../types').ElicitElement}
 */
export function Elicit(spec) {
    warnUnknownSpecKeys(spec);
    const {
        width = 600,
        height = 400,
        margins = { top: 20, right: 20, bottom: 30, left: 40 },
        // `schema` and `scales` are read straight off the spec by resolveScales:
        // the schema owns each field's data type and DOMAIN, and `scales` is the
        // chart-level per-channel scale override. `marks`, `elements`, `axes` and
        // `legends` become the feature list (engine/features.js).
        guides = [],
        // Interaction-effects layer (grab / proximity-select), customizable and
        // kept separate from mark style channels. See core/effects.js.
        effects: effectsSpec,
        // Sizing mode. 'fixed' (default) renders at the given pixel width/height.
        // 'scale' renders once at those dims but wraps the SVG in a viewBox so the
        // browser scales it to fill the parent (aspect ratio preserved, one draw).
        // 'reflow' measures the parent and re-renders at native pixels on resize
        // (crisp text, width tracks the container, height stays the given value).
        // `responsive: true` is an alias for 'reflow'.
        responsive,
        // SVG overflow. Default 'hidden' clips marks to the viewport. 'visible' lets
        // content in the margin band show — needed for radial/gauge axis labels that
        // sit just outside the plot area.
        overflow = 'hidden',
        // Browser focus ring on editable marks. Off by default — Tab / arrow keys
        // still work; only the native outline is suppressed. See types.ElicitSpec.
        focusOutline = false,
        renderer = new D3Renderer()
    } = spec;

    const mode = responsive === true ? 'reflow'
        : (responsive === 'scale' || responsive === 'reflow') ? responsive
            : 'fixed';

    // Resolve the chart's theme once (DEFAULT_THEME < setTheme() base < spec.theme).
    // Stamped on the scale map every render (the projection-transport pattern) so
    // build() and edit/guide ctx read it without a widened signature. The theme also
    // supplies the DEFAULTS the effects layer merges under, so a themed chart's
    // grab/select feedback follows the theme unless the chart's own `effects` wins.
    const theme = resolveTheme(spec.theme);
    const effects = resolveEffects(effectsSpec, theme.effects);

    // The flattened feature list: auto axes, elements, marks, implicit legends —
    // each with an id (engine/features.js).
    const features = assembleFeatures(spec, theme);
    // Whether any feature is a space-reserving legend (core/legends.js). Static —
    // the feature set doesn't change — so the reservation step is skipped entirely
    // for the common no-legend chart.
    const hasLegends = features.some((f) => f && f.isLegend);
    // Does an axis carry a title that may need room past the author's margin?
    const hasAxisTitles = () => features.some((f) => f && f.isAxis && typeof f.measureTitle === 'function');

    // The bindings a commit or a resize REASSIGNS live on one shared object, so the
    // engine modules wired below read the live value (see engine/state.js).
    const chart = createChartState();
    // Transient interaction (UI) state, separate from the belief `dataset`. The
    // interaction drivers keep a per-feature session here (proximity selection,
    // sweep/draw locks) — those locks belong to one mark's gesture, so they stay
    // keyed by feature id. `preview` holds THE UNCOMMITTED proposal a driver parked
    // (the probe driver's hover/drag), keyed by feature id: each entry is the
    // proposed dataset that feature would commit. The committed rows are still what
    // every mark draws; a proposal is rendered as an inert GHOST of only the rows it
    // would change, layered on top (see update()'s ghost pass). It never reaches the
    // belief store, `onChange`, or `getData`. Cleared on commit, hoverout, and stage
    // change. Per-feature (not one global slot) so two probe marks can't clobber
    // each other's ghost.
    // `selection` is transient PIPELINE state: which dataset rows are currently
    // selected, an interaction concept the engine owns — never a `selected` data
    // column. A Set (single-exclusive today, so at most one member; a Set so
    // multi-select is a later widening, not an API break). Written only through the
    // selection commit path (edit.select / el.select), reset on setData/stage
    // change, and stamped onto the scale map each render (scales.selection) so a
    // legend/mark can target "the selected row" without a widened build signature.
    // `hover` is the OTHER transient pointer state: which feature+row the pointer is
    // currently over, written by the renderer's hover/hoverout events on any editable
    // node. It feeds the same `hovered` effect a proximity driver's session does, so
    // "this is the mark you are about to touch" looks the same however it was
    // resolved. Cleared on hoverout, stage change and reseed, like `session`.
    // `grab` is its mid-gesture counterpart: which feature+row a drag is currently on,
    // bracketed by the same dragstart/dragend the undo transaction uses. It exists so
    // the `grabbed` effect is decided in the state pass with the other two, rather
    // than being painted by the renderer straight off d3.drag — that split is why
    // `grabbed` used to honour `filter` and silently ignore the rest of its vocabulary
    // (and never drew an outline at all).
    /** @type {{ session: Record<string, any>, preview: Record<string, { table: string, rows: any[], pointer?: { x: number, y: number }, dropInto?: number | null }> | null, selection: Set<string>, hover: { featureId: string, index: number, node?: any } | null, grab: { featureId: string, index: number } | null, pointer: { x: number, y: number } | null, hit: { featureId: string, index: number, node: any } | null, hits: { featureId: string, index: number, node: any }[] }} */
    // `pointer` is where the pointer is over the plot (scene coordinates), and
    // `hit` the row under it whether or not it is editable — recorded only when
    // a guide reads them (`tracksPointer`), and never dispatched: a tip or a
    // crosshair is STATE a guide draws, so no mark becomes pointer-active to
    // show one and dispatch does not change.
    const ui = { session: {}, preview: null, selection: new Set(), hover: null, grab: null, pointer: null, hit: null, hits: [] };

    // Working dims. In 'reflow' mode `curW` tracks the container's measured width
    // (height stays the given value); 'fixed'/'scale' keep the design dims. Marks
    // and scales read the inner (margin-subtracted) dims, so recomputing them on a
    // resize is all it takes for the whole scene to reflow.
    const designW = typeof width === 'number' ? width : 600;
    const designH = typeof height === 'number' ? height : 400;
    chart.curW = designW;
    chart.curH = designH;
    // Author margins are the outer padding / axis room. Legends RESERVE extra space
    // on their side (see core/legends.js), so the engine works with EFFECTIVE
    // margins = author margins + each side's legend band. Recomputed every render;
    // equals the author margins when there are no legends.
    const authorMargins = margins;
    chart.effectiveMargins = { ...authorMargins };
    chart.innerWidth = chart.curW - chart.effectiveMargins.left - chart.effectiveMargins.right;
    chart.innerHeight = chart.curH - chart.effectiveMargins.top - chart.effectiveMargins.bottom;

    // The engine OWNS the schema — an editable axis (edit.axis.*) reshapes a field's
    // DOMAIN, which lives on the schema. Clone it so a domain edit never mutates the
    // caller's spec object; resolveScales reads this copy every render, so a domain
    // write reflows axis, grid, guides and marks for free.
    //
    // `normalizeSchema` (core/schema.js, the schema's owner) applies the author-side
    // sugars once, here, and returns the canonical SchemaSpec — the structure, its
    // named tables, and the role -> name binding. Nothing downstream re-sniffs how
    // the author spelled it. `el.getSchema()` denormalizes on the way back out, so a
    // single-table chart still sees the bare field map it always has.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The schema AS DECLARED, kept apart from the live one a domain edit reshapes:
    // the ceiling a zoom widens back out to, and what `setDomain(field, null)`
    // restores.
    const seedSchemaSpec = structuredClone(schemaSpec);
    // The PRIMARY table's field map, by identity — so the in-place domain writes
    // below (and undo's restore) keep the canonical spec consistent for free.
    /** @type {Record<string, import('../types').FieldSchema>} */
    const schema = schemaSpec.tables[schemaSpec.primary].fields;

    // 1. The belief store: ONE dataset for the chart, whose STRUCTURE the schema
    //    declares. Every mark is a view over one of its tables, encoding some
    //    columns and (where it carries an edit) writing them back. structuredClone
    //    rather than a JSON round-trip so seed `Date` values survive for a
    //    time-scale edit; `normalizeData` splits them per table (a bare array is the
    //    primary table, which is every single-table chart).
    chart.tables = normalizeData(structuredClone(spec.data ?? null), schemaSpec);

    // The belief store's accessors (engine/tables.js): which table a feature draws
    // and an edit writes, which rows are context or locked, what the chart REPORTS,
    // and the invariants that hold over each table.
    const {
        tableOf, targetTableOf, primaryRows,
        seedContext, isContextRow, reportedRows, rowIndexOf, reportedIndexOf, shapeData,
        recountSeed, isLockedIn, lockRowsIn, constraintsIn,
    } = createTables(chart, { spec, schemaSpec });

    // CONTEXT rows (spec.context): decided ONCE, over the seed, and held as row
    // IDENTITY — see engine/tables.js.
    seedContext();

    // Which TABLE each feature is a view over, by name or by ROLE (engine/features.js).
    bindFeatureTables(features, schemaSpec);

    // `ports` on a node mark desugars into a sibling PORT feature (engine/features.js).
    const nodesTableName = schemaSpec.byRole.nodes || null;
    desugarPorts(features, nodesTableName);

    // `contains` / `dodge` / `fit` under a hierarchy (engine/features.js).
    const hierarchyNodes = nestingOf(schemaSpec) ? nodesTableName : null;
    desugarContainers(features, hierarchyNodes);

    // The node table's RULES (box, ports, contains, dodge) and the hierarchy's
    // settling, read once from the marks that draw the nodes (engine/nodes.js).
    const {
        boxHosts, nodeBoxRule, nodePortsRule, containsRule,
        settleNodes, settledNodes, inFlight, heldStill,
    } = createNodes(chart, { features, schemaSpec, ui, nodesTableName, hierarchyNodes, isLockedIn });
    // The channel map of the mark that DRAWS a table (engine/features.js).
    const channelsDrawing = viewerChannelsOf(features);

    // How many rows each table was SEEDED with, for `lock: 'seed'` (see
    // engine/tables.js: isLockedIn). Counted here, once the seed is final.
    recountSeed();

    // Check the SEED rows against that contract once, here (see core/schema.js for
    // the checks and why each is a defect). Seed rows are the only place a mismatch
    // can originate: an edit mints from schemaDefaults and writes through a channel's
    // own field, so it cannot introduce an undeclared column.
    validateTables(schemaSpec, chart.tables);
    // A hierarchy's nesting rows must describe a TREE. validateTables has just said
    // which seeded rows do not; drop them, so nothing downstream meets a node with
    // two parents. (A no-op for every other structure.)
    enforceTree(schemaSpec, chart.tables);
    // The resolver sees the RESOLVED theme (not the raw spec.theme partial), so its
    // colour-scale range fallback can read theme.palette/ramp/diverging.
    const liveSpec = { ...spec, schema, schemaSpec, theme };

    // The primary table's invariants, for the guide layer (a guide draws a rule about
    // a mark, and resolves the mark's own table through guideCtx.tableOf).
    const datasetConstraints = constraintsIn(schemaSpec.primary);

    // Auto-guides: an edit declared `guide: true` self-draws its guide (constraint
    // bounds + nearest snap ring) without the caller repeating the feature id in a
    // top-level guides list (see edit/guide.js).
    // A mark's `tip` shorthand desugars into a tip GUIDE (engine/features.js).
    const tipGuides = tipGuidesOf(features);
    const allGuides = [...autoEditGuides(features), ...guides, ...tipGuides];
    // Does any guide read the pointer? Then the renderers report pointer movement
    // and the engine re-renders on it; otherwise a chart never pays for that.
    const tracksPointer = allGuides.some((g) => g && g.tracksPointer);

    // Was the plane raised on the last render? Only then does a hover arrive as
    // a plane gesture over a mark (see handleEvent's hover routing).
    chart.planeRaised = false;
    // Clip the marks to the plot rect? `spec.clip` says so; left unset, a chart
    // clips when any edit moves a domain as a WINDOW over the data (`viewport`:
    // zoom, pan), because then rows legitimately sit past the axes. Decided once
    // over EVERY edit, not the active stage's, so a stage change never flips it.
    // `{ pad }` grows the rect past the axes (`clipRect`, the one place the rect
    // is decided — the renderers and the hit filter below both read it).
    const clipAuto = features.some((f) => collectEdits(f).some((e) => e.viewport));
    { const problem = clipProblem(spec.clip); if (problem) warn('spec:clip', problem); }
    const clipNow = () => clipRect(spec.clip, clipAuto, chart.innerWidth, chart.innerHeight);
    // Under the clip a mark outside the clip rect is not drawn, so it must not be
    // grabbed or tipped either: past the rect only `unclipped` nodes (a chart
    // element's handles, legend swatches, a mark that says `clip: false`) are
    // hit-testable.
    /** @param {any[]} nodes @param {number} x @param {number} y */
    const visibleAt = (nodes, x, y) => clipVisible(nodes, x, y, clipNow());

    // Does the last built scene carry any `onHover` node (a port)? Then a hover
    // change must re-render even when the `hovered` effect paints nothing.
    chart.sceneHasOnHover = false;
    /**
     * Which HANDLE of a row a node is, by the tags marks use to tell their handles
     * apart — stable across rebuilds, which object identity is not.
     * @param {any} node
     */
    const handleKey = (node) => (node
        ? `${node.index}\0${node.channel ?? ''}\0${node.side ?? ''}\0${node.vertexIndex ?? ''}`
        : '');

    // Caller-facing observers. `change` fires on every committed edit; `stage` fires
    // when setStage advances; `select` fires when the selection changes (no data
    // moved, so it is NOT a `change`). Attached to the returned container as
    // `.on('change' | 'stage' | 'select', cb)`.
    /** @type {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} */
    const listeners = { change: new Set(), stage: new Set(), select: new Set() };

    // Multi-stage elicitation (engine/stages.js): `activeEdits` is the single gate
    // the dispatch/editable/plane-on-top paths run their edits through.
    const stages = createStages({ spec, ui, listeners, update: () => update() });
    const { getStage, activeEdits, applyStage } = stages;

    // Selection (engine/selection.js): which rows the reader has picked, stored
    // QUALIFIED BY TABLE, and the commit path both edit.select and el.select* use.
    const selection = createSelection(chart, {
        schemaSpec, ui, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf,
        update: () => update(),
    });
    const {
        selectionIn, selectionPrimary, selectionList,
        commitSelectionEdit,
    } = selection;

    // ---- Undo history --------------------------------------------------------
    // Snapshot store, one entry per GESTURE (see engine/history.js). Built here so
    // every commit path below can record into it; the late-bound deps are defined
    // further down this function.
    const history = createHistory(chart, {
        schemaSpec, ui,
        isContextRow: (name, d) => isContextRow(name, d),
        applyResize: (size) => applyResize(size),
        notifyChange: () => notifyChange(),
        update: () => update(),
    });
    const { snapshot, restoreSnapshot, beginTxn, endTxn, recordHistory } = history;

    // Notify a committed change. One place, so undo/redo tell the caller exactly
    // what an edit does.
    const notifyChange = () => {
        if (spec.onChange) spec.onChange(shapeData());
        for (const cb of listeners.change) cb(structuredClone(shapeData()));
    };

    // The most recently built scene nodes per feature, so plane-pick edits can
    // hit-test against exact mark geometry and guides can look marks up by index.
    /** @type {Record<string, any[]>} */
    const featureNodes = {};

    // How an edit runs, from gesture to commit (engine/compute.js): the context its
    // apply() sees, the invariants that judge it, the commit, the preview, and the
    // trial commits that decide which drop targets show.
    const {
        frameScalesFor, editContext, arbitrates, computeEdit, runEdit,
        commitDomainEdit, previewEdit, reachableKeys, portAvailable,
    } = createCompute(chart, {
        schemaSpec, seedSchemaSpec, ui, featureNodes, hierarchyNodes, boxHosts,
        tableOf, targetTableOf, isLockedIn, lockRowsIn, constraintsIn,
        nodeBoxRule, nodePortsRule, containsRule, channelsDrawing,
        settleNodes, settledNodes, heldStill, activeEdits,
        selectionPrimary, commitSelectionEdit, recordHistory, notifyChange,
        applyResize: (size) => applyResize(size),
    });

    // 2. Calculate scales (Observable Plot model): one GLOBAL scale per channel,
    //    resolved from the union of every feature's channels, with the schema
    //    supplying each field's data type and domain. Recomputed each render so an
    //    inferred domain (a field the schema left open) tracks data as create/drag
    //    mutate it. `scales` is a channel map { x, y, fill, size, … }; unused
    //    channels are absent.
    const dims = { width: chart.innerWidth, height: chart.innerHeight };
    chart.scales = resolveScales(features, chart.tables, liveSpec, dims);
    // Settle a seeded hierarchy now, against the declared size, so `getData()` is
    // already exact before the first (deferred) render.
    settleNodes(null, null, {});
    chart.spaceNext = false;

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

    // Event routing (engine/dispatch.js): the one path from a renderer's event to
    // the edits — direct to the touched mark, plane gestures through the drivers.
    const { handleEvent, rowTargeted } = createDispatch(chart, {
        features, ui, effects, tracksPointer, featureNodes, hierarchyNodes, boxHosts,
        history, tableOf, activeEdits, getStage, applyStage, arbitrates, frameScalesFor,
        runEdit, previewEdit, reachableKeys, settledNodes, heldStill, notifyChange,
        handleKey, visibleAt,
        update: () => update(),
    });

    // Caller-facing data API, attached to the container the engine returns. This
    // is pure observation over the belief `dataset` — it adds no interaction path
    // (edits/constraints stay the only way a gesture mutates data).
    const el = /** @type {import('../types').ElicitElement} */ (/** @type {any} */ (container));
    // A deep copy so callers can't mutate the live store; structuredClone (not a
    // JSON round-trip) preserves Date values a time-scale edit may have written.
    el.getData = () => structuredClone(shapeData());
    // A deep copy of the engine-owned schema, so a caller can read a DOMAIN an
    // editable axis reshaped (the caller's original spec.schema is never mutated).
    // Denormalized back to the spelling it was GIVEN in: a single-table chart gets
    // its bare field map, so the engine's canonical form never leaks outward.
    el.getSchema = () => structuredClone(denormalizeSchema(schemaSpec));
    // Replace the dataset and re-render. Bypasses constraints by design:
    // constraints gate GESTURES; caller-supplied data is trusted (seeding/reset).
    // That includes the lock: setData RE-SEEDS the chart, so under `lock: 'seed'`
    // the rows it hands in become the new read-only seed.
    el.setData = (/** @type {any[] | Record<string, any[]>} */ data) => {
        // Same split as the seed: a bare array is the primary table, a keyed object
        // names its tables. So a caller's setData(rows) keeps working verbatim.
        const next = normalizeData(structuredClone(data ?? null), schemaSpec);
        // setData takes what getData gives: the ELICITED rows. The context rows are
        // reference, not an answer, so they are kept — the same objects, so their
        // membership survives — ahead of the new rows.
        for (const name of Object.keys(chart.contextRows)) {
            const keep = (chart.tables[name] || []).filter((d) => isContextRow(name, d));
            if (keep.length) next[name] = [...keep, ...(next[name] || [])];
        }
        chart.tables = next;
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, chart.tables, 'setData()');
        // Under a hierarchy an outside caller (a program, a model) re-parents by
        // writing nesting rows, so its data gets the repairs a gesture's commit
        // gets: a membership naming a missing node goes, and so does one that
        // breaks the tree. Scoped to hierarchies so no existing chart changes.
        if (nestingOf(schemaSpec)) {
            enforceRefs(schemaSpec, chart.tables);
            enforceTree(schemaSpec, chart.tables);
            chart.spaceNext = true;
            chart.stroking = false;
            chart.strokeNodes = null;
        }
        recountSeed();
        ui.preview = null;
        ui.hover = null;   // the pointer's row index is new too
        ui.grab = null;    // and any in-flight grab points at a row that just moved
        ui.selection.clear(); // a reseed's row indices are new; drop the old selection
        // A reseed is a new starting point, not an edit: there is nothing sensible
        // to undo BACK to (and undoing past it would resurrect rows the caller
        // replaced, under a lock that no longer covers them).
        history.reset();
        update();
    };

    // Set a field's DOMAIN from outside: a zoom button, a "reset view" control. The
    // external twin of edit.axis.zoom / edit.axis.scale, through the SAME domain
    // commit a gesture takes (undoable, `change` notified, scales reflow). `null`
    // restores the domain declared at Elicit().
    el.setDomain = (/** @type {string} */ field, /** @type {any[] | null} */ domain, options = {}) => {
        const table = options && options.table != null ? options.table : schemaSpec.primary;
        const t = schemaSpec.tables[table];
        if (!t || !t.fields[field]) {
            warn(
                `setDomain:field:${table}.${field}`,
                `el.setDomain("${field}"): table "${table}" declares no field "${field}". ` +
                `Declared fields: ${t ? Object.keys(t.fields).map((f) => `"${f}"`).join(', ') : 'none'}.`
            );
            return false;
        }
        const seed = seedSchemaSpec.tables[table] && seedSchemaSpec.tables[table].fields[field];
        const next = domain == null ? (seed && seed.domain) : domain;
        if (!Array.isArray(next)) {
            warn(`setDomain:domain:${field}`, `el.setDomain("${field}"): no domain to set (none declared to restore).`);
            return false;
        }
        endTxn();
        commitDomainEdit({ domains: { [field]: structuredClone(next) } }, table);
        endTxn();
        update();
        return true;
    };

    // ── Selection: read/drive the transient selection from outside ────────────
    // Selection is pipeline state, not data — so it has its own small API beside
    // getData/setData, and its own `select` event. Driving it externally goes
    // through the SAME applySelection the edit.select gesture does (see
    // engine/selection.js), so an external <select>, a keyboard, or a click all
    // leave the selection in one shape.
    el.getSelection = selection.api.getSelection;
    el.getSelectionAll = selection.api.getSelectionAll;
    el.select = selection.api.select;
    el.toggleSelection = selection.api.toggleSelection;
    el.selectAll = selection.api.selectAll;
    el.selectWhere = selection.api.selectWhere;
    el.clearSelection = selection.api.clearSelection;

    // ── External control: drive an edit from outside the chart ────────────────
    // An external controller (a slider, a `<select>`, a rotate icon, a plain
    // function) is a new INPUT SOURCE, not a second interaction system. It
    // synthesizes the SAME renderer-shaped events the pointer and keyboard
    // produce and feeds them to the one `handleEvent` — exactly what the keyboard
    // `nudge` normalizer already does above. Constraints, undo, guides,
    // `on('change')`, and re-render all run because the event traverses the
    // identical pipeline. No new pick, no driver, no dispatch branch.

    // Low-level: inject a renderer-shaped event. `x`/`y` are INNER (margin-
    // subtracted) pixels — the space `ctx.pointer` reads. Event shape:
    // { type, node?, x?, y?, value?, nudge?, rawEvent? }. Callers usually want
    // `el.control(name)` (below), which computes pixels from a DATA value for you.
    el.emit = (/** @type {any} */ event) => handleEvent(event);

    // Find the (feature, edit) an external controller addresses by `name` (set via
    // move({ name: 'move' }) etc.). Lazy — scanned each call so it tracks re-renders
    // and stage changes.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any } | null} */
        let hit = null;
        // Count DISTINCT edits, by their `apply` — the one part of a descriptor that
        // survives collectEdits' channel-injecting copy and is unique per factory
        // call. The name is ambiguous only when two edits that do different things
        // answer to it; ONE edit declared on several parts of a glyph (a face's two
        // eyes, its two brows) is not a collision, and "driving the first" is exactly
        // right there — they are the same edit over the same column.
        /** @type {Set<any>} */
        const distinct = new Set();
        for (const feature of features) {
            for (const edit of collectEdits(feature)) {
                if (edit.name !== name) continue;
                distinct.add(edit.apply);
                if (!hit) hit = { feature, edit };
            }
        }
        if (distinct.size === 0) warn(`control:none:${name}`, `el.control("${name}"): no edit is named "${name}".`);
        if (distinct.size > 1) warn(`control:many:${name}`, `el.control("${name}"): ${distinct.size} different edits share the name "${name}"; driving the first.`);
        return hit;
    };

    // The scene node for a datum index in a feature, resolved fresh from the CURRENT
    // render (never cached — nodes are rebuilt every update). Gives radial edits
    // (resize/rotate about the mark) their pivot via markCenter.
    const nodeAt = (/** @type {any} */ feature, /** @type {number} */ index) =>
        (featureNodes[feature.id] || []).find((/** @type {any} */ n) => n && n.index === index) || null;

    // High-level façade: a handle bound to a named edit + datum. It reads the edit's
    // own `gesture` to route value-space vs pointer-space — the FAÇADE branches; the
    // engine dispatch never learns a controller exists.
    el.control = (/** @type {string} */ name, /** @type {number} */ index = 0) => {
        // `index` is a REPORTED index (see reportedRows) — row i of getData() — so
        // it is translated to the row's place in the table the edit's mark draws.
        const rowOf = (/** @type {any} */ feature) => rowIndexOf(feature ? feature.table : schemaSpec.primary, index);
        // Value -> the pointer that would set it, forward-encoding through the SAME
        // scale the edit inverts (the inverse of the edit's inverse — encoding, run
        // forward). Mirrors the nudge normalizer: untouched axes keep the datum's
        // CURRENT pixel so they don't teleport.
        const dragPointer = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {any} */ value) => {
            const node = nodeAt(feature, rowOf(feature));
            const center = markCenter(node);
            const datum = tableOf(feature)[rowOf(feature)];
            const channels = feature.channels || {};
            // Forward-encode through the SAME scales the edit will invert — which,
            // inside a composite's frame, are the node's own (see frameScalesFor).
            const editScales = frameScalesFor(feature, node, rowOf(feature)) || chart.scales;
            // Base: where the datum currently sits, so a single-axis set doesn't move
            // the other axis.
            let x = datum ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
            const resolved = resolveChannels(edit.channels, channels, editScales, feature);
            // `value` is either a scalar (single-channel edit) or a { channelName: v }
            // / { field: v } map for a multi-channel edit (a 2-D drag).
            const valueFor = (/** @type {any} */ ch) => {
                if (value != null && typeof value === 'object' && !(value instanceof Date)) {
                    if (ch.name in value) return value[ch.name];
                    if (ch.field != null && ch.field in value) return value[ch.field];
                    return undefined;
                }
                return value; // scalar applies to the sole channel
            };
            for (const ch of resolved) {
                if (!ch.scale || !ch.scale.invertible) continue;
                const v = valueFor(ch);
                if (v === undefined) continue;
                const visual = ch.scale.encode(v);
                const p = pointerForChannel(ch.name, visual, center);
                if (!p) continue;
                // A positional channel moves its own coordinate only; anything
                // pointerForChannel resolved about a pivot (a radius, a bearing)
                // sets both. Read off the axis map, never a channel name.
                const a = axisOf(ch.name);
                if (a !== 'y') x = p.x;
                if (a !== 'x') y = p.y;
            }
            return { node, x, y };
        };

        // True between begin() and end(): a live drag session, so `.set` ticks emit a
        // plain `drag` (they collapse into the open txn) instead of a self-closing
        // one-shot `nudge` drag (which would close the txn every tick).
        let live = false;

        // A plane edit whose driver needs more than a row — a draw's stroke, a
        // brush's zone, a creator's pointer — can't be driven by naming a row.
        // Report it rather than dispatch a gesture that silently does nothing.
        /**
         * @param {{ feature: any, edit: any } | null} found @param {string} method
         * @returns {found is { feature: any, edit: any }}
         */
        const drivable = (found, method) => {
            if (!found) return false;
            if (rowTargeted(found.edit)) return true;
            warn(`control:plane:${name}`, `el.control("${name}").${method}(): this edit has pick: "${found.edit.pick}", which finds its target from the pointer, so a row index cannot drive it. Send the gesture with el.emit({ type, x, y }) in inner pixels instead.`);
            return false;
        };

        const handle = {
            // One-shot write. Commit-gesture edits (set/editText) carry the value whole
            // in `ctx.value`; drag-gesture edits forward-encode it to a pointer. Outside
            // a begin()/end() session a drag self-closes its txn with `nudge:true` (one
            // undo entry); inside one, it stays a plain `drag` so the session collapses.
            set(/** @type {any} */ value) {
                const found = findNamedEdit(name);
                if (!drivable(found, 'set')) return;
                const { feature, edit } = found;
                const node = nodeAt(feature, rowOf(feature));
                // editName addresses THIS edit, so a sibling edit sharing the gesture
                // (another set() on the same feature) doesn't also fire.
                if (edit.gesture === 'commit') {
                    el.emit({ type: 'commit', node, value, editName: name, x: node ? node.cx : 0, y: node ? node.cy : 0 });
                    return;
                }
                const { node: n, x, y } = dragPointer(feature, edit, value);
                el.emit(live
                    ? { type: 'drag', node: n, x, y, editName: name }
                    : { type: 'drag', node: n, x, y, nudge: true, editName: name });
            },
            // Live drag: begin()/end() bracket the txn so many .set() ticks collapse
            // into ONE undo entry (exactly like a pointer drag's dragstart..dragend).
            begin() {
                const found = findNamedEdit(name);
                if (!drivable(found, 'begin')) return;
                live = true;
                el.emit({ type: 'dragstart', node: nodeAt(found.feature, rowOf(found.feature)), editName: name });
            },
            end() {
                const found = findNamedEdit(name);
                live = false;
                if (!found) return;
                el.emit({ type: 'dragend', node: nodeAt(found.feature, rowOf(found.feature)), editName: name });
            },
            // Fire a TRIGGER edit — one that takes no value, it just acts on the datum
            // (cycle advances a category, remove drops the row, toggle flips it). An
            // external button drives it: `control(name).fire()` dispatches the edit's
            // own gesture (a click/dblclick) on the datum's node. Pass a gesture to
            // override. This is the counterpart of `.set` for the click/dblclick edits
            // — `.set` covers commit/drag, `.fire` covers the rest. A plane edit that
            // needs a pointer position (create) warns; use `el.emit({ type, x, y })`.
            fire(/** @type {string} */ gesture) {
                const found = findNamedEdit(name);
                if (!drivable(found, 'fire')) return;
                const g = gesture || found.edit.gesture || 'click';
                el.emit({ type: g, node: nodeAt(found.feature, rowOf(found.feature)), editName: name });
            },
            // Raw passthrough, auto-scoped to this feature's node for the datum.
            emit(/** @type {any} */ event) {
                const found = findNamedEdit(name);
                el.emit({ node: found ? nodeAt(found.feature, rowOf(found.feature)) : undefined, ...event });
            },
            // What values this channel ACCEPTS, read off its scale — so external UI
            // (dropdown options, slider min/max, colour choices) respects the scale
            // instead of fighting it. Reads capability flags, never `scale.type`.
            accepts() {
                const found = findNamedEdit(name);
                if (!found) return null;
                const { feature, edit } = found;
                const editScales = frameScalesFor(feature, null, rowOf(feature)) || chart.scales;
                const ch = resolveChannels(edit.channels, feature.channels || {}, editScales, feature)[0];
                const scale = /** @type {any} */ (ch && ch.scale);
                const fieldSpec = (schema && ch && ch.field && schema[ch.field]) || null;
                const measure = (fieldSpec && fieldSpec.type) || null;
                // Prefer the scale's domain; fall back to the schema's declared domain
                // so a non-positional channel (a face param) still reports its range.
                const domain = (scale && typeof scale.domain === 'function' ? scale.domain() : null)
                    || (fieldSpec && fieldSpec.domain) || null;
                const range = scale && typeof scale.range === 'function' ? scale.range() : null;
                return {
                    field: ch ? ch.field : null,
                    type: measure,                         // MeasureType (quantitative/categorical/…)
                    kind: scale ? scale.kind : null,       // band | point | continuous | discrete
                    temporal: !!(scale && scale.temporal),
                    invertible: !!(scale && scale.invertible),
                    // A discrete channel's domain IS its accepted value set; a
                    // continuous channel's domain is its accepted [min, max].
                    domain,
                    values: (
                        (scale && (scale.kind === 'band' || scale.kind === 'discrete' || scale.kind === 'point'))
                        || measure === 'categorical' || measure === 'ordinal'
                    ) ? domain : null,
                    range,
                };
            },
        };
        return handle;
    };

    // Undo / redo one GESTURE (see engine/history.js).
    el.canUndo = history.canUndo;
    el.canRedo = history.canRedo;
    el.undo = history.undo;
    el.redo = history.redo;
    // Subscribe to committed changes; returns an unsubscribe function.
    el.on = (/** @type {'change' | 'stage' | 'select'} */ type, /** @type {Function} */ cb) => {
        listeners[type].add(cb);
        return () => listeners[type].delete(cb);
    };

    // Multi-stage controls (see engine/stages.js).
    el.getStage = stages.api.getStage;
    el.getStageLabel = stages.api.getStageLabel;
    el.setStage = stages.api.setStage;
    el.nextStage = stages.api.nextStage;

    // 'reflow' mode: watch the container and re-render when the parent resizes.
    // rAF-coalesced (a resize can fire many times per frame) and guarded so a
    // render that doesn't change the width can't feed back into a loop.
    /** @type {ResizeObserver | null} */
    let ro = null;
    if (mode === 'reflow' && typeof ResizeObserver !== 'undefined') {
        let scheduled = false;
        ro = new ResizeObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (measure()) update();
            });
        });
        ro.observe(container);
    }
    // Detach the observer (and its hold on the container). Call when unmounting a
    // reflow chart; no-op otherwise.
    el.destroy = () => {
        if (ro) { ro.disconnect(); ro = null; }
    };

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return el;
}
