// @ts-check
// guards.js — the engine's dev diagnostics. Every guard reports through
// `warn(key, msg)` (core/dev.js) and none is control flow: the chart draws the
// same whether or not one fires. Never gate a guard on a bundler-specific global.
// The capability tables (`SCOPE_CAPABILITY`, `KIND_SATISFIES`) sit beside the
// guards that read them.

import { axisOf } from './encoding.js';
import { scaleFor } from './scales.js';
import { drivers, driverFor, needsPlaneOnTop } from '../edit/drivers/index.js';
import { UNVERIFIED } from '../edit/shared.js';
import { warn, warningsEnabled } from './dev.js';

/**
 * How a mark is named in a dev message: the author's id, else the factory name
 * (`type`), else an anonymous form.
 * @param {any} feature
 * @returns {string}
 */
export function markLabel(feature) {
    if (!feature) return '(unknown mark)';
    // An engine-assigned id (`autoId`) is just a position, so prefer the factory name.
    if (feature.id && !feature.autoId) return `"${feature.id}"`;
    if (feature.type) return `${feature.type}()`;
    return feature.id ? `"${feature.id}"` : '(an unnamed mark)';
}

// Each edit scope names the mark capability it needs. A mismatch is a silent no-op
// (the `when` gate never fires), so warn once per feature+edit. A new mark family
// adds a row here.
/** @type {Record<string, { flag?: string, test?: (f: any) => boolean, expects: string }>} */
export const SCOPE_CAPABILITY = {
    line: { flag: 'supportsSeries', expects: 'a line mark (line/area)' },
    geo: { flag: 'supportsGeo', expects: 'a geo* mark (geoPoint, geoLine, …)' },
    stack: { flag: 'supportsStack', expects: 'a stacked mark (bar with `stack`, or arc/donut)' },
    waffle: { flag: 'supportsWaffle', expects: 'a waffle mark' },
    axis: { flag: 'isAxis', expects: 'an axis element (axisX/axisY/axisRadial)' },
    trend: { flag: 'supportsTrend', expects: 'a trend mark (trend/trendBand)' },
    network: { flag: 'supportsNetwork', expects: 'a link mark' },
    legend: { flag: 'isLegend', expects: 'a legend element' },
    // Not a flag: any element that `views` a scale (axis, grid, legend) can take a
    // domain edit.
    scale: { test: (/** @type {any} */ f) => f.views === 'scale', expects: 'an axis or legend element' },
};

// What a scale `kind` satisfies. A mark declares the capability it needs, never a
// scale type — the same rule the rest of the engine follows (see core/scales.js).
/** @type {Record<string, (kind: string) => boolean>} */
export const KIND_SATISFIES = {
    discrete: (k) => k === 'band' || k === 'point',
    band: (k) => k === 'band',
    point: (k) => k === 'point',
    continuous: (k) => k === 'continuous',
};

/**
 * A mark that needs something from a scale says so (`Mark.requires`); report the
 * mismatch instead of letting the mark degrade silently with fallback geometry.
 * @param {any} feature
 * @param {import('../types').ScaleMap} scales
 */
export function warnScaleRequirements(feature, scales) {
    const reqs = feature && feature.requires;
    if (!Array.isArray(reqs)) return;
    for (const req of reqs) {
        const test = KIND_SATISFIES[req.kind];
        if (!test) continue;
        const channels = req.channels || [];
        /** @param {string} ch */
        const ok = (ch) => {
            const scale = /** @type {any} */ (scales)[ch];
            return !!(scale && test(scale.kind));
        };
        const satisfied = req.match === 'any' ? channels.some(ok) : channels.every(ok);
        if (satisfied) continue;
        const which = req.match === 'any'
            ? `one of ${channels.map((/** @type {string} */ c) => `"${c}"`).join(' / ')}`
            : channels.map((/** @type {string} */ c) => `"${c}"`).join(' and ');
        const got = channels
            .map((/** @type {string} */ c) => {
                const s = /** @type {any} */ (scales)[c];
                return `${c}: ${s ? s.kind : 'no scale'}`;
            })
            .join(', ');
        warn(
            `requires:${markLabel(feature)}:${req.kind}:${channels.join(',')}`,
            `mark ${markLabel(feature)} needs a ${req.kind} scale on ${which}, but got ` +
            `${got}. ${req.why || ''} It will still draw, using fallback geometry that is ` +
            `not meaningful — declare the field's type on the spec's schema so the right ` +
            `scale resolves.`
        );
    }
}

