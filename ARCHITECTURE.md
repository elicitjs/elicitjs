# ElicitJS — Architecture

**This document is a summary of the architecture of the library.** It describes how ElicitJS is
layered, what each layer owns, and the invariants that hold the design together. For installation,
a first example, and how to run things, see [README.md](README.md). For the full public API with
live, editable examples, see the docs site in the sibling repo `../elicitjs-docs`.

ElicitJS is decoupled from any single rendering framework. It maintains an internal abstract
**scene graph** of shapes to draw, which a pluggable renderer (the default is D3/SVG) translates
into pixels.

---

## The core idea: an edit is the inverse of encoding

Every mark reads a **channel** surface: a channel is a constant (`fill: "red"`) or a data field through a scale (`y: { field: "n" }`). Encoding maps **data → visual**. An **edit** attached to a channel maps a **gesture → data**, back through the *same* scale. That symmetry is the whole model:

```javascript
schema: { n: { type: "quantitative", domain: [0, 100] } }   // what n IS
y: { field: "n", edit: drag() }
//   ── encode: n → pixel ──┘  └─ edit: drag pixel → n
```

Note what the channel does *not* carry. A field's **data type** and its **domain** describe the data, not one mark's view of it, so they are declared once on the spec's `schema`. The **scale** is then derived: a categorical field on a bar's x is a band (a bar needs the interval), on a dot's x it is a point (a dot wants the tick). Name a scale explicitly only when you want something else — `scale: "log"`, `scale: { type: "symlog" }` (log-like, but it spans zero and negatives, which `log` cannot), `scale: { type: "sqrt", range: [4, 20] }`, or a live `d3.scaleBand().padding(0.3)`, which is adopted as you built it. For a colour channel, set the palette with `scale: { scheme: "tableau10" }` (categorical) or `scale: { scheme: "RdBu" }` (a ColorBrewer diverging / sequential set — discrete for ordinal domains, a two-stop ramp for continuous; add `reverse: true` to flip direction), or a raw `scale: { range: [...] }`. For a value read against a reference — a difference, an error, a surprise — `scale: { type: "diverging", pivot: 0 }` gives each side of the pivot its own half of the ramp, so the pivot keeps the neutral colour even on a lopsided domain like `[-2, 10]` (one ramp stretched across both halves would put "neutral" at 4). The **`symbol`** channel is the same idea for glyphs: a category → an emoji / unicode shape through an ordinal scale, so any shape mark (`point`, `dotStack`, `waffle`) can draw a glyph in place of its circle/rect. Give it glyphs with `scale: { range: ["😢","😐","😊"] }` or a named `scale: { scheme: "faces" }`; edit the underlying category with `cycle()` / `legend()`.

---

## Layers

ElicitJS is layered for extensibility:

1. **Core engine (`elicit.Elicit`)** — the orchestrator (`src/core/elicit.js`). Deep-copies the spec's **one dataset** into a reactive store, resolves one **global scale per channel** (Observable-Plot model), rebuilds the scene each render, and routes gesture events to the matching edits. The unidirectional flow: `gesture → invert through scale → data-space proposal → data invariants → commit → re-render`.

   **One schema.** The schema is the contract of the elicited dataset: every field's measurement type and domain. It is what lets a chart resolve its scales and mint rows from *zero* starter data. Scales are resolved per channel by **unioning the schema domains of every field on that axis** — so an error bar's `mean`, `lo` and `hi` share one y axis that spans all three.

   **One dataset.** A chart elicits exactly one dataset — even a slider elicits a one-row dataset — so `data` lives on the spec, never on a mark. Each mark is a *view* over those rows: it encodes some columns, and where a channel carries an `edit`, it writes them back. Several marks over the same rows is the point, not a special case: a glyph is just marks that encode different columns of one row (see `composite`), and they all re-derive from the committed data on the next render.

   **Locked rows (`lock`).** Some rows are *given* rather than elicited — the record so far, the points already measured, last quarter's actuals. `lock: "seed"` fixes the rows the chart was seeded with while leaving every row an edit *adds* free; `lock: (d) => d.year <= 1990` locks rows by what they are. A lock is a property of the data, so it sits on the spec beside `data` and `schema`, and it has two halves, both automatic: a **dataset invariant** run last on every commit (so it outranks every other repair — a gesture that spans locked and free rows keeps its changes to the free ones and snaps the locked ones back; deleting a locked row is rejected), and a **pointer** policy (a locked row's marks aren't grabbable, show no editable cursor, and are skipped by proximity picking — so `nearest` / `sweep` / `draw` never target one). That last part is what makes a you-draw-it chart work: because the seeded line is invisible to picking, a drag beside it doesn't grab a frozen line, it starts drawing. `setData` re-seeds the chart, so it re-takes a `"seed"` lock. See the Locked rows docs page (`/editing/lock` in elicitjs-docs).

