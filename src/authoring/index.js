// @ts-check
// authoring/ — the kit for EXTENDING the library, kept out of the grammar.
//
// ── Why this module exists ──────────────────────────────────────────────────
// There are two audiences and they were sharing one namespace. A SPEC AUTHOR
// writes charts out of the grammar's vocabulary — `plot.bar`, `edit.move`,
// `constraints.clamp`. A MARK AUTHOR writes new vocabulary, and needs the
// internals a mark is built from — `encodeChannel`, `makeEdit`, `resolveHandles`.
// Before this split, `plot.*` exported 94 names for ~35 marks and `edit.*` 40 for
// ~22 edits, so autocomplete showed the implementation rather than the language.
//
// The rule is now: **a namespace contains only what can appear in a spec.**
// `plot.*` is marks, `edit.*` is edits, `constraints.*` is constraints,
// `guides.*` is guides, `elements.*` is chart elements, `widgets.*` is widgets.
// Everything you would only reach for while WRITING one of those lives here.
//
// That rule is not cosmetic. A JSON spec layer compiles a keyword to a factory,
// so a namespace's members are the grammar's keywords; `plot.arcPath` would
// become a mark name that draws nothing. Keeping the split honest keeps the
// grammar and the JS API the same list.
//
// Reachable two ways — as a namespace, or as a subpath so the grammar stays
// small in an editor that lists everything:
//
//   import * as elicit from 'elicitjs';
//   elicit.authoring.encodeChannel(…)
//
//   import { encodeChannel } from 'elicitjs/authoring';
//

// ── Writing a MARK ──────────────────────────────────────────────────────────
// The channel-resolution and style surface every mark builds on. See the mark
// contract at the top of plot/mark.js, and the `Mark` interface in types.d.ts.
export {
    // datum -> visual, through the channel's global scale. The one positional path.
    encodeChannel,
    // an arbitrary value -> visual, for a mark that computes the points it draws.
    encodeValue,
    // the `angle` channel -> math degrees.
    encodeAngle,
    // datum -> CATEGORY, the discrete-axis counterpart of encodeChannel.
    categoryOf,
    // the standard style channels, resolved onto a scene node.
    resolveStyle,
    // the `symbol` channel -> a glyph string, and the text node that draws one.
    resolveSymbol,
    symbolNode,
    // option intake: desugar the shorthands, warn on an unknown option.
    normalizeMarkOptions,
    // the four options every mark must pass through verbatim.
    markCommon,
    // one handle contract: radius, paint, and what `handles: true|false|'hit'` means.
    resolveHandles,
    HANDLE_DEFAULTS,
    // the xKey/yKey a mark reports back to the edit layer.
    positionalKeys, resolveValueAxis, orientationOf,
    // which field groups rows into a series (the line family).
    seriesFieldOf,
    // the style channels resolveStyle sweeps onto every node.
    STANDARD_STYLE_CHANNELS,
    // a CHART ELEMENT's option check — the diagnostics half, without the desugar
    // half, for a `views: 'scale'` feature that has no channels to desugar into.
    warnUnknownElementOptions,
    // the style names an axis treats as chrome rather than per-datum channels.
    AXIS_CHROME,
} from '../plot/mark.js';

// Band geometry: what a mark asks a discrete scale for once `categoryOf` has told
// it which category a row is in. Capability reads (`kind`), never a scale type.
export {
    isBand, isDiscrete, bandwidthOf, bandStartOf, bandSpan, baselineOf, rangeExtent,
} from '../core/scales.js';

// Polar geometry, for a mark drawn around a centre (arc / needle / axisRadial).
export {
    polarToXY, arcPath, arcSpine, arcSpan, angularBand, needleTriangle, degToRad,
    ORIENT_SPAN,
} from '../plot/polar.js';

// Parametric-line geometry — the model `trend` and `trendBand` share, for a mark
// over the same parameters.
export {
    paramChannels, readParams, anchorsOf, valueAt, lineSegment,
    envelopePolygon, nestedEnvelopes, sampleLines,
} from '../plot/trendGeometry.js';

// Connector geometry — the shape table `link` draws from. A new connector shape is
// a ROW in LINK_SHAPES, never a branch in the mark.
export { LINK_SHAPES } from '../plot/linkGeometry.js';
// A `d`-only shape must hand back a sampled polyline or the pick layer cannot
// measure it (and canvas cannot draw it).
export { sampleQuadratic, sampleCubic } from '../plot/hitpath.js';

// Stack layout — the three questions a stacked bar and a pie both ask, answered
// once. A third kind of stack is a row in the geometry table, not a new mark.
export { groupByPosition, stackLayout, stackDescriptor } from '../plot/stack.js';