/**
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 */
export function warnScopeMismatch(feature, edits) {
    for (const e of edits) {
        if (!e.scope) continue;
        const cap = SCOPE_CAPABILITY[e.scope];
        if (!cap) continue;
        if (cap.test ? cap.test(feature) : !!feature[/** @type {string} */ (cap.flag)]) continue;
        warn(
            `${markLabel(feature)}:${e.type}`,
            `edit.${e.type}() is attached to a mark without ${e.scope} support ` +
            `(mark ${markLabel(feature)}). ${e.scope}-scoped edits expect ${cap.expects}; it may not behave.`
        );
    }
}

/**
 * A projection chart replaces x/y placement for geo marks. Mixing ordinary
 * cartesian x/y channels on the same chart is unsupported in v1.
 * @param {any[]} features
 * @param {import('../types').ScaleMap} scales
 */
export function warnProjectionCartesianMix(features, scales) {
    if (!/** @type {any} */ (scales).projection) return;
    const offenders = features.filter((f) => {
        if (f.supportsGeo || f.views === 'scale') return false;
        const ch = f.channels || {};
        return Object.keys(ch).some((name) => axisOf(name) && ch[name] && ch[name].scale !== null);
    });
    if (!offenders.length) return;
    warn(
        `projcartesian:${offenders.map(markLabel).join(',')}`,
        `spec.projection is set together with cartesian x/y channels on ` +
        `${offenders.map(markLabel).join(', ')}. Projection charts use geo* marks ` +
        `(geoPoint, geoLine, …); mixing ordinary positional marks is unsupported.`
    );
}

// A plane gesture fans to every feature's plane-pick edits, so two marks over the
// same table each declaring `create()` append twice per click. Grouped by the table
// each edit writes: marks over different tables are not duplicates.
/**
 * @param {any[]} features
 * @param {(f: any) => import('../types').Edit[]} editsOf
 * @param {(f: any, e: import('../types').Edit) => string} tableOfEdit
 */
export function warnDuplicatePlaneEdits(features, editsOf, tableOfEdit) {
    /** @type {Record<string, any[]>} */
    const byTable = {};
    for (const f of features) {
        for (const e of editsOf(f)) {
            if (e.pick === 'direct') continue;
            // Domain and selection edits never write rows, and a driver that
            // `selects` one row per mark cannot double-apply.
            if (e.target === 'domain' || e.target === 'selection') continue;
            const d = driverFor(e);
            if (d && d.selects) continue;
            const t = tableOfEdit(f, e);
            const list = byTable[t] || (byTable[t] = []);
            if (!list.includes(f)) list.push(f);
        }
    }
    for (const [table, owners] of Object.entries(byTable)) {
        if (owners.length < 2) continue;
        // Keyed by the offending mark set, so each broken chart on a page reports.
        warn(
            `planedup:${table}:${owners.map(markLabel).join(',')}`,
            `${owners.length} marks carry a plane-pick edit over the same rows ` +
            `(marks ${owners.map(markLabel).join(', ')}). A plane gesture fans to all ` +
            `of them, so a whole-dataset edit (create/remove/rotate/toggle) will apply once per ` +
            `mark. Declare it on exactly one.`
        );
    }
}

// A legend picker writes the legend's `row`, which defaults to the selection. With
// several rows and nothing selected a click writes nothing, which is normally a
// waiting state. It is a bug only when nothing can ever arm it: no `row`, several
// rows, and no mark over that table with a selection edit.
/**
 * @param {any[]} features
 * @param {(f: any) => import('../types').Edit[]} editsOf
 * @param {(f: any) => any[]} rowsOf
 */
