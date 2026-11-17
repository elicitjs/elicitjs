// @ts-check
// carry.js — the node motion client: a mark with `motion: true` eases its drawn
// nodes to where `build()` puts them, and the row in the hand is drawn at the
// pointer.
//
// It runs after every feature is built and before anything reads the nodes, so
// hit-testing, effects and both renderers see one geometry. The data is never
// eased: a discrete column has no value between two slots, which is why this
// client works in pixels on nodes and not on rows.

import { easeNodes, geometryOf } from '../motion.js';
import { placeShape } from '../../plot/shapes.js';
import { resolveChannels } from '../../edit/route.js';
import { axisOf } from '../encoding.js';
import { isDiscrete, positionOnScale } from '../scales.js';
import { markCenter } from '../../edit/shared.js';
import { warn } from '../dev.js';

/**
 * @typedef {object} NodeMotionDeps
 * @property {import('../motion.js').Motion | null} motion  the chart's clock, or null when motion is off
 * @property {any[]} features
 * @property {Map<string, any>} featureById
 * @property {any} ui
 * @property {Record<string, any[]>} featureNodes
 * @property {(feature: any) => import('../../types').Edit[]} activeEdits
 * @property {(node: any) => string} handleKey
 * @property {import('../../types').SchemaSpec} schemaSpec
 */

/**
 * @param {import('./state.js').ChartState} chart
 * @param {NodeMotionDeps} deps
 */
