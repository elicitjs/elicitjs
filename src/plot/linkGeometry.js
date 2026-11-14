// @ts-check
// linkGeometry.js — the shapes a link can take between its two endpoints.
//
// One table keyed by kind: a new connector style is a row here, never a branch in
// link's build(). Each row is `{ anchors, build }`; `build(seg, bow, opts)` returns
//
//   { d?, points?, curve?, hit?, start, end, mid, tangentIn, tangentOut }
//
//   anchors: 'chord'  `seg` is already inset along the chord.
//   anchors: 'box'    `seg` is the two node centres, with the boxes in `opts`; the
//                     shape picks its own anchors on the box edges.
//
// `start`/`end` are the shape's own endpoints, where arrowheads and handles go;
// `mid` is where the label sits; the tangents are unit vectors arrowheads point
// down. Prefer `points`: only polylines are pickable and canvas-drawable, so a `d`
// shape also returns a sampled `hit` polyline (plot/hitpath.js).
//
// `bow` is a signed apex offset as a fraction of the chord (as in plot/curve.js);
// 0 is straight.

import { sampleQuadratic, sampleCubic } from './hitpath.js';
import { routeOrthogonal, SIDE_NORMALS, LINK_SIDES } from './linkRouter.js';

// How many segments a rounded corner is sampled into.
const CORNER_SAMPLES = 6;

// Re-exported from the router so a mark imports its link vocabulary from here.
export { LINK_SIDES };

/**
 * @typedef {object} LinkShape
 * @property {string} [d] authored SVG path
 * @property {[number, number][]} [points] polyline the renderer interpolates
 * @property {string} [curve] d3 curve name for `points`
 * @property {[number, number][]} [hit] sampled polyline for the grab path
 * @property {{ x: number, y: number }} start the shape's own source endpoint
 * @property {{ x: number, y: number }} end the shape's own target endpoint
 * @property {{ x: number, y: number }} mid where a label sits
 * @property {{ x: number, y: number }} tangentIn unit vector into the source end
 * @property {{ x: number, y: number }} tangentOut unit vector out of the target end
 */

/**
 * @typedef {object} LinkSegment
 * @property {number} x1 @property {number} y1
 * @property {number} x2 @property {number} y2
 */

/**
 * A node's rectangle in scene coordinates, as centre plus half-extents.
 * @typedef {object} LinkBox
 * @property {number} cx @property {number} cy
 * @property {number} hw @property {number} hh
 */

/**
 * @typedef {object} LinkShapeOptions
 * @property {number} [loopRadius] how far a self-loop reaches from its node
 * @property {number} [cornerRadius] corner rounding for the routed kinds
 * @property {LinkBox} [source] the source node's box (box-anchored kinds)
 * @property {LinkBox} [target] the target node's box
 * @property {number} [sourceGap] clearance from the source edge, in px
 * @property {number} [targetGap] clearance from the target edge, in px
 * @property {string | null} [sourceSide] a named edge, or null/'auto' to slide; shorthand for `sourcePort.side`
 * @property {string | null} [targetSide] a named edge, or null/'auto' to slide
 * @property {import('./linkRouter.js').LinkPort} [sourcePort] where the route leaves the source box
 * @property {import('./linkRouter.js').LinkPort} [targetPort] where it enters the target box
 * @property {{ x: number, y: number }} [sourceNormal] a pinned source edge's outward normal, for a curved kind's tangent
 * @property {{ x: number, y: number }} [targetNormal] a pinned target edge's outward normal
 * @property {LinkBox[]} [obstacles] every node box in the chart, for a routed kind to avoid
 * @property {string} [loopOut] the edge a self-loop leaves by (`loopSides`)
 * @property {string} [loopIn] the edge a self-loop returns by
 * @property {number} [nest] how many loops sit inside this one on its edge
 * @property {import('./linkRouter.js').RoutingGrid} [grid] the chart's routing grid, for detours
 */

/**
 * A unit vector, guarding the degenerate zero-length case.
 * @param {number} dx @param {number} dy
 * @returns {{ x: number, y: number }}
 */
function unit(dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
}

/**
 * The straight-chord tangent, shared by every kind whose ends run along the chord.
 * @param {LinkSegment} seg
 * @returns {{ x: number, y: number }}
 */
