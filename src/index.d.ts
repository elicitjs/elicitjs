/**
 * Public API typings for `elicit-js` / `@elicit`.
 * Shape interfaces live in `./types`; this file declares the callable surface.
 */
import type {
  AnchorOptions,
  BrushRectOptions,
  BrushSpanOptions,
  Channels,
  ChartElementOptions,
  Constraint,
  CreateOptions,
  DeepPartial,
  DrawOptions,
  Edit,
  EditOptions,
  ElicitElement,
  ElicitSpec,
  Guide,
  FaceOptions,
  CompositeOptions,
  LegendEditOptions,
  LinkOptions,
  MarkOptions,
  NetworkConnectOptions,
  NetworkEndpointOptions,
  NewSeriesOptions,
  Renderer,
  RotateOptions,
  SelectEditOptions,
  TrendBandOptions,
  TrendEditOptions,
  TrendOptions,
  MoveOptions,
  SlideOptions,
  StickerOptions,
  Theme,
  ToggleOptions,
  WidgetOptions,
} from './types.js';

export type * from './types.js';

/** A mark factory’s return value — a feature the engine can build / dispatch. */
export type Mark = Record<string, unknown>;

export function Elicit(spec: ElicitSpec): ElicitElement;

/**
 * MARKS — features that view DATA (`views: 'data'`): one node per row, channels
 * name columns, and a channel carrying an `edit` writes that column back.
 *
 * Closed on purpose (no index signature): these names are the grammar's mark
 * vocabulary, so an unknown one should be an error, not `any`.
 *
 * The BARE form is the mark and infers its value axis from the scales; the
 * `...X` / `...Y` siblings are sugar that force one orientation.
 */
export const plot: {
  // Rectangular / interval
  bar(options?: MarkOptions): Mark;
  barX(options?: MarkOptions): Mark;
  barY(options?: MarkOptions): Mark;
  rect(options?: MarkOptions): Mark;
  rectX(options?: MarkOptions): Mark;
  rectY(options?: MarkOptions): Mark;
  tick(options?: MarkOptions): Mark;
  tickX(options?: MarkOptions): Mark;
  tickY(options?: MarkOptions): Mark;
  rule(options?: MarkOptions): Mark;
  ruleX(options?: MarkOptions): Mark;
  ruleY(options?: MarkOptions): Mark;
  waffle(options?: MarkOptions): Mark;
  waffleX(options?: MarkOptions): Mark;
  waffleY(options?: MarkOptions): Mark;
  // Point / token
  point(options?: MarkOptions): Mark;
  ellipse(options?: MarkOptions): Mark;
  dotStack(options?: MarkOptions): Mark;
  dotStackX(options?: MarkOptions): Mark;
  dotStackY(options?: MarkOptions): Mark;
  // Connected sequences. `line` reads a value against a domain axis; `path`
  // connects points in creation order with both axes free.
  line(options?: MarkOptions): Mark;
  lineX(options?: MarkOptions): Mark;
  lineY(options?: MarkOptions): Mark;
  path(options?: MarkOptions): Mark;
  area(options?: MarkOptions): Mark;
  areaX(options?: MarkOptions): Mark;
  areaY(options?: MarkOptions): Mark;
  curve(options?: MarkOptions): Mark;
  curveX(options?: MarkOptions): Mark;
  curveY(options?: MarkOptions): Mark;
  // Angular. `pie` / `donut` are presets of `arc`, not aliases.
  arc(options?: MarkOptions): Mark;
  pie(options?: MarkOptions): Mark;
  donut(options?: MarkOptions): Mark;
  needle(options?: MarkOptions): Mark;
  // Text
  text(options?: MarkOptions): Mark;
  textX(options?: MarkOptions): Mark;
  textY(options?: MarkOptions): Mark;
  // Parametric — channels are PARAMETERS of a curve, not columns of free rows.
  trend(options?: TrendOptions): Mark;
  trendBand(options?: TrendBandOptions): Mark;
  // Glyphs
  composite(options?: CompositeOptions): Mark;
  face(options?: FaceOptions): Mark;
  node(options?: MarkOptions): Mark;
  sticker(options?: StickerOptions): Mark;
  // Network — the one mark whose geometry comes from a JOIN.
  link(options?: LinkOptions): Mark;
  // Geographic — placed through the chart's `projection`.
  geoBasemap(options?: MarkOptions): Mark;
  geoTile(options?: MarkOptions): Mark;
  geoPoint(options?: MarkOptions): Mark;
  geoPolygon(options?: MarkOptions): Mark;
  geoLine(options?: MarkOptions): Mark;
  geoText(options?: MarkOptions): Mark;
  geoRect(options?: MarkOptions): Mark;
};

