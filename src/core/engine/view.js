// @ts-check
import { collectEdits, resolveChannels } from '../../edit/route.js';
import { markCenter } from '../../edit/shared.js';
import { distanceToMark, hitTestAny } from '../../edit/pick.js';
import { fillBox } from '../../renderers/shared.js';
import { textBox } from '../measure.js';
import { fieldsOf } from '../schema.js';

/**
 * The chart's read surface: what is drawn and where, the scales, the edits a row
 * answers to, the chart's size and its pixel spaces. For UI built outside the
 * chart (the `ui` namespace, or anyone's own). Observation only: nothing here
 * writes, and every value handed out is a copy.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   features: any[],
 *   featureNodes: Record<string, any[]>,
 *   ui: any,
 *   container: HTMLElement,
 *   schemaSpec: import('../../types').SchemaSpec,
 *   tableOf: (feature: any) => any[],
 *   rowIndexOf: (name: string, i: number) => number,
 *   reportedIndexOf: (name: string, j: number) => number | null,
 *   frameScalesFor: (feature: any, node: any, index?: number | null) => import('../../types').ScaleMap | null,
 *   activeEdits: (feature: any) => import('../../types').Edit[],
 *   isLockedIn: (table: string) => ((d: any, i: number) => boolean) | null | undefined,
 *   selectionIn: (table: string) => Set<number>,
 *   portAvailable: (feature: any, node: any) => boolean,
 *   handleKey: (node: any) => string,
 *   visibleAt: (nodes: any[], x: number, y: number) => any[],
 * }} deps
 */
