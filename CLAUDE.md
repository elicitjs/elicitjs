# CLAUDE.md

Guidance for Claude Code when working in this repo. ElicitJS just went through a consistency pass that unified a previously-duplicated API surface (see `git log` for "API Consistency" era commits). The rules below encode the design decisions from that pass — follow them so the API doesn't re-fragment.

## What this is

A declarative viz library for interactive belief elicitation. `Elicit(spec)` renders an SVG chart where gestures write back to data. The core idea: **an edit is the inverse of encoding** — `encode` maps data → visual through a channel's scale; an edit's `apply()` maps a gesture → data through the *same* scale.

Entry points: `src/index.js` (public API), `src/core/elicit.js` (engine), `src/plot/mark.js` (shared mark foundation), `src/plot/composite.js` (glyphs, and glyph-local boxes), `src/edit/index.js` (edit barrel), `src/elements/index.js` (chart elements: axis / grid / legend / axisRadial). Read `ARCHITECTURE.md` and `MARK_CONTRACTS.md` before making structural changes (`README.md` is the short front door: what it is, install, one example, how to run it).

**Public namespace matches kind.** Data marks live under `elicit.plot.*`. Scale chrome lives under `elicit.elements.*` (also `ElicitSpec.elements`, concatenated with `marks`). The same factories stay aliased on `plot.*` during migration.

## Non-negotiable invariants

