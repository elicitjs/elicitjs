// @ts-check
// vocabulary.js: every factory's option list. Factories validate against these.
// This module imports nothing, so any module can read it without a cycle.
// `allow-lists.test.js` and `check:exports` keep the lists, types and factories
// in agreement. Each kind's universal options are listed once, not per entry.

/** Options every mark accepts. (`constraints` belongs on the spec, not a mark.)
 *  @type {string[]} */
export const MARK_UNIVERSAL_OPTIONS = ['channels', 'id', 'edits', 'table', 'tip', 'clip'];

/** Top-level constant shorthands every mark desugars into channels
 *  (`fill: 'red'` -> `channels.fill = { value: 'red' }`). `size` and the text
 *  names are read by the marks themselves; `angle` is a rotation in place.
 *  @type {string[]} */
export const MARK_SHORTHANDS = [
    'fill', 'stroke', 'strokeWidth', 'strokeDash', 'opacity', 'fillOpacity', 'strokeOpacity',
    'size', 'symbol', 'text', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily',
    'textAnchor', 'lineAnchor', 'dx', 'dy',
    'angle',
];

/** Options every chart element accepts. `field` and `table` name what its edits write.
 *  @type {string[]} */
export const ELEMENT_UNIVERSAL_OPTIONS = ['id', 'edit', 'edits', 'field', 'table'];

/** Options every guide accepts. @type {string[]} */
export const GUIDE_UNIVERSAL_OPTIONS = ['id'];

/** Each mark's options beyond the universal ones and the shorthands. `…X`/`…Y`
 *  variants share their bare mark's entry.
 *  @type {Record<string, string[]>} */
export const MARK_OPTIONS = {
    arc: ['outerRadius', 'innerRadius', 'padAngle', 'arc', 'start', 'end', 'handles', 'handleSize', 'handleColor'],
    area: ['orientation', 'curve', 'handles', 'handleSize', 'handleColor', 'connect', 'gradient'],
    bar: ['orientation', 'stack', 'handles', 'handleSize', 'handleColor', 'gradient', 'rx'],
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
        'cornerRadius', 'sourceSide', 'targetSide',
        'sourceOffset', 'targetOffset',
        'handles', 'handleSize', 'handleColor',
    ],
    needle: ['length', 'handles', 'handleSize', 'handleColor', 'baseWidth', 'tipWidth'],
    node: ['dy', 'shape', 'format'],
    point: ['shape'],
    shape: ['path'],
    rect: ['orientation', 'width', 'height', 'rx', 'gradient'],
    rule: ['orientation', 'discreteScale'],
    sticker: ['padding', 'radius', 'maxWidth', 'minWidth', 'minHeight', 'lineHeight', 'format'],
    text: ['orientation', 'format', 'wrap', 'lineHeight'],
    tick: ['orientation', 'inset', 'length'],
    trend: ['anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor'],
    trendBand: ['render', 'levels', 'samples', 'seed', 'sigma', 'distribution', 'anchor', 'probe', 'grip', 'handles', 'handleSize', 'handleColor'],
    waffle: ['orientation', 'unit', 'multiple', 'gap', 'shape', 'showEmpty', 'emptyFill'],
};

/** Each chart element's options beyond the universal ones.
 *  @type {Record<string, string[]>} */
export const ELEMENT_OPTIONS = {
    axis: [
        'channel', 'anchor', 'transform', 'ticks', 'tickValues', 'tickFormat', 'tickSize',
        'tickPadding', 'title', 'titleAngle', 'stroke', 'strokeWidth', 'line', 'fill', 'fontSize',
        'fontFamily', 'fontWeight', 'labelAngle', 'titleFill', 'titleFontSize', 'titleFontWeight',
        'titlePadding', 'titleAnchor', 'labelAlign', 'labelOffset', 'offset', 'grid',
        'handleColor', 'handleSize',
    ],
    grid: ['channel', 'ticks', 'tickValues', 'stroke', 'strokeWidth', 'strokeDash', 'opacity', 'zero', 'bandPosition'],
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

/** Each guide's options beyond the universal ones.
 *  @type {Record<string, string[]>} */
export const GUIDE_OPTIONS = {
    rule: ['x', 'y', 'stroke', 'strokeDash', 'strokeWidth', 'opacity', 'label'],
    region: ['x', 'y', 'fill', 'opacity', 'stroke', 'label'],
    remaining: ['field', 'total', 'unit', 'format', 'anchor', 'label', 'fill', 'fontSize'],
    proximity: ['target', 'stroke', 'strokeDash', 'strokeWidth', 'opacity'],
    // Survey-instrument guides (widgets/theme.js).
    prompt: ['y'],
    optionRings: ['labelOffset', 'radius'],
    cellGrid: ['pad'],
    sliderTrack: ['format'],
    quadrants: ['x', 'y'],
    // Pointer-following guides (guides/tip.js, guides/crosshair.js).
    tip: ['mark', 'text', 'anchor', 'dx', 'dy', 'fill', 'stroke', 'fontSize', 'format'],
    crosshair: ['x', 'y', 'readout', 'stroke', 'strokeDash', 'fontSize', 'format'],
    custom: ['tracksPointer'],
};

/** The options `makeEdit` reads on every edit. Others come from `EDIT_OPTIONS` or
 *  a driver's `Driver.options`.
 *  @type {string[]} */
export const EDIT_UNIVERSAL_OPTIONS = [
    'type', 'name', 'gesture', 'channel', 'channels', 'when', 'pick', 'threshold',
    'scope', 'into', 'constrain', 'guide', 'stage', 'advance', 'target',
    'cardinality', 'inverts', 'viewport', 'spans', 'table', 'inline', 'multiline', 'defaults', 'apply',
    'targets', 'cursor', 'grabs',
];

/** Each edit's options beyond `EDIT_UNIVERSAL_OPTIONS`, keyed by its dotted `type`.
 *  A type with no entry is not validated.
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
    'axis.zoom': ['field', 'factor', 'limit', 'minSpan'],
    'axis.pan': ['field', 'limit'],
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
    'network.connect': [],
    'network.rewire': [],
    'network.reverse': [],
    'hierarchy.nest': [],
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
    follow: ['field', 'lead'],
    symmetric: ['field', 'about'],
    custom: [],
};