/**
 * CHART ELEMENTS — features that view a SCALE (`views: 'scale'`): they draw
 * chrome for a scale rather than rows, take a singular `channel` instead of a
 * `channels` map, and their edits reshape the schema's DOMAIN.
 */
export const elements: {
  axis(options?: ChartElementOptions): Mark;
  axisX(options?: ChartElementOptions): Mark;
  axisY(options?: ChartElementOptions): Mark;
  axisRadial(options?: ChartElementOptions): Mark;
  grid(options?: ChartElementOptions): Mark;
  gridX(options?: ChartElementOptions): Mark;
  gridY(options?: ChartElementOptions): Mark;
  legend(options?: ChartElementOptions): Mark;
  legendColor(options?: ChartElementOptions): Mark;
  legendSize(options?: ChartElementOptions): Mark;
  legendSymbol(options?: ChartElementOptions): Mark;
  /** The option vocabularies these elements validate against. */
  readonly AXIS_OPTIONS: readonly string[];
  readonly GRID_OPTIONS: readonly string[];
};

/**
 * EDITS — a gesture -> data, through the same scale the channel encodes with.
 *
 * Universal edits work on any mark carrying the channels they govern. The scoped
 * namespaces name what their edits are ABOUT; the JS path is also the JSON
 * keyword (`edit.line.draw()` <-> `{ "type": "line.draw" }`).
 *
 * NAMESPACE and `scope` are separate: the namespace is the subject, `scope` names
 * a mark capability the engine checks. `edit.network.connect` is in the `network`
 * namespace but carries no scope, because it goes on an ordinary node mark.
 */