**The schema owns the data type and the DOMAIN; a mark owns neither.** A field's measurement type (`quantitative`/`categorical`/`ordinal`/`temporal`) and its domain describe the *data*, so they live once on `spec.schema`. A channel's `type` is the **data** type (an override for a field the schema doesn't cover), never a scale type. A channel's `scale` is the scale — a name, a `ScaleSpec`, a live d3 scale, or `null`. There is no `domain` or `range` on a channel. `resolveScales` picks a scale via `scaleTypeFor(channel, measure, discretePref)` and takes the axis domain as the **union of the schema domains of every field bucketed onto it** (`unionDomains`) — that union is why an error bar's `mean`/`lo`/`hi` share one y axis. Don't re-add a per-channel domain "just for this chart"; declare the field.

`src/core/schema.js` is the schema's OWNER — declaration, inference, creation defaults (`schemaDefaults`) and, since the consistency audit, VALIDATION. `validateDataset(schema, data)` runs once per `Elicit()` and per `setData()` and reports five things the library previously accepted in silence: `data` with no schema, a data column the schema doesn't declare, a `FieldSchema` with a domain but no `type`, a value contradicting its declared type, and a value outside its declared domain. Add a check there, not in a mark. Note what it deliberately does NOT check: a discrete field's runtime type, because any value can be a category key (a geo mark legitimately declares a GeoJSON geometry as `categorical`) — the domain is the real constraint for those.

**Never branch on `scale.type`.** `type` is a label. Control flow reads the capability flags `createScale`/`adoptScale` stamp on every scale: `kind` (`band` | `point` | `continuous` | `discrete`), `temporal`, `invertible`. A `log` scale behaves exactly like a `linear` one everywhere it matters, and a user-supplied `d3.scaleBand()` has no `type` at all — an allowlist of type strings silently marks it non-invertible, so the chart draws and **every edit on that channel dies with no error**. Adding a scale type means adding a case in `core/scales.js` and nowhere else.

**One dataset, whose STRUCTURE is declared. `Elicit` owns it; marks never do.** A
chart elicits exactly one dataset — even a slider elicits a one-row dataset. Its
STRUCTURE says what shape that dataset is: a set of named TABLES, each filling a
ROLE the structure defines (`core/schema.js`'s `STRUCTURES` — `table` has the one
role `data`, `network` has `nodes` and `links`). The engine holds them as
`tables` in `elicit.js`, and a mark is a *view* over exactly ONE of them
(`feature.table`): it encodes some columns and, where a channel carries an `edit`,
writes them back. Do not add a `data` (or `onChange`) option to a mark factory, and
do not reintroduce a per-feature data store keyed by feature id — that model made
two marks over the same rows impossible and is what forced `composite` to fake a
glyph inside one feature.

**A mark passes `id` / `edits` / `constraints` / `table` through VERBATIM, via
`markCommon(opts)`.** One helper, spread first in every factory's returned object,
because "a mark factory that accepts an option and drops it" has shipped here twice
now: `rule` silently dropped all four for a long time (a draggable whisker was
impossible), and `table` was added as a "universal" option that only `link` actually
honoured — every other mark warned "unknown option" and drew the primary table. Four
names in one place cannot drift the way four names in 29 places did. A key the mark
states itself after the spread still wins (`bar`'s `edits: markEdits`).

**Which TABLE a mark draws.** A mark is a view over exactly one table. `table:` names
it. With none, the mark takes the table filling its `tableRole` — `link` declares
`'links'`, every other mark leaves it unset and gets the structure's PRIMARY table.
The engine resolves this once, where features are flattened, and dev-warns on a name
the schema doesn't declare. NAMES go in `table:`; ROLES go in `tableRole` and
`Edit.table`. Chart elements (`views: 'scale'`) have no `table` — they draw a scale,
not rows. A `composite` stamps its table onto its box and every part, because it
desugars into features that each resolve their own.

**The reason structures were affordable is that a mark, an edit and a constraint
each still see ONE array.** The engine hands `tableOf(feature)` wherever it used to
hand the single dataset, so no mark's `build()`, no edit's `apply()` and no
constraint body changed. Keep it that way: if you find yourself passing a table map
into a mark or an edit, you are about to build the second data path. (`build`'s
optional 5th argument is the one exception, and it exists for `link` alone — a mark
whose geometry JOINS to another table.)

**`normalizeSchema` is the only place an author's schema spelling is read.** It
applies the three sugars (a bare field map is a single-table schema; a bare table
entry takes its role from its name; a bare-array `data` is the primary table) and
returns the canonical `SchemaSpec`. Nothing else re-sniffs the shape. `getSchema()`
and `getData()` DENORMALIZE on the way out, so a single-table chart still hands back
the bare field map and the bare array it always did — the canonical form must never
leak to a caller.

**NAME and ROLE are different things, and defaults resolve by ROLE.** The name is
the data key (`data.claims`); the role is what the structure means by it (`nodes`).
A mark states a table by NAME (`table: 'links'`) but resolves its default by ROLE
(`Mark.tableRole`), and `Edit.table` is a ROLE. That indirection is the whole reason
an argument map can call its tables `claims`/`supports` and write no `table:`
anywhere. Never hard-code `'nodes'`/`'links'` as a lookup key — go through
`byRole`.

**A `ref` is a data type, and referential integrity is not optional.** `type: 'ref'`
declares that a column names a row of another table by its key (`key: true`); its
domain is DERIVED from that column, so the two can never drift and a vocabulary is
never declared twice. `key` also makes `mintDatum` give every minted row an IDENTITY
(via `nextCategory`), because a row whose identity is null can be referenced by
nothing — which is a SCHEMA fact, so it belongs in the shared minting core and not in
an edit of its own. That is why there is no `addNode`: plain `create()` does it, on
any table under any structure. Because the schema declares the rule, the ENGINE enforces it —
`enforceRefs` drops rows whose reference no longer resolves after every commit, so
deleting a node takes its links with it. Don't reimplement that as a user-supplied
constraint: a constraint judges one table's rows and returns that table's rows,
while a dangling reference is created in one table and repaired in another.

**Whether a network is DIRECTED is the schema's statement, and it is TRI-STATE.**
`directed` sits on the LINKS TABLE (`normalizeTable`), because it says what an
ordered pair of that table's `ref` columns MEANS — not on a channel (it isn't
per-row) and not on the schema root (only one structure would ever read it). Read
it through `isDirected(spec)`, the one accessor, so `link`, `connect` and `reverse`
cannot disagree; never reach for the table yourself and never hard-code `'links'`.
`true` puts arrowheads on by default (`arrow: 'auto'`), bows every link to the same
side of its OWN travel so a reciprocal pair separates, and makes `reverse`
meaningful. `false` makes A→B and B→A the same edge, so `connect` refuses the
mirror and `reverse` warns. `undefined` — the default — is every chart written
before the flag existed, and must keep behaving identically; collapsing the three
into a boolean would silently grow arrows on existing specs.

**A connector's SHAPE is a row in `plot/linkGeometry.js`, never a branch in `link`.**
`LINK_SHAPES` is keyed by kind and each entry is `{ anchors, build }`, where `build`
returns `{ d? | points?+curve?, hit?, start, end, mid, tangentIn, tangentOut }` — the
same "declared capability, a row not a branch" shape `plot/stack.js` uses for its two
stack geometries. `anchors` says what the `seg` handed to `build` MEANS: `'chord'`
is the segment already pulled in by `inset`, `'box'` is the two node CENTRES plus
each node's half-extents. That distinction is declared rather than branched on
because a box-docking kind (`orthogonal`) insets along the EDGE NORMAL, not along the
chord, and must still route when a chord inset would have reported the whole segment
consumed. `start`/`end` are the shape's OWN endpoints, and the mark draws arrowheads
and endpoint handles there — pairing the segment's ends with a tangent that no longer
ran along the chord is what left a step's arrowhead sitting off the end of its line.
A node's rectangle reaches `link` as `nodeWidth`/`nodeHeight` read off the NODE row;
asking the mark that DRAWS the nodes what it drew would be a mark reading another
feature's built geometry, which is why `core/measure.js` owns `noteBox` — one sizing
rule, reachable from both marks and from a spec. `mid` is where a label sits
and the tangents are what an arrowhead points down, so adding `bezier` did not touch
the arrow code and adding the next kind won't either. Prefer `points` over `d`
wherever the shape allows: a polyline is the ONLY geometry `edit/pick.js` can
measure, so a `points` shape is proximity-pickable and canvas-drawable for free,
while a `d` shape must hand back a sampled `hit` polyline (`plot/hitpath.js`) or its
body is untouchable. `link` emits that hit path FIRST, beneath the paint — that is
what gives `edit.network.reverse` and a link-body `remove` something to land on.
Curvature is signed and dimensionless (an apex fraction of the chord), which is what
lets `separationBows` fan a pair apart with arithmetic and no layout.

**A whole-dataset edit belongs on exactly one mark PER TABLE.** A plane gesture carries no node, so it fans to *every* feature's plane-pick edits (`dispatchPlaneEdits`). Over one table that means `create()` on two marks appends twice per click, and two `rotate()`s rotate twice. `warnDuplicatePlaneEdits` groups by the table each edit WRITES, because two marks over different tables are not duplicates — a node mark's `create` and a link mark's own creator append to different arrays, and reporting them would make every network chart open with a warning telling you to delete one of two unrelated edits. Direct-pick edits are immune — they route to the touched node's feature alone. The engine dev-warns (`warnDuplicatePlaneEdits`) rather than branching; keep it that way. Sequential composition of *direct* edits within one event is intended: a coupled edit writes fields, sibling marks re-derive on the next render.

**A PROPOSAL is about a TABLE, so every mark over that table ghosts it.** `ui.preview` is keyed by feature id only so two probe marks can't clobber each other's parked proposal — it is not a statement about who *draws* one. A parked proposal carries the table it is about (`{ table, rows }`), and when exactly one is in flight, `update()`'s ghost pass builds every feature OVER THAT TABLE from it (see the `sole` fallback). Both halves are load-bearing: an edit may propose rows for a table its own mark doesn't draw (`edit.network.connect` fires on a node mark and proposes a link row), and it is the LINK mark that has to draw the rubber band. This is load-bearing for any glyph split across marks: `trendBand` reads a spread that `trend` carries the edit for, and keying the ghost to the editing feature alone left the band frozen until the click, with no feedback while the reader aimed. Don't "optimize" the ghost pass back to the owning feature.

**A mark is INERT until an edit names the column it writes.** No mark attaches an
edit of its own — not even one whose whole point is manipulation. `trend` used to
inject `edit.trend.intercept()` + `edit.trend.slope()` unconditionally and `face` an
internal (unexported, therefore unreplaceable) expression edit plus a `move`, so
`trend({ edits: [] })` was still fully draggable and nothing in the spec said which
columns a gesture would write. Which column an interaction writes is the one thing
the channel map exists to state, and a default that cannot be turned off is not a
default. Staging goes on the edit (`edit.trend.slope({ stage: 1 })`), never on the
mark. (`edit.face.*` was exported to make face's handles reachable; it is gone —
face is a `composite` of ordinary marks now, so its parameters take the universal edits.)

**Which shape is TYPABLE follows from where the edit sits, and the engine decides.**
`editText` declares `inline: true`; the engine's tagging pass flags every node of a
feature carrying such an edit as `node.editText`, and the renderer routes dblclick by
THAT FLAG rather than by the node being a `<text>`. Before this the text mark asked
its own edit list (`hasEditText`) and only a `<text>` could be typed into, which is
the wrong way round for anything whose typable surface is a BOX. A sticker puts
`editText` on its RECT and leaves the label inert — not a style preference: an edit
makes its feature's nodes pointer-active, and `edit/pick.js` gives a text node a hit
area of `fontSize + 4` about its ANCHOR, a disc sitting dead centre of the note. On
canvas, `hitTest` walks the scene in reverse, so that disc outranks the body and
dragging the sticker by its middle does nothing at all. Put the edit on the shape you
mean to grab and let the pointer-transparency pass silence the rest. Don't
reintroduce a mark that sniffs its own edits to decide, and don't branch on
`e.type === 'editText'` in the engine — read the capability.

That decision has a second half: **the editor OPENS WITH the column's current
value.** A node that paints text carries the string (`node.text`), but the node
that OWNS the edit may paint none — a sticker's typable surface is its box, whose
label is a sibling mark — so seeding from `text` alone opened the editor EMPTY and
turned every double-click into "retype the note from scratch". The same tagging
pass resolves the edit's channel to a field and stamps `node.editValue`; `text`
still wins where both exist, so a formatted label opens showing what it displays.
Caret placement follows the declared `multiline` capability, not the shape: a
single-line editor holds a NAME and opens selected (double-click-to-rename), a
multi-line one holds a paragraph you AMEND, where select-all means the first
keystroke wipes the note.

**A wrapped label is ONE node carrying `lines`, and `text` stays the whole string.**
Measurement lives in `core/measure.js` and nowhere else; its 2D context is created
LAZILY behind a `typeof document` guard, because the docs site imports the library at
module scope from a client component and Next server-renders it — a module-level
`document.createElement` throws in Node, and `check:warnings` reports that as a PASS,
since it only listens for `[elicit]` console output and a page that died server-side
emits none. Emitting one text node per line "works" and then costs a tab stop per
line, a hit disc per line, an effect outline around line one only, and an inline
editor seeded with a fragment instead of the paragraph. Keep the one-node-per-(feature,
index) invariant: `lines` is what gets painted, `text` is what gets edited.

**A mark declares what it needs from a scale (`Mark.requires`); it never degrades in
silence.** Silent degradation is the worst failure mode available here, because the
chart still draws: a waffle with no band scale quietly becomes 20px blocks over a
`[0,1]` domain, and a trend with a missing scale emits no nodes at all and reads as
"the spec didn't render". Declare the capability (`kind: 'discrete' | 'band' |
'point' | 'continuous'`, `mode: 'all' | 'any'`) and the engine's `warnScaleRequirements`
reports the mismatch. Declare a CAPABILITY, never a scale type — same rule as the
rest of the engine.

**GUIDES are rules; EFFECTS are states; neither may touch data-driven paint.** Three
kinds of visual statement, three homes: STYLE is what the data is (channels); a GUIDE
is what the RULE is (`edit.guide` — `bounds`, `catchment`, `track`); an EFFECT is what
is HAPPENING (`spec.effects` — `hovered`, `selected`, `grabbed`). `guide: true` used to
draw a rule AND a state, `effects.select` overlapped the second half, and every dash,
width and opacity was a literal with only `guideColor` adjustable. An effect paints
either as a CSS style PROPERTY on the element (which overrides the presentation
attribute `_applyStyle` writes, and vanishes cleanly) or as an overlay node tagged
`effect: true` — never as a paint attribute, which is how a grab highlight once wiped
a mark's own stroke. Hover has two sources — a proximity driver's session and the
renderer's per-node `pointerover` — and both feed the ONE `hovered` effect, so "this
is the mark you are about to touch" reads identically either way.

**The ENGINE's state pass decides an effect; a renderer only applies it.** Both halves
come out of the one loop in `update()`: the outline overlay, and the restyle, stamped
on the mark's own node as `node.effectStyle` (merged across states by `effectStyleFor`,
`grabbed` > `selected` > `hovered`). This rule exists because it was violated —
the D3 renderer painted the restyle half itself off its own `pointerenter`/`d3.drag`,
so `hovered: { fill }` lit up under a direct pick and stayed dark under a proximity
driver's hover of the same row, `selected: { fill }` did nothing at all, `grabbed` read
`filter` and dropped the other five props, and canvas had no element effects whatever —
while `core/effects.js` documented one uniform vocabulary for all three states. Which
half a property uses is fixed: `outline` is an overlay because it needs padding
OUTSIDE the shape; everything else restyles the node, because a copy drawn on top
cannot dim a mark (`opacity`, `filter`) and composites a `fill` wrongly over a
translucent one. **Anything drawn ABOUT a node must carry that node's `angle`** —
an overlay is a new node, so it lands at the mark's UNROTATED position unless it copies
the transform, and every overlay shape is kept concentric with its source so
`markCenter` resolves one pivot for both. Pick geometry has the same duty: `unrotate`
(`edit/pick.js`) brings the pointer into the mark's frame through `markCenter` before
any axis-aligned test, so what is outlined and what a drag grabs cannot drift apart.

