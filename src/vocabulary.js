// @ts-check
// vocabulary.js — every factory's OPTION VOCABULARY, in one file that imports
// nothing.
//
// A factory validates the options it is handed against a list (marks through
// `normalizeMarkOptions`, elements through `warnUnknownElementOptions`, guides
// through `warnUnknownGuideOptions`, edits through `makeEdit`), and that list used
// to be an inline array at each call site — 28 of them for marks alone — so it was
// unreachable by anything else. The same list is what the typings, the docs API
// tables and the planned JSON schema have to agree with, and a list that can only
// be read by the one function that consumes it cannot be checked against them.
//
// So the lists live here and the factories import them. This module has NO
// imports, which is what lets both a mark and the export gate read it without a
// cycle. A key is either in a factory's list or the factory does not read it; the
// unit suite (`allow-lists.test.js`) and `check:exports` hold both directions.
//
// The keys every factory of a kind accepts (`channels`/`id`/`edits`/`table` on a
// mark, the style shorthands, `channel`/`when`/`stage`/… on an edit) are NOT
// repeated per entry — they are the kind's universal set, declared once beside
// the validator that applies it.

/** Options EVERY mark accepts, whatever it draws. (`constraints` is deliberately
 *  absent: a constraint is a DATASET invariant and belongs on the spec.)
 *  @type {string[]} */
export const MARK_UNIVERSAL_OPTIONS = ['channels', 'id', 'edits', 'table'];

/** Top-level constant shorthands every mark desugars into channels
 *  (`fill: 'red'` -> `channels.fill = { value: 'red' }`). `size` and the text
 *  names are read by the marks themselves; `angle` is a rotation in place.
 *  @type {string[]} */
export const MARK_SHORTHANDS = [
    'fill', 'stroke', 'strokeWidth', 'opacity', 'fillOpacity', 'strokeOpacity',
    'size', 'symbol', 'text', 'fontSize', 'textAnchor', 'lineAnchor', 'dx', 'dy',
    'angle',
];

/** Options every chart element accepts. `field` and `table` say WHAT an edit on
 *  the element writes; an element has no channel map to say it otherwise.
 *  @type {string[]} */
export const ELEMENT_UNIVERSAL_OPTIONS = ['id', 'edit', 'edits', 'field', 'table'];

/** Options every guide accepts. @type {string[]} */
export const GUIDE_UNIVERSAL_OPTIONS = ['id'];

/** Mark factories: the options each reads on top of the universal mark options
 *  and the style shorthands (see `normalizeMarkOptions`, plot/mark.js). Keyed by
 *  the mark keyword; the `…X`/`…Y` variants share their bare mark's entry.
 *  @type {Record<string, string[]>} */
export const MARK_OPTIONS = {
    arc: ['outerRadius', 'innerRadius', 'padAngle', 'arc', 'start', 'end', 'handles', 'handleSize', 'handleColor'],
    area: ['orientation', 'curve', 'handles', 'handleSize', 'handleColor', 'connect'],
    bar: ['orientation', 'stack', 'handles', 'handleSize', 'handleColor'],
    composite: ['parts', 'discreteScale'],
    curve: ['orientation', 'length'],
    dotStack: ['orientation', 'gap', 'ghost', 'label'],
    ellipse: [],
    face: ['ink'],
    geoBasemap: ['geojson', 'stroke', 'strokeWidth', 'fill'],
    geoTile: ['url', 'subdomains', 'tileSize', 'minZoom', 'maxZoom', 'zoomOffset', 'attribution', 'attributionSize', 'opacity'],
    geoPoint: [],
    geoPolygon: [],
    geoLine: ['curve', 'handles', 'handleSize', 'handleColor', 'connect', 'showVertices'],
    geoText: ['format'],
    geoRect: [],
    line: ['orientation', 'curve', 'handles', 'handleSize', 'handleColor', 'connect'],
    link: [
        'curve', 'curvature', 'spread', 'arrow', 'arrowSize',
        'inset', 'sourceInset', 'targetInset', 'loopRadius', 'format',
        'labelBackground', 'labelPadding', 'labelRadius', 'labelOpacity',
        'nodeWidth', 'nodeHeight', 'cornerRadius', 'sourceSide', 'targetSide',
        'handles', 'handleSize', 'handleColor',
    ],
    needle: ['length', 'handles', 'handleSize', 'handleColor', 'baseWidth'],
    node: ['dy', 'shape', 'format'],
    point: ['shape'],
    rect: ['orientation', 'width', 'height', 'rx'],
    rule: ['orientation', 'strokeDasharray', 'discreteScale'],
    sticker: ['padding', 'radius', 'maxWidth', 'minWidth', 'minHeight', 'lineHeight', 'fontFamily', 'format'],
    text: ['orientation', 'format', 'wrap', 'lineHeight'],
    tick: ['orientation', 'inset', 'length'],
    trend: ['anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor'],
    trendBand: ['render', 'levels', 'samples', 'seed', 'sigma', 'distribution', 'anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor'],
    waffle: ['orientation', 'unit', 'multiple', 'gap', 'shape', 'showEmpty', 'emptyFill'],
};

/** Chart elements: the options each reads on top of the universal element options
 *  (`id`/`edit`/`edits`/`field`/`table` — see `warnUnknownElementOptions`).
 *  @type {Record<string, string[]>} */
