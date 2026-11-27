# Changelog

All notable changes. ElicitJS is alpha: minor versions may change the API.

## Unreleased

**Added**
- `layout.network.layered`, `layout.network.tree` and `layout.network.force` place a network's nodes from its links: ranks for flowcharts and causal maps, a tidy (or radial) tree, and a stress layout for concept maps. `place: 'new'` (default) positions only rows with no position; `place: 'all'` redraws every row when the nodes or links change.
- `layout.tidy` lines a hand layout up into rows and columns on any table.
- Every layout takes `where: (d, i, rows) => boolean`, the rows it acts on; the others stay where they are. Network layouts also run on a hierarchy that declares a links table, so each group of a diagram can have its own layout.
- `ui.network`: a **+** icon on a link puts a new node on it where the pointer met it, with the link re-pointed to it and a new link on to the old target.
- `ui.handles({ rotate, move })`: a grip above the box that turns it (writes `angle`; Shift snaps to 15°) and one below it that moves it (writes `x` and `y`).

**Changed**
- `layout.contain` is now `layout.hierarchy.contain` (`{ "type": "hierarchy.contain" }`). A layout that needs a structure is scoped to it, and warns on a dataset of another structure.

**Fixed**
- A sticker's label turns with its body.
- A node turned by `angle` turns its box: ports, link ends, self-loops and connect drops follow the turned edges, and layout spaces it by the upright box around it.
- `ui.*` places icons and resize grips on a turned node's own sides, and a grip drags along the node's axis.

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