export function warnUnreachableLegendRow(features, editsOf, rowsOf) {
    // Only an edit that writes a row needs one. Domain and selection edits (those
    // with a `target`) are armed by the scale alone.
    const picks = (/** @type {any} */ f) => editsOf(f).filter((e) => !e.target);
    const legends = features.filter((f) => f && f.isLegend && picks(f).length && f.row == null);
    if (!legends.length) return;
    const canSelect = new Set(
        features
            .filter((f) => f && f.views !== 'scale' && editsOf(f).some((e) => e.target === 'selection'))
            .map((f) => f.table)
    );
    for (const lg of legends) {
        if (canSelect.has(lg.table) || rowsOf(lg).length <= 1) continue;
        warn(
            `legend:norow:${lg.channel}:${lg.id}`,
            `${markLabel(lg)} is a picker with no way to choose a row. Its target row defaults ` +
            `to the chart's SELECTION, "${lg.table}" has more than one row, and no mark over ` +
            `that table carries edit.select(). Add one, pin a row (legend({ row: 0 })), or ` +
            `drive el.select(i) — otherwise clicking a swatch writes nothing.`
        );
    }
}

/**
 * `edit.hierarchy.nest` reads where a node is released; something else has to carry
 * it there. On a mark with no drag edit of its own the node never leaves its spot,
 * so the pointer is the only thing that moves and the drop reads as a teleport.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @returns {void}
 */
export function warnNestAlone(feature, edits) {
    if (!edits.some(e => e.type === 'hierarchy.nest')) return;
    if (edits.some(e => e.type !== 'hierarchy.nest' && e.gesture === 'drag')) return;
    warn(
        `nestalone:${markLabel(feature)}`,
        `mark ${markLabel(feature)} carries edit.hierarchy.nest() and no drag edit beside it. ` +
        'nest decides where a node lands when it is released; a move is what carries it ' +
        "there. Add edit.move({ channels: ['x', 'y'], mode: 'relative' })."
    );
}


// `connect` finds its target as the node nearest the pointer at release. An
// unarbitrated drag edit on the same mark (e.g. `move`) carries the source node
// under the pointer, so connect sees a release on itself and does nothing. The fix
// is `when`: `move({ when: when.noShift })` beside `connect({ when: when.shift })`.
/** @param {any} feature @param {import('../types').Edit[]} edits */
export function warnConnectConflict(feature, edits) {
    const connects = edits.filter(e => e.type === 'network.connect' && !e.when);
    if (!connects.length) return;
    const rivals = edits.filter(e =>
        e.type !== 'network.connect' && e.pick === 'direct' && e.gesture === 'drag' && !e.when);
    if (!rivals.length) return;
    warn(
        `connectconflict:${markLabel(feature)}`,
        `mark ${markLabel(feature)} carries edit.network.connect() beside ` +
        `${rivals.map(e => `${e.type}()`).join(', ')}, and neither arbitrates with \`when\`. ` +
        `A plain drag fans to both: the other edit moves the source node along under the ` +
        `pointer, so connect finds that same node at release and creates nothing. Split ` +
        `them — connect({ when: when.shift }) and ${rivals[0].type}({ when: when.noShift }).`
    );
}

// A creator declares `cardinality`; read as a capability, never a list of type names.
const CREATES = new Set(['append', 'appendMany', 'toggle']);
/** @param {import('../types').Edit} e @returns {boolean} */
function isDatasetCreator(e) {
    return e.target !== 'domain' && CREATES.has(/** @type {string} */ (e.cardinality));
}

/**
 * Creation mints dataset rows, so it needs a data mark with an invertible
 * positional channel. Warn when a creator sits on a chart element (which edits the
 * domain instead) or on a mark whose positional channels cannot invert.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @param {import('../types').ScaleMap} scales
 */
