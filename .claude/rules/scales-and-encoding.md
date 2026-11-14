---
paths:
  - "src/core/scales.js"
  - "src/core/resolve.js"
  - "src/core/encoding.js"
  - "src/core/axes.js"
  - "src/core/curves.js"
  - "src/plot/mark.js"
  - "src/plot/polar.js"
---

# Scales, channels and encoding

## Scale identity

- Control flow reads the flags `createScale`/`adoptScale` stamp: `kind` (`band` | `point` | `continuous` | `discrete`), `temporal`, `invertible`. A user-supplied `d3.scaleBand()` has no `type`, so a type allowlist marks it non-invertible and every edit on that channel silently dies.
- `resolveScales` picks a scale via `scaleTypeFor(channel, measure, discretePref)`.
- Positional channels union by axis (`axisOf`). Non-positional channels get one scale per encoding: `bucketOf` = `axisOf(ch) || scaleKey(ch, field)`, and `scaleKey` is the one place that key is spelled. Two marks stating the same encoding share one scale.
- Lookup is `scales[scaleKey(ch, field)] || scales[ch]` in `encodeChannel`, `resolveChannels` (`edit/route.js`) and `domainOfField` (`constraints/define.js`). The bare-channel alias is a deliberate, first-wins safety net (`tsc` can't see a missed key) — don't remove it or make it last-wins. `frameScales` (`plot/composite.js`) must publish under both keys.
- Never use `scale.fields[0]` to disambiguate.

## Colour

- `colorRange` (`core/encoding.js`) chooses by measure: `categorical` → distinct hues, `ordinal` → ordered ramp sampled per category, `quantitative` → continuous ramp. `ordinal` means ordered; a series key declared `ordinal` reads as shades.
- Two encodings on one channel take different scheme families so they don't both start at palette index 0. Index 0 defers to `theme.palette`/`theme.ramp`.
- `scaleTypeFor` is unchanged by this: an ordinal colour field is still an `ordinal` scale type; only its range is ordered.

## Coordinate families

- `axisOf` is a static channel → axis map. Never make it mark-aware; use a per-bucket hint instead.
- Cartesian: `x`, `y`, span partners `x1/x2`, `y1/y2`. Polar: `theta`, `theta2` (axis element `axisRadial`), and `radius`. Count: `count`.
- `radius` is a radial position whose pixel range the mark owns: the mark declares `Mark.radiusRange = { inner, outer }`, `resolveScales` accumulates it per bucket, and `channelRange` resolves it through `radiusExtent` — the same rule `arc.build` fits its ring with. Not legendable.
- `count` gets its own bucket (never unions with y). Its screen direction comes from `Mark.countAxis`, accumulated per bucket like `discretePref` and read by `channelRange`.
- `theta` is a position (a needle's bearing, an arc's sweep); `angle` is a rotation in place. `angle` is a style shorthand, not positional, not legendable. Whether `theta` is scaled is the mark's statement: `needle` scales it, `arc` lists it in `rawChannels` because it normalizes its own magnitudes.

## Offsets

- `xOffset`/`yOffset` nest a second category inside each x/y slot (grouped bar, dodged dot). They are not in `AXIS_OF`: own bucket per encoding (`OFFSET_OF`/`offsetParentOf`), no axis, range = one parent slot (`slotWidthOf`), fitted after the parent (`nestOffsetScale`), padding 0, `yOffset` runs `[width, 0]`.
- Marks read it via `categorySlot` (interval marks) or `encodeChannel` on a data-space `x`/`y` (positioned marks). Grouping follows position (a stacked bar groups by `[x, xOffset]`).
- The inverse is on the scale: `invertValue` takes an absolute pixel, finds the parent slot, inverts the remainder — so `create`/`toggle`/`move({ channels: ['x','xOffset'] })` need no offset code.
- A continuous parent has no slot: warn and ignore. No per-mark `group`/`dodge` option.

## Resolving a datum

- Value axis: `encodeChannel` (`plot/mark.js`). Category axis: `categoryOf`, then the band helpers in `core/scales.js` (`bandwidthOf`, `bandStartOf`, `baselineOf`, `isBand`, `isDiscrete`). Never call `scale(d[key])` or read `datum[key]` raw in a mark.
- `xKey`/`yKey` come from `positionalKeys(channels)` only. `categoryOf` owns the "column named after the channel" fallback and warns when it's used.
- Pass `index` and `data` to every `encodeChannel`/`resolveStyle`/`resolveSymbol` call — a `{ fn }` channel takes `(d, i, data)`.
- `{ value }` is visual space (skips the scale); `{ datum }` is data space (goes through it). Constant shorthands (`fill: 'red'`) desugar to `{ value }` via `normalizeMarkOptions`. `SHORTHANDS` (what desugars) ≠ `STANDARD_STYLE_CHANNELS` (what `resolveStyle` sweeps): `size` is only in the first.
- Three tiers: a channel is scaled (`encodeChannel`); a raw channel is per-row and unscaled (`rawChannel`, and must be listed in `Mark.rawChannels` or a needless global scale is built); an option is constant. One name has one tier on every mark (`curve` is a raw channel everywhere, with the constant as fallback). On a line-family mark a raw channel resolves per series against its first row.
- A missing value (null/NaN) breaks a line or band and draws no handle (`core/curves.js`, `defined`). No option for it.
- Don't grow a second resolution path; `core/encoding.js` once had one and it was deleted.
