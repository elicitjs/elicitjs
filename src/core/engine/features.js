// @ts-check
import { autoAxes } from '../axes.js';
import { legendsFromChannels } from '../legends.js';
import { portFeature } from '../../plot/port.js';
import { tip as tipGuide } from '../../guides/tip.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * Where features are FLATTENED: the spec's marks, elements and implicit layers
 * become the one ordered feature list the engine builds, dispatches and paints,
 * and the channel-level sugars (`ports`, `contains`/`dodge`/`fit`, `tip`) are
 * desugared here, once. Everything in this file runs at Elicit() time and reads
 * no chart state — the passes are pure functions of the spec and the schema.
 */

/**
 * The flattened feature list: auto axes, the author's elements and marks, then
 * the implicit legends — with an engine id stamped on every feature that has none.
 *
 * @param {import('../../types').ElicitSpec} spec
 * @param {any} theme the resolved theme
 * @returns {any[]}
 */
export function assembleFeatures(spec, theme) {
    const { marks: userMarks = [], elements: userElements = [], axes, legends } = spec;
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
    // A legend-scoped edit declared on a MARK's channel moves to that channel's
    // legend, taking the mark's field and table with it (core/legends.js). Runs
    // before autoLegends so a minted legend counts as "explicit" for its channel
    // and the implicit layer doesn't add a second one beside it.
    const features = [
        ...autoAxes(userFeatures, axesOpt, theme),
        ...userFeatures,
        ...legendsFromChannels(userFeatures, legends),
    ].flat(Infinity);

    features.forEach((feature, index) => {
        // `autoId` marks the id as ENGINE-assigned, so a diagnostic can tell an id the
        // author chose (worth quoting back) from a positional placeholder (worth
        // naming the factory instead). Without it every guard reported
        // `mark "feature-3"`, since `id` is optional and most specs omit it.
        if (!feature.id) { feature.id = `feature-${index}`; feature.autoId = true; }
    });
    return features;
}

/**
 * Which TABLE each feature is a view over, resolved once. A mark states a table
 * by NAME (`table: 'links'`); with none, it takes the table filling its ROLE —
 * `link` asks for `links`, every other mark for the structure's primary. Going
 * through the role is what makes renaming free: a schema that calls its tables
 * `claims`/`supports` needs no `table:` written anywhere.
 *
 * @param {any[]} features
 * @param {import('../../types').SchemaSpec} schemaSpec
 */
export function bindFeatureTables(features, schemaSpec) {
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
}

/**
 * ── Ports: a channel that becomes a feature ────────────────────────────────
 * `ports` on a mark drawing a network's nodes says where links may meet it. It
 * desugars HERE, once, into a sibling PORT feature (plot/port.js) — the composite
 * precedent: one declared mark, several features. A separate feature is what
 * keeps a drag on a port off the host's own edits (its `move`), and placing it
 * after the host's whole glyph keeps it painted on top of the node.
 *
 * Splices the port features into `features` in place.
 *
 * @param {any[]} features
 * @param {string | null} nodesTableName the table filling the `nodes` role
 */
export function desugarPorts(features, nodesTableName) {
    for (let i = 0; i < features.length; i++) {
        const host = features[i];
        // A port feature reads its own `ports` channel; it is not a host.
        const spec = host && !host.portHost && host.views !== 'scale' && host.channels && host.channels.ports;
        if (!spec) continue;
        delete host.channels.ports;
        if (typeof host.nodeBox !== 'function') {
            warn(
                `${markLabel(host)}:ports:box`,
                `mark ${markLabel(host)} has a \`ports\` channel, but it does not declare the box ` +
                'it draws, so there is no edge to put a port on. Put `ports` on a mark that draws ' +
                'a node shape: point, rect, ellipse, text, sticker, node, face, or a composite.'
            );
            continue;
        }
        if (!nodesTableName || host.table !== nodesTableName) {
            warn(
                `${markLabel(host)}:ports:table`,
                `mark ${markLabel(host)} has a \`ports\` channel, but it draws table ` +
                `"${host.table}", which is not a network's nodes table. Ports are where links ` +
                'meet NODES: declare schema: { structure: "network", … } and put `ports` on the ' +
                'mark drawing the nodes.'
            );
            continue;
        }
        let at = i + 1;
        while (host.glyph && at < features.length && features[at] && features[at].glyph === host.glyph) at++;
        features.splice(at, 0, portFeature(host, spec));
    }
}

/**
 * ── Containers: two statements in the channel map ──────────────────────────
 * Under a hierarchy, a mark drawing the nodes says which rows may HOLD others
 * (`contains`: a constant, a field or a fn — the `ports` precedent: a per-row
 * capability the ENGINE reads, never the mark) and which of its size channels
 * follow from a row's contents (`fit: true` — see core/fit.js). `contains` is
 * taken off the channel map here so no scale is built for it; `fit` stays, a
 * flag beside the channel's field. `dodge` is the third: which rows keep clear
 * of their siblings (and by what `gap`), read the same way.
 *
 * @param {any[]} features
 * @param {string | null} hierarchyNodes the nodes table, when the structure is a hierarchy
 */
