// @ts-check
import { resolveChannels } from '../../edit/route.js';
import { applyConstraint } from '../../constraints/define.js';
import { enforceRefs, inferMeasureOfDomain } from '../schema.js';
import { axisOf } from '../encoding.js';
import { treeOf, treeProblems } from '../hierarchy.js';
import { fitChannelsOf } from '../fit.js';
import { warn } from '../dev.js';
import { constraintLabel, describe } from '../guards.js';

/**
 * An edit, from gesture to commit: the inverse of encoding.
 *
 * `editContext` builds what an edit's apply() sees; `computeEdit` runs apply and
 * judges the proposal by the DATA-LAYER INVARIANTS (the table's constraints, the
 * edit's own `constrain`, the lock, tree-ness); `runEdit` commits it to the belief
 * store, `commitDomainEdit` writes a domain edit to the schema, and `previewEdit`
 * parks the same proposal as a ghost instead. `reachableKeys` / `portAvailable` are
 * trial commits — "could a drop land here?" — run through the same path.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   seedSchemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   featureNodes: Record<string, any[]>,
 *   hierarchyNodes: string | null,
 *   boxHosts: any[],
 *   tableOf: (feature: any) => any[],
 *   targetTableOf: (feature: any, edit: import('../../types').Edit) => string,
 *   isLockedIn: (name: string) => ((d: any, i: number) => boolean) | null,
 *   lockRowsIn: (name: string) => import('../../types').Constraint | null,
 *   constraintsIn: (table: string) => import('../../types').Constraint[],
 *   nodeBoxRule: () => import('../../types').NodeBoxRule | null,
 *   nodePortsRule: ((row: any, i: number, rows: any[]) => Record<string, string> | null) | null,
 *   containsRule: ((row: any, i: number, rows: any[]) => boolean) | null,
 *   channelsDrawing: (name: string) => Record<string, any> | null,
 *   settleNodes: (before?: any[] | null, frozen?: Set<number> | null, dodge?: any) => void,
 *   settledNodes: (from: Record<string, any[]>, before: any[] | null, frozen: Set<number> | null, dodge?: any) => any[],
 *   heldStill: () => Set<number> | null,
 *   activeEdits: (feature: any) => import('../../types').Edit[],
 *   selectionPrimary: () => number | null,
 *   commitSelectionEdit: (sel: any, table?: string) => boolean,
 *   recordHistory: () => void,
 *   notifyChange: () => void,
 *   applyResize: (size: { width?: number, height?: number }) => void,
 * }} deps
 */