**One handle contract.** `resolveHandles` (`plot/mark.js`) is where a handle's radius,
paint and visibility come from: `HANDLE_DEFAULTS.size`, `theme.handle`/`theme.handleStroke`,
and `handles: true | false | 'hit'` — drawn+grabbable / neither / invisible-but-grabbable.
Every mark that draws a handle takes both `handleSize` AND `handleColor`. Before this,
the radius defaulted to 4, 5 or 6 by mark and was hard-coded on axis and legend; the
colour was themed on some and a literal on others; and `handles: false` meant three
different things. A handle whose travel range isn't a scale declares it as `node.dm`
(the same descriptor `linearInvert` inverts through), which is what `guide: { track: true }`
draws — so the line the author sees IS the mapping, not a redrawing of it.

**A mark with no direct-pick edit is pointer-transparent.** The engine sets `pointerEvents:'none'` on such a mark's nodes unless the mark set a value itself. This is load-bearing, not cosmetic: the renderer defaults nodes to `pointer-events:auto` and draws lines *after* circles, so an inert rule (a glyph's whisker) sits above a sibling's handle and would swallow its drag. Don't "optimize" this away.

**One interaction model.** Everything routes through `edit` + drivers. Do not add a second parallel interaction system (an "interactors"-style layer) no matter how convenient it seems for one use case — that duplication is exactly what the consistency pass removed. If an edit needs new behavior, extend the `Edit` descriptor or add a driver; don't build a side path.

**Edits are descriptors, not closures with hidden state.** An edit is `{ type, gesture, channels, when, pick, scope, threshold, into, constrain, guide, apply }` built via `makeEdit` (`src/edit/shared.js`). `apply(ctx)` is pure given `ctx` — it returns a datum (direct edit), a full array (whole-dataset edit), or `undefined` (no-op). Never mutate `ctx.data` in place.

**Multi-event lifecycles are drivers, not engine branches.** If you're adding an interaction mode that needs `hover`/`dragstart`/`drag`/`dragend` state (like `nearest`, `sweep`, `draw`), write a new file in `src/edit/drivers/` implementing `{ name, wants(edit), onEvent(ctx) }` and register it in `drivers/index.js`. **Never** add a new `if (pick === '...')` branch inside `core/elicit.js`'s dispatch — that's the god-module pattern the drivers refactor eliminated. The engine must stay ignorant of specific modes. A driver is not the same thing as a raised plane: it may claim a **direct**-pick edit by CAPABILITY (`wants: e => e.type === 'slide' && e.mode === 'relative'`), and then `runDrivers` hands it `ctx.index` — the datum the gesture landed on — so it skips target selection and `needsPlaneOnTop` stays false. That is what lets a lifecycle edit sit on a glyph part beside the other direct edits; a relative `slide` needs a dragstart ANCHOR, not a target search, and conflating the two once forced every jump-free drag onto the plane.

