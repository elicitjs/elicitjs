// @ts-check
// linkGeometry.js — the SHAPES a link can take between its two endpoints.
//
// One table keyed by kind, the way `plot/stack.js` answers its two stack
// geometries: a new connector style is a ROW here, never a branch in link's
// build(). Each entry takes a segment plus a signed bow and returns a shape
// descriptor — the mark itself does no geometry.
//
//   { d?, points?, curve?, hit?, start, end, mid, tangentIn, tangentOut }
//
// ── A row DECLARES how it anchors ──────────────────────────────────────────
// An entry is `{ anchors, build }`, not a bare function, because the two families
// want different input:
//
//   anchors: 'chord'  the segment arrives already pulled in by `inset` along the
//                     chord. Every original kind — a line, an elbow, an arc — runs
//                     between two POINTS and needs nothing else.
//   anchors: 'box'    the segment arrives as the two node CENTRES, with each node's
//                     half-extents alongside. `orthogonal` computes its own anchors
//                     on the box edges and insets along the SIDE NORMAL, which a
//                     chord-radial trim cannot express — and it must still route
//                     when a chord inset would have consumed the whole segment.
//
// Reading that off the row is what keeps the decision out of link.build(): the mark
// asks the shape how to feed it rather than branching on the kind name, the same way
// a `Mark` declares `requires` instead of the engine testing for known mark names.
//
// `start`/`end` are the shape's OWN endpoints. A chord shape hands back the segment
// ends it was given; a box shape hands back the points it chose on the two edges.
// The mark draws arrowheads and endpoint handles there — before this it used the
// segment's ends with the shape's tangents, two things that disagree the moment a
// shape stops running along the chord (a step's arrowhead sat off the end of its own
// line for exactly that reason).
//
// `points` is preferred wherever it can express the shape, because a polyline both
// renderers already draw is also the ONLY geometry the pick layer can measure —
// so the straight and step kinds are hit-testable and canvas-drawable for free.
// The genuinely curved kinds emit `d` and hand back a sampled `hit` polyline
// instead (see plot/hitpath.js for why a `d`-only path is untouchable).
//
// `mid` is where a link's own label sits. `tangentIn`/`tangentOut` are unit
// vectors along the path at each end, which is what an arrowhead points down —
// before this the mark reconstructed the direction from a quadratic's control
// point inline, and every new shape would have needed its own version of that.
//
// ── Curvature is signed and dimensionless ───────────────────────────────────
// `bow` is an apex offset as a fraction of the chord, the same convention
// `plot/curve.js` uses. Positive bows one way, negative the other, and 0 is
// straight — which is what lets `link` flip the sign by direction so that A→B and
// B→A separate instead of drawing on top of each other.

import { sampleQuadratic, sampleCubic } from './hitpath.js';

// How many segments a rounded corner is sampled into. A corner spans a few px, so
// it needs nothing like a whole Bézier's resolution — but it goes through the same
// sampler, because two Bézier samplers is one too many.
const CORNER_SAMPLES = 6;

// The shortest leg a routed connector leaves a node by, in px. Long enough that the
// turn reads as deliberate rather than as a kink on the edge.
const MIN_STUB = 16;

// How far along its edge an anchor may slide when `bow` fans a parallel pair apart,
// as a fraction of that edge. Beyond this the connector leaves from a corner and
// stops reading as square-on.
const MAX_SLIDE = 0.4;

/** The four edges of a node box, and the sides an author may name. */
export const LINK_SIDES = ['top', 'right', 'bottom', 'left'];

/** @type {Record<string, { x: number, y: number }>} outward normal per side */
const SIDE_NORMALS = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
};

/** @type {Record<string, string>} */
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * @typedef {object} LinkShape
 * @property {string} [d] authored SVG path
 * @property {[number, number][]} [points] polyline the renderer interpolates
 * @property {string} [curve] d3 curve name for `points`
 * @property {[number, number][]} [hit] sampled polyline for the grab path
 * @property {{ x: number, y: number }} start the shape's own source endpoint
 * @property {{ x: number, y: number }} end the shape's own target endpoint
 * @property {{ x: number, y: number }} mid where a label sits
 * @property {{ x: number, y: number }} tangentIn unit vector INTO the source end
 * @property {{ x: number, y: number }} tangentOut unit vector OUT OF the target end
 */

