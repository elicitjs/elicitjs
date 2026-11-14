// @ts-check
import { clipRect, clipProblem, DEFAULT_MARGINS } from './scene.js';
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
        margins = DEFAULT_MARGINS,
        // `schema` and `scales` are read off the spec by resolveScales; `marks`,
        // `elements`, `axes` and `legends` become the feature list (engine/features.js).
        guides = [],
        // Interaction effects (core/effects.js).
        effects: effectsSpec,
        // Sizing: 'fixed' (default) renders at width/height; 'scale' draws once in a
        // viewBox the browser scales; 'reflow' re-renders at the parent's width on
        // resize. `responsive: true` means 'reflow'.
        responsive,
        // SVG overflow. 'visible' shows content in the margin band (radial/gauge
        // axis labels).
        overflow = 'hidden',
        // Browser focus ring on editable marks; off by default (keyboard still works).
        focusOutline = false,
        renderer = new D3Renderer()
    } = spec;

    const mode = responsive === true ? 'reflow'
        : (responsive === 'scale' || responsive === 'reflow') ? responsive
            : 'fixed';

    // Theme: DEFAULT_THEME < setTheme() base < spec.theme. It also supplies the
    // effects defaults that the chart's own `effects` overrides.
    const theme = resolveTheme(spec.theme);
    const effects = resolveEffects(effectsSpec, theme.effects);

    // The flattened feature list: auto axes, elements, marks, implicit legends —
    // each with an id (engine/features.js).
    const features = assembleFeatures(spec, theme);
    // Static, so the legend reservation step is skipped for a chart with no legend.
    const hasLegends = features.some((f) => f && f.isLegend);
    // Does an axis carry a title that may need room past the author's margin?
    const hasAxisTitles = features.some((f) => f && f.isAxis && typeof f.measureTitle === 'function');

    // The bindings a commit or a resize reassigns live on one shared object, so the
    // engine modules wired below read the live value (see engine/state.js).
    const chart = createChartState();
    // Transient interaction state, never part of the dataset:
    //   session    per-feature driver session (proximity selection, sweep/draw locks)
    //   preview    per-feature uncommitted proposal a driver parked (probe hover/drag),
    //              drawn as an inert ghost of the rows it would change. Never reaches
    //              onChange or getData; cleared on commit, hoverout and stage change.
    //   selection  selected rows, qualified by table (engine/selection.js)
    //   hover      the feature+row under the pointer, from the renderer's hover events
    //   grab       the feature+row a drag is on, so the state pass decides `grabbed`
    //   pointer, hit, hits  the pointer in scene coordinates and the rows under it,
    //              recorded only when a guide `tracksPointer`; never dispatched
    /** @type {{ session: Record<string, any>, preview: Record<string, { table: string, rows: any[], pointer?: { x: number, y: number }, dropInto?: number | null }> | null, selection: Set<string>, hover: { featureId: string, index: number, node?: any } | null, grab: { featureId: string, index: number } | null, pointer: { x: number, y: number } | null, hit: { featureId: string, index: number, node: any } | null, hits: { featureId: string, index: number, node: any }[] }} */
    const ui = { session: {}, preview: null, selection: new Set(), hover: null, grab: null, pointer: null, hit: null, hits: [] };

    // Working dims. 'reflow' tracks the container's width; marks and scales read
    // the inner dims, so a resize only recomputes those.
    const designW = typeof width === 'number' ? width : 600;
    const designH = typeof height === 'number' ? height : 400;
    chart.curW = designW;
    chart.curH = designH;
    // Effective margins = author margins + legend bands (core/legends.js),
    // recomputed every render.
    const authorMargins = margins;
    chart.effectiveMargins = { ...authorMargins };
    chart.innerWidth = chart.curW - chart.effectiveMargins.left - chart.effectiveMargins.right;
    chart.innerHeight = chart.curH - chart.effectiveMargins.top - chart.effectiveMargins.bottom;

    // The engine owns a clone of the schema: a domain edit (edit.axis.*) writes it,
    // never the caller's spec. `normalizeSchema` applies the author-side sugars
    // once; `el.getSchema()` denormalizes on the way out.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The schema as declared: the ceiling a zoom widens back to, and what
    // `setDomain(field, null)` restores.
    const seedSchemaSpec = structuredClone(schemaSpec);
    // The primary table's field map, by identity, so in-place domain writes keep
    // schemaSpec consistent.
    /** @type {Record<string, import('../types').FieldSchema>} */
    const schema = schemaSpec.tables[schemaSpec.primary].fields;

    // 1. The dataset, whose structure the schema declares. structuredClone keeps
    //    seed `Date` values; `normalizeData` splits rows per table.
    chart.tables = normalizeData(structuredClone(spec.data ?? null), schemaSpec);

    // Dataset accessors (engine/tables.js).
    const {
        tableOf, targetTableOf, primaryRows,
        seedContext, isContextRow, reportedRows, rowIndexOf, reportedIndexOf, shapeData,
        recountSeed, isLockedIn, lockRowsIn, constraintsIn,
    } = createTables(chart, { spec, schemaSpec });

    // Context rows (spec.context) are decided once, over the seed (engine/tables.js).
    seedContext();

    // Which table each feature is a view over, by name or by role (engine/features.js).
    bindFeatureTables(features, schemaSpec);

    // `ports` on a node mark desugars into a sibling port feature (engine/features.js).
    const nodesTableName = schemaSpec.byRole.nodes || null;
    desugarPorts(features, nodesTableName);

    // `contains` / `dodge` / `fit` under a hierarchy (engine/features.js).
    const hierarchyNodes = nestingOf(schemaSpec) ? nodesTableName : null;
    desugarContainers(features, hierarchyNodes);
    // The feature list is fixed from here; on a shared id the first feature wins.
    /** @type {Map<string, any>} */
    const featureById = new Map();
    for (const f of features) if (!featureById.has(f.id)) featureById.set(f.id, f);

    // The node table's rules (box, ports, contains, dodge) and the hierarchy's
    // settling, read once from the marks that draw the nodes (engine/nodes.js).
    const {
        boxHosts, nodeBoxRule, nodePortsRule, containsRule,
        settleNodes, settledNodes, inFlight, heldStill,
    } = createNodes(chart, { features, schemaSpec, ui, nodesTableName, hierarchyNodes, isLockedIn });
    // The channel map of the mark that draws a table (engine/features.js).
    const channelsDrawing = viewerChannelsOf(features);

    // Seed row counts for `lock: 'seed'`, taken once the seed is final.
    recountSeed();

    // Check the seed rows against the schema once (core/schema.js). An edit cannot
    // add an undeclared column, so the seed is the only source of a mismatch.
    validateTables(schemaSpec, chart.tables);
    // A hierarchy must be a tree: drop the rows validateTables flagged. No-op for
    // other structures.
    enforceTree(schemaSpec, chart.tables);
    // The resolver sees the resolved theme, for its colour-range fallbacks.
    const liveSpec = { ...spec, schema, schemaSpec, theme };

    // The primary table's invariants, for the guide layer.
    const datasetConstraints = constraintsIn(schemaSpec.primary);

    // Guides: an edit with `guide: true` self-draws (edit/guide.js); a mark's `tip`
    // shorthand desugars into a tip guide (engine/features.js).
    const tipGuides = tipGuidesOf(features);
    const allGuides = [...autoEditGuides(features), ...guides, ...tipGuides];
    // Does any guide read the pointer? Then the renderers report pointer movement
    // and the engine re-renders on it; otherwise a chart never pays for that.
    const tracksPointer = allGuides.some((g) => g && g.tracksPointer);

    // Was the plane raised on the last render? Only then does a hover arrive as
    // a plane gesture over a mark (see handleEvent's hover routing).
    chart.planeRaised = false;
    // Clip marks to the plot rect? `spec.clip` decides; unset, clip when any edit
    // in any stage declares `viewport`, so a stage change never flips it.
    // `clipRect` is the one place the rect is computed.
    const clipAuto = features.some((f) => collectEdits(f).some((e) => e.viewport));
    { const problem = clipProblem(spec.clip); if (problem) warn('spec:clip', problem); }
    const clipNow = () => clipRect(spec.clip, clipAuto, chart.innerWidth, chart.innerHeight);
    // Past the clip rect only `unclipped` nodes are hit-testable, matching what is drawn.
    /** @param {any[]} nodes @param {number} x @param {number} y */
    const visibleAt = (nodes, x, y) => clipVisible(nodes, x, y, clipNow());

    // Does the last built scene carry any `onHover` node (a port)? Then a hover
    // change must re-render even when the `hovered` effect paints nothing.
    chart.sceneHasOnHover = false;
    /**
     * Which handle of a row a node is, by the tags marks use to tell their handles
     * apart — stable across rebuilds, which object identity is not.
     * @param {any} node
     */
    const handleKey = (node) => (node
        ? `${node.index}\0${node.channel ?? ''}\0${node.side ?? ''}\0${node.vertexIndex ?? ''}`
        : '');

    // Caller-facing observers: `change` per committed edit, `stage` on setStage,
    // `select` on a selection change (no data moved, so not a `change`).
    /** @type {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} */
    const listeners = { change: new Set(), stage: new Set(), select: new Set() };

    // Multi-stage elicitation (engine/stages.js): `activeEdits` is the single gate
    // the dispatch/editable/plane-on-top paths run their edits through.
    const stages = createStages({ spec, ui, listeners, update: () => update() });
    const { getStage, activeEdits, applyStage } = stages;

    // Selection (engine/selection.js): which rows the reader has picked, stored
    // qualified BY table, and the commit path both edit.select and el.select* use.
    const selection = createSelection(chart, {
        schemaSpec, ui, listeners, primaryRows, reportedRows, rowIndexOf, reportedIndexOf,
        update: () => update(),
    });
    const {
        selectionIn, selectionPrimary, selectionList,
        commitSelectionEdit,
    } = selection;

    // ---- Undo history --------------------------------------------------------
    // One snapshot per gesture (engine/history.js).
    const history = createHistory(chart, {
        schemaSpec, ui,
        isContextRow: (name, d) => isContextRow(name, d),
        applyResize: (size) => applyResize(size),
        notifyChange: () => notifyChange(),
        update: () => update(),
    });
    const { endTxn, recordHistory } = history;

    // Notify a committed change; undo/redo notify through it too.
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

    // 2. Scales: one global scale per channel, from every feature's channels and
    //    the schema. Recomputed each render so inferred domains track edits.
    const dims = { width: chart.innerWidth, height: chart.innerHeight };
    chart.scales = resolveScales(features, chart.tables, liveSpec, dims);
    // Settle a seeded hierarchy now, against the declared size, so `getData()` is
    // already exact before the first (deferred) render.
    settleNodes(null, null, {});
    chart.spaceNext = false;

    // Rendering (engine/render.js): the container and its size, and `update()`,
    // which rebuilds the scene from current state and hands it to the renderer.
    const { container, measure, applyResize, update } = createRender(chart, {
        features, featureById, ui, spec, theme, effects, renderer, mode, overflow, focusOutline, designW, authorMargins, dims, liveSpec, schema, schemaSpec, allGuides, datasetConstraints, tracksPointer, hasLegends, hasAxisTitles, featureNodes, hierarchyNodes, boxHosts, tableOf, targetTableOf, primaryRows, isLockedIn, constraintsIn, nodeBoxRule, nodePortsRule, settleNodes, heldStill, inFlight, activeEdits, getStage, selectionIn, selectionList, selectionPrimary, portAvailable, handleKey, clipNow, visibleAt,
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
    });

    // Event routing (engine/dispatch.js): the one path from a renderer's event to
    // the edits — direct to the touched mark, plane gestures through the drivers.
    const { handleEvent, rowTargeted } = createDispatch(chart, {
        features, featureById, ui, effects, tracksPointer, featureNodes, hierarchyNodes, boxHosts,
        history, tableOf, activeEdits, getStage, applyStage, arbitrates, frameScalesFor,
        runEdit, previewEdit, reachableKeys, settledNodes, heldStill, notifyChange,
        handleKey, visibleAt,
        update: () => update(),
    });

    const el = /** @type {import('../types').ElicitElement} */ (/** @type {any} */ (container));
    // The public el.* API (engine/api.js). Observation only: edits stay the one
    // path that mutates data.
    attachApi(el, chart, {
        features, ui, listeners, featureNodes, schemaSpec, seedSchemaSpec, mode, container, history, selection, stages, tableOf, shapeData, isContextRow, rowIndexOf, recountSeed, frameScalesFor, commitDomainEdit, rowTargeted, endTxn, measure,
        handleEvent: (/** @type {any} */ event) => handleEvent(event),
        update: () => update(),
    });

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return el;
}
