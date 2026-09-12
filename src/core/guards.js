// @ts-check
// guards.js — the engine's DEV DIAGNOSTICS, in one module.
//
// Every function here reports through `warn(key, msg)` from core/dev.js — on by
// default, deduped once per key, silenced with `setWarnings(false)`. None of them
// is control flow: the engine draws the same chart whether or not a guard fires.
// They lived at the top of core/elicit.js; they are here so the engine file holds
// the engine and a new guard is a function added here, not more lines in a
// 2500-line closure. The two capability tables (`SCOPE_CAPABILITY`,
// `KIND_SATISFIES`) live beside the guards that read them.
//
// They used to be gated on a Vite-only `import.meta.env.DEV` constant, which made
// every one of them dead on webpack/Next and stripped them from the built bundle;
// see the header of core/dev.js. Never re-gate a guard on a bundler-specific global.

import { axisOf } from './encoding.js';
import { driverFor } from '../edit/drivers/index.js';
import { UNVERIFIED } from '../edit/shared.js';
import { warn, warningsEnabled } from './dev.js';

// The capability guards below report through `warn(key, msg)` from core/dev.js —
// on by default, deduped once per key, silenced with `setWarnings(false)`. They
// used to be gated on a Vite-only `import.meta.env.DEV` constant, which made every
// one of them dead on webpack/Next and stripped them from the built bundle; see
// the header of core/dev.js. Never re-gate a guard on a bundler-specific global.
/**
 * How a mark is named in a dev message. `id` is an OPTIONAL author field, so most
 * specs leave it unset and every guard that interpolated it read `mark "undefined"`.
 * Prefer the author's id, fall back to the factory name the mark stamps on itself
 * (`type` — see the mark contract in plot/mark.js), and only then to the
 * anonymous form.
 * @param {any} feature
 * @returns {string}
 */
export function markLabel(feature) {
    if (!feature) return '(unknown mark)';
    // An author-chosen id is the most specific thing we can say. An engine-assigned
    // one (`autoId`) is just a position, so prefer the factory name when the mark
    // stamped one, and fall back to the placeholder only when it didn't.
    if (feature.id && !feature.autoId) return `"${feature.id}"`;
    if (feature.type) return `${feature.type}()`;
    return feature.id ? `"${feature.id}"` : '(an unnamed mark)';
}

// Scope goes in the name: `edit.line.draw()` expects a line mark, `edit.arc.edge()`
// an arc, and so on. Each scope names the mark capability that makes it work; a
// mismatch is a silent no-op at runtime (the edit's `when` gate never fires), so
// warn once per feature+edit. One table, not one function per family — a new
// mark family adds a row here, not a new guard.
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
    // The one capability that is not a boolean flag: "draws a scale" is what
    // `views` says, and axis / grid / legend all say it. A domain edit belongs on
    // any of them — the domain is a property of the scale the element draws, not of
    // the particular chrome it draws it as — so the entry carries a predicate.
    scale: { test: (/** @type {any} */ f) => f.views === 'scale', expects: 'an axis or legend element' },
};

// What a scale `kind` satisfies. A mark declares the CAPABILITY it needs, never a
// scale type — the same rule the rest of the engine follows (see core/scales.js).
/** @type {Record<string, (kind: string) => boolean>} */
export const KIND_SATISFIES = {
    discrete: (k) => k === 'band' || k === 'point',
    band: (k) => k === 'band',
    point: (k) => k === 'point',
    continuous: (k) => k === 'continuous',
};

