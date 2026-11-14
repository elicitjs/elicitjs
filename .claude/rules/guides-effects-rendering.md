---
paths:
  - "src/guides/**"
  - "src/edit/guide.js"
  - "src/core/effects.js"
  - "src/core/theme.js"
  - "src/core/themes.js"
  - "src/core/titles.js"
  - "src/core/scene.js"
  - "src/core/engine/render.js"
  - "src/core/engine/nodes.js"
  - "src/renderers/**"
---

# Guides, effects, themes and rendering

## Three kinds of visual statement

- Style is what the data is (channels). A guide is what the rule is (`edit.guide`: `bounds`, `catchment`, `track`). An effect is what is happening (`spec.effects`: `hovered`, `selected`, `grabbed`). Neither guides nor effects may touch data-driven paint.

## Guides

- `views: 'state'`: no `table`, no channel map, no `edits`, no row. Options may be literals or functions of the chart context. Read-only by kind, not by discipline.
- Guides come from `spec.guides`, `Constraint.guide` and `Edit.guide`, all drawn by `buildEditGuide` in `edit/guide.js`. No second drawer.
- Validate options with `warnUnknownGuideOptions(name, options, ALLOW)`. Styles resolve through `resolveGuide`; no literal dash/width/opacity.
- The pointer is state: renderers report `pointermove`/`pointerleave` from the root, once per frame, only when a guide declares `tracksPointer`. The engine records `ui.pointer`, resolves `ui.hit` with `hitTestAny` over every datum-bearing node (editable or not), and re-renders. Nothing is dispatched; no node's `pointerEvents` changes. `guides.tip` and `guides.crosshair` read it; a mark's `tip:` shorthand desugars to `tip({ mark })`. `guides.quadrants` is the centre-frame guide. Never bind hover listeners to inert nodes.

## Effects

- The engine's state pass in `update()` decides effects; renderers only apply them. Restyle → `node.effectStyle` (merged by `effectStyleFor`, `grabbed` > `selected` > `hovered`). `outline` → an overlay node tagged `effect: true`. Everything else restyles the node.
- An effect is a CSS style property or an overlay node, never a paint attribute (that once wiped a mark's own stroke).
- Hover has two sources (a proximity driver's session, the renderer's per-node `pointerover`); both feed the one `hovered` effect.
- A text node gets no default outline (the cursor is its feedback). An outline the spec sets draws a measured box around it (`outline.requested`, set by `resolveState`).
- Anything drawn about a node copies its `angle`, and overlays stay concentric with their source so `markCenter` gives one pivot. Pick geometry `unrotate`s (`edit/pick.js`) before axis-aligned tests.

## Paint order and hit overlays

- `paintOrder` (`core/scene.js`) orders a glyph's nodes by row then part, and paints `raise`d nodes above everything.
- A hit/grab overlay is a fallback: keep it beneath (`hitSel.lower()`), never `raise()` it.

## Clipping

- The clip rect is computed only in `clipRect` (`core/scene.js`): plot rect grown by `clip: { pad }`. It goes to renderers as `RenderContext.clip` and to `clipVisible` (engine hit/tip pass, canvas hit test), so drawn and hittable can't disagree.
- Clipping turns on when any edit declares `viewport: true`; `spec.clip` overrides. Elements and `clip: false` marks are stamped `unclipped` and paint in the `chrome` bucket (`partitionScene`). That stamp is the only escape mechanism.

## Renderers

- A gesture's `x`/`y` are the pointer in scene coordinates in every renderer. `_makeDrag` sets `.subject(event => ({ x: event.x, y: event.y }))` — d3.drag's default subject (the bound datum) displaces a rect's drag by its top-left. Never drop it or compensate in a mark.
- The D3 renderer raises the plane for plane-pick modes and lowers it when the mode flips back.

## Themes and titles

- A theme is data (`core/theme.js`, `resolveTheme`). Named themes live in `core/themes.js` as partials (`theme: 'nyt'` or `{ extends: 'nyt', … }`), transcribed from Flint presets via `fromFlint` — add a preset as a Flint row, not hand-mapped tokens.
- An axis option and its `theme.axis` token share one name and resolve through `chromeOf` (option > `axis.discrete`/`axis.continuous` by `kind` > `axis`), read by both `measureTitle` and `build`. Per-tick functions are options only; the theme stays function-free so it deep-merges.
- A theme-requested grid is injected by `autoAxes` with an internal `auto` flag; grids go before axes.
- A new default must reproduce the old look exactly.
- `spec.title`/`subtitle`/`caption` go through `core/titles.js`: bands outside the legend bands, added to `effectiveMargins` in `update()`. The chart keeps its declared size; the plot shrinks. An axis title reserves its room via `Axis.measureTitle`. Never draw a title as a text mark.
- `strokeDash` (a constant, or a field via an ordinal scale onto `DEFAULT_DASHES`) is swept by `resolveStyle` onto `strokeDasharray`. No author-facing `strokeDasharray`.
- `gradient: { stops, direction }` on area/bar/rect → `node.fillGradient`, painted by both renderers; an effect restyle still wins.
