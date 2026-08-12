/**
 * Public API typings for `elicit-js` / `@elicit`.
 * Shape interfaces live in `./types`; this file declares the callable surface.
 */
import type {
  AnchorOptions,
  BrushRectOptions,
  BrushSpanOptions,
  Constraint,
  CreateOptions,
  DeepPartial,
  DrawOptions,
  Edit,
  EditOptions,
  ElicitElement,
  ElicitSpec,
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

export const plot: {
  bar(options?: MarkOptions): Mark;
  barX(options?: MarkOptions): Mark;
  barY(options?: MarkOptions): Mark;
  rect(options?: MarkOptions): Mark;
  rectX(options?: MarkOptions): Mark;
  rectY(options?: MarkOptions): Mark;
  tick(options?: MarkOptions): Mark;
  tickX(options?: MarkOptions): Mark;
  tickY(options?: MarkOptions): Mark;
  line(options?: MarkOptions): Mark;
  lineX(options?: MarkOptions): Mark;
  lineY(options?: MarkOptions): Mark;
  connectedScatter(options?: MarkOptions): Mark;
  path(options?: MarkOptions): Mark;
  area(options?: MarkOptions): Mark;
  areaX(options?: MarkOptions): Mark;
  areaY(options?: MarkOptions): Mark;
  point(options?: MarkOptions): Mark;
  face(options?: FaceOptions): Mark;
  ellipse(options?: MarkOptions): Mark;
  curve(options?: MarkOptions): Mark;
  curveX(options?: MarkOptions): Mark;
  curveY(options?: MarkOptions): Mark;
  text(options?: MarkOptions): Mark;
  textX(options?: MarkOptions): Mark;
  textY(options?: MarkOptions): Mark;
  rule(options?: MarkOptions): Mark;
  ruleX(options?: MarkOptions): Mark;
  ruleY(options?: MarkOptions): Mark;
  dotStack(options?: MarkOptions): Mark;
  dotStackX(options?: MarkOptions): Mark;
  dotStackY(options?: MarkOptions): Mark;
  waffle(options?: MarkOptions): Mark;
  waffleX(options?: MarkOptions): Mark;
  waffleY(options?: MarkOptions): Mark;
  needle(options?: MarkOptions): Mark;
  axisRadial(options?: MarkOptions): Mark;
  arc(options?: MarkOptions): Mark;
  pie(options?: MarkOptions): Mark;
  donut(options?: MarkOptions): Mark;
  composite(options?: CompositeOptions): Mark;
  // Alias of `composite` — box mode used to be a separate mark.
  group(options?: CompositeOptions): Mark;
  // One row of the links table, drawn between the two nodes it references.
  link(options?: LinkOptions): Mark;
  // Presets over `composite`: a dot with a label, and a note you can type into.
  node(options?: MarkOptions): Mark;
  sticker(options?: StickerOptions): Mark;
  axis(options?: MarkOptions): Mark;
  axisX(options?: MarkOptions): Mark;
  axisY(options?: MarkOptions): Mark;
  grid(options?: MarkOptions): Mark;
  gridX(options?: MarkOptions): Mark;
  gridY(options?: MarkOptions): Mark;
  legend(options?: MarkOptions): Mark;
  legendColor(options?: MarkOptions): Mark;
  legendSize(options?: MarkOptions): Mark;
  legendSymbol(options?: MarkOptions): Mark;
  trend(options?: TrendOptions): Mark;
  trendBand(options?: TrendBandOptions): Mark;
  geoBasemap(options?: MarkOptions): Mark;
  geoTile(options?: MarkOptions): Mark;
  geoPoint(options?: MarkOptions): Mark;
  geoPolygon(options?: MarkOptions): Mark;
  geoLine(options?: MarkOptions): Mark;
  geoText(options?: MarkOptions): Mark;
  geoRect(options?: MarkOptions): Mark;
  [name: string]: (...args: any[]) => any;
};

/** Chart elements — scale chrome. Prefer over the `plot.*` aliases. */
export const elements: {
  axis(options?: MarkOptions): Mark;
  axisX(options?: MarkOptions): Mark;
  axisY(options?: MarkOptions): Mark;
  grid(options?: MarkOptions): Mark;
  gridX(options?: MarkOptions): Mark;
  gridY(options?: MarkOptions): Mark;
  legend(options?: MarkOptions): Mark;
  legendColor(options?: MarkOptions): Mark;
  legendSize(options?: MarkOptions): Mark;
  legendSymbol(options?: MarkOptions): Mark;
  axisRadial(options?: MarkOptions): Mark;
  [name: string]: (...args: any[]) => any;
};

export const edit: {
  move(options?: MoveOptions): Edit;
  moveSpan(options?: EditOptions): Edit;
  brushSpan(options?: BrushSpanOptions): Edit;
  brushRect(options?: BrushRectOptions): Edit;
  slide(options?: SlideOptions): Edit;
  resize(options?: EditOptions): Edit;
  rotate(options?: RotateOptions): Edit;
  cycle(options?: EditOptions): Edit;
  create(options?: CreateOptions): Edit;
  toggle(options?: ToggleOptions): Edit;
  remove(options?: EditOptions): Edit;
  set(options?: EditOptions): Edit;
  editText(options?: EditOptions): Edit;
  legend(options?: LegendEditOptions): Edit;
  legendValue(options?: LegendEditOptions): Edit;
  select(options?: SelectEditOptions): Edit;
  custom(options?: EditOptions & { apply?: Edit['apply'] }): Edit;
  rank(options?: EditOptions): Edit;
  line: {
    anchor(options?: AnchorOptions): Edit;
    newSeries(options?: NewSeriesOptions): Edit;
    draw(options?: DrawOptions): Edit;
    sweep(options?: DrawOptions): Edit;
    removeSeries(options?: EditOptions): Edit;
  };
  axis: {
    scale(options?: EditOptions): Edit;
    categories(options?: EditOptions): Edit[];
  };
  arc: {
    edge(options?: EditOptions): Edit;
  };
  trend: {
    intercept(options?: TrendEditOptions): Edit;
    slope(options?: TrendEditOptions): Edit;
    interceptSpread(options?: TrendEditOptions): Edit;
    slopeSpread(options?: TrendEditOptions): Edit;
  };
  waffle: {
    fill(options?: EditOptions): Edit;
  };
  network: {
    // Drag from one node to another. Goes on the NODE mark; the proposal is a
    // link row, so it carries no `scope` (a node mark declares no capability).
    connect(options?: NetworkConnectOptions): Edit;
    // Drag a link's endpoint handle onto a different node. Goes on the `source`
    // or `target` channel of a link mark.
    rewire(options?: NetworkEndpointOptions): Edit;
    // Swap a link's two ends. Goes on a link mark and lands on its hit path.
    reverse(options?: NetworkEndpointOptions): Edit;
  };
  geo: {
    move(options?: EditOptions): Edit;
    create(options?: CreateOptions): Edit;
    draw(options?: EditOptions): Edit;
    dragVertex(options?: EditOptions): Edit;
    removeVertex(options?: EditOptions): Edit;
    brush(options?: EditOptions): Edit;
    createRect(options?: CreateOptions): Edit;
  };
  [name: string]: any;
};

export function when(
  predicate: (ctx: import('./types.js').EditContext) => boolean
): (ctx: import('./types.js').EditContext) => boolean;

export const constraints: {
  defineConstraint(spec: Constraint): Constraint;
  define(spec: Constraint): Constraint;
  custom(spec: Constraint): Constraint;
  clamp(options?: Record<string, unknown>): Constraint;
  maintainSum(options?: Record<string, unknown>): Constraint;
  normalize(options?: Record<string, unknown>): Constraint;
  count(options?: Record<string, unknown>): Constraint;
  unique(options?: Record<string, unknown>): Constraint;
  snap(options?: Record<string, unknown>): Constraint;
  ordering(options?: Record<string, unknown>): Constraint;
  monotonic(options?: Record<string, unknown>): Constraint;
  spacing(options?: Record<string, unknown>): Constraint;
  [name: string]: any;
};

export const guides: {
  proximity(options?: Record<string, unknown>): unknown;
  rule(options?: Record<string, unknown>): unknown;
  region(options?: Record<string, unknown>): unknown;
  custom(options?: Record<string, unknown>): unknown;
  [name: string]: any;
};

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
  ci(options?: WidgetOptions): ElicitSpec;
  histogram(options?: WidgetOptions): ElicitSpec;
  region(options?: WidgetOptions): ElicitSpec;
  thermometer(options?: WidgetOptions): ElicitSpec;
  labeledValue(options?: WidgetOptions): ElicitSpec;
  [name: string]: any;
};

export const format: Record<string, any>;

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
