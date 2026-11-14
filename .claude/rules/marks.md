---
paths:
  - "src/plot/**"
  - "src/widgets/**"
  - "src/core/measure.js"
---

# Marks and glyphs

The contract is the `Mark` interface in `src/types.d.ts` (prose at the top of `src/plot/mark.js`); per-mark contracts are in `MARK_CONTRACTS.md`.

## Mark or option?

Decide by the data model, not the look. A new mark when the data model changes; an option when only geometry does. `link` is a mark because its geometry joins another table. `dotStack` is a mark because one row = one token. `bar({ stack })` is an option because one row is still one value and one rect. `barX`/`barY` are one factory.

## Adding a mark — checklist

- Factory returns a `Mark`; annotate `@returns {import('../types').Mark}`, never `any`. `build(currentData, scales, width, height)` is the one required method.
- Spread `markCommon(opts)` first in the returned object — it passes `id`/`edits`/`constraints`/`table` through verbatim. Never return them by hand or drop one. A key stated after the spread still wins.
- Add options to `MARK_OPTIONS` in `src/vocabulary.js`, a `YourMarkOptions` interface in `types.d.ts`, and call `normalizeMarkOptions(options, { mark, allow: MARK_OPTIONS.yourMark })`. `mark` without `allow` disables unknown-option checks and warns. A wrong list entry gives a false positive; `check:warnings` catches that over the docs.
- Resolve position/style through `encodeChannel` / `resolveStyle` / `categoryOf` (see the scales rule).
- Set `discreteScale: 'band'` (needs an interval) or `'point'` (needs a tick). A mark that merely spans (`rule`) leaves it undefined so a `composite` can stamp one.
- Declare `requires` (`kind`, `match: 'all' | 'any'`) when the geometry needs a scale capability; `warnScaleRequirements` reports the mismatch. Declare a capability, never a scale type.
- Stamp `type: 'yourMark'`.
- Can it draw network nodes? Declare `nodeBox(row, index, rows, scales, width, height)` from the same channels `build()` reads.
- Series marks set `seriesKey`, `order`, `supportsSeries: true`.
- Orientation: answer through `resolveValueAxis` (`plot/mark.js`) with the `extent`/`single` arguments; take `orientation: 'horizontal' | 'vertical'` ('vertical' = value runs along y); export `fooX`/`fooY` as `foo({ ...o, orientation })` where there is a natural direction. Variants are spec keywords.
- Don't set `pointerEvents` to make a mark inert; the engine does it.

## Marks are inert

- A mark never attaches its own edit, not even a manipulation-focused one. Staging goes on the edit (`edit.trend.slope({ stage: 1 })`), never on the mark.
- A mark with no direct-pick edit gets `pointerEvents: 'none'` from the engine unless it set a value itself. Load-bearing: lines draw after circles, so an inert whisker would otherwise swallow a sibling handle's drag.

## Handles

- `resolveHandles` (`plot/mark.js`) is the one source of a handle's radius (`HANDLE_DEFAULTS.size`), paint (`theme.handle`/`theme.handleStroke`) and visibility. `handles: true | false | 'hit'` = drawn+grabbable / neither / invisible-but-grabbable. Every mark that draws a handle takes `handleSize` and `handleColor`. No hard-coded radius or colour.
- A handle whose travel isn't a scale stamps `node.dm` (the descriptor `linearInvert` inverts through), which `guide: { track: true }` draws.
- A node drawn only to be grabbed is stamped `rowHandle: true`; the engine drops it where no active edit reaches the row (locked, context, or not-yet-live stage). Don't stamp nodes that are the data's ink (a point's circle, a needle's hub). Gate on `handlesAreAffordance`: explicit `handles: true` on an uneditable mark draws the dots as ink.

## Counting marks (`waffle`, `dotStack`)

- Orientation comes from the channel map at factory time (`channels.y && !channels.x`), never from the scales in `build()` — `Mark.countAxis` sets the count scale's range before any build runs, and both must read the same value.
- `waffle` binds `count`; `unit` is the exchange rate (warn when the domain is not a whole number of units). `dotStack` binds nothing — one row = one token; `resolveScales` synthesises the scale from `countPitch` (`2r + gap`). Two marks because two data models.
- The count axis is opt-in (`axes: { count: true }`), built through `axis()` directly with its direction in its anchor (`axisX`/`axisY` would overwrite `channel`).