export function createCompute(chart, deps) {
    const {
        schemaSpec, seedSchemaSpec, ui, featureNodes, hierarchyNodes, boxHosts,
        tableOf, targetTableOf, isLockedIn, lockRowsIn, constraintsIn,
        nodeBoxRule, nodePortsRule, containsRule, channelsDrawing,
        settleNodes, settledNodes, heldStill, activeEdits,
        selectionPrimary, commitSelectionEdit, recordHistory, notifyChange,
    } = deps;
    const applyResize = deps.applyResize;

    // The scale map an edit on this node should resolve against. A part of a
    // composite in box mode is drawn inside a per-datum local FRAME, and each of its nodes
    // carries the frame scales it was encoded through — overlaying them is how a
    // gesture inverts back through the same mapping. Returns null when no frame is
    // in play, so the caller keeps the global map unchanged.
    /**
     * @param {any} feature
     * @param {any} node the node a direct-pick gesture landed on, if any
     * @param {number | null} [index] the datum, for a gesture that carries no node
     * @returns {import('../../types').ScaleMap | null}
     */
    const frameScalesFor = (feature, node, index) => {
        let framed = node && node.frame ? node : null;
        if (!framed && index != null && feature) {
            framed = (featureNodes[feature.id] || []).find(
                (/** @type {any} */ n) => n && n.index === index && n.frame
            ) || null;
        }
        return framed ? { ...chart.scales, ...framed.frame } : null;
    };

    // Compute one edit's proposed dataset WITHOUT committing it. `index` addresses
    // the datum being edited (null for create, which appends). The gesture is
    // inverted through the scales in apply(), producing a data-space proposal; that
    // proposal is then judged by the DATA-LAYER INVARIANTS (the dataset's
    // constraints, plus any edit-scoped constrain sugar). Constraints never see
    // pixels. Returns the accepted dataset, or null when the edit is a no-op /
    // rejected.
    //
    // Split out from `runEdit` so a hover can PREVIEW the very same proposal (same
    // apply, same invariants) without writing it to the belief store — see
    // previewEdit + the probe driver.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @param {boolean} [preview] is this a PREVIEW (a ghost) rather than a commit?
     *   An edit may propose a half-made row for a ghost — a link with no target
     *   yet — that it must never commit; the flag is how it tells the two apart.
     * @param {any} [sessionOverride] a session to run against instead of the
     *   feature's own — a trial commit asking "could a drag from HERE land?"
     * @returns {{ ctx: any, targetTable: string, currentData: any[], resolved: any[], derivedOnly: boolean }}
     */
    const editContext = (feature, edit, event, index, preview = false, sessionOverride = undefined) => {
        // WHERE the gesture landed and WHAT it writes are usually the same table, and
        // for every edit that existed before structures they are the same by
        // construction. They come apart for a cross-table edit — `edit.network.connect`
        // is placed on a NODE mark (so `index` addresses a node row) but proposes a
        // LINK row — so the edit may name its target by ROLE, and the two are tracked
        // separately rather than conflated.
        const sourceRows = tableOf(feature);
        const targetTable = targetTableOf(feature, edit);
        const currentData = chart.tables[targetTable] || [];
        const markChannels = feature.channels || {};
        // A node built inside a composite's local FRAME carries the very scales it was
        // encoded through (plot/composite.js stamps `node.frame`). Overlay them so the
        // edit inverts through the same objects — "an edit is the inverse of
        // encoding" holds per datum, with no second inversion path: this is channel
        // resolution honouring which scale drew the thing you grabbed, not a new
        // dispatch branch. A plane-pick gesture carries no node, so fall back to the
        // framed node for this datum.
        const editScales = frameScalesFor(feature, event.node, index) || chart.scales;
        let resolved = resolveChannels(edit.channels, markChannels, editScales, feature);
        let derivedOnly = false;
        // A container's FITTED size is derived from its contents, so no gesture may
        // write it: an edit loses those channels on a row that holds others, and an
        // edit left with none does nothing. A leaf's size — and a container's
        // position, which carries its contents along — stay editable.
        if (hierarchyNodes && feature.table === hierarchyNodes && index != null && resolved.length
            && treeOf(schemaSpec, chart.tables).hasChildren(index)) {
            const derived = fitChannelsOf(markChannels).filter((ch) => axisOf(ch) !== 'x' && axisOf(ch) !== 'y');
            const free = resolved.filter((ch) => !derived.includes(ch.name));
            derivedOnly = !free.length;
            resolved = free;
        }
        const ctx = {
            // The rows the proposal is ABOUT (apply returns rows for this table)...
            data: currentData,
            // ...while `index`/`datum` address the row the gesture actually touched,
            // which belongs to the mark's own table. Identical on every same-table
            // edit, which is all of them but the graph pair.
            datum: index != null ? sourceRows[index] : undefined,
            index,
            // The whole dataset, for an edit that has to look ACROSS tables (rewire
            // resolves a node id from the node rows while writing a link row). Named
            // by table, and read-only by convention like every other ctx member.
            tables: chart.tables,
            table: targetTable,
            pointer: { x: event.x, y: event.y },
            node: event.node || null,
            event: event.rawEvent,
            // A wheel gesture's travel, normalized to pixels by the renderer.
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            // A non-pixel gesture payload (the text mark's `commit` typed string).
            value: event.value,
            channels: resolved,
            scales: editScales,
            markChannels,
            // Chart projection context (null on cartesian charts). Geo edits invert
            // through the same object geo marks use for apply/path.
            projection: /** @type {import('../../types').ProjectionContext | null} */ (
                /** @type {any} */ (chart.scales).projection || null
            ),
            // Plot pixel dimensions, so a gesture whose geometry is the whole plane
            // (rotate about the centre) can measure against it without a mark node —
            // the angular sibling of resize reading the mark centre.
            width: chart.innerWidth,
            height: chart.innerHeight,
            // The chart margins (effective: author + legend bands), so a grow-mode
            // axis edit recovers the outer size from an inner axis length (inner +
            // margins). Harmless to other edits.
            margins: chart.effectiveMargins,
            // The engine-owned schema of the table this edit WRITES, so a mint
            // (create) populates every declared field with its default (or null) —
            // not just the positional ones — and an axis domain edit reads a field's
            // domain. Table-scoped, so a connect() mints a link row from the link
            // table's defaults rather than the node table's.
            schema: (schemaSpec.tables[targetTable] || schemaSpec.tables[schemaSpec.primary]).fields,
            // The same table's schema as DECLARED, before any domain edit (a zoom's
            // ceiling).
            seedSchema: (seedSchemaSpec.tables[targetTable] || seedSchemaSpec.tables[seedSchemaSpec.primary]).fields,
            // The whole canonical schema, for a cross-table edit that has to find
            // another table's key column (rewire reads the node table's key).
            schemaSpec,
            // Which rows of the table this edit writes are read-only (spec.lock), so
            // an edit that CHOOSES a row to extend (a draw continuing the last
            // series) can skip one the lock would revert anyway.
            locked: isLockedIn(targetTable),
            xKey: feature.xKey || 'x',
            yKey: feature.yKey || 'y',
            // The feature's series (grouping) field and its current scene nodes, so
            // proximity-aware edits (anchor / newSeries) and `when.near|far` can
            // resolve WHICH line a plane gesture means. Harmless to other edits.
            seriesKey: feature.seriesKey || null,
            marks: featureNodes[feature.id] || [],
            // The line's ordering knob and the engine's per-gesture driver session
            // (zone/handle locks, draw mode), for edits that read their driver's
            // lock (draw, brushSpan/brushRect, axis.scale). Harmless to the rest.
            connect: feature.connect || null,
            session: sessionOverride !== undefined
                ? sessionOverride
                : (ui.session && ui.session[feature.id]) || null,
            // The node table's box and port rules, for an edit that tests a drop
            // against a node's edges, and the channels of the mark drawing the
            // table this edit writes (when that is not its own mark's table).
            nodeBox: nodeBoxRule(),
            nodePorts: nodePortsRule,
            // Which node rows may HOLD others (a node mark's `contains` channel),
            // for an edit that drops one node into another.
            contains: containsRule,
            targetChannels: targetTable !== feature.table ? channelsDrawing(targetTable) : null,
            // The primary selected datum index (transient pipeline state), so an
            // edit's apply/when can target or arbitrate on the selection — e.g. a
            // `select` edit that reads whether the touched row is already selected.
            selection: selectionPrimary(),
            // The edit itself, so a `when` predicate can arbitrate against the
            // edit's own knobs (when.near reads its `threshold`). Descriptors are
            // data; self-reference adds no dispatch path.
            edit,
            preview,
        };
        return { ctx, targetTable, currentData, resolved, derivedOnly };
    };

    // Does this edit's `when` accept the gesture? Asked BEFORE a plane gesture is
    // handed to the drivers, so an edit whose modifier is not held is not merely
    // refused at commit time (computeEdit checks `when` too) but never consumes
    // the gesture at all — which is what lets a direct edit beside a `when`-gated
    // sweep receive the drag the sweep declined (see handleEvent's fallback).
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @returns {boolean}
     */
    const arbitrates = (feature, edit, event) =>
        !edit.when || !!edit.when(editContext(feature, edit, event, null).ctx);

    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @param {boolean} [preview]
     * @param {any} [sessionOverride]
     * @returns {import('../../types').EditResult | null}
     */
    const computeEdit = (feature, edit, event, index, preview = false, sessionOverride = undefined) => {
        const { ctx, targetTable, currentData, resolved, derivedOnly } = editContext(feature, edit, event, index, preview, sessionOverride);
        // Every column this edit writes is derived from the row's contents.
        if (derivedOnly) return null;
        const markChannels = ctx.markChannels;
        if (edit.when && !edit.when(ctx)) return null; // arbitration

        const result = edit.apply(ctx);
        if (result === undefined) return null;

        // Which datum the gesture touched, for invariants that resolve a violation
        // relative to it. Read from the edit's DECLARED cardinality (see makeEdit),
        // never from its type — a custom append/delete edit gets the same treatment
        // as the built-in create/remove without the engine knowing either exists.
        /** @param {any[]} rows @returns {number | null} */
        const activeIndexOf = (rows) => (edit.cardinality === 'append' ? rows.length - 1
            : edit.cardinality === 'delete' ? null
                : /** @type {number | null} */ (index));

        // Data-layer invariants: the dataset's first (they hold for every edit from
        // every mark), then any edit-scoped guard sugar. Pure data context — no
        // scales-as-geometry. A constraint may reject the proposal (false) or repair
        // it (return an array); the marks re-derive from the repaired rows.
        //
        // The lock (spec.lock) runs LAST so it has the final word: a repair by any
        // other invariant still can't write a read-only row.
        /**
         * @param {any[]} rows
         * @param {string} [forTable] the table these rows ARE. Defaults to the one
         *   the edit writes; a cross-table domain edit passes each other table it
         *   touches, so those rows meet their OWN table's invariants and lock.
         *   `edit.constrain` is edit-scoped sugar about the edit's own proposal, so
         *   it runs on the edit's table only — applying a rule written for node rows
         *   to the link rows a rename swept along would be a different rule.
         * @returns {any[] | null} the repaired rows, or null if rejected
         */
        const runInvariants = (rows, forTable = targetTable) => {
            const own = forTable === targetTable;
            const lockRows = lockRowsIn(forTable);
            const invariants = [
                ...constraintsIn(forTable), ...(own ? edit.constrain : []), ...(lockRows ? [lockRows] : []),
            ];
            const cctx = {
                activeIndex: own ? activeIndexOf(rows) : null, scales: chart.scales, markChannels,
                // The column the dispatching edit writes — what a constraint that
                // names no `field` of its own is about (see applyConstraint).
                field: own && resolved[0] ? resolved[0].field : undefined,
                // The rest of the dataset and which table these rows are, for an
                // invariant that spans tables. Pure data, like everything else a
                // constraint sees — still no pixels.
                tables: chart.tables, table: forTable,
                // The table's field schema, so a rule can honour a column's MEASURE
                // (snap keeps a temporal value a Date), and which of its rows are
                // read-only, so a rule that pushes neighbours (monotonic) pivots
                // around a locked row instead of writing it and being reverted.
                schema: (schemaSpec.tables[forTable] || schemaSpec.tables[schemaSpec.primary]).fields,
                locked: isLockedIn(forTable),
            };
            let out = rows;
            const before = own ? currentData : (chart.tables[forTable] || []);
            for (const constraint of invariants) {
                const r = applyConstraint(constraint, out, before, cctx);
                if (r === false) return null;
                if (r === true || r === undefined) continue;
                // A constraint may GATE (false) or REPAIR (the corrected rows). Anything
                // else is a bug in the constraint, and unvalidated it becomes the dataset:
                // a number or object makes `for (const d of dataset)` throw from inside
                // resolve.js with nothing naming the culprit, and a string iterates its
                // CHARACTERS and blanks the chart. Constraints built with defineConstraint
                // are normalized, so this only catches the hand-written form — which
                // spec.constraints accepts with no type checking at all.
                if (!Array.isArray(r)) {
                    warn(
                        `constraint:return:${constraintLabel(constraint)}`,
                        `constraint ${constraintLabel(constraint)} returned ${describe(r)}; a constraint must ` +
                        `return the repaired rows (an array), false to reject the edit, or ` +
                        `true/undefined to accept it unchanged. Ignoring the return value.`
                    );
                    continue;
                }
                out = r;
            }
            return out;
        };

        // A DOMAIN edit (edit.axis.*, edit.stack.cut on an open field) writes the
        // SCHEMA: apply returns { domains, data?, resize? }. The schema half bypasses
        // the datum-splice and the data-layer constraints — a domain is not a datum,
        // the same reason setData is trusted.
        //
        // Its COUPLED `data`, though, is an ordinary datum proposal (a category rename
        // relabels rows, a remove drops them, an open-domain cut splices one in), so it
        // meets the invariants like any other. Skipping them there let a constraint the
        // author declared — `count({ max })` capping how many categories may exist — be
        // silently ignored by exactly the edits that change how many there are.
        //
        // runEdit's domain-commit path handles the write; wrap it so runEdit/previewEdit
        // can tell it apart from a dataset proposal.
        if (edit.target === 'domain') {
            if (!(result && typeof result === 'object' && result.domains)) return null;
            /** @type {any} */
            const out = { ...result };
            if (Array.isArray(result.data)) {
                const checked = runInvariants(result.data);
                if (!checked) return null;
                out.data = checked;
            }
            // Rows the edit swept along in OTHER tables (a cross-table category
            // rename) are datum proposals too, and each meets ITS table's
            // invariants. One rejection rejects the whole edit: half a rename —
            // the schema written, one table's rows left on the old value — is
            // worse than none.
            if (result.tables) {
                /** @type {any} */
                const others = {};
                for (const [name, w] of Object.entries(/** @type {any} */ (result.tables))) {
                    const t = /** @type {any} */ (w);
                    if (!Array.isArray(t.data)) { others[name] = t; continue; }
                    const checked = runInvariants(t.data, name);
                    if (!checked) return null;
                    others[name] = { ...t, data: checked };
                }
                out.tables = others;
            }
            return { kind: 'domain', result: out };
        }

        // A SELECTION edit (edit.select) writes transient pipeline state, not the
        // dataset: apply returns a selection descriptor. Same shape as the domain
        // path — it bypasses the datum-splice, the data constraints, and undo — but
        // its destination is ui.selection. runEdit's selection-commit path handles it.
        if (edit.target === 'selection') {
            return (result && typeof result === 'object' && 'index' in result)
                ? { kind: 'selection', selection: result }
                : null;
        }

        // A whole-dataset edit (create appends, remove filters) returns an array; a
        // mark edit returns the new datum, spliced in at `index`.
        const newData = Array.isArray(result)
            ? result
            : currentData.map((d, i) => (i === index ? result : d));

        const rows = runInvariants(newData);
        if (!rows) return null;
        // Tree-ness is the SCHEMA's statement about a nesting table, so the engine
        // holds it for every edit that writes one, the way it holds a `ref`: a
        // proposal giving a node a second parent, or nesting it inside its own
        // descendant, is refused. Refused HERE, not repaired after the commit, so a
        // trial commit refuses it too and such a drop is never offered as a target.
        if (targetTable === schemaSpec.byRole.nesting
            && treeProblems(schemaSpec, { ...chart.tables, [targetTable]: rows }).length) return null;
        return { kind: 'rows', rows };
    };

    // Commit an edit: compute its proposal, write it to the belief store, drop any
    // preview it supersedes, and notify. Returns whether data changed.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const runEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index);
        if (!proposed) return false;
        // A domain edit reshapes the schema (and maybe the dataset / chart size).
        if (proposed.kind === 'domain') {
            return commitDomainEdit(proposed.result, targetTableOf(feature, edit));
        }
        // A selection edit writes ui.selection, not the belief data.
        if (proposed.kind === 'selection') {
            return commitSelectionEdit(proposed.selection, targetTableOf(feature, edit));
        }
        recordHistory();
        // A proposal replaces the table the EDIT targets, which is not always the
        // table its mark draws (see computeEdit). Getting this wrong would overwrite
        // the wrong table wholesale, so the target is resolved the one way, there.
        const nodesBefore = hierarchyNodes ? chart.tables[hierarchyNodes] : null;
        chart.tables[targetTableOf(feature, edit)] = proposed.rows;
        // Deleting a row can strand REFERENCES to it in another table, which no
        // single-table constraint can see or repair. The schema already declares the
        // rule (`type: 'ref'`), so the engine enforces it — see enforceRefs.
        enforceRefs(schemaSpec, chart.tables);
        // A hierarchy's geometry follows from its contents: a moved container takes
        // its subtree along, and every fitted container re-fits. Same standing as
        // enforceRefs — the schema's rule, repaired across rows after the commit.
        settleNodes(nodesBefore, heldStill(), { since: chart.strokeNodes || nodesBefore });
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Commit a DOMAIN edit's proposal: write each field's schema domain (creating a
    // schema entry, with an inferred measure type, for a field the caller left
    // undeclared), replace the dataset when the edit coupled a data change (category
    // remove/rename deletes/relabels rows), and resize the chart for grow-mode
    // numeric drag. Then notify. The next update() re-resolves scales from the new
    // schema, so axis/grid/guides/marks all reflow.
    /**
     * @param {import('../../types').DomainEditResult} result
     * @param {string} [table] the table the edit writes; its schema owns the domains,
     *   and its rows are what a coupled data change replaces.
     * @returns {boolean}
     */
    const commitDomainEdit = (result, table = schemaSpec.primary) => {
        recordHistory();
        // One scale can span several TABLES — `fill` over both `nodes.kind` and
        // `links.kind` — and renaming that category has to write every schema and
        // every row set, or the two halves of one vocabulary drift apart. The flat
        // `domains`/`data` are the edit's own table; `tables` carries the rest.
        // Normalized to one list so there is a single write path rather than a
        // special case bolted beside it.
        /** @type {Record<string, { domains?: any, data?: any }>} */
        const writes = { [table]: { domains: result.domains, data: result.data } };
        for (const [name, w] of Object.entries(result.tables || {})) {
            if (!schemaSpec.tables[name]) {
                warn(
                    `domain:table:${name}`,
                    `a domain edit names table "${name}", which the schema does not declare. ` +
                    `Declared tables: ${Object.keys(schemaSpec.tables).map((n) => `"${n}"`).join(', ')}.`
                );
                continue;
            }
            const prior = writes[name];
            writes[name] = prior
                ? { domains: { ...prior.domains, ...w.domains }, data: w.data ?? prior.data }
                : w;
        }

        let touchedRows = false;
        for (const [name, w] of Object.entries(writes)) {
            const fields = (schemaSpec.tables[name] || schemaSpec.tables[schemaSpec.primary]).fields;
            for (const [field, domain] of Object.entries(w.domains || {})) {
                const prev = fields[field];
                fields[field] = { ...(prev || { type: inferMeasureOfDomain(domain) }), domain };
            }
            if (Array.isArray(w.data)) { chart.tables[name] = w.data; touchedRows = true; }
        }
        // A category removal deletes rows, which can strand references to them.
        if (touchedRows) enforceRefs(schemaSpec, chart.tables);
        if (result.resize) applyResize(result.resize);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Preview an edit: compute the SAME proposal (same apply, same invariants) but
    // park it in the transient preview store instead of the belief store. The next
    // render draws it in place of the committed rows, so a hover shows exactly what
    // a click would commit — and `getData`/`onChange` never see it.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const previewEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index, true);
        // Only a dataset proposal can be previewed; a domain edit commits directly
        // (numeric drag commits each tick, categorical add/remove is one-shot).
        if (!proposed || proposed.kind !== 'rows') return false;
        const newData = proposed.rows;
        // Park the proposal under THIS feature's id, so a second probe mark's preview
        // can't overwrite it. update()'s ghost pass renders only the changed rows.
        //
        // It carries the TABLE it is about, because the ghost is drawn by whichever
        // marks view that table — which is not always the mark that proposed it. A
        // connect drag proposes a link row from a node mark, and it is the link mark
        // that has to draw the rubber band.
        // The POINTER rides along: a proposal may have a free end (a link being
        // drawn toward the pointer, with no target yet), and the mark that ghosts
        // it needs to know where that end is.
        if (!ui.preview) ui.preview = {};
        const pointer = typeof event.x === 'number' && typeof event.y === 'number'
            ? { x: event.x, y: event.y }
            : undefined;
        const table = targetTableOf(feature, edit);
        // A proposal about a hierarchy's NESTING has nothing of its own to draw: a
        // membership is not a shape. What it changes is the containers — the one
        // about to take the node grows to hold it, the one losing it draws in — so
        // the proposal parked is the NODE rows that nesting implies, settled exactly
        // as the commit would settle them (nothing held still: this is the picture
        // after the drop). The ghost pass then redraws the rows that differ. The
        // container that would receive the node rides along as `dropInto`, for the
        // `target` effect.
        if (hierarchyNodes && table === schemaSpec.byRole.nesting && boxHosts.length) {
            const overlay = { ...chart.tables, [table]: newData };
            const tree = treeOf(schemaSpec, overlay);
            ui.preview[feature.id] = {
                table: hierarchyNodes,
                rows: settledNodes(overlay, null, null, { anchors: index != null ? [index] : null, preview: true }),
                pointer,
                dropInto: index != null ? tree.parentOf(index) : null,
            };
            return true;
        }
        ui.preview[feature.id] = { table, rows: newData, pointer };
        return true;
    };

    // ── Could a drop land here? ────────────────────────────────────────────────
    // An edit whose drag ends ON something declares where (`Edit.targets`); each
    // place is tried as a COMMIT — apply, then every constraint — without committing.
    // What passes is what a release there would make, so the ports shown are exactly
    // the ones that work: a node at its constraint's limit shows none.
    /**
     * @param {any} feature
     * @param {import('../../types').Edit} edit
     * @param {number | null} index the row the drag started on
     * @param {any} node the node it started on
     * @param {any} [session] run against this session instead of the feature's
     * @returns {string[] | null} the keys a release could land on; null when the
     *   edit declares no targets
     */
    const reachableKeys = (feature, edit, index, node, session) => {
        if (typeof edit.targets !== 'function') return null;
        const table = targetTableOf(feature, edit);
        const probeCtx = /** @type {any} */ ({
            scales: chart.scales, schemaSpec, tables: chart.tables, table, data: chart.tables[table] || [],
            nodeBox: nodeBoxRule(), nodePorts: nodePortsRule, contains: containsRule,
            width: chart.innerWidth, height: chart.innerHeight,
            node: node || null, edit, pointer: { x: 0, y: 0 },
            // The row the drag started on, and the feature's own channel map: a
            // rewire needs both to know which node holds its OTHER end.
            index, datum: index != null ? tableOf(feature)[index] : undefined,
            markChannels: feature.channels || {},
        });
        /** @type {string[]} */
        const keys = [];
        const places = edit.targets(probeCtx);
        // No places to try (a chart with no ports): nothing to light, nothing ruled out.
        if (!places) return null;
        for (const t of places) {
            const trial = computeEdit(feature, edit, { x: t.x, y: t.y, node }, index, false, session);
            if (trial !== null) keys.push(t.key);
        }
        return keys;
    };

    // Can a link START from this port? Asked by the state pass for lit ports only,
    // and cached until the data changes (any table array is replaced on a commit).
    /** @type {Map<string, boolean>} */
    const availCache = new Map();
    /** @type {any[]} */
    let availSig = [];
    /** @param {any} feature @param {any} node @returns {boolean} */
    const portAvailable = (feature, node) => {
        const sig = Object.keys(chart.tables).map((k) => chart.tables[k]);
        if (sig.length !== availSig.length || sig.some((t, i) => t !== availSig[i])) {
            availCache.clear();
            availSig = sig;
        }
        const key = `${feature.id}\u0000${node.index}\u0000${node.side}`;
        const hit = availCache.get(key);
        if (hit !== undefined) return hit;
        let ok = false;
        const session = {
            ...((ui.session && ui.session[feature.id]) || {}),
            fromIndex: node.index,
            fromSide: node.side,
            fromPoint: null,
        };
        for (const edit of activeEdits(feature)) {
            const keys = reachableKeys(feature, edit, node.index, node, session);
            if (keys && keys.length) { ok = true; break; }
        }
        availCache.set(key, ok);
        return ok;
    };

    return {
        frameScalesFor, editContext, arbitrates, computeEdit, runEdit,
        commitDomainEdit, previewEdit, reachableKeys, portAvailable,
    };
}
