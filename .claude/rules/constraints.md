---
paths:
  - "src/constraints/**"
  - "test/constraint*.test.js"
  - "test/coupled-constraints.test.js"
---

# Constraints

- A constraint is a descriptor `{ type, field?, options, apply(ctx) }`, built by `makeConstraint` / `defineConstraint` (`constraints.custom`). A bare function is still accepted; `applyConstraint` (`constraints/define.js`) runs either.
- It is a pure data invariant. `ctx` = `{ data, oldData, activeIndex, active, field, value, domain, schema, locked }` — never pixels or a scale used as geometry. Return `false` to gate, or corrected rows to repair. It holds for every edit from every mark over those rows.
- Declared only in `spec.constraints`. A mark option `constraints` is rejected via `MISTAKEN_OPTIONS` (`plot/mark.js`). Never scope one to a feature. If its guide only makes sense for some marks, guard the guide, not the constraint.
- `field` omitted = the column the dispatching edit writes (threaded into the context). Never default to a literal column name. `field` is a name or ordered list (`ordering({ field: ['lo','hi'] })`); a sum is `total`.
- Validate options like every other factory (`CONSTRAINT_OPTIONS` in `src/vocabulary.js`).
- Repair every changed cell: iterate `changedCells(ctx)` (every `(row, field)` of `ctx.fields` that differs from committed rows), not just `ctx.value`. Respect the field's measure (`snap` must not turn a Date into a number).
- A push must not carry a neighbour past a wall the lock or domain will enforce — `monotonic` and `spacing` cap the dragged value instead.
- Coupled columns are declared: `follow({ field, lead })` moves columns by the lead's delta; `symmetric({ field, about })` mirrors about a centre. Order: `follow, symmetric, ordering, clamp`. Use `movedFields` (`constraints/shared.js`) rather than diffing by hand.
- Constraint guides go through `constraintGuide`'s switch in `src/edit/guide.js` (or no guide, fine for `count`/`unique`). No separate guide module.
- Referential integrity is the engine's (`enforceRefs`), not a constraint. A constraint returns rows only for the table it was given.
- `strategy` names what a constraint does on violation (`count`/`unique`, `maintainSum`'s `cap|normalize|redistribute`, `ordering`'s `push|block`).
