# Changelog

All notable changes. ElicitJS is alpha: minor versions may change the API.

## 0.3.0-alpha.0

**Added**
- `ui.*`, a layer of HTML parts laid over a chart after it is made (`ui.attach`). Not grammar; reads the chart through its new read surface.
- `plot.track`, a value drawn as a length along a route.
- `spec.layout` (`contain`, `dodge`, `row`, `column`, `grid`, `pack`, `custom`) and `constraints.contain`; slot layouts for container contents.
- Pictures: `src` on `plot.image`, an `image` channel, `guides.image`.
- `looks.*` (experimental): `rough` and canvas shaders.
- `chart.control()` aims at the node an edit acts on; network edits run as transactions.

**Fixed**
- Touch input on phones.
- No hover outline around a node that paints nothing.
- Canvas renderer parity fixes and renderer teardown.

## 0.2.0-alpha.0

Earlier alpha releases (0.1.0-alpha.0 to 0.2.0-alpha.0) are listed on the [tags page](https://github.com/elicitjs/elicitjs/tags).