**Two edits on one mark must read different COMPONENTS of the gesture.** A drag fans to every direct edit on the touched feature, which is intended (that's how a brow's height and tilt, or an eye's `rx` and `ry`, come off one gesture). It only works if they read orthogonal things: `slide({ axis: 'x' })` beside `slide({ axis: 'y' })`, or a positional `move({ channels: ['y'] })` beside an x-slide. Two edits reading the same component fight, and the loser is whichever applies first. Note the corollary for `rotate`: its sensitivity is the pointer's DISTANCE TO THE PIVOT, so on a glyph part — where you grab the thing at its own centre — a few pixels swing the pointer most of a half-turn and pin the value to a domain end. `rotate` is for a needle or a dial you grab at arm's length; a tilt you grab on top of is a `slide`, even though the channel is an `angle`.

**A gesture's `x`/`y` are the POINTER, in scene coordinates, in every renderer.**
Everything downstream assumes it: every edit inverts `ctx.pointer`, `edit/pick.js`
measures distance from it, a driver anchors to it. d3.drag's default subject is the
BOUND DATUM, so it reports `subject.x + (pointer - grabPointer)` — on a node that
happens to carry `x`/`y` the whole gesture arrives displaced by that node's own
coordinate. A circle carries `cx`/`cy`, so d3's `|| 0` guard made it look correct
everywhere it was tested; a rect carries its TOP-LEFT, so every drag on one reported
a pointer half a box up and left, `move` wrote that as the centre, and a sticker
jumped `(-w/2, -h/2)` the instant you pressed it — while the canvas renderer, which
sends the raw coordinate, did the right thing. `_makeDrag` states `.subject(event =>
({ x: event.x, y: event.y }))` for that reason. Never drop it, and never "fix" a
mark by subtracting its own geometry back out.

**A driver's session is PER FEATURE, not per driver, so a driver may only clear its
OWN keys.** One mark can carry two lifecycles at once — a network sticker has a
relative `move` AND `edit.network.connect` — and `runDrivers` hands both the same
`ui.session[featureId]`. Drivers run in registry order, so `session.clear()` on
dragend deletes whatever the driver after you was about to read: `move` shipped with
one and took `connect`'s `fromIndex` with it, so shift-drag drew the rubber band all
the way across and created nothing, then left the parked proposal ghosting forever
because `connect`'s dragend never ran. Namespace your state under one key and null
THAT (`session.set({ move: null })`). Nothing warns; both charts render.

**A mark with AREA needs `move({ mode: 'relative' })`, and the default stays
absolute.** Same pair as `slide`, for the same reason and with the same machinery (a
`move` driver freezing `{ startPx, startValue }` per FIELD at dragstart, claimed by
capability, so the plane is never raised). Absolute — the pointer's position IS the
value — is right for a point or a handle, and REQUIRED by a plane/nearest pick where
the gesture may begin nowhere near the datum it moves; that is why it stays the
default and why relative forces `pick: 'direct'`. It is wrong for anything you can
grab far from its centre: press a 140×40 sticker near a corner and an absolute move
teleports it. Don't make relative the default to "fix stickers" — it would silently
change every bar and dot chart already written.

**`slide` is RELATIVE by default, and that default is load-bearing.** Absolute mode reads the value off the pointer's POSITION on a track centred on the mark, so it is right only when the handle already sits at its value's place on that track (a dot on a rail). Anywhere else — an eye whose `rx` grows about a fixed centre, a brow that moves along the very axis it slides on — merely PRESSING the mark teleports the value, and a channel that moves the mark along its own slide axis feeds back and runs away. Both bugs shipped. Relative mode freezes `{ startPx, startValue }` per edit at dragstart (keyed `${axis}:${field}` via `slideAnchorKey`, so two slides on one feature don't clobber each other) and moves proportionally from there. `extent` — the drag distance that sweeps the domain — defaults to the frame's `frameExtent` inside a composite's box, so the gesture scales with the glyph instead of being a 120px constant that is enormous on a small face.

**Scope goes in the name.** An edit that only works on marks with series grouping (a `line` family capability) belongs under `edit.line.*` and must set `scope: 'line'` in its descriptor (the engine dev-warns on a scope mismatch — see `warnScopeMismatch` and the `SCOPE_CAPABILITY` table in `elicit.js`). A genuinely universal edit (works on any mark) stays top-level in `edit.*`. Don't add a mark-specific edit to the top-level namespace "because it's simpler" — that's the flat-namespace problem the namespacing fixed.

Note the namespace and the `scope` are separate decisions. `edit.network.*` is a namespace of two edits and only `rewire` sets `scope: 'network'` — it goes on a `link` mark, which declares `supportsNetwork`. `connect` goes on the NODE mark, which is an ordinary `point`/`rect`/`composite`, so there is no capability to check and setting a scope would only produce a false warning. Namespace by what the edit is ABOUT; scope only when a real mark capability is required.

**One positional-resolution path.** Every mark resolves a datum → pixel through `encodeChannel` (`src/plot/mark.js`) for its value axis, and a datum → CATEGORY through `categoryOf` for its category axis, before handing that category to the band-geometry helpers (`bandwidthOf`/`bandStartOf`/`baselineOf`/`isBand`/`isDiscrete` in `core/scales.js`). `categoryOf` exists because the band axis used to read `datum[key]` raw in every band mark, so `{ fn }`/`{ datum }` worked on a bar's value axis and were silently ignored on its category axis. It also owns the last-resort "column named after the channel" fallback (and warns when it is used), which used to be spelled `(channels.x && channels.x.field) || 'x'` four different ways — see `positionalKeys`, the one source of `xKey`/`yKey` now. Pass `index`/`data` to every `encodeChannel`/`resolveStyle`/`resolveSymbol` call: a derived `{ fn }` channel takes `(d, i, data)`, and ten marks used to hand it `undefined` for the last two. Do not call `scale(d[key])` directly in a new mark — that reintroduces the "four different ways to place a point" inconsistency that existed across `bar`/`dot`/`rule` before the cleanup. `core/encoding.js` once carried a whole *second*, unused resolution path (`resolveChannel`/`resolveEncoding`/`adjustDatum`/`assignChannel`/`datumFromPointer`); it was deleted. Don't grow another.

**`value` is visual space; `datum` is data space.** On a channel, `{ value: 25 }` is the output — it skips the scale, so on `y` it means pixel 25. `{ datum: 25 }` is in the field's own units and goes *through* the scale, so it lands where y = 25 is. Top-level constant shorthands (`fill: 'red'`, `size: 9`) desugar to `{ value }` via `normalizeMarkOptions`. Keep `SHORTHANDS` (what desugars) distinct from `STANDARD_STYLE_CHANNELS` (what `resolveStyle` sweeps onto a node): `size` belongs to the first only, because marks read it themselves.

**Diagnostics go through `core/dev.js`, are ON by default, and are never gated on a bundler flag.** `warn(key, message)` is the only way the library talks to a spec author; it adds the `[elicit]` prefix and dedups once per `key`. `setWarnings(false)` (exported from the package root) is the off switch, and a consumer's production build goes quiet on its own because `detect()` reads `process.env.NODE_ENV` — which must stay written in that literal form, since bundlers string-replace exactly that expression. **This rule exists because it was violated.** Every guard used to be gated on `const DEV = !!(import.meta.env && import.meta.env.DEV)`, duplicated in three modules. Only Vite injects `import.meta.env`, so all 14 diagnostics were dead on webpack/Next (including this repo's own docs site) and, because the constant folded to a literal `false`, Rollup stripped them from `dist` entirely. A diagnostic that only fires in the author's own bundler is not a diagnostic. Don't reintroduce a per-module dedup `Set` either — `warn`'s key does that.

**A guide is not a data mark.** `axis`, `axisRadial`, `grid` and `legend` set `views: 'scale'`: they draw a SCALE, not columns, so they carry no channel map and no fields of their own. Data marks are `views: 'data'` (the default). This is why `edit/route.js`'s `resolveChannels` drops a channel with no field for a data mark but falls back to `scale.fields[0]` for a guide — a legend legitimately has no field of its own. Read `views`, not the `isAxis || isGrid || isLegend` disjunction, when you mean "is this a chart element"; the specific flags stay for the cases that genuinely need to tell axes from legends. The contract is the `ChartElement` interface in `src/types.d.ts`. Because an element has no channel map there is nothing for `normalizeMarkOptions` to desugar, but there IS something to validate: call `warnUnknownElementOptions(name, options, ALLOW)` — the diagnostics half on its own. Routing an element through `normalizeMarkOptions` instead would be wrong in the other direction, since that accepts every style SHORTHAND (`dy`, `symbol`, `size`) on an axis. Both halves have an implicit spec layer: `axes` (`core/axes.js`) for the positional scales, `legends` (`core/legends.js`'s `autoLegends`) for the rest. `legends` defaults OFF where `axes` defaults on, because a legend reserves layout space.

