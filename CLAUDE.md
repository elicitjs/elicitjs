# CLAUDE.md

ElicitJS is a declarative viz library for interactive belief elicitation. `Elicit(spec)`
renders an SVG (or canvas) chart whose gestures write back to data. The core idea: **an
edit is the inverse of encoding** — `encode` maps data → visual through a channel's
scale, and an edit's `apply()` maps a gesture → data through the same scale.

Read `ARCHITECTURE.md` (layers, project structure) and `MARK_CONTRACTS.md` (per-mark
contracts) before a structural change. `CONTRIBUTING.md` covers publishing. The
documentation is the sibling repo `../elicitjs-docs` — follow its `STYLE.md` for any
docs prose.

Detailed design rules live in `.claude/rules/`, scoped by path so they load only when you
touch that area: data/schema, scales/encoding, marks, network, edits/drivers,
constraints, guides/effects/rendering, elements/legends, public API.

## Entry points

- `src/index.js` — public API. `src/index.d.ts` / `src/types.d.ts` — the source of truth for shapes.
- `src/core/elicit.js` — engine entry; wires `src/core/engine/` (`tables`, `features`, `nodes`, `stages`, `selection`, `history`, `compute`, `dispatch`, `render`, `api`).
- `src/plot/mark.js` — shared mark foundation. `src/plot/composite.js` — glyphs.
- `src/edit/index.js` — edits; `src/edit/drivers/` — multi-event lifecycles.
- `src/elements/index.js` — axis / grid / legend / axisRadial.
- `src/vocabulary.js` — every factory's option list (imports nothing).

## Commands

Run all of these before committing a structural change:

```bash
npm run typecheck && npm run check:exports && npm test && \
npm run build:lib && npm run check:bundle && \
npm run check:warnings && npm run verify:browser
```

- `npm test` — vitest unit tests in `test/`.
- `npm run check:exports` — runtime exports ↔ `src/index.d.ts`, both directions; option interfaces ↔ `vocabulary.js`; scoped edit `type` = dotted path.
- `npm run gen:types` — regenerates `src/authoring/index.d.ts` from JSDoc. Never hand-edit that file.
- `npm run check:warnings` — visits every docs route under Next/webpack and fails on any `[elicit]` warning. A warning is either a broken docs example or a false positive in a guard.
- `npm run verify:browser` — boots `../elicitjs-docs`, drives real Chromium pointer events. If you touched dispatch, marks or edits, add a check here: interaction bugs are invisible to typecheck. A single red route that passed earlier in the same run is dev-server noise; re-run first.
- `npm run dev` — docs dev server, for driving a gesture by hand.
- After touching `src/core/dev.js`, confirm warnings survive the build with node (grep on the one-line bundle reports nothing):
  `node -e "const s=require('fs').readFileSync('dist/elicit.js','utf8'); console.log(s.split('[elicit]').length-1)"` — expect ~18, never 0.
- If the public surface changed, update `../elicitjs-docs` too; a feature with no docs page effectively doesn't exist.

## Three kinds of feature

Everything the engine builds is a feature, and each declares what it `views`:

| `views`   | Namespace              | Spec key   | One node per        | Writes              |
| --------- | ---------------------- | ---------- | ------------------- | ------------------- |
| `'data'`  | mark — `plot.*`        | `marks`    | a row               | rows                |
| `'scale'` | element — `elements.*` | `elements` | a tick / swatch     | the schema's domain |
| `'state'` | guide — `guides.*`     | `guides`   | a derived statement | nothing             |

All three share one `build(rows, scales, width, height, ctx)` signature. Read `views`,
not an `isAxis || isLegend` disjunction, when you mean "is this a chart element".

## Rules that apply everywhere