export function warnCreateOnNonMark(feature, edits, scales) {
    for (const e of edits) {
        if (!isDatasetCreator(e)) continue;
        if (feature.supportsGeo) continue; // geo places via the projection, not a channel scale
        const key = `${markLabel(feature)}:nomark:${e.type}`;

        if (feature.views === 'scale') {
            warn(
                key,
                `a create/${e.type} edit is on ${markLabel(feature)}, which is a chart element ` +
                `(axis/grid/legend), ` +
                `not a data mark. Creation mints dataset rows; a guide edits the DOMAIN instead ` +
                `(edit.axis.*). Move the create to a data mark.`
            );
            continue;
        }
        const names = e.channels && e.channels.length ? e.channels : ['x', 'y'];
        const anyInvertible = names.some((n) => {
            const s = /** @type {any} */ (scales)[n];
            return s && s.invertible;
        });
        if (!anyInvertible) {
            warn(
                key,
                `a create/${e.type} edit is on ${markLabel(feature)}, but none of its positional ` +
                `channels (${names.join(', ')}) has an invertible scale — the pointer can't be ` +
                `inverted to a datum, so the create is a no-op. Creation needs a data mark on an axis.`
            );
        }
    }
}

/**
 * An extent mark (a rect from x1/x2 or y1/y2 spans) needs its span seeded, or a
 * create mints a zero-size row. Warn when neither the schema nor the creator's
 * `defaults` seeds the endpoints.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @param {Record<string, any> | undefined} schema
 */
export function warnCreateEmptyExtent(feature, edits, schema) {
    const ch = feature.channels || {};
    /** @type {string[]} */
    const spanFields = [];
    // A span channel with no `field` (a {value}) has nothing to seed, so drop it.
    if (ch.x1 && ch.x2) spanFields.push(ch.x1.field, ch.x2.field);
    if (ch.y1 && ch.y2) spanFields.push(ch.y1.field, ch.y2.field);
    const named = spanFields.filter(Boolean);
    if (!named.length) return;
    for (const e of edits) {
        if (!isDatasetCreator(e)) continue;
        const seeded = new Set(Object.keys(e.defaults || {}));
        const missing = named.filter((f) =>
            !seeded.has(f) && !(schema && schema[f] && schema[f].default !== undefined));
        if (!missing.length) continue;
        warn(
            `${markLabel(feature)}:extent:${e.type}`,
            `create/${e.type} on the extent mark ${markLabel(feature)} doesn't seed ${missing.join(', ')}, ` +
            `so a new row is minted with no extent (zero-size, invisible). Seed it via ` +
            `create({ defaults: { … } }) or a field default in the schema.`
        );
    }
}

/**
 * An edit whose `pick` names no registered driver is silently dead (a typo, or a
 * custom driver never registered). Report once per feature+pick.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 */
export function warnUnclaimedPick(feature, edits) {
    for (const e of edits) {
        if (!e.pick || e.pick === 'direct') continue;
        if (driverFor(e)) continue;
        warn(
            `${markLabel(feature)}:nopick:${e.pick}`,
            `${e.type}() on ${markLabel(feature)} has pick: "${e.pick}", which names no ` +
            `registered driver, so no gesture will ever reach it. Registered picks are ` +
            `${['direct', ...drivers.map((d) => d.name)].join(', ')}; a custom one needs registerDriver().`
        );
    }
}

/**
 * An option an edit factory was handed that nothing reads. `makeEdit` stamps the
 * keys its vocabulary did not account for; the driver's declared `options` are
 * subtracted before reporting.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 */