function chordTangent(seg) {
    return unit(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

/**
 * A straight line, as `points`.
 * @param {LinkSegment} seg
 * @returns {LinkShape}
 */
function lineShape(seg) {
    const t = chordTangent(seg);
    return {
        points: [[seg.x1, seg.y1], [seg.x2, seg.y2]],
        curve: 'linear',
        start: { x: seg.x1, y: seg.y1 },
        end: { x: seg.x2, y: seg.y2 },
        mid: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 },
        tangentIn: t,
        tangentOut: t,
    };
}

/**
 * An elbow connector, as an explicit polyline. The jog sits `0.5 + bow` of the way
 * across (not d3's fixed midpoint), so separated pairs don't overlap.
 *
 *   step         out along x, jog, in along x   (the jog is what `bow` moves)
 *   stepAfter    all the way along x, then y
 *   stepBefore   along y first, then x
 *
 * The pinned variants ignore `bow`. Tangents are axis-aligned, so arrowheads sit square.
 * @param {string} name
 * @returns {(seg: LinkSegment, bow: number) => LinkShape}
 */
function stepShape(name) {
    return (seg, bow) => {
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const sx = Math.sign(dx) || 1;
        const sy = Math.sign(dy) || 1;
        const horizontal = { x: sx, y: 0 };
        const vertical = { x: 0, y: sy };

        /** @type {[number, number][]} */
        let points;
        /** @type {{ x: number, y: number }} */
        let tangentIn;
        /** @type {{ x: number, y: number }} */
        let tangentOut;

        if (name === 'stepAfter') {
            points = [[seg.x1, seg.y1], [seg.x2, seg.y1], [seg.x2, seg.y2]];
            tangentIn = horizontal;
            tangentOut = vertical;
        } else if (name === 'stepBefore') {
            points = [[seg.x1, seg.y1], [seg.x1, seg.y2], [seg.x2, seg.y2]];
            tangentIn = vertical;
            tangentOut = horizontal;
        } else {
            // Keep the jog inside the span.
            const t = Math.min(0.85, Math.max(0.15, 0.5 + bow));
            const xm = seg.x1 + dx * t;
            points = [[seg.x1, seg.y1], [xm, seg.y1], [xm, seg.y2], [seg.x2, seg.y2]];
            tangentIn = horizontal;
            tangentOut = horizontal;
        }

        return {
            points,
            curve: 'linear',
            start: { x: seg.x1, y: seg.y1 },
            end: { x: seg.x2, y: seg.y2 },
            mid: { x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2 },
            tangentIn,
            tangentOut,
        };
    };
}

/**
 * A quadratic bowed to one side.
 * @param {LinkSegment} seg
 * @param {number} bow
 * @returns {LinkShape}
 */
function arcShape(seg, bow) {
    const mx = (seg.x1 + seg.x2) / 2;
    const my = (seg.y1 + seg.y2) / 2;
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    // Control point offset along the chord's normal.
    const cx = mx - dy * bow;
    const cy = my + dx * bow;
    return {
        d: `M${seg.x1},${seg.y1}Q${cx},${cy} ${seg.x2},${seg.y2}`,
        hit: sampleQuadratic([seg.x1, seg.y1], [cx, cy], [seg.x2, seg.y2]),
        start: { x: seg.x1, y: seg.y1 },
        end: { x: seg.x2, y: seg.y2 },
        // The curve's point at t=0.5, so the label sits on the line.
        mid: { x: 0.25 * seg.x1 + 0.5 * cx + 0.25 * seg.x2, y: 0.25 * seg.y1 + 0.5 * cy + 0.25 * seg.y2 },
        tangentIn: unit(cx - seg.x1, cy - seg.y1),
        tangentOut: unit(seg.x2 - cx, seg.y2 - cy),
    };
}

/**
 * A cubic S-curve whose tangents leave both ends along the chord's dominant axis
 * (or a pinned edge's normal). A `bow` of 0 is still a curve.
 * @param {LinkSegment} seg
 * @param {number} bow
 * @param {LinkShapeOptions} [opts] `sourceNormal`/`targetNormal` for a pinned end
 * @returns {LinkShape}
 */
function bezierShape(seg, bow, opts = {}) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    // Control-point reach: half the dominant span, stretched by `bow`.
    const reach = (horizontal ? Math.abs(dx) : Math.abs(dy)) * (0.5 + Math.abs(bow));
    // A pinned end leaves perpendicular to its edge.
    const nA = opts.sourceNormal;
    const nB = opts.targetNormal;
    // A pinned edge facing away from the other end gets a short arm, so it doesn't loop.
    const chord = Math.hypot(dx, dy);
    const armOf = (/** @type {number} */ toward) =>
        (toward < 0 ? Math.min(reach, Math.max(20, chord * 0.2)) : reach);
    const armA = nA ? armOf(nA.x * dx + nA.y * dy) : reach;
    const armB = nB ? armOf(-(nB.x * dx + nB.y * dy)) : reach;
    const c1 = nA
        ? [seg.x1 + nA.x * armA, seg.y1 + nA.y * armA]
        : horizontal
            ? [seg.x1 + Math.sign(dx || 1) * reach, seg.y1]
            : [seg.x1, seg.y1 + Math.sign(dy || 1) * reach];
    const c2 = nB
        ? [seg.x2 + nB.x * armB, seg.y2 + nB.y * armB]
        : horizontal
            ? [seg.x2 - Math.sign(dx || 1) * reach, seg.y2]
            : [seg.x2, seg.y2 - Math.sign(dy || 1) * reach];
    const p1 = /** @type {[number, number]} */ ([seg.x1, seg.y1]);
    const p2 = /** @type {[number, number]} */ ([seg.x2, seg.y2]);
    const cc1 = /** @type {[number, number]} */ (c1);
    const cc2 = /** @type {[number, number]} */ (c2);
    return {
        d: `M${seg.x1},${seg.y1}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${seg.x2},${seg.y2}`,
        hit: sampleCubic(p1, cc1, cc2, p2),
        start: { x: seg.x1, y: seg.y1 },
        end: { x: seg.x2, y: seg.y2 },
        // A cubic at t=0.5.
        mid: {
            x: 0.125 * seg.x1 + 0.375 * c1[0] + 0.375 * c2[0] + 0.125 * seg.x2,
            y: 0.125 * seg.y1 + 0.375 * c1[1] + 0.375 * c2[1] + 0.125 * seg.y2,
        },
        tangentIn: unit(c1[0] - seg.x1, c1[1] - seg.y1),
        tangentOut: unit(seg.x2 - c2[0], seg.y2 - c2[1]),
    };
}

