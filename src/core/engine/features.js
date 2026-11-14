// @ts-check
import { autoAxes } from '../axes.js';
import { legendsFromChannels } from '../legends.js';
import { portFeature } from '../../plot/port.js';
import { tip as tipGuide } from '../../guides/tip.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * Flattens the spec's marks, elements and implicit layers into one ordered
 * feature list, and desugars `ports`, `contains`/`dodge`/`fit` and `tip`.
 * Runs once at Elicit() time; reads no chart state.
 */

/**
 * The flattened feature list: auto axes, the author's elements and marks, then
 * the implicit legends. Stamps an id on every feature that has none.
 *
 * @param {import('../../types').ElicitSpec} spec
 * @param {any} theme the resolved theme
 * @returns {any[]}
 */
export function assembleFeatures(spec, theme) {
    const { marks: userMarks = [], elements: userElements = [], axes, legends } = spec;
    // Auto axes go first (behind the marks); a projection chart gets none unless
    // `axes` is set. Legends go last. Flattened because a composite is an array.
    const userFeatures = [...userElements, ...userMarks];
    const axesOpt = spec.projection != null && axes === undefined ? false : axes;
    const features = [
        ...autoAxes(userFeatures, axesOpt, theme),
        ...userFeatures,
        ...legendsFromChannels(userFeatures, legends),
    ].flat(Infinity);

    features.forEach((feature, index) => {
        // `autoId` lets diagnostics tell an engine id from one the author chose.
        if (!feature.id) { feature.id = `feature-${index}`; feature.autoId = true; }
    });
    return features;
}

/**
 * Resolve the table each feature draws: its `table` name, else the table
 * filling its `tableRole`, else the primary.
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
 * Desugar a node mark's `ports` channel into a sibling port feature
 * (plot/port.js), spliced in place after the host's glyph so it paints on top.
 * Being a separate feature keeps a port drag off the host's own edits.
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
 * Desugar a hierarchy node mark's `contains` and `dodge` channels onto the
 * feature (no scale is built for them) and check its `fit: true` size channels
 * (core/fit.js).
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
 * Desugar each mark's `tip` shorthand into a tip guide bound to that mark.
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
 * The channel map of the mark that draws a table, for an edit writing a table
 * its own mark doesn't draw (connect writes a link row). Memoized per table.
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
