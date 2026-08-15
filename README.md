# ElicitJS

ElicitJS is a declarative, grammar-of-graphics-inspired JavaScript library for structured, interactive visual **belief elicitation**. Unlike charting libraries that only display static data, ElicitJS builds empty or pre-filled charts where users directly construct or modify data points — expressing their beliefs — through mouse, touch and keyboard gestures.

The core idea: **an edit is the inverse of encoding.** A channel encodes data → visual through a scale; an edit attached to that channel maps a gesture → data back through the *same* scale.

```javascript
schema: { n: { type: "quantitative", domain: [0, 100] } }   // what n IS
y: { field: "n", edit: move() }
//   ── encode: n → pixel ──┘  └─ edit: drag pixel → n
```

- **Architecture** — see [ARCHITECTURE.md](ARCHITECTURE.md) for how the library is layered and why.
- **Documentation** — the sibling repo `../elicitjs-docs`, a live-editable docs site that is also the test suite.

> **Alpha.** ElicitJS is pre-1.0 and under active development. Expect breaking changes between minor versions (`0.1.x` → `0.2.0`); patch releases stay compatible. Pin with `~0.1.0` if you want only patches.

---

## Install

ElicitJS is ESM and needs a bundler (Vite, webpack, …) or an import map. Runtime dependency: `d3`.

```bash
npm install elicitjs
# or from a checkout / GitHub:
# npm install github:elicitjs/elicitjs
```

```javascript
import * as elicit from "elicitjs";
const { Elicit, plot, edit, constraints } = elicit;
```

`package.json` points `exports` / `main` at `src/index.js`, so a normal install resolves to source — no build step. Types ship from `src/index.d.ts`.

If you want a single prebuilt ESM file instead:

```bash
npm run build:lib          # → dist/elicit.js (+ sourcemap); d3 stays external
```

```javascript
import * as elicit from "elicitjs/dist";
```

```html
<!-- Browser: provide d3, then load the bundle -->
<script type="importmap">
  { "imports": { "d3": "https://cdn.jsdelivr.net/npm/d3@7/+esm" } }
</script>
<script type="module">
  import * as elicit from "./dist/elicit.js";
</script>
```

---

## Example

A budget allocation: four draggable bars that must always sum to 100.

```javascript
import * as elicit from "elicitjs";
const { barY, ruleY } = elicit.plot;
const { move } = elicit.edit;
const { clamp, maintainSum } = elicit.constraints;

const beliefChart = elicit.Elicit({
  width: 600,
  height: 400,
  // The contract of the elicited dataset: what each field IS, and its domain.
  // Every scale below is derived from this — no mark declares one.
  schema: {
    x: { type: "categorical",  domain: ["A", "B", "C", "D"] },
    y: { type: "quantitative", domain: [0, 100] },
  },
  // THE dataset. A chart elicits exactly one; every mark is a view over these rows.
  data: [
    { x: "A", y: 25 }, { x: "B", y: 25 },
    { x: "C", y: 25 }, { x: "D", y: 25 },
  ],
  // Data invariants — they gate and repair every edit, from any mark.
  constraints: [clamp({ min: 0 }), maintainSum({ targetSum: 100 })],
  onChange: (data) => console.log("elicitation state:", data),
  marks: [
    // `datum` is a DATA-space constant: it goes through the y scale, so the line
    // lands where y = 50 is. (`value` would mean 50 pixels.)
    ruleY({ stroke: "red", strokeDasharray: "4", channels: { y: { datum: 50 } } }),
    barY({
      id: "elicited-probabilities",
      fill: "purple",
      channels: {
        x: { field: "x" },                              // categorical + bar -> band
        // The value channel carries the edit; a drag writes y back through the scale.
        y: { field: "y", edit: move({ guide: true }) }, // quantitative -> linear
      },
    }),
  ],
});

document.getElementById("chart-container").appendChild(beliefChart);
```

`Elicit(spec)` returns the chart element, augmented with `getData()`, `getSchema()`, `setData()`, `on("change" | "stage", cb)`, `undo()` / `redo()` and `destroy()`.

Higher-level survey instruments are one call each — `elicit.widgets.likert`, `slider`, `matrix`, `ranking`, `allocation`, `interval`, … — and each returns a plain spec you pass to `Elicit`.

---

## Run it

```bash
npm install
npm run dev            # the docs site, live (wraps ../elicitjs-docs) → http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run dev` | Serve the docs site from the sibling repo (live examples) |
| `npm run build:lib` | Build the publishable ESM library → `dist/elicit.js` |
| `npm run build:docs` | Build the docs site → `../elicitjs-docs/.next/` |
| `npm run start:docs` | Serve the docs production build |
| `npm run typecheck` | `tsc --noEmit` against `src/types.d.ts` |
| `npm run verify:browser` | Regression gate: real Chromium driving gestures over the docs |
| `npm run check:warnings` | Regression gate: zero `[elicit]` warnings on every docs route |

`npm run dev`, `build:docs`, `verify:browser` and `check:warnings` all require the sibling repo `../elicitjs-docs` to be checked out and installed.

Diagnostics are on by default and print with an `[elicit]` prefix; they go quiet in a production build (`NODE_ENV`), or turn them off with `elicit.setWarnings(false)`.

---

## License

MIT © Alireza Karduni