export function createView(chart, deps) {
    const {
        features, featureNodes, ui, container, schemaSpec, tableOf, rowIndexOf, reportedIndexOf,
        frameScalesFor, activeEdits, isLockedIn, selectionIn, portAvailable, handleKey, visibleAt,
    } = deps;

    // Does a mark name mean this feature? A mark's own id means that mark alone;
    // a glyph's id means every part of it ('sticker' -> 'sticker/body', its ports…).
    const ids = new Set(features.map((f) => f.id));
    /** @param {any} feature @param {string} mark */
    const named = (feature, mark) => (ids.has(mark) ? feature.id === mark : String(feature.id).startsWith(`${mark}/`));
    // Does this feature draw the dataset's rows?
    const drawsRows = (/** @type {any} */ f) => !f.views || f.views === 'data';
    // Nodes that are the engine's own (ghosts, overlays, hit targets), not the drawing.
    const internal = (/** @type {any} */ n) => !n || n.ghost || n.guide || n.effect || n.background || n.hit || n.rough;
    // Hidden by the state pass: an `onHover` node (a port, a link's end) at rest.
    const hidden = (/** @type {any} */ n) => !!(n.onHover && n.effectStyle && n.effectStyle.opacity === 0);

    /** @param {any} node @returns {{ x: number, y: number, width: number, height: number } | null} */
    const boxOf = (node) => {
        if (node.type === 'text') return textBox(node);
        if (node.type === 'line') {
            return {
                x: Math.min(node.x1, node.x2), y: Math.min(node.y1, node.y2),
                width: Math.abs(node.x2 - node.x1), height: Math.abs(node.y2 - node.y1),
            };
        }
        if (node.type === 'image' && node.width != null) return { x: node.x, y: node.y, width: node.width, height: node.height };
        return fillBox(node);
    };

    // Halfway along an open polyline (a link), by length.
    /** @param {number[][]} pts @returns {{ x: number, y: number } | null} */
    const midOf = (pts) => {
        if (pts.length < 2) return pts.length ? { x: pts[0][0], y: pts[0][1] } : null;
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        let left = total / 2;
        for (let i = 1; i < pts.length; i++) {
            const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            if (seg >= left && seg > 0) {
                const t = left / seg;
                return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t };
            }
            left -= seg;
        }
        return { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
    };

    /** @param {any} node @param {{ x: number, y: number, width: number, height: number } | null} box */
    const centerOf = (node, box) => {
        // An open path's box centre is off the line; its midpoint is on it.
        if (node.type === 'path' && !node.polygon && node.cx == null) {
            const pts = (node.points || []).filter((/** @type {any} */ p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
            if (pts.length) return midOf(pts);
            // A curve with no polyline: where its label and editor sit.
            const e = node.editBox;
            if (e) return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
        }
        const c = markCenter(node);
        if (c && node.type !== 'text') return { x: c.cx, y: c.cy };
        if (box) return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        return c ? { x: c.cx, y: c.cy } : null;
    };

    /** @param {any} feature @param {any} node @returns {import('../../types').SceneView} */
    const viewOf = (feature, node) => {
        const rows = drawsRows(feature) && feature.table != null;
        const box = boxOf(node);
        const key = handleKey(node);
        const sameHandle = (/** @type {any} */ s) => !!s && s.featureId === feature.id && s.index === node.index;
        return {
            mark: feature.id,
            table: rows ? feature.table : null,
            index: rows && node.index != null ? reportedIndexOf(feature.table, node.index) : null,
            type: node.type,
            channel: node.channel != null ? node.channel : null,
            side: node.side != null ? node.side : null,
            box,
            center: centerOf(node, box),
            angle: node.angle || 0,
            // A copy, cloned when read.
            get datum() {
                const d = rows && node.index != null ? tableOf(feature)[node.index] : node.data;
                return d == null ? null : structuredClone(d);
            },
            hovered: sameHandle(ui.hover) && handleKey(ui.hover.node) === key,
            selected: rows && node.index != null && selectionIn(feature.table).has(node.index),
            grabbed: sameHandle(ui.grab) && ui.grab.handle === key,
            visible: !hidden(node),
            editable: !!node.editable,
            locked: !!node.locked,
        };
    };

    // The live nodes a query names, with their features, in paint order.
    /** @param {import('../../types').SceneQuery} [query] @returns {{ feature: any, node: any }[]} */
    const find = (query = {}) => {
        /** @type {{ feature: any, node: any }[]} */
        const out = [];
        for (const feature of features) {
            if (query.mark != null && !named(feature, query.mark)) continue;
            if (query.table != null && feature.table !== query.table) continue;
            const row = query.index != null && feature.table != null ? rowIndexOf(feature.table, query.index) : null;
            for (const node of featureNodes[feature.id] || []) {
                if (internal(node)) continue;
                if (query.index != null && (!drawsRows(feature) || node.index !== row)) continue;
                if (query.channel != null && node.channel !== query.channel) continue;
                if (query.side != null && node.side !== query.side) continue;
                out.push({ feature, node });
            }
        }
        return out;
    };

    /** @param {import('../../types').SceneQuery} [query] */
    const scene = (query) => find(query).map(({ feature, node }) => viewOf(feature, node));

    // How far a point is from a node: 0 on it. A rect and a text are measured to
    // their box on both axes (a rect's pick distance runs along its band only).
    /** @param {any} node @param {number} x @param {number} y */
    const distanceTo = (node, x, y) => {
        if (node.type === 'rect' || node.type === 'text' || node.type === 'image') {
            const b = boxOf(node);
            if (!b) return Infinity;
            const dx = Math.max(b.x - x, 0, x - (b.x + b.width));
            const dy = Math.max(b.y - y, 0, y - (b.y + b.height));
            return Math.hypot(dx, dy);
        }
        const d = distanceToMark(node, x, y);
        if (node.type === 'circle') return Math.max(0, d - (node.r != null ? node.r : 5));
        return d;
    };

    // What is drawn at a point: the topmost visible node there, else with `reach`
    // the nearest one within it.
    /** @param {{ x: number, y: number }} point @param {{ reach?: number }} [options] */
    const hit = (point, options = {}) => {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        const { x, y } = point;
        const reach = options && options.reach != null && options.reach > 0 ? options.reach : 0;
        /** @type {{ feature: any, node: any, d: number } | null} */
        let near = null;
        for (let i = features.length - 1; i >= 0; i--) {
            const feature = features[i];
            const nodes = visibleAt(featureNodes[feature.id] || [], x, y).filter((n) => !internal(n) && !hidden(n));
            const on = hitTestAny(nodes, x, y);
            if (on) return viewOf(feature, on);
            if (!reach) continue;
            for (let j = nodes.length - 1; j >= 0; j--) {
                if (nodes[j].index == null) continue;
                const d = distanceTo(nodes[j], x, y);
                if (d <= reach && (!near || d < near.d)) near = { feature, node: nodes[j], d };
            }
        }
        return near ? viewOf(near.feature, near.node) : null;
    };

    // A channel's scale as plain functions and capability flags. Read off the
    // mark that encodes it (the first that binds a field there), or the chart's
    // shared scale when no mark is named. A snapshot: read it again after a render.
    /** @param {string} channel @param {{ mark?: string, index?: number }} [options] */
    const scale = (channel, options = {}) => {
        const { mark, index } = options || {};
        const binds = (/** @type {any} */ f) => !!(f.channels && f.channels[channel] && f.channels[channel].field != null);
        const feature = features.find((f) => drawsRows(f) && binds(f) && (mark == null || named(f, mark))) || null;
        if (mark != null && !feature) return null;
        const row = feature && index != null && feature.table != null ? rowIndexOf(feature.table, index) : null;
        const scales = (feature && frameScalesFor(feature, null, row)) || chart.scales;
        const resolved = feature ? resolveChannels([channel], feature.channels || {}, scales, feature)[0] : null;
        const s = /** @type {any} */ (resolved ? resolved.scale : scales[channel]);
        const field = resolved ? resolved.field : (s && s.fields ? s.fields[0] : null);
        if (!s && field == null) return null;
        const fieldSpec = feature && field != null ? fieldsOf(schemaSpec, feature.table)[field] : null;
        const invertible = !!(s && s.invertible);
        return {
            channel,
            field: field != null ? field : null,
            table: feature ? feature.table : null,
            encode: s ? (/** @type {any} */ v) => s.encode(v) : null,
            invert: invertible ? (/** @type {number} */ px) => s.invertValue(px) : null,
            domain: (s && typeof s.domain === 'function' ? [...s.domain()] : null)
                || (fieldSpec && fieldSpec.domain ? [...fieldSpec.domain] : null),
            range: s && typeof s.range === 'function' ? [...s.range()] : null,
            kind: s ? s.kind : null,
            temporal: !!(s && s.temporal),
            invertible,
        };
    };

    // The edits the marks declare, and whether each can run now. A query narrows
    // them to a mark, a table, a row or one of the row's handles.
    /** @param {import('../../types').SceneQuery} [query] @returns {import('../../types').EditInfo[]} */
    const edits = (query = {}) => {
        /** @type {import('../../types').EditInfo[]} */
        const out = [];
        for (const feature of features) {
            if (query.mark != null && !named(feature, query.mark)) continue;
            if (query.table != null && feature.table !== query.table) continue;
            const declared = collectEdits(feature);
            if (!declared.length) continue;
            const live = activeEdits(feature);
            const row = query.index != null && feature.table != null ? rowIndexOf(feature.table, query.index) : null;
            const own = row == null ? [] : (featureNodes[feature.id] || []).filter((n) => !internal(n) && n.index === row
                && (query.channel == null || n.channel === query.channel)
                && (query.side == null || n.side === query.side));
            // A row or handle the mark does not draw has no edits here.
            if (query.index != null && !own.length) continue;
            const locked = row != null && own.some((n) => n.locked);
            const lockedIn = feature.table != null ? isLockedIn(feature.table) : null;
            const datum = row != null ? tableOf(feature)[row] : null;
            for (const edit of declared) {
                const grabs = typeof edit.grabs === 'function' ? edit.grabs : null;
                const node = grabs ? own.find((n) => /** @type {any} */ (grabs)(n)) : own[0];
                if (row != null && grabs && !node) continue;
                // `activeEdits` holds copies of the same edits, told apart by `apply`.
                let available = live.some((e) => e.apply === edit.apply && e.name === edit.name)
                    && !(row != null && (locked || (lockedIn && datum && lockedIn(datum, row))));
                // A port takes a link only if one could land somewhere.
                if (available && node && node.portRole) available = node.portRole !== 'in' && portAvailable(feature, node);
                const resolved = resolveChannels(edit.channels || [], feature.channels || {}, chart.scales, feature);
                out.push({
                    name: edit.name != null ? edit.name : null,
                    type: edit.type,
                    gesture: edit.gesture,
                    pick: /** @type {string} */ (edit.pick),
                    channels: [...(edit.channels || [])],
                    fields: resolved.map((c) => c.field),
                    mark: feature.id,
                    table: feature.table != null ? feature.table : null,
                    cardinality: edit.cardinality || null,
                    available,
                });
            }
        }
        return out;
    };

    // The element the renderer draws into: the container's first svg or canvas.
    const surface = () => {
        for (const el of Array.from(container.children || [])) {
            const tag = String(el.tagName).toLowerCase();
            if (tag === 'svg' || tag === 'canvas') return el;
        }
        return null;
    };
    // The drawing's box on the page and how far CSS stretches it (`responsive: 'scale'`).
    const frame = () => {
        const el = surface();
        const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        return {
            left: rect.left, top: rect.top,
            sx: rect.width ? rect.width / chart.curW : 1,
            sy: rect.height ? rect.height / chart.curH : 1,
        };
    };

    const metrics = () => ({
        width: chart.curW,
        height: chart.curH,
        margins: { ...chart.effectiveMargins },
        innerWidth: chart.innerWidth,
        innerHeight: chart.innerHeight,
        scale: frame().sx,
    });

    // Viewport pixels (a pointer event's clientX/clientY) -> inner chart pixels.
    /** @param {{ x: number, y: number }} point */
    const toInner = (point) => {
        const f = frame();
        return {
            x: (point.x - f.left) / f.sx - chart.effectiveMargins.left,
            y: (point.y - f.top) / f.sy - chart.effectiveMargins.top,
        };
    };
    // Inner chart pixels -> viewport pixels.
    /** @param {{ x: number, y: number }} point */
    const toClient = (point) => {
        const f = frame();
        return {
            x: (point.x + chart.effectiveMargins.left) * f.sx + f.left,
            y: (point.y + chart.effectiveMargins.top) * f.sy + f.top,
        };
    };

    return { scene, hit, scale, edits, metrics, toInner, toClient };
}