/**
 * A mark that needs something specific from a scale says so (`Mark.requires`), and
 * this reports the mismatch instead of letting the mark degrade in silence.
 *
 * Silent degradation is the worst failure mode this library has, because the chart
 * still draws: a waffle with no band scale falls back to 20px-wide blocks over a
 * [0,1] domain and looks like a deliberate design; a trend with a missing scale
 * returns no nodes at all and looks like a spec that "just didn't render". Neither
 * said anything. The declaration lives on the MARK (it knows what its geometry
 * needs) and the check lives here (it knows what the scales resolved to).
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

// A plane gesture carries no node, so it fans to EVERY feature's plane-pick edits.
// Two marks over the SAME table each declaring `create()` therefore append twice per
// click. Direct-pick edits are immune (routed to the touched node's feature alone).
// So: a whole-dataset edit belongs on exactly one mark PER TABLE. Warn rather than
// branch — the engine stays ignorant of specific edit types.
//
// Scoped by the TABLE each edit writes, because two marks over different tables are
// not duplicates at all: a node mark's `create` and a creator on a link mark append
// to different arrays. Reporting them would make every network chart open with a
// warning that says to delete one of two edits that do unrelated things.
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
            const t = tableOfEdit(f, e);
            const list = byTable[t] || (byTable[t] = []);
            if (!list.includes(f)) list.push(f);
        }
    }
    for (const [table, owners] of Object.entries(byTable)) {
        if (owners.length < 2) continue;
        // Keyed by the offending mark set, not a module-level boolean: a docs page
        // renders many charts, and a single global one-shot meant the second broken
        // chart on a page never reported at all.
        warn(
            `planedup:${table}:${owners.map(markLabel).join(',')}`,
            `${owners.length} marks carry a plane-pick edit over the same rows ` +
            `(marks ${owners.map(markLabel).join(', ')}). A plane gesture fans to all ` +
            `of them, so a whole-dataset edit (create/remove/rotate/toggle) will apply once per ` +
            `mark. Declare it on exactly one.`
        );
    }
}

// A legend picker writes a ROW, but a swatch names a VALUE — so the row comes from
// the legend's `row`, which defaults to the chart's SELECTION. On a table with more
// than one row and nothing selected, the picker has no target and a click writes
// nothing. That is usually a legitimate WAITING state ("click a bar, then a
// swatch"), which is why the legend just renders dimmed rather than complaining.
//
// It is a BUG only when nothing can ever arm it: no `row` pinned, several rows, and
// no mark over that table carrying a selection edit. Then the picker is decoration.
// Whether some OTHER feature can select is not a question a legend can answer from
// inside its own build(), which is why the guard lives here.
/**
 * @param {any[]} features
 * @param {(f: any) => import('../types').Edit[]} editsOf
 * @param {(f: any) => any[]} rowsOf
 */
export function warnUnreachableLegendRow(features, editsOf, rowsOf) {
    // Only an edit that writes a ROW needs one. A DOMAIN edit
    // (edit.scale.categories) reshapes the scale the legend draws and a SELECTION
    // edit writes pipeline state, so both are armed by the scale alone — counting
    // them as pickers reported every rename-only legend as broken.
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

// `connect` resolves its TARGET by finding the node nearest the pointer when the
// drag ends. Any other unarbitrated drag edit on the same mark defeats that
// completely: `move` drags the SOURCE node along under the pointer, so the nearest
// node at release is the one the drag started from, and connect reads that as
// "released on itself" and does nothing. Both gestures look reasonable in the spec
// and neither reports anything — the whole feature is just silently dead, which is
// the failure mode this codebase warns about rather than tolerates.
//
// The fix is arbitration, not removal: `move({ when: when.noShift })` beside
// `connect({ when: when.shift })`, which is also how every diagram editor
// distinguishes the two.
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

// An edit that WRITES ROWS declares it: `cardinality` says how the dataset's
// shape changes ('append' one row, 'appendMany', 'toggle' one on/off, 'delete').
// Read as a capability by the create guards — never a list of type names, which
// is what this was, and which missed `network.connect` and every custom creator.
const CREATES = new Set(['append', 'appendMany', 'toggle']);
/** @param {import('../types').Edit} e @returns {boolean} */
export function isDatasetCreator(e) {
    return e.target !== 'domain' && CREATES.has(/** @type {string} */ (e.cardinality));
}

/**
 * Creation writes dataset ROWS, so it only makes sense on a DATA MARK positioned by an
 * invertible axis (the mark-agnostic model: mint a datum from the scales, every mark
 * that views the rows encodes it). Warn (dev only) when a datum-minting edit lands
 * where that can't happen:
 *   - a GUIDE (axis/grid): it edits the DOMAIN (edit.axis.*), it has no rows to mint;
 *   - a mark with no invertible positional channel: the pointer can't be inverted to a
 *     datum, so mintDatum returns undefined and the create is a silent no-op.
 * (rule/trend are NOT flagged: they carry invertible x/y and CAN place a datum — that
 * they read as a guide/derived line is a usage convention the docs matrix covers.)
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
 * An EXTENT mark (a rect drawn from x1/x2 or y1/y2 SPANS) needs its extent seeded, or a
 * create mints it with zero size — an invisible row. Warn when a datum-minting edit is
 * present and neither the field schema nor the creator's own `defaults` supplies the
 * span endpoints. (A band-sized rect or a point mark has automatic extent, so it is
 * skipped: no span endpoint channels.)
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @param {Record<string, any> | undefined} schema
 */
export function warnCreateEmptyExtent(feature, edits, schema) {
    const ch = feature.channels || {};
    /** @type {string[]} */
    const spanFields = [];
    // A span channel can exist without a `field` (an x1 given as a {value}); that
    // endpoint has no field to seed, so drop it rather than printing "doesn't seed
    // undefined".
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
 * An edit's `pick` names its target strategy: `direct` (the node hit), `plane`
 * (no node — the registry's plane driver), or a lifecycle driver. A pick that
 * names NO registered driver is a silently dead edit: nothing claims it, the
 * plane is never raised, and no gesture ever reaches `apply`. Report it once per
 * feature+pick — a typo (`pick: 'nearset'`) or a custom driver that was never
 * `registerDriver`ed both land here.
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
            `registered driver, so no gesture will ever reach it. Built-in picks are ` +
            `direct, plane, nearest, probe, sweep, draw, brush, brushRect, geoBrush, ` +
            `axisDrag, slide; a custom one needs registerDriver().`
        );
    }
}

