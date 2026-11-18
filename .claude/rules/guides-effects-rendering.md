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
- States and treatments are separate layers. The states are `hovered`, `selected`, `target`, `grabbed`. A state's own style is its highlight; `others` is its mute (rows in no state while it has a row; restyle only, no outline); `neighbours` extends the highlight through `neighboursOf` (`core/neighbours.js`). Highlighting is never a new state and never an edit.
- `effects.hovered.link` (`true | 'receive' | false`) makes the chart's hover the dataset's (`engine/hover.js`). Unset, it is on once a second chart draws the dataset; that count is read in `hoverLink` (`core/elicit.js`) and nowhere else. A row-wide hover (`hoverWide`: linked, or `others`/`neighbours` set on `hovered`) stamps every row node `hoverable` and lights the row in every mark over its table.
- A `hoverable` node that is not `editable` takes no press: dispatch routes it as a plane gesture.
- A text node gets no default outline (the cursor is its feedback). An outline the spec sets draws a measured box around it (`outline.requested`, set by `resolveState`).
- Anything drawn about a node copies its `angle`, and overlays stay concentric with their source so `markCenter` gives one pivot. Pick geometry `unrotate`s (`edit/pick.js`) before axis-aligned tests.

## Paint order and hit overlays

- `paintOrder` (`core/scene.js`) orders a glyph's nodes by row then part, and paints `raise`d nodes above everything.
- Hierarchy nodes are stamped `stack` (`Tree.paintRank`: a node, its contents, then its next sibling). Every mark over the node table sorts by it, so a node's box and label paint together and a label never shows through the node above it.
- A hit/grab overlay is a fallback: keep it beneath (`hitSel.lower()`), never `raise()` it.

## Motion

- Motion is eased drawing (`core/motion.js`), decided in the engine before the scene is handed to a renderer. Renderers never transition; both draw the nodes they are handed.
- Two clients, one clock. Rows before `build()` when the eased value is a real value of its column: the hierarchy's layout (`easeRows`, `liveTables` in `engine/render.js`), so links follow. Nodes after `build()` when it is not: a mark with `motion: true` (`easeNodes`, `engine/carry.js`), because a discrete scale has nothing between two slots. Never put an in-between value in a discrete column.
- A client opens a track (`motion.track(name)`) and steps keyed pixel values toward their goals. `update()` calls `motion.begin()` once and re-renders each frame until `motion.moving()` is false. Add a client, not a second clock.
- Only the drawing is eased. Never ease a committed value, and never ease what the pointer carries: `fixed` holds a key at its goal, `carried` draws it where the pointer holds it and is where it eases from on release.
- The carry is derived, never declared per edit: the grabbed row, on each axis one of its drag edits writes through a band or point scale (`isDiscrete`, never `scale.type`), in every `motion` mark over the table that binds the same field there. Dispatch records the stroke on `ui.grab` (`at`, `offset`, `handle`) and nothing else. A carried row is `raise`d until it is home.
- `geometryOf(node)` says what can be eased: the primitives in `NODE_GEOMETRY`, and a path that states how it was placed (`node.placed`, stamped by `shape`). Any other path is drawn at once and warns. A mark over a network's or hierarchy's `nodes` table is not eased by the node client (links dock from rows).
- Snap when goals are not comparable with the last ones: a scale or size change, a row-count change, data from outside (`chart.snapNext`, read once per frame for both clients).
- `spec.motion` is `false | { duration }` and keeps the clock; a mark's `motion: true` says it takes part. Reduced motion turns both off, and then nothing is carried either.

## Clipping

- The clip rect is computed only in `clipRect` (`core/scene.js`): plot rect grown by `clip: { pad }`. It goes to renderers as `RenderContext.clip` and to `clipVisible` (engine hit/tip pass, canvas hit test), so drawn and hittable can't disagree.
- Clipping turns on when any edit declares `viewport: true`; `spec.clip` overrides. Elements and `clip: false` marks are stamped `unclipped` and paint in the `chrome` bucket (`partitionScene`). That stamp is the only escape mechanism.

## Renderers

