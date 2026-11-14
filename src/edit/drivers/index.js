// @ts-check
// drivers/ — each driver owns one multi-event lifecycle (hover/dragstart/drag/
// dragend). Most serve plane-pick edits and resolve their own target; a driver may
// also claim a direct-pick edit by capability (relative slide/move), receiving
// `ctx.index` with the plane kept down.
//
// A driver is:
//   { name, wants?(edit) -> bool, sessionKeys, onEvent(ctx) -> boolean changed, selects?, targetsRow? }
//
// `driverFor` gives each edit exactly one driver: `name === edit.pick` first, then
// the first `wants` claim. `wants` is a capability predicate and never re-tests `pick`.
// `sessionKeys`: the keys this driver owns in the per-feature session, which every
// driver on the mark shares. `clear()` nulls only these, so it can't wipe another
// driver's state (e.g. connect's `fromIndex`).
// `selects: true`: writes a selection (hoverIndex/activeIndex, optionally
// px/py/threshold) into its session, so its edits get a catchment guide.
// `targetsRow: true`: the driver only chooses a row, so `el.control(name, index)`
// can run its edits on that row directly. Others make `control()` warn.
// where ctx = { feature, event, edits, marks, data, scales, session, preview,
//               stage, runEdit, previewEdit, reachable }:
//   edits       the feature's edits this driver wants (already filtered)
//   session     per-feature transient state: { get(), set(patch), clear() }
//   preview     the feature's uncommitted proposal: { get(), clear() }
//   stage       the chart's stage cursor: { get(), set(n), next() }
//   runEdit     (edit, index) => boolean — apply + invariants + commit
//   previewEdit (edit, index) => boolean — the same, parked as an uncommitted preview
//   reachable   (edit, index, node?) => string[] | null — the drop keys a release
//               could land on (`Edit.targets`, each tried as a commit), or null for
//               an edit that declares none

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
import { nestDriver } from './nest.js';
import { panDriver } from './pan.js';

/**
 * @typedef {Object} DriverSession
 * @property {() => any} get
 * @property {(patch: any) => void} set
 * @property {() => void} clear
 *
 * @typedef {Object} DriverPreview
 * @property {() => { table: string, rows: any[] } | null} get the parked proposal:
 *   the rows it would commit and the table they replace (which may not be the mark's).
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
 * @property {number | null} index the datum a direct gesture landed on, or null
 *   for a plane gesture, where the driver resolves its own target.
 * @property {DriverSession} session
 * @property {DriverPreview} preview
 * @property {DriverStage} stage
 * @property {(edit: import('../../types').Edit, index: number | null, at?: { x: number, y: number }) => boolean} runEdit
 * @property {(edit: import('../../types').Edit, index: number | null) => boolean} previewEdit
 * @property {(edit: import('../../types').Edit, index: number | null, node?: any) => string[] | null} [reachable]
 *
 * @typedef {Object} Driver
 * @property {string} name
 * @property {(edit: import('../../types').Edit) => boolean} [wants] a capability
 *   claim on an edit not addressed by pick name (never re-test `pick`)
 * @property {string[]} [sessionKeys] the session keys this driver owns; its
 *   `session.clear()` nulls exactly these
 * @property {string[]} [options] the per-edit knobs this driver reads off the
 *   descriptor (`edgeInset`, `resize`, …); unknown-option warnings skip them
 * @property {(ctx: DriverContext) => boolean} onEvent
 * @property {boolean} [selects] writes a selection into its session, so its
 *   edits get a catchment guide
 * @property {boolean} [targetsRow] only chooses the row, so
 *   `el.control(name, index)` can run its edits on a named row directly
 */

/** @type {Driver[]} */
export const drivers = [planeDriver, nearestDriver, sweepDriver, drawDriver, brushDriver, brushRectDriver, geoBrushDriver, probeDriver, axisDragDriver, slideDriver, moveDriver, connectDriver, nestDriver, panDriver];

/**
 * Register a custom driver, or replace a built-in with the same `name`.
 * @param {Driver} driver
 */
export function registerDriver(driver) {
    if (!driver || !driver.name || typeof driver.onEvent !== 'function'
        || (driver.wants != null && typeof driver.wants !== 'function')) {
        throw new Error('[elicit] registerDriver expects { name, onEvent(ctx), wants?(edit), sessionKeys? }');
    }
    const i = drivers.findIndex((d) => d.name === driver.name);
    if (i >= 0) drivers[i] = driver;
    else drivers.push(driver);
}

/**
 * The driver that handles this edit, or undefined. An exact `name === pick` match
 * beats any `wants()` claim.
 * @param {import('../../types').Edit} edit
 * @returns {Driver | undefined}
 */
export function driverFor(edit) {
    return drivers.find((d) => d.name === edit.pick) || drivers.find((d) => d.wants ? d.wants(edit) : false);
}

/**
 * Whether any edit needs the plane raised above the marks: any pick other than
 * `direct` / `plane` that a driver serves.
 * @param {import('../../types').Edit[]} edits
 * @returns {boolean}
 */
export function needsPlaneOnTop(edits) {
    return edits.some((e) => {
        if (e.pick === 'direct' || e.pick === 'plane') return false;
        return !!driverFor(e);
    });
}