/**
 * @typedef {object} LinkSegment
 * @property {number} x1 @property {number} y1
 * @property {number} x2 @property {number} y2
 */

/**
 * A node's rectangle, in scene coordinates. Half-extents rather than width/height
 * because every test here is "how far out from the centre".
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
 * @property {string} [sourceSide] a named edge, or 'auto'
 * @property {string} [targetSide] a named edge, or 'auto'
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
 * A straight line. Emitted as `points` rather than a `d` so the body is pickable
 * and canvas-drawable without a hit path of its own.
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
 * An orthogonal elbow: the flowchart connector. Emitted as an explicit `points`
 * polyline with `curve: 'linear'` rather than as two points under d3's step
 * interpolation, for one reason — d3's step always jogs at the exact midpoint, so
 * a reciprocal pair drew the SAME polyline reversed and lay perfectly on top of
 * each other. Here the jog is `0.5 + bow` of the way across, so the same
 * separation pass that fans arcs apart fans elbows apart too.
 *
 *   step         out along x, jog, in along x   (the jog is what `bow` moves)
 *   stepAfter    all the way along x, then y
 *   stepBefore   along y first, then x
 *
 * The two pinned variants need no bow: A→B turns at the target's corner and B→A at
 * the source's, so a reciprocal pair is already two different paths.
 *
 * Tangents are axis-aligned rather than along the chord, because a step arrives at
 * its endpoint square-on — an arrowhead pointed down the chord would sit askew to
 * the line it caps.
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
            // Keep the jog inside the span, so a large bow can't fold the elbow
            // back past an endpoint.
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
 * A quadratic bowed to one side — the original `curve: 'arc'`, unchanged in shape.
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
        // The apex of a quadratic at t=0.5, not the chord midpoint — a label on
        // the chord of a strongly bowed arc sits off the line entirely.
        mid: { x: 0.25 * seg.x1 + 0.5 * cx + 0.25 * seg.x2, y: 0.25 * seg.y1 + 0.5 * cy + 0.25 * seg.y2 },
        tangentIn: unit(cx - seg.x1, cy - seg.y1),
        tangentOut: unit(seg.x2 - cx, seg.y2 - cy),
    };
}

/**
 * A cubic S-curve whose tangents leave both endpoints along the DOMINANT axis of
 * the chord — the flowchart/node-graph connector. Unlike the arc it stays
 * symmetric about the chord, so a `bow` of 0 still reads as a curve rather than
 * collapsing to a line.
 * @param {LinkSegment} seg
 * @param {number} bow
 * @returns {LinkShape}
 */
function bezierShape(seg, bow) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    // How far the control points run out from each end. Half the dominant span is
    // the classic look; `bow` stretches it, so a fanned pair of siblings reads as
    // two distinct curves rather than one thick one.
    const reach = (horizontal ? Math.abs(dx) : Math.abs(dy)) * (0.5 + Math.abs(bow));
    const c1 = horizontal
        ? [seg.x1 + Math.sign(dx || 1) * reach, seg.y1]
        : [seg.x1, seg.y1 + Math.sign(dy || 1) * reach];
    const c2 = horizontal
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

/**
 * A self-loop: a cubic that leaves a node and comes back to it. Reached when a
 * row's source and target name the SAME node, whatever curve the spec asked for —
 * there is no sensible straight line between a point and itself, and the
 * alternative (drawing nothing) is what made a self-reference silently invisible.
 *
 * `seg` degenerates to a single point here, so the loop is built about it.
 * @param {LinkSegment} seg
 * @param {number} bow
 * @param {number} radius how far the loop reaches from the node, in px
 * @returns {LinkShape}
 */
