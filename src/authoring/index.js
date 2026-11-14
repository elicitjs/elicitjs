// @ts-check
// authoring/: the building blocks for writing new marks, edits, constraints and
// widgets. A grammar namespace (`plot.*`, `edit.*`, …) contains only spec keywords,
// since a JSON layer compiles its members to keywords; everything else is here.
//
//   import * as elicit from 'elicitjs';   elicit.authoring.encodeChannel(…)
//   import { encodeChannel } from 'elicitjs/authoring';

// ── Writing a mark ──────────────────────────────────────────────────────────
// Channel resolution and style. See plot/mark.js and the `Mark` interface.
export {
    // datum -> visual, through the channel's scale.
    encodeChannel,
    // an arbitrary value -> visual, for a mark that computes the points it draws.
    encodeValue,
    // the `angle` channel -> math degrees.
    encodeAngle,
    // datum -> category, the discrete-axis counterpart of encodeChannel.
    categoryOf,
    // datum -> its interval on a category axis (band, or `xOffset`/`yOffset` sub-band).
    categorySlot,
    // the standard style channels, resolved onto a scene node.
    resolveStyle,
    // the `symbol` channel -> a glyph string, and the text node that draws one.
    resolveSymbol,
    symbolNode,
    // option intake: desugar the shorthands, warn on an unknown option.
    normalizeMarkOptions,
    // the options every mark passes through verbatim.
    markCommon,
    // a handle's radius, paint and visibility (`handles: true|false|'hit'`).
    resolveHandles,
    HANDLE_DEFAULTS,
    // the xKey/yKey a mark reports back to the edit layer.
    positionalKeys, resolveValueAxis, orientationOf,
    // which field groups rows into a series (the line family).
    seriesFieldOf,
    // the style channels resolveStyle sweeps onto every node.
    STANDARD_STYLE_CHANNELS,
    // a chart element's unknown-option check.
    warnUnknownElementOptions,
    // the style names an axis treats as chrome rather than per-datum channels.
    AXIS_CHROME,
} from '../plot/mark.js';

// Band geometry on a discrete scale.
export {
    isBand, isDiscrete, bandwidthOf, bandStartOf, bandSpan, baselineOf, rangeExtent,
    // one category's slot, and the offset scale nested inside an axis.
    slotOf, slotWidthOf, offsetScaleOf,
} from '../core/scales.js';

// Polar geometry, for a mark drawn around a centre (arc / needle / axisRadial).
export {
    polarToXY, arcPath, arcSpine, arcSpan, angularBand, needleTriangle, degToRad,
    ORIENT_SPAN,
} from '../plot/polar.js';

// Parametric-line geometry shared by `trend` and `trendBand`.
export {
    paramChannels, readParams, anchorsOf, valueAt, lineSegment,
    envelopePolygon, nestedEnvelopes, sampleLines,
} from '../plot/trendGeometry.js';

// The shape table `link` draws from. A new connector shape is a row here.
export { LINK_SHAPES } from '../plot/linkGeometry.js';
// A `d`-only shape must return a sampled polyline, so picking and canvas can use it.
export { sampleQuadratic, sampleCubic } from '../plot/hitpath.js';

// Stack layout shared by stacked bars and pies.
export { groupByPosition, stackLayout, stackDescriptor } from '../plot/stack.js';

// Text measurement (one lazy context, safe under SSR). `noteBox` is `sticker`'s
// sizing rule, for sizing something else to match a note.
export { measureText, wrapText, noteBox } from '../core/measure.js';

// Option lists: every factory's vocabulary, and each chart element's.
export {
    MARK_OPTIONS, MARK_UNIVERSAL_OPTIONS, MARK_SHORTHANDS,
    ELEMENT_OPTIONS, ELEMENT_UNIVERSAL_OPTIONS,
    GUIDE_OPTIONS, GUIDE_UNIVERSAL_OPTIONS,
    EDIT_OPTIONS, EDIT_UNIVERSAL_OPTIONS, CONSTRAINT_OPTIONS,
} from '../vocabulary.js';
export { AXIS_OPTIONS, GRID_OPTIONS } from '../plot/axis.js';
export { LEGEND_OPTIONS } from '../plot/legend.js';
export { AXIS_RADIAL_OPTIONS } from '../plot/axisRadial.js';

// ── Writing an edit ─────────────────────────────────────────────────────────
// An edit is a descriptor. See the `Edit` interface in types.d.ts.
export {
    // the descriptor normalizer every edit factory is built on.
    makeEdit,
    // claim an edit for one tagged handle of a multi-handle feature.
    claimEdge,
    // strip a `pick` an edit cannot honour, and say so.
    claimPick,
    // compose an edit's own structural guard with an author-supplied `when`.
    andWhen,
    // the single seed-and-invert core every creator builds on.
    mintDatum,
    // identity for a minted row: a fresh series key, or a fresh category.
    nextSeriesKey, nextCategory,
    // invert the pointer through one channel's scale.
    invertChannel,
    // the whole-span-move computation moveSpan and the brush drivers share.
    recenterSpan,
    // the centre of a scene node, whatever shape it is.
    markCenter,
    // the node an edit is acting on, whichever pick strategy resolved it.
    resolveMarkNode,
    // pixel -> value on an arbitrary straight track (not the scale's own range).
    linearInvert,
    // a channel's [lo, hi] domain, and the discrete value set `cycle` steps through.
    channelDomain, discreteDomain,
    // where a keyboard nudge would put the pointer, asked of the scale.
    nudgeTarget,
} from '../edit/shared.js';

// A new row's starting values, from the schema.
export { schemaDefaults } from '../core/schema.js';

// Target selection. `pickThreshold`/`edgeInsetOf` give a driver its grab radius.
export {
    nearestMark, nearestSeries, nearestMarkOnAxis, distanceToMark, hitTest,
    pickThreshold, edgeInsetOf, DEFAULT_PICK_THRESHOLD,
} from '../edit/pick.js';

// Register a driver for a multi-event lifecycle (hover/dragstart/drag/dragend).
export { registerDriver } from '../edit/drivers/index.js';

// ── Writing a constraint ────────────────────────────────────────────────────
// The same function as the spec keyword `constraints.custom`.
export { defineConstraint } from '../constraints/define.js';

// ── Writing a widget ────────────────────────────────────────────────────────
// The built-in instruments' palette. Their guides (`optionRings`, …) are `guides.*`.
export { THEME } from '../widgets/theme.js';
// Resolve a widget's theme the way the engine resolves `spec.theme`.
export { widgetTheme } from '../widgets/shared.js';

// ── Chart-level services a custom mark may need ─────────────────────────────
// A geographic projection: apply / invert, and the tile arithmetic a basemap uses.
export { createProjection, projectPoint, invertPoint, projectBounds } from '../core/projection.js';
export { tileCover, tileUrl, isWebMercator } from '../core/tiles.js';
// The theme a mark reads its default ink from.
export { themeOf, markDefaults } from '../core/theme.js';
// The one way the library talks to a spec author. Never `console.warn` directly.
export { warn } from '../core/dev.js';
