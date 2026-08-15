// @ts-check
// guides.custom — the guide escape hatch: draw arbitrary non-interactive nodes
// from the live render context. It is to guides what `edit.custom` is to edits.
//
//   guides.custom(({ scales, width, height, state, ui }) => [
//     { type: 'circle', cx: scales.x.encode('Agree'), cy: height / 2, r: 12,
//       fill: 'none', stroke: '#cbd5e1' },
//   ])
//
// This is the affordance layer the survey widgets are built from — the option
// rings on a Likert scale, the cell grid behind a matrix, a slider's track. Those
// are annotations, not data: they carry no datum, must never swallow a gesture,
// and re-derive from the same context every render. That is exactly a guide, so
// they go through the one guide path rather than pretending to be marks.
//
// The builder receives the guide context — { scales, state, features, featureNodes,
// ui, effects, width, height, stage } — and returns FeatureNodes. Every node is
// tagged `guide` + `pointerEvents: 'none'` on the way out, so a custom guide can
// never capture the pointer. Set `background: true` on a node to draw it behind
// the marks (a track, a cell grid) rather than in front.

/**
 * @param {(ctx: any) => import('../types').FeatureNode[]} build
 * @returns {import('../types').Guide}
 */
export function custom(build) {
    return {
        views: 'state',
        build: (_rows, _scales, _w, _h, ctx) => (build(ctx) || []).map((node) => ({
            pointerEvents: 'none',
            ...node,
            guide: true
        }))
    };
}
