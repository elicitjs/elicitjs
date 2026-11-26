# Elicit.js

A declarative JavaScript library for interactive visual **belief elicitation**. Build an elicitation interface from charts: people drag a bar, place a point or turn a dial, and you get structured data back.

### 📖 [Documentation and live examples → elicitjs.github.io](https://elicitjs.github.io/)

```bash
npm install elicitjs
```

```javascript
import { Elicit, plot, edit, constraints } from "elicitjs";

const chart = Elicit({
  width: 600,
  height: 400,
  schema: {
    party: { type: "categorical", domain: ["Red", "Blue", "Green"] },
    share: { type: "quantitative", domain: [0, 100] },
  },
  data: [
    { party: "Red", share: 40 },
    { party: "Blue", share: 35 },
    { party: "Green", share: 25 },
  ],
  constraints: [
    constraints.clamp({ min: 0 }),
    constraints.maintainSum({ total: 100, strategy: "redistribute" }),
  ],
  onChange: (data) => console.log(data),
  marks: [
    plot.barY({
      channels: {
        x: { field: "party" },
        y: { field: "share", edit: edit.move() },
      },
    }),
  ],
});

document.body.append(chart.dom());
```

Drag a bar and the others adjust so the shares still add up to 100. `onChange` receives the whole dataset after every committed edit.

## The model

An edit is the inverse of encoding. A channel encodes a field to pixels through a scale. An `edit` on that channel maps a gesture back through the same scale and writes the field.

A spec has a few parts:

- `schema` — each field's **type** and **domain**. Scales are derived from it, so no mark declares one.
- `data` — the rows. Leave it out to start from an empty chart.
- `marks` — how the rows are drawn. A mark names its fields in `channels`.
- `edit` — on a channel, or in a mark's `edits: [...]`. A mark is inert until an edit names the field it writes.
- `constraints` — rules over the dataset, such as bounds, sums and ordering. They apply to every edit from every mark.

## What's in the package

| Export | What it holds |
|---|---|
| `Elicit` | `Elicit(spec)` returns a chart. `Elicit.dataset(spec)` returns a dataset that several charts can share. |
| `plot.*` | Marks: `bar`, `rect`, `area`, `line`, `path`, `point`, `ellipse`, `curve`, `tick`, `rule`, `text`, `shape`, `face`, `composite`, `dotStack`, `waffle`, `needle`, `arc`, `donut`, `trend`, `trendBand`, `node`, `link`, `sticker`, and the `geo*` family. Most have `…X` / `…Y` forms that fix the orientation. |
| `edit.*` | Edits: `move`, `moveSpan`, `brushSpan`, `brushRect`, `resize`, `rotate`, `slide`, `cycle`, `create`, `remove`, `toggle`, `select`, `set`, `rank`, `editText`, `custom`. Scoped families: `edit.line`, `edit.stack`, `edit.waffle`, `edit.trend`, `edit.geo`, `edit.axis`, `edit.scale`, `edit.legend`, `edit.network`, `edit.hierarchy`. `edit.when` arbitrates edits that share a gesture. |
| `constraints.*` | `clamp`, `snap`, `count`, `unique`, `maintainSum`, `ordering`, `monotonic`, `spacing`, `symmetric`, `follow`, `custom`. |
| `elements.*` | Scale chrome: `axis`, `grid`, `legend` and `axisRadial`, with their `X` / `Y` / `Color` / `Size` / `Symbol` forms. An element with an edit rewrites the schema's domain. |
| `guides.*` | Read-only annotations: `rule`, `region`, `remaining`, `tip`, `crosshair`, `proximity`, `prompt`, `options`, `cellGrid`, `sliderTrack`, `quadrants`, `custom`. |
| `looks.*` | Experimental. How the finished chart is drawn: `rough` redraws it by hand in either renderer; `sketch`, `cartoon`, `halftone` and `custom` are shaders for the canvas renderer. |
| `widgets.*` | Survey instruments, one call each: `likert`, `multipleChoice`, `slider`, `matrix`, `ranking`, `allocation`, `probabilityTokens`, `interval`, `histogram`, `region`, `thermometer`, `labeledValue`, `lineCone`. |
| `ui.*` | UI laid over a chart after it is made: `ui.attach(chart, parts)` with `contextMenu`, `actions`, `handles`, the `network` preset and `custom`. Not part of the spec. |
| `format.*` | Display formatters: `number`, `percent`, `si`, `time`, `prefix`, `suffix`. |
| `themes`, `setTheme` | Built-in themes (`survey`, `dark`, `nyt`, `economist`, `swiss` and more) and the app-wide default. A chart takes `theme: "name"` or a partial theme. |
| `D3Renderer`, `CanvasRenderer` | The SVG renderer (the default) and a canvas renderer. Pass one as `renderer`. |
| `compile`, `registerFunction`, `recorder` | JSON specs: build a chart from JSON, and record a JavaScript spec as JSON. |
| `authoring` | Building blocks for new marks, edits, constraints, drivers and widget designs. Also importable as `elicitjs/authoring`. |