- The contract is `render(context)`, optional `supports` and optional `destroy()` (`Renderer` in `types.d.ts`). The engine calls nothing else and never branches on which renderer it has.
- A renderer declares what it does beyond drawing and pointer gestures in `supports` (`keyboard`, `textEditor`, `filter`, `overflow`). A spec that asks for an undeclared one warns (`warnRendererSupport`, `warnNoTextEditor` in `core/guards.js`). A new renderer-only feature is a new flag there, never a silent skip in a renderer.
- `chart.destroy()` calls `renderer.destroy()`. Anything a renderer holds outside one frame (window listeners, observers, caches) is released there.
- A renderer with no per-node DOM binds `renderers/pointer.js` (`bindPointerEvents`): geometric hit test, the gesture state machine, the cursor. Gesture thresholds and the wheel delta are in `renderers/shared.js`; no renderer keeps its own.
- The two renderers draw one look. A default one of them applies (text anchor, line step, corner radius, font fallback) is the other's too.
- On canvas an effect's `filter` goes through `throughFilter` (`canvas/draw.js`): the nodes are drawn on a spare canvas and filtered as one image, so a fill and its stroke are one shape.
- A gesture's `x`/`y` are the pointer in scene coordinates in every renderer. `_makeDrag` sets `.subject(event => ({ x: event.x, y: event.y }))` — d3.drag's default subject (the bound datum) displaces a rect's drag by its top-left. Never drop it or compensate in a mark.
- The D3 renderer raises the plane for plane-pick modes and lowers it when the mode flips back.

## Looks (experimental)

- A look restyles the finished drawing (`spec.looks`, `looks.*`, `core/looks.js`). It never changes data, a scale, or what the pointer hits. `scope` is `'marks'` (default: not `background`, `guide` or `effect` nodes) or `'frame'`; `inScope` is the one test.
- A geometry look (`kind: 'geometry'`) runs in `lookPass`, last, on `scene.children` only. `featureNodes` keep the true geometry, so picking, guides, motion and edits never see a look.
- A geometry look keeps every interactive node in the scene as an unseen hit target (transparent paint, its effect's `cursor`) and draws beside it. What it draws is stamped `rough` and `pointerEvents: 'none'` and carries no `featureId` or `index`. Its randomness is seeded by mark and row, never by frame, so a drag does not make the drawing shimmer.
- A shader look (`kind: 'shader'`) is a fragment defining `vec4 look(vec2 uv)` over premultiplied `u_frame`. `shaderSource` builds the full source; every renderer that runs shaders compiles that, so the uniforms and helpers in its prelude are the contract.
- A built-in shader moves no pixel further than `HIT_TOLERANCE` (4px), so drawn and hittable still agree.
- The canvas renderer runs shaders through one shared WebGL context (`canvas/gl.js`). Never create one per chart: browsers allow only a few.
- A renderer that runs shaders declares `supports.shaders`; anywhere else a shader look warns and the chart draws without it. A failed compile, a lost context and a tainted canvas each warn and skip.
- New look = `LOOK_OPTIONS`, its options interface, the factory (`warnUnknownLookOptions`), and a docs example on `/looks`.

## Themes and titles

- A theme is data (`core/theme.js`, `resolveTheme`). Named themes live in `core/themes.js` as partials (`theme: 'nyt'` or `{ extends: 'nyt', … }`), transcribed from Flint presets via `fromFlint` — add a preset as a Flint row, not hand-mapped tokens.
- An axis option and its `theme.axis` token share one name and resolve through `chromeOf` (option > `axis.discrete`/`axis.continuous` by `kind` > `axis`), read by both `measureTitle` and `build`. Per-tick functions are options only; the theme stays function-free so it deep-merges.
- A theme-requested grid is injected by `autoAxes` with an internal `auto` flag; grids go before axes.
- A new default must reproduce the old look exactly.
- `spec.title`/`subtitle`/`caption` go through `core/titles.js`: bands outside the legend bands, added to `effectiveMargins` in `update()`. The chart keeps its declared size; the plot shrinks. An axis title reserves its room via `Axis.measureTitle`. Never draw a title as a text mark.
- `strokeDash` (a constant, or a field via an ordinal scale onto `DEFAULT_DASHES`) is swept by `resolveStyle` onto `strokeDasharray`. No author-facing `strokeDasharray`.
- `gradient: { stops, direction }` on area/bar/rect → `node.fillGradient`, painted by both renderers; an effect restyle still wins.
