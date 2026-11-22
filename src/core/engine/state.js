// @ts-check
/**
 * The engine's reassigned state (a commit replaces `tables`, a resize the dims),
 * held on one object every engine module shares. Internal.
 *
 * Read a field at call time (`chart.tables`), never destructure it at creation:
 * a local copy keeps the rows from before the next commit.
 *
 * `tables` and `contextRows` belong to the dataset (core/dataset.js); here they
 * are accessors that read and write it.
 */

/**
 * @typedef {object} ChartState
 * @property {Record<string, any[]>} tables  the elicited dataset, one array per table NAME (the dataset's)
 * @property {Record<string, WeakSet<object>>} contextRows  context membership, by row identity (the dataset's)
 * @property {number} curW  the chart's working width (tracks the container in 'reflow' mode)
 * @property {number} curH  the chart's working height
 * @property {{ top: number, right: number, bottom: number, left: number }} effectiveMargins
 *   author margins + the bands legends, axis titles and chart titles reserve; recomputed every render
 * @property {number} innerWidth  the plot rect's width (curW minus the effective margins)
 * @property {number} innerHeight  the plot rect's height
 * @property {import('../../types').ScaleMap} scales  the global scales, re-resolved every render
 * @property {boolean} planeRaised  was the interaction plane on top at the last render?
 * @property {boolean} sceneHasOnHover  does the last built scene carry an `onHover` node (a port)?
 * @property {boolean} stroking  is a layout drag stroke in progress? (nothing is pushed apart mid-stroke)
 * @property {string | null} strokeTable  the layout table the current stroke is dragging in
 * @property {any[] | null} strokeNodes  the layout table's rows as the current stroke began
 * @property {number | null} strokeRow  the layout table row the current stroke grabbed
 * @property {boolean} snapNext  draw the next frame at once, not eased (data arrived from outside)
 */

/**
 * @param {import('../dataset.js').DataState} dataset
 * @returns {ChartState}
 */
export function createChartState(dataset) {
    const chart = /** @type {ChartState} */ ({});
    Object.defineProperties(chart, {
        tables: { get: () => dataset.tables, set: (v) => { dataset.tables = v; }, enumerable: true },
        contextRows: { get: () => dataset.contextRows, set: (v) => { dataset.contextRows = v; }, enumerable: true },
    });
    return chart;
}