export const ELEMENT_OPTIONS = {
    axis: [
        'channel', 'anchor', 'transform', 'ticks', 'tickValues', 'tickFormat', 'tickSize',
        'title', 'stroke', 'fill', 'fontSize', 'grid', 'handleColor', 'handleSize',
    ],
    grid: ['channel', 'ticks', 'tickValues', 'stroke', 'strokeWidth'],
    legend: [
        'channel', 'anchor', 'orient', 'swatchSize', 'gap', 'labelWidth', 'rampLength',
        'rampThickness', 'ticks', 'tickFormat', 'title', 'row', 'stroke', 'fill',
        'fontSize', 'handleColor', 'handleSize',
    ],
    axisRadial: [
        'channel', 'channels', 'radius', 'innerRadius', 'bandWidth', 'ticks', 'tickValues',
        'tickFormat', 'tickSize', 'labelOffset', 'bands', 'title', 'arc', 'orient',
        'start', 'end', 'labelFill', 'stroke', 'strokeWidth', 'fontSize',
    ],
};

/** Guides: the options each reads on top of the universal guide options (`id`).
 *  @type {Record<string, string[]>} */
export const GUIDE_OPTIONS = {
    rule: ['x', 'y', 'stroke', 'strokeDasharray', 'strokeWidth', 'opacity', 'label'],
    region: ['x', 'y', 'fill', 'opacity', 'stroke', 'label'],
    remaining: ['field', 'total', 'unit', 'format', 'anchor', 'label', 'fill', 'fontSize'],
    proximity: ['target', 'stroke', 'strokeDasharray', 'strokeWidth', 'opacity'],
    // The survey-instrument affordances (widgets/theme.js) — grammar keywords too.
    prompt: ['y'],
    optionRings: ['labelOffset', 'radius'],
    cellGrid: ['pad'],
    sliderTrack: ['format'],
    crosshair: ['x', 'y'],
    custom: [],
};

/** The keys `makeEdit` (edit/shared.js) normalizes on EVERY edit — the universal
 *  edit options. Anything else a factory is handed is either in that factory's
 *  `EDIT_OPTIONS` entry, a knob its driver declares (`Driver.options`), or a typo.
 *  @type {string[]} */
export const EDIT_UNIVERSAL_OPTIONS = [
    'type', 'name', 'gesture', 'channel', 'channels', 'when', 'pick', 'threshold',
    'scope', 'into', 'constrain', 'guide', 'stage', 'advance', 'target',
    'cardinality', 'inverts', 'table', 'inline', 'multiline', 'defaults', 'apply',
];

/** Edit factories: the options each reads on top of `EDIT_UNIVERSAL_OPTIONS`,
 *  keyed by the edit's `type` (its dotted path). A type with no entry is a custom
 *  edit built through `makeEdit` directly, and is not validated.
 *  @type {Record<string, string[]>} */
export const EDIT_OPTIONS = {
    move: ['mode'],
    moveSpan: [],
    brushSpan: ['edgeInset'],
    brushRect: ['edgeInset', 'resize', 'move'],
    slide: ['axis', 'increase', 'extent', 'mode'],
    resize: [],
    rotate: ['relativeTo', 'pivot', 'fold'],
    cycle: [],
    create: [],
    toggle: [],
    remove: [],
    set: [],
    editText: [],
    rank: [],
    select: ['exclusive', 'toggle', 'multi'],
    custom: [],
    'line.anchor': ['series'],
    'line.newSeries': ['along', 'value', 'samples', 'series'],
    'line.draw': ['along', 'value', 'samples', 'minDist', 'series'],
    'line.sweep': ['mode'],
    'line.removeSeries': ['series'],
    'axis.scale': ['field', 'mode'],
    'scale.addCategory': ['field', 'mode'],
    'scale.renameCategory': ['field', 'mode'],
    'scale.removeCategory': ['field', 'mode'],
    'legend.category': [],
    'legend.value': [],
    'stack.cut': ['label', 'categoryField'],
    'stack.edge': [],
    'stack.merge': [],
    'trend.intercept': ['anchor', 'probe'],
    'trend.slope': ['anchor', 'probe'],
    'trend.interceptSpread': ['anchor', 'probe'],
    'trend.slopeSpread': ['anchor', 'probe'],
    'waffle.fill': [],
    'network.connect': ['source', 'target', 'selfLoops'],
    'network.rewire': [],
    'network.reverse': ['source', 'target'],
    'geo.move': [],
    'geo.create': [],
    'geo.dragVertex': [],
    'geo.removeVertex': ['min'],
    'geo.draw': ['minDist'],
    'geo.brush': ['move', 'edgeInset'],
    'geo.createRect': ['width', 'height', 'edgeInset'],
};

/** Constraints: the options each reads. `field` is one name or an ordered list,
 *  and omitting it means "the column the dispatching edit writes".
 *  @type {Record<string, string[]>} */
export const CONSTRAINT_OPTIONS = {
    clamp: ['min', 'max', 'field'],
    snap: ['step', 'origin', 'field'],
    count: ['max', 'strategy'],
    unique: ['field', 'max', 'strategy'],
    maintainSum: ['total', 'field', 'strategy'],
    ordering: ['field', 'strategy'],
    monotonic: ['field', 'along', 'dir', 'series'],
    spacing: ['field', 'min', 'series'],
    custom: [],
};