/**
 * An option an edit factory was handed that nothing reads. Marks, elements and
 * guides have warned on these for a while; edits could not, because a driver's
 * knobs legitimately ride the descriptor (`brushRect({ resize: 'x' })`) and only
 * the registry knows which driver an edit reaches. So `makeEdit` stamps what its
 * factory's vocabulary could not account for, and this subtracts the driver's
 * declared `options` before reporting. `slide({ exent: 200 })` used to be silently
 * inert — the quietest class of authoring bug, at the layer that writes the data.
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
 * THE dead-drag guard. An edit maps a gesture back through a channel's scale, so
 * it can only write a value if that scale INVERTS. Attach `move()` to a colour or
 * symbol channel — or to any scale d3 gives no `invert()` (ordinal, sequential,
 * diverging) — and `invertChannel` returns undefined, `apply` returns an unchanged
 * clone, that clone passes every constraint, and a no-op commits. The cursor turns
 * editable, the drag feels alive, and NOTHING happens or is logged. It is the
 * quietest failure in the library and the likeliest first-run frustration.
 *
 * `warnCreateOnNonMark` above covers this for datum-MINTING edits only, and it
 * passes if ANY of x/y inverts. This covers the everyday surface (move, resize,
 * slide, rotate, cycle) and reports per dead channel, so a `move` across x and y
 * with a dead y is not silenced by a live x.
 * @param {any} feature
 * @param {import('../types').Edit[]} edits
 * @param {import('../types').ScaleMap} scales
 */
export function warnDeadEditChannels(feature, edits, scales) {
    const markChannels = feature.channels || {};
    for (const e of edits) {
        // Declared on the edit (makeEdit): only an edit that runs the pointer back
        // through a scale can die on a non-invertible one.
        if (!e.inverts) continue;
        // A creator mints a whole row rather than inverting one channel, and has
        // its own guard (warnCreateOnNonMark).
        if (isDatasetCreator(e)) continue;
        if (feature.supportsGeo) continue; // placed by the projection, not a channel scale
        const names = e.channels || [];
        if (!names.length) continue;
        const dead = names.filter((n) => {
            const spec = markChannels[n];
            // No field means no column to write; warnMisplacedEdits reports that case.
            if (!spec || spec.field == null) return false;
            const s = /** @type {any} */ (scales)[n];
            return s && !s.invertible;
        });
        if (!dead.length) continue;
        warn(
            `${markLabel(feature)}:dead:${e.type}:${dead.join(',')}`,
            `${e.type}() on ${markLabel(feature)} edits channel${dead.length > 1 ? 's' : ''} ` +
            `${dead.map((n) => `"${n}"`).join(', ')}, whose scale cannot be inverted ` +
            `(${dead.map((n) => /** @type {any} */ (scales)[n].type || 'ordinal').join(', ')}). ` +
            `An edit runs a gesture BACKWARD through the scale, so a non-invertible channel ` +
            `silently does nothing. Edit a positional channel (x/y), or give the channel a ` +
            `continuous, band or point scale.`
        );
    }
}

/**
 * Every key `Elicit` reads. A spec key is either here or it does nothing, so this
 * doubles as the closed key set the JSON grammar is generated from.
 * @type {string[]}
 */
export const SPEC_KEYS = [
    // Frame
    'width', 'height', 'margins', 'responsive', 'overflow', 'focusOutline',
    // The three kinds of feature: marks view DATA, elements view a SCALE, guides
    // view STATE. Plus the implicit layers that desugar into elements.
    'marks', 'elements', 'guides', 'axes', 'legends',
    // The elicited dataset and its contract
    'schema', 'data', 'constraints', 'lock',
    // Scales (per channel). No `domain` here — a domain describes the DATA.
    'scales', 'projection',
    // Presentation
    'theme', 'effects',
    // Multi-stage elicitation
    'stage', 'stageLabels',
    // View options — runtime, not part of a serializable spec
    'onChange', 'renderer',
];

/**
 * Spec keys that are WRONG in a specific, diagnosable way. Same idea as
 * `MISTAKEN_OPTIONS` for marks (plot/mark.js), one layer up.
 *
 * This guard exists because the spec was the ONE layer with no validation at all.
 * A mark warns about `color:`; a chart element warns about `tickss:`; but
 * `Elicit({ mark: [...] })` drew an empty chart in silence — at the layer every
 * single user starts from, and where a typo costs the most.
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
    title: 'there is no chart-level `title`. Draw one with a `text` mark, or a widget\'s `question`.',
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
