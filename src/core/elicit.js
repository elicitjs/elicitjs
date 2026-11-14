// @ts-check
import { clipRect, clipProblem } from './scene.js';
import { resolveScales } from './resolve.js';
import { collectEdits } from '../edit/route.js';
import { clipVisible } from '../edit/pick.js';
import { autoEditGuides } from '../edit/guide.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { resolveEffects } from './effects.js';
import { resolveTheme } from './theme.js';
import { validateTables, normalizeSchema, normalizeData } from './schema.js';
import { nestingOf, enforceTree } from './hierarchy.js';
import { warn } from './dev.js';
import { createChartState } from './engine/state.js';
import { createHistory } from './engine/history.js';
import { createTables } from './engine/tables.js';
import { createSelection } from './engine/selection.js';
import { createStages } from './engine/stages.js';
import { createNodes } from './engine/nodes.js';
import { createCompute } from './engine/compute.js';
import { createDispatch } from './engine/dispatch.js';
import { createRender } from './engine/render.js';
import { attachApi } from './engine/api.js';
import {
    assembleFeatures, bindFeatureTables, desugarPorts, desugarContainers, tipGuidesOf, viewerChannelsOf,
} from './engine/features.js';
import { warnUnknownSpecKeys } from './guards.js';

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
    const { endTxn, recordHistory } = history;

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
        frameScalesFor, arbitrates, runEdit,
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

    // Rendering (engine/render.js): the container and its size, and `update()`,
    // which rebuilds the scene from current state and hands it to the renderer.
    const { container, measure, applyResize, update } = createRender(chart, {
        features, ui, spec, theme, effects, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, boxHosts, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, portAvailable, handleKey, clipNow, visibleAt,
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
    });

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
    // The public el.* API (engine/api.js).
    attachApi(el, chart, {
        features, ui, listeners, featureNodes, schema, schemaSpec, seedSchemaSpec, mode, container, history, selection, stages, tableOf, shapeData, isContextRow, rowIndexOf, recountSeed, frameScalesFor, commitDomainEdit, rowTargeted, endTxn, measure,
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
        update: () => update(),
    });

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return el;
}
