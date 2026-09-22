# ElicitJS

Declarative, grammar-of-graphics-inspired JavaScript library for interactive visual **belief elicitation** — charts people fill in, rather than charts that only display.

Drag a bar, place a point, turn a dial; get structured data back.

### 📖 [Documentation and live examples → elicitjs.github.io](https://elicitjs.github.io/)

```bash
npm install elicitjs
```

```javascript
import { Elicit, plot, edit } from "elicitjs";

const chart = Elicit({
  width: 600,
  height: 400,
  schema: { x: { type: "categorical", domain: ["A", "B", "C"] },
            y: { type: "quantitative", domain: [0, 100] } },
  data: [{ x: "A", y: 30 }, { x: "B", y: 50 }, { x: "C", y: 20 }],
  onChange: (data) => console.log(data),
  marks: [
    plot.barY({ channels: { x: { field: "x" },
                            y: { field: "y", edit: edit.move() } } }),
  ],
});

document.body.appendChild(chart);
```

| | |
|---|---|
| 🏠 Homepage | **[elicitjs.github.io](https://elicitjs.github.io/)** |
| 🚀 Getting started | [elicitjs.github.io/start](https://elicitjs.github.io/start/) |
| 📚 API reference | [elicitjs.github.io/api](https://elicitjs.github.io/api/) |
| 🎛 Playground | [elicitjs.github.io/playground](https://elicitjs.github.io/playground/) |
| 💻 Source | [github.com/elicitjs/elicitjs](https://github.com/elicitjs/elicitjs) |
| 🐛 Issues | [github.com/elicitjs/elicitjs/issues](https://github.com/elicitjs/elicitjs/issues) |

> **Alpha.** Pre-1.0 and under active development (`0.1.0-alpha.x`, npm tag `alpha`). Expect breaking changes. ESM-only, with `d3` v7 as a peer dependency.

## License

MIT © Alireza Karduni
