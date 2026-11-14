// @ts-check
/**
 * The engine's mutable state, shared by the modules `Elicit()` is wired from.
 *
 * `Elicit(spec)` used to be one 3,000-line closure, and every helper reached its
 * state through closure bindings. A closure cannot be split across files, so the
 * bindings that are REASSIGNED (a commit replaces `tables`, a resize replaces the
 * dims) live here, on one object every engine module holds. Bindings that are never
 * reassigned (the `ui` record, the schema) are handed over as they are.
 *
 * Read a field at CALL time (`chart.tables`), never destructure one at creation
 * time: a module that copied `chart.tables` into a local would keep drawing the
 * rows from before the next commit.
 *
 * Internal. Not part of the public `types.d.ts` surface.
 */

/**
 * @typedef {object} ChartState
 * @property {Record<string, any[]>} tables  the elicited dataset, one array per table NAME
 * @property {Record<string, WeakSet<object>>} contextRows  context membership, by row identity (see core/lock.js)
 * @property {number} curW  the chart's working width (tracks the container in 'reflow' mode)
 * @property {number} curH  the chart's working height
 * @property {{ top: number, right: number, bottom: number, left: number }} effectiveMargins
 *   author margins + the bands legends, axis titles and chart titles reserve; recomputed every render
 * @property {number} innerWidth  the plot rect's width (curW minus the effective margins)
 * @property {number} innerHeight  the plot rect's height
 * @property {import('../../types').ScaleMap} scales  the global scales, re-resolved every render
 * @property {boolean} planeRaised  was the interaction plane on top at the last render?
 * @property {boolean} sceneHasOnHover  does the last built scene carry an `onHover` node (a port)?
 * @property {boolean} stroking  is a hierarchy drag stroke in progress? (nothing is pushed apart mid-stroke)
 * @property {any[] | null} strokeNodes  the hierarchy's node rows as the current stroke began
 * @property {boolean} spaceNext  space the hierarchy's rows on the next settle (data arrived from outside)
 */

/** @returns {ChartState} */
export function createChartState() {
    return /** @type {ChartState} */ ({});
}
