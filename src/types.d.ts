import { ScaleLinear, ScaleBand, ScaleOrdinal } from 'd3';

export type Datum = Record<string, any>;

// How a channel DRAWS a field. Never written as `type` on a channel — that slot
// holds the data type. A scale type is named by `scale` (a string, or the `type`
// of a ScaleSpec). See scaleTypeFor in core/encoding.js for the routing.
// 'frame' is the one CHANNEL-SIDE-ONLY member: it marks a channel as belonging to
// an enclosing composite()'s local coordinate box rather than a global axis (see
// plot/composite.js). The composite builds a real per-datum linear scale for it
// (createFrameScale), so no RESOLVED scale ever carries type 'frame' and nothing
// downstream branches on it. `ChannelSpec.frame` is the short spelling.
export type ScaleType =
  | 'linear' | 'log' | 'symlog' | 'pow' | 'sqrt' | 'time'
  | 'band' | 'point' | 'ordinal' | 'sequential' | 'diverging'
  | 'frame';

// A field's MEASUREMENT type in the dataset schema (what the data means), as
// opposed to a ScaleType (how a channel draws it). scaleTypeFor translates one to
// the other per channel. `quantitative`/`temporal` are continuous;
// `categorical`/`ordinal` are discrete (ordinal's domain order is significant).
// `ref` is a REFERENCE: the value names a row of another table by its key. It is a
// statement about what the data means (this column identifies something elsewhere),
// which is why it lives here beside the other measures rather than in a join block.
// It behaves as a category everywhere a scale is concerned — a key IS a category —
// but its DOMAIN is derived from the column it points at, so the two can't drift.
export type MeasureType = 'quantitative' | 'categorical' | 'ordinal' | 'temporal' | 'ref';

// A scale's own configuration — everything about HOW a field is drawn that isn't
// the data's business. The domain is deliberately absent: it belongs to the data,
// and is declared once on the schema (see FieldSchema.domain).
export interface ScaleSpec {
  type?: ScaleType;
  range?: any[];
  // A named colour scheme (colour channels only), resolved to a `range` when the
  // channel names none: a categorical palette ('tableau10', 'category10', 'set2',
  // …) for a discrete field, or a diverging/sequential ramp ('RdBu', 'blues',
  // 'viridis', …). An explicit `range` still wins. See schemeRange in core/encoding.js.
  scheme?: string;
  // Flip the resolved range (after `range` / `scheme`). Useful for diverging
  // ordinal colour when the domain order is the opposite of the scheme's native
  // direction — e.g. D→R wants blue→red, which is `scheme: "RdBu", reverse: true`.
  reverse?: boolean;
  padding?: number;    // band / point
  nice?: boolean;      // continuous
  clamp?: boolean;     // continuous
  base?: number;       // log
  constant?: number;   // symlog — the width of the linear region around zero
  exponent?: number;   // pow
  // diverging — the DATA value the ramp's midpoint sits on (the neutral colour).
  // Defaults to 0 when the domain straddles it, else the domain's midpoint. Each
  // side is scaled independently, so the pivot keeps its colour on a lopsided
  // domain rather than drifting to the middle of the range.
  pivot?: number;
}

// One field of the elicited-dataset schema. Declares the field's measurement
// type and (optionally) its domain — [min,max] for quantitative/temporal, the
// ordered value list for categorical/ordinal — and a `default` used to populate
// the field when a datum is created (absent -> null, i.e. present but unset).
export interface FieldSchema {
  type: MeasureType;
  domain?: any[];
  default?: any;
  // Is the domain a CEILING or a STARTING SET? Closed (the default) means the
  // declared categories are the whole vocabulary: an edit that mints one — see
  // edit.stack.cut — assigns the next unused value and refuses once they run out,
  // and validateDataset reports a seed value outside the domain. `open: true`
  // means the domain grows: the cut appends a new category to the schema, and the
  // out-of-domain check is skipped because an unseen value is expected.
  //
  // Only meaningful for a discrete field. A field with no `domain` at all is open
  // by nature — resolveScales infers its domain from the data values.
  open?: boolean;
  // This field is the table's IDENTITY: the column a `ref` in another table points
  // at, and the one a gesture mints a new value into when it creates a row. At most
  // one per table. Pair with `open: true` so a gesture can mint an identity without
  // demanding the keyboard (see nextCategory in edit/shared.js).
  key?: boolean;
  // For a `ref` field: which column it points at.
  //   omitted        the NODES-role table's `key: true` field — the case essentially
  //                  every time, and why a link's source/target need no `to` at all
  //   'id'           that column of the nodes table, named explicitly
  //   'links.id'     a column of another table (table.column), for a cross-reference
  // A ref's domain is DERIVED from the target column, so it is never declared here.
  to?: string;
}

// Which rows of the dataset are READ-ONLY (see ElicitSpec.lock, core/lock.js).
// 'seed' (or true) fixes the rows the chart was seeded with — they are given, not
// elicited — and leaves every row an edit adds free. A predicate locks rows by
// what they are (`d => d.year <= 1990`).
// `table` is the name of the table the row belongs to — so one predicate can lock
// a network's seeded nodes while leaving its links free.
export type LockSpec =
  | 'seed'
  | boolean
  | ((datum: Datum, index: number, table?: string) => boolean);

// One TABLE's schema: what data is being elicited, keyed by field name. It is the
// source of truth for a field's scale (ranked above data inference), so a chart
// resolves its scales — and can mint new data — with zero starter data.
export type Schema = Record<string, FieldSchema>;

// ── Structure: which tables the dataset has ─────────────────────────────────
// A chart elicits ONE dataset; its STRUCTURE says what shape that dataset is —
// a set of named tables, each filling a ROLE the structure defines.
//
//   'table'   (the default)  one table, role `data`
//   'network'                roles `nodes` and `links`
//
// The NAME is the data key; the ROLE is what the structure means by it. Marks and
// edits resolve a table by ROLE, which is what lets an argument map call its tables
// `claims` / `supports` with no `table:` written anywhere. See core/schema.js for
// the role table (STRUCTURES) — adding a structure is a row there and nowhere else.
export type Structure = 'table' | 'network';

// A table in the author's LONG form. `role` is only needed when the table's NAME
// differs from the role it fills; a bare `Schema` in its place is the short form.
export interface TableSpec {
  role?: string;
  fields: Schema;
  // Links only: does an ordered pair of this table's `ref` columns mean a
  // DIRECTION? See TableSchema.directed — the flag is tri-state on purpose.
  directed?: boolean;
}

// `ElicitSpec.schema` as an author may write it. A bare field map is a single-table
// schema (the form every pre-structure spec uses, valid forever); the long form
// names its tables. normalizeSchema brings both to SchemaSpec.
export type SchemaInput =
  | Schema
  | { structure: Structure; tables: Record<string, Schema | TableSpec> };

// How a link is drawn between its two endpoints. A STYLE choice resolved per row,
// not a manipulable geometry: there are no anchor points to drag.
//   line                            straight
//   step | stepBefore | stepAfter   elbow off the chord between two POINTS
//   orthogonal                      elbow docked to each node's BOX, leaving it
//                                   perpendicular to an edge chosen from where the
//                                   two nodes sit (see `nodeWidth`/`nodeHeight`)
//   arc                             quadratic bow, signed by `curvature`
//   bezier | smooth                 cubic with axis-aligned tangents
//   loop                            implicit when source === target
export type LinkCurve =
  | 'line' | 'step' | 'stepBefore' | 'stepAfter' | 'orthogonal'
  | 'arc' | 'bezier' | 'smooth' | 'loop';

// Which edge of a node a routed connector leaves by. `auto` derives it from the two
// nodes' relative position. PRESENTATION, not data: stated on the mark or derived
// with `{ fn }`, and a column only if the spec explicitly points it at a field.
export type LinkSide = 'auto' | 'top' | 'right' | 'bottom' | 'left';

// Which ends of a link carry an arrowhead. `auto` means "the target end iff the
// links table declares `directed: true`", which is how a schema-level statement
// about the DATA reaches the drawing without the mark hard-coding a default.
export type LinkArrow = 'none' | 'target' | 'source' | 'both' | 'auto';

// One table, canonical: what every internal reader sees after normalizeSchema.
export interface TableSchema {
  // The table's name — its key in `data`, in `getData()`, and in a mark's `table`.
  name: string;
  role: string;
  fields: Schema;
  // The `key: true` field, or null. What a `ref` points at by default.
  key: string | null;
  // Links only. Does an ordered pair of this table's `ref` columns mean a
  // DIRECTION? TRI-STATE, and callers must keep all three apart:
  //   true       source→target is a direction — arrows by default, reciprocal
  //              pairs bow apart, `edit.network.reverse` is meaningful.
  //   false      the pair is unordered — `connect` refuses B→A once A→B exists.
  //   undefined  the schema has no opinion; every chart written before this flag
  //              existed, and the reason `arrow: 'auto'` resolves to none.
  // Read it through `isDirected(spec)` rather than reaching for the table.
  directed?: boolean;
}

// The canonical schema. `core/schema.js` is the only module that builds one, and
// every other reader takes it — so nothing re-sniffs how the author spelled it.
export interface SchemaSpec {
  structure: Structure;
  tables: Record<string, TableSchema>;
  // role -> table NAME. The indirection that makes table names renameable.
  byRole: Record<string, string>;
  // The primary table's NAME: `data` for a table, the `nodes` table for a network.
  // A bare-array `data` seeds this one, and a mark with no `table` draws it.
  primary: string;
}

// What a scale can DO, sniffed from the scale object itself and stamped once at
// creation/adoption. Marks, edits and axes branch on `kind` — never on `type`,
// which is only a label (an adopted d3 scale has no type at all, and a `log`
// scale behaves exactly like a `linear` one everywhere it matters).
//   band       -> occupies an interval per category (bandwidth)
//   point      -> a tick per category (no width)
//   continuous -> has invert(): linear, log, pow, sqrt, time, symlog
//   discrete   -> maps a value to a discrete output (ordinal, sequential ramp)
export type ScaleKind = 'band' | 'point' | 'continuous' | 'discrete';

export interface CustomScaleProperties {
  // A label, for axis tick formatting and debugging. NOT control flow.
  type?: ScaleType;
  kind: ScaleKind;
  // The domain holds Dates, so encode() coerces values before positioning.
  temporal: boolean;
  domainConfig?: any[];
  invertible: boolean;
  encode: (value: any, fallback?: any) => any;
  invertValue: (pixel: number) => any;
  domain?: () => any[];
  // The schema fields unioned onto this axis, in first-seen order (stamped by
  // resolveScales). Metadata for an editable axis: a domain edit writes each of
  // these fields' schema domains. Not a domain/range on the channel.
  fields?: string[];
}

export type Scale = (
  | ScaleLinear<any, any>
  | ScaleBand<any>
  | ScaleOrdinal<any, any>
  | ((v: any) => any)
) & CustomScaleProperties;

export interface ScaleMap {
  [channelName: string]: Scale;
}

/** Chart geographic projection (see core/projection.js createProjection). */
export interface ProjectionContext {
  apply(p: [number, number]): [number, number] | null;
  invert(p: [number, number]): [number, number] | null;
  path(object?: any): string | null;
  invertible: boolean;
  raw: any;
}

export interface ProjectionSpec {
  type?: string | ((...args: any[]) => any);
  domain?: any;
  rotate?: [number, number] | [number, number, number];
  parallels?: [number, number];
  precision?: number;
  clipAngle?: number;
  inset?: number;
  insetTop?: number;
  insetRight?: number;
  insetBottom?: number;
  insetLeft?: number;
  [key: string]: any;
}