export function desugarContainers(features, hierarchyNodes) {
    for (const f of features) {
        if (!f || f.views === 'scale' || f.portHost || !f.channels) continue;
        const contains = f.channels.contains;
        const dodge = f.channels.dodge;
        const fitted = Object.keys(f.channels).filter((ch) => f.channels[ch] && f.channels[ch].fit === true);
        if (!contains && !dodge && !fitted.length) continue;
        if (contains) delete f.channels.contains;
        if (dodge) delete f.channels.dodge;
        if (!hierarchyNodes || f.table !== hierarchyNodes) {
            warn(
                `${markLabel(f)}:contains:table`,
                `mark ${markLabel(f)} states ${contains ? '`contains`' : dodge ? '`dodge`' : '`fit`'}, but it does not ` +
                'draw the nodes of a hierarchy, so nothing can be nested in its rows. Declare ' +
                'schema: { structure: "hierarchy", tables: { nodes, nesting } } and put it on ' +
                'the mark drawing the nodes.'
            );
            for (const ch of fitted) delete f.channels[ch].fit;
            continue;
        }
        if (typeof f.nodeBox !== 'function') {
            warn(
                `${markLabel(f)}:contains:box`,
                `mark ${markLabel(f)} states ${contains ? '`contains`' : dodge ? '`dodge`' : '`fit`'}, but it does not ` +
                'declare the box it draws, so it has no inside. Use a mark that draws a node ' +
                'shape: point, rect, ellipse, shape, or a composite.'
            );
            continue;
        }
        if (contains) f.contains = contains === true ? { value: true } : contains;
        if (dodge) f.dodge = dodge === true ? { value: true } : dodge;
        for (const ch of fitted) {
            if (f.channels[ch].field != null) continue;
            warn(
                `${markLabel(f)}:fit:${ch}`,
                `mark ${markLabel(f)} marks channel "${ch}" \`fit: true\` but names no field. ` +
                'A fitted size is written to a column — that is what keeps the drawing, the ' +
                `links and getData() in agreement. Name one: ${ch}: { field: '…', fit: true }.`
            );
            delete f.channels[ch].fit;
        }
    }
}

/**
 * A mark's `tip` shorthand is a tip GUIDE bound to that mark — desugared once,
 * here, the way `ports` becomes a port feature. The guide path is what makes
 * a tooltip harmless: it reads state and makes nothing pointer-active.
 *
 * @param {any[]} features
 * @returns {any[]}
 */
export function tipGuidesOf(features) {
    return features
        .filter((f) => f && f.views !== 'scale' && f.tip != null && f.tip !== false)
        .map((f) => tipGuide({
            mark: f.id,
            // `true` shows every column; a list or function says what; an object
            // is the guide's own options (text, format, anchor, …).
            ...(f.tip === true ? {}
                : (Array.isArray(f.tip) || typeof f.tip === 'function') ? { text: f.tip }
                    : f.tip),
        }));
}

/**
 * The channel map of the mark that DRAWS a table, for an edit that writes a table
 * its own mark doesn't draw (connect, on a node's ports, writes a link row). The
 * link's channels name the columns, so a column is named in one place only.
 * Memoized per table name.
 *
 * @param {any[]} features
 * @returns {(name: string) => Record<string, any> | null}
 */
export function viewerChannelsOf(features) {
    /** @type {Record<string, Record<string, any> | null>} */
    const viewerChannels = {};
    /** @param {string} name @returns {Record<string, any> | null} */
    return (name) => {
        if (name in viewerChannels) return viewerChannels[name];
        const viewers = features.filter((f) => f && f.views !== 'scale' && !f.portHost
            && f.table === name && f.channels);
        const fieldOf = (/** @type {any} */ f, /** @type {string} */ ch) =>
            (f.channels[ch] && f.channels[ch].field) || null;
        for (const ch of ['source', 'target', 'sourceSide', 'targetSide']) {
            const named = new Set(viewers.map((f) => fieldOf(f, ch)).filter(Boolean));
            if (named.size > 1) {
                warn(
                    `viewers:${name}:${ch}`,
                    `marks drawing table "${name}" name different columns for \`${ch}\` ` +
                    `(${[...named].map((n) => `"${n}"`).join(', ')}). An edit writing that table ` +
                    'uses the first. Name the column on one mark, or the same column on each.'
                );
            }
        }
        viewerChannels[name] = viewers.length ? viewers[0].channels : null;
        return viewerChannels[name];
    };
}
