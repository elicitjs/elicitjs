// @ts-check
// Chart elements — scale chrome, not data marks. They view a SCALE (`views:
// 'scale'`), take a singular `channel`, paint CHROME (not desugared channels),
// and their edits target the schema DOMAIN (`edit.axis.*`). See ChartElement
// in types.d.ts.
//
// Public as `elicit.elements.*`, and ONLY there — these used to be aliased onto
// `plot.*` as well, which made every one of them two spec keywords for one thing.
//
// `AXIS_OPTIONS` / `GRID_OPTIONS` are the option vocabularies these elements
// validate against (see warnUnknownElementOptions); they are exported so the same
// list can drive the docs and, later, the JSON grammar.

export { axis, axisX, axisY, grid, gridX, gridY, AXIS_OPTIONS, GRID_OPTIONS } from '../plot/axis.js';
export { legend, legendColor, legendSize, legendSymbol } from '../plot/legend.js';
export { axisRadial } from '../plot/axisRadial.js';