export interface EditContext {
  data: Datum[];
  datum?: Datum;
  index?: number | null;
  pointer: { x: number; y: number };
  node: any | null;
  event: any;
  // A gesture-supplied payload value, for edits whose input isn't a pixel: the
  // text mark's content-edit `commit` carries the typed string here. Undefined
  // for pointer-only gestures.
  value?: any;
  // The edit's own target channels, resolved to { name, field, scale }.
  channels: ResolvedChannel[];
  scales: ScaleMap;
  // The whole mark's channel map (name -> ChannelSpec), for edits that need to
  // look up a sibling channel's field. Distinct from `channels` above.
  markChannels: Record<string, any>;
  // Plot pixel dimensions, for a gesture measured against the whole plane (e.g.
  // rotate about the plot centre by default; rotate({ pivot: 'mark' }) uses the
  // mark centre instead — the angular sibling of resize's mark-centre radius).
  width?: number;
  height?: number;
  // The chart's margins, so a grow-mode axis edit can turn an inner axis length
  // back into the chart's outer width/height. Rarely needed by other edits.
  margins?: { top: number; right: number; bottom: number; left: number };
  // The dataset schema, so a `create` edit can mint a datum carrying every
  // declared field (its default or null), not only the positional ones.
  schema?: Schema;
  xKey: string;
  yKey: string;
  // The feature's series (grouping) field and current scene nodes, for
  // proximity-aware edits (anchor / newSeries) and when.near|far.
  seriesKey?: string | null;
  marks?: FeatureNode[];
  // The line's ordering knob, so a create-as-you-drag (draw) edit can pick its
  // mode: 'sequence' -> freehand append; otherwise -> you-draw-it column upsert.
  order?: string | null;
  // The feature's transient per-gesture driver session: the zone/handle lock a
  // lifecycle driver classified at dragstart (brush/brushRect), a draw's mode +
  // locked series, an axis drag's handle snapshot. Read (and, for pointer
  // tracking, mutated) across a single press-drag. Set by the edit's driver.
  session?: Session | null;
  // Chart geographic projection when `ElicitSpec.projection` is set. Geo edits
  // invert the pointer through the same object geo marks use for apply/path.
  projection?: ProjectionContext | null;
  // The primary selected datum index (transient pipeline state — ui.selection),
  // or null. So an edit's apply/when can read or target the selection: edit.select
  // reads whether the touched row is already selected to decide toggle-off.
  selection?: number | null;
  // The edit being dispatched, so a `when` predicate can arbitrate against the
  // edit's own knobs (when.near reads its `threshold`). Purely informational.
  edit?: Edit;
}

export interface ResolvedChannel {
  name: string;
  field: string;
  scale?: Scale | null;
}

// The pure-data context a constraint reducer receives (defineConstraint). By the
// time it runs, gestures are already inverted to data space, so it sees only data.
export interface ConstraintContext {
  data: Datum[];
  oldData: Datum[];
  activeIndex: number | null;
  active?: Datum;
  field: string;
  value?: any;
  domain?: number[];
}

export interface Constraint {
  (newData: Datum[], oldData: Datum[], context: any): Datum[] | boolean | undefined;
  constraintType?: string;
  options?: any;
  field?: string;
  // A constraint's own boundary DRAWER (distinct from an Edit's boolean `guide`):
  // returns the scene nodes visualizing where it limits interaction.
  guide?: (ctx: any) => any[];
}

export interface Edit {
  type: string;
  // Stable handle an external controller addresses this edit by, via
  // `el.control(name)`. null (default) = not externally addressable; the edit
  // stays purely pointer/keyboard-driven. Naming an edit adds no dispatch path —
  // `el.control` synthesizes the same events the pointer does (see ElicitElement).
  name: string | null;
  gesture: string;
  channels: string[] | null;
  when: ((ctx: EditContext) => boolean) | null;
  pick: 'direct' | 'nearest' | 'plane' | 'sweep' | 'draw' | 'brush' | 'brushRect' | 'probe' | (string & {});
  // null = universal (any mark). Otherwise the mark FAMILY this edit needs, which
  // is also where it lives in the API (the scope shows in the name: edit.line.*,
  // edit.arc.*, edit.waffle.*, edit.geo.*, edit.axis.*). Each scope names a mark
  // capability flag — supportsSeries / supportsArc / supportsWaffle / supportsGeo /
  // isAxis — and the engine dev-warns when the mark it's attached to lacks it,
  // instead of leaving you a silently dead gesture. See SCOPE_CAPABILITY in
  // core/elicit.js.
  scope: 'line' | 'axis' | 'arc' | 'stack' | 'waffle' | 'geo' | 'trend' | 'network' | null;
  // Which TABLE this edit's proposal replaces, named by ROLE. Omitted (all but the
  // graph edits), it writes the table its own mark draws — which is what every edit
  // did before structures, and still is on a single-table chart. `edit.network.connect`
  // sets `'links'`: it is placed on a NODE mark, so its gesture lands on a node row
  // while its proposal is a link row.
  table?: string;
  threshold: number;
  // anchor()/draw(): which line a new point joins.
  into?: 'nearest' | 'new';
  // Edit-scoped constraint SUGAR (runs only on this edit's commit). The canonical
  // home for invariants is the dataset's `constraints` (plural), which hold for
  // every edit; `constrain` (singular) is a guard you want on just this one.
  constrain: Constraint[];
  // An edit self-draws its guide (constraint rules + proximity catchment + travel
  // track). Not to be confused with a Constraint's `guide`, which is a drawer
  // function. See GuideSpec / edit/guide.js.
  //   true                         → bounds + catchment at part defaults
  //   false / null                 → nothing
  //   { bounds, catchment, track, color } → per-part on/off + style
  guide: boolean | GuideSpec | null;
  /** @deprecated Prefer `guide: { color }` — still wins under a part's own colour. */
  guideColor: string | null;
  // Multi-stage gate: active only when it equals the engine's current stage;
  // null = always active. A uniform filter applied to every edit, like `gesture`
  // matching — not a mode branch. Set via a factory option: move({ stage: 1 }).
  stage: number | null;
  // probe-pick only: does a click that settles this edit advance the stage?
  // Default true; `advance: false` commits repeatedly within one stage.
  advance: boolean;
  // What this edit WRITES. Absent (the default) -> the dataset: apply returns a
  // datum (spliced at `index`) or a whole array. 'domain' -> the schema: apply
  // returns { domains: { [field]: any[] }, data?, resize? } and the engine writes
  // each field's schema domain (and optionally replaces the dataset / resizes the
  // chart). 'selection' -> the transient selection (ui.selection): apply returns
  // { __select: { index, exclusive?, toggle? } } and the engine updates which row
  // is selected — no dataset write, no undo entry, no `change` (edit.select). A
  // capability flag, read like the array-vs-datum classification — not an
  // interaction-mode branch. Used by edit.axis.* ('domain') and edit.select.
  target?: 'domain' | 'selection';
  // How this edit changes the dataset's SHAPE. The engine reads it to resolve
  // `activeIndex` — the datum a constraint repairs around — WITHOUT knowing which
  // edit is running, the same way `target` classifies the write destination:
  //   'append' -> a row was minted; the active one is the last.
  //   'delete' -> a row was dropped; no datum is active.
  //   null/absent -> the row at `index` is the active one (the common case).
  // Declare 'append' on a custom minting edit to get create()'s treatment. An edit
  // that both mints and drops (toggle), or appends many rows at once (newSeries,
  // draw), leaves this null: "the touched datum" has no single answer there.
  cardinality?: 'append' | 'delete' | null;
  // This edit is completed by TYPING, so a node its feature draws should open the
  // renderer's inline editor on double-click. A declared CAPABILITY, read by the
  // engine's tagging pass into `FeatureNode.editText` — which is why the engine
  // never has to ask whether an edit is an editText, and why a mark never has to
  // sniff its own edit list to decide whether its nodes are typable.
  inline?: boolean;
  // With `inline`: the editor is a textarea and Enter inserts a newline rather
  // than committing. Declared, never inferred from how tall the shape is drawn.
  multiline?: boolean;
  // A creator (create/toggle) stamps its `defaults` here so the dev-only create
  // guards can see which fields the author seeds (e.g. a rect's span endpoints) —
  // introspection only; the value the datum gets is applied inside `apply` via the
  // shared `mintDatum` core. Absent on non-creating edits.
  defaults?: Record<string, any>;
  apply: (ctx: EditContext) => any;
  // Driver-specific knobs (edgeInset, resize, move, …) PASS THROUGH makeEdit onto
  // the descriptor, where the edit's driver reads them (see edgeInsetOf in
  // edit/pick.js). That passthrough is the one sanctioned way a driver — built-in
  // or registered via registerDriver — carries per-edit options; there is no
  // side-channel or post-hoc attachment. They are typed on the factory options
  // (BrushSpanOptions etc.), not here, to keep the canonical fields strict.
}

// ---------------------------------------------------------------------------
// Edit factory options — what a caller passes to elicit.edit.* factories. Every
// factory takes EditOptions; the ones with extra knobs extend it below. Any
// canonical Edit field may be overridden here (gesture, pick, when, stage, …);
// keys the descriptor doesn't know pass through onto it for a driver to read
// (see the note on Edit.apply).
export interface EditOptions {
  // Stable handle for `el.control(name)` (see Edit.name).
  name?: string;
  // The raw gesture this edit claims: 'drag' | 'click' | 'dblclick' | 'commit'.
  gesture?: string;
  // Single-channel spelling of `channels` — every factory accepts either; the
  // singular wins when both are given (it also overrides a factory's default
  // `channels`, e.g. toggle's ['x']).
  channel?: string;
  channels?: string[];
  when?: (ctx: EditContext) => boolean;
  pick?: Edit['pick'];
  // Proximity radius in px for nearest-style target resolution — also what
  // when.near/when.far arbitrate with, so the two always agree.
  threshold?: number;
  // Edit-scoped constraint sugar (see Edit.constrain).
  constrain?: Constraint | Constraint[];
  guide?: boolean | GuideSpec;
  /** @deprecated Prefer `guide: { color }`. */
  guideColor?: string;
  stage?: number;
  advance?: boolean;
  cardinality?: 'append' | 'delete' | null;
  // Driver-specific knobs pass through onto the descriptor.
  [key: string]: any;
}

export interface CreateOptions extends EditOptions {
  // Seed values for the minted datum's NON-positional fields (group, mag, …), applied
  // over the schema defaults and under the inverted pointer by the shared `mintDatum`
  // core. Also where an EXTENT mark (a rect drawn from x1/x2 or y1/y2 spans) supplies
  // its size, so a new row isn't minted zero-size (warnCreateEmptyExtent flags a miss).
  defaults?: Record<string, any>;
}

export interface ToggleOptions extends CreateOptions {}

export interface RotateOptions extends EditOptions {
  // 'plot' (default) rotates about the plot centre; 'mark' about the hit node.
  pivot?: 'plot' | 'mark';
  // Fold into (-90, 90] for direction-agnostic lines (default); false for dials.
  fold?: boolean;
  // Another angular channel to measure the absolute angular distance from.
  relativeTo?: string;
}

// Options for the TREND-scoped edits (edit.trend.*). Each one inverts the pointer
// through x/y and solves for the line parameter it owns, so the only extra knobs
// are the two x positions that define the frame — the same pair the mark takes,
// and normally inherited from it.
export interface TrendEditOptions extends EditOptions {
  // The pivot: the x whose value is held while the line rotates, and where an
  // intercept drag places the line. Defaults to 0 when 0 is in the x domain.
  anchor?: number;
  // The x a HANDLE drag measures at. Ignored when the gesture carries no node (a
  // plane/probe pick), where the pointer's own x is used so the line follows the
  // cursor. Defaults to the x domain's other end.
  probe?: number;
}

