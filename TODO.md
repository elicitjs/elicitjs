# TODO — deferred work

Deferred out of the pre-alpha API pass (see `git log` for the "one name per thing"
era). Each item records the DECISION and the reasoning, not just the task, so
picking one up later doesn't mean re-deriving why.

Not shipped in the package (`files` covers `src`, `dist`, README, ARCHITECTURE,
MARK_CONTRACTS, LICENSE).

---

## 1. `polygon` — a closed path

**Add a closed variant of `path`, and a `polygon` preset over it.**

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

**What is still worth fixing** (much smaller than the scale refactor):

1. **The implicit `lon`/`lat` read.** `geoPoint.build` does
   `const lon = channels.lon ? d[lonKey] : d.lon` — reading a column the spec never
   named. That is exactly the antipattern `categoryOf` warns about for every other
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

## 3. Registries (partially done — finish if the JSON layer starts)

`src/*/registry.js` gives each family a `name → { factory, options, … }` map, so a
JSON compiler resolves a keyword to a factory and validates its options from one
source. The option vocabularies exist already but are INLINE in each factory's
`normalizeMarkOptions(options, { mark, allow })` call, so they are not statically
reachable.

**Remaining work:** hoist the ~28 inline `allow` arrays into one exported const per
family (the precedent is `AXIS_OPTIONS` / `GRID_OPTIONS` / `LEGEND_OPTIONS`, which
already do this), then build the registry from them. No cycles: a plain
`options.js` with no imports, which both the marks and the registry read.

Value beyond the compiler: one source for the unknown-option warnings, the docs API
tables, `MARK_CONTRACTS.md` (generate it), and the JSON Schema.

---

## 4. Smaller, known

- **`node.dm` is stamped only by `composite`.** `guide: { track: true }` therefore
  does nothing on `axis`, `legend`, `needle` and every absolute `slide`, all of
  which draw a handle on a pixel track. Either stamp `dm` in `resolveHandles` where
  the travel range is known, or make `track: true` warn when the node carries none.
- **`Elicit(spec)` is a ~1500-line closure** holding ~60 inner functions. The next
  structural target after the surface work; no behaviour change, purely extracting
  the passes (`update`, the state pass, dispatch, the external-control API).
- **`grep` cannot search `dist/elicit.js`.** It is one 329KB line and grep silently
  finds nothing — which matters because CLAUDE.md's release checklist says to grep
  the bundle for `[elicit]` to confirm diagnostics survived. Use node:
  `node -e "const s=require('fs').readFileSync('dist/elicit.js','utf8');
  console.log(s.split('[elicit]').length-1)"`. Worth folding into a script.
- **`edit.axis.categories()` returns an array of three edits** — the only factory
  that does. Fine as an authoring act, but a JSON compiler needs it flagged as a
  macro so it expands uniformly rather than being special-cased.
