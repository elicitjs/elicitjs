// @ts-check
/**
 * The engine's reassigned state (a commit replaces `tables`, a resize the dims),
 * held on one object every engine module shares. Internal.
 *
 * Read a field at call time (`chart.tables`), never destructure it at creation:
 * a local copy keeps the rows from before the next commit.
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