export interface MoveOptions extends EditOptions {
  // 'absolute' (default): the pointer's POSITION is the value — stateless, and what
  // a plane/nearest pick requires. 'relative': the value moves by the drag DELTA
  // from where you grabbed, preserving the grab offset, which is what a mark with
  // real AREA needs (pressing a sticker near its corner must not teleport its
  // centre to the pointer). Relative is direct-pick and uses the `move` driver's
  // dragstart snapshot.
  mode?: 'absolute' | 'relative';
}

export interface SlideOptions extends EditOptions {
  // Which pointer coordinate drives the value (default 'x').
  axis?: 'x' | 'y';
  // The direction that RAISES the value: 'left'|'right' for axis:'x',
  // 'up'|'down' for axis:'y' (default 'left'/'up').
  increase?: 'left' | 'right' | 'up' | 'down';
  // Pixel span that traverses the full domain. Defaults to the glyph radius for a
  // channel resolved in a composite's local frame, else 120.
  extent?: number;
  // 'relative' (default): the value moves by the drag DELTA from where you
  // grabbed, so there is no jump. 'absolute': the value is read off the pointer's
  // POSITION on a fixed track centred on the mark — stateless, but correct only
  // when the handle already sits at its value's place on that track (a dot on a
  // rail); otherwise pressing the mark teleports the value. Both are direct-pick.
  mode?: 'absolute' | 'relative';
}

export interface BrushSpanOptions extends EditOptions {
  // Edge-zone radius in px: a grab within this of an endpoint resizes that edge;
  // beyond it, the body translates. Read by the brush/brushRect driver.
  edgeInset?: number;
}

export interface BrushRectOptions extends BrushSpanOptions {
  // Which axes' edges/corners are live for resizing.
  resize?: 'both' | 'x' | 'y' | 'none';
  // Whether a body drag translates the whole rect.
  move?: boolean;
}

export interface AnchorOptions extends EditOptions {
  // Which line a new point joins: the closest within threshold, or a fresh one.
  into?: 'nearest' | 'new';
  // The series (grouping) field; defaults to the mark's own.
  series?: string;
}

export interface NewSeriesOptions extends EditOptions {
  // The independent axis the line runs ALONG, and the axis it carries a value on.
  along?: 'x' | 'y';
  value?: 'x' | 'y';
  // Domain positions to seed anchors at (see core/samples.js resolveSamples):
  // a count, explicit positions, or a time interval; default = the scale's ticks.
  samples?: any;
  series?: string;
}

export interface DrawOptions extends NewSeriesOptions {
  // Freehand pointer-sampling distance in px.
  minDist?: number;
  into?: 'nearest' | 'new';
}

// edit.legend (a category picker) reads the clicked swatch's `node.category`; it
// carries no layout of its own — the `plot.legend()` mark owns geometry. Kept as a
// named type for the picker's few knobs (all inherited from EditOptions today).
export interface LegendEditOptions extends EditOptions {}

// edit.select (a selection edit). Selection is transient pipeline state, so these
// knobs govern set semantics, not a data write.
export interface SelectEditOptions extends EditOptions {
  // Selecting a row clears the rest (default true). false adds to the selection —
  // forward-looking, since ui.selection is a Set; single-exclusive today.
  exclusive?: boolean;
  // Clicking the already-selected row deselects it (default true). false makes a
  // click always select, never toggle off.
  toggle?: boolean;
}

// The result an edit with `target: 'domain'` returns from apply(): the schema
// domains to write, plus (for a coupled schema+data edit like category-remove) a
// replacement dataset, and (for grow-the-chart numeric drag) a chart resize hint.
export interface DomainEditResult {
  domains: Record<string, any[]>;
  data?: Datum[];
  resize?: { width?: number; height?: number };
}

// A derived-channel accessor: computed per datum in VISUAL space (its result is
// used as-is, never scaled). `i`/`data` are supplied by per-datum marks and may
// be undefined at constant-resolving call sites.
export type ChannelFn = (d: Datum, i?: number, data?: Datum[]) => any;

// A single channel binding on a mark (Observable Plot's model, declarative).
// One of:
//   { field }              a data field, through the channel's global scale
//   { value }              a VISUAL-space constant — skips the scale entirely
//                          (`fill: 'red'` desugars to this)
//   { datum }              a DATA-space constant — goes THROUGH the scale, so
//                          `y: { datum: 25 }` lands at the pixel where y=25 is
//   { field, scale: null } a raw field, read unscaled (the datum already holds a
//                          literal colour / pixel)
//   { fn }                 a DERIVED channel — fn(d, i, data) computed per datum
//                          in VISUAL space (result used as-is, never scaled), e.g.
//                          `fill: d => d.x > 50 ? 'red' : 'blue'`
// The first four stay serializable/introspectable. `{ fn }` is the one deliberate
// exception: opaque to the edit layer, so a derived channel is READ-ONLY — it
// can't carry an `edit` (dev-warned + ignored). Put edits on the source field's
// channel; the fn re-derives from the committed rows on every render. A function
// shorthand (`fill: d => …`) desugars to `{ fn }`; an explicit `{ value: someFn }`
// stays an opaque constant, never invoked.
export interface ChannelSpec {
  field?: string;
  value?: any;
  datum?: any;
  // Derived channel: computed per datum in VISUAL space (result used as-is, never
  // scaled — on `y` it is a pixel). READ-ONLY: an `edit` here is ignored (put it on
  // the source field's channel — the fn re-derives after every commit). On a
  // line-family mark a paint fn (fill/stroke) runs once per SERIES, against the
  // series' first row. i/data are supplied by per-datum marks, undefined elsewhere.
  fn?: ChannelFn;
  // The field's DATA type. Overrides the schema's declaration for this channel;
  // useful for a field the schema doesn't cover. Below an explicit `scale`.
  type?: MeasureType;
  // The scale, by name (`'log'`), by spec (`{ type: 'sqrt', range: [4, 20] }`),
  // as a live d3 scale (adopted as-is; see adoptScale in core/scales.js), or
  // `null` to read the field unscaled. `'frame'` / `{ type: 'frame', range }` is
  // the long spelling of `frame` below.
  scale?: ScaleType | ScaleSpec | Function | null;
  // LOCAL to the enclosing composite's box, and what switches that composite into
  // box mode (plot/composite.js). Three forms:
  //   frame: -0.4          a pinned local position — x/y in [-1, 1] from the
  //                        glyph's centre with y UP, magnitudes (size/rx/ry/
  //                        strokeWidth) as a fraction of its half-size
  //   frame: [lo, hi]      map `field`'s SCHEMA domain onto that slice of the box
  //   frame: true          map `field` onto the channel's default local range
  // Desugars to `scale` (normalizeFrameKey in core/encoding.js), which stays the
  // single reader. An explicit `scale` wins. `{ value }` still means PIXELS here
  // as everywhere — inside a glyph you almost never want one, which is why the
  // local spelling is the short one.
  frame?: number | number[] | boolean;
  // Makes the channel writable: a gesture inverts back to `field` through this
  // same scale. Collected by edit/route.js's collectEdits.
  edit?: Edit;
}

// The standard style channels every mark understands. A field drives them
// through a scale (colour palette for fill/stroke, opacity ramp for the opacity
// family); a `{ value }` (or top-level shorthand) sets a constant.
export interface StyleChannels {
  fill?: ChannelSpec;
  stroke?: ChannelSpec;
  strokeWidth?: ChannelSpec;
  opacity?: ChannelSpec;
  fillOpacity?: ChannelSpec;
  strokeOpacity?: ChannelSpec;
}

export interface Channels extends StyleChannels {
  x?: ChannelSpec;
  y?: ChannelSpec;
  // Explicit span endpoints (bar's x1/x2 or y1/y2): alternative to x/y for a
  // value that doesn't start at the baseline. Share x/y's resolved scale (see
  // core/encoding.js's axisOf / core/resolve.js's axis-bucketed aliasing).
  x1?: ChannelSpec;
  x2?: ChannelSpec;
  y1?: ChannelSpec;
  y2?: ChannelSpec;
  // Circle radius in px. Constant form is the `size` shorthand, not resolveStyle.
  size?: ChannelSpec;
  // Categorical glyph channel: a category -> an emoji / unicode shape through an
  // ordinal scale, exactly like `fill` maps a category -> a colour. A shape mark
  // (point / dotStack / waffle) renders the glyph as text in place of its
  // circle/rect. Supply the glyphs with `scale: { range: ['😢','😐','😊'] }` or a
  // named `scale: { scheme: 'faces' }`; edit it with cycle()/legend() (the field
  // holds the category — the glyph is its encoding). Non-positional, non-invertible.
  symbol?: ChannelSpec;
  // Text mark channels: the label string, its size/anchors/offsets (read RAW,
  // not scaled — constant forms are shorthands). `format` is a mark-level option
  // (string | fn), not a channel — see MarkOptions.
  text?: ChannelSpec;
  fontSize?: ChannelSpec;
  textAnchor?: ChannelSpec;   // horizontal: 'start' | 'middle' | 'end'
  lineAnchor?: ChannelSpec;   // vertical: 'top' | 'middle' | 'bottom'
  dx?: ChannelSpec;           // horizontal pixel offset
  dy?: ChannelSpec;           // vertical pixel offset
  // Orientation in math degrees (0° = +x, CCW, y-up). Scaled when a scale is
  // declared so rotate() is an exact inverse; else raw. Marks that emit geometry
  // (point/rect/tick/text/…) stamp it on FeatureNode.angle; the renderer applies
  // SVG rotate(-deg) about the mark centre. Also the primary channel of needle /
  // axisRadial / needle (default range [180, 0] = left→right through the top).
  // Arc/pie slice magnitude is `value`, not `angle` — a slice's share is a quantity
  // the layout turns into a sweep, not an orientation.
  angle?: ChannelSpec;
  [channel: string]: ChannelSpec | undefined;
}

// The shared option surface for every mark factory (bar, point, and new marks).
// `channels` carries the bindings; the shorthands are sugar that desugar into
// constant channels via normalizeMarkOptions (an explicit `channels` entry wins).
//
// A mark NEVER owns data: `Elicit` owns the one dataset, and a mark is a view
// over it that encodes some columns and may edit them. There is no `data` or
// `onChange` here — both live on ElicitSpec. Nor does it own a domain: that is
// the data's, declared once on the schema.
export interface MarkOptions {
  channels?: Channels;
  // Constant shorthands — e.g. `fill: 'steelblue'`, `strokeWidth: 2`, `size: 9`.
  // A FUNCTION shorthand (`fill: d => d.x > 50 ? 'red' : 'blue'`) desugars to a
  // derived channel (`{ fn }`), computed per datum in visual space (read-only).
  fill?: any;
  stroke?: any;
  strokeWidth?: number | ChannelFn;
  opacity?: number | ChannelFn;
  fillOpacity?: number | ChannelFn;
  strokeOpacity?: number | ChannelFn;
  size?: number | ChannelFn;
  // Text-mark shorthands (desugar into raw channels via normalizeMarkOptions).
  text?: any;
  fontSize?: number | ChannelFn;
  textAnchor?: 'start' | 'middle' | 'end' | string | ChannelFn;
  lineAnchor?: 'top' | 'middle' | 'bottom' | string | ChannelFn;
  dx?: number | ChannelFn;
  dy?: number | ChannelFn;
  // Orientation shorthand (math degrees) — desugars to channels.angle.
  angle?: number | ChannelFn;
  // Text-mark display formatter: a d3-format string or `(value) => string`.
  // Display-only — the underlying field stays the raw value. See `elicit.format`.
  format?: string | ((v: any) => string);
  id?: string;
  edits?: any[];
  // Sugar. Constraints are DATASET invariants; declaring them on a mark is a
  // convenience, and the engine promotes them into the chart-wide set (so they
  // gate every edit, from every mark, over the same rows). ElicitSpec.constraints
  // is the canonical home.
  constraints?: Constraint[];
  [key: string]: any;
}