function loopShape(seg, bow, radius) {
    const x = seg.x1;
    const y = seg.y1;
    // Sign follows the bow so two self-loops on one node separate like any other
    // parallel pair; magnitude is the loop's reach.
    const dir = bow < 0 ? -1 : 1;
    const w = radius * 0.9;
    const h = radius * 1.8 * dir;
    const c1 = /** @type {[number, number]} */ ([x - w, y - h]);
    const c2 = /** @type {[number, number]} */ ([x + w, y - h]);
    const p = /** @type {[number, number]} */ ([x, y]);
    return {
        d: `M${x},${y}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x},${y}`,
        hit: sampleCubic(p, c1, c2, p),
        start: { x, y },
        end: { x, y },
        mid: { x, y: y - h * 0.75 },
        // Out of the node toward the first control point, back in from the second.
        tangentIn: unit(c1[0] - x, c1[1] - y),
        tangentOut: unit(x - c2[0], y - c2[1]),
    };
}

// ── The routed connector ────────────────────────────────────────────────────

/**
 * Drop coincident points, then interior vertices that don't actually turn. Both
 * matter before rounding: a corner routine handed a straight-through vertex would
 * round a corner that isn't there, and one handed a zero-length leg divides by it.
 * @param {[number, number][]} points
 * @returns {[number, number][]}
 */
function simplify(points) {
    /** @type {[number, number][]} */
    const out = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last[0] - p[0]) < 0.01 && Math.abs(last[1] - p[1]) < 0.01) continue;
        out.push(p);
    }
    for (let i = out.length - 2; i >= 1; i--) {
        const a = out[i - 1];
        const v = out[i];
        const b = out[i + 1];
        const cross = (v[0] - a[0]) * (b[1] - a[1]) - (v[1] - a[1]) * (b[0] - a[0]);
        if (Math.abs(cross) < 0.01) out.splice(i, 1);
    }
    return out;
}

/**
 * Replace each interior vertex with a quadratic through it — the rounded elbow.
 *
 * The corner stays a POLYLINE rather than becoming an arc in a `d` string, which is
 * the whole reason this is affordable: `points` is the only geometry edit/pick.js
 * can measure and the only one canvas draws directly, so a rounded connector is
 * grabbable and canvas-safe for free. Each leg gives up at most half its length, so
 * a large radius on a short leg shortens the curve instead of overshooting the
 * neighbouring corner.
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
 * The point half a polyline's LENGTH along it. A routed connector's chord midpoint
 * can sit inside a node — a C-route's chord midpoint is nowhere near the line — so a
 * label and the inline editor that follows it go here instead.
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
 * Which edge of `from` faces `to`. The test is the true SEPARATION on each axis —
 * the centre delta less both half-extents — not the raw delta, because two wide
 * notes stacked with a small vertical offset are separated vertically and
 * overlapping horizontally, and it is the separated axis you want to route along.
 * With neither axis separated (the boxes overlap both ways) the larger delta wins.
 *
 * Symmetric by construction: `facingSide(B, A)` is the opposite of `facingSide(A, B)`,
 * which is what makes two `'auto'` ends agree on one axis without consulting
 * each other.
 * @param {LinkBox} from @param {LinkBox} to
 * @returns {string}
 */
function facingSide(from, to) {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const gapX = Math.abs(dx) - (from.hw + to.hw);
    const gapY = Math.abs(dy) - (from.hh + to.hh);
    if (gapX >= gapY) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'bottom' : 'top';
}

/**
 * Where a connector meets a box: the edge's midpoint, pushed OUT by `gap`, then slid
 * along the edge by `slide` (a fraction of that edge, the same signed `bow` every
 * other kind bends by). Sliding is what fans a parallel pair apart here — an
 * orthogonal route can't bow, so siblings would otherwise draw on top of each other.
 * @param {LinkBox} box @param {string} side @param {number} gap @param {number} slide
 * @returns {{ x: number, y: number }}
 */
function anchorOn(box, side, gap, slide) {
    const n = SIDE_NORMALS[side];
    const half = n.x ? box.hh : box.hw;
    const t = Math.max(-MAX_SLIDE, Math.min(MAX_SLIDE, slide)) * half * 2;
    return {
        x: box.cx + n.x * (box.hw + gap) + -n.y * t,
        y: box.cy + n.y * (box.hh + gap) + n.x * t,
    };
}

/**
 * Is `to` on the outward side of `from` along `n`?
 * @param {{x:number,y:number}} from @param {{x:number,y:number}} to @param {{x:number,y:number}} n
 */
