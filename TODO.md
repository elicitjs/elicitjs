# TODO — deferred work

Deferred out of the pre-alpha API pass (see `git log` for the "one name per thing"
era). Each item records the DECISION and the reasoning, not just the task, so
picking one up later doesn't mean re-deriving why.

Not shipped in the package (`files` covers `src`, `dist`, README, ARCHITECTURE,
MARK_CONTRACTS, LICENSE).

---

## 1. `polygon` — a closed path

**Add a closed variant of `path`, and a `polygon` preset over it.**

*Still open (checked 2026-11-10): no `closed` option on `line`/`path`, no `polygon`
export. `plot.shape` gained an outline `points` polygon and a point-in-polygon pick
(`polygon: true`), which is the interior-hit piece this item needs — reuse it.*

A polygon is currently only reachable through `geoPolygon`, which places its
vertices through the chart's `projection`. There is no way to elicit a closed
region in an ordinary cartesian chart — a lasso, a catchment, a hand-drawn area —
even though `path` already draws the open version of exactly that geometry
(`src/examples`' spatial-belief lasso is a `path` that visually wants closing).

**Shape of the change: an OPTION, with a preset name over it.** The repo's own
discriminator (CLAUDE.md, "Adding a new mark") is the DATA MODEL, not the visual:

> A new mark when the data model changes; an option when only the geometry does.

A closed polyline has the *same* data model as `path` — one row per vertex,
ordered by creation, both axes free. Only the geometry changes (the last vertex
joins the first, and the interior becomes fillable). So:

```js
path({ closed: true })      // the mechanism
polygon({ … })              // the preset, = path({ closed: true })
```

This is the precedent `pie` and `donut` already set over `arc`: a preset that fixes
one option and earns its own name because the thing it makes is worth naming. It
also keeps the JSON grammar honest — `polygon` is one keyword with one meaning,
rather than a second mark whose `build` duplicates `path`'s.

**Work:**
- `plot/line.js` — `closed` option on `buildLine`; join the last point to the
  first when set. Add it to the `allow` list.
- The connector node is already a `path` with `points`, so closing is a geometry
  change in one place. Keep emitting `points` (not `d`): a polyline is the only
  geometry `edit/pick.js` can measure, and it keeps the shape canvas-drawable.
- `fill` becomes meaningful — today `line`/`path` force `fill: 'none'` on the
  connector. A closed path should let the fill channel through.
- Export `polygon` from `plot/index.js`; declare it in `src/index.d.ts`; add a row
  to `MARK_CONTRACTS.md`.
- Docs: `/marks/line` gains a closed example; consider a `/marks/polygon` section.

**Check the hit path.** `distanceToMark`'s `'path'` case measures the min distance
over consecutive segments, so a closed path is picked on its OUTLINE. Decide
whether a filled polygon should also be grabbable in its INTERIOR — `hitTest`'s
`containsPoint` would need a point-in-polygon test, the same way `mark.sector`
handles a filled slice today. If yes, that is the one genuinely new piece of
geometry in this item.

---

## 2. Geo: keep it a separate family (decided), but close two real gaps

**Decision: `geo*` stays its own mark family with its own edits.** This reverses
the earlier plan to make the projection a scale and fold `edit.geo.move` /
`edit.geo.create` into the universal `move` / `create`.

**Why.** A geographic mark is a separate mark everywhere else in this design
space — Vega-Lite has `geoshape`, Observable Plot has `geo` — and readers arrive
expecting that. More importantly it is honest about the data model: a geo mark is
positioned by a PROJECTION, which is a 2-D map (lon, lat) → (x, y), not two
independent 1-D scales. Presenting it as "just channels" would hide a real
difference rather than remove one.

Under that reading, `edit.geo.*` is not a duplicate namespace at all — it is the
same "scope goes in the name" rule that already gives `edit.line.*`, `edit.stack.*`
and `edit.waffle.*` their families. `edit.geo.move` sits beside `edit.line.draw`
quite legitimately.

**What is still worth fixing** (much smaller than the scale refactor) — *both still
open as of 2026-11-10*:

1. **The implicit `lon`/`lat` read.** `geoPoint.build` does
   `const lon = channels.lon ? d[lonKey] : d.lon` — reading a column the spec never
   named. (Now spelled `fieldOf(channels, 'lon') || 'lon'` + `rawChannel`, in
   `geoPoint`, `geoLine` and `geoPolygon` alike; still silent.) That is exactly the antipattern `categoryOf` warns about for every other
   mark ("a mark places rows on the x axis but declares no x channel…"). Give the
   geo marks the same diagnostic: warn once, keep the fallback. `src/plot/geo.js`.
2. **`channels: null` on the geo edits.** It skips `resolveChannels` entirely, so
   the "an edit writes to a COLUMN" guard never runs on them. A geo edit should
   still resolve its lon/lat channels and drop any that aren't fields, so a geo
   chart can't grow a column literally named `undefined`.

Neither needs the paired-scale machinery. If the projection-as-scale idea comes
back later, it should be motivated by a concrete capability (e.g. wanting `select`
and `remove` to work on geo marks unchanged), not by symmetry alone.

---

## 3. Registries (half done — finish if the JSON layer starts)

`src/*/registry.js` gives each family a `name → { factory, options, … }` map, so a
JSON compiler resolves a keyword to a factory and validates its options from one
source.

**Done (checked 2026-11-10):** the option vocabularies are hoisted.
`src/vocabulary.js` (imports nothing) holds `MARK_OPTIONS`, `ELEMENT_OPTIONS`,
`GUIDE_OPTIONS`, `EDIT_OPTIONS`, `CONSTRAINT_OPTIONS`; every factory passes
`allow: MARK_OPTIONS.<mark>`, and `check:exports` + `test/allow-lists.test.js` hold
the lists to `types.d.ts` and to the factory bodies.

**Remaining work:** the `name → factory` half. No `registry.js` exists yet, so a
keyword cannot be resolved to a factory without importing the namespaces by hand.
Build it from `vocabulary.js`'s keys.

Value beyond the compiler: one source for the docs API tables, `MARK_CONTRACTS.md`
(generate it), and the JSON Schema.

---

## 4. Smaller, known

- **`node.dm` is stamped only by `composite`.** `guide: { track: true }` therefore
  does nothing on `axis`, `legend`, `needle` and every absolute `slide`, all of
  which draw a handle on a pixel track. Either stamp `dm` in `resolveHandles` where
  the travel range is known, or make `track: true` warn when the node carries none
  (`trackGuide` in `edit/guide.js` still skips such a node silently).
- **`Elicit(spec)` is one big closure** — `src/core/elicit.js` is ~2860 lines as of
  2026-11-10 (it was ~1500 when this was written, so it is growing, not shrinking).
  The next structural target after the surface work; no behaviour change, purely
  extracting the passes (`update`, the state pass, dispatch, the external-control
  API). Unblocked since the 0.1.0-alpha.0 release.
- **`edit.scale.categories()` returns an array of three edits** (it was
  `edit.axis.categories` when this was written) — the only factory that does. Fine
  as an authoring act, but a JSON compiler needs it flagged as a macro so it expands
  uniformly rather than being special-cased.

**Done, removed from this list:** "`grep` cannot search `dist/elicit.js`" — folded
into `npm run check:bundle` (`scripts/check-bundle.mjs`).

---

## 5. Stacked bars of COUNTS — an edit that changes the total

*Found 2026-11-10 while looking at the gallery's stacked-bar examples. Proposed, not
yet decided.*

**Rendering is already fine; the gap is interaction.** `bar({ stack: true })` stacks
in DATA units through the value scale — nothing normalizes it. The docs examples
only look full-height because they seed percentages summing to 100 against a
`[0, 100]` domain. Seed counts with a domain covering the largest total and you get
an ordinary count stack.

But every `edit.stack.*` edit PRESERVES the group's total by construction
(`src/edit/stack.js` header): `cut` splits, `edge` is a zero-sum swap between
neighbours, `merge` fuses. That is a budget/partition model. For counts ("how many
of each?") the total is itself part of the belief, and today:

- `edge` can never grow or shrink a column.
- The bar emits n−1 boundary handles; the stack's OUTER end is not grabbable, so
  there is nothing to drag that changes the total.
- **Unverified, possibly a silent-corruption bug:** a plain `move({ channels: ['y'] })`
  on a stacked segment inverts the pointer to an AXIS value — `baseline + value` —
  and would write that cumulative height into the field. Check this first; at
  minimum it should warn (`scope`/capability check), at best invert through
  `node.stack`.

**Proposed shape: a fourth stack edit** (name open — `edit.stack.extent()`?).
Dragging the boundary at the top of segment k sets that segment to
`pointer − its baseline`; every segment above shifts rigidly; the total changes by
the delta. The bar emits the top-end handle when this edit is wired.

Why a separate edit and not an option on `edge`:
- "Is the total fixed?" is a different behaviour → a different name (one name per
  behaviour).
- Both would claim the same handle with the same gesture, so a chart picks one
  anyway.
- It only makes sense on a `linear` stack geometry — a pie's total is a full turn —
  so it should decline `angular` stamps (a row in a capability table, not a branch).

**Open questions:**
- Ceiling: a growing stack can run past the schema domain. Clamping at the domain
  ceiling is simplest and matches "the schema owns the domain"; the alternative is
  growing the axis (cf. `edit.axis.scale`'s `grow` mode).
- Clamp each segment at ≥ 0.
- `cut` keeps its total-preserving meaning — still sensible on a count stack (split a
  count into two that sum to it).

**Work:** `src/edit/stack.js` (new edit + `INVERTERS` reuse), top-end handle in
`src/plot/bar.js`, `EDIT_OPTIONS` in `src/vocabulary.js`, options interface in
`types.d.ts` / `index.d.ts`, a counts example on `/marks/bar` in `../elicitjs-docs`,
and a `verify:browser` check (drag top segment → total grows, segments above ride).