**An edit writes to a COLUMN.** `resolveChannels` drops any channel the mark doesn't encode as a field, because every `apply()` ends in some form of `datum[ch.field] = value`. Without that, an edit on a constant (`{ value }`) channel writes to the key `undefined` — usually inert, but if another mark puts a field on the same axis the scale exists and inverts, and dragging appends a column literally named `"undefined"` to the elicited dataset. For a belief-elicitation library, silently corrupting the elicited data is the worst failure available; don't add a write site that skips this.

**One guide path.** `src/edit/guide.js`'s `buildEditGuide` is the only constraint-guide drawer. If you add a constraint, either let it fall through to no guide (acceptable for cardinality rules like `count`/`unique`) or add a case in `constraintGuide`'s switch — don't create a second standalone guide module that reads the constraint set independently.

**A STACK is one structure, not two marks' worth of geometry.** A stacked `bar` and a
`pie` both divide one total among a group of rows along a 1-D parameter — data units up
the value axis, degrees around a ring. `plot/stack.js` answers the three shared questions
once (`groupByPosition` — which rows form a group, and the ENCODING is the grouping, so
there is no `groupBy` vocabulary anywhere; `stackLayout` — shares and cumulative bounds in
DATA units, never pixels; `stackDescriptor` — what to stamp). The mark then stamps
`node.stack` and `edit.stack.{cut,edge,merge}` inverts through it, exactly as a composite's
`node.frame` lets the universal edits invert through the object that encoded. `geometry` on
that stamp is PURE DATA (`{ kind: 'linear', axis }` / `{ kind: 'angular', cx, cy, … }`),
never a closure: a commit re-renders, so the node an in-flight gesture holds is a frame
behind, and every stack edit re-derives magnitudes from live `ctx.data` each tick. The
pointer→cumulative inversion is a two-entry table keyed by `kind` (a declared capability,
like `KIND_SATISFIES`) — a third kind of stack is a row in it, not a branch in a mark. The
total is preserved by ARITHMETIC in every case; don't reach for `maintainSum`, whose modes
all sum over the whole dataset and would enforce the wrong invariant on a grid of donuts.

**A domain is a CEILING or a STARTING SET, and the schema says which.** `FieldSchema.open`
exists because a gesture that mints a category has to get the name from somewhere, and the
answer must not be the keyboard — a chart you can only build by typing is not elicitation.
Closed (the default, whenever a `domain` is declared) means the declared values are the
whole vocabulary: `edit.stack.cut` hands out the ones that GROUP doesn't yet use (not the
dataset — every band of a stacked bar holds its own copy of the vocabulary) and refuses
once they run out, and `validateDataset` reports a seed value outside it. `open: true`
makes it a starting set: the cut appends, and the out-of-domain check is skipped because an
unseen value is the declared behaviour. Naming is a SEPARATE act from creating —
`edit.axis.categories().rename` and `edit.cycle()` already cover it, so a cut mints a
placeholder and never blocks. Don't reintroduce a null-category path; a row whose identity
is null is one the user can only fix by typing.

**A domain edit's coupled `data` is still a datum proposal.** `computeEdit` routes
`target: 'domain'` before the dataset's constraints, which is right for the SCHEMA half — a
domain is not a datum, the same reason `setData` is trusted. It is wrong for the `data` an
edit couples to it (a rename relabels rows, a cut splices one in), so those rows now run
the invariants like any other proposal. Skipping them let a `count({ max })` be ignored by
exactly the edits that change how many categories exist.