- **A grammar namespace contains only spec keywords.** `plot.*`, `edit.*`, `constraints.*`, `guides.*`, `elements.*`, `widgets.*` hold only what can appear in a spec; building blocks (`encodeChannel`, `makeEdit`, `registerDriver`, …) go in `authoring.*`. A planned JSON layer compiles keywords to factories, so namespace members become keywords.
- **One name per thing.** No aliases, no deprecated wrappers (the library is unreleased; there is nobody to deprecate for). "Author your own X" is `custom` in every namespace.
- **The schema owns a field's data type and domain** (`spec.schema`, `src/core/schema.js`). A channel never carries `domain` or `range`; a channel's `type` is a data type, its `scale` is the scale.
- **Never branch on `scale.type`.** Read the capability flags `kind`, `temporal`, `invertible`. A new scale type is a case in `core/scales.js` only.
- **`Elicit` owns the one dataset; marks never do.** No `data`/`onChange` option on a mark, no per-feature data store. Marks, edits and constraints each see one array (`tableOf(feature)`).
- **One interaction model: `edit` + drivers.** No second interaction system, and no engine branch on a specific `pick` or edit `type` — that is what drivers are for.
- **An edit writes a column.** Silently corrupting the elicited data is the worst failure available; never add a write site that skips `resolveChannels`.
- **Constraints are declared only in `spec.constraints`.** Never on a mark or element, never scoped to a feature.
- **An option never names a data column.** `channels` is the only place a mark names a field.
- **Capabilities are declared, never allowlisted by type** (`cardinality`, `inverts`, `requires`, `inline`, `viewport`, …).
- **No silent degradation.** If a mark or edit can't do what the spec asked, warn — a chart that still draws hides the bug.
- **Diagnostics go through `warn(key, message)` in `core/dev.js`**: `[elicit]` prefix, dedup by key, on by default, off via `setWarnings(false)` or `process.env.NODE_ENV` (keep that literal spelling — bundlers replace it). Never gate on `import.meta.env.DEV` or call `console.warn` directly.
- **Every feature kind carries `type`** — the keyword that built it (`'bar'`, `'line.draw'`, `'clamp'`, `'rule'`).
- **New option = three edits:** the list in `src/vocabulary.js`, the interface in `types.d.ts`, and the factory body. `check:exports` and `test/allow-lists.test.js` hold them together.

## Naming conventions

- `channels` is a mark's channel map. `EditContext.markChannels` is that map; `Edit.channels` / `EditContext.channels` are a list of channel names.
- `type` is a data type (`MeasureType`) on a field/channel, and the identity keyword on a feature. A scale type is `scale` / `ScaleSpec.type`. The dataset's shape is `structure` (`table`, `network`, `hierarchy` — data nouns; `network` not `graph`).
- `table` is a name (the data key); `role` is what the structure means by it. `table:` takes a name; `Mark.tableRole` and `Edit.table` take a role.
- One word per structure: `structure: 'network'`, `edit.network.*`, `scope: 'network'`, `supportsNetwork`.
- `size` is a radius in px everywhere (not `r`, not `handleRadius`); a sub-element's radius is `handleSize`.
- `fill` / `stroke` are the colour channels; there is no `color` channel.
- `series` is the public channel; `seriesKey` the internal feature field.
- `pick` values are target strategies or driver keys (`direct`, `nearest`, `plane`, `sweep`, `draw`, …).
- `constrain` (edit-scoped) vs `constraints` (the dataset's invariants on `spec`).
- `mode` means only how an edit reads the pointer (`absolute|relative`), plus `edit.axis.scale`'s `rescale|grow`. A constraint's violation behaviour is `strategy`; `Mark.requires` arity is `match`; `widgets.labeledValue` uses `input`.
- `guide: true` on an `Edit` means "self-draw"; `Constraint.guide` is a drawer function. Deliberately different.
- `marks` / "mark" in the public surface and dev-facing messages; `feature` / `FeatureNode` / `featureId` inside the engine (one mark may flatten into several features).
- `strokeDash` is the author's word; `strokeDasharray` is the paint field.

### Coding and workflow

- refrain from writing too complicated comments. Keep it direct and simple.
- If something changes, make sure to update relevant parts.
