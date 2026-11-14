---
paths:
  - "src/edit/**"
  - "src/core/engine/dispatch.js"
  - "src/core/engine/compute.js"
  - "src/core/engine/stages.js"
  - "src/core/engine/selection.js"
  - "src/core/guards.js"
  - "test/drivers.test.js"
  - "test/edit-*.test.js"
  - "test/plane-fallback.test.js"
  - "test/control-plane.test.js"
---

# Edits and drivers

## The edit descriptor

- An edit is `{ type, gesture, channels, when, pick, scope, threshold, into, constrain, guide, apply }` built by `makeEdit` (`src/edit/shared.js`). `apply(ctx)` is pure: returns a datum (direct edit), a full array (whole-dataset edit) or `undefined` (no-op). Never mutate `ctx.data`.
- Declare capabilities: `cardinality` (`'append' | 'appendMany' | 'toggle' | 'delete'`) for creators, `inverts: true` if it runs the pointer through a scale (the dead-drag guard checks it). Never a list of type names.
- `computeEdit` returns one discriminated `EditResult` (`kind: 'rows' | 'domain' | 'selection'`), no sentinel keys.
- `resolveChannels` (`edit/route.js`) drops channels the mark doesn't encode as a field; otherwise a drag on a `{ value }` channel can write a column literally named `"undefined"` into the elicited data.

## Adding an edit

- Universal → `src/edit/basic.js`, top-level in `edit/index.js`. Mark-family-specific → its namespace (`edit.line.*` in `src/edit/line.js`) with `scope: 'line'`; `warnScopeMismatch` checks it against `SCOPE_CAPABILITY` in `core/guards.js`.
- Namespace by what the edit is about; set `scope` only when a real mark capability is required (`connect` has none; `rewire`/`reverse` need `supportsNetwork`; `edit.scale.categories` has `scope: 'scale'`, tested by `views`).
- A scoped edit's `type` is its dotted path (`edit.line.draw()` → `'line.draw'`). Bare types collided (`move` vs `geo.move`) and drivers claim by type; `check:exports` asserts this.
- Add options to `EDIT_OPTIONS` in `src/vocabulary.js` under the dotted type and an options interface in `types.d.ts`.
- Writing another table than the mark's → set `Edit.table` to the target role. `targetTableOf` is the one resolver; `ctx.data` (rows proposed) and `ctx.index`/`ctx.datum` (the touched row) stay apart.
- Reuse `schemaDefaults`, `nextSeriesKey`, `markCenter`; for proximity use `nearestMark`/`nearestSeries`/`nearestMarkOnAxis` from `edit/pick.js`.
- Keep create/remove symmetric, or make the gap deliberate.
- A discrete edit reads its domain via `discreteDomain` (falls back to the schema), not `ch.scale.domain()` alone.
- A custom edit that moves several columns of a glyph at once is wrong — use `follow` / `symmetric` / `ordering` constraints.
- No second name for an existing edit.

## Drivers

- A multi-event lifecycle (`hover`/`dragstart`/`drag`/`dragend`) is a driver in `src/edit/drivers/` (`{ name, wants(edit), onEvent(ctx) }`), registered in `drivers/index.js`. Never add an `if (pick === '…')` branch in `core/engine/dispatch.js`.
- `driverFor` gives each edit exactly one driver: exact `name === pick` beats `wants()`. `wants` is a capability predicate that never re-tests `pick`. `warnUnclaimedPick` reports a pick no driver claims.
- A driver may claim a direct-pick edit by capability (relative `slide`/`move`); `runDrivers` then hands it `ctx.index` and the plane stays down. Don't force an edit onto the plane when it only needs a dragstart snapshot.
- Sessions are per feature (`ui.session[featureId]`), shared by every driver on that mark. Each driver lists `sessionKeys`; the engine's `session.clear()` nulls exactly those. Never wholesale-clear.
- `Driver.options` declares the knobs it reads; `warnUnknownEditOptions` subtracts them.
- `targetsRow: true` (`nearest`, `sweep`) means the driver only chooses a row, so `el.control(name, i)` runs that edit directly on row `i`. Other plane edits warn on `control()`. Never emulate the plane with a synthetic gesture at the row's pixel.
- A sweep locks an edge; it doesn't run every edit on a band each tick.

## Dispatch and arbitration

- A drag fans to every direct edit on the touched feature. Two edits on one mark must read different components (x-slide + y-slide), or the first to apply wins. `rotate` is for things grabbed at arm's length; a tilt you grab on top of is a `slide`.
- A plane gesture fans to every feature's plane edits, so a whole-dataset edit belongs on one mark per table. `warnDuplicatePlaneEdits` groups by the table each edit writes.
- Plane arbitration (`livePlaneEdits`): the engine asks each plane edit's `when` on dragstart/click/hover and latches for the stroke. If none accepts, `hitTest` the pointer and re-route as a direct gesture (`fallbackHit`, also latched). A press on a mark whose direct edit accepts it grabs that mark first. Drivers never consult `when` themselves.
- A proposal is about a table: `ui.preview[featureId]` holds `{ table, rows }`, and with exactly one in flight the ghost pass rebuilds every feature over that table (`sole`). Don't narrow it to the owning feature — `connect` fires on a node mark but the link mark draws the rubber band.

## Pointer modes

- `move` defaults to absolute (required for plane/nearest picks); `move({ mode: 'relative' })` for marks with area, anchored per field at dragstart by the `move` driver, forcing `pick: 'direct'`. Never make relative the default.
- `slide` defaults to relative: the driver freezes `{ startPx, startValue }` per `${axis}:${field}` (`slideAnchorKey`). `extent` defaults to the frame's `frameExtent` inside a composite box.

## Cursors

- The cursor comes from the edits, never the node's shape (`edit/cursor.js`): a drag along x → `ew-resize`, along y → `ns-resize`, both or unknown → `move`; click → `pointer`; typed → `text`. The axis is the edit's travel `axis` (slide), else its resolved channels.
- Order on a node: the author's `cursor` option, the node's own `cursor` (a handle the mark knows better: a needle's `grab`), then the heuristic.
- An edit that acts on some of the mark's nodes declares `grabs(node)`, so the other nodes don't show its cursor.
- The raised plane's resting cursor: an edit's `cursor`, its `Driver.cursor` (draw → `crosshair`), the travel axis of row-targeting drags, else `pointer`. A session `cursor` overrides per hover.

## Axis edits, zoom, pan

- `edit.axis.scale` is `pick: 'direct'`, claimed by the `axisDrag` driver by type; the plane stays down.
- `edit.axis.zoom` is `pick: 'plane'` on `gesture: 'wheel'`; never raises the plane. Renderers report wheel (and prevent scroll) only when `RenderContext.hasWheel`. Ticks coalesce into one undo entry.
- `edit.axis.pan` has its own `pan` driver; each tick shifts by pointer travel since the last tick through the live scale (so a mid-drag zoom composes). Zoom and pan share `fitWithin`/`ceilingOf`.
- Both write the domain via `commitDomainEdit` — never a view transform. `el.setDomain(field, domain | null)` is the external twin (`null` restores `seedSchema`). Both declare `viewport: true`, which turns on clipping.
