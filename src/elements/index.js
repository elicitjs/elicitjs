// @ts-check
// Chart elements — scale chrome, not data marks. They view a SCALE (`views:
// 'scale'`), take a singular `channel`, paint CHROME (not desugared channels),
// and their edits target the schema DOMAIN (`edit.axis.*`). See ChartElement
// in types.d.ts.
//
// Public as `elicit.elements.*`, and ONLY there — these used to be aliased onto
// `plot.*` as well, which made every one of them two spec keywords for one thing.
//
// The option VOCABULARIES these elements validate against (`AXIS_OPTIONS`,
// `GRID_OPTIONS`, `LEGEND_OPTIONS`, `AXIS_RADIAL_OPTIONS`) are not spec keywords —
// they are lists of option names, which is authoring material — so they live in
// `authoring.*`. A namespace contains only what can appear in a spec.

export { axis, axisX, axisY, grid, gridX, gridY } from '../plot/axis.js';
export { legend, legendColor, legendSize, legendSymbol } from '../plot/legend.js';
export { axisRadial } from '../plot/axisRadial.js';
