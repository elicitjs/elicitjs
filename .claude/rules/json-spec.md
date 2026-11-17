---
paths:
  - "src/json/**"
  - "src/vocabulary.js"
  - "test/json-*.test.js"
---

# The JSON spec layer

`compile(json)` returns the spec `Elicit()` takes. `recorder()` goes the other way. Both read one grammar.

## The form

- A factory call `ns.keyword(options)` is `{ "type": "keyword", ...options }`. The namespace comes from where the descriptor sits (`SPEC_SLOTS`), never from the keyword: `rule` and `custom` exist in several.
- A function is `{ "fn": "<registered name>" }` or `{ "expr": "<expression>" }`. A channel and a `custom` descriptor carry `fn` / `expr` directly.
- `when` takes a predicate's name; one that takes arguments is a descriptor. `format` / `tickFormat` keep a string as a d3 specifier.
- A widget sits under `widget`, with chart keys beside it.

## The walk is table-directed

- Keywords come from walking the live namespaces (`keywords.js`). Never list a factory by hand.
- Build the keyword table on first use, not at module load, or `dist/elicit.js` stops tree-shaking.
- Never enter a `SPEC_OPAQUE` key. Rows, schemas, GeoJSON, `defaults`, themes and a channel's `value` / `datum` may hold a key called `type` or `fn`.
- The keys of `channels`, `scales`, `legends` and `axes` are channel names, never options.
- A function reference where `SPEC_FUNCTIONS` lists none throws. Do not make the walk guess.
- `compile` throws with the JSON path for what it cannot place. Unknown options stay with each factory's `warn`.
- `compile` never changes its input, and a compiled spec builds one chart.

## Expressions

- `expr` is lowered to a function in `compile`. The core never evaluates one; `plot/mark.js` warns if it sees one.
- No `eval`, no `new Function`. Only own properties are read, and only `EXPR_FUNCTIONS` are callable.
- `==` is strict. `liftExpr` refuses an arrow with a loose `==`, a call, a template or an outside variable.

## Adding to the API

- A new function option: `SPEC_FUNCTIONS[owner][option]` = its parameter names (the `expr` variables), `'ctx'` for one context object, or `'fn'` for a registered function only.
- A new option holding factory results: `SPEC_SLOTS`. A new positional argument: `SPEC_POSITIONAL`. A new data-holding option: `SPEC_OPAQUE`.
- `check:exports` reads the declarations and fails when a table is missing one. `test/json-grammar.test.js` fails when a table names something that is gone.
- `test/json-parity.test.js` records a JavaScript spec, compiles its JSON and compares the factory calls. Add a fixture for a new kind of option.
- The docs' API tables show the JSON form from these tables (`../elicitjs-docs/scripts/gen-json-api.mjs`). A new docs API entry names what it documents with `json: ['plot.bar']` (a keyword or a `SPEC_FUNCTIONS` owner), or `json: false` for a call on the chart. `npm run gen:api` there fails on a name the library lacks; run it after changing a table.