// A face's parameter names. Each is a CHANNEL that the face preset forwards to a
// concrete channel on one of its parts (mouthCurve -> the mouth curve's
// `curvature`, eyeSquint -> the eyes' `ry`, browTilt -> the brows' `angle`, …).
// Bind a field with `{ field }` and attach the edit you want; pin a fixed
// expression with `{ value: 0..1 }` (a fraction of that parameter's travel);
// leave it out for neutral (0.5).
export type FaceParam =
  | 'mouthCurve' | 'mouthAsym'
  | 'eyeScale' | 'eyeSquint'
  | 'browHeight' | 'browTilt';

// A face's channel map: the ordinary positional/style channels plus the face
// params.
export type FaceChannels = Channels & Partial<Record<FaceParam, ChannelSpec>>;

// Options for the FACE preset (an emotion glyph). `face()` is not a mark: it
// returns a `composite` of ordinary marks in box mode — a head `point`, two
// `ellipse` eyes, two `tickY` brows and a `curveY` mouth — each placed in the
// glyph's local box. So every part is its own feature with its own direct-pick
// edit, and a parameter is edited with the universal edits (`slide` on a
// curvature or a radius, `rotate` on a brow's angle, `move`/`resize` on the
// composite's own x/y/size) rather than a face-specific namespace.
//
// Bind NO param for the emotion preset (mouthCurve ← valence, eyeScale ←
// arousal); binding any one replaces it. The centre is placed by the x/y channels
// when present, else the plot centre; `size` is the face's radius and also the
// frame's half-size, so every feature scales with it. See plot/face.js.
export interface FaceOptions extends MarkOptions {
  // The channel map, including the face params as `{ field }` / `{ value }`.
  channels?: FaceChannels;
  // Face radius in px (or a field, for a per-row size). Default: half a category
  // slot when the face sits in one, else min(width, height) * 0.35.
  size?: number;
  // The colour of the drawn FEATURES (eyes, brows, mouth). The head's own paint is
  // the ordinary `fill` / `stroke`.
  ink?: string;
}

// `link` — one row of the links table drawn between the two nodes it references.
// Nearly everything is a schema read, so a bare `link()` works; these are the
// drawing choices the schema can't state. `curve` and `arrow` are also readable
// PER ROW as channels (`channels: { curve: { field: 'kind' } }`), which is how one
// link mark draws several kinds of connector.
export interface LinkOptions extends MarkOptions {
  // The node column holding identities. Defaults to the node table's `key: true`
  // field — an override only for a table that declares none.
  key?: string;
  // Connector shape. Default 'line'; promoted to 'arc' when separation bows it.
  curve?: LinkCurve;
  // Apex offset as a fraction of the chord. 'auto' (the default) asks the TABLE:
  // links sharing a pair of nodes fan apart, a lone link stays straight.
  curvature?: number | 'auto';
  // The step between adjacent links of one pair under `curvature: 'auto'`.
  spread?: number;
  // Which ends carry an arrowhead. Default 'auto' — the target end iff the links
  // table declares `directed: true`.
  arrow?: LinkArrow | boolean;
  arrowSize?: number;
  // Pull the ends in, so a link stops short of a node instead of running under it.
  inset?: number;
  sourceInset?: number;
  targetInset?: number;
  // How far a self-loop reaches from its node, in px.
  loopRadius?: number;
  // The node RECTANGLE a `curve: 'orthogonal'` connector docks to, in px. A
  // constant here, a column on the node table (`channels: { nodeWidth: { field:
  // 'w' } }`), or derived (`{ fn: d => noteBox(d.label).width }` for an auto-sized
  // sticker). With neither stated the connector falls back to a small square about
  // the node's position, so a bare `orthogonal` still leaves each node square-on.
  nodeWidth?: number;
  nodeHeight?: number;
  // Corner rounding for the routed connector, in px. Default 0 (square corners).
  // The corner is sampled into the same polyline, so a rounded link stays
  // grabbable and canvas-drawable.
  cornerRadius?: number;
  // Which edge each end leaves by. Default 'auto' — chosen from where the two
  // nodes sit. Also readable per row as a channel, like `curve` and `arrow`.
  sourceSide?: LinkSide;
  targetSide?: LinkSide;
  // A plate behind `channels.text`, so a label sitting on its own connector stays
  // readable. Off by default. `true` takes the theme's backdrop (white when the
  // theme leaves it transparent); a colour string sets it outright.
  labelBackground?: boolean | string;
  // Space between the label and the plate's edge, in px (default 3).
  labelPadding?: number;
  // The plate's corner radius, in px (default 3).
  labelRadius?: number;
  // The plate's fill opacity (default 0.9) — lower it to let the connector show
  // through the mask.
  labelOpacity?: number;
  format?: string | ((v: any) => any);
}

// `sticker` — a rounded box with text in it, sized by the text. A preset over
// `composite`: a `rect` that owns every edit, and an inert `text` drawn on top.
export interface StickerOptions extends MarkOptions {
  // Space between the text and the box's edge, in px.
  padding?: number;
  // Corner radius, in px.
  radius?: number;
  // The box stops growing here and the text wraps instead.
  maxWidth?: number;
  minWidth?: number;
  minHeight?: number;
  // Baseline step between wrapped lines, in px. Defaults to 1.35 × the font size.
  lineHeight?: number;
  // Used for MEASUREMENT as well as drawing, so the box matches what is painted.
  fontSize?: number;
  fontFamily?: string;
  format?: string | ((v: any) => any);
}

// `edit.network.connect` — drag from one node to another to create a link.
export interface NetworkConnectOptions extends CreateOptions {
  // Endpoint columns, when they aren't the link table's two `ref`s in order.
  source?: string;
  target?: string;
  // How near the pointer must come to a node for the drag to land on it.
  threshold?: number;
  // Allow a link from a node to itself. Off by default: meaningless in an
  // argument map, meaningful in a flowchart, so it is a choice rather than a rule.
  selfLoops?: boolean;
}

// `edit.network.rewire` / `edit.network.reverse`.
export interface NetworkEndpointOptions extends EditOptions {
  source?: string;
  target?: string;
  threshold?: number;
}

// A parametric line's channel map: the ordinary positional/style channels plus the
// PARAMETERS of the line. `intercept`/`slope` are the line itself; the uncertainty
// is named either symmetrically (`interceptSpread`/`slopeSpread`, a half-width in
// the field's own units) or as an explicit asymmetric range (`intercept1`/
// `intercept2`, `slope1`/`slope2` — the same 1/2 span spelling `area` and `rect`
// use). The range form wins when both are declared.
//
// All of them are UNSCALED: parameters read in their own units and projected
// through x/y, not encoded themselves. Bind a field to make one editable, or pin it
// with `{ datum }` — `intercept: { datum: 0 }` is what makes a trend a correlation.
export type TrendParam =
  | 'intercept' | 'slope'
  | 'interceptSpread' | 'slopeSpread'
  | 'intercept1' | 'intercept2' | 'slope1' | 'slope2';

export type TrendChannels = Channels & Partial<Record<TrendParam, ChannelSpec>>;

// The two x positions a parametric line is edited at. Shared by `trend`,
// `trendBand` and the trend-scoped edits so a handle pivots exactly where it sits.
export interface TrendAnchorOptions extends MarkOptions {
  channels?: TrendChannels;
  // The pivot: where the intercept handle sits, and the point a slope drag holds
  // fixed. Defaults to 0 when 0 lies in the x domain, else the domain's first end.
  anchor?: number;
  // Where the slope handle sits. Defaults to the x domain's other end.
  probe?: number;
  // true | false | 'hit' — the shared handle contract (plot/mark.js).
  handles?: boolean | 'hit';
  handleSize?: number;
  handleColor?: string;
}

// Options for a TREND mark: the line y = intercept + slope*x, clipped to the plot,
// with a handle at `anchor` (translate) and one at `probe` (rotate about the
// anchor). Its positional channels name the plot's AXES; the belief lives in the
// parameter channels. Stage via the edits (`edit.trend.slope({ stage: 1 })`),
// not mark options. See plot/trend.js.
export interface TrendOptions extends TrendAnchorOptions {}

// Options for a TREND BAND mark: the uncertainty around a parametric line, drawn
// as the envelope of every line the belief allows. Declares no edits of its own —
// it is a view of the same rows the line's handles write. See plot/trendBand.js.
export interface TrendBandOptions extends TrendAnchorOptions {
  // How the family is drawn: one exact envelope polygon (default), `levels` nested
  // envelopes stacked so the ink darkens toward the line, or `samples` individual
  // lines drawn from it.
  render?: 'region' | 'gradient' | 'samples';
  // 'gradient' only: how many nested envelopes. Default 5.
  levels?: number;
  // 'samples' only: how many lines, and the seed that keeps the fan stable across
  // re-renders. Defaults 60 and 7.
  samples?: number;
  seed?: number;
  // 'samples' only: 'normal' (default) treats the bounds as a `sigma`-wide envelope
  // so ~95% of draws land inside it; 'uniform' spreads flat across them.
  distribution?: 'normal' | 'uniform';
  // The envelope half-width, in standard deviations, when sampling normally.
  // Default 1.96.
  sigma?: number;
}

// Options for a COMPOSITE mark (a glyph): a named group of ordinary marks over
// the shared dataset. Each part encodes some columns; a part carrying an `edit`
// on a channel is a handle. `composite` returns the parts as an array of features
// (Elicit flattens it) — it is a desugaring, not a new kind of feature.
//
// It has TWO MODES, one rule apart, and a part switches between them:
//
// PLAIN — every part stands on the chart's own axes (an error bar's caps are
// positions on y). Composite-level `channels` (and style/angle shorthands) merge
// into every part at desugar time; a part's own channel for the same name wins.
// Inherited `edit`s attach to the last part only (visuals first, handles last) so
// one dataset does not get the same edit applied twice.
//
// BOX — a part states a channel in LOCAL units (`ChannelSpec.frame`), and the
// composite becomes a per-datum box. Its own `x`/`y`/`size` then place and size
// that box instead of trickling down: local +1 on x is `origin + size`, local +1
// on y is `origin - size` (local y is UP), a magnitude of 1 is `size`. Each local
// channel becomes a real, invertible per-datum scale (createFrameScale), so marks
// encode and edits invert through the same object with no bespoke geometry on
// either side. A local part that states no x/y sits at the box's ORIGIN — parts
// do not repeat the composite's placement. A part with no local channel at all
// keeps its ordinary build over the global scales.
//
// In box mode the returned array is led by the BOX: a feature carrying the
// composite's x/y/size (so the global resolver builds the axes the origin is
// measured against) that draws one transparent hit circle per row beneath every
// part — which is what makes a `move()` on the composite's `x` pick the whole
// glyph up while a drag on one part still edits only that part.
export interface CompositeOptions {
  // The sub-marks, in z-order: visual parts first, handles last.
  parts?: any[];
  id?: string;
  // Shared channel map. In plain mode every part inherits it (part keys win). In
  // box mode `x`/`y`/`size` are withheld — they define the box — and everything
  // else (fill, opacity, angle, …) still trickles.
  channels?: Channels;
  // Constant shorthands desugared into composite channels (same list as MarkOptions).
  fill?: any;
  stroke?: any;
  strokeWidth?: number;
  opacity?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  size?: number;
  angle?: number;
  // Stamped onto any part that doesn't declare its own (a glyph usually sits in a
  // band slot). See plot/composite.js.
  discreteScale?: 'band' | 'point';
  // Composite-level data invariants; promoted to the dataset like any mark's.
  constraints?: Constraint[];
  // Mark-level edits. Ride the last part in plain mode; in box mode they ride the
  // box, whose channel map holds the glyph's placement columns.
  edits?: Edit[];
  [key: string]: any;
}

