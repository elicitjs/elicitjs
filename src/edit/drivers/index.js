// @ts-check
// drivers/ — self-describing interaction modes. Each driver owns one multi-event
// lifecycle (hover/dragstart/drag/dragend). The engine (runDrivers) simply asks
// each driver `wants(edit)` and hands it the matching edits + a per-feature
// session; it never hard-codes a mode. Adding a new interaction mode = adding a
// driver file here, not editing the engine.
//
// Most drivers serve PLANE-pick edits, where the gesture carries no node and the
// driver resolves its own target. A driver may also claim a DIRECT-pick edit by
// CAPABILITY rather than by pick name (see slide.js: a relative slide needs a
// dragstart anchor but not a target search). Then `ctx.index` already names the
// datum, and because the edit is still `pick: 'direct'` the plane is never raised
// — so a lifecycle edit can sit on a glyph part beside other direct edits.
//
// A driver is:
//   { name, wants(edit) -> bool, onEvent(ctx) -> boolean changed, selects? }
// `selects: true` declares that the driver writes a SELECTION into its session
// (hoverIndex/activeIndex, and optionally px/py/threshold) — which is what lets an
// edit with `guide: true` draw the `select` effect (snap ring + mark highlight)
// without guide.js keeping its own list of which picks do that.
// where ctx = { feature, event, edits, marks, data, scales, session, preview,
//               stage, runEdit, previewEdit }:
//   edits       the feature's edits this driver wants (already filtered)
//   session     per-feature transient state: { get(), set(patch), clear() }
//   preview     the feature's uncommitted proposal: { get(), clear() }
//   stage       the chart's stage cursor: { get(), set(n), next() }
//   runEdit     (edit, index) => boolean — apply + invariants + COMMIT
//   previewEdit (edit, index) => boolean — the same, parked as an uncommitted preview

import { planeDriver } from './plane.js';
import { nearestDriver } from './nearest.js';
import { sweepDriver } from './sweep.js';
import { drawDriver } from './draw.js';
import { brushDriver } from './brush.js';
import { brushRectDriver } from './brushRect.js';
import { geoBrushDriver } from './geoBrush.js';
import { probeDriver } from './probe.js';
import { axisDragDriver } from './axisDrag.js';
import { slideDriver } from './slide.js';
import { moveDriver } from './move.js';
import { connectDriver } from './connect.js';

/**
 * @typedef {Object} DriverSession
 * @property {() => any} get
 * @property {(patch: any) => void} set
 * @property {() => void} clear
 *
 * @typedef {Object} DriverPreview
 * @property {() => { table: string, rows: any[] } | null} get the parked proposal:
 *   the rows it would commit, and WHICH TABLE they replace (an edit may propose for
 *   a table other than the one its mark draws — see edit.network.connect).
 * @property {() => boolean} clear
 *
 * @typedef {Object} DriverStage
 * @property {() => number} get
 * @property {(n: number) => void} set
 * @property {() => void} next
 *
 * @typedef {Object} DriverContext
 * @property {any} feature
 * @property {any} event
 * @property {import('../../types').Edit[]} edits
 * @property {any[]} marks
 * @property {any[]} data
 * @property {import('../../types').ScaleMap} scales
 * @property {number | null} index the datum a DIRECT gesture landed on, or null
 *   for a plane gesture — where the driver resolves its own target from the
 *   pointer (nearestMark and friends). A driver that can serve a direct-pick edit
 *   reads this first and skips its proximity search.
 * @property {DriverSession} session
 * @property {DriverPreview} preview
 * @property {DriverStage} stage
 * @property {(edit: import('../../types').Edit, index: number | null) => boolean} runEdit
 * @property {(edit: import('../../types').Edit, index: number | null) => boolean} previewEdit
 *
 * @typedef {Object} Driver
 * @property {string} name
 * @property {(edit: import('../../types').Edit) => boolean} wants
 * @property {(ctx: DriverContext) => boolean} onEvent
 * @property {boolean} [selects] writes a selection into its session (see above),
 *   so an edit with `guide: true` can draw the `select` effect for it.
 */

/** @type {Driver[]} */
export const drivers = [planeDriver, nearestDriver, sweepDriver, drawDriver, brushDriver, brushRectDriver, geoBrushDriver, probeDriver, axisDragDriver, slideDriver, moveDriver, connectDriver];

/**
 * Register a custom driver (or replace a built-in by the same `name`). The engine
 * reads this mutable registry from dispatchPlaneEdits — no elicit.js branches.
 * @param {Driver} driver
 */
export function registerDriver(driver) {
    if (!driver || !driver.name || typeof driver.wants !== 'function' || typeof driver.onEvent !== 'function') {
        throw new Error('[elicit] registerDriver expects { name, wants(edit), onEvent(ctx) }');
    }
    const i = drivers.findIndex((d) => d.name === driver.name);
    if (i >= 0) drivers[i] = driver;
    else drivers.push(driver);
}

/**
 * The driver that will handle this edit, or undefined for a direct/plane-pick edit
 * no lifecycle driver claims. The one place `pick` is resolved to a driver, so
 * callers ask the registry a capability question instead of listing pick names.
 * Two passes: an exact `name === pick` match anywhere in the registry beats any
 * `wants()` claim, so an earlier driver's greedy `wants` can never shadow the
 * driver an edit names explicitly.
 * @param {import('../../types').Edit} edit
 * @returns {Driver | undefined}
 */
export function driverFor(edit) {
    return drivers.find((d) => d.name === edit.pick) || drivers.find((d) => d.wants(edit));
}

/**
 * Does any of these edits need the plane raised above the marks (a driver whose
 * lifecycle resolves its target from an arbitrary pointer position)? The engine
 * reads this to decide plane-on-top mode. Unknown pick values that match a
 * registered driver are treated as plane-on-top (custom drivers own the plane).
 * @param {import('../../types').Edit[]} edits
 * @returns {boolean}
 */
export function needsPlaneOnTop(edits) {
    return edits.some((e) => {
        // `direct` hit-tests the mark itself; `plane` sits UNDER the marks so a
        // gesture on a mark still reaches it. Every other lifecycle driver
        // resolves its target from an arbitrary pointer position, so it needs the
        // plane raised — ask the registry, so a custom driver qualifies too.
        if (e.pick === 'direct' || e.pick === 'plane') return false;
        return !!driverFor(e);
    });
}