export function warnUnknownEditOptions(feature, edits) {
    for (const e of edits) {
        const keys = /** @type {any} */ (e)[UNVERIFIED];
        if (!keys || !keys.length) continue;
        const driver = driverFor(e);
        const known = new Set(driver && driver.options ? driver.options : []);
        const unknown = keys.filter((/** @type {string} */ k) => !known.has(k));
        if (!unknown.length) continue;
        warn(
            `${markLabel(feature)}:editopt:${e.type}:${unknown.join(',')}`,
            `${e.type}() on ${markLabel(feature)} was given ${unknown.map((/** @type {string} */ k) => `\`${k}\``).join(', ')}, ` +
            `which ${unknown.length > 1 ? 'are' : 'is'} not ${unknown.length > 1 ? 'options' : 'an option'} ` +
            `this edit${driver ? ` or its "${driver.name}" driver` : ''} reads, so ` +
            `${unknown.length > 1 ? 'they are' : 'it is'} ignored.`
        );
    }
}

/**
 * How a constraint names itself in a dev message. A descriptor carries its
 * `type`; a hand-written one is just a function, so fall back to its name and
 * then to an anonymous form.
 * @param {any} constraint
 * @returns {string}
 */
export function constraintLabel(constraint) {
    if (!constraint) return '(unknown)';
    if (typeof constraint !== 'function' && constraint.type) return `${constraint.type}()`;
    if (constraint.name) return `${constraint.name}()`;
    return '(an anonymous constraint)';
}

/**
 * Short, safe description of an unexpected value for a message — never stringifies
 * something large or cyclic.
 * @param {any} v
 * @returns {string}
 */
export function describe(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'an array';
    const t = typeof v;
    if (t === 'object') return 'an object';
    if (t === 'string') return `the string ${JSON.stringify(v.slice(0, 20))}`;
    return `the ${t} ${String(v)}`;
}


/**
 * The dead-drag guard. An edit maps a gesture back through a channel's scale, so
 * it writes nothing if that scale does not invert, while the drag still feels
 * alive. Reports per dead channel, so a live x does not hide a dead y.
 * Creators are covered by `warnCreateOnNonMark`.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @param {import('../types').ScaleMap} scales
 */
export function warnDeadEditChannels(feature, edits, scales) {
    const markChannels = feature.channels || {};
    for (const e of edits) {
        // Only an edit that runs the pointer back through a scale can die here;
        // `'domain'` (slide) interpolates over the domain and works on a ramp.
        if (e.inverts !== true) continue;
        // A creator mints a whole row rather than inverting one channel, and has
        // its own guard (warnCreateOnNonMark).
        if (isDatasetCreator(e)) continue;
        if (feature.supportsGeo) continue; // placed by the projection, not a channel scale
        const names = e.channels || [];
        if (!names.length) continue;
        /** @param {string} n */
        const tested = (n) => {
            const spec = markChannels[n];
            // No field means no column to write; warnMisplacedEdits reports that case.
            return spec && spec.field != null ? scaleFor(scales, n, spec.field) : null;
        };
        const dead = names.filter((n) => {
            const s = tested(n);
            return s && !s.invertible;
        });
        if (!dead.length) continue;
        warn(
            `${markLabel(feature)}:dead:${e.type}:${dead.join(',')}`,
            `${e.type}() on ${markLabel(feature)} edits channel${dead.length > 1 ? 's' : ''} ` +
            `${dead.map((n) => `"${n}"`).join(', ')}, whose scale cannot be inverted ` +
            `(${dead.map((n) => tested(n).type || 'ordinal').join(', ')}). ` +
            `An edit runs a gesture BACKWARD through the scale, so a non-invertible channel ` +
            `silently does nothing. Edit a positional channel (x/y), or give the channel a ` +
            `continuous, band or point scale.`
        );
    }
}

/**
 * An inverting edit that resolves no channel writes nothing (e.g. a mark-level
 * `edits: [move()]` that names none). Say which channel to name.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits the collected edits (placement channels injected)
 */
export function warnMissingEditChannels(feature, edits) {
    if (feature.supportsGeo) return; // geo edits invert through the projection
    for (const e of edits) {
        if (!e.inverts || isDatasetCreator(e)) continue;
        if (e.channels && e.channels.length) continue;
        warn(
            `${markLabel(feature)}:nochannel:${e.type}`,
            `${e.type}() on ${markLabel(feature)} names no channel, so it has nothing to write. ` +
            `Put it on the channel it edits (\`y: { field, edit: ${e.type}() }\`) or pass ` +
            `\`channels: ['y']\`.`
        );
    }
}

/**
 * A line or area with `handles: false` emits no handle nodes, and a proximity
 * edit (sweep, nearest, draw) resolves its target from those nodes — so the edit
 * finds nothing and the chart reads as inert. `handles: 'hit'` is the spelling
 * for invisible-but-targetable.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 */