2. **Abstract scene graph (`src/core/scene.js`)** — a flat, layout-calculated collection of abstract nodes (`circle`, `rect`, `line`, `path`, `text`, `image`), independent of the DOM or any renderer.

3. **Marks (`elicit.plot.*`)** — pure data-to-geometry factories on a shared foundation (`src/plot/mark.js`): every mark resolves its channels through `encodeChannel` and the standard style surface (`fill`, `stroke`, `strokeWidth`, `opacity`, …) the same way. Marks compose across scale types and orientations.
   - `point` → `circle` or centred `rect` (`shape: 'circle'|'square'`; scatter; x/y/size/fill/stroke channels). An `angle` channel orients squares (and symbol glyphs) about their centre — circles are rotation-invariant. Add a `symbol` channel and it draws a glyph (emoji / unicode shape) per datum instead of a circle/square.
   - `ellipse` → a dot with **two independent radii** (`rx` / `ry`, falling back to `size`), so each is its own magnitude channel with its own field and its own edit — a shape that widens on one drag and flattens on another is two elicited numbers in one mark (per-axis uncertainty; a face's eye). Carries `angle`, and a rotated ellipse is hit-tested in its own frame.
   - `curve` / `curveX` / `curveY` → a segment that **bends**: a tick's chord plus a `curvature` channel, dimensionless (the apex's offset as a fraction of the half-chord, so it stays proportional when the span changes; positive bows to the LEFT of travel). `angle` tilts it about the chord midpoint and is baked into the geometry, because neither renderer rotates a path node. Emits the visible path plus a fat transparent HIT path (with a sampled `points` polyline, since the pick layer can't hit a bare `d`).
   - `face` → an expressive emotion glyph (Chernoff-style), and a **preset rather than a mark**: it returns a `composite` in **box mode** — a `point` head, two `ellipse` eyes, two `tickY` brows, a `curveY` mouth — each placed in the glyph's own local units. Its six params (`mouthCurve`, `mouthAsym`, `eyeScale`, `eyeSquint`, `browHeight`, `browTilt`) are channels forwarded to a concrete channel on one of those parts, so each is edited by **directly manipulating the feature** with the ordinary edits (`slide` on a curvature, a radius or a tilt, `move`/`resize` on the composite's own x/y/size) — there is no `edit.face.*`. Two params sharing a part (a brow's height and tilt) read different COMPONENTS of one drag — one on `axis: 'x'`, one on `axis: 'y'` — which is the rule for two edits sharing a mark. `face()` is the two-field emotion preset (mouthCurve ← valence, eyeScale ← arousal). Its centre is placed by x/y when present, so a plot of faces is a small-multiple or an emotion-space scatter.
   - `bar` / `barY` / `barX` → `rect` (band axis = category + thickness, linear axis = value — or an explicit start/end span via x1/x2 or y1/y2; orientation auto-detected). `stack: true` stacks the bars sharing a band on each other's cumulative total; the band IS the grouping, so there is no grouping option, and the series field (from `fill`, or named outright) only sets the order within a stack. A stacked bar takes the `edit.stack.*` family below.
   - `rect` / `rectX` / `rectY` → the generalized bar: each axis independently resolves a **span** (x1/x2, y1/y2), a **band**, or a baseline→value length, so a rectangle can span both axes (heatmap cells, 2-D regions, binned histograms). Carries `angle` like other geometry marks. `brushRect()` adds composable 2-D editing — grab an **edge** to resize a side, a **corner** for two extents, the **body** to move; `resize` (`'both'`/`'x'`/`'y'`/`'none'`) and `move` (bool) make it opt-in.
   - `tick` / `tickX` / `tickY` → `line` (a bar's zero-thickness sibling); optional `angle` rotates about the segment midpoint.
   - `text` / `textX` / `textY` → a per-datum `text` label (string at x/y; `text`/`fontSize`/`textAnchor`/`lineAnchor`/`dx`/`dy` raw, `angle` in math degrees, `format` a d3-format string or function for display). Editable like any mark: `drag` to reposition, a value channel sharing the label's field for a draggable numeric readout, `cycle`/`rotate`, or `editText()` to double-click-and-retype (an inline input; the renderer owns the keyboard lifecycle and emits a `commit` gesture).
   - `line` / `lineY` / `lineX` / `connectedScatter` / `path` → a connecting `path` per series plus one `circle` handle per datum; grouped by `series`, ordered by `order`.
   - `area` / `areaY` / `areaX` → a filled path per series (the distributional sibling of `line`), sharing its `series` / `order` / `curve` / handle machinery. Fills to the value axis's baseline — or, given an endpoint **pair** on that axis (`y1` + `y2`, or `x1` + `x2`), **between** them: the uncertainty band, a confidence interval or fan chart. That is the same span-vs-baseline split `bar` and `rect` make, spelled the same way, rather than a separate band mark forking this one. The pair shares the value axis's scale (so it resolves exactly like `y`), declaring one picks the value axis on its own, and **both** edges get handles — so the interval is elicited by dragging its ends. Pair with `ordering({ lower, upper })` so it can't be turned inside-out.
   - `rule` / `ruleX` / `ruleY` → a straight reference line at a data value (`y: { datum: 50 }`), or a **span** segment (a stem / whisker) between `y1`/`y2` (or `x1`/`x2`) at a category. An ordinary editable mark: put an `edit` on an endpoint and the cap becomes a handle.
   - `composite` → a **glyph**: a named group of ordinary marks as `parts` (a stem, a whisker, a dot, two caps). Composite-level `channels` (and style/`angle` shorthands) trickle into every part at desugar time — declare a shared `angle` / `x` / `fill` once; part keys win; inherited `edit`s attach to the last part only. Each part encodes some columns of the same rows; a part whose channel carries an `edit` is a handle. It desugars into its parts as plain features — `Elicit` flattens them — so nothing about a glyph reaches the engine. Drag one handle and the rest re-derive from the changed row (lollipop, error bar, rotating `+`). Because each handle is its own mark, dragging one cannot move another: dispatch already routes a gesture to the feature owning the node you touched. `group` is an alias.
     It has a second mode, **one rule apart**, for a glyph whose parts are placed relative to the glyph rather than to the data (a face's eye is not "at y = 0.16 of the data", it is "16% of the way up *this* face"). A part states a channel in LOCAL units (`frame: -0.4`, or the long `scale: 'frame'`) and the composite becomes a **box**: its own `x`/`y`/`size` place and size one per row instead of trickling down — x/y in `[-1, 1]` from the centre with **y up**, magnitudes as a fraction of the half-size, `angle`/`curvature` in their own units on a scale private to that part (which is how two mirrored brows take opposite ranges without colliding on a shared axis). A local part that states no x/y sits at the ORIGIN, so parts never repeat the composite's placement; a part with no local channel at all keeps its ordinary global build. Each local channel becomes a **real, invertible scale** (`createFrameScale`), stamped on the nodes as `node.frame`, so `move`/`slide`/`rotate`/`resize` invert through the very object that encoded — "an edit is the inverse of encoding" holds inside a glyph with no second inversion path. `resolveScales` skips a local channel before bucketing, so glyph geometry never widens an axis domain or conjures an axis. Box mode emits the **box** first (it feeds the global resolver the composite's own fields, and draws one invisible hit circle per row so an edit on x/y/size picks the whole glyph up) followed by the wrapped parts, each built once per row. What switches the mode is a part asking for local units — never a channel the composite happens to declare, since several plain glyphs set `x`/`y` on the composite precisely so the parts inherit them.
   - `dotStack` / `dotStackY` / `dotStackX` → a stacked dot plot (token counter): one datum per token, tokens sharing a slot stack into a countable column (drop with `create`, take back with `remove`).
   - `waffle` / `waffleY` / `waffleX` → a bar subdivided into a grid of uniform, touching cells (`rect` or `circle`) where one cell is a fixed quantity (`unit`); `value / unit` cells fill, laid out `multiple` across the band (auto-sized square, width ≤ bandwidth) — exact counting and proportion picking. Drive it with `edit.waffle.fill()`, which maps the pointer to the exact cell (row + column) and fills up to and including it, consistently for click and drag.
   - `needle` → a pivoted gauge/dial pointer (tapered path + hub). Encodes a value on `angle` (degrees via the channel scale; default range `[180, 0]` = left→right through the top). `orient: 'top'|'right'|'bottom'|'left'` (or `arc`/`start`/`end`) picks the semicircle — keep `scale.range` in sync. Optional `x`/`y` place the pivot on categorical or linear axes. Pair with `axisRadial` for chrome and `text` for a center readout.
   - `arc` / `pie` / `donut` → stacked angular slices (part-to-whole). Magnitudes on the `value` channel's field normalize to a full or partial circle; `innerRadius` makes a donut. (The magnitude channel is `value`, not `angle` — across the library `angle` means a rotation, and a slice's share is a quantity the layout turns into one.) Pass `edits: [edit.stack.cut(), edit.stack.edge(), edit.stack.merge()]` to cut a slice in two, drag a boundary, or merge two back together (see `edit.stack.*` below) — a pie divides a total the same way a stacked bar does.
   - `geoBasemap` / `geoTile` / `geoPoint` / `geoPolygon` / `geoLine` / `geoText` / `geoRect` → geographic marks for map elicitation. Chart-level `projection` (`"mercator"`, `{ type, domain, … }`, or a live d3.geo* instance) builds a shared `{ apply, invert, path }` context (not a 1D scale). **Basemap topology is a mark option** — `geoBasemap({ geojson: featureCollection })` (FeatureCollection draws one path per feature). Load your own GeoJSON (`fetch` / `import`) and pass it in; fit with `projection: { type: "mercator", domain: geojson }`. Editable lon/lat, GeoJSON geometries, coordinate lists, and geographic AABBs live on the **dataset**. Pair with `edit.geo.*`. `geoLine` reads its shape from its channels: `coordinates`/`geometry` → **one line per row** (a vertex list each, reshaped with `edit.geo.dragVertex`); `lon`/`lat` → **one path across the rows** in `order` (default `'sequence'`), grouped by `series` — the geographic connected scatter, the geo sibling of `path`. Put the dots on a sibling `geoPoint` and the trail re-derives as they're dragged. `geoTile({ url })` is a **raster** basemap — the Leaflet model, a pyramid of `{z}/{x}/{y}` images (OSM by default, or any tile server) laid behind the marks, keyed so on-screen tiles survive a re-render without re-fetching. It **requires `projection: "mercator"`**: a tile is a picture pre-baked in Web Mercator, so under any other projection it cannot register with the data — the mark verifies the projection by *behaviour* (probing that lon/lat land where the Mercator formula says, which rejects an equirectangular that agrees on the equator, and an oblique rotation) and warns instead of drawing a misaligned map. Attribution is a licence condition of every tile service and is drawn by default; public OSM tiles are rate-limited, so point `url` at your own server for production. `geoText` is the `text` mark with the projection doing the placement: position is the only thing a projection changes about a label, so it shares `text.js`'s node builder (`textNodeAt`) and inherits the whole text surface unchanged — `editText()` to retype content, `cycle()` for a categorical label, `rotate()` on `angle`, `dx`/`dy` to nudge the glyph off its anchor. Pair it with a sibling `geoPoint` over the same rows and dragging the dot carries the label. GeoJSON must use RFC 7946 ring winding: a reversed exterior ring reads to d3 as the polygon's *complement* (it "covers the globe"), which silently fits the projection to the whole world — `createProjection` dev-warns and names the offending features. `geoBasemap` / `geoTile` are **map chrome** (not ChartElements, not create targets): they stay pointer-transparent unless they encode dataset rows.
   - `trend` → an intercept-then-slope line: `{ intercept, slope }` with an intercept handle (translate) and a slope handle (rotate about the anchor), stageable via the edits.
   - Correlation fan / cone beliefs are composed as `widgets.lineCone` (a recipe over `trend` + stages), not a standalone mark.
3b. **Chart elements (`elicit.elements.*`, also aliased on `plot.*`)** — scale chrome, not data marks. They view a SCALE (`views: 'scale'`), take a singular `channel`, paint CHROME (not desugared channels), and their edits target the schema DOMAIN (`edit.axis.*`). See the `ChartElement` interface in `src/types.d.ts`.
   - `axis` / `axisX` / `axisY` / `grid` / `gridX` / `gridY` → composable axis & gridline chrome (or use the global `axes` convenience). Pass an `edit` to make an axis **interactive** — see `edit.axis.*` below.
   - `legend` / `legendColor` / `legendSize` / `legendSymbol` → scale legends (may reserve layout space).
   - `axisRadial` → circular / semicircular axis chrome (arc spine, ticks, labels, optional colored categorical bands). Sibling of `axisX`/`axisY`; reads the global `angle` scale. Optional x/y **placement** channels draw one ring per row (small-multiple needles) — a documented exception to “element has no channel map.”

4. **Edits (`elicit.edit.*`)** — a gesture that writes a channel back to the data. An edit is a small descriptor `{ gesture, channels, when, pick, scope, constrain, guide, apply }`, declared **co-located** on a channel (`channels.y.edit = drag()`) or at **mark level** (`edits: [...]`).
   - **Universal** edits (any mark): `drag`, `dragSpan` / `brushSpan` (move / edge-resize a 1-D span), `brushRect` (composable 2-D edge/corner/body editing of a rect's four extents), `resize`, `rotate` (pointer angle about the plot centre — or `pivot: 'mark'` — → a channel value; `fold: false` for full-circle dials; `pick: 'direct'` for a needle handle), `cycle`, `create`, `toggle` (click a slot to pick or un-pick it), `remove`, `editText` (retype a text mark's content), `rank` (drag to reorder a ranked slot), `legend` (click a legend swatch to set a discrete field — pair with `guides.legend()`, which shares its layout), `custom`.
   - **Line-scoped** edits, namespaced as `edit.line.*` so their scope is visible: `anchor` (add one point), `newSeries` (seed a whole line), `draw` (author a line by dragging), `sweep` (you-draw-it repaint), `removeSeries` (delete a whole line).
   - **Axis-scoped** edits, namespaced as `edit.axis.*` — the one family that writes the **schema's domain**, not a datum (they carry `target: 'domain'`): `edit.axis.scale()` drags a numeric/temporal axis's end-handle to grow/shrink its range (`mode: 'grow'` resizes the chart instead of rescaling in place); `edit.axis.categories()` adds / renames / removes categories on a discrete axis (reusing the `editText` inline-typing lifecycle; rename relabels matching rows, remove deletes them; `mode: 'grow'` grows the chart by one band-step per category instead of re-dividing it — e.g. extending a 5-point Likert scale to 7). The domain lives on the schema and scales re-resolve every render, so the grid, guides and marks reflow for free. Read the reshaped domain with `el.getSchema()`.
   - **Waffle-scoped** edit, namespaced as `edit.waffle.*`: `edit.waffle.fill()` fills a `waffle` up to (and including) the exact cell under the pointer — it reads the grid geometry the mark stamps on each cell, so it resolves row *and* column instead of rounding a 1-D value.
   - **Stack-scoped** edits, namespaced as `edit.stack.*`, for any mark that divides one total among a group of rows — a `bar` with `stack`, or an `arc`/`pie`/`donut`. Those are the same structure (a group partitioning a total along a 1-D parameter: data units up an axis, degrees around a ring), so one family serves both: `cut()` clicks inside a segment to divide it there, `edge()` drags a boundary to move value across it, `merge()` double-clicks one to fuse the two back together. All three preserve the group's total by construction — no `maintainSum` is involved, and none would help, since its modes sum over the whole dataset rather than the group a gesture landed in. Each interior boundary gets a grab handle (*n* segments → *n* − 1 handles; a pie's seam is the layout's fixed anchor); `handles: 'hit'` keeps them grabbable but invisible. The mark stamps `node.stack` — the group's members plus a pure-data geometry descriptor — and the edits invert through it, the same arrangement as a composite's `node.frame`. `edit.arc.edge()` is a deprecated alias of `edit.stack.edge()`.
     - A `cut` mints a row, and takes its category from the schema's **domain** rather than the keyboard: a closed domain hands out the values that group doesn't yet use and refuses the cut once they run out; `open: true` on the field makes the domain a starting set instead, so each cut appends a new category (and the seed-data out-of-domain check is skipped). That makes `cut` the one non-axis edit carrying `target: 'domain'` — it writes the schema and the rows together, and the engine commits both or neither.
   - **Geo-scoped** edits, namespaced as `edit.geo.*`: `drag` / `create` (lon/lat via `projection.invert`), `draw` / `dragVertex` / `removeVertex` (coordinate-list lines: author, reshape, simplify), `brush` / `createRect` (geographic west/south/east/north boxes). `brush` runs on the `geoBrush` driver — edge/corner/body, with the grabbed zone latched at **dragstart** and held for the gesture (re-deciding it per tick turns a move into a resize mid-drag), a body move translating by the geographic delta, and a dragend pass that un-inverts a crossed pair. They require chart `projection` and a `geo*` mark.
   - **Scope goes in the name.** A namespaced edit (`edit.line.*`, `edit.stack.*`, `edit.arc.*`, `edit.waffle.*`, `edit.geo.*`, `edit.axis.*`) needs the matching mark family, and each declares a `scope` naming the mark capability it requires. Attach one to a mark that lacks the capability and the engine dev-warns rather than leaving you with a gesture that silently does nothing.
   - `pick` selects the target: `direct` (the mark hit), `nearest` (closest within a threshold), `plane` (no target — create), or a driver lifecycle (`sweep` / `draw` / `brush` / `probe`). Multi-event lifecycles live in **self-describing drivers** (`src/edit/drivers/`) — adding an interaction mode is a new driver file, not an engine change. A driver usually serves plane-pick edits, but it may also claim a **direct**-pick edit by capability (a relative `slide` needs a dragstart anchor, not a target search): then `ctx.index` already names the datum and the plane stays down, so a lifecycle edit can sit on a glyph part beside other direct edits.
   - `pick: 'probe'` is the **probe / settle** flow: the pointer probes a value and the proposal follows the cursor as an inert **ghost** (the committed mark stays put — so nothing flickers, even on a matrix), and a **commit** settles it. Two gestures commit, so both natural expectations work — **move-then-click**, and **grab-and-drag** (press on the mark, drag, release). Any edit works this way. Preview and commit run the same `apply` + the same invariants through one code path, so the ghost cannot drift from what a commit writes — and a preview never reaches `onChange` or `getData`. The ghost is drawn by the engine's ghost pass (only the rows a proposal would change, styled by `theme.ghost`).
   - `when` arbitrates when several edits share a gesture (`elicit.when.alt`, `noAlt`, `shift`, `near`, `far`, …): e.g. plain click recolours, Alt-click deletes.
   - `stage` gates an edit to one step of a multi-stage elicitation ("first X, then Y"). It is a uniform filter applied to every edit — not a new mode. A `probe` click on a staged edit commits that stage's field and advances automatically (freezing it); you can also drive stages yourself with `setStage` / `nextStage`. See `trend` and `widgets.lineCone`.

5. **Constraints (`elicit.constraints.*`)** — **data-layer invariants**: pure rules over the dataset, run on every edit commit (never see pixels). They both *gate* a proposal (return `false` to reject) and *repair* it (return the corrected rows) — and since the rows are shared, a repair propagates to every mark on the next render. Declared on the spec (`constraints: [...]`, the canonical home) or on a mark as sugar, in which case the engine promotes it to the dataset so it still holds for **every** edit from **every** mark. Per-edit sugar is `edit.constrain`. Built-ins fall into three kinds — **bounds**: `clamp({ min, max, field })`, `snap({ field, step, origin })`; **cardinality**: `count({ max, strategy })`, `unique({ field, max })`, `maintainSum({ targetSum, field })`; and **shape**: `ordering({ fields })` keeps fields of a row in order (`lo <= mean <= hi`, so an interval glyph can't be dragged inside-out), `monotonic({ field, along, dir })` stops a curve reversing along an axis (a CDF that dips means negative probability mass), `spacing({ field, min })` keeps adjacent values a minimum distance apart. The shape rules **repair by pushing the neighbours aside**, holding the field you actually dragged — they know which one that is by diffing against the previous rows — so a crossed handle reads as the interval moving rather than as the handle sticking (`ordering`'s `mode: 'block'` rejects instead). Author your own with `constraints.define(reducer, meta?)` — write just the rule against a clean data context and return a number (set the field), object (merge), array (replace dataset), or `false` (reject).

6. **Guides (`elicit.guides.*`)** — non-interactive annotations, rebuilt every render so they track live data. `guides.rule` (reference line), `guides.region` (shaded band), `guides.proximity` (nearest-pick selection), `guides.custom(fn)` (draw arbitrary nodes from the render context). An edit's own constraint bounds + snap ring draw automatically when it declares `guide: true`. Guide nodes never capture the pointer, which is why the survey widgets' affordances live here.

7. **Format (`elicit.format.*`)** — display formatters for text marks (and anywhere a value is shown as a string). A mark's `format` option takes a d3-format string or `(v) => string`; helpers mint common ones (`format.number('.1f')`, `format.percent()`, `format.si()`, `format.time('%b %Y')`, `format.prefix('$')`, `format.suffix(' kg')`). Display-only — the underlying field stays the raw value.

8. **Widgets (`elicit.widgets.*`)** — higher-level named elicitations, each a pure recipe over the core API (no new interaction surface): `likert`, `multipleChoice`, `slider`, `matrix`, `lineCone`, `ranking`, `allocation`, `probabilityTokens`, `interval` (alias `ci`), `histogram`, `region`, `thermometer`, `labeledValue`. Each returns an **ElicitSpec** you pass straight to `Elicit(widgets.likert({…}))`. They share one option contract — `question`, `value`/`values`, `onChange`, `width`/`height`, `stage`, and `theme` — and look like survey instruments rather than charts (option rings, a cell grid, a track), but that styling is *only* the guide layer (`optionRings`, `cellGrid`, `sliderTrack`, `crosshair`), so each has a plain-chart twin built from the same mark, edit and constraint. Pass `theme: themes.survey` (or any partial) and the whole family restyles at once.

9. **Theme (`elicit.themes`, `setTheme`, `spec.theme`)** — the **style layer**: one data object of default colours, fonts, a `background`, and affordance tokens, deep-merged over the built-in `DEFAULT_THEME`. It supplies the *defaults* marks/chrome/renderers draw with (a per-datum paint channel still wins, and per-mark `theme.marks[name]` overrides sit in between). Resolved once per chart the way `effects` is (`spec.theme → resolveTheme → ctx.theme`, threaded to marks on the scale map), so it never adds a second style path. Built-ins: `themes.survey` (a professional survey look) and `themes.dark` (a self-contained dark mode — its `background` token paints the chart's own surface). `setTheme(partial)` sets an app-wide default. See `/theming`.

10. **Renderer (`elicit.D3Renderer`)** — draws the scene graph to SVG via D3, binding drag/click. Swappable for Canvas/WebGL/etc.

---

## Chart API surface

**Reading data out.** `Elicit(spec)` returns the chart element augmented with a small observation API: `getData()` (a deep copy of the committed belief dataset), `getSchema()` (a deep copy of the engine-owned schema, including any domain an editable axis reshaped — the caller's `spec.schema` is never mutated), `setData(data)` (seed/reset + re-render; also clears the undo history, since a reseed is a new starting point rather than an edit), and `on("change" | "stage", cb)` (subscribe; returns an unsubscribe). This is in addition to the spec's `onChange`.

**Taking it back.** `undo()` / `redo()` step through the elicitation's history, with `canUndo()` / `canRedo()` for a button's disabled state. The unit is a **gesture**, not a commit: a drag writes on every pointermove, so undo reverses the whole drag rather than replaying it backwards a pixel at a time. History is snapshot-based (an edit's `apply` is already pure, so the state before it *is* the undo — no edit describes its own inverse) and covers the schema too, so undoing a category-add puts the domain, the rows and the chart size back together. Both fire the ordinary `change` notification.

**Keyboard.** A pointer isn't the only way to say what you believe. Any mark carrying a direct-pick edit is focusable, and the arrow keys drive that same edit (Shift for a coarser step) — the renderer reports "one step this way" and the engine resolves it against the channel's scale into the pixel a pointer would have been at, so a step means *the next category* on a band axis and a fraction of the range on a continuous one. No separate keyboard edit exists, and each press is its own undo entry. Pair it with `snap` and the keyboard lands on exact stops. The browser's native focus ring is off by default (`focusOutline: false`); set `focusOutline: true` to show it (keyboard nudge still works either way).

**Sizing.** `width`/`height` are pixels by default (`responsive: "fixed"`). Set `responsive: "scale"` to wrap the SVG in a `viewBox` so the browser scales it to fill the parent (one draw, aspect ratio preserved), or `responsive: "reflow"` (alias `true`) to measure the parent and redraw at native pixels on resize (crisp text; width tracks the container, height stays the given value). A reflow chart wires a `ResizeObserver` — call `el.destroy()` when unmounting it. See the Responsive sizing docs page (`/sizing` in elicitjs-docs).

---

## Project structure

```text
elicitjs/
├── src/
│   ├── core/
│   │   ├── elicit.js       # Engine: state store, scale resolution, event routing, render loop
│   │   ├── lock.js         # Read-only rows (spec.lock): the invariant + the pointer policy
│   │   ├── axes.js         # Resolve the global `axes` convenience into axis/grid marks
│   │   ├── resolve.js      # Global per-channel scale resolution
│   │   ├── scales.js       # Scale wrappers (encode / invertValue) over d3-scale
│   │   ├── encoding.js     # Channel inference + invert primitives
│   │   ├── projection.js   # Chart geographic projection (apply / invert / path)
│   │   ├── tiles.js        # Slippy-map tile cover for geoTile (Web Mercator check + {z}/{x}/{y} placement)
│   │   ├── samples.js      # Domain sampling for line authoring
│   │   ├── effects.js      # Interaction-feedback layer (grab / select)
│   │   ├── theme.js        # Style layer: DEFAULT_THEME, resolveTheme, setTheme, per-mark defaults
│   │   ├── themes.js       # Built-in themes (default, survey)
│   │   └── scene.js        # Abstract scene graph
│   ├── plot/               # Data marks (mark.js = shared channel/style foundation)
│   │   ├── point.js · ellipse.js · curve.js · face.js · bar.js · rect.js · tick.js · text.js · line.js · rule.js
│   │   ├── composite.js             # glyphs: a group of marks, optionally a local box
│   │   ├── geo.js · needle.js · arc.js · polar.js
│   │   ├── dotStack.js · waffle.js · trend.js · trendBand.js · trendGeometry.js
│   │   └── axis.js · legend.js · axisRadial.js  # implementations (prefer elements.*)
│   ├── elements/           # Chart-element public barrel (axis / grid / legend / axisRadial)
│   ├── edit/               # The edit model
│   │   ├── basic.js        # Universal edits (drag/dragSpan/brushSpan/brushRect/resize/rotate/cycle/create/toggle/remove/editText/custom)
│   │   ├── line.js         # Line-scoped edits (anchor/newSeries/draw/sweep/removeSeries)
│   │   ├── axis.js         # Axis-scoped edits (scale/categories) — write the schema DOMAIN, not the dataset
│   │   ├── geo.js          # Geo-scoped edits (drag/create/draw/dragVertex/brush/createRect)
│   │   ├── when.js         # Arbitration predicates
│   │   ├── pick.js         # Target selection (nearest / proximity)
│   │   ├── route.js        # collectEdits / resolveChannels
│   │   ├── guide.js        # An edit's self-drawn guide (bounds + snap ring)
│   │   ├── shared.js       # makeEdit + datum/series helpers
│   │   └── drivers/        # Self-describing interaction modes (plane/nearest/sweep/draw/brush/brushRect/geoBrush/probe/axisDrag/slide)
│   ├── constraints/        # Data-layer invariants (define/clamp/maintainSum/count/unique/snap)
│   ├── widgets/            # Named survey instruments (likert/choice/slider/matrix/lineCone/ranking/allocation/…) + shared.js (contract) + theme.js (affordances)
│   ├── guides/             # rule / region / proximity / custom annotations
│   ├── format.js           # Display formatters (number/percent/si/time/prefix/suffix)
│   ├── renderers/
│   │   └── d3-renderer.js  # The default SVG renderer
│   ├── types.d.ts          # Type contracts for the whole API
│   └── index.js            # Public API aggregator
├── scripts/
│   ├── verify-browser.mjs  # Regression gate: Chromium over sibling elicitjs-docs
│   └── check-warnings.mjs  # Regression gate: zero [elicit] warnings on docs routes
├── vite.lib.config.js      # Library build → dist/elicit.js
└── package.json
```

Docs live in the sibling repo `../elicitjs-docs` (aliases `@elicit` → this package's `src/`).

Public packaging:
- `elicit.plot.*` — data marks (and temporary aliases for chart elements)
- `elicit.elements.*` — chart elements (axis / grid / legend / axisRadial); also `ElicitSpec.elements`

---

## Affordances, guides, and effects

Three visual statements, three homes (do not collapse them):

| Kind | Meaning | Home |
|------|---------|------|
| **Style** | what the data is | channels |
| **Guide** | what the RULE is | `edit.guide` — `bounds` / `catchment` / `track` |
| **Effect** | what is HAPPENING | `spec.effects` — `hovered` / `selected` / `grabbed` |

**Handle contract** (`handles` on every mark that draws a grip): `true` drawn+grabbable, `false` neither, `'hit'` invisible but grabbable. Axis/legend end-grips go through `resolveHandles` too.

**A glyph whose shape IS the control** (a face's eyes / brows / mouth) needs no `handles` option at all: each feature is its own mark, so the mark you can see is the thing you grab. `node.dm` remains the contract for a handle whose travel range isn't a scale, and a `composite` box stamps it for a positional local channel — so `guide: { track: true }` draws a range that is genuinely the mapping the edit inverts through.

**Proximity signifiers:** drivers with `selects: true` (nearest, sweep, brush*) auto-enable `catchment` when `guide` is omitted; set `guide: false` to silence, `guide: true` for bounds+catchment, or `guide: { … }` for the full grammar. Theme tokens: `theme.guide.bounds|catchment|track` and `theme.constraint.color`.

**Parametric glyphs** (`trend`, `trendBand`) and **map chrome** (`geoBasemap`, `geoTile`) are not create targets — document create-fitness per mark (see `MARK_CONTRACTS.md`).

---

## Docs (`../elicitjs-docs`)

A Next App Router site in the sibling repo `elicitjs-docs`, with **live-editable** examples (`react-live` editor + Reset to default). It is the project's only documentation — the older harness-based `docs/` tree was retired in favour of it.

**Everything for a page lives in its route folder.** `elicitjs-docs/app/marks/bar/` holds `page.mdx` (the prose, as markdown), `api.tsx` (the reference table, as JSX), and `_examples/*.example.txt` (the chart bodies — a bare `mount(Elicit({…}))` script each). The page imports its examples directly:

```mdx
import verticalBar from './_examples/a-vertical-bar-chart.example.txt';

<Section id="basics" title="Band × value">

The band axis slots the bars; the linear axis sets their length from a baseline.

<Example code={verticalBar} title="A vertical bar chart" blurb="x band, y value." />

</Section>
```

`_examples/` is a Next private folder, so it never becomes a route. The `.txt` extension is deliberate: it stops the bundler parsing a chart body as a module, which would inject dev HMR / `import.meta` into the string the editor evals. `elicitjs-docs/lib/nav.ts` is the sidebar; a page's in-page anchors are read from its `<Section>` ids. `@elicit` aliases `../elicitjs/src/index.js`, so every example on the site runs against the library source.

Two rules worth knowing before editing the docs UI:

- **Section ids are load-bearing.** `verify:browser` roots assertions at them with descendant selectors (`#band .chart > div`), so the id must stay on an element that *contains* the examples. That's why `<Section>` exists and why the MDX pipeline runs with **no remark/rehype plugins** — `rehype-slug` would move ids onto the `<h2>` and silently break ~20 checks.
- **Prose is JSX, not HTML strings.** `dangerouslySetInnerHTML` appears exactly once (the `getData()` panel, which formats its own HTML). Don't reintroduce it: rendering markup from a string is what made a whole class of "tags printed on screen" bugs invisible.

The docs are also the **test suite**: `npm run verify:browser` boots this site, evaluates every example, and drives real gestures against them.

**Reuse in another Next app** (e.g. a lab site): copy components from `elicitjs-docs/`, or (when published) import from a docs-ui export:

```javascript
import { DocShell, ExampleLive, Section, SITE, createElicitScope } from "elicitjs/docs-ui";
```

Chart surfaces are client components (`'use client'`); the lab page that embeds them must be a client boundary too.

---

## Roadmap

- Faceted / coordinated multi-chart layouts (compose multiple `Elicit` instances at the app level for now).
- Animation / alternate renderers (Canvas, WebGL).
- Needle uncertainty fuzz.
