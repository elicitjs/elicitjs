// @ts-check
import { collectEdits, resolveChannels } from '../../edit/route.js';
import { markCenter } from '../../edit/shared.js';
import { encodeChannel } from '../../plot/mark.js';
import { validateTables, denormalizeSchema, normalizeData, enforceRefs } from '../schema.js';
import { axisOf, pointerForChannel } from '../encoding.js';
import { nestingOf, enforceTree } from '../hierarchy.js';
import { warn } from '../dev.js';

/**
 * @typedef {object} ApiDeps
 * @property {any[]} features
 * @property {any} ui
 * @property {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} listeners
 * @property {Record<string, any[]>} featureNodes
 * @property {Record<string, import('../../types').FieldSchema>} schema
 * @property {import('../../types').SchemaSpec} schemaSpec
 * @property {import('../../types').SchemaSpec} seedSchemaSpec
 * @property {'fixed' | 'scale' | 'reflow'} mode
 * @property {HTMLElement} container
 * @property {ReturnType<typeof import('./history.js').createHistory>} history
 * @property {ReturnType<typeof import('./selection.js').createSelection>} selection
 * @property {ReturnType<typeof import('./stages.js').createStages>} stages
 * @property {(feature: any) => any[]} tableOf
 * @property {() => any} shapeData
 * @property {(name: string, d: any) => boolean} isContextRow
 * @property {(name: string, i: number) => number} rowIndexOf
 * @property {() => void} recountSeed
 * @property {(feature: any, node: any, index?: number | null) => import('../../types').ScaleMap | null} frameScalesFor
 * @property {(result: import('../../types').DomainEditResult, table?: string) => boolean} commitDomainEdit
 * @property {(edit: import('../../types').Edit) => boolean} rowTargeted
 * @property {() => void} endTxn
 * @property {() => boolean} measure
 * @property {(event: any) => void} handleEvent
 * @property {() => void} update
 */

/**
 * The caller-facing API, attached to the container the engine returns: the data
 * (getData / setData / getSchema / setDomain), the selection, external control
 * (emit / control), undo, stages, change listeners, and teardown. Pure observation
 * over the belief store plus external INPUT SOURCES — it adds no interaction path
 * (edits and constraints stay the only way a gesture mutates data).
 *
 * @param {import('../../types').ElicitElement} el
 * @param {import('./state.js').ChartState} chart
 * @param {ApiDeps} deps
 */
export function attachApi(el, chart, deps) {
    const {
        features, ui, listeners, featureNodes, schema, schemaSpec, seedSchemaSpec, mode, container, history, selection, stages, tableOf, shapeData, isContextRow, rowIndexOf, recountSeed, frameScalesFor, commitDomainEdit, rowTargeted, endTxn, measure,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);
    const update = () => deps.update();

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
}
