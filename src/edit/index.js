// @ts-check
// edit/ — the EDIT vocabulary: how a gesture changes a channel's data. An edit is
// the inverse of encoding. Where `encode` maps data -> visual, an `edit` maps a
// gesture -> that channel's data, through the SAME scale.
//
// This namespace contains edits and nothing else. The primitives an edit is BUILT
// from — `makeEdit`, `mintDatum`, `invertChannel`, `nearestMark`, `registerDriver`
// — are `authoring.*`, so this list stays identical to the grammar's edit keywords.
//
// ── The descriptor ──────────────────────────────────────────────────────────
// An edit is a plain descriptor the engine routes to, never a closure with hidden
// state, built via `makeEdit`:
//   { type, gesture, channels, when, pick, scope, threshold, into, constrain,
//     guide, stage, advance, apply }
//     gesture   'drag' | 'click' | 'dblclick' | 'commit' — the raw gesture the
//               hand makes (distinct from the transform NAME: a `move` is a 'drag')
//     channels  channel names it governs; null = inject the channel it's placed on
//     when      (ctx) => boolean — arbitration (e.g. only on Shift-drag). See `when`.
//     pick      'direct' | 'nearest' | 'plane' | 'sweep' | 'draw' | 'brush' |
//               'brushRect' | 'probe' | string — how the gesture selects its target
//               (see edit/drivers). Custom picks register via registerDriver.
//     scope     null (universal) | the mark CAPABILITY it needs. The engine
//               dev-warns on a mismatch instead of letting it silently no-op.
//     constrain constraint(s) applied on this edit's commit (sugar)
//     guide     true to self-draw this edit's guide (constraint bounds / snap ring)
//     stage     active only in this stage of a multi-step elicitation; null = always
//     advance   probe only: a click settling a staged edit advances the stage
//     apply     (ctx) => datum | dataset | undefined — performs the edit
// Keys the descriptor doesn't know (edgeInset, resize, move, …) pass through
// makeEdit onto the edit, where its driver reads them — the one sanctioned way a
// driver (built-in or registerDriver'd) carries per-edit options.
//
// ── Where an edit goes ──────────────────────────────────────────────────────
// On a channel (co-located), for the simple case:
//   size: { field: "mag", edit: edit.slide() }   // linear magnitude (preferred)
//   size: { field: "mag", edit: edit.resize() }  // radial magnitude
// Or at mark level, for joint / arbitrary edits:
//   edits: [ edit.move({ channels: ["x", "y"] }), edit.line.anchor() ]
//
// ── Namespace vs scope ──────────────────────────────────────────────────────
// These are SEPARATE decisions and must stay so. The NAMESPACE says what an edit
// is ABOUT; `scope` names a mark capability the engine can check. `edit.network.*`
// is a namespace of three, and only `rewire`/`reverse` set `scope: 'network'` —
// `connect` goes on the NODE mark, which is an ordinary point/rect/composite with
// no network capability to declare, so scoping it would only produce a false
// warning. Namespace by subject; scope only when a real capability is required.

// ── Universal — work on any mark with the channels they govern ──────────────
// The transform NAME is the object outcome; the gesture is the physical action.
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

// Arbitration predicates for an edit's `when`. Part of the EDIT vocabulary — a
// `when` only ever appears inside an edit's options, and in a JSON spec it is an
// edit field (`"when": "shift"`).
export { when } from './when.js';

// ── Scoped families ─────────────────────────────────────────────────────────
// Each namespace names what its edits are ABOUT. The JS path is also the JSON
// keyword: `edit.line.draw()` <-> { "type": "line.draw" }.

import { anchor, newSeries, draw, sweep, removeSeries } from './line.js';

// Line-scoped: authoring edits that need SERIES grouping (a line-family
// capability), so they carry `scope: 'line'`.
export const line = { anchor, newSeries, draw, sweep, removeSeries };

import { scale as axisScale, categories as axisCategories } from './axis.js';

// Axis-scoped: these reshape the field's DOMAIN (the schema), not the dataset.
// `scale` = numeric/temporal drag; `categories` = discrete add/rename/remove.
// NOTE `categories()` returns an ARRAY of three edits — one authoring act that
// needs three descriptors. It is the one factory that does; spread it.
export const axis = { scale: axisScale, categories: axisCategories };

import { category as legendCategory, value as legendValue } from './legend.js';

// Legend-scoped: turn a legend into an input. Both read geometry only a legend
// stamps (a swatch's `category`, a ramp handle's band), so `scope: 'legend'`.
export const legend = { category: legendCategory, value: legendValue };

import { cut as stackCut, edge as stackEdge, merge as stackMerge } from './stack.js';

// Stack-scoped: the three things you can do to a whole that is divided among rows.
// `cut` divides a segment in two, `edge` moves value across a boundary, `merge`
// fuses two back into one — each preserving the group's total by construction.
// They need a mark that partitions a total (a `bar` with `stack`, or arc/pie/donut).
export const stack = { cut: stackCut, edge: stackEdge, merge: stackMerge };

import {
    intercept as trendIntercept,
    slope as trendSlope,
    interceptSpread as trendInterceptSpread,
    slopeSpread as trendSlopeSpread,
} from './trend.js';

// Trend-scoped: a parametric line is edited by its PARAMETERS, so each of these
// inverts the pointer through x/y and then solves for the one it owns.
export const trend = {
    intercept: trendIntercept,
    slope: trendSlope,
    interceptSpread: trendInterceptSpread,
    slopeSpread: trendSlopeSpread,
};

import { fill as waffleFill } from './waffle.js';

// Waffle-scoped: fill up to the exact cell under the pointer. Reads grid geometry
// only a waffle stamps.
export const waffle = { fill: waffleFill };

import {
    connect as networkConnect, rewire as networkRewire, reverse as networkReverse,
} from './network.js';

// Network-scoped: the gestures that build a network's TOPOLOGY. Creating and
// deleting a node are plain `create`/`remove` — a node table's `key` is what gives
// a minted row its identity (see mintDatum), not a special edit.
export const network = {
    connect: networkConnect, rewire: networkRewire, reverse: networkReverse,
};

import {
    move as geoMove,
    create as geoCreate,
    draw as geoDraw,
    dragVertex as geoDragVertex,
    removeVertex as geoRemoveVertex,
    brush as geoBrush,
    createRect as geoCreateRect,
} from './geo.js';

// Geo-scoped: edits placed through the chart's `projection` rather than through
// 1-D x/y scales.
//
// `draw`/`dragVertex`/`removeVertex`/`brush`/`createRect` belong here permanently:
// their DATA SHAPE is genuinely geographic — a coordinates ARRAY or a bounding box,
// neither of which is a single positional row.
//
// `move`/`create` are a different story. They duplicate the universal `move` and
// `create` and exist only because the projection is not yet a scale, so the
// pointer cannot be inverted through the ordinary channel path. Once it is, both
// go and plain `edit.move()` / `edit.create()` work on a geo mark unchanged.
export const geo = {
    move: geoMove,
    create: geoCreate,
    draw: geoDraw,
    dragVertex: geoDragVertex,
    removeVertex: geoRemoveVertex,
    brush: geoBrush,
    createRect: geoCreateRect,
};

// There is no `edit.face.*`. A face is a `composite` of ordinary marks
// (plot/face.js), so each parameter is a channel on a concrete part and takes the
// universal edits: `slide` on a mouth's curvature or an eye's rx/ry, `rotate` on a
// brow's angle, `move`/`resize` on the head. That namespace existed only to reach
// handles living on one feature behind a private drag descriptor — the arrangement
// the composite form removed.
