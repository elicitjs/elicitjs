// @ts-check
// The public surface. Grammar namespaces hold only spec keywords:
//   plot.*         marks        view data (one node per row)
//   elements.*     elements     view a scale (axis / grid / legend)
//   guides.*       guides       view state, write nothing
//   edit.*         edits        a gesture -> data, through the encoding's scale
//   constraints.*  invariants   rules over the elicited dataset
//   widgets.*      instruments  whole specs
// `authoring.*` (also `elicitjs/authoring`) holds the building blocks.
import { Elicit } from "./core/elicit.js";
import * as plot from "./plot/index.js";
import * as elements from "./elements/index.js";
import * as edit from "./edit/index.js";
import * as constraints from "./constraints/index.js";
import * as guides from "./guides/index.js";
import * as widgets from "./widgets/index.js";
import * as authoring from "./authoring/index.js";
import * as format from "./format.js";
import { D3Renderer } from "./renderers/d3-renderer/index.js";
import { CanvasRenderer } from "./renderers/canvas/index.js";
import { setTheme, resolveTheme, DEFAULT_THEME } from "./core/theme.js";
import { themes } from "./core/themes.js";
import { setWarnings } from "./core/dev.js";

export {
  Elicit,
  plot,
  // Axis / grid / legend / axisRadial: they view a scale, not rows.
  elements,
  edit,
  constraints,
  // Guides view chart state and write nothing.
  guides,
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
};