export function warnHiddenHandles(feature, edits) {
    if (feature.handles !== false) return;
    if (!needsPlaneOnTop(edits)) return;
    const types = [...new Set(edits.filter((e) => e.pick !== 'direct' && e.pick !== 'plane').map((e) => e.type))];
    if (!types.length) return;
    warn(
        `${markLabel(feature)}:handles:hidden`,
        `${markLabel(feature)} has handles: false, but ${types.map((t) => `${t}()`).join(', ')} ` +
        `resolves its target from the handles, so it has nothing to aim at. Use ` +
        `handles: 'hit' to keep them targetable but invisible.`
    );
}

/**
 * Every key `Elicit` reads. A spec key is either here or it does nothing, so this
 * doubles as the closed key set the JSON grammar is generated from.
 * @type {string[]}
 */
export const SPEC_KEYS = [
    // Frame
    'width', 'height', 'margins', 'responsive', 'overflow', 'focusOutline', 'clip',
    // The three kinds of feature: marks view data, elements view a scale, guides
    // view state. Plus the implicit layers that desugar into elements.
    'marks', 'elements', 'guides', 'axes', 'legends',
    // The elicited dataset and its contract
    'schema', 'data', 'constraints', 'lock', 'context',
    // Scales (per channel). No `domain` here — a domain describes the data.
    'scales', 'projection',
    // Presentation
    'theme', 'effects',
    // Chart chrome that reserves layout space like a legend (core/titles.js)
    'title', 'subtitle', 'caption',
    // Multi-stage elicitation
    'stage', 'stageLabels',
    // View options — runtime, not part of a serializable spec
    'onChange', 'renderer',
];

/**
 * Spec keys that are wrong in a specific, diagnosable way (like `MISTAKEN_OPTIONS`
 * for marks in plot/mark.js).
 * @type {Record<string, string>}
 */
export const MISTAKEN_SPEC_KEYS = {
    mark: 'did you mean `marks`? (an array of marks — plot.*)',
    element: 'did you mean `elements`? (an array of chart elements — elements.*)',
    guide: 'did you mean `guides`? (an array of guides — guides.*)',
    constraint: 'did you mean `constraints`? (an array of dataset invariants)',
    scale: 'did you mean `scales`? (per-channel scale config, keyed by channel name)',
    edit: 'an edit goes on a mark — either on a channel (`y: { field, edit: move() }`) or in the mark\'s `edits: [...]`. There is no chart-level `edit`.',
    edits: 'edits go on a MARK, not on the spec: `barY({ edits: [move()] })`.',
    onchange: 'did you mean `onChange`? (capital C)',
    domain: "a domain describes the DATA, so it lives on the schema: schema: { field: { domain: [...] } }.",
    x: 'there is no chart-level `x`. Scale config is `scales: { x: {...} }`; a field\'s domain is the schema\'s.',
    y: 'there is no chart-level `y`. Scale config is `scales: { y: {...} }`; a field\'s domain is the schema\'s.',
    type: 'a chart has no `type` — what it draws is its `marks`. A FIELD\'s type belongs on the schema; the DATASET\'s shape is the schema\'s `structure`.',
    container: 'Elicit returns the chart element — append it yourself: `container.appendChild(Elicit(spec))`.',
    el: 'Elicit returns the chart element; it does not take one.',
};

/**
 * Warn about spec keys that will be silently ignored.
 * @param {any} spec
 * @returns {void}
 */
export function warnUnknownSpecKeys(spec) {
    if (!spec || !warningsEnabled()) return;
    const known = new Set(SPEC_KEYS);
    for (const key of Object.keys(spec)) {
        if (known.has(key)) continue;
        const fix = MISTAKEN_SPEC_KEYS[key];
        warn(
            `spec:${key}`,
            fix
                ? `Elicit({ ${key}: … }): ${fix}`
                : `Elicit({ ${key}: … }) is not a key the chart reads, so it is ignored. ` +
                  `Spec keys are: ${SPEC_KEYS.slice().sort().join(', ')}.`,
        );
    }
}