// `group` was a separate mark for box mode before the two were merged; it is an
// alias of `composite` now, and this is an alias of its options.
export type GroupOptions = CompositeOptions;

/**
 * What a mark factory returns — the feature object the engine consumes.
 *
 * This contract used to live ONLY as prose at the top of plot/mark.js, with every
 * factory annotated `@returns {any}`. That is how `rule` silently dropped `edits`
 * and `constraints` for a long time: a mark could accept an option and never pass
 * it on, and nothing caught it. Typing the return makes that a typecheck failure.
 *
 * A mark NEVER owns data: `Elicit` owns the chart's one dataset and hands the rows
 * to `build`. There is deliberately no `data` and no `onChange` here.
 */
/**
 * A CHART ELEMENT — `axis`, `grid`, `legend`, `axisRadial`. Public as
 * `elicit.elements.*` (also aliased on `plot.*`). Structurally a feature like any
 * other (the engine builds and draws it the same way), but it answers a different
 * question, and the differences are the contract:
 *
 *   · It views a SCALE, not the dataset. `views: 'scale'`, always. It picks the
 *     scale by a singular `channel` ('x', 'fill', 'angle'), so it has no data-mark
 *     `channels` MAP, no fields of its own, and no `discreteScale`/`xKey`/`yKey`.
 *   · Its style options are CHROME, not channels. `stroke`/`fill`/`fontSize` paint
 *     a spine and its labels; there is no datum to resolve them against, so they
 *     stay plain options rather than desugaring into channels.
 *   · An edit on it targets the DOMAIN, not rows (`edit.axis.*`, `target: 'domain'`)
 *     — so it can't be a create target, and `edit/route.js` recovers its field from
 *     `scale.fields[0]` instead of from a channel map.
 *   · It may RESERVE layout space. A legend shrinks the plot so it never overlaps
 *     the marks (core/legends.js) — nothing else in the library does this.
 *
 * Exception: `axisRadial` may carry optional placement `channels` (x/y/fill) to
 * draw one ring per row around small-multiple needles — placement chrome, not a
 * data-mark encoding surface.
 *
 * The type is documentation and a checkable shape; the engine still branches on
 * `views === 'scale'` rather than on this interface. Both `axes` and `legends` on
 * the spec desugar into these; authors may also pass them via `ElicitSpec.elements`.
 */
export interface ChartElement {
  build(
    currentData: Datum[],
    scales: ScaleMap,
    width: number,
    height: number
  ): FeatureNode[];

  /** Always 'scale' — that is what makes it an element rather than a data mark. */
  views: 'scale';
  /** The single scale it draws, by channel name. */
  channel: string;
  /**
   * Placement-only channel map (`axisRadial` small-multiple rings). Not a
   * data-mark encoding surface — see the exception note above.
   */
  channels?: Channels;
  /** Which kind, for the checks that genuinely need to tell them apart. */
  isAxis?: boolean;
  isGrid?: boolean;
  isLegend?: boolean;

  id?: string;
  markName?: string;
  /** Domain-targeting edits (edit.axis.*), already flattened to a list. */
  edits?: Edit[];
  /** Dataset invariants; promoted to the chart-wide set like a mark's. */
  constraints?: Constraint[];
  /** The single field an edit pins, when the element names one. */
  field?: string;
  /** Paint order ('background' puts it under the data marks). */
  layer?: string;
  /** Space-reserving elements only: measure, and the band the engine stamped. */
  measure?(scales: ScaleMap): { width: number; height: number } | null;
  anchor?: 'top' | 'right' | 'bottom' | 'left';
  orient?: 'horizontal' | 'vertical';

  [key: string]: any;
}

/**
 * One entry of `Mark.requires`: a scale capability some channel(s) must have for
 * the mark's geometry to mean anything.
 */
export interface MarkRequirement {
  /** The channels this applies to, e.g. ['x', 'y']. */
  channels: string[];
  /** The capability needed. Matched against `scale.kind`, never `scale.type`. */
  kind: 'discrete' | 'band' | 'point' | 'continuous';
  /** 'all' (default) — every channel must satisfy it; 'any' — at least one. */
  mode?: 'all' | 'any';
  /** Why the mark needs it; appended to the dev warning. */
  why?: string;
}

// What a joining mark gets as build()'s fifth argument. Read-only.
export interface MarkBuildContext {
  // Every table's committed rows, keyed by table NAME.
  tables: Record<string, Datum[]>;
  // The canonical schema, so a mark can find another table by ROLE (`byRole.nodes`)
  // and read its key column — never by hard-coding a name the author may have changed.
  schema: SchemaSpec;
  // Which table THIS mark is drawing, already resolved (an explicit `table`, else
  // the one filling the mark's `tableRole`).
  table: string;
}

export interface Mark {
  /**
   * The one required method: emit this mark's scene nodes for the current rows.
   * Resolve every position/style through encodeChannel / resolveStyle.
   */
  build(
    currentData: Datum[],
    scales: ScaleMap,
    width: number,
    height: number,
    // The rest of the dataset, for a mark whose geometry JOINS to another table —
    // `link` resolves an edge's endpoints in the node table. Optional and additive:
    // every other mark takes four parameters and ignores this one.
    context?: MarkBuildContext
  ): FeatureNode[];

  /**
   * Which TABLE of the dataset this mark is a view over, by NAME. Omitted, the mark
   * takes the table filling its `tableRole` — which is how a spec that renamed its
   * tables needs no `table:` written anywhere. Ignored on a single-table chart.
   */
  table?: string;
  /**
   * The ROLE whose table this mark draws when it states no `table`. Set by the mark
   * factory, not the author: `link` declares `'links'`, everything else leaves it
   * unset and gets the structure's primary table.
   */
  tableRole?: string;

  /** The channel map — also the source resolveScales reads to build scales. */
  channels?: Channels;
  /** Author-supplied id. Optional, so dev messages fall back to `markName`. */
  id?: string;
  /** Mark-level (joint / arbitrary) edits; channel-level ones live on the channel. */
  edits?: Edit[];
  /** Data invariants; the engine PROMOTES these into the dataset-wide set. */
  constraints?: Constraint[];

  /**
   * What this mark needs from a DISCRETE axis: 'band' (bar/tick — an interval) or
   * 'point' (dot/line — a tick). A mark that merely spans leaves it undefined so a
   * composite can stamp its own.
   */
  discreteScale?: 'band' | 'point';
  /**
   * Channels the mark resolves ITSELF, with no scale — `resolveScales` skips them.
   * For a channel naming a column of a table this pass cannot see (`link`'s
   * `nodeWidth` reads the NODE table), resolution would otherwise report a
   * well-declared field as undeclared.
   */
  rawChannels?: string[];
  /** Value field names the edit/constraint layer reads back, derived from channels. */
  xKey?: string;
  yKey?: string;

  /** The factory name, stamped for dev messages (`bar()` beats `mark "undefined"`). */
  markName?: string;

  /**
   * The GLYPH this feature is a part of, stamped by `composite` on every feature it
   * desugars into (one key per composite call). Paint order only: a glyph is one
   * OBJECT, so `paintOrder` (core/scene.js) orders its group's nodes by ROW rather
   * than by part, and a later glyph covers an earlier one whole instead of one
   * sticker's label landing on the next sticker's paper. Nothing else reads it —
   * dispatch, picking and data are still per FEATURE.
   */
  glyph?: string;

  /**
   * What this mark needs from the resolved SCALES, checked once per render by the
   * engine (`warnScaleRequirements`).
   *
   * A mark declares a CAPABILITY (`kind`), never a scale type — the same rule the
   * rest of the engine follows. `mode: 'all'` (the default) requires every listed
   * channel to satisfy it; `mode: 'any'` requires at least one, which is how a mark
   * whose category axis is chosen at build time (waffle's orientation) states its
   * need. `why` is prose appended to the warning.
   *
   * This exists because the alternative is silent degradation: without a band scale
   * a waffle's blocks quietly become 20px wide, and without both continuous axes a
   * trend emits no nodes at all. Both still "render", which is the worst outcome for
   * a library whose output is someone's stated belief.
   */
  requires?: MarkRequirement[];

  /** Line-family series grouping. See plot/line.js. */
  seriesKey?: string | null;
  order?: string;
  samples?: number;
  supportsSeries?: boolean;

  /** Capability flags the engine's scope guard reads (see SCOPE_CAPABILITY). */
  supportsGeo?: boolean;
  supportsWaffle?: boolean;
  supportsArc?: boolean;
  // Does this mark partition a total among a group of rows — so a boundary between
  // two of them exists to cut, drag or merge? Set by arc/pie/donut always, and by
  // `bar` only when it is actually stacking (an unstacked bar is a set of
  // independent lengths, with no boundary at all). Gates edit.stack.* via
  // SCOPE_CAPABILITY.
  supportsStack?: boolean;
  supportsTrend?: boolean;

  /**
   * What this feature is a view OF.
   *
   *   'data'  (default) — a data mark: its channels name COLUMNS of the dataset.
   *   'scale' — a GUIDE (axis, grid, legend): it draws a scale, not rows. It has
   *             no channel map and no fields of its own, so an edit attached to it
   *             recovers its target field from the scale instead.
   *
   * The distinction already existed, spelled as three separate booleans tested in
   * disjunctions across the engine (`isAxis || isGrid || isLegend`). Naming it lets
   * edit/route.js ask the question directly rather than inferring guide-ness from
   * an absent channel map.
   */
  views?: 'data' | 'scale';

  /** Which guide, for the engine's more specific checks. Implies `views: 'scale'`. */
  isAxis?: boolean;
  isGrid?: boolean;
  isLegend?: boolean;

  /** Paint order hint ('background' puts a guide under the data marks). */
  layer?: string;

  /**
   * Open by design: a mark may carry extra fields a driver or the engine reads
   * (a legend's `measure`, a geo mark's projection hooks).
   */
  [key: string]: any;
}

