---
paths:
  - "src/index.js"
  - "src/index.d.ts"
  - "src/types.d.ts"
  - "src/vocabulary.js"
  - "src/authoring/**"
  - "src/*/index.js"
  - "scripts/**"
  - "package.json"
  - "vite.lib.config.js"
  - "test/allow-lists.test.js"
---

# Public API surface and packaging

## Namespaces

- A grammar namespace (`plot.*`, `edit.*`, `constraints.*`, `guides.*`, `elements.*`, `widgets.*`) contains only spec keywords; authoring primitives are `authoring.*` (`src/authoring/index.js`, also the `elicitjs/authoring` subpath). `check:exports` can't detect a member in the wrong namespace, so check by hand: anything that appears in a spec's `guides: [...]` is a guide; an option-name list or a helper usable only inside a `{ fn }` channel (e.g. `noteBox`, `measureText`) is authoring.
- Grammar namespaces and `ElicitSpec` have closed key sets — no index signatures (an unknown name must be a compile error, and the JSON Schema is generated from the key set).
- One name per concept. Removed aliases must stay removed: `plot.group` (= `composite`), `pie` (= `arc`; `donut` stays — it pins `innerRadius`), `connectedScatter` (= `path`), `z` (= `series`), `edit.arc.edge`, `edit.axis.categories`, `widgets.ci`, `constraints.normalize`, `youDrawIt` (= `sweep`), `Edit.guideColor`, `effects.grab`/`effects.select`, top-level `elicit.when`.
- Mark variants (`barX`/`barY`, …) are keywords, declared in `index.d.ts`.

## Vocabulary and types

- `src/vocabulary.js` imports nothing and holds `MARK_OPTIONS`, `ELEMENT_OPTIONS`, `GUIDE_OPTIONS`, `EDIT_OPTIONS` (keyed by dotted type), `CONSTRAINT_OPTIONS`, plus each kind's universal set.
- `check:exports` compares each options interface in `types.d.ts` with its list in both directions; `test/allow-lists.test.js` compares each list with what the factory body reads.
- `src/types.d.ts` is the source of truth for `Mark`, `Edit`, `Constraint`, `FeatureNode`, `Session`, … — update it with any descriptor change.
- `src/authoring/index.d.ts` is generated: `npm run gen:types`.
- A shipped export that isn't declared in `src/index.d.ts` is a broken API; `check:exports` checks both directions.

## Packaging

- `npm pack --dry-run` should stay ~1.0 MB (mostly `dist/elicit.js.map`). The docs (`../elicitjs-docs`) and anything generated must stay out of `package.json` `files`.
- Don't recreate a docs site inside this repo.