**Constraints are pure data invariants, scoped to the dataset.** A constraint (`defineConstraint` in `src/constraints/define.js`) receives `{ data, oldData, activeIndex, active, field, value, domain }` — never pixels, never a scale used as geometry. It may *gate* a proposal (`false`) or *repair* it (return the corrected rows). The canonical home is `spec.constraints`; a mark's `constraints` is sugar the engine **promotes** into one dataset-wide set (`datasetConstraints`, deduped by identity), so an invariant holds for every edit from every mark. Don't scope a constraint back to the feature that declared it — that would let a glyph's cap drag bypass a rule declared on its dot. If a constraint's *guide* only makes sense for certain mark shapes (e.g. `maintainSum`'s cap-tick needs a band axis), guard the guide function, not the constraint itself.

## Adding a new mark

**First: is it a mark at all, or an option on one?** The discriminator is the DATA MODEL,
not the visual resemblance. `link` is its own mark because its geometry comes from a
JOIN — it draws a row of one table using positions held in another, which nothing else
here does and no option on an existing mark could express (`rule`'s span mode reads
its two endpoints off the SAME row). `dotStack` is its own mark beside `point` because one row is
one TOKEN and the stack offset is fixed token geometry (`2r + gap`), not a value scale —
the belief is `data.filter(d => d.bin === b).length`. `bar({ stack })` is an option because
a stacked bar keeps one row = one value and one rect per row; only the baseline moves, and
the offsets still go through the value scale. Same rule that keeps `bar` and `rect` separate
while `barY`/`barX` are one factory. A new mark when the data model changes; an option when
only the geometry does.

The contract is the `Mark` interface in `src/types.d.ts` (prose version at the top of `src/plot/mark.js`). Annotate your factory `@returns {import('../types').Mark}` — not `any`. Concretely:
- `build(currentData, scales, width, height) -> FeatureNode[]` is the one required method. `currentData` is the chart's dataset, handed in by the engine — the mark takes no `data` option and no `onChange`.
- Call `normalizeMarkOptions(options, { mark: 'yourMark', allow: [...] })`. `allow` is your mark's own option vocabulary on top of the universal ones (`channels`/`id`/`edits`/`constraints`) and the style shorthands; it drives the unknown-option warning, so an author's `color:` or a typo gets told rather than silently dropped into `...rest`. **Keep `allow` in sync when you add an option** — and note the warning is only as good as the list: a wrong entry produces a false positive, which is worse than none. `npm run check:warnings` is what catches that.
- Resolve position/style through `encodeChannel` / `resolveStyle` (value axis) and `categoryOf` (category axis) — don't hand-roll scale lookups or read `datum[key]` raw. Pass `index` and `currentData` to every one of those calls so a derived `{ fn }` channel gets its full `(d, i, data)`.
- Set `discreteScale: 'band'` (bar/tick — needs an interval) or `'point'` (point/line — needs a tick), and take `xKey`/`yKey` from `positionalKeys(channels)`. This says what the mark needs for *discrete* data; the schema says which fields are discrete. A mark that merely spans (like `rule`) should leave `discreteScale` undefined so a `composite` can stamp its own.
- Declare `requires` when your geometry genuinely needs a scale capability, rather than letting a fallback stand in for it (see the requires invariant).
- Stamp `markName: 'yourMark'`, so every dev message says `yourMark()` instead of the engine's positional `feature-3` placeholder.
- If you draw a handle, go through `resolveHandles` and accept `handles` / `handleSize` / `handleColor`. Where its travel range isn't a scale, stamp `node.dm` so `guide: { track: true }` can draw it.
- Return `edits`, `constraints`, `xKey`, `yKey` from the factory — VERBATIM. `rule` silently dropped all four for a long time, which made a draggable whisker impossible; `trend` and `face` went the other way and injected their own. If a mark accepts an option, it must pass it on unchanged.
- Don't set `pointerEvents` on your nodes to make them inert — leave it, and the engine silences any mark with no direct-pick edit (see the pointer-transparency invariant). Setting it yourself also disables the mark when it *does* carry an edit.
- If the mark groups points into series (a line-family mark), set `seriesKey`, `order`, and `supportsSeries: true` so line-scoped edits and the dev guard work.
- Export both a bare form (auto-detects orientation/axis) and, where the mark has a natural direction, `...X`/`...Y` variants — every directional mark in this codebase (`bar`, `tick`, `line`, `axis`, `grid`, `rule`) follows that pairing. Don't ship an asymmetric `ruleY`-with-no-`ruleX` again.

**Glyphs: prefer a group of marks over one clever mark.** If a glyph's handles map to distinct *fields* of a row, build it as a `composite` — a group that desugars into ordinary marks (`Elicit` flattens nested arrays in `marks`). Each handle is then its own feature, so direct-pick dispatch keeps a drag on one handle from touching another, and each handle edits a plain `y`/`x` channel. Only when several handles must live on **one** feature over **one** datum (their positions are *derived*, not fields — see `trend`'s intercept/slope, `area`'s span edges) do you need the `channel` node tag to arbitrate. Use `claimEdge(edit, name)` from `src/edit/shared.js` for that guard, never a hand-written `when: ctx => ctx.node.channel === '…'`: `claimEdge` rejects only a *differently* tagged node, so an untagged node (a mark-level edit spanning both handles) and an **absent** one still pass. That second case is load-bearing — a `plane`/`probe`-pick edit carries no node at all, so a guard that demands one silently kills every gesture on it. Reach for the whole pattern last; it was `composite`'s old shape and the parts-as-features form replaced it.

**A glyph whose parts are placed relative to the GLYPH is a composite in BOX MODE,
not arithmetic on a radius.** By default `composite` resolves every part through the
global scales, which is right for an error bar (its caps are values on the y axis) and
wrong for a face's eye ("16% of the way up *this* face"). A part states a channel in
LOCAL units — `frame: -0.4`, or the long `scale: 'frame'` — and `composite`
(`src/plot/composite.js`) gives it a per-datum box: the composite's own `x`/`y`/`size`
define that box per row instead of trickling down, and a local part that states no
x/y sits at the ORIGIN (so parts never repeat the composite's placement, which was a
line of boilerplate on every part of every glyph). The load-bearing decision is that a
local channel becomes a **real, invertible scale** (`createFrameScale` in
`core/scales.js`), stamped on every node it produced as `node.frame` — so `computeEdit`
overlays those scales and the universal edits invert through the very object that
encoded, per datum, with no second inversion path and no bespoke pixel tracks.
`'frame'` is a CHANNEL-side marker only: no resolved scale carries it, so nothing
branches on it, and `resolveScales` skips a flagged channel *before* `bucketOf` so a
glyph's internal geometry never widens an axis domain, demands a band, or conjures an
axis. Don't reintroduce a mark that computes pixel offsets from R and an edit that
un-computes them — that was the old `face`, and it is exactly the machinery this
replaced.

**What switches box mode on is a PART asking for local units — never a channel the
composite declares.** Reading "the composite has an `x`, so it is a box" is the
obvious shortcut and it is wrong: several plain glyphs (the `+`, the crosshair) set
`x`/`y`/`angle` on the composite *precisely so the parts inherit them*, and
reinterpreting that would silently turn a hub's `size: 6` into 6 × the box radius.
The discriminator is `frameSpecOf` over the parts' channels, which is exactly what
the old `group` used internally.

**The box is a real feature, and it DRAWS.** It emits one invisible circle per row
(`hit: true`, tagged `data-hit` by the renderer) beneath every part, so an edit on the
composite's own `x`/`y`/`size` has a node to grab and picks the whole glyph up —
including by the gaps between its parts. Before that it was `build: () => []`, so such
an edit was stripped with a dev warning and `face` hand-plumbed a duplicate channel
onto its head to get a grab target. It sets `pointerEvents` ONLY when it is grabbable;
otherwise it leaves the field alone so the engine's pointer-transparency pass silences
it, exactly like any other mark with no direct-pick edit. Setting it unconditionally
would let an immovable glyph swallow the plane gesture aimed past it.

**A glyph PAINTS as one object, even though it dispatches as several features.**
Array order is z-order and the engine builds feature by feature, so a composite's
parts would paint every row's part 1, then every row's part 2 — every sticker's
paper, then every sticker's text — and two overlapping notes come out interleaved,
the lower note's label sitting on the upper note's paper. `composite` stamps a
`glyph` key on every feature it returns and `paintOrder` (`core/scene.js`) orders
that group's nodes by ROW first, parts in declared order within a row. PAINT ONLY:
dispatch, picking, ghosting and data stay per FEATURE, which is what keeps a drag
on one part off its siblings. The box is the one exception inside the group — as a
`hit` node it stays at the bottom of it, the same rule as `hitSel.lower()`, because
a box covers its whole glyph and interleaved by row it would swallow every gesture
aimed at the row before it.

## Adding a new edit

- Universal (any mark) → `src/edit/basic.js`, exported top-level from `edit/index.js`.
- Line-scoped → `src/edit/line.js`, added to the `line` object export (`edit.line.yourEdit`), `scope: 'line'` set.
- Writing a table other than the one its mark draws → set `Edit.table` to the target ROLE. `computeEdit` then keeps `ctx.data` (the rows the proposal is about) and `ctx.index`/`ctx.datum` (the row the gesture touched) apart, and `targetTableOf` is the ONE place the destination is resolved — computeEdit and runEdit both read it, so a proposal can never be spliced over the wrong table.
- Build it with `makeEdit` from `shared.js`; reuse `schemaDefaults`/`nextSeriesKey`/`markCenter` rather than reimplementing them.
- If it needs proximity/target resolution, use `edit/pick.js`'s `nearestMark`/`nearestSeries`/`nearestMarkOnAxis` — don't write a second distance function.
- If it needs a multi-event lifecycle, see "Multi-event lifecycles are drivers" above.
- Create/remove should stay symmetric: if you add a new "build" primitive (like `anchor`/`newSeries`/`draw`), consider whether the corresponding "take apart" primitive exists (`remove`/`removeSeries`) or is a deliberate gap.

## Naming conventions to preserve

- `channels` is the mark's channel map (Observable Plot's word). `EditContext.markChannels` is that map as an edit sees it; `EditContext.channels` / `Edit.channels` are a *list of channel names*. Don't collapse the two.
- `type` is always a **data** type (`MeasureType`). A scale type is named by `scale`, or by `ScaleSpec.type`. The DATASET's shape is named by `structure`. The three vocabularies never share a key — `structure` is spelled that way precisely because `type` was already taken twice (`shape`, `kind` and `mode` are all taken elsewhere too).
- A structure's values are singular nouns naming the DATA's structure, never the visual: `table`, `network`, and later `hierarchy` / `matrix`. `network` rather than `graph`, because "graph" means "chart" in a viz library.
- `table` is a NAME (the data key, the author's word); `role` is what the structure means by it. A mark's `table:` takes a name; `Mark.tableRole` and `Edit.table` take a role.
- The structure, its edits and its capability flag share ONE word: `structure: 'network'`, `edit.network.*`, `scope: 'network'`, `supportsNetwork`. A driver keeps its own name (`connectDriver`) — that names a lifecycle, not a scope.
- `size` is a radius in px, on every mark. Not `r`, not `handleRadius` — those were three names for one idea. A sub-element's radius is `handleSize`.
- `fill` / `stroke` are the colour channels. There is no `color` channel (it used to mean a fill fallback on `point`/`line` *and* the label colour on `axis`).
- `series` is the public option name; `seriesKey` is the internal feature field. Don't introduce a third synonym.
- `pick` values are target-selection strategies or driver keys (`direct`, `nearest`, `plane`, `sweep`, `draw`) — not arbitrary interaction descriptors.
- `constrain` (edit-scoped, singular) vs `constraints` (plural, the dataset's invariants — canonical on `spec`, accepted on a mark as sugar and promoted) — keep the distinction; don't rename one to match the other.
- `guide: true` on an `Edit` means "self-draw"; a `Constraint.guide` is a drawer *function*. Same word, deliberately different shapes, both documented in `types.d.ts` — don't try to unify them into one meaning.
- Don't add a second alias for an existing edit (we removed `youDrawIt` as a redundant alias of `sweep`). One documented name per behavior. `edit.arc.edge` survives only as a deprecated wrapper that dev-warns — it IS `edit.stack.edge` under its old name.
- `marks` is the public spec key (`ElicitSpec.marks`) and the word used in docs and dev-facing warnings/errors shown to a spec author. `feature`/`FeatureNode`/`featureId` is the internal engine term for one flattened dispatch unit after `composite` desugars a glyph into parts — a mark can expand into several features. Don't blur the two into a single rename: the public surface and dev-facing messages say "mark," internal dispatch code and comments say "feature."

## Before committing a structural change

1. `npm run typecheck` (`tsc --noEmit` against `src/types.d.ts`) must stay clean.
2. `npm run verify:browser` must stay green. It boots the sibling `../elicitjs-docs` site, drives real Chromium, and asserts actual gesture outcomes. If you touched dispatch, marks, or edits, add a check there — the driver/session state machines only prove out under real pointer events, and every interaction bug this repo has shipped was invisible to typecheck. To drive a gesture by hand: `npm run dev` (or `cd ../elicitjs-docs && npm run dev`), then load the route.
3. `npm run check:warnings` must stay green. The second gate (there is still no unit-test suite): it visits every documented route under **Next.js/webpack** and fails on any `[elicit]` warning. Every docs example is a spec that should be correct, so a warning is either a broken example or a false positive in a guard. It found two examples passing `ruleY({ y: 50 })` — a form `rule` doesn't read — which had been drawing reference lines at a fallback position for a long time; `verify:browser` cannot catch that, because the page renders fine. Note what it does *not* prove: silence could also mean the diagnostics got disabled again, so after touching `core/dev.js` also confirm the warning strings survive `npm run build:lib` (grep `dist/elicit.js`).
4. **`../elicitjs-docs` is the documentation** (sibling repo). Update it if the public surface changed — the docs are the regression surface, and a feature with no page effectively doesn't exist. The old `docs/` tree was retired on 2026-07-16; don't recreate an HTML-and-harness docs site inside this library repo.
5. `src/types.d.ts` is the source of truth for shapes (`Mark`, `Edit`, `Constraint`, `FeatureNode`, `Session`, …) — update it alongside any descriptor change.
6. If you touched packaging, `npm pack --dry-run` must stay small (~0.6 MB). `files` once included the docs app, whose `.next` build output is 1.4 GB — the tarball was over 1 GB and the publish would simply have failed. Docs now live in `../elicitjs-docs` and must stay out of this package's `files`.

## Don't reintroduce

- A second interaction/dispatch system alongside `edit`.
- A `data` or `onChange` option on a mark, or a per-feature data store keyed by feature id.
- Constraints scoped to the feature that declared them rather than to the dataset.
- Direct `scale(value)` calls in mark `build()` instead of `encodeChannel`.
- A mark without style/encoding support "for the quick case" (this is how `dot` diverged from `point` before being folded back in).
- Engine code that branches on a specific `pick`/edit `type` outside the driver registry.
- A standalone guide or constraint-introspection module that duplicates `edit/guide.js`.
- A glyph that fakes several marks inside one feature and arbitrates its own handles, when a `composite` of real marks would do.
- A glyph-local position computed as pixel arithmetic on a radius, with an edit that reverses that arithmetic through a hand-rolled track. A composite box's local channel is a real scale; the edit inverts through it.
- A second glyph mark beside `composite`. Box mode IS the local-frame case; `group` is an alias.
- A discriminator for box mode read off a channel the composite DECLARES. Several plain glyphs set `x`/`y` on the composite so the parts inherit them; only a part asking for local units switches the mode.
- Two edits on one mark that read the same component of a drag, or a `rotate` on a handle you grab at its own pivot. `edit.network.connect` beside a plain `move` is the sharpest case yet — `move` drags the source node along under the pointer, so connect resolves the release back to the node it started from and creates nothing at all. `warnConnectConflict` reports it; the fix is `when.shift` / `when.noShift`, not removing one.
- A multi-event lifecycle that forces its edit onto the plane when all it needs is a dragstart snapshot. Claim it by capability and read `ctx.index`.
- A per-mark scoped edit namespace for a glyph whose parameters are plain fields on ordinary parts. (`edit.face.*` existed for exactly that and is gone.)
- A `domain` or `range` on a channel, or a `spec.x` / `spec.y` scale block. Domains live on the schema; scale config lives on `scale` (per channel) or `spec.scales` (per chart).
- A second reading of the author's schema spelling. `normalizeSchema` is the only one; everything downstream takes the canonical `SchemaSpec`.
- A hard-coded `'nodes'` / `'links'` / `'data'` table lookup. Resolve through `byRole`, or a table's name is not really renameable.
- A `domain` declared on a `ref` field, or a second list of node ids beside the key column. A ref's domain is derived.
- Referential integrity as a user-supplied constraint, or a constraint that returns rows for a table other than the one it was given.
- A bare row index used as a chart-wide selection key. `ui.selection` is qualified by table (node 3 and link 3 are different rows); the index-based public API means the PRIMARY table.
- A second glyph-joining mark beside `link`, or a mark that reads another FEATURE's built nodes. A join goes through the tables, not the scene.
- A connector shape written as a branch in `link.build()` instead of a row in `LINK_SHAPES`, or a second Bézier sampler beside `plot/hitpath.js`. A rounded corner IS a quadratic — it goes through `sampleQuadratic` with a smaller `samples`, and the result stays a `points` polyline so the pick layer and canvas keep working.
- A `link` that reads a node mark's drawn geometry to find its box, or a second copy of `sticker`'s sizing rule. `noteBox` (`core/measure.js`) is the one rule; `nodeWidth`/`nodeHeight` are how it reaches a connector.
- A link SIDE stored as data by default. `sourceSide`/`targetSide` are read raw like `curve`/`arrow`: a mark option or a `{ fn }`, and a column only when the spec names a field. A drawing preference does not belong in an elicited dataset unless its author put it there — and a side the READER drags would have to be a column, because `ui.*` is ephemeral and "an edit writes to a COLUMN".
- A link that emits only `d` when `points` would express it. The pick layer measures polylines; a `d`-only body is untouchable under both renderers.
- `directed` read off the links table directly, collapsed to a boolean, or moved to a channel or the schema root. `isDirected(spec)` is the one accessor.
- A renderer that reports a drag in anything but scene coordinates — d3.drag's
  default subject (the bound datum) is the one that bit us, and it reads as a mark
  that drifts from the pointer by its own geometry.
- `move({ mode: 'relative' })` made the default, or its dragstart anchor re-derived
  in `apply` instead of frozen by the `move` driver.
- A driver that calls `session.clear()` while another driver on the same mark holds
  state in it.
- A typable node with no box that leaves its editor to the renderer's label-shaped
  fallback. A path has no `x`/`y`, so the editor mounts at `NaN`; state `editBox`.
- A mark that hands its whole channel map to a LABEL it also draws. `resolveStyle`
  sweeps the style channels onto every node, so a link's 2px connector stroke
  outlined every glyph of its own text. Split by what the paint MEANS — the line's
  stroke, the label's fill — the way `sticker` splits box channels from label ones.
- A wrap width that isn't the box's own width when a sticker pins one. It crops one
  way and leaves dead paper the other, and the page renders fine either way.
- A second text-measurement path, or a measuring context created at module scope. `core/measure.js`, lazily, behind a `typeof document` guard.
- One text node per wrapped line. One node, `lines[]` + `lineHeight`; `text` stays the whole string.
- A mark that decides for itself whether its nodes are typable (`hasEditText`), or an engine branch on `e.type === 'editText'`. The `inline` capability, stamped by the tagging pass.
- `editText` on the label of a glyph whose typable surface is a box. It hands the label a hit disc dead centre of the shape and eats the drag — put it on the box and let the label go inert.
- An inline editor seeded from `node.text` alone. A typable node need not paint the
  string it edits; the column is the truth, and the engine stamps it as `editValue`.
- A discrete edit that reads only `ch.scale.domain()`. `scale: null` (a literal
  colour column) and a raw channel a mark reads itself resolve NO scale, so the
  click is a silent no-op — `discreteDomain` (edit/shared.js) falls back to the
  schema's declared domain, which is where a domain lives anyway.
- A creating edit that exists only to fill a column the schema already describes. `addNode` was exactly that, and `create` + `key: true` replaced it.
- A mark factory that returns `id`/`edits`/`constraints`/`table` by hand instead of spreading `markCommon(opts)`.
- A network-shaped preset that is secretly network-aware. `node()` is a dot with a label over whatever table it is pointed at; it reads no schema (a preset runs at factory time, before there is a chart to ask).
- A `scale.type === '…'` branch anywhere outside `core/scales.js`. Read `kind` / `temporal` / `invertible`.
- A second name for a field on a mark: `channels` is the only place a field is named. (`x` once meant a field name on `bar`, a constant on `rule`, a scale config on `spec`, and nothing on `point`.)
- A mark factory that accepts `edits` / `constraints` and drops them.
- A diagnostic gated on `import.meta.env.DEV` or any other bundler-specific global, or a `console.warn` that bypasses `core/dev.js`'s `warn()`.
- A `@returns {any}` on a mark factory. The `Mark` interface exists now.
- A second stack layout. One mark computing group membership or cumulative shares its own
  way, when `plot/stack.js` answers both — or an edit re-deriving a mark's layout from
  scratch instead of inverting through the `node.stack` the mark stamped.
- A `groupBy` option on any mark. The encoding is the grouping.
- A category minted as `null`, or any creator that can only be completed by typing.
- A glyph painted part by part, so every row's last part sits above every row's
  first. It reads fine until two glyphs overlap; group by `glyph` and order by row.
- A hit/grab overlay `raise()`d above the marks. It is a FALLBACK for a shape with no area
  to hit, so it must never outrank a node that really is drawn there (`hitSel.lower()`).
- Docs (`../elicitjs-docs`) or anything generated in `package.json`'s `files`.
- A mark that attaches its own `edit`. Inert until the spec names the column.
- `normalizeMarkOptions` with a `mark` but no `allow` — that silently disables every
  unknown-option check, and now warns. A chart element uses `warnUnknownElementOptions`.
- A raw `datum[xKey]` read for a category axis instead of `categoryOf`, or a fifth
  spelling of the `xKey`/`yKey` default instead of `positionalKeys`.
- A hard-coded handle radius or colour. `resolveHandles` + `theme.handle`.
- A literal dash/width/opacity inside a guide, or an effect written as a paint
  ATTRIBUTE. Guides resolve through `resolveGuide`; effects are CSS properties or
  overlay nodes.
- A second `hover` path for direct-pick marks. `ui.hover` and a proximity driver's
  session both feed the one `hovered` effect.
- A renderer that DECIDES an effect rather than applying `node.effectStyle` / the
  state pass's overlay nodes — that is the second painter, with its own source of
  truth, that made half the effects vocabulary a no-op.
- An overlay node (or a hit box) built beside a rotated mark without copying its
  `angle`, or a geometry test that skips `unrotate`. It draws/picks where the mark
  ISN'T, and the page still renders, so no gate but `verify:browser` sees it.
- A `fn:`-style warn key that collides with another module's namespace (`resolve.js`
  and `mark.js` shared `fn:<channel>` and silenced each other).
