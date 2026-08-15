// @ts-check
//
// The public surface, in two halves.
//
// THE GRAMMAR — what can appear in a spec. Each namespace holds exactly one kind
// of thing, so its members are the grammar's keywords:
//   plot.*         marks      — view DATA (one node per row)
//   elements.*     elements   — view a SCALE (axis / grid / legend)
//   guides.*       guides     — view STATE (read-only; write nothing)
//   edit.*         edits      — a gesture -> data, through the encoding's own scale
//   constraints.*  invariants — pure rules over the elicited dataset
//   widgets.*      instruments — whole specs, one call each
//
// THE AUTHORING KIT — what you build new vocabulary FROM (`authoring.*`, also
// importable as `elicitjs/authoring`). Kept out of the grammar so autocomplete
// shows the language rather than the implementation.
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
import { noteBox } from "./core/measure.js";

export {
  Elicit,
  plot,
  // Chart elements (axis / grid / legend / axisRadial) — scale chrome. These view
  // a SCALE rather than rows, which is why they are their own namespace and not
  // marks.
  elements,
  edit,
  constraints,
  // Guides view chart STATE and write nothing — the rule and the state, rather
  // than the data. See ARCHITECTURE.md's feature table.
  guides,
  widgets,
  // The kit for writing new marks / edits / constraints / widgets. Also available
  // as `import { … } from 'elicitjs/authoring'`.
  authoring,
  format,
  D3Renderer,
  CanvasRenderer,
  // Theme layer: `themes` are the built-ins (default, survey); `setTheme` sets the
  // app-wide default; a chart passes `spec.theme` for a per-chart theme.
  themes,
  setTheme,
  resolveTheme,
  DEFAULT_THEME,
  // Developer warnings are ON by default (and off automatically when a bundler
  // inlines NODE_ENV=production). Call setWarnings(false) to silence them.
  setWarnings,
  // The box a padded note of text occupies — `sticker`'s own sizing rule. Exported
  // so a `link` docking to an auto-sized note can reach the same answer:
  // `nodeWidth: { fn: d => noteBox(d.label).width }`.
  noteBox,
};
