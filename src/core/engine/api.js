// @ts-check
import { collectEdits, resolveChannels } from '../../edit/route.js';
import { markCenter } from '../../edit/shared.js';
import { encodeChannel } from '../../plot/mark.js';
import { validateTables, denormalizeSchema, normalizeData, enforceRefs, fieldsOf } from '../schema.js';
import { axisOf, pointerForChannel } from '../encoding.js';
import { nestingOf, enforceTree } from '../hierarchy.js';
import { warn } from '../dev.js';

/**
 * @typedef {object} ApiDeps
 * @property {any[]} features
 * @property {any} ui
 * @property {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} listeners
 * @property {Record<string, any[]>} featureNodes
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
 * Attaches the public `el.*` API: data, schema, domains, selection, external
 * control, undo, stages, listeners and teardown.
 *
 * @param {import('../../types').ElicitElement} el
 * @param {import('./state.js').ChartState} chart
 * @param {ApiDeps} deps
 */
export function attachApi(el, chart, deps) {
    const {
        features, ui, listeners, featureNodes, schemaSpec, seedSchemaSpec, mode, container, history, selection, stages, tableOf, shapeData, isContextRow, rowIndexOf, recountSeed, frameScalesFor, commitDomainEdit, rowTargeted, endTxn, measure,
    } = deps;
    const handleEvent = (/** @type {any} */ event) => deps.handleEvent(event);
    const update = () => deps.update();

    // A deep copy; structuredClone keeps Date values.
    el.getData = () => structuredClone(shapeData());
    // A deep copy of the live schema, in the spelling the author gave.
    el.getSchema = () => structuredClone(denormalizeSchema(schemaSpec));
    // Replaces the dataset and re-seeds. Skips constraints (they gate gestures);
    // under `lock: 'seed'` the new rows become the read-only seed.
    el.setData = (/** @type {any[] | Record<string, any[]>} */ data) => {
        // A bare array is the primary table; an object names its tables.
        const next = normalizeData(structuredClone(data ?? null), schemaSpec);
        // Keep the context rows (same objects, so membership survives) ahead of
        // the new rows.
        for (const name of Object.keys(chart.contextRows)) {
            const keep = (chart.tables[name] || []).filter((d) => isContextRow(name, d));
            if (keep.length) next[name] = [...keep, ...(next[name] || [])];
        }
        chart.tables = next;
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, chart.tables, 'setData()');
        // A hierarchy gets the same ref and tree repairs a commit gets.
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
        // A reseed is a new starting point, so undo history is cleared.
        history.reset();
        update();
    };

    // Sets a field's domain through the same commit as a domain edit (undoable).
    // `null` restores the declared domain.
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

    // Selection API (see engine/selection.js).
    el.getSelection = selection.api.getSelection;
    el.getSelectionAll = selection.api.getSelectionAll;
    el.select = selection.api.select;
    el.toggleSelection = selection.api.toggleSelection;
    el.selectAll = selection.api.selectAll;
    el.selectWhere = selection.api.selectWhere;
    el.clearSelection = selection.api.clearSelection;

    // External control synthesizes renderer-shaped events and feeds them to the
    // one `handleEvent`, so constraints, undo and listeners all run as usual.

    // Injects a renderer-shaped event: { type, node?, x?, y?, value?, nudge?, rawEvent? },
    // with `x`/`y` in inner (margin-subtracted) pixels.
    el.emit = (/** @type {any} */ event) => handleEvent(event);

    // Finds the (feature, edit) with this `name`. Scanned each call to track stages.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any } | null} */
        let hit = null;
        // Count distinct edits by `apply`, which survives collectEdits' copy. One
        // edit on several glyph parts (a face's two eyes) is not a collision.
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

    // The current scene node for a datum (not cached; nodes rebuild each update).
    const nodeAt = (/** @type {any} */ feature, /** @type {number} */ index) =>
        (featureNodes[feature.id] || []).find((/** @type {any} */ n) => n && n.index === index) || null;

    // A handle bound to a named edit and datum. It routes by the edit's `gesture`;
    // the engine dispatch never knows a controller exists.
    el.control = (/** @type {string} */ name, /** @type {number} */ index = 0) => {
        // `index` is row i of getData(); translate it to the mark's table.
        const rowOf = (/** @type {any} */ feature) => rowIndexOf(feature ? feature.table : schemaSpec.primary, index);
        // Encodes a value to the pointer that would set it, through the scales the
        // edit inverts. Untouched axes keep the datum's current pixel.
        const dragPointer = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {any} */ value) => {
            const node = nodeAt(feature, rowOf(feature));
            const center = markCenter(node);
            const datum = tableOf(feature)[rowOf(feature)];
            const channels = feature.channels || {};
            const editScales = frameScalesFor(feature, node, rowOf(feature)) || chart.scales;
            let x = datum ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
            const resolved = resolveChannels(edit.channels, channels, editScales, feature);
            // `value` is a scalar, or a { channel | field: v } map for a multi-channel edit.
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
                // A positional channel sets its own coordinate; a pivot channel
                // (radius, bearing) sets both.
                const a = axisOf(ch.name);
                if (a !== 'y') x = p.x;
                if (a !== 'x') y = p.y;
            }
            return { node, x, y };
        };

        // True between begin() and end(), so `.set` emits a plain `drag` into the
        // open txn instead of a self-closing `nudge`.
        let live = false;

        // Warns when the edit needs a pointer, not a row, to drive it.
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
            // Writes a value. A commit-gesture edit gets it as `ctx.value`; a drag edit
            // gets it encoded to a pointer.
            set(/** @type {any} */ value) {
                const found = findNamedEdit(name);
                if (!drivable(found, 'set')) return;
                const { feature, edit } = found;
                const node = nodeAt(feature, rowOf(feature));
                // editName keeps a sibling edit on the same gesture from also firing.
                if (edit.gesture === 'commit') {
                    el.emit({ type: 'commit', node, value, editName: name, x: node ? node.cx : 0, y: node ? node.cy : 0 });
                    return;
                }
                const { node: n, x, y } = dragPointer(feature, edit, value);
                el.emit(live
                    ? { type: 'drag', node: n, x, y, editName: name }
                    : { type: 'drag', node: n, x, y, nudge: true, editName: name });
            },
            // begin()/end() bracket one txn, so many .set() ticks are one undo entry.
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
            // Fires a value-less edit (cycle, remove, toggle) with its own gesture on
            // the datum's node, or with `gesture` if given.
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
            // The values this channel accepts, read off its scale, for external UI.
            accepts() {
                const found = findNamedEdit(name);
                if (!found) return null;
                const { feature, edit } = found;
                const editScales = frameScalesFor(feature, null, rowOf(feature)) || chart.scales;
                const ch = resolveChannels(edit.channels, feature.channels || {}, editScales, feature)[0];
                const scale = /** @type {any} */ (ch && ch.scale);
                const fieldSpec = (ch && ch.field && fieldsOf(schemaSpec, feature.table)[ch.field]) || null;
                const measure = (fieldSpec && fieldSpec.type) || null;
                // The scale's domain, else the schema's declared domain.
                const domain = (scale && typeof scale.domain === 'function' ? scale.domain() : null)
                    || (fieldSpec && fieldSpec.domain) || null;
                const range = scale && typeof scale.range === 'function' ? scale.range() : null;
                return {
                    field: ch ? ch.field : null,
                    type: measure,                         // MeasureType (quantitative/categorical/…)
                    kind: scale ? scale.kind : null,       // band | point | continuous | discrete
                    temporal: !!(scale && scale.temporal),
                    invertible: !!(scale && scale.invertible),
                    // The value set (discrete) or [min, max] (continuous).
                    domain,
                    values: (
                        (scale && (scale.kind === 'band' || scale.kind === 'point' || (scale.kind === 'discrete' && !scale.ramp)))
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

    // 'reflow' mode: re-render on container resize, once per frame, and only when
    // the size changed (so a render can't loop).
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
    // Disconnects the reflow observer.
    el.destroy = () => {
        if (ro) { ro.disconnect(); ro = null; }
    };
}