/** How far past a loop's apex its label's centre sits, in px. */
const LOOP_LABEL_GAP = 12;

/**
 * A self-loop, used whenever a row's source and target are the same node. With a
 * box and `loopOut`/`loopIn` (from `loopSides`) it docks on the node: a teardrop
 * off one edge, or an elbow around the node between two edges. Each `nest` pushes
 * it 60% of `radius` further out. With no box, a teardrop above the centre, its
 * side following the bow's sign.
 * @param {LinkSegment} seg the node centre (`x1`/`y1`)
 * @param {number} bow
 * @param {number} radius how far the loop reaches from the node, in px
 * @param {LinkShapeOptions} [opts]
 * @returns {LinkShape}
 */
function loopShape(seg, bow, radius, opts = {}) {
    const box = opts.source;
    const R = radius * (1 + 0.6 * (opts.nest || 0));
    if (!box || !opts.loopOut) {
        const x = seg.x1;
        const y = seg.y1;
        const dir = bow < 0 ? -1 : 1;
        const w = R * 0.9;
        const h = R * 1.8 * dir;
        const c1 = /** @type {[number, number]} */ ([x - w, y - h]);
        const c2 = /** @type {[number, number]} */ ([x + w, y - h]);
        const p = /** @type {[number, number]} */ ([x, y]);
        return {
            d: `M${x},${y}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x},${y}`,
            hit: sampleCubic(p, c1, c2, p),
            start: { x, y },
            end: { x, y },
            mid: { x, y: y - h * 0.75 },
            tangentIn: unit(c1[0] - x, c1[1] - y),
            tangentOut: unit(x - c2[0], y - c2[1]),
        };
    }
    const out = opts.loopOut;
    const back = opts.loopIn || out;
    const gapA = opts.sourceGap || 0;
    const gapB = opts.targetGap || 0;
    const nA = SIDE_NORMALS[out];
    const nB = SIDE_NORMALS[back];

    if (out === back) {
        // A teardrop out and back along a short span of the edge, clockwise.
        const n = nA;
        const t = { x: -n.y, y: n.x };
        const edgeHalf = n.x ? box.hh : box.hw;
        const h = Math.min(R * 0.35, edgeHalf * 0.8);
        const mx = box.cx + n.x * box.hw;
        const my = box.cy + n.y * box.hh;
        const a = /** @type {[number, number]} */ ([mx - t.x * h + n.x * gapA, my - t.y * h + n.y * gapA]);
        const b = /** @type {[number, number]} */ ([mx + t.x * h + n.x * gapB, my + t.y * h + n.y * gapB]);
        const c1 = /** @type {[number, number]} */ ([mx + n.x * R * 1.8 - t.x * R * 0.9, my + n.y * R * 1.8 - t.y * R * 0.9]);
        const c2 = /** @type {[number, number]} */ ([mx + n.x * R * 1.8 + t.x * R * 0.9, my + n.y * R * 1.8 + t.y * R * 0.9]);
        return {
            d: `M${a[0]},${a[1]}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${b[0]},${b[1]}`,
            hit: sampleCubic(a, c1, c2, b),
            start: { x: a[0], y: a[1] },
            end: { x: b[0], y: b[1] },
            // Past the apex, since a label plate on the apex would hide the loop.
            mid: { x: mx + n.x * (R * 1.35 + LOOP_LABEL_GAP), y: my + n.y * (R * 1.35 + LOOP_LABEL_GAP) },
            tangentIn: unit(c1[0] - a[0], c1[1] - a[1]),
            tangentOut: unit(b[0] - c2[0], b[1] - c2[1]),
        };
    }

    // Two edges: walk the box's outline, `R` out, the shorter way round; between
    // opposite edges, over the top (or, top↔bottom, round the right).
    const i = LINK_SIDES.indexOf(out);
    const j = LINK_SIDES.indexOf(back);
    const cw = (j - i + 4) % 4;
    const passes = (/** @type {number} */ dir) => {
        const seen = [];
        for (let k = i; k !== j; k = (k + dir + 4) % 4) seen.push(LINK_SIDES[(k + dir + 4) % 4]);
        return seen;
    };
    let dir = cw < 2 ? 1 : cw > 2 ? -1 : 0;
    if (!dir) {
        const viaCw = passes(1);
        dir = viaCw.includes('top') || (!passes(-1).includes('top') && viaCw.includes('right')) ? 1 : -1;
    }
    const L = box.cx - box.hw - R;
    const Rx = box.cx + box.hw + R;
    const T = box.cy - box.hh - R;
    const B = box.cy + box.hh + R;
    /** @type {Record<string, [number, number]>} the corner clockwise AFTER each side */
    const cornerAfter = { top: [Rx, T], right: [Rx, B], bottom: [L, B], left: [L, T] };
    const ax = box.cx + nA.x * box.hw;
    const ay = box.cy + nA.y * box.hh;
    const bx = box.cx + nB.x * box.hw;
    const by = box.cy + nB.y * box.hh;
    /** @type {[number, number][]} */
    const pts = [[ax + nA.x * gapA, ay + nA.y * gapA], [ax + nA.x * R, ay + nA.y * R]];
    for (let k = i; k !== j; k = (k + dir + 4) % 4) {
        const side = dir > 0 ? LINK_SIDES[k] : LINK_SIDES[(k + 3) % 4];
        pts.push(cornerAfter[side]);
    }
    pts.push([bx + nB.x * R, by + nB.y * R], [bx + nB.x * gapB, by + nB.y * gapB]);
    const points = roundCorners(pts, Number(opts.cornerRadius) || R * 0.4);
    const first = pts[0];
    const last = pts[pts.length - 1];
    return {
        points,
        curve: 'linear',
        start: { x: first[0], y: first[1] },
        end: { x: last[0], y: last[1] },
        mid: polylineMid(points),
        tangentIn: nA,
        tangentOut: { x: -nB.x || 0, y: -nB.y || 0 },
    };
}