export interface FeatureNode {
  type: 'circle' | 'ellipse' | 'rect' | 'line' | 'path' | 'text' | 'image';
  // Connecting-path geometry (line mark): the ordered pixel points and the curve
  // interpolation name (see the renderer's resolveCurve).
  points?: [number, number][];
  curve?: string;
  // Authored SVG path `d` (arcs, needles, pie slices). When set, the renderer
  // uses it instead of building a line from `points`.
  d?: string;
  cx?: number;
  cy?: number;
  r?: number;
  // Ellipse radii, in px. A circle is the rx === ry case, but is kept its own node
  // type: `r` is one number a `size` channel drives, and most marks want that.
  // On a RECT the same pair is the corner radius (`ry` defaults to `rx`) — both
  // readings are "a radius on x", and both are GEOMETRY: the renderer sets them in
  // its rect/ellipse geometry pass, never in the style sweep.
  rx?: number;
  ry?: number;
  x?: number;
  y?: number;
  x1?: number;
  x2?: number;
  y1?: number;
  y2?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeDasharray?: string;
  strokeWidth?: number;
  opacity?: number;
  pointerEvents?: string;
  guide?: boolean;
  // Marks the node for the topmost paint layer (interaction overlays: proximity
  // ring, select outline). Drawn above marks and guides. See core/effects.js.
  effect?: boolean;
  // Marks the node for the background render layer (axes/gridlines), drawn behind
  // interactive marks by the renderer.
  background?: boolean;
  // Raster tile (geoTile): the image source, and the {z}/{x}/{y} identity the
  // renderer keys its data join on so an on-screen tile survives a re-render
  // without re-fetching.
  href?: string;
  key?: string;
  // The node's string content. On a WRAPPED label this stays the WHOLE string
  // while `lines` holds what is painted — which is what keeps the inline editor
  // (seeded from `text`, or from `editValue` on a typable node that paints none)
  // and an editText write working unchanged.
  text?: string;
  fontSize?: number;
  textAnchor?: string;
  // Text mark: vertical anchor ('top'|'middle'|'bottom') and the SVG
  // dominant-baseline the mark derived from it; `editText` opts the node into
  // the renderer's inline content editor on dblclick.
  lineAnchor?: string;
  dominantBaseline?: string;
  // A WRAPPED label's painted lines, and the baseline step between them in px.
  // Deliberately one node carrying many lines rather than one node per line: a
  // second node sharing an `index` would mean a second tab stop, a second hit
  // area, and an effect outline around the first line only.
  lines?: string[];
  lineHeight?: number;
  // Orientation in math degrees (0° = +x, CCW). Any geometry node may carry it;
  // the renderer applies SVG rotate(-deg) about markCenter. Marks that bake
  // orientation into path geometry (needle) omit this to avoid double-rotating.
  // Anything drawn ABOUT a rotated node has to carry it too, or it lands at the
  // mark's unrotated position — that is why an effect outline copies it.
  angle?: number;
  // The interaction-EFFECT restyle for this node, written by the engine's state pass
  // (core/effects.js) from the states the node's datum is in: the merged
  // filter/opacity/fill/stroke/strokeWidth/cursor of `hovered`/`selected`/`grabbed`.
  // A renderer APPLIES it and decides nothing — as a CSS style property in SVG (so it
  // beats the presentation attributes the mark's own style channels write, and
  // removing it restores them), as a paint override on canvas. Absent on a node in no
  // state, which is what takes the effect off. Never a data channel: nothing in a
  // mark's build() writes this.
  effectStyle?: Record<string, any>;
  // Opts the node into the renderer's inline content editor on double-click. Set
  // by the engine's tagging pass for any node whose feature carries an `inline`
  // edit — one place decides, so a mark never has to sniff its own edit list.
  editText?: boolean;
  // What that editor OPENS WITH when the node paints no text of its own — the
  // engine's read of the column the inline edit writes, stamped by the same pass.
  // A sticker's typable surface is its BOX, whose string is drawn by a sibling
  // mark, so seeding from `text` alone opened the editor empty and turned every
  // double-click into a retype-from-scratch. `text` still wins where both exist.
  editValue?: string;
  // Where the inline editor should sit, in the node's own pixel space. A plain
  // data descriptor (the node.frame / node.stack / node.sector family), so a
  // sticker's editor fills its box instead of the renderer's 140px default.
  editBox?: { x: number; y: number; width: number; height: number };
  // The editor takes a <textarea> and Enter inserts a newline rather than
  // committing. A declared capability — never inferred from editBox's height.
  multiline?: boolean;
  data?: Datum;
  index?: number;
  featureId?: string;
  // Set by the engine when the node's feature has a direct-pick edit, so the
  // renderer shows an interactive cursor on it.
  editable?: boolean;
  // Set by the engine when the node's row is READ-ONLY (ElicitSpec.lock): the node
  // is never `editable`, is pointer-transparent, and proximity picking skips it. A
  // line's connector path is locked when every row of its series is.
  locked?: boolean;
  // Set by the engine's ghost pass on a probe PREVIEW node: an inert, dimmed copy of
  // the rows a proposal would change, layered over the committed marks. Never written
  // to featureNodes (picking/guides ignore it), never editable, pointer-transparent.
  // The D3 renderer stamps a `data-ghost` attribute so a test can find it.
  ghost?: boolean;
  // HIT-ONLY: the node paints nothing and exists to be grabbed — a composite's box
  // draws one over the whole glyph so an edit on the composite's own x/y/size has
  // something to take hold of. Tagged `data-hit` by the D3 renderer, so a selector
  // can tell it from a part it sits under.
  hit?: boolean;
  // Runtime tags set by marks for the pick/driver layer: `series` groups a line's
  // nodes; `sweepAxis`/`bandAxis` name the axis proximity measures along; `cursor`
  // overrides the interactive cursor (e.g. a tick's ew-resize); `channel` tags one
  // of a mark's several handles, so that handle's edit `when` claims only this node.
  // Needed only when one FEATURE emits multiple handles over one datum — see
  // plot/trend.js (intercept vs slope). Marks split across features don't need it:
  // direct-pick dispatch already routes a gesture to the touched node's feature.
  series?: any;
  sweepAxis?: 'x' | 'y';
  bandAxis?: 'x' | 'y';
  channel?: string;
  cursor?: string;
  // The per-datum LOCAL scales this node was encoded through, stamped by
  // plot/composite.js on every node a framed part emits. The engine overlays them on
  // the global map when resolving an edit's channels, so a gesture inverts through
  // the same mapping that drew the node (see frameScalesFor in core/elicit.js).
  frame?: ScaleMap;
  // The STACK this node belongs to, stamped by any mark that partitions a total
  // among its rows (a `bar` with `stack`, arc/pie/donut — see plot/stack.js). Same
  // idea as `frame`: the mark that encoded the layout carries the means to invert
  // it, so edit.stack.* works on both marks without knowing which it is on.
  //   members  the group's rows, as global dataset indices in stack order
  //   local    this node's position within members
  //   field    the magnitude column
  //   geometry how a pointer becomes a position along the stack — pure data,
  //            { kind: 'linear', axis } or { kind: 'angular', cx, cy, spanStart,
  //            spanEnd, pad }. Never a closure: a commit re-renders, so an edit
  //            re-derives the shares from the live dataset every tick.
  stack?: {
    members: number[];
    local?: number;
    field?: string;
    geometry?: any;
  };
  // True on a node a boundary drag grabs (edit.stack.edge / .merge), as opposed to
  // a segment body (which edit.stack.cut divides). Paired with `loIndex`/`hiIndex`,
  // the two rows the boundary separates.
  edge?: boolean;
  loIndex?: number;
  hiIndex?: number;
  // Filled-region hit geometry for an annular sector, stamped by `arc`. The pick
  // layer measures distance to a path's polyline, which a bare `d` string has none
  // of — so without this a slice BODY is unclickable under the canvas renderer
  // (SVG hit-tests the filled shape in the DOM and never needed it).
  sector?: { cx: number; cy: number; r0: number; r1: number; a0: number; a1: number };
  [key: string]: any;
}

// Per-feature transient interaction state a driver keeps in ui.session[featureId]
// (proximity selection, sweep/draw locks). Read by guides to draw the snap ring +
// highlight and by an edit via ctx.session. All fields optional/driver-set.
export interface Session {
  px?: number;
  py?: number;
  threshold?: number;
  hoverIndex?: number | null;
  activeIndex?: number | null;
  series?: any;
  // draw driver: the locked mode + series and the pointer/domain trail.
  mode?: 'edit' | 'draw';
  drawSeries?: any;
  // geo draw: index of the row whose coordinates list is being authored this stroke.
  drawIndex?: number | null;
  lastDomain?: any;
  lastX?: number | null;
  lastY?: number | null;
  // brush driver: the dragstart-locked grab zone (+ which field an edge zone
  // targets), forced to 'canonicalize' for the one-time dragend cleanup tick.
  zone?: 'edgeA' | 'edgeB' | 'body' | 'canonicalize' | 'corner' | 'edgeX' | 'edgeY' | 'edge' | null;
  field?: string | null;
  // brushRect driver: the field(s) an edge/corner grab locked (1 for an edge,
  // 2 for a corner). The 2-D sibling of `field`.
  fields?: string[] | null;
  // geoBrush driver: which geographic edge(s) the grab locked, plus the anchor it
  // latched at dragstart — the pointer's lon/lat and the box as it stood then, so
  // a body move translates by the geographic delta instead of recentering.
  edges?: string[] | null;
  grab?: { lon: number; lat: number } | null;
  box0?: { west: number; south: number; east: number; north: number } | null;
  // axisDrag driver: the dragstart-locked handle for an editable numeric axis —
  // which end is grabbed, the axis it runs along, the opposite (anchored) end's
  // pixel + value, the grabbed end's starting pixel + value, and (grow mode) the
  // pixels-per-data-unit held constant while the chart resizes.
  grabEnd?: 'min' | 'max';
  axis?: 'x' | 'y';
  anchorPixel?: number;
  anchorValue?: any;
  grabPixel?: number;
  grabValue?: any;
  pxPerUnit?: number;
  cursor?: string;
  // slide driver (relative mode): the dragstart-locked target datum, plus one
  // frozen anchor per edit — the grab pixel on that edit's axis and the datum's
  // value when the grab began, which is what the value moves relative to (no jump
  // on grab). Keyed by `${axis}:${field}` (edit/basic.js: slideAnchorKey) so two
  // relative slides on one feature (an eye's rx and ry) keep separate anchors.
  index?: number | null;
  slide?: Record<string, { startPx: number, startValue: number }>;
  // move driver (relative mode): the same snapshot, under ONE key so dragend can
  // null it without wiping a co-resident driver's state (a sticker carries both a
  // relative move and edit.network.connect). Anchors are keyed by FIELD — one move
  // edit owns both axes of one datum, and a field sits on exactly one of them —
  // and `startPx` is the grab pixel on that field's own axis (axisOf the channel).
  move?: { index: number, anchors: Record<string, { startPx: number, startValue: any }> } | null;
}

// Config for a single positional axis (the `axes` convenience, or an explicit
// axisX/axisY mark). Axes and gridlines are composable marks (see plot/axis.js).
export interface AxisSpec {
  channel?: 'x' | 'y';
  // Base side; default x->'bottom', y->'left'. Drives tick side + label placement.
  anchor?: 'bottom' | 'top' | 'left' | 'right';
  // Width/height/scales-aware override of the base translate — e.g. cross at the
  // origin: `({ scales }) => ({ y: scales.y(0) })`.
  transform?: (ctx: {
    width: number;
    height: number;
    scales: ScaleMap;
    anchor: string;
    base: { x: number; y: number };
  }) => { x?: number; y?: number };
  ticks?: number;               // tick count hint (linear); ignored for band/point
  tickValues?: any[];           // explicit tick values (overrides `ticks`)
  tickFormat?: string | ((v: any) => string); // d3-format string or a formatter
  tickSize?: number;
  title?: string;
  stroke?: string;   // spine + ticks
  fill?: string;     // tick labels + title (they are text nodes)
  fontSize?: number;
  grid?: boolean;               // also emit a paired gridline mark
  // Make the axis INTERACTIVE (opt-in; axes are inert by default). A domain edit
  // (edit.axis.scale() for a numeric/temporal axis, edit.axis.categories() for a
  // discrete one) reshapes the field's schema domain — grids, guides and marks
  // reflow from it. Accepts one edit or a list.
  edit?: Edit | Edit[];
  // The schema field whose domain this axis edits, when the axis's channel carries
  // more than one field and the edit shouldn't touch them all. Defaults to every
  // field on the axis (scale.fields).
  field?: string;
}

