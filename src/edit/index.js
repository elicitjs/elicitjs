// @ts-check
// edit/ — the `edit` primitive: how a gesture changes a channel's data. It is the
// inverse of encoding. Where `encode` maps data -> visual, an `edit` maps a
// gesture -> that channel's data, through the SAME scale.
//
// An edit is a descriptor the engine routes to:
//   { type, gesture, channels, when, pick, scope, threshold, into, constrain,
//     guide, stage, advance, apply }
//     gesture   'drag' | 'click' | 'dblclick' | 'commit' — the raw gesture the
//               hand makes (distinct from the transform NAME: a `move` is a 'drag')
//     channels  channel names it governs; null = inject the channel it's placed on
//     when      (ctx) => boolean — arbitration (e.g. only on Shift-drag)
//     pick      'direct' | 'nearest' | 'plane' | 'sweep' | 'draw' | 'brush' |
//               'brushRect' | 'probe' | string — how the gesture selects its target
//               (see edit/drivers). Custom picks register via registerDriver.
//     scope     null (universal) | the mark family it needs: 'line' | 'arc' |
//               'waffle' | 'geo' | 'axis' | 'trend'. Each names a mark capability the engine
//               checks, so a misplaced edit warns instead of silently no-op'ing.
//     constrain constraint(s) applied on this edit's commit (sugar)
//     guide     true to self-draw this edit's guide (constraint bounds / snap ring)
//     stage     active only in this stage of a multi-step elicitation; null = always
//     advance   probe only: a click settling a staged edit advances the stage
//     apply     (ctx) => datum | dataset | undefined — performs the edit
// Keys the descriptor doesn't know (edgeInset, resize, move, …) pass through
// makeEdit onto the edit, where its driver reads them — the one sanctioned way
// a driver (built-in or registerDriver'd) carries per-edit options.
//
// Universal edits (any mark) live in basic.js; line-scoped authoring edits live in
// line.js and are grouped under `edit.line.*` so the scope is visible in the name.
//
// Placed on a channel (co-located) for the simple case:
//   size: { field: "mag", edit: elicit.edit.slide() }   // linear magnitude (preferred)
//   size: { field: "mag", edit: elicit.edit.resize() }  // radial magnitude
// Or at mark level for joint / arbitrary edits:
//   edits: [ elicit.edit.move({ channels: ["x", "y"] }), elicit.edit.line.anchor() ]

export { move, moveSpan, brushSpan, brushRect, slide, resize, rotate, cycle, create, toggle, remove, set, editText, legend, legendValue, select, custom, rank } from './basic.js';

export { when } from './when.js';
// Authoring kit — public so custom edits / marks can reuse the same primitives.
export { makeEdit, nextSeriesKey, nextCategory, invertChannel, recenterSpan, markCenter, schemaDefaults, linearInvert, channelDomain } from './shared.js';
export { nearestMark, nearestSeries, nearestMarkOnAxis, distanceToMark } from './pick.js';
export { registerDriver } from './drivers/index.js';

import { anchor, newSeries, draw, sweep, removeSeries } from './line.js';

// Line-scoped edits, namespaced so the API shows they need a `line` mark.
export const line = { anchor, newSeries, draw, sweep, removeSeries };

import { scale as axisScale, categories as axisCategories } from './axis.js';

// Axis-scoped edits, namespaced so the API shows they belong on an axis mark and
// reshape the field's DOMAIN (not the dataset). `scale` = numeric/temporal drag;
// `categories` = discrete add/rename/remove (returns an array of edits).
export const axis = { scale: axisScale, categories: axisCategories };

import { cut as stackCut, edge as stackEdge, merge as stackMerge } from './stack.js';

// Stack-scoped edits: the three things you can do to a whole that is divided among
// rows. `cut` divides a segment in two, `edge` moves value across a boundary,
// `merge` fuses two back into one — each preserving the group's total by
// construction. They need a mark that partitions a total (a `bar` with `stack`, or
// arc/pie/donut), so the scope is in the name like line/axis/geo.
export const stack = { cut: stackCut, edge: stackEdge, merge: stackMerge };

import { edge as arcEdge } from './arc.js';

// @deprecated `edit.arc.edge` is `edit.stack.edge` under its old name — a slice
// boundary and a stacked bar's boundary are one edit. Kept so existing specs run.
export const arc = { edge: arcEdge };

import {
    intercept as trendIntercept,
    slope as trendSlope,
    interceptSpread as trendInterceptSpread,
    slopeSpread as trendSlopeSpread,
} from './trend.js';

// Trend-scoped edits: a parametric line is edited by its PARAMETERS, so each of
// these inverts the pointer through x/y and then solves for the one it owns. They
// need a `trend`/`trendBand` mark, so the scope is in the name like line/arc/geo.
export const trend = {
    intercept: trendIntercept,
    slope: trendSlope,
    interceptSpread: trendInterceptSpread,
    slopeSpread: trendSlopeSpread,
};

// There is no `edit.face.*`. A face is now a `group` of ordinary marks
// (plot/face.js), so each parameter is a channel on a concrete part and takes the
// universal edits: `slide` on a mouth's curvature or an eye's rx/ry, `rotate` on a
// brow's angle, `move`/`resize` on the head. The namespace existed only to reach
// handles that lived on one feature with a private drag descriptor — which is the
// arrangement the group form removed.

import { fill as waffleFill } from './waffle.js';

// Waffle-scoped edit: fill up to the exact cell under the pointer. Reads the grid
// geometry only a waffle stamps, so the scope is in the name like line/arc/geo.
export const waffle = { fill: waffleFill };

import {
    move as geoMove,
    create as geoCreate,
    draw as geoDraw,
    dragVertex as geoDragVertex,
    removeVertex as geoRemoveVertex,
    brush as geoBrush,
    createRect as geoCreateRect,
} from './geo.js';

// Geo-scoped edits for the geo* mark family (chart `projection` apply/invert).
export const geo = {
    move: geoMove,
    create: geoCreate,
    draw: geoDraw,
    dragVertex: geoDragVertex,
    removeVertex: geoRemoveVertex,
    brush: geoBrush,
    createRect: geoCreateRect,
};