// Text measurement — the ONE measuring context (lazy, guarded for SSR). A wrapped
// label is one node carrying `lines`, never one node per line.
//
// `noteBox` is `sticker`'s own sizing rule, reachable so a `link` docking to an
// auto-sized note can reach the same answer:
//   nodeWidth: { fn: d => noteBox(d.label).width }
// It sits here rather than at the package root because it can only ever appear
// inside a `{ fn }` channel — the one deliberately non-serializable channel form —
// so it can never become a JSON keyword, and because `measureText`/`wrapText`, its
// siblings from this same module, were already here.
export { measureText, wrapText, noteBox } from '../core/measure.js';

// Chart-element option VOCABULARIES — the list each element validates its options
// against (`warnUnknownElementOptions`). Exported so one list can drive the docs
// and, later, the JSON grammar. They are names of options, not spec keywords, so
// they belong here and not in `elements.*`.
// The option registry itself — every factory's vocabulary, one file, no imports.
export {
    MARK_OPTIONS, MARK_UNIVERSAL_OPTIONS, MARK_SHORTHANDS,
    ELEMENT_OPTIONS, ELEMENT_UNIVERSAL_OPTIONS,
    GUIDE_OPTIONS, GUIDE_UNIVERSAL_OPTIONS,
    EDIT_OPTIONS, EDIT_UNIVERSAL_OPTIONS, CONSTRAINT_OPTIONS,
} from '../vocabulary.js';
export { AXIS_OPTIONS, GRID_OPTIONS } from '../plot/axis.js';
export { LEGEND_OPTIONS } from '../plot/legend.js';
export { AXIS_RADIAL_OPTIONS } from '../plot/axisRadial.js';

// ── Writing an EDIT ─────────────────────────────────────────────────────────
// An edit is a descriptor, not a closure with hidden state. See the `Edit`
// interface in types.d.ts and the header of edit/index.js.
export {
    // the descriptor normalizer every edit factory is built on.
    makeEdit,
    // claim an edit for ONE tagged handle of a multi-handle feature.
    claimEdge,
    // strip a `pick` an edit cannot honour, and say so.
    claimPick,
    // compose an edit's own structural guard with an author-supplied `when`.
    andWhen,
    // the single seed-and-invert core every creator builds on.
    mintDatum,
    // identity for a minted row: a fresh series key, or a fresh category.
    nextSeriesKey, nextCategory,
    // invert the pointer through ONE channel's scale.
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

// The SCHEMA owns a field's type, domain and defaults — including the starting
// values a minted row gets. A creator reaches for this constantly.
export { schemaDefaults } from '../core/schema.js';

// Target selection. Use these rather than writing a second distance function.
// `pickThreshold`/`edgeInsetOf` are what a DRIVER reads its grab radius from.
export {
    nearestMark, nearestSeries, nearestMarkOnAxis, distanceToMark, hitTest,
    pickThreshold, edgeInsetOf, DEFAULT_PICK_THRESHOLD,
} from '../edit/pick.js';

// A multi-event lifecycle (hover/dragstart/drag/dragend) is a DRIVER, never a
// branch in the engine's dispatch. Register one here.
export { registerDriver } from '../edit/drivers/index.js';

// ── Writing a CONSTRAINT ────────────────────────────────────────────────────
// A constraint is a pure data invariant — no pixels, no scales-as-geometry. The
// SPEC keyword for the same act is `constraints.custom`, matching `edit.custom`
// and `guides.custom`; this is the authoring alias of it, kept because a mark or
// widget author reaches for it while building vocabulary rather than a spec.
export { defineConstraint } from '../constraints/define.js';

// ── Writing a WIDGET ────────────────────────────────────────────────────────
// The instrument palette, so a custom survey instrument reuses the same look as
// the built-in ones. The guide-built affordances that used to sit here
// (`prompt`, `optionRings`, `cellGrid`, `sliderTrack`, `crosshair`) are GUIDES —
// they appear directly in a spec's `guides: [...]` — so they moved to `guides.*`.
export { THEME } from '../widgets/theme.js';
// Resolve a widget's theme the way the engine resolves `spec.theme`.
export { widgetTheme } from '../widgets/shared.js';

// ── Chart-level services a custom mark may need ─────────────────────────────
// A geographic projection: apply / invert, and the tile arithmetic a basemap uses.
export { createProjection, projectPoint, invertPoint, projectBounds } from '../core/projection.js';
export { tileCover, tileUrl, isWebMercator } from '../core/tiles.js';
// The theme a mark reads its default ink from, off the scale map the engine stamps.
export { themeOf, markDefaults } from '../core/theme.js';
// The one way the library talks to a spec author. Never `console.warn` directly.
export { warn } from '../core/dev.js';