// Interaction-effects layer: transient visual feedback for interaction STATE,
// kept separate from mark style channels and customizable per chart. Three states —
// `hovered`, `selected`, `grabbed` — each taking the same paint vocabulary. See
// EffectsSpec below and core/effects.js.
// Recursively-optional version of a type: what a caller MAY pass. `spec.theme`,
// `setTheme()`, and the built-in `themes` are DeepPartial<Theme> — they name only
// the tokens they change; resolveTheme deep-merges them over DEFAULT_THEME to a full
// Theme. (Arrays are values, replaced wholesale, so they are not descended into.)
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// The STYLE layer: default colours, fonts, and affordance tokens the library draws
// with. This is the RESOLVED shape (every container present, as DEFAULT_THEME
// provides), read by marks (default ink), chrome (axis/grid/guides), the renderers
// (font family, base fallbacks), and the survey-widget affordances. A per-mark
// channel/option still wins over any theme token. Callers pass a DeepPartial<Theme>.
export interface Theme {
  // The primary mark colour (marks that historically defaulted to 'steelblue').
  ink: string;
  // Interactive emphasis: draggable handles, a committed answer, an axis handle.
  accent: string;
  /** Draggable-handle ink and its legibility halo, shared by every mark that draws one. */
  handle: string;
  handleStroke: string;
  // Secondary chrome / de-emphasised marks.
  muted: string;
  // The chart backdrop, applied as the svg/canvas CSS background (covers the margin
  // band too). null = transparent (the default — the host page shows through); a
  // dark theme sets it so a dark-mode chart is self-contained.
  background: string | null;
  // Colour-scale defaults fed to resolveScales when a channel names no range/scheme.
  palette: string[];
  ramp: string[];
  diverging: string[];
  // Typography. `family` null => inherit the host page's font (the default look);
  // a non-null family is emitted on the root svg / used by the canvas renderer.
  font: { family: string | null; size: number; labelSize: number; titleSize: number };
  // Chart chrome.
  axis: { stroke: string; labelFill: string; fontSize: number; handle: string };
  grid: { stroke: string; strokeWidth: number };
  // Annotation guides (guides/*) plus edit-guide part tokens (edit/guide.js).
  guide: {
    rule: { stroke: string; strokeDasharray: string };
    region: { fill: string; opacity: number };
    legend: { stroke: string; labelFill: string; fontSize: number };
    /** Edit-guide parts — merged under GUIDE_PARTS, under per-edit overrides. */
    bounds?: GuidePartStyle;
    catchment?: GuidePartStyle;
    track?: GuidePartStyle;
  };
  // The constraint-guide colour (per-edit `guideColor` still wins).
  constraint: { color: string };
  // Interaction-effects defaults, merged UNDER spec.effects.
  effects: EffectsSpec;
  // Ghost-preview styling (probe driver): a ghost multiplies its opacity by
  // `opacity`; a non-null fill/stroke/strokeDasharray overrides the committed paint.
  ghost: { opacity: number; fill: string | null; stroke: string | null; strokeDasharray: string | null };
  // Survey-instrument affordance tokens (widgets/theme.js), read live per frame.
  widget: {
    accent: string; ring: string; track: string; cellFill: string; cellStroke: string;
    label: string; question: string; labelSize: number; questionSize: number; radius: number;
  };
  // Sparse per-mark default overrides, keyed by mark name (e.g. { bar: { fill } }).
  marks: Record<string, Record<string, any>>;
}

/**
 * Per-part paint for an edit's self-drawn guide (`edit.guide`). A GUIDE shows a
 * RULE (what you may do); an EFFECT shows interaction STATE. See edit/guide.js.
 */
export interface GuidePartStyle {
  color?: string;
  dash?: string;
  width?: number;
  opacity?: number;
  bandOpacity?: number;
  fontSize?: number;
  labelOpacity?: number;
  tickLength?: number;
  tickOpacity?: number;
}

/**
 * Object form of `edit.guide`. `true` on a part (or omitting a part under
 * `guide: true`) uses the library defaults for that part.
 */
export interface GuideSpec {
  /** Constraint boundaries on the edit's value channel (clamp/snap/maintainSum). */
  bounds?: boolean | GuidePartStyle;
  /** Proximity snap ring — only drawn by drivers that select a target. */
  catchment?: boolean | GuidePartStyle;
  /** Where a handle can travel (`node.dm`); opt-in even under `guide: true`. */
  track?: boolean | GuidePartStyle;
  /** Base colour for every part (part-level color still wins). */
  color?: string;
}

/**
 * Interaction-feedback states. Every state takes the SAME vocabulary (EffectStyle),
 * and every property of it works in both renderers, whichever way the state arose —
 * a pointer over a mark and a proximity driver resolving that same row both paint
 * `hovered` identically.
 *
 * Two mechanisms, decided in the engine's state pass, never by a renderer:
 *   · `outline` draws an OVERLAY node (`effect: true`) — the one part that needs
 *     geometry the mark hasn't got (padding outside the shape). It copies the mark's
 *     `angle`, so it tracks a rotated mark.
 *   · everything else RESTYLES the mark's own node, arriving as `FeatureNode
 *     .effectStyle` and applied as a CSS style PROPERTY (never a presentation
 *     attribute, which would wipe the mark's own stroke). It is the mark's node, so
 *     it is aligned with the mark by construction.
 * A copy-on-top was the alternative for the second half and cannot express it: you
 * cannot dim a mark by drawing over it.
 *
 * Legacy `grab`/`select` keys are still accepted at runtime and migrated with a warn
 * (see core/effects.js).
 */
export interface EffectsSpec {
  /** Pointer is over / proximity has selected this mark. */
  hovered?: false | string | EffectStyle;
  /** Row is in `ui.selection`. */
  selected?: false | string | EffectStyle;
  /** An active drag is holding this mark. */
  grabbed?: false | string | EffectStyle;
  /** @deprecated Use `grabbed`. */
  grab?: false | string | EffectStyle;
  /** @deprecated Use `selected` (and `hovered` for proximity). */
  select?: false | string | EffectStyle;
}

/**
 * Paint vocabulary for one effect state. The first six RESTYLE the mark's own node;
 * `outline` adds a padded overlay around it. Both halves work for all three states.
 * `filter` and `cursor` are SVG-only (a canvas has no element to hover and no
 * per-shape filter); everything else paints in both renderers.
 */
export interface EffectStyle {
  filter?: string | null;
  opacity?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cursor?: string;
  outline?: {
    color?: string;
    width?: number;
    pad?: number;
    dash?: string;
    opacity?: number;
  };
}

export interface ElicitSpec {
  width?: number;
  height?: number;
  margins?: { top: number; right: number; bottom: number; left: number };
  marks?: any[];
  // Chart elements (`elicit.elements.*` — axis / grid / legend / axisRadial).
  // Concatenated with `marks` into the feature list; same factories also work
  // inside `marks` (and stay aliased on `plot.*`). Prefer this key when the
  // intent is scale chrome rather than a data view.
  elements?: ChartElement[];
  // THE dataset. A chart elicits exactly one — even a slider elicits a one-row
  // dataset. Seed rows are a starting point; every mark is a view over these rows,
  // encoding some columns and (where it carries an edit) writing them back. Marks
  // never own data. May be omitted: with a `schema`, scales resolve and `create`
  // mints rows from nothing.
  //
  // A bare array is the PRIMARY table's rows — which is every single-table chart.
  // A multi-table structure keys its rows by table NAME (`{ nodes, links }`, or
  // whatever the schema called them); a table left out seeds `[]`, so a diagram
  // built entirely by gesture needs no `data` at all.
  data?: Datum[] | Record<string, Datum[]>;
  // The elicited-dataset schema (field -> measurement type/domain/default), and
  // the contract of the chart. REQUIRED: it owns every field's data type and
  // DOMAIN, so a mark never declares one. A field encoded but left out of the
  // schema is inferred from `data` with a dev-warning; a field with neither a
  // schema entry nor data throws (there is nothing to build a scale from).
  //
  // A bare field map is a single-table schema (the form every pre-structure spec
  // uses, and it stays valid); declare a `structure` to elicit a network. See
  // SchemaInput / SchemaSpec above.
  schema: SchemaInput;
  // Read-only rows. `'seed'` (or `true`) fixes the rows in `data` — they are given,
  // not elicited — while every row an edit ADDS stays free; a predicate locks rows
  // by what they are. A locked row can't be changed or deleted by any gesture (a
  // dataset invariant, run last, so it outranks every other repair), its marks are
  // not grabbable, and proximity picking (nearest / sweep / draw) skips them. Note
  // `setData` re-seeds the chart, so it also re-takes a `'seed'` lock.
  lock?: LockSpec;
  // The dataset's invariants. They gate and REPAIR every edit, whichever mark fired
  // it: a rejected proposal is dropped; a returned array replaces it, and the marks
  // re-derive from the repaired rows on the next render. A mark's own `constraints`
  // are promoted into this set (see MarkOptions.constraints).
  constraints?: Constraint[];
  // Called with the committed dataset after each edit, shaped like `data` itself
  // (a bare array for a single-table chart). Hover previews never fire it.
  // Declared as a METHOD, not a function-valued property, so it stays bivariant: a
  // single-table consumer (every widget) may hand in a plain (rows: Datum[]) => void.
  onChange?(data: Datum[] | Record<string, Datum[]>): void;
  // Global axis convenience: `false` = no axes; `{ x, y }` = per-channel config or
  // `false` to suppress that channel; omitted = default axes on both positional
  // channels. Desugars into composable axis/grid marks.
  axes?: false | { x?: AxisSpec | false; y?: AxisSpec | false };
  // The legend counterpart to `axes` — the IMPLICIT layer for the NON-positional
  // scales, desugared into legend marks by core/legends.js's autoLegends.
  //   true              one legend per non-positional channel bound to a field
  //   { fill: {...}, size: false }   per-channel config; false suppresses one
  // Defaults to none, unlike `axes`: a legend RESERVES layout space, so injecting
  // one by default would silently shrink the plot the moment a `fill` field appears.
  // An explicit legend mark in `marks` always wins for its channel.
  legends?: boolean | Record<string, any>;
  // Customizable interaction-effects layer (grab / proximity-select).
  effects?: EffectsSpec;
  // The chart's theme (style layer): default colours, fonts, and affordance tokens.
  // A partial, deep-merged over the built-in DEFAULT_THEME (and any setTheme() base).
  // See Theme (the resolved shape) and DeepPartial.
  theme?: DeepPartial<Theme>;
  guides?: any[];
  // Sizing mode. 'fixed' (default) draws at the pixel width/height. 'scale' wraps
  // the SVG in a viewBox so the browser scales it to fill the parent (one draw,
  // aspect ratio preserved). 'reflow' (or `true`) measures the parent and redraws
  // at native pixels on resize — crisp text, width tracks the container, height
  // stays the given value. Reflow charts expose `destroy()` to detach the observer.
  responsive?: 'fixed' | 'scale' | 'reflow' | boolean;
  // SVG overflow. 'hidden' (default) clips marks to the viewport; 'visible' lets
  // content in the margin band show — needed for radial/gauge axis labels that
  // sit just outside the plot area.
  overflow?: 'hidden' | 'visible';
  // Browser focus ring on editable marks (the blue box after a click / Tab).
  // Off by default — keyboard nudge still works (`tabindex` stays); only the
  // native outline is suppressed. Set `true` to show the browser's focus ring
  // (useful when teaching Tab / arrow-key editing). SVG/D3 renderer only.
  focusOutline?: boolean;
  // The drawing backend. Defaults to a new `D3Renderer` (SVG). Any object satisfying
  // the `Renderer` contract works — `CanvasRenderer` is a second, canvas-2D
  // implementation of the same contract, which is what proves the seam is real.
  renderer?: Renderer;
  // Chart-level scale overrides, keyed by channel ('x', 'y', 'fill', 'size', …).
  // Scales are GLOBAL per channel, so this is their honest home; a channel's own
  // `scale` is the shorthand for the single-mark case. This wins over it. No
  // `domain` here either — that is the schema's.
  scales?: Record<string, ScaleSpec>;
  // Geographic projection for geo* marks (Plot model). Replaces x/y placement for
  // map elicitation: `"mercator"`, `{ type, domain, rotate, … }`, or a live
  // d3.geo* instance. When set, auto axes default off; use geoBasemap / geoPoint /
  // geoLine / geoPolygon / geoRect with edit.geo.*.
  projection?: string | ProjectionSpec | ProjectionContext | ((...args: any[]) => any) | any;
  // Initial stage index for multi-stage elicitation. Edits carrying a `stage`
  // are active only when it equals the current stage (see Edit.stage).
  stage?: number;
  // Optional labels for stages (index -> name). Surfaced via getStageLabel() and
  // the second argument of on('stage', (index, label) => …).
  stageLabels?: (string | null)[];
  [key: string]: any;
}

