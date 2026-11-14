// @ts-check
import { encodeChannel } from '../../plot/mark.js';
import { markCenter, nudgeTarget } from '../../edit/shared.js';
import { hitTest } from '../../edit/pick.js';
import { drivers, driverFor } from '../../edit/drivers/index.js';
import { elementEffectOf } from '../effects.js';

/**
 * Event routing: the ONE place a renderer's event reaches the edits.
 *
 * Events carrying a `node` are mark-scoped and route to that mark's direct-pick
 * edits; events without one are plane-scoped and route to every feature's plane
 * edits through the driver registry. A multi-event lifecycle is a DRIVER
 * (edit/drivers), never a branch here — this file asks `driverFor` and never names
 * a pick mode. Hover, pointer and grab are interaction STATE recorded on `ui` for
 * the render's state pass; undo transactions are bracketed per gesture.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   features: any[],
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
        features, ui, effects, tracksPointer, featureNodes, hierarchyNodes, boxHosts,
        tableOf, activeEdits, getStage, applyStage, arbitrates, frameScalesFor,
        runEdit, previewEdit, reachableKeys, settledNodes, heldStill, notifyChange,
        handleKey, visibleAt,
    } = deps;
    const { endTxn, recordHistory } = deps.history;
    const history = deps.history;
    const update = () => deps.update();

    // Can an edit run on a row the caller already names? A direct edit always can;
    // a plane edit can when its driver's only job is choosing the row.
    /** @param {import('../../types').Edit} edit @returns {boolean} */
    const rowTargeted = (edit) => {
        if (edit.pick === 'direct') return true;
        const d = /** @type {any} */ (driverFor(edit));
        return !!(d && d.targetsRow);
    };

    // Direct-pick edits: the gesture landed on a mark (event.node). Fan the
    // gesture out to every direct edit whose `gesture` matches; `when` arbitrates
    // between edits sharing a gesture (plain-drag move vs Shift-drag resize).
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchDirectEdits = (feature, event) => {
        const index = event.node && event.node.index != null ? event.node.index : null;
        let changed = false;
        // A gesture normally fans to EVERY direct edit sharing its type (arbitrated
        // by each edit's `when`). An externally-driven event may ADDRESS one edit by
        // name (event.editName), so a feature carrying several same-gesture edits —
        // three `set()`s on a face's params — drives exactly the one asked for
        // instead of all of them. Native pointer events set no editName, so their
        // fan-out is unchanged.
        const direct = activeEdits(feature).filter(e => e.pick === 'direct'
            && (!event.editName || e.name === event.editName));

        // A direct edit may still need a multi-event LIFECYCLE — a relative `slide`
        // has to remember the pixel and value it started from, or the value would
        // jump to wherever the mark was pressed. Its driver owns that state exactly
        // as it does for a plane edit; the only difference is that the target is the
        // node under the pointer, so nothing is searched for and the plane stays
        // down. This is the driver registry doing its job, not a pick branch: the
        // engine asks `driverFor` and never names a mode.
        // A node that carries NO row (an axis end-handle) can still start a
        // lifecycle: its driver resolves what was grabbed from the pointer. Only a
        // plain direct edit needs the datum, so only those are skipped without one.
        const lifecycle = direct.filter(e => driverFor(e));
        if (lifecycle.length && runDrivers(feature, event, lifecycle, index)) changed = true;

        if (index == null) return changed;
        // An event that ADDRESSES an edit by name (`el.control(name, index)`) also
        // names the row it acts on. For a plane edit whose driver only chooses a
        // row (`targetsRow` — a nearest or sweep pick), that choice is already made,
        // so the edit runs on this row like a direct one. Other plane edits need
        // their driver's lifecycle, and `control()` reports them instead.
        const addressed = event.editName
            ? activeEdits(feature).filter(e => e.pick !== 'direct' && e.name === event.editName && rowTargeted(e))
            : [];
        [...direct.filter(e => !driverFor(e)), ...addressed]
            .filter(e => e.gesture === event.type)
            .forEach(edit => { if (runEdit(feature, edit, event, index)) changed = true; });
        return changed;
    };

    // Hand a set of edits to the interaction drivers. Each driver (edit/drivers)
    // owns one multi-event lifecycle; we give every driver the edits it `wants`
    // plus a per-feature session, and it runs them. The engine knows no specific
    // mode — adding one means adding a driver file.
    //
    // Both dispatch paths come through here. A PLANE gesture carries no node, so
    // `index` is null and the driver resolves its own target from the pointer. A
    // DIRECT gesture landed on a node, so `index` names the datum and the driver
    // skips target selection entirely — same lifecycle, no raised plane.
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

        // The feature's uncommitted proposal, and the chart's stage cursor. Handed to
        // drivers as capabilities exactly like `session` — so a multi-event lifecycle
        // (hover to preview, click to commit and advance) lives in its driver file,
        // not in engine branches.
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

        // Every edit reaches exactly ONE driver — the one `driverFor` names — so an
        // edit two drivers could claim is never run (and committed) twice per tick.
        // Iteration stays in REGISTRY order, which is load-bearing: a mark can carry
        // two lifecycles at once, and connect's dragend must run after move's.
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
            // The per-feature session this driver reads/writes. It is SHARED with
            // every other driver on the mark, so `clear` nulls only the keys this
            // driver declared (`sessionKeys`) — ownership by contract, not memory.
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
                // Read-only: lets a driver (e.g. brush) encode a channel's current
                // pixel position for hit-zone classification, without reinventing
                // scale lookup — the same global scales every edit already inverts through.
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

    // Plane-pick edits: the gesture is on the plane, so it carries no node and the
    // driver resolves its own target.
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    /**
     * @param {any} feature
     * @param {any} event
     * @param {import('../../types').Edit[]} [live] the arbitrated plane edits (else resolved here)
     * @returns {boolean}
     */
    const dispatchPlaneEdits = (feature, event, live) =>
        runDrivers(feature, event, live !== undefined ? live : livePlaneEdits(feature, event), null);

    // The plane edits of a feature that ACCEPT this gesture: those whose `when`
    // passes. A stroke keeps the set its dragstart resolved (a modifier released
    // mid-drag must not strand a driver without its dragend), so arbitration runs
    // on dragstart / click / dblclick / hover and is reused for drag / dragend.
    /** @type {Record<string, import('../../types').Edit[]>} */
    let strokeLive = {};
    // The plane edits that accepted each feature's last HOVER, so one that stops
    // accepting (a modifier released) is told the pointer left. See the plane
    // dispatch in handleEvent.
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
        // The pointer LEAVING reaches every plane edit. Dropping hover state is not
        // a gesture a modifier can decline, and a driver whose edit stopped
        // accepting (Shift released) must still hear it, or its ring stays lit.
        if (event.type === 'hoverout') return plane;
        const live = plane.filter(e => arbitrates(feature, e, event));
        if (event.type === 'dragstart') strokeLive[feature.id] = live;
        return live;
    };

    // With the plane on top, a press anywhere arrives as a plane gesture even when
    // it landed on a mark whose DIRECT edit should have it — a `move({ when:
    // when.shift })` beside a sweep gated `when.noShift`, or a vertex drag beside a
    // geo draw. When no plane edit accepts the gesture, resolve the node under the
    // pointer the way the renderer would have (pick.js's hitTest honours editable /
    // locked / pointerEvents) and hand the event on as a direct one. A stroke latches
    // the node it pressed, so leaving the mark mid-drag does not lose it.
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
    /** @param {any} event @returns {any | null} */
    const fallbackHit = (event) => {
        if (event.type === 'dragstart') { planeGrab = hitAny(event.x, event.y); return planeGrab; }
        if (event.type === 'drag') return planeGrab;
        if (event.type === 'dragend') { const g = planeGrab; planeGrab = null; return g; }
        if (event.type === 'click' || event.type === 'dblclick') return hitAny(event.x, event.y);
        return null;
    };

    // 4. Event routing.
    //    - Events carrying a `node` are mark-scoped (change existing elements) and
    //      route to that mark's direct-pick edits.
    //    - Events without a `node` are plane-scoped and route to every feature's
    //      plane/nearest/sweep/draw edits.
    /**
     * @param {any} event
     */
    const handleEvent = (event) => {
        let shouldRender = false;

        // Pointer-over/out on an editable mark. Pure interaction STATE — it never
        // reaches an edit, opens no undo transaction and writes no data; it only
        // records which row the pointer is on so the state pass can draw the
        // `hovered` effect (see core/effects.js). Handled before everything else so
        // it can't be mistaken for a gesture.
        //
        // This is the counterpart to a proximity driver's session: both answer "which
        // mark would a gesture take?", and they feed the same effect, so a direct-pick
        // mark now signals that before you press it instead of only changing the
        // cursor.
        // Hover is interaction STATE, like grab below: record it and let the one
        // render decision at the end draw the `hovered` effect. (It used to call
        // update() directly and return — a second render path beside shouldRender.)
        // Pointer POSITION, for the guides that follow it (a tip, a crosshair).
        // State only: recorded, rendered when a guide reads it, never dispatched.
        if (event.type === 'pointermove' || event.type === 'pointerleave') {
            const next = event.type === 'pointermove' ? { x: event.x, y: event.y } : null;
            const same = (!next && !ui.pointer) || !!(next && ui.pointer && next.x === ui.pointer.x && next.y === ui.pointer.y);
            ui.pointer = next;
            if (tracksPointer && !same) update();
            return;
        }

        if (event.type === 'pointerover' || event.type === 'pointerout') {
            const node = event.node;
            // The NODE rides along with the row: a feature that draws several
            // handles for one row (a port per edge, a vertex per point) must light
            // the one under the pointer, not the first it emitted.
            const next = event.type === 'pointerover' && node && node.index != null
                ? { featureId: node.featureId, index: node.index, node }
                : null;
            /** @param {any} a @param {any} b */
            const same = (a, b) => (!a && !b)
                || !!(a && b && a.featureId === b.featureId && a.index === b.index
                    && handleKey(a.node) === handleKey(b.node));
            // A LEAVE clears the hover only if it is from the node hovered now. When
            // a handle appears under a still pointer (a link's end, lit by hovering
            // the link), the browser may report entering the handle before leaving
            // the link body; clearing on that stale leave hid the handle again.
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

        // A keyboard nudge is INPUT NORMALIZATION, not an interaction mode: the
        // renderer reports "one step this way" and we resolve it into the pixel a
        // pointer would have been at, so it arrives as an ordinary `drag`. Every
        // direct-pick drag edit becomes keyboard-drivable with no new edit, no new
        // driver, and nothing downstream learning that keyboards exist.
        if (event.type === 'nudge') {
            // Step from where the datum's CURRENT VALUE sits, which is not the same
            // as where the node sits: a bar's centre is halfway up the bar, so
            // nudging from it would first teleport the value to the middle of
            // itself. encodeChannel answers "where is this datum on this axis" the
            // same way the mark drew it — the node centre is only the fallback for
            // a mark with nothing positional on that axis.
            const node = event.node;
            const from = markCenter(node);
            if (!from) return;
            const feature = features.find((f) => f.id === node.featureId);
            const channels = (feature && feature.channels) || {};
            const datum = node.index != null ? (feature ? tableOf(feature) : [])[node.index] : node.data;
            // Inside a composite's frame the datum's position is a LOCAL one, so read it
            // (and step it) through the node's own frame scales — the same overlay
            // computeEdit applies when the resulting drag arrives.
            const ks = frameScalesFor(feature, node, node.index) || chart.scales;
            const atX = datum ? encodeChannel(ks, channels, 'x', datum, from.cx) : from.cx;
            const atY = datum ? encodeChannel(ks, channels, 'y', datum, from.cy) : from.cy;
            event = {
                type: 'drag',
                node,
                x: nudgeTarget(ks.x, atX, event.dx, event.coarse),
                y: nudgeTarget(ks.y, atY, event.dy, event.coarse),
                // One press = one complete gesture (there is no dragend coming), so
                // it closes its own undo transaction below.
                nudge: true,
                rawEvent: event.rawEvent,
            };
        }

        // Undo transaction boundaries. A stroke is one unit of "take that back":
        // dragstart opens it and dragend closes it, so the many commits a drag makes
        // in between collapse into a single history entry. Any other gesture (click,
        // dblclick, a typed commit) is a transaction of its own — begin it here and
        // close it below, so it can't absorb the next one.
        // dragstart always starts a fresh one, so a stroke whose dragend never
        // arrived can't leak its stale "before" into the next gesture.
        // A plane gesture no plane edit accepts falls back to the mark under the
        // pointer (see fallbackHit). Resolved here, before the grab state and the
        // transaction, so the re-routed event is indistinguishable from one the
        // renderer reported on the node itself.
        /** @type {Map<string, import('../../types').Edit[]> | null} */
        let planeLive = null;
        // A press that lands ON a mark carrying a direct edit grabs that mark, as
        // it does with the plane down: the author put a handle there to be
        // dragged. Only a press elsewhere is the plane edits'. Without this, a
        // sweep or brush anywhere on the chart made every direct handle beside
        // it unreachable for the whole stage.
        if (!event.node && event.x != null && (event.type === 'dragstart' || event.type === 'click' || event.type === 'dblclick')) {
            const hit = hitAny(event.x, event.y);
            // ...provided one of that mark's direct edits ACCEPTS the gesture: a
            // `move({ when: when.noShift })` under a Shift press declines, and the
            // press stays the plane's (a Shift-gated sweep).
            const owner = hit ? features.find((f) => f.id === hit.featureId) : null;
            const accepts = owner && activeEdits(owner).some((e) => e.pick === 'direct'
                && arbitrates(owner, e, { ...event, node: hit }));
            if (hit && accepts) {
                if (event.type === 'dragstart') { planeGrab = hit; directStroke = true; }
                event = { ...event, node: hit };
            }
        } else if (!event.node && directStroke && (event.type === 'drag' || event.type === 'dragend')) {
            const hit = planeGrab;
            if (event.type === 'dragend') { planeGrab = null; directStroke = false; }
            if (hit) event = { ...event, node: hit };
        }
        // Hover follows the same rule: over a mark a press would grab, the mark is
        // what the pointer is about to touch, so it lights as `hovered` and the
        // plane edits see the pointer LEAVE (a pan drops its grab cursor, a sweep
        // its preview). Off it, the plane edits get the hover back.
        if (!event.node && event.type === 'hover' && event.x != null && chart.planeRaised) {
            const hit = hitAny(event.x, event.y);
            const owner = hit ? features.find((f) => f.id === hit.featureId) : null;
            const accepts = owner && activeEdits(owner).some((e) => e.pick === 'direct'
                && arbitrates(owner, e, { ...event, type: 'dragstart', node: hit }));
            if (hit && accepts) {
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
                    // Plane hover with nothing listening: report the mark under the
                    // pointer as the renderer's own pointerover/out would, so the
                    // `hovered` effect lights the direct mark the fallback would grab.
                    const hit = event.type === 'hover' ? hitAny(event.x, event.y) : null;
                    if (hit) { if (!ui.hover || ui.hover.node !== hit) handleEvent({ type: 'pointerover', node: hit }); }
                    else if (ui.hover) handleEvent({ type: 'pointerout', node: ui.hover.node });
                } else {
                    const hit = fallbackHit(event);
                    if (hit) event = { ...event, node: hit };
                }
            }
        }

        // Which undo transaction this event belongs to (a wheel burst and a drag are
        // each one gesture — see engine/history.js).
        history.gestureTxn(event.type);

        // A hierarchy's rows are pushed apart at the END of a stroke, around what it
        // moved (see `stroking`). A nudge's synthetic drag is a whole gesture.
        if (hierarchyNodes && !event.nudge) {
            if (event.type === 'dragstart') { chart.stroking = true; chart.strokeNodes = chart.tables[hierarchyNodes]; }
            else if (event.type === 'drag') chart.stroking = true;
        }

        // Grab state rides the SAME bracket as the transaction — one stroke, one
        // grabbed row — so the state pass can draw `grabbed` beside the other two
        // instead of the renderer painting it privately off d3.drag. Force a render
        // when it changes and the state actually paints something: a press that
        // moves no data (or none yet) still has to light the mark up, which is the
        // whole point of pre-commit feedback.
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
            const feature = features.find(f => f.id === event.node.featureId);
            if (feature && dispatchDirectEdits(feature, event)) shouldRender = true;
        } else {
            // Plane gestures -> every feature's plane/nearest/sweep/draw edits.
            features.forEach(feature => {
                const live = planeLive ? planeLive.get(feature.id) : undefined;
                // A hover a plane edit now DECLINES is, to its driver, the pointer
                // leaving: a `move({ when: when.shift })` lit a ring while Shift was
                // down, and with Shift up it is never called again, so it would keep
                // that ring forever. Retire it first, then hand the hover to the
                // edits that accept it (they share the feature's session).
                // Only an edit that accepted the LAST hover has anything to retire, so
                // a pointer moving with Shift up re-renders nothing.
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

        // A stroke that carried a node held its ancestors still (see heldStill). The
        // release lets them go, whether or not the node changed container, and that
        // last fit is part of the same gesture: one undo entry, one `change`.
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

        // Keep the transaction open only for the duration of a stroke. A nudge's
        // synthetic drag is a complete gesture on its own, so it closes too —
        // otherwise it would stay open and swallow whatever gesture came next.
        if (event.type === 'dragend' || event.nudge
            || (event.type !== 'dragstart' && event.type !== 'drag' && event.type !== 'wheel')) endTxn();

        if (shouldRender) {
            update();
        }
    };

    return { handleEvent, rowTargeted };
}
