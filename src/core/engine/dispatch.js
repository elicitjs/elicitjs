// @ts-check
import { encodeChannel } from '../../plot/mark.js';
import { markCenter, nudgeTarget } from '../../edit/shared.js';
import { hitTest } from '../../edit/pick.js';
import { drivers, driverFor } from '../../edit/drivers/index.js';
import { elementEffectOf } from '../effects.js';

/**
 * Event routing: where a renderer's event reaches the edits.
 *
 * An event with a `node` goes to that mark's direct-pick edits; one without goes
 * to every feature's plane edits through the driver registry. Hover, pointer and
 * grab are recorded on `ui` for the state pass. Undo is bracketed per gesture.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   features: any[],
 *   featureById: Map<string, any>,
 *   ui: any,
 *   effects: any,
 *   tracksPointer: boolean,
 *   featureNodes: Record<string, any[]>,
 *   hierarchyNodes: string | null,
 *   boxHosts: any[],
 *   history: { gestureTxn: (type: string) => void, endTxn: () => void, recordHistory: () => void },
 *   tableOf: (feature: any) => any[],
 *   activeEdits: (feature: any) => import('../../types').Edit[],
 *   getStage: () => number,
 *   applyStage: (n: number) => void,
 *   arbitrates: (feature: any, edit: import('../../types').Edit, event: any) => boolean,
 *   frameScalesFor: (feature: any, node: any, index?: number | null) => import('../../types').ScaleMap | null,
 *   runEdit: (feature: any, edit: import('../../types').Edit, event: any, index: number | null) => boolean,
 *   previewEdit: (feature: any, edit: import('../../types').Edit, event: any, index: number | null) => boolean,
 *   reachableKeys: (feature: any, edit: import('../../types').Edit, index: number | null, node: any, session?: any) => string[] | null,
 *   settledNodes: (from: Record<string, any[]>, before: any[] | null, frozen: Set<number> | null, dodge?: any) => any[],
 *   heldStill: () => Set<number> | null,
 *   notifyChange: () => void,
 *   handleKey: (node: any) => string,
 *   visibleAt: (nodes: any[], x: number, y: number) => any[],
 *   update: () => void,
 * }} deps
 */