// The shared option surface every survey widget (src/widgets/*) accepts, so the
// family reads consistently. A widget adds its own instrument-specific options
// (e.g. `options`, `domain`, `categories`) on top. `theme` is the style hook: the
// widget bakes the resolved tokens into its answer mark and forwards the partial to
// `spec.theme` so the affordances and chrome restyle too (see widgets/shared.js).
export interface WidgetOptions {
  // The question prompt, drawn into the top margin.
  question?: string;
  // Called with the committed dataset after each answer.
  onChange?: (data: Datum[]) => void;
  width?: number;
  height?: number;
  // Active-stage gate for the widget's edit(s) — set to place the instrument in a
  // multi-stage form (the edit is live only when the chart's stage matches).
  stage?: number;
  // The widget's theme (style layer), a partial deep-merged over DEFAULT_THEME.
  theme?: DeepPartial<Theme>;
}

// The DOM element Elicit returns: the chart container plus a small observation
// API over the belief-data store. `getData`/`setData` read/replace the committed
// dataset; `on` subscribes to commits and stage changes. These add no interaction
// path — edits + constraints remain the only way a gesture mutates data.
export interface ElicitElement extends HTMLDivElement {
  // A deep copy of the committed dataset. Shaped like `spec.data`: a bare array for
  // a single-table chart, one array per table NAME for a multi-table structure.
  getData(): Datum[] | Record<string, Datum[]>;
  // A deep copy of the engine-owned schema, including any DOMAIN an editable axis
  // (edit.axis.*) reshaped. The caller's original spec.schema is never mutated.
  // Returned in the spelling it was GIVEN in — a single-table chart gets its bare
  // field map back, so the engine's canonical form never leaks.
  getSchema(): SchemaInput;
  // Replace the dataset and re-render. Bypasses constraints (trusted seed/reset).
  // Also clears the undo history: a reseed is a new starting point, not an edit.
  setData(data: Datum[] | Record<string, Datum[]>): void;
  // Step back / forward one GESTURE. A drag is one entry however many commits it
  // made along the way; a click or a typed commit is its own. Both restore the
  // dataset AND the schema (an axis edit reshapes a domain) and fire 'change'.
  // Return whether they moved, so a caller can drive a button's disabled state.
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  // Subscribe to committed changes ('change': (data)), stage advances
  // ('stage': (stageIndex, stageLabel?)), or selection changes ('select':
  // (primaryIndex | null, indices[])). Selection is not the belief data, so it has
  // its OWN event — a 'select' listener hears it, 'change'/getData never do.
  // Returns an unsubscribe function.
  //
  // 'select' second argument: bare row indices for a single-table chart (a bare
  // index names a row unambiguously there), `{ table, index }` for a multi-table
  // one — where a number alone would name a row in no particular table.
  on(type: 'change' | 'stage' | 'select', cb: (...args: any[]) => void): () => void;
  // ── Selection: transient pipeline state, NOT the belief data. Its own tiny API
  // beside getData/setData because a `selected` data column is exactly what this
  // replaces (see edit.select). All routes go through one applySelection, so an
  // external <select>, the keyboard, and a mark click leave selection in one shape.
  //
  // The primary selected datum index, or null. A stale index (the row was removed)
  // reads as null.
  getSelection(): number | null;
  // Select a SPECIFIC ITEM by dataset index (external counterpart of clicking a
  // mark). null / out-of-range clears. Exclusive: the row becomes the sole
  // selection. Returns whether the selection moved.
  select(index: number | null): boolean;
  // Select by CATEGORY / predicate: select the first row matching { field: value }
  // (or a predicate function). The "select a category" entry point. No match clears.
  selectWhere(field: string | ((d: Datum, i: number) => boolean), value?: any): boolean;
  // Clear the selection entirely.
  clearSelection(): boolean;
  // Multi-stage controls (see ElicitSpec.stage). getStage reads the current index.
  getStage(): number;
  // Optional label for the current stage (from ElicitSpec.stageLabels), or null.
  getStageLabel(): string | null;
  setStage(stage: number): void;
  nextStage(): void;
  // External control — drive an edit from OUTSIDE the chart (a slider, a picker,
  // a rotate icon, a plain function). A new input SOURCE, not a second interaction
  // system: `emit`/`control` synthesize the same renderer-shaped events the pointer
  // and keyboard already produce and feed them to the one dispatch, so constraints,
  // undo, guides, and 'change' all run identically. See the keyboard-`nudge`
  // precedent in core/elicit.js.
  //
  // Low-level: inject a renderer-shaped event. x/y are INNER (margin-subtracted)
  // pixels. Prefer `control` unless you already hold pixels.
  emit(event: GestureEvent): void;
  // High-level: a handle bound to the edit named `name` (see Edit.name) acting on
  // the datum at `index` (default 0). `.set(value)` drives it by a DATA value —
  // forward-encoded through the channel's scale for positional edits, or carried
  // whole for a `set()`/`editText()` value edit.
  control(name: string, index?: number): EditControl;
  // Detach the ResizeObserver used by `responsive: 'reflow'`. No-op otherwise;
  // call it when unmounting a reflow chart. Present on every element.
  destroy(): void;
}

// What the engine hands a renderer each frame. The renderer draws `scene.children`
// (typed FeatureNodes) into `container` and reports gestures back through `onEvent`
// as INNER (margin-subtracted) pixels. This is the entire coupling between the
// engine and its drawing backend — everything else (marks, edits, scales, guides)
// is renderer-agnostic.
export interface RenderContext {
  // The chart's host element (a div). The renderer owns what it puts inside.
  container: HTMLElement;
  // The scene to draw: `scene.children` is a flat array of FeatureNodes in
  // features/parts array order (later = on top among marks). Renderers may still
  // pin `background` / `guide` / `effect` nodes into role layers around that stack.
  scene: { children: FeatureNode[] };
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  // True when active edits are plane-driven (sweep/draw/nearest): the renderer must
  // route all gestures as plane events (no node) rather than hit-testing marks.
  planeOnTop?: boolean;
  planeCursor?: string;
  responsive?: 'fixed' | 'scale' | 'reflow';
  overflow?: 'hidden' | 'visible';
  // See ElicitSpec.focusOutline. Renderers that focus mark nodes honour this;
  // CanvasRenderer has no keyboard focus path today, so it ignores it.
  focusOutline?: boolean;
  effects?: any;
  // The chart's resolved theme. A renderer reads it for the font family (emitted on
  // the root svg) and text-size fallback; all mark/chrome colours arrive pre-resolved
  // on the nodes, so a renderer never has to consult the theme for paint.
  theme?: Theme;
  // Report a gesture to the engine. The renderer resolves `direct`-pick targets
  // (the node under the pointer) and sets `event.node`; plane gestures leave it unset.
  onEvent: (event: GestureEvent) => void;
  [key: string]: any;
}

// The drawing-backend contract. `D3Renderer` (SVG) and `CanvasRenderer` (canvas 2D)
// both satisfy it. One method: draw the scene and wire the events for one frame.
// State an implementation keeps between frames (idempotent scaffolding, gesture
// state, image caches) is its own business — the engine only ever calls `render`.
export interface Renderer {
  render(context: RenderContext): void;
}

// A renderer-shaped gesture event, the one shape every input source (pointer,
// keyboard nudge, external controller) funnels into `handleEvent`. x/y are INNER
// (margin-subtracted) pixels — the space an edit's `ctx.pointer` reads.
export interface GestureEvent {
  type: 'dragstart' | 'drag' | 'dragend' | 'click' | 'dblclick' | 'commit' | (string & {});
  // The scene node the gesture landed on. Present -> direct-pick dispatch to that
  // node's feature; absent -> plane dispatch fans to every feature.
  node?: any;
  x?: number;
  y?: number;
  // A non-pixel payload (a typed string, a picked value) read as `ctx.value` — how
  // a `commit` gesture carries what `set()`/`editText()` write.
  value?: any;
  // "One press = one complete gesture": a lone `drag` self-closes its undo txn
  // instead of leaking it (the keyboard nudge's trick, reused for one-shot control).
  nudge?: boolean;
  // Addresses ONE edit by its `name` (Edit.name). Direct dispatch then runs only that
  // edit instead of fanning to every same-gesture edit on the feature — so several
  // `set()`s on one feature (a face's params) stay independent. Set by `el.control`;
  // native pointer events leave it unset (and keep the ordinary fan-out).
  editName?: string;
  rawEvent?: any;
  [key: string]: any;
}

// A handle bound to a named edit + datum (from `el.control`). It reads the edit's
// own `gesture` to route value-space vs pointer-space — the handle branches; the
// engine dispatch never learns a controller exists.
export interface EditControl {
  // One-shot write. A value edit (set/editText) carries `value` whole; a positional
  // edit (drag/resize/rotate/rank) forward-encodes it to a pointer and self-closes
  // its undo txn (one entry). Pass a scalar for a single-channel edit, or a
  // { channelName: value } / { field: value } map for a multi-channel one (2-D drag).
  set(value: any): void;
  // Bracket a LIVE drag so many `.set()` ticks collapse into ONE undo entry, exactly
  // like a pointer drag's dragstart..dragend.
  begin(): void;
  end(): void;
  // Fire a TRIGGER edit that takes no value (cycle advances a category, remove drops
  // the row, toggle flips it): dispatches the edit's own gesture (a click/dblclick)
  // on the datum's node. `.set` covers commit/drag edits; `.fire` covers these. Pass
  // a gesture to override the edit's own.
  fire(gesture?: string): void;
  // Raw event passthrough, auto-scoped to this feature's node for the datum.
  emit(event: GestureEvent): void;
  // What values this channel ACCEPTS, read off its scale — so external UI (dropdown
  // options, slider min/max, colour choices) can respect the scale. null if the edit
  // isn't found. `values`/`domain` list the accepted set (discrete) or range
  // (continuous); `kind`/`type`/`temporal`/`invertible` are the scale's capabilities.
  accepts(): ChannelAccepts | null;
}

// The accepted-value description `EditControl.accepts()` returns, derived from the
// channel's scale + the field's schema. Read capability flags, never `scale.type`.
export interface ChannelAccepts {
  field: string | null;
  type: MeasureType | null;
  kind: 'band' | 'point' | 'continuous' | 'discrete' | null;
  temporal: boolean;
  invertible: boolean;
  // A discrete channel's accepted value set is its domain; a continuous channel's
  // accepted [min, max] is its domain. `values` is the discrete set only (null when
  // continuous), so a dropdown can offer exactly the valid choices.
  domain: any[] | null;
  values: any[] | null;
  range: any[] | null;
}
