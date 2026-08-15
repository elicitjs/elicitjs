// @ts-check
// plot/ — the MARK vocabulary. A mark views DATA (`views: 'data'`): one node per
// row, its channels name columns of a table, and a channel carrying an `edit`
// writes that column back.
//
// This namespace contains marks and nothing else. Scale chrome is `elements.*`
// (it views a SCALE); read-only statements about chart state are `guides.*` (they
// view STATE and write nothing); the internals a mark is BUILT from are
// `authoring.*`. That rule keeps this list identical to the grammar's mark
// keywords — `plot.arcPath` would otherwise read as a mark that draws nothing.
//
// ── Directional variants ────────────────────────────────────────────────────
// The BARE form is the mark: it infers its value axis from the scales the schema
// resolved. `barX` / `barY` and their siblings are JS sugar that FORCE one
// orientation. Only the bare name is a mark keyword.

// ── Rectangular / interval ──────────────────────────────────────────────────
export { bar, barY, barX } from './bar.js';
export { rect, rectX, rectY } from './rect.js';
export { tick, tickX, tickY } from './tick.js';
export { rule, ruleX, ruleY } from './rule.js';
export { waffle, waffleX, waffleY } from './waffle.js';

// ── Point / token ───────────────────────────────────────────────────────────
export { point } from './point.js';
export { ellipse } from './ellipse.js';
export { dotStack, dotStackX, dotStackY } from './dotStack.js';

// ── Connected sequences ─────────────────────────────────────────────────────
// `line` reads a value against a domain axis; `path` connects points in creation
// order with both axes free (a lasso, a trace, a connected scatter).
export { line, lineY, lineX, path } from './line.js';
export { area, areaY, areaX } from './area.js';
export { curve, curveX, curveY } from './curve.js';

// ── Angular ─────────────────────────────────────────────────────────────────
// `pie` and `donut` are presets of `arc`, not aliases: they fix `arc: 'full'` and
// differ in `innerRadius`.
export { arc, pie, donut } from './arc.js';
export { needle } from './needle.js';

// ── Text ────────────────────────────────────────────────────────────────────
export { text, textX, textY } from './text.js';

// ── Parametric — channels are PARAMETERS of a curve, not columns of free rows ─
export { trend } from './trend.js';
export { trendBand } from './trendBand.js';

// ── Glyphs ──────────────────────────────────────────────────────────────────
// `composite` is a group of ordinary marks over the same rows. In BOX mode a part
// states a channel in the glyph's own local units and gets a real, invertible
// per-datum scale, so the universal edits work inside a glyph unchanged.
export { composite } from './composite.js';
export { face } from './face.js';
// Presets over `composite`: a dot with a label, and a padded note of text.
export { node } from './node.js';
export { sticker } from './sticker.js';

// ── Network ─────────────────────────────────────────────────────────────────
// The one mark whose geometry comes from a JOIN: it draws a row of the links
// table using positions held in the nodes table.
export { link } from './link.js';

// ── Geographic ──────────────────────────────────────────────────────────────
// Placed through the chart's `projection` rather than through x/y scales.
export { geoBasemap, geoTile, geoPoint, geoPolygon, geoLine, geoText, geoRect } from './geo.js';
