// @ts-check
// The public surface. Grammar namespaces hold only spec keywords:
//   plot.*         marks        view data (one node per row)
//   elements.*     elements     view a scale (axis / grid / legend)
//   guides.*       guides       view state, write nothing
//   looks.*        looks        restyle how the chart is drawn (experimental)
//   layout.*       layout       spatial settling processes over mark boxes
//   edit.*         edits        a gesture -> data, through the encoding's scale
//   constraints.*  invariants   rules over the elicited dataset
//   widgets.*      instruments  whole specs
// `authoring.*` (also `elicitjs/authoring`) holds the building blocks.
// `compile(json)` turns a JSON spec into the same spec these factories build.
import { Elicit } from "./core/elicit.js";
import * as plot from "./plot/index.js";
import * as elements from "./elements/index.js";
import * as edit from "./edit/index.js";
import * as constraints from "./constraints/index.js";
import * as guides from "./guides/index.js";
import * as looks from "./looks/index.js";
import * as layout from "./layout/index.js";
import * as widgets from "./widgets/index.js";
import * as authoring from "./authoring/index.js";
import * as format from "./format.js";
import { D3Renderer } from "./renderers/d3-renderer/index.js";
import { CanvasRenderer } from "./renderers/canvas/index.js";
import { setTheme, resolveTheme, DEFAULT_THEME } from "./core/theme.js";
import { themes } from "./core/themes.js";
import { setWarnings } from "./core/dev.js";
import { compile, registerFunction, recorder } from "./json/index.js";

export {
  Elicit,
  plot,
  // Axis / grid / legend / axisRadial: they view a scale, not rows.
  elements,
  edit,
  constraints,
  // Guides view chart state and write nothing.
  guides,
  // Looks restyle the finished drawing: a hand-drawn redraw, a shader. Experimental.
  looks,
  // Spatial layout processes: contain, dodge, row, column, grid, pack, custom.
  layout,
  widgets,
  // Building blocks for new marks / edits / constraints / widgets.
  authoring,
  format,
  D3Renderer,
  CanvasRenderer,
  // `themes` are the built-in themes; `setTheme` sets the app-wide default;
  // `spec.theme` sets one chart's.
  themes,
  setTheme,
  resolveTheme,
  DEFAULT_THEME,
  // Warnings are on by default, off under NODE_ENV=production or setWarnings(false).
  setWarnings,
  // The JSON spec layer: `Elicit(compile(json))`. A spec names its functions,
  // which `registerFunction` (or `compile`'s `functions` option) supplies.
  compile,
  registerFunction,
  // The other direction: a spec written in JavaScript, recorded as JSON.
  recorder,
};
