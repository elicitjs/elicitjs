// @ts-check
// guides/ — the GUIDE vocabulary. A guide views chart STATE (`views: 'state'`):
// it draws the RULE and the STATE — what the interaction is doing, what it is
// allowed to do, and what is left to do.
//
// The three kinds of feature, and what each one views:
//
//   views      public name   one node per          channels name        writes
//   'data'     mark          a row                 columns of a table   rows
//   'scale'    element       a tick / swatch       (singular `channel`) the domain
//   'state'    guide         a derived statement   expressions          nothing
//
// Being DERIVED is not what makes a guide — a mark channel can already be derived
// (`{ fn }`). The discriminators are ARITY and WRITABILITY: a `{ fn }` channel is
// per-ROW and its mark may still carry an `edit`; a guide's expressions are
// per-CHART and it can never carry one. A guide has no table, no channel map and
// no row, by construction.
//
// Every guide option may be a literal or a function of the chart context, which is
// what lets a reference line be derived from the elicited rows rather than fixed.

// Reference geometry — a line or a band, positioned in DATA space through the
// scales, so it composes across scale types.
export { rule } from './rule.js';
export { region } from './region.js';
// What is left to do under a rule: the unallocated remainder of a budget.
export { remaining } from './remaining.js';
// The catchment of a proximity pick — how far a gesture reaches to find a mark.
export { proximity } from './proximity.js';
// The escape hatch: arbitrary read-only nodes from the live render context. Named
// `custom` to match `edit.custom` — one word for "author your own" in every
// grammar namespace (and `constraints.custom`).
export { custom } from './custom.js';

// Instrument affordances — the guide-built chrome a survey widget draws itself
// with: a question prompt, the option rings of a Likert scale, a matrix's cell
// grid, a slider's track, a correlation plot's crosshair frame. These ARE guides
// (they view chart state, write nothing, and appear directly in `guides: [...]`,
// which is how every built-in widget uses them — see widgets/likert.js), so they
// belong in this namespace. They used to sit in `authoring.*`, which put five
// spec keywords in the kit you build vocabulary FROM.
export { optionRings, cellGrid, sliderTrack, prompt, crosshair } from '../widgets/theme.js';
