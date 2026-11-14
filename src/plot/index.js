// @ts-check
// plot/ — the mark vocabulary. A mark views data: one node per row, and a channel
// carrying an `edit` writes its column back. This namespace holds mark keywords
// only; building blocks go in `authoring.*`.
//
// `barX` / `barY` and siblings force one orientation; the bare form infers it.

// ── Rectangular / interval ──────────────────────────────────────────────────
export { bar, barY, barX } from './bar.js';
export { rect, rectX, rectY } from './rect.js';
export { tick, tickX, tickY } from './tick.js';
export { rule, ruleX, ruleY } from './rule.js';
export { waffle, waffleX, waffleY } from './waffle.js';

// ── Point / token ───────────────────────────────────────────────────────────
export { point } from './point.js';
// One path per row — a pictogram, a d3 symbol, any SVG path — with every
// x/y mark's behaviour (edits, node box, ports).
export { shape } from './shape.js';
export { ellipse } from './ellipse.js';
export { dotStack, dotStackX, dotStackY } from './dotStack.js';

// ── Connected sequences ─────────────────────────────────────────────────────
// `line` reads a value against a domain axis; `path` connects points in creation
// order with both axes free (a lasso, a trace, a connected scatter).
export { line, lineY, lineX, path } from './line.js';
export { area, areaY, areaX } from './area.js';
export { curve, curveX, curveY } from './curve.js';

// ── Angular ─────────────────────────────────────────────────────────────────
// `donut` is a preset of `arc` that pins an inner radius. A pie is `arc()`.
export { arc, donut } from './arc.js';
export { needle } from './needle.js';

// ── Text ────────────────────────────────────────────────────────────────────
export { text, textX, textY } from './text.js';

// ── Parametric — channels are parameters of a curve, not columns of free rows ─
export { trend } from './trend.js';
export { trendBand } from './trendBand.js';

// ── Glyphs ──────────────────────────────────────────────────────────────────
// `composite` is a group of ordinary marks over the same rows.
export { composite } from './composite.js';
export { face } from './face.js';
// Presets over `composite`: a dot with a label, and a padded note of text.
export { node } from './node.js';
export { sticker } from './sticker.js';

// ── Network ─────────────────────────────────────────────────────────────────
// Draws a links-table row at positions held in the nodes table.
export { link } from './link.js';

// ── Geographic ──────────────────────────────────────────────────────────────
// Placed through the chart's `projection` rather than through x/y scales.
export { geoBasemap, geoTile, geoPoint, geoPolygon, geoLine, geoText, geoRect } from './geo.js';
