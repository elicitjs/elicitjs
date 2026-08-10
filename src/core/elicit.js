// @ts-check
import { SceneGraph } from './scene.js';
import { resolveScales } from './resolve.js';
import { createProjection } from './projection.js';
import { resolveLock, lockConstraint, isNodeLocked } from './lock.js';
import { collectEdits, resolveChannels, warnMisplacedEdits } from '../edit/route.js';
import { markCenter, nudgeTarget } from '../edit/shared.js';
import { encodeChannel } from '../plot/mark.js';
import { drivers, driverFor, needsPlaneOnTop } from '../edit/drivers/index.js';
import { autoEditGuides } from '../edit/guide.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { resolveEffects, stateEffectNodes, effectStyleFor, elementEffectOf } from './effects.js';
import { resolveTheme } from './theme.js';
import { autoAxes } from './axes.js';
import { reserveLegends, autoLegends } from './legends.js';
import {
    validateTables, inferMeasureOfDomain,
    normalizeSchema, denormalizeSchema, normalizeData, isBareForm, enforceRefs,
} from './schema.js';
import { axisOf, pointerForChannel } from './encoding.js';
import { warn } from './dev.js';

// The capability guards below report through `warn(key, msg)` from core/dev.js —
// on by default, deduped once per key, silenced with `setWarnings(false)`. They
// used to be gated on a Vite-only `import.meta.env.DEV` constant, which made every
// one of them dead on webpack/Next and stripped them from the built bundle; see
// the header of core/dev.js. Never re-gate a guard on a bundler-specific global.
/**
 * How a mark is named in a dev message. `id` is an OPTIONAL author field, so most
 * specs leave it unset and every guard that interpolated it read `mark "undefined"`.
 * Prefer the author's id, fall back to the factory name `defineMark` stamps
 * (`markName`), and only then to the anonymous form.
 * @param {any} feature
 * @returns {string}
 */
function markLabel(feature) {
    if (!feature) return '(unknown mark)';
    // An author-chosen id is the most specific thing we can say. An engine-assigned
    // one (`autoId`) is just a position, so prefer the factory name when the mark
    // stamped one, and fall back to the placeholder only when it didn't.
    if (feature.id && !feature.autoId) return `"${feature.id}"`;
    if (feature.markName) return `${feature.markName}()`;
    return feature.id ? `"${feature.id}"` : '(an unnamed mark)';
}

// Scope goes in the name: `edit.line.draw()` expects a line mark, `edit.arc.edge()`
// an arc, and so on. Each scope names the mark capability that makes it work; a
// mismatch is a silent no-op at runtime (the edit's `when` gate never fires), so
// warn once per feature+edit. One table, not one function per family — a new
// mark family adds a row here, not a new guard.
/** @type {Record<string, { flag: string, expects: string }>} */
const SCOPE_CAPABILITY = {
    line: { flag: 'supportsSeries', expects: 'a line mark (line/area)' },
    geo: { flag: 'supportsGeo', expects: 'a geo* mark (geoPoint, geoLine, …)' },
    arc: { flag: 'supportsArc', expects: 'an arc mark (arc/pie/donut)' },
    stack: { flag: 'supportsStack', expects: 'a stacked mark (bar with `stack`, or arc/pie/donut)' },
    waffle: { flag: 'supportsWaffle', expects: 'a waffle mark' },
    axis: { flag: 'isAxis', expects: 'an axis mark (axisX/axisY/axisRadial)' },
    trend: { flag: 'supportsTrend', expects: 'a trend mark (trend/trendBand)' },
    network: { flag: 'supportsNetwork', expects: 'a link mark' },
};