export const edit: {
  // ── position ──────────────────────────────────────────────────────────────
  move(options?: MoveOptions): Edit;
  moveSpan(options?: EditOptions): Edit;
  brushSpan(options?: BrushSpanOptions): Edit;
  brushRect(options?: BrushRectOptions): Edit;
  // ── magnitude / angle / discrete step ────────────────────────────────────
  slide(options?: SlideOptions): Edit;
  resize(options?: EditOptions): Edit;
  rotate(options?: RotateOptions): Edit;
  cycle(options?: EditOptions): Edit;
  // ── existence ─────────────────────────────────────────────────────────────
  create(options?: CreateOptions): Edit;
  toggle(options?: ToggleOptions): Edit;
  remove(options?: EditOptions): Edit;
  // ── value ─────────────────────────────────────────────────────────────────
  set(options?: EditOptions): Edit;
  editText(options?: EditOptions): Edit;
  rank(options?: EditOptions): Edit;
  // ── chart state (writes no data row) ─────────────────────────────────────
  select(options?: SelectEditOptions): Edit;
  // ── escape hatch ──────────────────────────────────────────────────────────
  custom(fn: Edit['apply'], options?: EditOptions): Edit;

  /** Arbitration predicates for an edit's `when`. */
  when: {
    shift(ctx: import('./types.js').EditContext): boolean;
    noShift(ctx: import('./types.js').EditContext): boolean;
    alt(ctx: import('./types.js').EditContext): boolean;
    noAlt(ctx: import('./types.js').EditContext): boolean;
    modifier(key: string): (ctx: import('./types.js').EditContext) => boolean;
    noModifier(key: string): (ctx: import('./types.js').EditContext) => boolean;
    near(ctx: import('./types.js').EditContext): boolean;
    far(ctx: import('./types.js').EditContext): boolean;
    nearWithin(threshold: number): (ctx: import('./types.js').EditContext) => boolean;
  };

  /** Needs SERIES grouping (`scope: 'line'`). */
  line: {
    anchor(options?: AnchorOptions): Edit;
    newSeries(options?: NewSeriesOptions): Edit;
    draw(options?: DrawOptions): Edit;
    sweep(options?: DrawOptions): Edit;
    removeSeries(options?: EditOptions): Edit;
  };
  /** Reshapes a field's DOMAIN (the schema), not the dataset. */
  axis: {
    scale(options?: EditOptions): Edit;
    /** Returns THREE edits — one authoring act, three descriptors. Spread it. */
    categories(options?: EditOptions): Edit[];
  };
  /** Turns a legend into an input; reads geometry only a legend stamps. */
  legend: {
    category(options?: LegendEditOptions): Edit;
    value(options?: EditOptions): Edit;
  };
  /** A whole divided among rows: `cut` splits, `edge` moves value across a
   *  boundary, `merge` fuses — each preserving the total by construction. */
  stack: {
    cut(options?: EditOptions): Edit;
    edge(options?: EditOptions): Edit;
    merge(options?: EditOptions): Edit;
  };
  /** A parametric line is edited by its PARAMETERS. */
  trend: {
    intercept(options?: TrendEditOptions): Edit;
    slope(options?: TrendEditOptions): Edit;
    interceptSpread(options?: TrendEditOptions): Edit;
    slopeSpread(options?: TrendEditOptions): Edit;
  };
  waffle: {
    fill(options?: EditOptions): Edit;
  };
  /** The gestures that build a network's TOPOLOGY. Creating and deleting a node
   *  are plain `create`/`remove`. */
  network: {
    connect(options?: NetworkConnectOptions): Edit;
    rewire(options?: NetworkEndpointOptions): Edit;
    reverse(options?: NetworkEndpointOptions): Edit;
  };
  /** Placed through the chart's `projection`. */
  geo: {
    move(options?: EditOptions): Edit;
    create(options?: CreateOptions): Edit;
    draw(options?: EditOptions): Edit;
    dragVertex(options?: EditOptions): Edit;
    removeVertex(options?: EditOptions): Edit;
    brush(options?: EditOptions): Edit;
    createRect(options?: CreateOptions): Edit;
  };
};

/**
 * CONSTRAINTS — pure data invariants over the elicited dataset. They gate and
 * REPAIR every edit, whichever mark fired it.
 */
export const constraints: {
  /** The extension point: author a rule against a data-only context. */
  defineConstraint(spec: Constraint | Record<string, unknown>): Constraint;
  clamp(options?: Record<string, unknown>): Constraint;
  maintainSum(options?: Record<string, unknown>): Constraint;
  /** Sugar for `maintainSum({ mode: 'normalize' })`. */
  normalize(options?: Record<string, unknown>): Constraint;
  count(options?: Record<string, unknown>): Constraint;
  unique(options?: Record<string, unknown>): Constraint;
  snap(options?: Record<string, unknown>): Constraint;
  ordering(options?: Record<string, unknown>): Constraint;
  monotonic(options?: Record<string, unknown>): Constraint;
  spacing(options?: Record<string, unknown>): Constraint;
};

/**
 * GUIDES — features that view chart STATE (`views: 'state'`). They draw the rule
 * and the state (a target line, a catchment, what is left to allocate), are
 * derived from the live chart rather than from a row, and write nothing.
 */
export const guides: {
  /** A reference line at a value, positioned through the scales. */
  rule(options?: Record<string, unknown>): Guide;
  /** A shaded band between two values — an acceptable range, a target zone. */
  region(options?: Record<string, unknown>): Guide;
  /** What is left to allocate under a rule. Reads its target from a
   *  `maintainSum` constraint when you don't pass one, so the number the reader
   *  is held to and the number they are shown cannot drift. */
  remaining(options?: Record<string, unknown>): Guide;
  /** The catchment of a proximity pick — how far it reaches to find a mark. */
  proximity(options?: Record<string, unknown>): Guide;
  /** The escape hatch: arbitrary read-only nodes from the live context. */
  custom(build: (ctx: any) => import('./types.js').FeatureNode[]): Guide;
};