export function createNodeMotion(chart, deps) {
    const { motion, features, featureById, ui, featureNodes, activeEdits, handleKey, schemaSpec } = deps;

    // A network's or hierarchy's node table: links dock from the rows, so they
    // would not follow an eased node.
    const nodesTable = schemaSpec && schemaSpec.byRole ? schemaSpec.byRole.nodes : null;

    /** Does this feature take part? @param {any} feature */
    const eases = (feature) => {
        if (!motion || !feature || feature.motion !== true) return false;
        if (feature.views && feature.views !== 'data') return false;
        if (nodesTable && feature.table === nodesTable) {
            warn(`motion:nodes:${feature.id}`,
                `mark "${feature.id}" sets motion: true over the "${nodesTable}" table of a ${schemaSpec.structure}. `
                + 'Links dock from the rows, so they would not follow an eased node; this mark is drawn at once.');
            return false;
        }
        return true;
    };
    const eased = features.filter(eases);

    /** The slot centres at the two ends of a discrete scale. @param {any} scale @returns {[number, number]} */
    const slotEnds = (scale) => {
        const domain = scale.domain();
        const a = positionOnScale(scale, domain[0], 0);
        const b = positionOnScale(scale, domain[domain.length - 1], a);
        return [Math.min(a, b), Math.max(a, b)];
    };

    /** A `shape` moved: bake its path at the new centre. @param {any} node */
    const redraw = (node) => {
        const { unit, r, angle } = node.placed;
        const { d, points } = placeShape(unit, node.cx, node.cy, r, angle);
        node.d = d;
        node.points = points;
    };

    /** @type {{ grab: any, scales: any, carry: { table: string, index: number, axes: Record<string, { field: string, scale: any }> } | null } | null} */
    let memo = null;
    /**
     * What the grab carries: the grabbed row, along each axis one of its drag edits
     * writes through a discrete scale. On a continuous axis the data already
     * follows the pointer, so there is nothing to carry.
     */
    const carryOf = () => {
        const grab = ui.grab;
        if (!motion || !grab || !grab.at) return null;
        if (memo && memo.grab === grab && memo.scales === chart.scales) return memo.carry;
        const feature = featureById.get(grab.featureId);
        /** @type {Record<string, { field: string, scale: any }>} */
        const axes = {};
        if (feature && eases(feature)) {
            for (const edit of activeEdits(feature)) {
                if (edit.pick !== 'direct' || edit.gesture !== 'drag' || !edit.inverts) continue;
                for (const ch of resolveChannels(edit.channels, feature.channels || {}, chart.scales, feature)) {
                    const axis = axisOf(ch.name);
                    if ((axis === 'x' || axis === 'y') && isDiscrete(ch.scale)) axes[axis] = { field: ch.field, scale: ch.scale };
                }
            }
        }
        const carry = Object.keys(axes).length ? { table: feature.table, index: grab.index, axes } : null;
        memo = { grab, scales: chart.scales, carry };
        return carry;
    };

    /** Does the drawing follow the pointer, so every drag tick must render? */
    const followsPointer = () => !!carryOf();

    /** Does `feature` draw `field` along `axis`? @param {any} feature @param {string} axis @param {string} field */
    const binds = (feature, axis, field) => Object.entries(feature.channels || {})
        .some(([name, spec]) => axisOf(name) === axis && spec && spec.field === field);

    /** Changes when pixels before and after are not comparable. @param {any} feature */
    const signature = (feature) => {
        const names = Object.keys(feature.channels || {});
        const parts = resolveChannels(names, feature.channels || {}, chart.scales, feature).map((ch) => {
            const s = /** @type {any} */ (ch.scale);
            if (!s) return `${ch.name}:`;
            if (isDiscrete(s)) return `${ch.name}:${s.domain().join('\u0001')}:${s.range().join(',')}`;
            if (s.invertible && typeof s.invertValue === 'function') return `${ch.name}:${s.invertValue(0)}:${s.invertValue(100)}`;
            return `${ch.name}:${String(s.domain && s.domain())}`;
        });
        return `${parts.join('|')}|${chart.innerWidth}|${chart.innerHeight}|${(chart.tables[feature.table] || []).length}`;
    };
    /** @type {Record<string, string>} */
    const signatures = {};

    // Rows that left the hand and are still on their way: they stay on top.
    /** @type {Set<string>} */
    let lifted = new Set();
    const rowKey = (/** @type {string} */ table, /** @type {number} */ index) => `${table}\u0000${index}`;

    /**
     * Ease every `motion` feature's nodes, in place.
     * @param {boolean} snapAll draw everything at once (data arrived from outside)
     */
    const apply = (snapAll) => {
        if (!motion || !eased.length) return;
        const carry = carryOf();
        const grab = ui.grab;
        const grabbed = grab ? featureById.get(grab.featureId) : null;

        // How far the carried row is drawn from its slot, per axis.
        /** @type {{ x?: number, y?: number } | null} */
        let delta = null;
        if (carry && grabbed) {
            const home = (featureNodes[grabbed.id] || []).find((n) => n && !n.ghost && handleKey(n) === grab.handle);
            const centre = markCenter(home);
            if (centre) {
                delta = {};
                for (const axis of /** @type {('x' | 'y')[]} */ (Object.keys(carry.axes))) {
                    const [lo, hi] = slotEnds(carry.axes[axis].scale);
                    const at = Math.min(Math.max(grab.at[axis] - grab.offset[axis], lo), hi);
                    delta[axis] = at - (axis === 'x' ? centre.cx : centre.cy);
                }
            }
        }

        /** @type {Set<string>} */
        const stillShort = new Set();
        for (const feature of eased) {
            const nodes = featureNodes[feature.id] || [];
            const sig = signature(feature);
            const snap = snapAll || signatures[feature.id] !== sig;
            signatures[feature.id] = sig;

            const stuck = nodes.find((n) => n && n.index != null && !geometryOf(n));
            if (stuck) {
                warn(`motion:path:${feature.id}`,
                    `mark "${feature.id}" sets motion: true but draws a ${stuck.type} per row, `
                    + 'which cannot be eased. It is drawn at once.');
            }

            // The carried row, in every motion mark that draws the edited column there.
            /** @type {{ x?: number, y?: number } | null} */
            let by = null;
            if (carry && delta && feature.table === carry.table) {
                for (const axis of /** @type {('x' | 'y')[]} */ (Object.keys(carry.axes))) {
                    if (delta[axis] !== undefined && binds(feature, axis, carry.axes[axis].field)) (by || (by = {}))[axis] = delta[axis];
                }
            }
            // What a pointer holds is never eased: the grabbed row, a proximity driver's row.
            const session = ui.session && ui.session[feature.id];
            const active = session && session.activeIndex != null ? session.activeIndex : null;
            const inHand = grabbed && grabbed.table === feature.table ? grab.index : null;

            /** @type {Map<string, number>} */
            const seen = new Map();
            const short = easeNodes(motion.track(`nodes:${feature.id}`), nodes, {
                // A mark may draw several nodes per row (a waffle's cells): count them.
                keyOf: (node) => {
                    const k = handleKey(node);
                    const n = seen.get(k) || 0;
                    seen.set(k, n + 1);
                    return `${k}\u0000${n}`;
                },
                snap,
                fixed: (node) => node.index != null && (node.index === inHand || node.index === active),
                shift: by ? (node) => (node.index === /** @type {any} */ (carry).index ? by : null) : undefined,
                redraw,
            });

            for (const node of nodes) {
                if (!node || node.index == null) continue;
                const key = rowKey(feature.table, node.index);
                const held = !!by && node.index === /** @type {any} */ (carry).index;
                if (held) lifted.add(key);
                if (held || short.has(node)) stillShort.add(key);
            }
        }
        // A carried row paints above what it passes, until it is home.
        lifted = new Set([...lifted].filter((key) => stillShort.has(key)));
        if (!lifted.size) return;
        for (const feature of eased) {
            for (const node of featureNodes[feature.id] || []) {
                if (node && node.index != null && lifted.has(rowKey(feature.table, node.index))) node.raise = true;
            }
        }
    };

    return { eases, followsPointer, apply };
}
