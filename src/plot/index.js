// @ts-check
export { rule, ruleX, ruleY } from './rule.js';
export { bar, barY, barX } from './bar.js';
export { rect, rectX, rectY } from './rect.js';
export { tick, tickX, tickY } from './tick.js';
export { line, lineY, lineX, connectedScatter, path } from './line.js';
export { area, areaY, areaX } from './area.js';
export { point } from './point.js';
export { ellipse } from './ellipse.js';
export { curve, curveX, curveY } from './curve.js';
export { face } from './face.js';
export { text, textX, textY } from './text.js';
export { dotStack, dotStackX, dotStackY } from './dotStack.js';
export { waffle, waffleX, waffleY } from './waffle.js';
export { needle } from './needle.js';
// A network's edge: one row of the links table, drawn between the nodes it names.
export { link } from './link.js';
// A dot with a label, as one mark — a preset over composite (not network-specific).
export { node } from './node.js';
// Chart elements — prefer `elicit.elements.*`. Re-exported here as aliases so
// existing `plot.axis` / `plot.legend` / `plot.axisRadial` specs keep working.
export { axisRadial } from './axisRadial.js';
export { arc, pie, donut } from './arc.js';
// `group` is an alias: box mode used to be a separate mark. See composite.js.
export { composite, group } from './composite.js';
export { axis, axisX, axisY, grid, gridX, gridY } from './axis.js';
export { legend, legendColor, legendSize, legendSymbol } from './legend.js';
// Shared mark foundation — for authoring new marks (channel resolution + the
// standard style surface). See mark.js.
export { encodeChannel, encodeValue, encodeAngle, resolveStyle, normalizeMarkOptions, markCommon, STANDARD_STYLE_CHANNELS } from './mark.js';
export {
    polarToXY, arcPath, arcSpine, arcSpan, angularBand, needleTriangle, degToRad,
    ORIENT_SPAN,
} from './polar.js';

export { trend } from './trend.js';
export { trendBand } from './trendBand.js';
// The parametric-line geometry `trend` and `trendBand` share — for authoring a
// mark over the same model. See trendGeometry.js.
export {
    paramChannels, readParams, anchorsOf, valueAt, lineSegment,
    envelopePolygon, nestedEnvelopes, sampleLines,
} from './trendGeometry.js';
export { geoBasemap, geoTile, geoPoint, geoPolygon, geoLine, geoText, geoRect } from './geo.js';
export { tileCover, tileUrl, isWebMercator } from '../core/tiles.js';
export { projectPoint, invertPoint, projectBounds, createProjection } from '../core/projection.js';