/**
 * WIDGETS — named survey instruments. Each is a pure recipe over the core API and
 * returns a whole `ElicitSpec`, so it composes and serialises like any other spec.
 */
export const widgets: {
  likert(options?: WidgetOptions): ElicitSpec;
  multipleChoice(options?: WidgetOptions): ElicitSpec;
  slider(options?: WidgetOptions): ElicitSpec;
  matrix(options?: WidgetOptions): ElicitSpec;
  lineCone(options?: WidgetOptions): ElicitSpec;
  ranking(options?: WidgetOptions): ElicitSpec;
  allocation(options?: WidgetOptions): ElicitSpec;
  probabilityTokens(options?: WidgetOptions): ElicitSpec;
  interval(options?: WidgetOptions): ElicitSpec;
  histogram(options?: WidgetOptions): ElicitSpec;
  region(options?: WidgetOptions): ElicitSpec;
  thermometer(options?: WidgetOptions): ElicitSpec;
  labeledValue(options?: WidgetOptions): ElicitSpec;
};

/**
 * The AUTHORING KIT — what you build new vocabulary FROM. Deliberately outside the
 * grammar namespaces: none of these can appear in a spec.
 *
 * Also importable directly: `import { encodeChannel } from 'elicitjs/authoring'`.
 */
export const authoring: typeof import('./authoring/index.js');

/**
 * FORMATTERS — each returns a `(value) => string`. Every one is sugar over a d3
 * format specifier, which is why a `format` option also accepts the specifier
 * STRING directly: that keeps the option declarative (and expressible in JSON)
 * while the named helpers stay the readable spelling in JS.
 */
export const format: {
  /** A d3 number specifier, e.g. `'.1f'`. */
  number(specifier?: string): (v: any) => string;
  /** Default `'.0%'`. */
  percent(specifier?: string): (v: any) => string;
  /** SI prefix, default `'.2s'`. */
  si(specifier?: string): (v: any) => string;
  /** A d3 time specifier, default `'%Y-%m-%d'`. */
  time(specifier?: string): (v: any) => string;
  /** Wrap another format with a leading / trailing string. */
  prefix(prefix: string, inner?: string): (v: any) => string;
  suffix(suffix: string, inner?: string): (v: any) => string;
  /** Resolve a specifier string (or a function) to a formatter. */
  resolveFormat(format?: string | ((v: any) => any)): (v: any) => string;
};

export class D3Renderer implements Renderer {
  render(context: import('./types.js').RenderContext): void;
}

export class CanvasRenderer implements Renderer {
  render(context: import('./types.js').RenderContext): void;
}

export const themes: Record<string, Theme>;
export function setTheme(theme: DeepPartial<Theme> | null): void;
export function resolveTheme(partial?: DeepPartial<Theme>): Theme;
export const DEFAULT_THEME: Theme;

/**
 * The box a padded note of text occupies — `sticker`'s own sizing rule. Pass it the
 * same options you gave the sticker, then hand the result to a connector that docks
 * to the node's edge:
 * `link({ channels: { nodeWidth: { fn: d => noteBox(d.label).width } } })`.
 */
/**
 * Developer diagnostics are ON by default and print with an `[elicit]` prefix.
 * A consumer's production build goes quiet on its own (`NODE_ENV`); call this to
 * silence them explicitly.
 */
export function setWarnings(enabled: boolean): void;

export function noteBox(
  text: string,
  opts?: {
    padding?: number;
    maxWidth?: number;
    minWidth?: number;
    minHeight?: number;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
  },
): {
  block: { lines: string[]; width: number; height: number; lineHeight: number };
  width: number;
  height: number;
};