function ahead(from, to, n) {
    return (to.x - from.x) * n.x + (to.y - from.y) * n.y > 0;
}

/**
 * Join the two stub ends with axis-aligned legs. Four cases, decided by how the two
 * side NORMALS relate — not by where the nodes are, which the sides already encode:
 *
 *   opposite, with room     a Z, jogging halfway between the stubs
 *   opposite, without room  a C, detouring past both boxes on the other axis
 *   the same side           a C on that axis, out past the further stub
 *   perpendicular           an L, at whichever of the two corners lies ahead of both
 *
 * `'auto'` sides only ever produce the first two. The other two become reachable the
 * moment a spec pins a side, so all four ship together.
 * @param {{x:number,y:number}} p0 @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p3 @param {{x:number,y:number}} p4
 * @param {{x:number,y:number}} nA @param {{x:number,y:number}} nB
 * @param {LinkBox} A @param {LinkBox} B @param {number} stub
 * @returns {[number, number][]}
 */
function joinOrthogonal(p0, p1, p3, p4, nA, nB, A, B, stub) {
    /** @type {[number, number]} */
    const a0 = [p0.x, p0.y];
    /** @type {[number, number]} */
    const a1 = [p1.x, p1.y];
    /** @type {[number, number]} */
    const a3 = [p3.x, p3.y];
    /** @type {[number, number]} */
    const a4 = [p4.x, p4.y];

    // Facing each other (or away): one axis of travel, so either a Z between the
    // stubs or, when the target sits BEHIND the source, a detour around both.
    if (nA.x === -nB.x && nA.y === -nB.y) {
        if (ahead(p1, p3, nA)) {
            if (nA.x) {
                const xm = (p1.x + p3.x) / 2;
                return [a0, a1, [xm, p1.y], [xm, p3.y], a3, a4];
            }
            const ym = (p1.y + p3.y) / 2;
            return [a0, a1, [p1.x, ym], [p3.x, ym], a3, a4];
        }
        if (nA.x) {
            const up = Math.min(A.cy - A.hh, B.cy - B.hh) - stub;
            const down = Math.max(A.cy + A.hh, B.cy + B.hh) + stub;
            const cost = (/** @type {number} */ y) => Math.abs(y - p1.y) + Math.abs(y - p3.y);
            const y = cost(up) <= cost(down) ? up : down;
            return [a0, a1, [p1.x, y], [p3.x, y], a3, a4];
        }
        const left = Math.min(A.cx - A.hw, B.cx - B.hw) - stub;
        const right = Math.max(A.cx + A.hw, B.cx + B.hw) + stub;
        const cost = (/** @type {number} */ x) => Math.abs(x - p1.x) + Math.abs(x - p3.x);
        const x = cost(left) <= cost(right) ? left : right;
        return [a0, a1, [x, p1.y], [x, p3.y], a3, a4];
    }

    // Both leaving by the same side: out past whichever stub reaches further, across,
    // and back in.
    if (nA.x === nB.x && nA.y === nB.y) {
        if (nA.x) {
            const x = nA.x > 0 ? Math.max(p1.x, p3.x) : Math.min(p1.x, p3.x);
            return [a0, a1, [x, p1.y], [x, p3.y], a3, a4];
        }
        const y = nA.y > 0 ? Math.max(p1.y, p3.y) : Math.min(p1.y, p3.y);
        return [a0, a1, [p1.x, y], [p3.x, y], a3, a4];
    }

    // Perpendicular: two candidate corners. The natural one continues along A's axis
    // first; it is wrong when it would double back, and the other order always works.
    const natural = nA.x ? { x: p3.x, y: p1.y } : { x: p1.x, y: p3.y };
    const into = { x: -nB.x, y: -nB.y };
    if (ahead(p1, natural, nA) && ahead(natural, p3, into)) {
        return [a0, a1, [natural.x, natural.y], a3, a4];
    }
    const other = nA.x ? { x: p1.x, y: p3.y } : { x: p3.x, y: p1.y };
    return [a0, a1, [other.x, other.y], a3, a4];
}

