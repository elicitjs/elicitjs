---
paths:
  - "src/ui/**"
  - "src/core/engine/view.js"
  - "src/core/engine/api.js"
  - "test/ui-*.test.js"
  - "test/view.test.js"
---

# The UI layer and the chart's read surface

## What it is

- `ui.attach(chart, parts)` lays HTML over a chart after it is made. It is not grammar: nothing in `ui.*` is a spec keyword or has a JSON form. Keep it out of `src/json`, the grammar loop of `check:exports` and `ElicitSpec`.
- A part is `{ type, mount(ctx) → dispose }`. `ui.custom(mount)` is the author's own. The built-in parts use only `UiContext` and the chart's public methods, so a third party can write the same. Don't reach into the engine from `src/ui`.
- No DOM access at import: `src/ui` must load where there is no `document` (`test/ui-ssr.test.js`).

## Reading and writing

- A part reads through `chart.scene` / `hit` / `scale` / `edits` / `metrics` / `toInner` / `toClient` and `on('render')` (`core/engine/view.js`). Everything the view hands out is a copy; a `SceneView` never holds a live node. Add a read there, not a back door.
- A part writes through `chart.control`, `chart.emit` and `chart.set` only. No new write path.
- Two rules decide which: adding or removing a row, connecting, re-pointing and dragging need a NAMED edit of the spec (`findEdit` in `ui/bind.js` warns for an unnamed one). A value in an existing cell needs none: `valueOf` uses a declared value edit on the channel when there is one, else `chart.set`.
- Several writes that are one action (a new row then its category, a width and a centre) go inside one `chart.transaction()`.
- Find an edit by what it declares (`cardinality`, `table`, `pick`, `gesture`) before its `type`. `type` is for the edits no capability tells apart (`network.connect`, `rewire`, `reverse`).
- A part never names a data column in its options. It names a mark and a channel, and reads the field off `chart.scale`.

## The layer

- One element, `pointer-events: none`, inserted after the renderer's root once the chart has drawn (the D3 renderer finds its svg by tag). Controls opt in to the pointer.
- The pointer is read from DOM events on `chart.dom()` (`ui/pointer.js`) and converted with `toInner`, so no renderer reports anything for the layer. Both renderers ignore non-primary buttons, which leaves a right-click to the menu.
- Everything a part registers through `ctx` is released on detach. `chart.destroy()` detaches the layer (`on('destroy')`).
- A menu opens in the browser's top layer (`popover="manual"`), fixed to the window, so a scrolling or clipping box around the chart neither cuts it off nor scrolls to fit it. It stays a child of the layer, so the `--elicit-ui-*` variables still reach it. It closes on scroll and resize. Where there is no popover (jsdom), it is placed in the layer as before.
- Position with `ctx.place`; call `ctx.refresh()` after changing what an element is anchored to. Never write a transform by hand beside it.
- Colours and sizes come from `theme.ui`, handed to the layer as `--elicit-ui-*` variables. No literal colour in `ui/styles.js`. A new token goes in `DEFAULT_THEME.ui`, `UiTheme`, `applyTokens` and the dark themes.
- Icons are stroked paths on a 16 x 16 grid in `ui/icons.js`, drawn for this library. `authoring.registerIcon` adds a name.
- Icons that follow the pointer go through `hoverGroup` (`ui/hover.js`): one target at a time, a moment's linger after the pointer leaves, no switching while the pointer is on its way to the buttons, and the target lit in the chart (`control(name, ref).emit({ type: 'pointerover' })`). Don't hide or move a group on a bare pointer move.
- A line's icons sit beside the point the pointer met it at, and stay there. A box's sit on its side or corner.
- One set of icons at a time within a preset: `ui.network` gives a port's icons priority over a link's.
- An overlay control never sits on a scene handle: port icons go outward from the port, and a resize grip moves to the corner where a port holds the middle of a side.

## Adding a part or an option

- New option = `UI_OPTIONS` in `src/vocabulary.js`, the options interface in `types.d.ts`, the part body, and `warnUnknownUiOptions(name, …)`. `check:exports` and `test/allow-lists.test.js` hold them together.
- New part = a member of `ui` in `src/ui/index.js` and `src/index.d.ts`, a section on `/ui` in the docs, and a check in `scripts/verify-browser.mjs`: jsdom does no layout, so only a real browser proves a placement.
