---
paths:
  - "src/elements/**"
  - "src/plot/axis.js"
  - "src/plot/axisRadial.js"
  - "src/plot/legend.js"
  - "src/core/legends.js"
  - "src/core/axes.js"
  - "src/edit/legend.js"
  - "src/edit/scale.js"
  - "src/edit/axis.js"
---

# Chart elements and legends

## Elements

- `axis`, `axisRadial`, `grid`, `legend` set `views: 'scale'`: they draw a scale, have no channel map and no fields of their own. Contract: `ChartElement` in `src/types.d.ts`.
- `resolveChannels` (`edit/route.js`) falls back for an element: it reads `owner.field` first (a legend's encoding field, an axis's pin), then `scale.fields[0]`.
- `elementEdits` (`plot/mark.js`) is the one reader of an element's `edit` and `edits`.
- Validate options with `warnUnknownElementOptions(name, options, ALLOW)`. Don't route elements through `normalizeMarkOptions` (it accepts style shorthands that make no sense on an axis). Option lists are `ELEMENT_OPTIONS` in `src/vocabulary.js`.
- Implicit layers: `axes` (`core/axes.js`) default on; `legends` default off (a legend reserves space).
- An element's edit is a direct edit claimed by capability; never one that raises the plane.

## Legends

- A legend is a key for one encoding, declared on the channel: `fill: { field, legend: true | {…} | false }`. Precedence: a composed element, then the channel, then `legends: true`.
- `legendsFromChannels` (`core/legends.js`) is the one pass that builds them. Dedup by `(channel, field)`: two marks on one encoding get one legend.
- An element naming no `field` binds to the channel's sole encoding; with two, warn naming both.
- A legend-scoped edit on a channel requests a legend and is stripped from the channel, so the mark's nodes stay inert.
- Skip and warn on channels with no global scale (constant, `frame`, `scale: null`, raw).
- `legendForm` picks the shape from what the channel encodes to: `swatches` (discrete), `ramp` (continuous colour), `graduated` (continuous size, nested circles), `fan` (`theta`), `weights` (`strokeWidth`). All read `scale.encode`. Never send a non-colour channel to the ramp; never clamp a size chip to `swatchSize`. A fan is laid out by measuring (`fanLayout`, shared by `measure` and `build`).
- `size` is linear by default (predictable drag); `scale: 'sqrt'` is per-channel opt-in and the legend follows.
- A legend is a key first, a picker second: never dim swatches to show picker state — the current-value ring carries it. `warnUnreachableLegendRow` warns only when nothing can ever arm the picker (counting only edits with no `target`).

## Domain edits

- `edit.scale.categories()` writes the domain of the scale the element draws (`scope: 'scale'`), on an axis or a legend. `edit.legend.category()` writes a row and is armed only when there is one. Keep the two arming conditions separate in `plot/legend.js`.
- Rename/remove write every column on the scale in every table it spans: resolve through `scale.fieldRefs` (table-qualified). `DomainEditResult.tables` carries other tables' domains and rows; `commitDomainEdit` normalizes both into one write list. Secondary-table rows run that table's invariants (`runInvariants(rows, table)`); one rejection rejects the whole edit.