/**
 * The box-anchored orthogonal connector: leaves each node PERPENDICULAR to one of
 * its edges, and picks which edges from where the two nodes actually sit.
 *
 * This is the one shape that needs more than two points to work from. Anchoring on
 * an edge means insetting along that edge's NORMAL rather than along the chord, and
 * it has to keep routing when two boxes overlap — the case a chord inset reports as
 * "nothing sensible to draw". Hence `anchors: 'box'` on its row.
 * @param {LinkSegment} seg the two node CENTRES
 * @param {number} bow
 * @param {LinkShapeOptions} opts
 * @returns {LinkShape | null}
 */
function orthogonalShape(seg, bow, opts) {
    const A = opts.source || { cx: seg.x1, cy: seg.y1, hw: 0, hh: 0 };
    const B = opts.target || { cx: seg.x2, cy: seg.y2, hw: 0, hh: 0 };
    // Concentric boxes have no side facing anything. Draw nothing rather than
    // guessing, exactly as a chord shape does with a zero-length segment.
    if (A.cx === B.cx && A.cy === B.cy) return null;

    const sideA = opts.sourceSide && opts.sourceSide !== 'auto' ? opts.sourceSide : facingSide(A, B);
    const sideB = opts.targetSide && opts.targetSide !== 'auto' ? opts.targetSide : facingSide(B, A);
    const nA = SIDE_NORMALS[sideA];
    const nB = SIDE_NORMALS[sideB];

    const gapA = opts.sourceGap || 0;
    const gapB = opts.targetGap || 0;
    const stub = Math.max(MIN_STUB, gapA, gapB);

    // The bow slides the two anchors in OPPOSITE directions along their edges, so a
    // pair of siblings splays rather than translating sideways together.
    const p0 = anchorOn(A, sideA, gapA, bow);
    const p4 = anchorOn(B, sideB, gapB, -bow);
    const p1 = { x: p0.x + nA.x * stub, y: p0.y + nA.y * stub };
    const p3 = { x: p4.x + nB.x * stub, y: p4.y + nB.y * stub };

    const points = roundCorners(
        simplify(joinOrthogonal(p0, p1, p3, p4, nA, nB, A, B, stub)),
        Number(opts.cornerRadius) || 0
    );

    return {
        points,
        curve: 'linear',
        start: p0,
        end: p4,
        mid: polylineMid(points),
        // Travel leaves the source along its outward normal and arrives at the
        // target against the target's, so both arrowheads cap the edge square-on.
        tangentIn: nA,
        tangentOut: { x: -nB.x, y: -nB.y },
    };
}

/**
 * The shapes, keyed by kind. `smooth` is an alias of `bezier`; `loop` is not
 * spellable by an author — it is reached only by a row referencing one node twice.
 *
 * `anchors` says what the `seg` handed to `build` MEANS: the chord already pulled in
 * by `inset` for every point-to-point kind, or the two node centres for a kind that
 * docks to a box. See the header — this is a declared capability so that the mark
 * never branches on a kind name.
 * @type {Record<string, { anchors: string, build: (seg: LinkSegment, bow: number, opts: LinkShapeOptions) => LinkShape | null }>}
 */
export const LINK_SHAPES = {
    line: { anchors: 'chord', build: (seg) => lineShape(seg) },
    step: { anchors: 'chord', build: stepShape('step') },
    stepBefore: { anchors: 'chord', build: stepShape('stepBefore') },
    stepAfter: { anchors: 'chord', build: stepShape('stepAfter') },
    orthogonal: { anchors: 'box', build: orthogonalShape },
    arc: { anchors: 'chord', build: (seg, bow) => arcShape(seg, bow) },
    bezier: { anchors: 'chord', build: (seg, bow) => bezierShape(seg, bow) },
    smooth: { anchors: 'chord', build: (seg, bow) => bezierShape(seg, bow) },
    loop: { anchors: 'chord', build: (seg, bow, opts) => loopShape(seg, bow, opts.loopRadius || 0) },
};

/** The kinds an author may name, for the dev warning on an unknown one. */
export const LINK_CURVES = Object.keys(LINK_SHAPES).filter((k) => k !== 'loop');