// What a scale `kind` satisfies. A mark declares the CAPABILITY it needs, never a
// scale type — the same rule the rest of the engine follows (see core/scales.js).
/** @type {Record<string, (kind: string) => boolean>} */
const KIND_SATISFIES = {
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
function warnScaleRequirements(feature, scales) {
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
        const satisfied = req.mode === 'any' ? channels.some(ok) : channels.every(ok);
        if (satisfied) continue;
        const which = req.mode === 'any'
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
function warnScopeMismatch(feature, edits) {
    for (const e of edits) {
        if (!e.scope) continue;
        const cap = SCOPE_CAPABILITY[e.scope];
        if (!cap || feature[cap.flag]) continue;
        warn(
            `${markLabel(feature)}:${e.scope}.${e.type}`,
            `edit.${e.scope}.${e.type}() is attached to a mark without ${e.scope} support ` +
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
function warnProjectionCartesianMix(features, scales) {
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
function warnDuplicatePlaneEdits(features, editsOf, tableOfEdit) {
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
function warnConnectConflict(feature, edits) {
    const connects = edits.filter(e => e.type === 'connect' && !e.when);
    if (!connects.length) return;
    const rivals = edits.filter(e =>
        e.type !== 'connect' && e.pick === 'direct' && e.gesture === 'drag' && !e.when);
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

// Edit types that WRITE ROWS to the dataset (mint a datum), as opposed to editing a
// field on an existing row or the domain. Used by the create guards to tell a
// datum-minting edit from an ordinary channel edit without branching on type in
// dispatch (this is a dev warning, not control flow).
const CREATOR_TYPES = new Set(['create', 'toggle', 'anchor', 'newSeries', 'draw', 'createRect']);
/** @param {import('../types').Edit} e @returns {boolean} */
function isDatasetCreator(e) {
    return e.target !== 'domain' && (CREATOR_TYPES.has(e.type) || e.cardinality === 'append');
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
function warnCreateOnNonMark(feature, edits, scales) {
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
function warnCreateEmptyExtent(feature, edits, schema) {
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
 * How a constraint names itself in a dev message. `defineConstraint` stamps
 * `constraintType`; a hand-written one is just a function, so fall back to its
 * name and then to an anonymous form.
 * @param {any} constraint
 * @returns {string}
 */
function constraintLabel(constraint) {
    if (!constraint) return '(unknown)';
    if (constraint.constraintType) return `${constraint.constraintType}()`;
    if (constraint.name) return `${constraint.name}()`;
    return '(an anonymous constraint)';
}

/**
 * Short, safe description of an unexpected value for a message — never stringifies
 * something large or cyclic.
 * @param {any} v
 * @returns {string}
 */
function describe(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'an array';
    const t = typeof v;
    if (t === 'object') return 'an object';
    if (t === 'string') return `the string ${JSON.stringify(v.slice(0, 20))}`;
    return `the ${t} ${String(v)}`;
}

// Edit types that map a POINTER POSITION back through a channel's scale, and so
// genuinely require that scale to invert. Deliberately an ALLOWLIST: most edits
// reach a value some other way and are perfectly happy on a non-invertible scale.
// `cycle` steps scale.domain() (that is how a click cycles an ordinal fill —
// elicitjs-docs marks/symbol does exactly this), `toggle` flips a flag, `set` takes an
// external value, `custom` is arbitrary. A denylist would have flagged all of them.
const INVERTING_TYPES = new Set([
    'move', 'moveSpan', 'resize', 'slide', 'rotate', 'brushSpan', 'brushRect', 'draw', 'sweep',
]);

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
function warnDeadEditChannels(feature, edits, scales) {
    const markChannels = feature.channels || {};
    for (const e of edits) {
        if (!INVERTING_TYPES.has(e.type)) continue;
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
 * Dim a ghost-preview node in place. Multiplies its existing opacity by the theme's
 * ghost opacity (so an already-faint mark stays proportionally faint) and, when the
 * theme names them, overrides fill/stroke/dash so the preview reads as tentative.
 * @param {any} node @param {any} ghost the theme.ghost tokens
 */
function applyGhostStyle(node, ghost) {
    const g = ghost || {};
    const base = node.opacity != null ? node.opacity : 1;
    node.opacity = base * (g.opacity != null ? g.opacity : 0.45);
    if (g.fill != null) node.fill = g.fill;
    if (g.stroke != null) node.stroke = g.stroke;
    if (g.strokeDasharray != null) node.strokeDasharray = g.strokeDasharray;
}

/**
 * @param {import('../types').ElicitSpec} spec
 * @returns {import('../types').ElicitElement}
 */
export function Elicit(spec) {
    const {
        width = 600,
        height = 400,
        margins = { top: 20, right: 20, bottom: 30, left: 40 },
        // `schema` and `scales` are read straight off the spec by resolveScales:
        // the schema owns each field's data type and DOMAIN, and `scales` is the
        // chart-level per-channel scale override.
        marks: userMarks = [],
        // Chart elements (axis / grid / legend / axisRadial) — the same factories
        // as `elicit.elements.*`. Concatenated into the feature list with `marks`
        // so authors can separate scale chrome from data marks without a second
        // engine path. Elements in `marks` still work (and stay on `plot.*`).
        elements: userElements = [],
        // Global axis convenience: desugars into composable axis/grid marks (see
        // autoAxes). Explicit axis marks in `marks`/`elements` take precedence per channel.
        axes,
        // The legend counterpart to `axes`: `true` for one legend per bound
        // non-positional scale, or a per-channel config ({ fill: {...}, size: false }).
        // Defaults to none — unlike axes, because a legend RESERVES layout space and
        // silently shrinking the plot because a `fill` channel exists would surprise.
        legends,
        guides = [],
        // Interaction-effects layer (grab / proximity-select), customizable and
        // kept separate from mark style channels. See core/effects.js.
        effects: effectsSpec,
        // Sizing mode. 'fixed' (default) renders at the given pixel width/height.
        // 'scale' renders once at those dims but wraps the SVG in a viewBox so the
        // browser scales it to fill the parent (aspect ratio preserved, one draw).
        // 'reflow' measures the parent and re-renders at native pixels on resize
        // (crisp text, width tracks the container, height stays the given value).
        // `responsive: true` is an alias for 'reflow'.
        responsive,
        // SVG overflow. Default 'hidden' clips marks to the viewport. 'visible' lets
        // content in the margin band show — needed for radial/gauge axis labels that
        // sit just outside the plot area.
        overflow = 'hidden',
        // Browser focus ring on editable marks. Off by default — Tab / arrow keys
        // still work; only the native outline is suppressed. See types.ElicitSpec.
        focusOutline = false,
        renderer = new D3Renderer()
    } = spec;

    const mode = responsive === true ? 'reflow'
        : (responsive === 'scale' || responsive === 'reflow') ? responsive
            : 'fixed';

    // Resolve the chart's theme once (DEFAULT_THEME < setTheme() base < spec.theme).
    // Stamped on the scale map every render (the projection-transport pattern) so
    // build() and edit/guide ctx read it without a widened signature. The theme also
    // supplies the DEFAULTS the effects layer merges under, so a themed chart's
    // grab/select feedback follows the theme unless the chart's own `effects` wins.
    const theme = resolveTheme(spec.theme);
    const effects = resolveEffects(effectsSpec, theme.effects);

    // Prepend auto-injected axis/grid marks (drawn behind marks via the background
    // layer). Explicit axis/element the user composed into `marks` or `elements`
    // are preserved. A projection chart has no cartesian axes — skip autoAxes
    // unless the caller forced them (axes !== undefined still respected via
    // autoAxes(false)). Flattened because a composite mark desugars to
    // an ARRAY of features.
    const userFeatures = [...userElements, ...userMarks];
    const axesOpt = spec.projection != null && axes === undefined ? false : axes;
    // …and append auto-injected LEGEND marks, the same IMPLICIT layer for the
    // non-positional scales (core/legends.js). `axes` had this convenience and
    // `legends` did not, so an axis was one spec key and a legend was a mark you had
    // to compose by hand. Appended (not prepended) because a legend draws its own
    // reserved band beside the plot rather than behind the marks.
    const features = [
        ...autoAxes(userFeatures, axesOpt),
        ...userFeatures,
        ...autoLegends(userFeatures, legends),
    ].flat(Infinity);
    // Whether any feature is a space-reserving legend (core/legends.js). Static —
    // the feature set doesn't change — so the reservation step is skipped entirely
    // for the common no-legend chart.
    const hasLegends = features.some((f) => f && f.isLegend);

    // Working dims. In 'reflow' mode `curW` tracks the container's measured width
    // (height stays the given value); 'fixed'/'scale' keep the design dims. Marks
    // and scales read the inner (margin-subtracted) dims, so recomputing them on a
    // resize is all it takes for the whole scene to reflow.
    const designW = typeof width === 'number' ? width : 600;
    const designH = typeof height === 'number' ? height : 400;
    let curW = designW;
    let curH = designH;
    // Author margins are the outer padding / axis room. Legends RESERVE extra space
    // on their side (see core/legends.js), so the engine works with EFFECTIVE
    // margins = author margins + each side's legend band. Recomputed every render;
    // equals the author margins when there are no legends.
    const authorMargins = margins;
    let effectiveMargins = { ...authorMargins };
    let innerWidth = curW - effectiveMargins.left - effectiveMargins.right;
    let innerHeight = curH - effectiveMargins.top - effectiveMargins.bottom;

    features.forEach((feature, index) => {
        // `autoId` marks the id as ENGINE-assigned, so a diagnostic can tell an id the
        // author chose (worth quoting back) from a positional placeholder (worth
        // naming the factory instead). Without it every guard reported
        // `mark "feature-3"`, since `id` is optional and most specs omit it.
        if (!feature.id) { feature.id = `feature-${index}`; feature.autoId = true; }
    });

    // The engine OWNS the schema — an editable axis (edit.axis.*) reshapes a field's
    // DOMAIN, which lives on the schema. Clone it so a domain edit never mutates the
    // caller's spec object; resolveScales reads this copy every render, so a domain
    // write reflows axis, grid, guides and marks for free.
    //
    // `normalizeSchema` (core/schema.js, the schema's owner) applies the author-side
    // sugars once, here, and returns the canonical SchemaSpec — the structure, its
    // named tables, and the role -> name binding. Nothing downstream re-sniffs how
    // the author spelled it. `el.getSchema()` denormalizes on the way back out, so a
    // single-table chart still sees the bare field map it always has.
    /** @type {import('../types').SchemaSpec} */
    const schemaSpec = normalizeSchema(structuredClone(spec.schema || {}));
    // The PRIMARY table's field map, by identity — so the in-place domain writes
    // below (and undo's restore) keep the canonical spec consistent for free.
    /** @type {Record<string, import('../types').FieldSchema>} */
    const schema = schemaSpec.tables[schemaSpec.primary].fields;

    // 1. The belief store: ONE dataset for the chart, whose STRUCTURE the schema
    //    declares. Every mark is a view over one of its tables, encoding some
    //    columns and (where it carries an edit) writing them back. structuredClone
    //    rather than a JSON round-trip so seed `Date` values survive for a
    //    time-scale edit; `normalizeData` splits them per table (a bare array is the
    //    primary table, which is every single-table chart).
    /** @type {Record<string, any[]>} */
    let tables = normalizeData(structuredClone(spec.data ?? null), schemaSpec);

    // Every mark draws exactly ONE table, so the engine hands `tableOf(feature)`
    // wherever it used to hand the single dataset — which is why no mark's build(),
    // no edit's apply() and no constraint body had to change for structures.
    /** @param {any} feature @returns {any[]} */
    const tableOf = (feature) => tables[feature.table] || [];
    // WHICH TABLE an edit writes. THE one place this is decided — computeEdit reads
    // it to build the proposal and runEdit reads it to commit, so the two can never
    // disagree and splice a link proposal over the node rows. An edit names its
    // target by ROLE (`table: 'links'`) so a renamed schema still resolves; with none
    // it writes the table its own mark draws, which is every pre-structure edit.
    /** @param {any} feature @param {import('../types').Edit} edit @returns {string} */
    const targetTableOf = (feature, edit) =>
        (edit && edit.table && schemaSpec.byRole[edit.table]) || feature.table;
    // The PRIMARY table: what a bare-array `data` seeds, what a mark with no `table`
    // draws, and what the index-addressed selection API means.
    const primaryRows = () => tables[schemaSpec.primary];
    // The dataset in the caller's own spelling, for getData/onChange: a bare array
    // when that is how it came in (every single-table chart), else keyed by table.
    const shapeData = () => (isBareForm(schemaSpec) ? primaryRows() : tables);

    // Which TABLE each feature is a view over, resolved once. A mark states a table
    // by NAME (`table: 'links'`); with none, it takes the table filling its ROLE —
    // `link` asks for `links`, every other mark for the structure's primary. Going
    // through the role is what makes renaming free: a schema that calls its tables
    // `claims`/`supports` needs no `table:` written anywhere.
    features.forEach((feature) => {
        const named = feature.table;
        if (named != null && !schemaSpec.tables[named]) {
            warn(
                `${markLabel(feature)}:table:${named}`,
                `mark ${markLabel(feature)} draws table "${named}", which the schema does not ` +
                `declare. Declared tables: ${Object.keys(schemaSpec.tables).map((n) => `"${n}"`).join(', ')}. ` +
                `Falling back to "${schemaSpec.primary}".`
            );
        }
        feature.table = (named != null && schemaSpec.tables[named])
            ? named
            : (schemaSpec.byRole[feature.tableRole] || schemaSpec.primary);
    });

    // Read-only rows (see core/lock.js). `lock: 'seed'` fixes the rows the chart was
    // seeded with — they are given, not elicited — while leaving every later row
    // free; a predicate locks rows by what they ARE. Two halves: a dataset invariant
    // (run last in computeEdit, so a lock has the final word) and a `locked` stamp on
    // those rows' scene nodes, which makes them pointer-transparent and invisible to
    // proximity picking.
    //
    // Seeding is PER TABLE — "the rows this table started with" — so the predicate
    // and its constraint are resolved per table and memoized. The counts are read
    // live because setData re-seeds.
    /** @type {Record<string, number>} */
    let seedCounts = {};
    for (const name of Object.keys(tables)) seedCounts[name] = tables[name].length;
    /** @type {Record<string, ((d: any, i: number) => boolean) | null>} */
    const lockPredicates = {};
    /** @type {Record<string, import('../types').Constraint | null>} */
    const lockConstraints = {};
    /** @param {string} name @returns {((d: any, i: number) => boolean) | null} */
    const isLockedIn = (name) => {
        if (!(name in lockPredicates)) {
            lockPredicates[name] = resolveLock(spec.lock, () => seedCounts[name] || 0, name);
        }
        return lockPredicates[name];
    };
    /** @param {string} name @returns {import('../types').Constraint | null} */
    const lockRowsIn = (name) => {
        if (!(name in lockConstraints)) {
            const pred = isLockedIn(name);
            lockConstraints[name] = pred ? lockConstraint(pred) : null;
        }
        return lockConstraints[name];
    };

    // Check the SEED rows against that contract once, here (see core/schema.js for
    // the checks and why each is a defect). Seed rows are the only place a mismatch
    // can originate: an edit mints from schemaDefaults and writes through a channel's
    // own field, so it cannot introduce an undeclared column.
    validateTables(schemaSpec, tables);
    // The resolver sees the RESOLVED theme (not the raw spec.theme partial), so its
    // colour-scale range fallback can read theme.palette/ramp/diverging.
    const liveSpec = { ...spec, schema, schemaSpec, theme };

    // The dataset's invariants, gathered once. A mark may declare `constraints` as
    // sugar; they are promoted here, so an invariant holds for EVERY edit over the
    // rows, whichever mark fired it — that is what makes a constraint declared on
    // one part of a glyph gate a drag on another. Deduped by identity so the same
    // constraint object listed on several marks runs once.
    //
    // Promotion is scoped to a TABLE, because a constraint is an invariant over ROWS
    // and two tables' rows are different things — a rule written about nodes must not
    // run on a link edit and see columns it has never heard of. A mark's constraint
    // takes that mark's table; one declared on `spec.constraints` takes the primary
    // table unless it names another (`constraint.table`, a role or a name). On a
    // single-table chart every constraint lands in the one bucket, exactly as before.
    /** @type {Record<string, import('../types').Constraint[]>} */
    const constraintsByTable = {};
    /** @param {import('../types').Constraint} c @param {string} table */
    const promoteConstraint = (c, table) => {
        const list = constraintsByTable[table] || (constraintsByTable[table] = []);
        if (!list.includes(c)) list.push(c);
    };
    for (const c of spec.constraints || []) {
        const named = /** @type {any} */ (c).table;
        promoteConstraint(c, (named && (schemaSpec.byRole[named] || (schemaSpec.tables[named] && named)))
            || schemaSpec.primary);
    }
    for (const f of features) {
        for (const c of f.constraints || []) promoteConstraint(c, f.table);
    }
    /** @param {string} table @returns {import('../types').Constraint[]} */
    const constraintsIn = (table) => constraintsByTable[table] || [];
    // The primary table's invariants, for the guide layer (a guide draws a rule about
    // a mark, and resolves the mark's own table through guideCtx.tableOf).
    const datasetConstraints = constraintsIn(schemaSpec.primary);

    // Auto-guides: an edit declared `guide: true` self-draws its guide (constraint
    // bounds + nearest snap ring) without the caller repeating the feature id in a
    // top-level guides list (see edit/guide.js).
    const allGuides = [...autoEditGuides(features), ...guides];

    // Multi-stage elicitation: edits carrying a numeric `stage` are active only in
    // that stage (null = always). This is a uniform descriptor filter applied to
    // EVERY edit — the same shape as `gesture` matching — not a per-mode engine
    // branch, so the one-interaction-model invariant holds. `activeEdits` is the
    // single gate the dispatch/editable/plane-on-top paths run their edits through.
    let currentStage = spec.stage != null ? spec.stage : 0;
    /** @type {(string | null)[]} */
    const stageLabels = Array.isArray(spec.stageLabels) ? spec.stageLabels : [];
    /** @param {number} n @returns {string | null} */
    const stageLabelOf = (n) => (stageLabels[n] != null ? stageLabels[n] : null);
    /**
     * @param {any} feature
     * @returns {import('../types').Edit[]}
     */
    const activeEdits = (feature) =>
        collectEdits(feature).filter(e => e.stage == null || e.stage === currentStage);

    // Move the stage cursor WITHOUT re-rendering: drop every transient (an in-flight
    // driver lock, a hover preview) so a stage switch can't resume a half-finished
    // gesture, then notify. Callers render — `setStage` on the container does it
    // directly; a driver's `stage.next()` rides the dispatch's own re-render.
    /** @param {number} n */
    const applyStage = (n) => {
        currentStage = n;
        ui.session = {};
        ui.preview = null;
        ui.hover = null;
        ui.grab = null;
        ui.selection.clear(); // selection is per-stage transient, like the session
        for (const cb of listeners.stage) cb(currentStage, stageLabelOf(currentStage));
    };

    // Transient interaction (UI) state, separate from the belief `dataset`. The
    // interaction drivers keep a per-feature session here (proximity selection,
    // sweep/draw locks) — those locks belong to one mark's gesture, so they stay
    // keyed by feature id. `preview` holds THE UNCOMMITTED proposal a driver parked
    // (the probe driver's hover/drag), keyed by feature id: each entry is the
    // proposed dataset that feature would commit. The committed rows are still what
    // every mark draws; a proposal is rendered as an inert GHOST of only the rows it
    // would change, layered on top (see update()'s ghost pass). It never reaches the
    // belief store, `onChange`, or `getData`. Cleared on commit, hoverout, and stage
    // change. Per-feature (not one global slot) so two probe marks can't clobber
    // each other's ghost.
    // `selection` is transient PIPELINE state: which dataset rows are currently
    // selected, an interaction concept the engine owns — never a `selected` data
    // column. A Set (single-exclusive today, so at most one member; a Set so
    // multi-select is a later widening, not an API break). Written only through the
    // selection commit path (edit.select / el.select), reset on setData/stage
    // change, and stamped onto the scale map each render (scales.selection) so a
    // legend/mark can target "the selected row" without a widened build signature.
    // `hover` is the OTHER transient pointer state: which feature+row the pointer is
    // currently over, written by the renderer's hover/hoverout events on any editable
    // node. It feeds the same `hovered` effect a proximity driver's session does, so
    // "this is the mark you are about to touch" looks the same however it was
    // resolved. Cleared on hoverout, stage change and reseed, like `session`.
    // `grab` is its mid-gesture counterpart: which feature+row a drag is currently on,
    // bracketed by the same dragstart/dragend the undo transaction uses. It exists so
    // the `grabbed` effect is decided in the state pass with the other two, rather
    // than being painted by the renderer straight off d3.drag — that split is why
    // `grabbed` used to honour `filter` and silently ignore the rest of its vocabulary
    // (and never drew an outline at all).
    /** @type {{ session: Record<string, any>, preview: Record<string, { table: string, rows: any[] }> | null, selection: Set<string>, hover: { featureId: string, index: number } | null, grab: { featureId: string, index: number } | null }} */
    const ui = { session: {}, preview: null, selection: new Set(), hover: null, grab: null };

    // Selection is stored QUALIFIED BY TABLE. A bare row index is ambiguous the
    // moment a dataset has more than one table — node 3 and link 3 are different
    // rows — and the effects pass keys its highlight by index, so an unqualified set
    // would light up a link because a node with the same index was selected.
    //
    // The public surface stays index-based: every existing chart has one table, and
    // `el.select(3)` / `getSelection()` mean that table's row 3. The qualification is
    // internal, and only a multi-table chart ever sees it.
    /** @param {string} table @param {number} index @returns {string} */
    const selKey = (table, index) => `${table}\u0000${index}`;
    /** @param {string} key @returns {{ table: string, index: number }} */
    const selParse = (key) => {
        const at = key.indexOf('\u0000');
        return { table: key.slice(0, at), index: Number(key.slice(at + 1)) };
    };
    /** The selected row indices belonging to one table, as a Set. */
    /** @param {string} table @returns {Set<number>} */
    const selectionIn = (table) => {
        /** @type {Set<number>} */
        const out = new Set();
        for (const key of ui.selection) {
            const s = selParse(key);
            if (s.table === table) out.add(s.index);
        }
        return out;
    };

    // The primary selected datum index (the sole member under single-exclusive
    // selection), or null. Stale indices — a selected row later removed — read as
    // null rather than pointing at a shifted row. Reads the PRIMARY table, which is
    // what a single-table chart's "the selection" has always meant.
    const selectionPrimary = () => {
        for (const i of selectionIn(schemaSpec.primary)) {
            if (i >= 0 && i < primaryRows().length) return i;
        }
        return null;
    };

    // Caller-facing observers. `change` fires on every committed edit; `stage` fires
    // when setStage advances; `select` fires when the selection changes (no data
    // moved, so it is NOT a `change`). Attached to the returned container as
    // `.on('change' | 'stage' | 'select', cb)`.
    /** @type {{ change: Set<Function>, stage: Set<Function>, select: Set<Function> }} */
    const listeners = { change: new Set(), stage: new Set(), select: new Set() };

    // ---- Undo history --------------------------------------------------------
    // An elicitation is someone's belief being drafted, so "take that back" is a
    // primitive, not a nicety. A snapshot store rather than inverse operations:
    // an edit's apply() is already a pure data -> data function, so the state
    // before it IS the undo, and no edit has to describe how to reverse itself.
    //
    // The unit is a GESTURE, not a commit. A drag commits on every pointermove, so
    // per-commit history would make undo replay the drag backwards one pixel at a
    // time. Instead a transaction opens at dragstart and closes at dragend (both
    // renderers emit them for mark and plane drags alike), and the first commit
    // inside it records the pre-gesture state — once. A click or a typed commit is
    // its own transaction.
    //
    // Snapshots carry the schema and the chart size too, because edit.axis.* writes
    // the schema's domain and can grow the chart: undoing a category-add has to put
    // the domain, the rows AND the size back.
    const MAX_HISTORY = 100;
    /** @type {any[]} */
    let past = [];
    /** @type {any[]} */
    let future = [];
    /** @type {{ recorded: boolean } | null} */
    let txn = null;

    const snapshot = () => ({
        tables: structuredClone(tables),
        schema: structuredClone(schema),
        width: curW,
        height: curH,
    });

    /** @param {any} snap */
    const restoreSnapshot = (snap) => {
        tables = structuredClone(snap.tables);
        // Replace the schema's CONTENTS: `schema` is captured by closures (and read
        // by resolveScales each render), so rebinding the name would strand them.
        for (const k of Object.keys(schema)) delete schema[k];
        Object.assign(schema, structuredClone(snap.schema));
        if (snap.width !== curW || snap.height !== curH) {
            applyResize({ width: snap.width, height: snap.height });
        }
        ui.preview = null;
    };

    // Open a transaction if none is open. No snapshot here: a gesture that never
    // commits (a hover that only PREVIEWS, firing beginTxn on every pointermove) must
    // not clone the dataset. The snapshot is taken lazily by recordHistory, on the
    // first commit — which is safe because every commit path calls recordHistory
    // BEFORE it mutates `dataset`/`schema`, so "now" is still the pre-gesture state.
    const beginTxn = () => { if (!txn) txn = { recorded: false }; };
    const endTxn = () => { txn = null; };

    // Called by every commit path, BEFORE it mutates state. The first commit in a
    // transaction snapshots the (still pre-gesture) state and drops the redo stack —
    // a new edit after an undo forks the history, so the old future is gone.
    const recordHistory = () => {
        if (!txn) beginTxn();
        if (!txn || txn.recorded) return;
        past.push(snapshot());
        if (past.length > MAX_HISTORY) past.shift();
        future = [];
        txn.recorded = true;
    };

    // Notify a committed change. One place, so undo/redo tell the caller exactly
    // what an edit does.
    const notifyChange = () => {
        if (spec.onChange) spec.onChange(shapeData());
        for (const cb of listeners.change) cb(structuredClone(shapeData()));
    };

    // Notify a selection change. Selection is not the belief data, so it is a
    // SEPARATE channel from `change` — a `select` listener hears it, `onChange`/
    // `getData` never do.
    const notifySelect = () => {
        const primary = selectionPrimary();
        // A single-table chart reports bare row indices, as it always has. A
        // multi-table one reports {table, index}, because a bare number there names
        // no particular row.
        const all = isBareForm(schemaSpec)
            ? [...selectionIn(schemaSpec.primary)]
            : [...ui.selection].map(selParse);
        for (const cb of listeners.select) cb(primary, /** @type {any} */ (all));
    };

    // Commit a SELECTION edit's proposal. Like a domain edit it writes engine state
    // that ISN'T the dataset — here `ui.selection` — so it bypasses the datum
    // splice, the data-layer constraints, AND undo history: nothing about the belief
    // data changed, so there is nothing to take back and `onChange` stays silent.
    // The descriptor is `{ index, exclusive, toggle }` (see edit.select). Returns
    // whether the selection actually moved, so the dispatch reports it as a render
    // (via shouldRender) exactly as it does for a data edit — no self-render here, so
    // the gesture path renders once. The external el.select* wrappers, which call
    // this OUTSIDE a dispatch, render themselves.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const commitSelectionEdit = (sel, table = schemaSpec.primary) => {
        const before = [...ui.selection].join(',');
        applySelection(sel, table);
        const after = [...ui.selection].join(',');
        if (before === after) return false;
        notifySelect();
        return true;
    };

    // Mutate ui.selection from a selection descriptor. Single-exclusive semantics:
    // an `exclusive` write clears the set first; `toggle` deselects a row that is
    // already the sole selection (click-to-toggle-off); `clear` empties it.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const applySelection = (sel, table = schemaSpec.primary) => {
        if (sel.clear || sel.index == null) { ui.selection.clear(); return; }
        const key = selKey(table, sel.index);
        const has = ui.selection.has(key);
        const sole = has && ui.selection.size === 1;
        if (sel.exclusive !== false) ui.selection.clear();
        if (sel.toggle && sole) return; // toggled the sole selection off — leave empty
        ui.selection.add(key);
    };

    // The most recently built scene nodes per feature, so plane-pick edits can
    // hit-test against exact mark geometry and guides can look marks up by index.
    /** @type {Record<string, any[]>} */
    const featureNodes = {};

    // The scale map an edit on this node should resolve against. A part of a
    // composite in box mode is drawn inside a per-datum local FRAME, and each of its nodes
    // carries the frame scales it was encoded through — overlaying them is how a
    // gesture inverts back through the same mapping. Returns null when no frame is
    // in play, so the caller keeps the global map unchanged.
    /**
     * @param {any} feature
     * @param {any} node the node a direct-pick gesture landed on, if any
     * @param {number | null} [index] the datum, for a gesture that carries no node
     * @returns {import('../types').ScaleMap | null}
     */
    const frameScalesFor = (feature, node, index) => {
        let framed = node && node.frame ? node : null;
        if (!framed && index != null && feature) {
            framed = (featureNodes[feature.id] || []).find(
                (/** @type {any} */ n) => n && n.index === index && n.frame
            ) || null;
        }
        return framed ? { ...scales, ...framed.frame } : null;
    };

    // 2. Calculate scales (Observable Plot model): one GLOBAL scale per channel,
    //    resolved from the union of every feature's channels, with the schema
    //    supplying each field's data type and domain. Recomputed each render so an
    //    inferred domain (a field the schema left open) tracks data as create/drag
    //    mutate it. `scales` is a channel map { x, y, fill, size, … }; unused
    //    channels are absent.
    const dims = { width: innerWidth, height: innerHeight };
    let scales = resolveScales(features, tables, liveSpec, dims);

    // Set up container. 'fixed' pins pixel dims; the responsive modes fill the
    // parent's width (the SVG scales via viewBox in 'scale', or is redrawn at the
    // measured size in 'reflow').
    const container = document.createElement('div');
    container.style.position = 'relative';
    if (mode === 'scale') {
        container.style.width = '100%';
        container.style.height = 'auto';
    } else if (mode === 'reflow') {
        container.style.width = '100%';
        container.style.height = `${curH}px`;
    } else {
        container.style.width = `${curW}px`;
        container.style.height = `${curH}px`;
    }

    // Recompute the margin-subtracted dims from the current outer dims, and (reflow
    // only) re-measure the container's width from the parent. Returns whether the
    // width actually changed, so a resize can skip a redundant re-render.
    const recomputeInner = () => {
        innerWidth = curW - effectiveMargins.left - effectiveMargins.right;
        innerHeight = curH - effectiveMargins.top - effectiveMargins.bottom;
        dims.width = innerWidth;
        dims.height = innerHeight;
    };
    const measure = () => {
        if (mode !== 'reflow') return false;
        const w = container.clientWidth || designW;
        if (w > 0 && w !== curW) {
            curW = w;
            recomputeInner();
            return true;
        }
        return false;
    };

    const scene = new SceneGraph();

    // 3. Coordinator - rebuild the scene graph from current state and render.
    const update = () => {
        measure(); // reflow: pick up the container's current width before drawing
        scene.clear();

        // Legend reservation: a legend on a side shrinks the plot to make room. A
        // legend's band depends only on its scale's DOMAIN (label count / extent),
        // not on the pixel dims — so one provisional resolve gives the domains, we
        // reserve the bands, inflate the author margins, and recompute the inner
        // rect before the real resolve below. No feedback loop, so no iteration.
        if (hasLegends) {
            effectiveMargins = { ...authorMargins };
            recomputeInner();
            const provisional = resolveScales(features, tables, liveSpec, dims);
            /** @type {any} */ (provisional).theme = theme; // measure reads legend font tokens
            const bands = reserveLegends(features, provisional, authorMargins);
            effectiveMargins = {
                top: authorMargins.top + bands.top,
                right: authorMargins.right + bands.right,
                bottom: authorMargins.bottom + bands.bottom,
                left: authorMargins.left + bands.left,
            };
            recomputeInner();
        }

        // Re-resolve global scales so inferred domains follow the live data, and
        // an edited schema domain (edit.axis.*) reshapes every axis/grid/mark.
        scales = resolveScales(features, tables, liveSpec, dims);
        // Chart-level geographic projection (Plot model): shared apply/invert/path
        // for every geo mark and edit.geo.*. Attached on the scale map so build()
        // and edit ctx see the same object without a second argument.
        const projection = createProjection(liveSpec.projection, dims);
        // Attached on the scale map as a reserved non-Scale key (cast) so build()
        // and edit ctx share one object without widening ScaleMap's channel types.
        if (projection) /** @type {any} */ (scales).projection = projection;
        // The resolved theme rides on the scale map as another reserved non-Scale
        // key, so every mark's build() and the guide/edit ctx read default colours,
        // fonts and affordance tokens from one object (see core/theme.js: themeOf).
        /** @type {any} */ (scales).theme = theme;
        // The primary selected datum index rides on the scale map as one more
        // reserved non-Scale key, so a legend/mark reads "the selected row" from the
        // same object it already gets, without a widened build() signature.
        /** @type {any} */ (scales).selection = selectionPrimary();
        // The dataset schema rides along as one more reserved non-Scale key. A
        // composite's frame scales are built inside build() (one per datum), and the
        // DOMAIN of a frame channel is the field's — which only the schema knows.
        /** @type {any} */ (scales).schema = schema;
        warnProjectionCartesianMix(features, scales);

        // Plane-on-top mode: when an ACTIVE edit resolves its target from an
        // arbitrary pointer position (nearest/sweep/draw/brush), the plane must sit
        // above the marks and own the gesture. Computed per render because the
        // active edit set — and thus this flag — can change with the stage.
        const planeOnTop = features.some(feature => needsPlaneOnTop(activeEdits(feature)));
        // Plane-on-top drivers (brushRect, nearest, …) may stash a cursor hint in
        // their per-feature session so the interaction plane can show edge/body
        // affordances without a second interaction system.
        let planeCursor = 'pointer';
        if (planeOnTop && ui.session) {
            for (const fid of Object.keys(ui.session)) {
                const cur = ui.session[fid] && ui.session[fid].cursor;
                if (cur) { planeCursor = cur; break; }
            }
        }

        warnDuplicatePlaneEdits(features, activeEdits, targetTableOf);

        features.forEach(feature => {
            // The committed rows of the feature's OWN table are always what it draws.
            // A hover/drag preview no longer substitutes them (that made committed
            // marks jump/flicker — worst on a matrix); instead the proposal is drawn
            // as an inert ghost of only the rows it would change, by the pass below.
            const currentData = tableOf(feature);
            const isLocked = isLockedIn(feature.table);
            // A mark that joins ACROSS tables (link) needs more than its own rows: the
            // whole dataset, the canonical schema (to find another table by ROLE), and
            // which table it is itself drawing. Passed as a 5th argument, so every
            // existing mark's four-parameter build() is untouched.
            const nodes = feature.build(currentData, scales, innerWidth, innerHeight, {
                tables, schema: schemaSpec, table: feature.table,
            });
            featureNodes[feature.id] = nodes;

            const declaredEdits = collectEdits(feature);
            warnScaleRequirements(feature, scales);
            warnScopeMismatch(feature, declaredEdits);
            warnMisplacedEdits(feature, markLabel);
            warnCreateOnNonMark(feature, declaredEdits, scales);
            warnCreateEmptyExtent(feature, declaredEdits, liveSpec.schema);
            warnDeadEditChannels(feature, declaredEdits, scales);
            warnConnectConflict(feature, declaredEdits);

            // A feature with an ACTIVE direct-pick edit is interactive on its marks,
            // so the renderer should show an editable cursor on them. Plane-pick
            // edits (nearest/sweep/draw) put the cursor on the plane instead, so
            // they don't mark nodes editable.
            const editable = activeEdits(feature).some(e => e.pick === 'direct');

            // Tag every node with its feature so gesture events can find the
            // feature's edits, and flag interactive marks for the cursor.
            //
            // A mark with no direct-pick edit can't consume a gesture, so it must not
            // BLOCK one: the renderer defaults nodes to pointer-events:auto and paints
            // later features/parts on top, so an inert rule listed after a handle (or
            // any overlapping inert chrome) would swallow its drag. Silence it unless
            // the mark asked for a specific value.
            //
            // A node over a LOCKED row is inert for the same reason, one level down:
            // its row is read-only, so it is not grabbable, shows no editable cursor,
            // and pick.js skips it when resolving a proximity target.
            nodes.forEach((/** @type {any} */ node) => {
                node.featureId = feature.id;
                const locked = isLocked && isNodeLocked(node, feature, currentData, isLocked);
                if (locked) node.locked = true;
                if (editable && !locked) node.editable = true;
                else if (node.pointerEvents == null) node.pointerEvents = 'none';
                scene.add(node);
            });
        });

        // Ghost-preview pass. For each feature carrying an uncommitted proposal, build
        // it from the PROPOSED rows and add only the nodes that DIFFER from committed —
        // a changed/added row (by identity, since computeEdit's splice preserves the
        // untouched rows' object identity), or a feature's series chrome (index == null,
        // e.g. a line path) when any of its rows changed. Ghosts are inert: not written
        // to featureNodes (so picking/guides see committed geometry only), never
        // editable, pointer-transparent, and styled with theme.ghost so they read as
        // tentative. Building every feature from the proposal keeps "the ghost is
        // exactly what a commit would draw" across sibling marks and constraint repairs.
        if (ui.preview) {
            // A proposal is about the DATASET, not about the mark that produced it:
            // every feature is a view over the same rows, so a SIBLING has to ghost
            // it too. Splitting a glyph into two marks otherwise leaves half of it
            // frozen until the click — a trendBand whose spread is being probed on
            // the trend line shows no feedback at all while the pointer moves.
            //
            // The parking spot stays keyed by feature id (two probe marks must not
            // clobber each other's ghost); this only decides who DRAWS one. With
            // exactly one proposal in flight it is THE proposal and every feature
            // renders it. With two, each proposing feature keeps its own — there is
            // no single answer for a bystander, so it stays out of it.
            //
            // A proposal names the TABLE it is about, because an edit can propose
            // rows for a table other than the one its mark draws — `edit.network.connect`
            // fires on a node mark and proposes a LINK row. Only features over that
            // table ghost it, which is both what makes the rubber band appear on the
            // link mark and what stops a node mark from ghosting rows that aren't its.
            const inFlight = Object.values(ui.preview);
            const sole = inFlight.length === 1 ? inFlight[0] : null;
            for (const feature of features) {
                // A chart element draws a SCALE, not rows, so it has no ghost to show.
                if (feature.views === 'scale') continue;
                const proposal = ui.preview[feature.id] || sole;
                if (!proposal || proposal.table !== feature.table) continue;
                const proposed = proposal.rows;
                const committed = tableOf(feature);

                // Which rows the proposal changes, by reference identity.
                /** @type {Set<number>} */
                const changedIdx = new Set();
                let anyChanged = proposed.length !== committed.length;
                const n = Math.max(proposed.length, committed.length);
                for (let i = 0; i < n; i++) {
                    if (proposed[i] !== committed[i]) { changedIdx.add(i); anyChanged = true; }
                }
                if (!anyChanged) continue;

                const ghostNodes = feature.build(proposed, scales, innerWidth, innerHeight, {
                    // A ghosted LINK has to resolve its endpoints against the proposed
                    // rows too — otherwise a preview that moves a node draws the ghost
                    // link to where the node used to be.
                    tables: { ...tables, [proposal.table]: proposed },
                    schema: schemaSpec,
                    table: feature.table,
                });
                ghostNodes.forEach((/** @type {any} */ node) => {
                    const keep = node.index != null ? changedIdx.has(node.index) : anyChanged;
                    if (!keep) return;
                    node.ghost = true;
                    node.featureId = feature.id;
                    node.editable = false;
                    node.pointerEvents = 'none';
                    applyGhostStyle(node, theme.ghost);
                    scene.add(node);
                });
            }
        }

        // Build guides last so they can read the freshly-updated data. Guides are
        // purely visual (non-interactive) annotations.
        const guideCtx = {
            scales,
            // The primary table's rows — what a chart-level guide means by "the data".
            // A guide drawn about a MARK reads that mark's own table (and that table's
            // invariants) through tableOf / constraintsIn.
            data: primaryRows(),
            tableOf,
            constraintsIn,
            constraints: datasetConstraints,
            features,
            featureNodes,
            ui,
            effects,
            theme,
            width: innerWidth,
            height: innerHeight,
            // The current stage, so an edit's auto-guide can suppress itself when
            // its edit is inactive (one guide path, gated by the same rule as edits).
            stage: currentStage
        };
        allGuides.forEach(guide => {
            const nodes = guide.build(guideCtx) || [];
            nodes.forEach((/** @type {any} */ node) => {
                node.guide = true;
                scene.add(node);
            });
        });

        // ── The interaction-STATE pass ───────────────────────────────────────
        // ONE place decides what every interaction state looks like, for every
        // feature, however the state arose — and for BOTH of the effects layer's
        // mechanisms (the mark's own restyle and the outline overlay). The renderer
        // used to own the restyle half off its own pointerenter/d3.drag, which is why
        // `hovered: { fill }` painted only under SVG direct pick and `selected:
        // { fill }` did nothing at all; it is a dumb applier of `node.effectStyle` now.
        //
        // That matters most for HOVER, which has two sources that must be
        // indistinguishable to a reader:
        //
        //   · a proximity driver resolved this row as the one a gesture would take
        //     (session.activeIndex ?? session.hoverIndex), and
        //   · the pointer is simply over the mark (ui.hover, from the renderer).
        //
        // Both mean "this is the mark you are about to touch", so both feed the same
        // effect rather than one being a driver's private guide and the other not
        // existing at all. Selection is the committed answer and outranks hover, so a
        // selected row is not also drawn as hovered. `grabbed` (ui.grab, bracketed by
        // dragstart/dragend) is the in-flight one, and it STACKS: a mark you are
        // dragging is still the selected one, so the two merge rather than compete
        // (effectStyleFor resolves the overlap in EFFECT_STATES order).
        //
        // Drawn per FEATURE and keyed by DATUM index, so hovering a bar lights its
        // label up too — and per TABLE, so selecting node 3 does not also light up
        // link 3 in a network.
        /** @type {Record<string, Set<number>>} */
        const selectedByTable = {};
        for (const feature of features) {
            if (feature.views === 'scale') continue;
            const selected = selectedByTable[feature.table]
                || (selectedByTable[feature.table] = selectionIn(feature.table));
            const marks = featureNodes[feature.id] || [];

            /** @type {Set<number>} */
            const hovered = new Set();
            const session = ui.session && ui.session[feature.id];
            const viaProximity = session
                ? (session.activeIndex != null ? session.activeIndex : session.hoverIndex)
                : null;
            if (viaProximity != null) hovered.add(viaProximity);
            if (ui.hover && ui.hover.featureId === feature.id && ui.hover.index != null) {
                hovered.add(ui.hover.index);
            }
            for (const i of selected) hovered.delete(i);

            /** @type {Set<number>} */
            const grabbed = new Set();
            if (ui.grab && ui.grab.featureId === feature.id && ui.grab.index != null) {
                grabbed.add(ui.grab.index);
            }

            /** @type {[Set<number>, any][]} */
            const byState = [
                [hovered, effects.hovered],
                [selected, effects.selected],
                [grabbed, effects.grabbed],
            ];

            // Restyle half: merge the element props of every state a datum is in onto
            // that datum's own nodes. Stamped on the node so it survives into both
            // renderers and, being the mark's own node, lands on the mark's actual
            // position however it is transformed.
            /** @type {Map<number, any[]>} */
            const statesByIndex = new Map();
            for (const [indices, state] of byState) {
                for (const i of indices) {
                    const list = statesByIndex.get(i) || [];
                    list.push(state);
                    statesByIndex.set(i, list);
                }
            }
            for (const node of marks) {
                if (!node || node.ghost || node.index == null) continue;
                const style = effectStyleFor(statesByIndex.get(node.index) || []);
                if (style) node.effectStyle = style;
            }

            // Overlay half: the padded outline, the one part of the vocabulary that
            // needs geometry the mark itself doesn't have.
            for (const [indices, state] of byState) {
                if (!indices.size) continue;
                stateEffectNodes(marks, indices, state)
                    .forEach((/** @type {any} */ node) => { node.guide = true; scene.add(node); });
            }
        }

        renderer.render({
            container,
            scene,
            width: curW,
            height: curH,
            margins: effectiveMargins,
            scales,
            spec,
            planeOnTop,
            planeCursor,
            responsive: mode,
            overflow,
            focusOutline,
            effects,
            theme,
            onEvent: handleEvent
        });
    };

    // Compute one edit's proposed dataset WITHOUT committing it. `index` addresses
    // the datum being edited (null for create, which appends). The gesture is
    // inverted through the scales in apply(), producing a data-space proposal; that
    // proposal is then judged by the DATA-LAYER INVARIANTS (the dataset's
    // constraints, plus any edit-scoped constrain sugar). Constraints never see
    // pixels. Returns the accepted dataset, or null when the edit is a no-op /
    // rejected.
    //
    // Split out from `runEdit` so a hover can PREVIEW the very same proposal (same
    // apply, same invariants) without writing it to the belief store — see
    // previewEdit + the probe driver.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {any[] | { __domain?: import('../types').DomainEditResult, __selection?: any } | null}
     */
    const computeEdit = (feature, edit, event, index) => {
        // WHERE the gesture landed and WHAT it writes are usually the same table, and
        // for every edit that existed before structures they are the same by
        // construction. They come apart for a cross-table edit — `edit.network.connect`
        // is placed on a NODE mark (so `index` addresses a node row) but proposes a
        // LINK row — so the edit may name its target by ROLE, and the two are tracked
        // separately rather than conflated.
        const sourceRows = tableOf(feature);
        const targetTable = targetTableOf(feature, edit);
        const currentData = tables[targetTable] || [];
        const markChannels = feature.channels || {};
        // A node built inside a composite's local FRAME carries the very scales it was
        // encoded through (plot/composite.js stamps `node.frame`). Overlay them so the
        // edit inverts through the same objects — "an edit is the inverse of
        // encoding" holds per datum, with no second inversion path: this is channel
        // resolution honouring which scale drew the thing you grabbed, not a new
        // dispatch branch. A plane-pick gesture carries no node, so fall back to the
        // framed node for this datum.
        const editScales = frameScalesFor(feature, event.node, index) || scales;
        const resolved = resolveChannels(edit.channels, markChannels, editScales, feature.views === 'scale');
        const ctx = {
            // The rows the proposal is ABOUT (apply returns rows for this table)...
            data: currentData,
            // ...while `index`/`datum` address the row the gesture actually touched,
            // which belongs to the mark's own table. Identical on every same-table
            // edit, which is all of them but the graph pair.
            datum: index != null ? sourceRows[index] : undefined,
            index,
            // The whole dataset, for an edit that has to look ACROSS tables (rewire
            // resolves a node id from the node rows while writing a link row). Named
            // by table, and read-only by convention like every other ctx member.
            tables,
            table: targetTable,
            pointer: { x: event.x, y: event.y },
            node: event.node || null,
            event: event.rawEvent,
            // A non-pixel gesture payload (the text mark's `commit` typed string).
            value: event.value,
            channels: resolved,
            scales: editScales,
            markChannels,
            // Chart projection context (null on cartesian charts). Geo edits invert
            // through the same object geo marks use for apply/path.
            projection: /** @type {import('../types').ProjectionContext | null} */ (
                /** @type {any} */ (scales).projection || null
            ),
            // Plot pixel dimensions, so a gesture whose geometry is the whole plane
            // (rotate about the centre) can measure against it without a mark node —
            // the angular sibling of resize reading the mark centre.
            width: innerWidth,
            height: innerHeight,
            // The chart margins (effective: author + legend bands), so a grow-mode
            // axis edit recovers the outer size from an inner axis length (inner +
            // margins). Harmless to other edits.
            margins: effectiveMargins,
            // The engine-owned schema of the table this edit WRITES, so a mint
            // (create) populates every declared field with its default (or null) —
            // not just the positional ones — and an axis domain edit reads a field's
            // domain. Table-scoped, so a connect() mints a link row from the link
            // table's defaults rather than the node table's.
            schema: (schemaSpec.tables[targetTable] || schemaSpec.tables[schemaSpec.primary]).fields,
            // The whole canonical schema, for a cross-table edit that has to find
            // another table's key column (rewire reads the node table's key).
            schemaSpec,
            xKey: feature.xKey || 'x',
            yKey: feature.yKey || 'y',
            // The feature's series (grouping) field and its current scene nodes, so
            // proximity-aware edits (anchor / newSeries) and `when.near|far` can
            // resolve WHICH line a plane gesture means. Harmless to other edits.
            seriesKey: feature.seriesKey || null,
            marks: featureNodes[feature.id] || [],
            // The line's ordering knob and the engine's per-gesture driver session
            // (zone/handle locks, draw mode), for edits that read their driver's
            // lock (draw, brushSpan/brushRect, axis.scale). Harmless to the rest.
            order: feature.order || null,
            session: (ui.session && ui.session[feature.id]) || null,
            // The primary selected datum index (transient pipeline state), so an
            // edit's apply/when can target or arbitrate on the selection — e.g. a
            // `select` edit that reads whether the touched row is already selected.
            selection: selectionPrimary(),
            // The edit itself, so a `when` predicate can arbitrate against the
            // edit's own knobs (when.near reads its `threshold`). Descriptors are
            // data; self-reference adds no dispatch path.
            edit
        };
        if (edit.when && !edit.when(ctx)) return null; // arbitration

        const result = edit.apply(ctx);
        if (result === undefined) return null;

        // Which datum the gesture touched, for invariants that resolve a violation
        // relative to it. Read from the edit's DECLARED cardinality (see makeEdit),
        // never from its type — a custom append/delete edit gets the same treatment
        // as the built-in create/remove without the engine knowing either exists.
        /** @param {any[]} rows @returns {number | null} */
        const activeIndexOf = (rows) => (edit.cardinality === 'append' ? rows.length - 1
            : edit.cardinality === 'delete' ? null
                : /** @type {number | null} */ (index));

        // Data-layer invariants: the dataset's first (they hold for every edit from
        // every mark), then any edit-scoped guard sugar. Pure data context — no
        // scales-as-geometry. A constraint may reject the proposal (false) or repair
        // it (return an array); the marks re-derive from the repaired rows.
        //
        // The lock (spec.lock) runs LAST so it has the final word: a repair by any
        // other invariant still can't write a read-only row.
        /** @param {any[]} rows @returns {any[] | null} the repaired rows, or null if rejected */
        const runInvariants = (rows) => {
            const lockRows = lockRowsIn(targetTable);
            const invariants = [
                ...constraintsIn(targetTable), ...edit.constrain, ...(lockRows ? [lockRows] : []),
            ];
            const cctx = {
                activeIndex: activeIndexOf(rows), scales, markChannels,
                // The rest of the dataset and which table these rows are, for an
                // invariant that spans tables. Pure data, like everything else a
                // constraint sees — still no pixels.
                tables, table: targetTable,
            };
            let out = rows;
            for (const constraint of invariants) {
                const r = constraint(out, currentData, cctx);
                if (r === false) return null;
                if (r === true || r === undefined) continue;
                // A constraint may GATE (false) or REPAIR (the corrected rows). Anything
                // else is a bug in the constraint, and unvalidated it becomes the dataset:
                // a number or object makes `for (const d of dataset)` throw from inside
                // resolve.js with nothing naming the culprit, and a string iterates its
                // CHARACTERS and blanks the chart. Constraints built with defineConstraint
                // are normalized, so this only catches the hand-written form — which
                // spec.constraints accepts with no type checking at all.
                if (!Array.isArray(r)) {
                    warn(
                        `constraint:return:${constraintLabel(constraint)}`,
                        `constraint ${constraintLabel(constraint)} returned ${describe(r)}; a constraint must ` +
                        `return the repaired rows (an array), false to reject the edit, or ` +
                        `true/undefined to accept it unchanged. Ignoring the return value.`
                    );
                    continue;
                }
                out = r;
            }
            return out;
        };

        // A DOMAIN edit (edit.axis.*, edit.stack.cut on an open field) writes the
        // SCHEMA: apply returns { domains, data?, resize? }. The schema half bypasses
        // the datum-splice and the data-layer constraints — a domain is not a datum,
        // the same reason setData is trusted.
        //
        // Its COUPLED `data`, though, is an ordinary datum proposal (a category rename
        // relabels rows, a remove drops them, an open-domain cut splices one in), so it
        // meets the invariants like any other. Skipping them there let a constraint the
        // author declared — `count({ max })` capping how many categories may exist — be
        // silently ignored by exactly the edits that change how many there are.
        //
        // runEdit's domain-commit path handles the write; wrap it so runEdit/previewEdit
        // can tell it apart from a dataset proposal.
        if (edit.target === 'domain') {
            if (!(result && typeof result === 'object' && result.domains)) return null;
            if (!Array.isArray(result.data)) return /** @type {any} */ ({ __domain: result });
            const checked = runInvariants(result.data);
            if (!checked) return null;
            return /** @type {any} */ ({ __domain: { ...result, data: checked } });
        }

        // A SELECTION edit (edit.select) writes transient pipeline state, not the
        // dataset: apply returns a { __select } descriptor. Same shape as the domain
        // path — it bypasses the datum-splice, the data constraints, and undo — but
        // its destination is ui.selection. runEdit's selection-commit path handles it.
        if (edit.target === 'selection') {
            return (result && typeof result === 'object' && result.__select)
                ? /** @type {any} */ ({ __selection: result.__select })
                : null;
        }

        // A whole-dataset edit (create appends, remove filters) returns an array; a
        // mark edit returns the new datum, spliced in at `index`.
        const newData = Array.isArray(result)
            ? result
            : currentData.map((d, i) => (i === index ? result : d));

        return runInvariants(newData);
    };

    // Commit an edit: compute its proposal, write it to the belief store, drop any
    // preview it supersedes, and notify. Returns whether data changed.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const runEdit = (feature, edit, event, index) => {
        const proposed = computeEdit(feature, edit, event, index);
        if (!proposed) return false;
        // A domain edit reshapes the schema (and maybe the dataset / chart size).
        if (proposed && !Array.isArray(proposed) && proposed.__domain) {
            return commitDomainEdit(proposed.__domain, targetTableOf(feature, edit));
        }
        // A selection edit writes ui.selection, not the belief data.
        if (proposed && !Array.isArray(proposed) && proposed.__selection) {
            return commitSelectionEdit(proposed.__selection, targetTableOf(feature, edit));
        }
        recordHistory();
        // A proposal replaces the table the EDIT targets, which is not always the
        // table its mark draws (see computeEdit). Getting this wrong would overwrite
        // the wrong table wholesale, so the target is resolved the one way, there.
        tables[targetTableOf(feature, edit)] = /** @type {any[]} */ (proposed);
        // Deleting a row can strand REFERENCES to it in another table, which no
        // single-table constraint can see or repair. The schema already declares the
        // rule (`type: 'ref'`), so the engine enforces it — see enforceRefs.
        enforceRefs(schemaSpec, tables);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Commit a DOMAIN edit's proposal: write each field's schema domain (creating a
    // schema entry, with an inferred measure type, for a field the caller left
    // undeclared), replace the dataset when the edit coupled a data change (category
    // remove/rename deletes/relabels rows), and resize the chart for grow-mode
    // numeric drag. Then notify. The next update() re-resolves scales from the new
    // schema, so axis/grid/guides/marks all reflow.
    /**
     * @param {import('../types').DomainEditResult} result
     * @param {string} [table] the table the edit writes; its schema owns the domains,
     *   and its rows are what a coupled data change replaces.
     * @returns {boolean}
     */
    const commitDomainEdit = (result, table = schemaSpec.primary) => {
        recordHistory();
        const fields = (schemaSpec.tables[table] || schemaSpec.tables[schemaSpec.primary]).fields;
        for (const [field, domain] of Object.entries(result.domains || {})) {
            const prev = fields[field];
            fields[field] = { ...(prev || { type: inferMeasureOfDomain(domain) }), domain };
        }
        if (Array.isArray(result.data)) {
            tables[table] = result.data;
            // A category removal deletes rows, which can strand references to them.
            enforceRefs(schemaSpec, tables);
        }
        if (result.resize) applyResize(result.resize);
        ui.preview = null;
        notifyChange();
        return true;
    };

    // Grow-the-chart: adopt new outer pixel dims (numeric axis drag in `grow` mode),
    // mirror them onto the container the way the initial sizing does, and recompute
    // the inner rect so the next render draws at the new size.
    /** @param {{ width?: number, height?: number }} size */
    const applyResize = (size) => {
        if (typeof size.width === 'number' && size.width > 0) curW = size.width;
        if (typeof size.height === 'number' && size.height > 0) curH = size.height;
        if (mode === 'fixed') {
            container.style.width = `${curW}px`;
            container.style.height = `${curH}px`;
        } else if (mode === 'reflow') {
            container.style.height = `${curH}px`;
        }
        recomputeInner();
    };

    // Preview an edit: compute the SAME proposal (same apply, same invariants) but
    // park it in the transient preview store instead of the belief store. The next
    // render draws it in place of the committed rows, so a hover shows exactly what
    // a click would commit — and `getData`/`onChange` never see it.
    /**
     * @param {any} feature
     * @param {import('../types').Edit} edit
     * @param {any} event
     * @param {number | null} index
     * @returns {boolean}
     */
    const previewEdit = (feature, edit, event, index) => {
        const newData = computeEdit(feature, edit, event, index);
        // Only a dataset proposal can be previewed; a domain edit commits directly
        // (numeric drag commits each tick, categorical add/remove is one-shot).
        if (!newData || !Array.isArray(newData)) return false;
        // Park the proposal under THIS feature's id, so a second probe mark's preview
        // can't overwrite it. update()'s ghost pass renders only the changed rows.
        //
        // It carries the TABLE it is about, because the ghost is drawn by whichever
        // marks view that table — which is not always the mark that proposed it. A
        // connect drag proposes a link row from a node mark, and it is the link mark
        // that has to draw the rubber band.
        if (!ui.preview) ui.preview = {};
        ui.preview[feature.id] = { table: targetTableOf(feature, edit), rows: newData };
        return true;
    };

    // Direct-pick edits: the gesture landed on a mark (event.node). Fan the
    // gesture out to every direct edit whose `gesture` matches; `when` arbitrates
    // between edits sharing a gesture (plain-drag move vs Shift-drag resize).
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchDirectEdits = (feature, event) => {
        const index = event.node ? event.node.index : undefined;
        if (index == null) return false;
        let changed = false;
        // A gesture normally fans to EVERY direct edit sharing its type (arbitrated
        // by each edit's `when`). An externally-driven event may ADDRESS one edit by
        // name (event.editName), so a feature carrying several same-gesture edits —
        // three `set()`s on a face's params — drives exactly the one asked for
        // instead of all of them. Native pointer events set no editName, so their
        // fan-out is unchanged.
        const direct = activeEdits(feature).filter(e => e.pick === 'direct'
            && (!event.editName || e.name === event.editName));

        // A direct edit may still need a multi-event LIFECYCLE — a relative `slide`
        // has to remember the pixel and value it started from, or the value would
        // jump to wherever the mark was pressed. Its driver owns that state exactly
        // as it does for a plane edit; the only difference is that the target is the
        // node under the pointer, so nothing is searched for and the plane stays
        // down. This is the driver registry doing its job, not a pick branch: the
        // engine asks `driverFor` and never names a mode.
        const lifecycle = direct.filter(e => driverFor(e));
        if (lifecycle.length && runDrivers(feature, event, lifecycle, index)) changed = true;

        direct
            .filter(e => e.gesture === event.type && !driverFor(e))
            .forEach(edit => { if (runEdit(feature, edit, event, index)) changed = true; });
        return changed;
    };

    // Hand a set of edits to the interaction drivers. Each driver (edit/drivers)
    // owns one multi-event lifecycle; we give every driver the edits it `wants`
    // plus a per-feature session, and it runs them. The engine knows no specific
    // mode — adding one means adding a driver file.
    //
    // Both dispatch paths come through here. A PLANE gesture carries no node, so
    // `index` is null and the driver resolves its own target from the pointer. A
    // DIRECT gesture landed on a node, so `index` names the datum and the driver
    // skips target selection entirely — same lifecycle, no raised plane.
    /**
     * @param {any} feature
     * @param {any} event
     * @param {import('../types').Edit[]} edits
     * @param {number | null} index the datum a direct gesture landed on, else null
     * @returns {boolean}
     */
    const runDrivers = (feature, event, edits, index) => {
        if (edits.length === 0) return false;
        const fid = feature.id;

        // Per-feature transient session the drivers read/write (proximity selection,
        // sweep/draw locks); guides render from it.
        const session = {
            get: () => (ui.session && ui.session[fid]) || null,
            /** @param {any} patch */
            set: (patch) => {
                ui.session = ui.session || {};
                ui.session[fid] = { ...(ui.session[fid] || {}), ...patch };
            },
            clear: () => { if (ui.session) delete ui.session[fid]; }
        };
        /** @param {import('../types').Edit} edit @param {number | null} index */
        const runFeatureEdit = (edit, index) => runEdit(feature, edit, event, index);
        /** @param {import('../types').Edit} edit @param {number | null} index */
        const previewFeatureEdit = (edit, index) => previewEdit(feature, edit, event, index);

        // The feature's uncommitted proposal, and the chart's stage cursor. Handed to
        // drivers as capabilities exactly like `session` — so a multi-event lifecycle
        // (hover to preview, click to commit and advance) lives in its driver file,
        // not in engine branches.
        const preview = {
            get: () => (ui.preview && ui.preview[fid]) || null,
            clear: () => {
                if (!ui.preview || !ui.preview[fid]) return false;
                delete ui.preview[fid];
                if (Object.keys(ui.preview).length === 0) ui.preview = null;
                return true;
            }
        };
        const stage = {
            get: () => currentStage,
            /** @param {number} n */
            set: (n) => applyStage(n),
            next: () => applyStage(currentStage + 1)
        };

        let changed = false;
        for (const driver of drivers) {
            const matching = edits.filter(e => driver.wants(e));
            if (matching.length === 0) continue;
            const dctx = {
                feature, event, edits: matching,
                marks: featureNodes[fid] || [],
                data: tableOf(feature),
                // Read-only: lets a driver (e.g. brush) encode a channel's current
                // pixel position for hit-zone classification, without reinventing
                // scale lookup — the same global scales every edit already inverts through.
                scales,
                index: index != null ? index : null,
                session,
                preview,
                stage,
                runEdit: runFeatureEdit,
                previewEdit: previewFeatureEdit
            };
            if (driver.onEvent(dctx)) changed = true;
        }
        return changed;
    };

    // Plane-pick edits: the gesture is on the plane, so it carries no node and the
    // driver resolves its own target.
    /**
     * @param {any} feature
     * @param {any} event
     * @returns {boolean}
     */
    const dispatchPlaneEdits = (feature, event) =>
        runDrivers(feature, event, activeEdits(feature).filter(e => e.pick !== 'direct'), null);

    // 4. Event routing.
    //    - Events carrying a `node` are mark-scoped (change existing elements) and
    //      route to that mark's direct-pick edits.
    //    - Events without a `node` are plane-scoped and route to every feature's
    //      plane/nearest/sweep/draw edits.
    /**
     * @param {any} event
     */
    const handleEvent = (event) => {
        let shouldRender = false;

        // Pointer-over/out on an editable mark. Pure interaction STATE — it never
        // reaches an edit, opens no undo transaction and writes no data; it only
        // records which row the pointer is on so the state pass can draw the
        // `hovered` effect (see core/effects.js). Handled before everything else so
        // it can't be mistaken for a gesture.
        //
        // This is the counterpart to a proximity driver's session: both answer "which
        // mark would a gesture take?", and they feed the same effect, so a direct-pick
        // mark now signals that before you press it instead of only changing the
        // cursor.
        if (event.type === 'pointerover' || event.type === 'pointerout') {
            const node = event.node;
            const next = event.type === 'pointerover' && node && node.index != null
                ? { featureId: node.featureId, index: node.index }
                : null;
            /** @param {any} a @param {any} b */
            const same = (a, b) => (!a && !b)
                || !!(a && b && a.featureId === b.featureId && a.index === b.index);
            if (!same(ui.hover, next)) { ui.hover = next; update(); }
            return;
        }

        // A keyboard nudge is INPUT NORMALIZATION, not an interaction mode: the
        // renderer reports "one step this way" and we resolve it into the pixel a
        // pointer would have been at, so it arrives as an ordinary `drag`. Every
        // direct-pick drag edit becomes keyboard-drivable with no new edit, no new
        // driver, and nothing downstream learning that keyboards exist.
        if (event.type === 'nudge') {
            // Step from where the datum's CURRENT VALUE sits, which is not the same
            // as where the node sits: a bar's centre is halfway up the bar, so
            // nudging from it would first teleport the value to the middle of
            // itself. encodeChannel answers "where is this datum on this axis" the
            // same way the mark drew it — the node centre is only the fallback for
            // a mark with nothing positional on that axis.
            const node = event.node;
            const from = markCenter(node);
            if (!from) return;
            const feature = features.find((f) => f.id === node.featureId);
            const channels = (feature && feature.channels) || {};
            const datum = node.index != null ? (feature ? tableOf(feature) : [])[node.index] : node.data;
            // Inside a composite's frame the datum's position is a LOCAL one, so read it
            // (and step it) through the node's own frame scales — the same overlay
            // computeEdit applies when the resulting drag arrives.
            const ks = frameScalesFor(feature, node, node.index) || scales;
            const atX = datum ? encodeChannel(ks, channels, 'x', datum, from.cx) : from.cx;
            const atY = datum ? encodeChannel(ks, channels, 'y', datum, from.cy) : from.cy;
            event = {
                type: 'drag',
                node,
                x: nudgeTarget(ks.x, atX, event.dx, event.coarse),
                y: nudgeTarget(ks.y, atY, event.dy, event.coarse),
                // One press = one complete gesture (there is no dragend coming), so
                // it closes its own undo transaction below.
                nudge: true,
                rawEvent: event.rawEvent,
            };
        }

        // Undo transaction boundaries. A stroke is one unit of "take that back":
        // dragstart opens it and dragend closes it, so the many commits a drag makes
        // in between collapse into a single history entry. Any other gesture (click,
        // dblclick, a typed commit) is a transaction of its own — begin it here and
        // close it below, so it can't absorb the next one.
        // dragstart always starts a fresh one, so a stroke whose dragend never
        // arrived can't leak its stale "before" into the next gesture.
        if (event.type === 'dragstart') { endTxn(); beginTxn(); }
        else if (!txn) beginTxn();

        // Grab state rides the SAME bracket as the transaction — one stroke, one
        // grabbed row — so the state pass can draw `grabbed` beside the other two
        // instead of the renderer painting it privately off d3.drag. Force a render
        // when it changes and the state actually paints something: a press that
        // moves no data (or none yet) still has to light the mark up, which is the
        // whole point of pre-commit feedback.
        if (event.type === 'dragstart' || event.type === 'dragend') {
            const next = event.type === 'dragstart' && event.node && event.node.index != null
                ? { featureId: event.node.featureId, index: event.node.index }
                : null;
            const changed = !!ui.grab !== !!next
                || !!(ui.grab && next && (ui.grab.featureId !== next.featureId || ui.grab.index !== next.index));
            ui.grab = next;
            const g = effects.grabbed;
            if (changed && g && g.enabled !== false && (g.outline || elementEffectOf(g))) shouldRender = true;
        }

        if (event.node) {
            // Dispatch to the touched mark's feature (direct pick).
            const feature = features.find(f => f.id === event.node.featureId);
            if (feature && dispatchDirectEdits(feature, event)) shouldRender = true;
        } else {
            // Plane gestures -> every feature's plane/nearest/sweep/draw edits.
            features.forEach(feature => {
                if (dispatchPlaneEdits(feature, event)) shouldRender = true;
            });
        }

        // Keep the transaction open only for the duration of a stroke. A nudge's
        // synthetic drag is a complete gesture on its own, so it closes too —
        // otherwise it would stay open and swallow whatever gesture came next.
        if (event.type === 'dragend' || event.nudge
            || (event.type !== 'dragstart' && event.type !== 'drag')) endTxn();

        if (shouldRender) {
            update();
        }
    };

    // Caller-facing data API, attached to the container the engine returns. This
    // is pure observation over the belief `dataset` — it adds no interaction path
    // (edits/constraints stay the only way a gesture mutates data).
    const el = /** @type {import('../types').ElicitElement} */ (/** @type {any} */ (container));
    // A deep copy so callers can't mutate the live store; structuredClone (not a
    // JSON round-trip) preserves Date values a time-scale edit may have written.
    el.getData = () => structuredClone(shapeData());
    // A deep copy of the engine-owned schema, so a caller can read a DOMAIN an
    // editable axis reshaped (the caller's original spec.schema is never mutated).
    // Denormalized back to the spelling it was GIVEN in: a single-table chart gets
    // its bare field map, so the engine's canonical form never leaks outward.
    el.getSchema = () => structuredClone(denormalizeSchema(schemaSpec));
    // Replace the dataset and re-render. Bypasses constraints by design:
    // constraints gate GESTURES; caller-supplied data is trusted (seeding/reset).
    // That includes the lock: setData RE-SEEDS the chart, so under `lock: 'seed'`
    // the rows it hands in become the new read-only seed.
    el.setData = (/** @type {any[] | Record<string, any[]>} */ data) => {
        // Same split as the seed: a bare array is the primary table, a keyed object
        // names its tables. So a caller's setData(rows) keeps working verbatim.
        tables = normalizeData(structuredClone(data ?? null), schemaSpec);
        // A reseed is new seed data, so it gets the same contract check as spec.data.
        validateTables(schemaSpec, tables, 'setData()');
        seedCounts = {};
        for (const name of Object.keys(tables)) seedCounts[name] = tables[name].length;
        ui.preview = null;
        ui.hover = null;   // the pointer's row index is new too
        ui.grab = null;    // and any in-flight grab points at a row that just moved
        ui.selection.clear(); // a reseed's row indices are new; drop the old selection
        // A reseed is a new starting point, not an edit: there is nothing sensible
        // to undo BACK to (and undoing past it would resurrect rows the caller
        // replaced, under a lock that no longer covers them).
        past = [];
        future = [];
        endTxn();
        update();
    };

    // ── Selection: read/drive the transient selection from outside ────────────
    // Selection is pipeline state, not data — so it has its own small API beside
    // getData/setData, and its own `select` event. Driving it externally goes
    // through the SAME applySelection the edit.select gesture does, so an external
    // <select>, a keyboard, or a click all leave the selection in one shape.

    // The primary selected index (number) or null. The counterpart of getData for
    // selection; a caller reads it to drive its own UI (which row is highlighted).
    el.getSelection = () => selectionPrimary();

    // Drive the selection from outside, then render. Each wrapper renders itself (it
    // runs OUTSIDE the dispatch, which is what renders the gesture path), and returns
    // whether the selection moved.
    /** @param {{ index?: number | null, exclusive?: boolean, toggle?: boolean, clear?: boolean }} sel */
    const driveSelection = (sel) => {
        const moved = commitSelectionEdit(sel);
        if (moved) update();
        return moved;
    };

    // Select a SPECIFIC ITEM by dataset index (the external counterpart of clicking
    // a mark). `null` (or a negative / out-of-range index) clears the selection.
    // Exclusive: the named row becomes the sole selection, replacing whatever was
    // selected.
    el.select = (/** @type {number | null} */ index) => {
        const rows = primaryRows();
        const i = index == null || index < 0 || index >= rows.length ? null : index;
        return driveSelection({ index: i, exclusive: true, toggle: false, clear: i == null });
    };

    // Select by CATEGORY / predicate: pick the first row matching `{ field: value }`
    // (or a predicate function) and select it. This is the "select a category"
    // entry point — an external control names a value, the chart finds and selects
    // the row carrying it. No match clears the selection.
    el.selectWhere = (/** @type {any} */ where, /** @type {any} */ value) => {
        const match = typeof where === 'function'
            ? /** @type {(d: any, i: number) => boolean} */ (where)
            : (/** @type {any} */ d) => d && d[where] === value;
        const i = primaryRows().findIndex(match);
        return el.select(i < 0 ? null : i);
    };

    // Clear the selection entirely.
    el.clearSelection = () => driveSelection({ index: null, clear: true });

    // ── External control: drive an edit from outside the chart ────────────────
    // An external controller (a slider, a `<select>`, a rotate icon, a plain
    // function) is a new INPUT SOURCE, not a second interaction system. It
    // synthesizes the SAME renderer-shaped events the pointer and keyboard
    // produce and feeds them to the one `handleEvent` — exactly what the keyboard
    // `nudge` normalizer already does above. Constraints, undo, guides,
    // `on('change')`, and re-render all run because the event traverses the
    // identical pipeline. No new pick, no driver, no dispatch branch.

    // Low-level: inject a renderer-shaped event. `x`/`y` are INNER (margin-
    // subtracted) pixels — the space `ctx.pointer` reads. Event shape:
    // { type, node?, x?, y?, value?, nudge?, rawEvent? }. Callers usually want
    // `el.control(name)` (below), which computes pixels from a DATA value for you.
    el.emit = (/** @type {any} */ event) => handleEvent(event);

    // Find the (feature, edit) an external controller addresses by `name` (set via
    // move({ name: 'move' }) etc.). Lazy — scanned each call so it tracks re-renders
    // and stage changes.
    const findNamedEdit = (/** @type {string} */ name) => {
        /** @type {{ feature: any, edit: any } | null} */
        let hit = null;
        // Count DISTINCT edits, by their `apply` — the one part of a descriptor that
        // survives collectEdits' channel-injecting copy and is unique per factory
        // call. The name is ambiguous only when two edits that do different things
        // answer to it; ONE edit declared on several parts of a glyph (a face's two
        // eyes, its two brows) is not a collision, and "driving the first" is exactly
        // right there — they are the same edit over the same column.
        /** @type {Set<any>} */
        const distinct = new Set();
        for (const feature of features) {
            for (const edit of collectEdits(feature)) {
                if (edit.name !== name) continue;
                distinct.add(edit.apply);
                if (!hit) hit = { feature, edit };
            }
        }
        if (distinct.size === 0) warn(`control:none:${name}`, `el.control("${name}"): no edit is named "${name}".`);
        if (distinct.size > 1) warn(`control:many:${name}`, `el.control("${name}"): ${distinct.size} different edits share the name "${name}"; driving the first.`);
        return hit;
    };

    // The scene node for a datum index in a feature, resolved fresh from the CURRENT
    // render (never cached — nodes are rebuilt every update). Gives radial edits
    // (resize/rotate about the mark) their pivot via markCenter.
    const nodeAt = (/** @type {any} */ feature, /** @type {number} */ index) =>
        (featureNodes[feature.id] || []).find((/** @type {any} */ n) => n && n.index === index) || null;

    // High-level façade: a handle bound to a named edit + datum. It reads the edit's
    // own `gesture` to route value-space vs pointer-space — the FAÇADE branches; the
    // engine dispatch never learns a controller exists.
    el.control = (/** @type {string} */ name, /** @type {number} */ index = 0) => {
        // Value -> the pointer that would set it, forward-encoding through the SAME
        // scale the edit inverts (the inverse of the edit's inverse — encoding, run
        // forward). Mirrors the nudge normalizer: untouched axes keep the datum's
        // CURRENT pixel so they don't teleport.
        const dragPointer = (/** @type {any} */ feature, /** @type {any} */ edit, /** @type {any} */ value) => {
            const node = nodeAt(feature, index);
            const center = markCenter(node);
            const datum = primaryRows()[index];
            const channels = feature.channels || {};
            // Forward-encode through the SAME scales the edit will invert — which,
            // inside a composite's frame, are the node's own (see frameScalesFor).
            const editScales = frameScalesFor(feature, node, index) || scales;
            // Base: where the datum currently sits, so a single-axis set doesn't move
            // the other axis.
            let x = datum ? encodeChannel(editScales, channels, 'x', datum, center ? center.cx : 0) : (center ? center.cx : 0);
            let y = datum ? encodeChannel(editScales, channels, 'y', datum, center ? center.cy : 0) : (center ? center.cy : 0);
            const resolved = resolveChannels(edit.channels, channels, editScales, feature.views === 'scale');
            // `value` is either a scalar (single-channel edit) or a { channelName: v }
            // / { field: v } map for a multi-channel edit (a 2-D drag).
            const valueFor = (/** @type {any} */ ch) => {
                if (value != null && typeof value === 'object' && !(value instanceof Date)) {
                    if (ch.name in value) return value[ch.name];
                    if (ch.field != null && ch.field in value) return value[ch.field];
                    return undefined;
                }
                return value; // scalar applies to the sole channel
            };
            for (const ch of resolved) {
                if (!ch.scale || !ch.scale.invertible) continue;
                const v = valueFor(ch);
                if (v === undefined) continue;
                const visual = ch.scale.encode(v);
                const p = pointerForChannel(ch.name, visual, center);
                if (!p) continue;
                if (axisOf(ch.name) === 'x' || ch.name === 'size' || ch.name === 'angle') x = p.x;
                if (axisOf(ch.name) === 'y' || ch.name === 'size' || ch.name === 'angle') y = p.y;
            }
            return { node, x, y };
        };

        // True between begin() and end(): a live drag session, so `.set` ticks emit a
        // plain `drag` (they collapse into the open txn) instead of a self-closing
        // one-shot `nudge` drag (which would close the txn every tick).
        let live = false;

        const handle = {
            // One-shot write. Commit-gesture edits (set/editText) carry the value whole
            // in `ctx.value`; drag-gesture edits forward-encode it to a pointer. Outside
            // a begin()/end() session a drag self-closes its txn with `nudge:true` (one
            // undo entry); inside one, it stays a plain `drag` so the session collapses.
            set(/** @type {any} */ value) {
                const found = findNamedEdit(name);
                if (!found) return;
                const { feature, edit } = found;
                const node = nodeAt(feature, index);
                // editName addresses THIS edit, so a sibling edit sharing the gesture
                // (another set() on the same feature) doesn't also fire.
                if (edit.gesture === 'commit') {
                    el.emit({ type: 'commit', node, value, editName: name, x: node ? node.cx : 0, y: node ? node.cy : 0 });
                    return;
                }
                const { node: n, x, y } = dragPointer(feature, edit, value);
                el.emit(live
                    ? { type: 'drag', node: n, x, y, editName: name }
                    : { type: 'drag', node: n, x, y, nudge: true, editName: name });
            },
            // Live drag: begin()/end() bracket the txn so many .set() ticks collapse
            // into ONE undo entry (exactly like a pointer drag's dragstart..dragend).
            begin() {
                const found = findNamedEdit(name);
                if (!found) return;
                live = true;
                el.emit({ type: 'dragstart', node: nodeAt(found.feature, index), editName: name });
            },
            end() {
                const found = findNamedEdit(name);
                live = false;
                if (!found) return;
                el.emit({ type: 'dragend', node: nodeAt(found.feature, index), editName: name });
            },
            // Fire a TRIGGER edit — one that takes no value, it just acts on the datum
            // (cycle advances a category, remove drops the row, toggle flips it). An
            // external button drives it: `control(name).fire()` dispatches the edit's
            // own gesture (a click/dblclick) on the datum's node. Pass a gesture to
            // override. This is the counterpart of `.set` for the click/dblclick edits
            // — `.set` covers commit/drag, `.fire` covers the rest. (Plane-pick edits
            // like create need coordinates; use `.emit({ type, x, y })` for those.)
            fire(/** @type {string} */ gesture) {
                const found = findNamedEdit(name);
                if (!found) return;
                const g = gesture || found.edit.gesture || 'click';
                el.emit({ type: g, node: nodeAt(found.feature, index), editName: name });
            },
            // Raw passthrough, auto-scoped to this feature's node for the datum.
            emit(/** @type {any} */ event) {
                const found = findNamedEdit(name);
                el.emit({ node: found ? nodeAt(found.feature, index) : undefined, ...event });
            },
            // What values this channel ACCEPTS, read off its scale — so external UI
            // (dropdown options, slider min/max, colour choices) respects the scale
            // instead of fighting it. Reads capability flags, never `scale.type`.
            accepts() {
                const found = findNamedEdit(name);
                if (!found) return null;
                const { feature, edit } = found;
                const editScales = frameScalesFor(feature, null, index) || scales;
                const ch = resolveChannels(edit.channels, feature.channels || {}, editScales, feature.views === 'scale')[0];
                const scale = /** @type {any} */ (ch && ch.scale);
                const fieldSpec = (schema && ch && ch.field && schema[ch.field]) || null;
                const measure = (fieldSpec && fieldSpec.type) || null;
                // Prefer the scale's domain; fall back to the schema's declared domain
                // so a non-positional channel (a face param) still reports its range.
                const domain = (scale && typeof scale.domain === 'function' ? scale.domain() : null)
                    || (fieldSpec && fieldSpec.domain) || null;
                const range = scale && typeof scale.range === 'function' ? scale.range() : null;
                return {
                    field: ch ? ch.field : null,
                    type: measure,                         // MeasureType (quantitative/categorical/…)
                    kind: scale ? scale.kind : null,       // band | point | continuous | discrete
                    temporal: !!(scale && scale.temporal),
                    invertible: !!(scale && scale.invertible),
                    // A discrete channel's domain IS its accepted value set; a
                    // continuous channel's domain is its accepted [min, max].
                    domain,
                    values: (
                        (scale && (scale.kind === 'band' || scale.kind === 'discrete' || scale.kind === 'point'))
                        || measure === 'categorical' || measure === 'ordinal'
                    ) ? domain : null,
                    range,
                };
            },
        };
        return handle;
    };

    // Undo / redo one GESTURE (see the history store above). Both return whether
    // they moved, so a caller can drive a button's disabled state; both fire the
    // ordinary `change` notification, because as far as anything downstream is
    // concerned the data just changed.
    el.canUndo = () => past.length > 0;
    el.canRedo = () => future.length > 0;
    el.undo = () => {
        if (!past.length) return false;
        future.push(snapshot());
        restoreSnapshot(/** @type {any} */(past.pop()));
        endTxn();
        notifyChange();
        update();
        return true;
    };
    el.redo = () => {
        if (!future.length) return false;
        past.push(snapshot());
        restoreSnapshot(/** @type {any} */(future.pop()));
        endTxn();
        notifyChange();
        update();
        return true;
    };
    // Subscribe to committed changes; returns an unsubscribe function.
    el.on = (/** @type {'change' | 'stage' | 'select'} */ type, /** @type {Function} */ cb) => {
        listeners[type].add(cb);
        return () => listeners[type].delete(cb);
    };

    // Multi-stage controls. Advancing the stage re-renders (the active edit set,
    // plane-on-top, and cursors all follow currentStage) and drops every transient.
    el.getStage = () => currentStage;
    el.getStageLabel = () => stageLabelOf(currentStage);
    el.setStage = (/** @type {number} */ stage) => {
        applyStage(stage);
        update();
    };
    el.nextStage = () => el.setStage(currentStage + 1);

    // 'reflow' mode: watch the container and re-render when the parent resizes.
    // rAF-coalesced (a resize can fire many times per frame) and guarded so a
    // render that doesn't change the width can't feed back into a loop.
    /** @type {ResizeObserver | null} */
    let ro = null;
    if (mode === 'reflow' && typeof ResizeObserver !== 'undefined') {
        let scheduled = false;
        ro = new ResizeObserver(() => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                scheduled = false;
                if (measure()) update();
            });
        });
        ro.observe(container);
    }
    // Detach the observer (and its hold on the container). Call when unmounting a
    // reflow chart; no-op otherwise.
    el.destroy = () => {
        if (ro) { ro.disconnect(); ro = null; }
    };

    // Initial render. Deferred so the container can be attached to the DOM first
    // if the renderer needs measured dimensions.
    setTimeout(update, 0);

    return el;
}