## Reading the answer

- `onChange(data)` on the spec fires once per committed edit. Hover previews never fire it.
- `chart.getData()` returns a deep copy of the dataset. `chart.getSchema()` returns the schema, including any domain an editable axis changed.
- `chart.on("change" | "select" | "hover" | "stage", cb)` subscribes and returns an unsubscribe function.
- `undo()` / `redo()` step through history one gesture at a time.
- `setData(rows)`, `set(field, value, { index })` and `setDomain(field, domain)` change the data from outside the chart.
- `chart.control(name, index).set(value)` drives a named edit from your own UI.
- `chart.scene()`, `chart.hit(point)` and `chart.scale(channel)` report what is drawn and where, for UI you place over the chart. `chart.on("render", cb)` runs after each frame.
- Call `chart.destroy()` when you unmount the chart.

## Several charts, one dataset

```javascript
const ds = Elicit.dataset({ schema, data, constraints });
const bars = ds.chart({ marks: [plot.barY({ channels })] });
const dots = ds.chart({ marks: [plot.point({ channels })] });
```

An edit in either chart redraws the other. The charts share rows, schema, constraints, undo history, selection and hover. Marks, size, theme and stages belong to each chart. A schema can also declare `structure: "network"` with node and link tables, or a hierarchy of nested nodes.

## Widgets

```javascript
import { Elicit, widgets } from "elicitjs";

const chart = Elicit(widgets.likert({
  question: "How confident are you?",
  options: ["Not at all", "Slightly", "Moderately", "Very", "Extremely"],
  onChange: (data) => console.log(data),
}));
document.body.append(chart.dom());
```

Each widget returns a plain spec, so you can start from one and edit it. `theme: "survey"`, `"surveyBlocks"` or `"surveyLines"` restyles every widget.

## JSON specs

A JSON spec uses the same keywords and options as the JavaScript API. Each factory call is an object with a `type`:

```javascript
import { Elicit, compile } from "elicitjs";

const chart = Elicit(compile({
  schema: { share: { type: "quantitative", domain: [0, 100] } },
  data: [{ share: 40 }],
  marks: [{
    type: "barY",
    channels: { y: { field: "share", edit: { type: "move" } } },
  }],
}));
```

An option that takes a function takes `{ "expr": "…" }` in JSON, one expression over the option's variables. Longer code is named with `{ "fn": "name" }` and supplied through `registerFunction(name, fn)`. `recorder()` turns a spec written with the factories into JSON.

## Install notes

Elicit.js is ESM-only. `d3` v7 is a peer dependency: npm 7+ and pnpm 8+ install it for you, and on Yarn you add it with `yarn add elicitjs d3`. Types ship with the package. `elicitjs/dist` is a prebuilt single-file bundle.

For a plain HTML page, use an import map:

```html
<script type="importmap">
  {
    "imports": {
      "d3": "https://cdn.jsdelivr.net/npm/d3@7/+esm",
      "elicitjs": "https://cdn.jsdelivr.net/npm/elicitjs@alpha/dist/elicit.js"
    }
  }
</script>
<script type="module">
  import { Elicit, plot, edit } from "elicitjs";
</script>
```

## Links

| | |
|---|---|
| 🏠 Homepage | **[elicitjs.github.io](https://elicitjs.github.io/)** |
| 🚀 Getting started | [elicitjs.github.io/start](https://elicitjs.github.io/start/) |
| 📚 API reference | [elicitjs.github.io/api](https://elicitjs.github.io/api/) |
| 🧾 JSON specs | [elicitjs.github.io/json](https://elicitjs.github.io/json/) |
| 🎛 Playground | [elicitjs.github.io/playground](https://elicitjs.github.io/playground/) |
| 🏗 Architecture | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 📝 Changelog | [CHANGELOG.md](CHANGELOG.md) |
| 💻 Source | [github.com/elicitjs/elicitjs](https://github.com/elicitjs/elicitjs) |
| 🐛 Issues | [github.com/elicitjs/elicitjs/issues](https://github.com/elicitjs/elicitjs/issues) |

> **Alpha.** Pre-1.0 and under active development (npm tag `alpha`).

## License

MIT © Alireza Karduni