// ── The routed connector ────────────────────────────────────────────────────
// linkRouter.js picks the route; this turns its polyline into a shape.

/**
 * Replace each interior vertex with a sampled quadratic, keeping a polyline. Each
 * leg gives up at most half its length, so corners never overshoot.
 * @param {[number, number][]} points
 * @param {number} r
 * @returns {[number, number][]}
 */
function roundCorners(points, r) {
    if (!(r > 0) || points.length < 3) return points;
    /** @type {[number, number][]} */
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const a = points[i - 1];
        const v = points[i];
        const b = points[i + 1];
        const d1 = Math.hypot(v[0] - a[0], v[1] - a[1]);
        const d2 = Math.hypot(b[0] - v[0], b[1] - v[1]);
        const t1 = Math.min(r, d1 / 2);
        const t2 = Math.min(r, d2 / 2);
        if (!d1 || !d2) { out.push(v); continue; }
        /** @type {[number, number]} */
        const c1 = [v[0] + ((a[0] - v[0]) / d1) * t1, v[1] + ((a[1] - v[1]) / d1) * t1];
        /** @type {[number, number]} */
        const c2 = [v[0] + ((b[0] - v[0]) / d2) * t2, v[1] + ((b[1] - v[1]) / d2) * t2];
        for (const p of sampleQuadratic(c1, v, c2, CORNER_SAMPLES)) out.push(p);
    }
    out.push(points[points.length - 1]);
    return out;
}

