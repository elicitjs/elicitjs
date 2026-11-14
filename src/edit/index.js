// @ts-check
// edit/ — the edit namespace: how a gesture changes a channel's data, through the
// same scale that encodes it. Spec keywords only; building blocks are `authoring.*`.
//
// An edit is a plain descriptor built by `makeEdit` (shared.js):
//   { type, gesture, channels, when, pick, scope, threshold, into, constrain,
//     guide, stage, advance, apply }
//     gesture   'drag' | 'click' | 'dblclick' | 'commit' | 'wheel'
//     channels  channel names it governs; null = the channel it's placed on
//     when      (ctx) => boolean — arbitration (e.g. only on Shift-drag)
//     pick      'direct' | 'plane' | a driver name — how the target is chosen
//     scope     null (universal) | the mark capability it needs
//     constrain constraint(s) applied on this edit's commit
//     guide     true to draw this edit's guide
//     stage     active only in this stage; null = always
//     advance   probe only: a settling click advances the stage
//     apply     (ctx) => datum | dataset | undefined
// Unknown keys pass through for the edit's driver.
//
// Placement: on a channel (`size: { field: "mag", edit: edit.slide() }`) or at
// mark level (`edits: [edit.move({ channels: ["x", "y"] })]`).
//
// Namespace (what the edit is about) and `scope` (a mark capability to check) are
// separate: `edit.network.connect` sets no scope because it goes on a node mark.

// ── Universal — work on any mark with the channels they govern ──────────────
export {
    // position
    move, moveSpan, brushSpan, brushRect,
    // magnitude, angle, discrete step
    slide, resize, rotate, cycle,
    // existence
    create, toggle, remove,
    // value
    set, editText, rank,
    // chart state (writes no data row)
    select,
    // escape hatch
    custom,
} from './basic.js';

// Arbitration predicates for an edit's `when`.
export { when } from './when.js';

// ── Scoped families ─────────────────────────────────────────────────────────
// A scoped edit's `type` is its dotted path (`edit.line.draw()` -> 'line.draw'),
// since drivers claim by type.

import { anchor, newSeries, draw, sweep, removeSeries } from './line.js';

// Line-scoped: need series grouping (`scope: 'line'`).
export const line = { anchor, newSeries, draw, sweep, removeSeries };

import { scale as axisScale, zoom as axisZoom, pan as axisPan } from './axis.js';
import { categories as scaleCategories } from './scale.js';

// Scale-scoped: edit the domain of the scale an axis or legend draws.
// `categories()` returns an array of three edits; spread it.
export const scale = { categories: scaleCategories };

// Axis-scoped: edit a positional axis's range.
export const axis = { scale: axisScale, zoom: axisZoom, pan: axisPan };

import { category as legendCategory, value as legendValue } from './legend.js';

// Legend-scoped: use a legend as an input.
export const legend = { category: legendCategory, value: legendValue };

import { cut as stackCut, edge as stackEdge, merge as stackMerge } from './stack.js';

// Stack-scoped: cut, resize and merge segments of a stacked bar or arc/pie/donut.
export const stack = { cut: stackCut, edge: stackEdge, merge: stackMerge };

import {
    intercept as trendIntercept,
    slope as trendSlope,
    interceptSpread as trendInterceptSpread,
    slopeSpread as trendSlopeSpread,
} from './trend.js';

// Trend-scoped: edit a parametric line's parameters.
export const trend = {
    intercept: trendIntercept,
    slope: trendSlope,
    interceptSpread: trendInterceptSpread,
    slopeSpread: trendSlopeSpread,
};

import { fill as waffleFill } from './waffle.js';

// Waffle-scoped: fill up to the cell under the pointer.
export const waffle = { fill: waffleFill };

import {
    connect as networkConnect, rewire as networkRewire, reverse as networkReverse,
} from './network.js';

// Network: build a network's links. Nodes use plain `create`/`remove`.
export const network = {
    connect: networkConnect, rewire: networkRewire, reverse: networkReverse,
};

import { nest as hierarchyNest } from './hierarchy.js';

// Hierarchy: build containment. `nest` goes on node marks, with no scope.
export const hierarchy = { nest: hierarchyNest };

import {
    move as geoMove,
    create as geoCreate,
    draw as geoDraw,
    dragVertex as geoDragVertex,
    removeVertex as geoRemoveVertex,
    brush as geoBrush,
    createRect as geoCreateRect,
} from './geo.js';

// Geo-scoped: edits through the chart's `projection`. `move`/`create` exist only
// because the projection is not yet a scale.
export const geo = {
    move: geoMove,
    create: geoCreate,
    draw: geoDraw,
    dragVertex: geoDragVertex,
    removeVertex: geoRemoveVertex,
    brush: geoBrush,
    createRect: geoCreateRect,
};

// There is no `edit.face.*`: a face is a composite, so its parts take the universal edits.