## Stacks

- `plot/stack.js` is the one stack structure for stacked bars and pies: `groupByPosition` (the encoding is the grouping — no `groupBy` option anywhere), `stackLayout` (shares and bounds in data units), `stackDescriptor`.
- The mark stamps `node.stack`; `edit.stack.{cut,edge,merge}` invert through it. `geometry` is pure data (`{ kind: 'linear', axis }` / `{ kind: 'angular', … }`), never a closure; edits re-derive magnitudes from live `ctx.data` each tick. The pointer → cumulative inversion is a table keyed by `kind`.
- Totals are preserved by arithmetic; don't use `maintainSum` (it sums the whole dataset).

## Text

- Measurement lives only in `core/measure.js`, with the 2D context created lazily behind `typeof document` (the docs site server-renders, and `check:warnings` can't see a server-side crash).
- A wrapped label is one node with `lines[]` + `lineHeight`; `text` stays the whole string. Never one node per line.
- A mark that also draws a label must not hand its whole channel map to it — split channels by what the paint means (`sticker` splits box from label).
- When a sticker pins a width, the wrap width is the box's own width.

## Shapes

- `plot.shape` draws one path per row from a `symbol` channel (d3 shape names or SVG path strings) or a `path` option. `plot/shapes.js` keeps unit form; `placeShape` bakes size, angle and position into `d`, plus an outline `points` polygon (`polygon: true`) and `cx`/`cy`. No `angle` on the node; never `d` without `points`. Declares `nodeBox`. `point` draws `symbol` as text and warns if it resolves to a path.

## Glyphs (`composite`)

- Prefer a `composite` of ordinary marks over one clever mark. Each handle is its own feature, so a drag on one doesn't touch another. Only when several handles must live on one feature over one datum (derived positions: `trend`, `area` edges) use the node `channel` tag, arbitrated with `claimEdge(edit, name)` from `edit/shared.js` — never a hand-written `when` on `ctx.node.channel` (a plane/probe edit has no node, and that guard would kill it).
- Box mode: a part that states a channel in local units (`frame: -0.4` or `scale: 'frame'`) puts the composite in box mode; the composite's own `x`/`y`/`size` then define a per-row box and local parts sit at its origin by default. The discriminator is `frameSpecOf` over the parts — never a channel the composite declares (plain glyphs set `x`/`y` on the composite so parts inherit them).
- A local channel is a real invertible scale (`createFrameScale`), stamped as `node.frame` so the universal edits invert through it. `'frame'` is a channel-side marker only; `resolveScales` skips it before `bucketOf`. Never compute glyph-local pixels from a radius and reverse them in an edit.
- The box draws one invisible `hit: true` circle per row beneath the parts, so an edit on the composite's `x`/`y`/`size` can grab the whole glyph. It sets `pointerEvents` only when grabbable.
- A glyph paints as one object: `composite` stamps a `glyph` key and `paintOrder` (`core/scene.js`) orders by row, then part. Paint only — dispatch, picking, ghosting stay per feature. The box stays at the bottom of the group.
- `ports` on a composite go to one feature (the box in box mode, else the first part declaring `nodeBox`).
- Presets (`node`, `sticker`, `face`) only compose ordinary marks; they offer nothing plain marks can't and read no schema. There is no `edit.face.*`.

## Typable surfaces

- `editText` declares `inline: true`; the engine flags nodes of a feature carrying it as `node.editText`, and renderers route dblclick by that flag. Never let a mark decide (`hasEditText`) or branch on `e.type === 'editText'`.
- Put `editText` on the shape you grab (a sticker's rect), not its label — a text node's hit disc sits dead centre and would eat the drag.
- The editor opens with the column's value: the tagging pass stamps `node.editValue`; `node.text` wins where both exist. Single-line opens selected; multiline places the caret.
- A typable node with no box (a path) must state `editBox`.