/**
 * The point half a polyline's length along it, where a routed link's label goes.
 * @param {[number, number][]} points
 * @returns {{ x: number, y: number }}
 */
function polylineMid(points) {
    /** @type {number[]} */
    const legs = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        const len = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
        legs.push(len);
        total += len;
    }
    let left = total / 2;
    for (let i = 0; i < legs.length; i++) {
        if (left <= legs[i] || i === legs.length - 1) {
            const t = legs[i] ? left / legs[i] : 0;
            return {
                x: points[i][0] + (points[i + 1][0] - points[i][0]) * t,
                y: points[i][1] + (points[i + 1][1] - points[i][1]) * t,
            };
        }
        left -= legs[i];
    }
    return { x: points[0][0], y: points[0][1] };
}

/**
 * A port from the options: `sourcePort`/`targetPort`, else the side alone at the midpoint.
 * @param {import('./linkRouter.js').LinkPort | undefined} port
 * @param {string | null | undefined} side
 * @returns {import('./linkRouter.js').LinkPort}
 */
function portOf(port, side) {
    const norm = (/** @type {any} */ s) => (s && s !== 'auto' ? String(s) : null);
    if (port) return { side: norm(port.side), offset: +port.offset || 0 };
    return { side: norm(side), offset: 0 };
}

/**
 * The box-anchored orthogonal connector, routed by `routeOrthogonal`: it leaves
 * each node perpendicular to an edge. `bow` slides the two ports in opposite
 * directions along their edges, so siblings splay apart.
 * @param {LinkSegment} seg the two node centres
 * @param {number} bow
 * @param {LinkShapeOptions} opts
 * @returns {LinkShape | null}
 */
function orthogonalShape(seg, bow, opts) {
    const A = opts.source || { cx: seg.x1, cy: seg.y1, hw: 0, hh: 0 };
    const B = opts.target || { cx: seg.x2, cy: seg.y2, hw: 0, hh: 0 };
    const sourcePort = portOf(opts.sourcePort, opts.sourceSide);
    const targetPort = portOf(opts.targetPort, opts.targetSide);
    const route = routeOrthogonal({
        source: { box: A, port: { side: sourcePort.side, offset: sourcePort.offset + bow } },
        target: { box: B, port: { side: targetPort.side, offset: targetPort.offset - bow } },
        sourceGap: opts.sourceGap || 0,
        targetGap: opts.targetGap || 0,
        obstacles: opts.obstacles,
        grid: opts.grid,
    });
    if (!route) return null;

    const points = roundCorners(route.points, Number(opts.cornerRadius) || 0);
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    const nA = SIDE_NORMALS[route.sourceSide];
    const nB = SIDE_NORMALS[route.targetSide];
    return {
        points,
        curve: 'linear',
        start: { x: first[0], y: first[1] },
        end: { x: last[0], y: last[1] },
        mid: polylineMid(points),
        // Along the edge normals, so arrowheads sit square on the edges.
        tangentIn: nA,
        tangentOut: { x: -nB.x || 0, y: -nB.y || 0 },
    };
}

/**
 * The link shapes, keyed by kind. `smooth` builds the same shape as `bezier`;
 * `loop` is used only for a row referencing one node twice.
 *
 * `anchors` says what the `seg` passed to `build` means: `'chord'`, the chord already
 * inset; `'box'`, the two node centres, with the boxes in `opts`.
 * @type {Record<string, { anchors: string, build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null }>}
 */
export const LINK_SHAPES = {
    line: { anchors: 'chord', build: (seg) => lineShape(seg) },
    step: { anchors: 'chord', build: stepShape('step') },
    stepBefore: { anchors: 'chord', build: stepShape('stepBefore') },
    stepAfter: { anchors: 'chord', build: stepShape('stepAfter') },
    orthogonal: { anchors: 'box', build: orthogonalShape },
    arc: { anchors: 'chord', build: (seg, bow) => arcShape(seg, bow) },
    bezier: { anchors: 'chord', build: (seg, bow, opts) => bezierShape(seg, bow, opts) },
    smooth: { anchors: 'chord', build: (seg, bow, opts) => bezierShape(seg, bow, opts) },
    loop: { anchors: 'chord', build: (seg, bow, opts) => loopShape(seg, bow, opts.loopRadius || 0, opts) },
};

/** The kinds an author may name, for the dev warning on an unknown one. */
export const LINK_CURVES = Object.keys(LINK_SHAPES).filter((k) => k !== 'loop');
