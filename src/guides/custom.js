// @ts-check
// guides.custom: draws arbitrary non-interactive nodes from the render context.
//
//   guides.custom(({ scales, width, height, state, ui }) => [
//     { type: 'circle', cx: scales.x.encode('Agree'), cy: height / 2, r: 12,
//       fill: 'none', stroke: '#cbd5e1' },
//   ])
//
// The builder gets { scales, state, features, featureNodes, ui, effects, width,
// height, stage } and returns FeatureNodes. Each is tagged `guide` with
// `pointerEvents: 'none'`; `background: true` draws a node behind the marks.

/**
 * @param {(ctx: any) => import('../types').FeatureNode[]} build
 * @param {{ tracksPointer?: boolean }} [options] `tracksPointer`: the builder
 *   reads `ui.pointer` / `ui.hit`, so the chart re-renders as the pointer moves
 * @returns {import('../types').Guide}
 */
export function custom(build, options = {}) {
    return {
        views: 'state',
        type: 'custom',
        ...(options && options.tracksPointer ? { tracksPointer: true } : {}),
        build: (_rows, _scales, _w, _h, ctx) => (build(ctx) || []).map((node) => ({
            pointerEvents: 'none',
            ...node,
            // The author's word is `strokeDash`; the scene's is `strokeDasharray`.
            ...(/** @type {any} */ (node).strokeDash != null && node.strokeDasharray == null
                ? { strokeDasharray: /** @type {any} */ (node).strokeDash } : {}),
            guide: true
        }))
    };
}
