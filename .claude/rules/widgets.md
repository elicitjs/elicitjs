---
paths:
  - "src/widgets/**"
  - "src/core/theme.js"
  - "src/core/themes.js"
---

# Widgets and designs

- A widget is a function that returns a whole `ElicitSpec`. It adds no interaction surface: the answer is a mark with an ordinary edit, the invariants are dataset constraints, the chrome is guides.
- How a widget looks is a design (`src/widgets/designs.js`): one drawer per part (`option`, `answer`, `grid`, `track`, `thumb`, `card`, `slots`, `bar`) plus two layout facts (`list`, `tiles`). `theme.widget.design` names it. A widget asks `widgetLook(theme)` for the design and composes its parts. Never branch on a design's name in a widget or a guide; add a part or a fact to the design instead.
- A new design is `registerDesign(name, design)` and, for a built-in one, a named theme in `core/themes.js` that sets `widget.design`. State only the parts that differ; `extends` gives the rest, and `ring` is the root. Every part must have a `ring` implementation, so a widget can call it without a guard.
- Drawers return scene nodes in plot pixels and take every colour and size from the tokens (`theme.widget`), never a literal colour. A new token goes in `DEFAULT_THEME.widget`, `WidgetTokens`, and any dark theme that would otherwise draw it light.
- The default look is `ring` with today's values. A change to `ring` or to a `DEFAULT_THEME.widget` value must reproduce the old drawing exactly; `test/widget-designs.test.js` holds it.
- Chrome and answer read one geometry: the band scale. A tiled layout puts the gap in the scale's `padding` (`tileLayout`), so a guide's box and the answer's mark agree and both follow a resize. Don't compute a slot's pixels in a widget.
- The answer's ink is a mark (`answerMark` in `parts.js`); a guide draws the empty control and the chosen option's wash, which are statements derived from the rows. A guide rect paints under the marks and every other guide node over them, so a control drawn over the answer has `fill: 'none'`.
- A card is one `composite` (`card` in `parts.js`): the body `rect` first with the only edit, the other parts inert, the glyph given no channels or edits of its own. Parts are placed by constant `x` from the card's edge.
- A widget resolves its theme once and pins the resolved `widget` tokens on `spec.theme`, so its marks (painted when it was built) and its guides (painted each frame) cannot disagree.
- A guide a widget uses only for itself (`rankSlots`, `barTracks`) stays out of `guides.*`: a namespace member is a permanent JSON keyword.