export function createDispatch(chart, deps) {
    const {
        features, featureById, ui, effects, tracksPointer, featureNodes, hierarchyNodes, boxHosts,
        tableOf, activeEdits, getStage, applyStage, arbitrates, frameScalesFor,
        runEdit, previewEdit, reachableKeys, settledNodes, heldStill, notifyChange,
        handleKey, visibleAt,
    } = deps;
    const { history } = deps;
    const { endTxn, recordHistory } = history;
    const update = () => deps.update();

    // Can an edit run on a row the caller already names? A direct edit always can;
    // a plane edit can when its driver's only job is choosing the row.
    /** @param {import('../../types').Edit} edit @returns {boolean} */
    const rowTargeted = (edit) => {
        if (edit.pick === 'direct') return true;
        const d = /** @type {any} */ (driverFor(edit));
        return !!(d && d.targetsRow);
    };

    // Run every direct edit on the touched mark whose `gesture` matches.
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchDirectEdits = (feature, event) => {
        const index = event.node && event.node.index != null ? event.node.index : null;
        let changed = false;
        // An external event may name one edit (`event.editName`); then only that one runs.
        const direct = activeEdits(feature).filter(e => e.pick === 'direct'
            && (!event.editName || e.name === event.editName));

        // Direct edits with a driver (e.g. relative `slide`) run their lifecycle on
        // the touched row. They run even without a row (an axis end-handle).
        const lifecycle = direct.filter(e => driverFor(e));
        if (lifecycle.length && runDrivers(feature, event, lifecycle, index)) changed = true;

        if (index == null) return changed;
        // `el.control(name, index)` also runs a named plane edit whose driver only
        // chooses a row (`targetsRow`) directly on this row.
        const addressed = event.editName
            ? activeEdits(feature).filter(e => e.pick !== 'direct' && e.name === event.editName && rowTargeted(e))
            : [];
        [...direct.filter(e => !driverFor(e)), ...addressed]
            .filter(e => e.gesture === event.type)
            .forEach(edit => { if (runEdit(feature, edit, event, index)) changed = true; });
        return changed;
    };

    // Hand edits to their drivers with a per-feature session. A plane gesture
    // passes `index` null (the driver finds its target); a direct one names the row.
    /**
     * @param {any} feature
     * @param {any} event
     * @param {import('../../types').Edit[]} edits
     * @param {number | null} index the datum a direct gesture landed on, else null
     * @returns {boolean}
     */
    const runDrivers = (feature, event, edits, index) => {
        if (edits.length === 0) return false;
        const fid = feature.id;

        /** @param {import('../../types').Edit} edit @param {number | null} index @param {{ x: number, y: number }} [at] a pointer to run at instead of the event's */
        const runFeatureEdit = (edit, index, at) =>
            runEdit(feature, edit, at ? { ...event, x: at.x, y: at.y } : event, index);
        /** @param {import('../../types').Edit} edit @param {number | null} index */
        const previewFeatureEdit = (edit, index) => previewEdit(feature, edit, event, index);

        // The feature's uncommitted proposal and the stage cursor, handed to drivers.
        const preview = {
            get: () => (ui.preview && ui.preview[fid]) || null,
            clear: () => {
                if (!ui.preview || !ui.preview[fid]) return false;
                delete ui.preview[fid];
                if (Object.keys(ui.preview).length === 0) ui.preview = null;
                return true;
            }
        };
        const stage = {
            get: () => getStage(),
            /** @param {number} n */
            set: (n) => applyStage(n),
            next: () => applyStage(getStage() + 1)
        };

        // Each edit goes to exactly one driver. Drivers run in registry order, which
        // is load-bearing: connect's dragend must run after move's.
        /** @type {Map<any, import('../../types').Edit[]>} */
        const groups = new Map();
        for (const e of edits) {
            const d = driverFor(e);
            if (!d) continue;
            const list = groups.get(d) || [];
            list.push(e);
            groups.set(d, list);
        }

        let changed = false;
        for (const driver of drivers) {
            const matching = groups.get(driver);
            if (!matching) continue;
            // The session is shared by every driver on the mark, so `clear` nulls
            // only this driver's `sessionKeys`.
            const own = driver.sessionKeys || [];
            const session = {
                get: () => (ui.session && ui.session[fid]) || null,
                /** @param {any} patch */
                set: (patch) => {
                    ui.session = ui.session || {};
                    ui.session[fid] = { ...(ui.session[fid] || {}), ...patch };
                },
                clear: () => {
                    if (!ui.session || !ui.session[fid]) return;
                    /** @type {Record<string, null>} */
                    const nulls = {};
                    for (const k of own) nulls[k] = null;
                    ui.session[fid] = { ...ui.session[fid], ...nulls };
                }
            };
            const dctx = {
                feature, event, edits: matching,
                marks: featureNodes[fid] || [],
                data: tableOf(feature),
                // Read-only global scales, for a driver that encodes a channel (brush).
                scales: chart.scales,
                index: index != null ? index : null,
                session,
                preview,
                stage,
                runEdit: runFeatureEdit,
                previewEdit: previewFeatureEdit,
                /** @param {import('../../types').Edit} edit @param {number | null} at @param {any} [node] */
                reachable: (edit, at, node) => reachableKeys(feature, edit, at, node !== undefined ? node : event.node),
            };
            if (driver.onEvent(dctx)) changed = true;
        }
        return changed;
    };

    // Plane-pick edits: the event carries no node and the driver finds its target.
    /**
     * @param {any} feature
     * @param {any} event
     * @param {import('../../types').Edit[]} [live] the arbitrated plane edits (else resolved here)
     * @returns {boolean}
     */
    const dispatchPlaneEdits = (feature, event, live) =>
        runDrivers(feature, event, live !== undefined ? live : livePlaneEdits(feature, event), null);

    // The plane edits whose `when` accepts this gesture. A stroke latches the set at
    // dragstart, so a modifier released mid-drag can't strand a driver without its dragend.
    /** @type {Record<string, import('../../types').Edit[]>} */
    let strokeLive = {};
    // The plane edits that accepted each feature's last hover.
    /** @type {Record<string, import('../../types').Edit[]>} */
    let hoverLive = {};
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {import('../../types').Edit[]}
     */
    const livePlaneEdits = (feature, event) => {
        const plane = activeEdits(feature).filter(e => e.pick !== 'direct');
        if (!plane.length) return plane;
        if (event.type === 'drag' || event.type === 'dragend') return strokeLive[feature.id] || [];
        // A hoverout reaches every plane edit, accepted or not, so no hover ring stays lit.
        if (event.type === 'hoverout') return plane;
        const live = plane.filter(e => arbitrates(feature, e, event));
        if (event.type === 'dragstart') strokeLive[feature.id] = live;
        return live;
    };

    // When no plane edit accepts a plane gesture, hit-test the mark under the
    // pointer and re-route the event as a direct one. A stroke latches that node.
    /** @type {any} */
    let planeGrab = null;
    // Is the current stroke a direct grab the plane gesture was re-routed to?
    let directStroke = false;
    /** @param {number} x @param {number} y @returns {any | null} */
    const hitAny = (x, y) => {
        for (let i = features.length - 1; i >= 0; i--) {
            const hit = hitTest(visibleAt(featureNodes[features[i].id] || [], x, y), x, y);
            if (hit) return hit;
        }
        return null;
    };
    // The mark under the pointer, when one of its direct edits accepts the gesture as `type`.
    /** @param {any} event @param {string} [type] @returns {any | null} */
    const grabbableAt = (event, type = event.type) => {
        const hit = hitAny(event.x, event.y);
        const owner = hit ? featureById.get(hit.featureId) : null;
        const accepts = owner && activeEdits(owner).some((e) => e.pick === 'direct'
            && arbitrates(owner, e, { ...event, type, node: hit }));
        return accepts ? hit : null;
    };
    /** @param {any} event @returns {any | null} */
    const fallbackHit = (event) => {
        if (event.type === 'dragstart') { planeGrab = hitAny(event.x, event.y); return planeGrab; }
        if (event.type === 'drag') return planeGrab;
        if (event.type === 'dragend') { const g = planeGrab; planeGrab = null; return g; }
        if (event.type === 'click' || event.type === 'dblclick') return hitAny(event.x, event.y);
        return null;
    };

    // Route one renderer event.
    /**
     * @param {any} event
     */
    const handleEvent = (event) => {
        let shouldRender = false;

        // Pointer position, for guides that follow it. State only, never dispatched.
        if (event.type === 'pointermove' || event.type === 'pointerleave') {
            const next = event.type === 'pointermove' ? { x: event.x, y: event.y } : null;
            const same = (!next && !ui.pointer) || !!(next && ui.pointer && next.x === ui.pointer.x && next.y === ui.pointer.y);
            ui.pointer = next;
            if (tracksPointer && !same) update();
            return;
        }

        // Hover over a mark: state for the `hovered` effect, never an edit.
        if (event.type === 'pointerover' || event.type === 'pointerout') {
            const node = event.node;
            // Keep the node, so a row with several handles lights the one hovered.
            const next = event.type === 'pointerover' && node && node.index != null
                ? { featureId: node.featureId, index: node.index, node }
                : null;
            /** @param {any} a @param {any} b */
            const same = (a, b) => (!a && !b)
                || !!(a && b && a.featureId === b.featureId && a.index === b.index
                    && handleKey(a.node) === handleKey(b.node));
            // Ignore a stale pointerout from a node other than the hovered one: the
            // browser can report entering a new handle before leaving the old node.
            const stale = event.type === 'pointerout' && ui.hover && node
                && !same(ui.hover, { featureId: node.featureId, index: node.index, node });
            if (!stale && !same(ui.hover, next)) {
                ui.hover = next;
                const h = effects.hovered;
                if (h && h.enabled !== false && (h.outline || elementEffectOf(h))) shouldRender = true;
                // A port shows on hover whatever the `hovered` effect says.
                if (chart.sceneHasOnHover) shouldRender = true;
            }
            if (shouldRender) update();
            return;
        }

        // A keyboard nudge becomes an ordinary `drag` to the pixel one step away.
        if (event.type === 'nudge') {
            // Step from the datum's encoded value, not the node centre (a bar's
            // centre is halfway up). The centre is the fallback.
            const node = event.node;
            const from = markCenter(node);
            if (!from) return;
            const feature = featureById.get(node.featureId);
            const channels = (feature && feature.channels) || {};
            const datum = node.index != null ? (feature ? tableOf(feature) : [])[node.index] : node.data;
            // Inside a composite frame, use the node's frame scales.
            const ks = frameScalesFor(feature, node, node.index) || chart.scales;
            const atX = datum ? encodeChannel(ks, channels, 'x', datum, from.cx) : from.cx;
            const atY = datum ? encodeChannel(ks, channels, 'y', datum, from.cy) : from.cy;
            event = {
                type: 'drag',
                node,
                x: nudgeTarget(ks.x, atX, event.dx, event.coarse),
                y: nudgeTarget(ks.y, atY, event.dy, event.coarse),
                // A nudge is a whole gesture; it closes its own undo transaction below.
                nudge: true,
                rawEvent: event.rawEvent,
            };
        }

        // Re-route plane gestures to a mark before the grab state and transaction,
        // so the result looks like an event the renderer reported on the node.
        /** @type {Map<string, import('../../types').Edit[]> | null} */
        let planeLive = null;
        // A press on a mark whose direct edit accepts it grabs that mark first.
        if (!event.node && event.x != null && (event.type === 'dragstart' || event.type === 'click' || event.type === 'dblclick')) {
            // A new stroke drops whatever a lost dragend left latched.
            if (event.type === 'dragstart') { planeGrab = null; directStroke = false; }
            const hit = grabbableAt(event);
            if (hit) {
                if (event.type === 'dragstart') { planeGrab = hit; directStroke = true; }
                event = { ...event, node: hit };
            }
        } else if (!event.node && directStroke && (event.type === 'drag' || event.type === 'dragend')) {
            const hit = planeGrab;
            if (event.type === 'dragend') { planeGrab = null; directStroke = false; }
            if (hit) event = { ...event, node: hit };
        }
        // Over a mark a press would grab, the mark is hovered and the plane edits
        // get a hoverout instead.
        if (!event.node && event.type === 'hover' && event.x != null && chart.planeRaised) {
            const hit = grabbableAt(event, 'dragstart');
            if (hit) {
                if (!ui.hover || ui.hover.node !== hit) handleEvent({ type: 'pointerover', node: hit });
                event = { ...event, type: 'hoverout' };
            } else if (ui.hover) {
                handleEvent({ type: 'pointerout', node: ui.hover.node });
            }
        }
        if (!event.node && event.x != null) {
            planeLive = new Map(features.map(f => [f.id, livePlaneEdits(f, event)]));
            let any = false;
            for (const l of planeLive.values()) if (l.length) { any = true; break; }
            if (!any) {
                if (event.type === 'hover' || event.type === 'hoverout') {
                    // No plane edit listens: hover the mark under the pointer instead.
                    const hit = event.type === 'hover' ? hitAny(event.x, event.y) : null;
                    if (hit) { if (!ui.hover || ui.hover.node !== hit) handleEvent({ type: 'pointerover', node: hit }); }
                    else if (ui.hover) handleEvent({ type: 'pointerout', node: ui.hover.node });
                } else {
                    const hit = fallbackHit(event);
                    if (hit) event = { ...event, node: hit };
                }
            }
        }

        // Open or continue this gesture's undo transaction (see engine/history.js).
        history.gestureTxn(event.type);

        // A hierarchy's rows are pushed apart at the END of a stroke, around what it
        // moved (see `stroking`). A nudge's synthetic drag is a whole gesture.
        if (hierarchyNodes && !event.nudge) {
            if (event.type === 'dragstart') { chart.stroking = true; chart.strokeNodes = chart.tables[hierarchyNodes]; }
            else if (event.type === 'drag') chart.stroking = true;
        }

        // Grab state: one grabbed row per stroke, for the `grabbed` effect. Render
        // on change even if no data moved, so a press lights the mark.
        if (event.type === 'dragstart' || event.type === 'dragend') {
            const next = event.type === 'dragstart' && event.node && event.node.index != null
                ? { featureId: event.node.featureId, index: event.node.index }
                : null;
            const changed = !!ui.grab !== !!next
                || !!(ui.grab && next && (ui.grab.featureId !== next.featureId || ui.grab.index !== next.index));
            ui.grab = next;
            const g = effects.grabbed;
            if (changed && g && g.enabled !== false && (g.outline || elementEffectOf(g))) shouldRender = true;
        }

        if (event.node) {
            // Dispatch to the touched mark's feature (direct pick).
            const feature = featureById.get(event.node.featureId);
            if (feature && dispatchDirectEdits(feature, event)) shouldRender = true;
        } else {
            // Plane gestures -> every feature's plane/nearest/sweep/draw edits.
            features.forEach(feature => {
                const live = planeLive ? planeLive.get(feature.id) : undefined;
                // An edit that accepted the last hover but declines this one gets a
                // hoverout first, so it drops its hover ring.
                if (event.type === 'hover') {
                    const accepted = live !== undefined ? live : livePlaneEdits(feature, event);
                    const declined = (hoverLive[feature.id] || []).filter(e => !accepted.includes(e));
                    hoverLive[feature.id] = accepted;
                    if (declined.length && runDrivers(feature, { ...event, type: 'hoverout' }, declined, null)) shouldRender = true;
                } else if (event.type === 'hoverout') {
                    delete hoverLive[feature.id];
                }
                if (dispatchPlaneEdits(feature, event, live)) shouldRender = true;
            });
            if (event.type === 'dragend') strokeLive = {};
        }

        // On release, settle the hierarchy held still during the stroke, inside the
        // same undo entry.
        if (event.type === 'dragend' && hierarchyNodes && boxHosts.length) {
            chart.stroking = false;
            const settled = settledNodes(chart.tables, null, heldStill(), { since: chart.strokeNodes });
            chart.strokeNodes = null;
            if (settled !== chart.tables[hierarchyNodes]) {
                recordHistory();
                chart.tables[hierarchyNodes] = settled;
                notifyChange();
                shouldRender = true;
            }
        }

        // Close the transaction unless a stroke or wheel burst is still going. A nudge closes its own.
        if (event.type === 'dragend' || event.nudge
            || (event.type !== 'dragstart' && event.type !== 'drag' && event.type !== 'wheel')) endTxn();

        if (shouldRender) {
            update();
        }
    };

    return { handleEvent, rowTargeted };
}
