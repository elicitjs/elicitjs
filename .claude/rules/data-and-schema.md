---
paths:
  - "src/core/schema.js"
  - "src/core/lock.js"
  - "src/core/hierarchy.js"
  - "src/core/engine/tables.js"
  - "src/core/engine/state.js"
  - "src/core/engine/history.js"
  - "src/core/engine/api.js"
  - "src/core/engine/compute.js"
  - "src/core/engine/features.js"
---

# Data, schema and tables

## The schema

- `src/core/schema.js` owns the schema: declaration, inference, creation defaults (`schemaDefaults`) and validation.
- `validateDataset(schema, data)` runs once per `Elicit()` and per `setData()`. It reports: `data` with no schema, an undeclared data column, a `FieldSchema` with a domain but no `type`, a value contradicting its declared type, a value outside its declared domain. Add new checks there, not in a mark.
- It deliberately does not type-check discrete fields — any value can be a category key (a geo mark declares a GeoJSON geometry `categorical`). The domain is the constraint there.
- `resolveScales` takes a positional axis domain as the union of the schema domains of every field on that axis (`unionDomains`) — that is why an error bar's `mean`/`lo`/`hi` share one y axis. Don't add a per-channel domain "just for this chart"; declare the field.
- `normalizeSchema` is the only place an author's schema spelling is read. It applies three sugars (bare field map = single-table schema; bare table entry takes its role from its name; bare-array `data` = primary table) and returns the canonical `SchemaSpec`. Nothing else re-sniffs the shape. `getSchema()`/`getData()` denormalize on the way out so a single-table chart still returns the bare map and array — the canonical form never leaks.

## Domains: closed or open

- `FieldSchema.open`: a declared domain is closed by default (the whole vocabulary); `open: true` makes it a starting set.
- Closed: `edit.stack.cut` hands out values that the group doesn't use yet and refuses when they run out; `validateDataset` reports out-of-domain seed values. Open: the cut appends and the out-of-domain check is skipped.
- Naming is separate from creating (`edit.scale.categories().rename`, `edit.cycle()`), so a creator mints a placeholder and never blocks. Never mint a `null` category — a row that can only be completed by typing is not elicitation.
- A domain edit's coupled `data` (a rename relabelling rows, a cut splicing one in) runs the dataset invariants like any other proposal, even though the schema half skips them.

## Structures, tables and roles

- A chart elicits exactly one dataset. Its `structure` (`STRUCTURES` in `schema.js`) defines named roles: `table` → `data`; `network` → `nodes`, `links`; `hierarchy` → `nodes`, `nesting`, optional `links`. The engine holds them as `chart.tables` (`core/engine/state.js`).
- A mark is a view over exactly one table (`feature.table`). `table:` names it; with none, the mark takes the table filling its `tableRole` (`link` declares `'links'`), else the primary table. The engine resolves this once when flattening features and warns on an undeclared name. Elements have no `table`. A `composite` stamps its table on its box and every part.
- Name ≠ role. Defaults resolve by role so an argument map can call its tables `claims`/`supports` and write no `table:`. Never hard-code `'nodes'`/`'links'`/`'data'` as a lookup key — go through `byRole`.
- Marks, edits and constraints each still see one array: the engine hands `tableOf(feature)`. Never pass a table map into a mark or edit. The one exception is `build`'s optional 5th argument, for `link` alone.
- A selection key is qualified by table (node 3 ≠ link 3); the index-based public API means the primary table.

## Context rows

- `spec.context` (`true` | `(d, i, table) => boolean`) marks reference rows of the elicited table (history behind a forecast). They share the table's columns, every mark draws them, and they are locked (`isLockedIn` ORs them in).
- Everything the chart reports leaves them out: `getData()`/`onChange` (`reportedRows`) and the index-addressed API (`select*`, `getSelection*`, the `select` event, `control(name, i)`), so `getData()[i]` and `select(i)` name the same row.
- Membership is decided once, over the seed, and held as row identity (`contextRows`, a `WeakSet` per table). Never re-ask the predicate of live rows — an answer dragged into the region would vanish from `getData()`. This relies on `lockConstraint` returning a locked row as the same object on every path.
- Undo carries membership as indices; `setData(rows)` replaces answers and keeps context rows ahead of them. Constraints see context rows, with `locked` to tell them apart.
- There is no context table; `normalizeSchema` throws on `{ context: true, fields }`. Reference data with other columns goes in the same table; unrelated data is a guide.

## References and network facts

- `type: 'ref'` says a column names a row of another table by its key (`key: true`). Its domain is derived from that key column — never declare one.
- `key: true` makes `mintDatum` give every minted row an identity (`nextCategory`), so plain `create()` works on any table; there is no `addNode`.
- The engine enforces referential integrity: `enforceRefs` drops rows whose reference no longer resolves after every commit (deleting a node removes its links). Don't reimplement it as a constraint.
- `directed` sits on the links table and is tri-state. Read it only through `isDirected(spec)`. `true`: arrowheads by default, reciprocal pairs bow apart, `reverse` is meaningful. `false`: A→B and B→A are one edge. `undefined` (default) must behave exactly as before the flag existed — don't collapse it to a boolean.
- `multi` and `selfLoops` sit beside it (`LINK_FACTS`, read via `linkRulesOf(spec)`). Both default to "no" for gestures; existing rows still draw. Only an explicit `false` makes `validateTables` report a seeded parallel pair or loop. Never decide these with an edit option.
