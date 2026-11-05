// @ts-check
// linkRouter.js — where an orthogonal connector GOES between two node boxes.
//
// `linkGeometry.js` is the table of SHAPES a link can take; this is the one shape
// that has to decide a route rather than draw a formula, so it lives apart. Nothing
// here knows about marks, scales, rows or rendering: boxes in, a polyline out.
//
// ── A port is where a link meets a box ──────────────────────────────────────
// `{ side, offset }`: which edge, and how far along it from the midpoint as a signed
// fraction of that edge (0 is the middle, clamped to ±MAX_SLIDE so a link never
// leaves from a corner). A port whose side is null SLIDES: it docks where the line
// toward the other end crosses the box, so it moves continuously as either node
// moves and never jumps. A port with a side is PINNED at that edge's midpoint. The
// router takes both as given, so an author pinning a side, a gesture that started
// on a port, an offset column, or a later pass distributing ports along an edge all
// reach the same code unchanged.
//
// ── Sliding, not choosing ────────────────────────────────────────────────────
// A side that is CHOSEN — by an axis test, or by scoring every pair of edges — is
// re-chosen on every render, so a link flips edges as a node is dragged across a
// decision boundary. Both were tried here. A sliding end has no decision to make:
// `perimeterPort` intersects the ray between the two centres with the box, and the
// side is simply whichever edge that point lies on. At a corner the POSITION is
// continuous and only the perpendicular exit direction flips, which is inherent to
// an orthogonal connector; a straight or curved kind docked the same way has no
// discontinuity at all. Two near-aligned boxes come out straight for free, because
// both anchors slide toward each other; a steep diagonal with a tight gap becomes a
// gentle Z instead of a squiggle, for the same reason.
//
// ── Obstacles are a REPAIR ───────────────────────────────────────────────────
// The route between the two resolved ports is the plain Z / C / L of
// `joinOrthogonal`. Only when it crosses a node box does the grid search run: the
// classic orthogonal visibility grid — every box edge pushed out by the margin, the
// midline of every gap between them, and the two stub points of this link — with an
// A* over (point, heading) that charges a turn. With no path (boxes overlapping) the
// plain route stands, so a chart always draws something.

/** The shortest leg a connector leaves a node by, in px. Long enough that the turn reads as deliberate rather than as a kink on the edge. */
export const MIN_STUB = 16;

/** How far along its edge a port may sit, as a fraction of that edge. Beyond this the connector leaves from a corner and stops reading as square-on. */
export const MAX_SLIDE = 0.4;

/** How close a leg may pass a node it does not touch, in px. Smaller than MIN_STUB so a stub's own first leg is never "crossing" its neighbour. */
export const OBSTACLE_MARGIN = 8;

// A turn costs as much as this many px of travel in the grid search, so a detour
// prefers fewer bends over a slightly shorter path.
const BEND_COST = 30;

// How much dearer a grid step is when it hugs a box's padded edge rather than the
// middle of a corridor, per px. Enough to prefer the centre line, not enough to
// take a longer route for it.
const HUG_COST = 0.25;

// Past this many grid points the A* is skipped and the plain route stands, so a
// very large board never stalls a render tick on one crossing link.
const MAX_GRID_POINTS = 250000;

// Index order matters here: `DIRS` and the heading state below are indexed the
// same way.
/** The four edges of a node box: what a side may name. */
export const LINK_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * Of the sides a node allows, the one FACING a point: the side whose midpoint is
 * nearest it. This is how an unpinned end meets a node that has ports — at the
 * usable port facing the other end — and, like any choice, it changes edge when the
 * other node crosses a diagonal. A node without ports never asks: its ends slide.
 * @param {LinkBox} box
 * @param {string[]} sides at least one
 * @param {{ x: number, y: number }} toward
 * @returns {string}
 */
export function facingSide(box, sides, toward) {
    let best = sides[0];
    let bestDist = Infinity;
    for (const side of sides) {
        const n = SIDE_NORMALS[side];
        const d = Math.hypot(box.cx + n.x * box.hw - toward.x, box.cy + n.y * box.hh - toward.y);
        if (d < bestDist) { bestDist = d; best = side; }
    }
    return best;
}

/**
 * The edges a SELF-LOOP leaves and returns by, and how far out it nests. A loop has
 * no other end to face, so where it goes is decided here, from what the node allows:
 *
 *   a side both ends may use   a teardrop on that edge; the k-th loop on a node takes
 *                              the k-th such side (top, right, bottom, left), and
 *                              only once every side holds one does a loop nest
 *                              outside the last
 *   no shared side             out by one edge and back by the nearest other, around
 *                              the corner (or the top, for opposite edges)
 *
 * A pinned end keeps its side; an unpinned one takes the pinned one's if it may, else
 * the nearest it may. `outs`/`ins` null means "any side" (a node without ports).
 * @param {string[] | null} outs sides the loop may leave by
 * @param {string[] | null} ins sides it may return by
 * @param {string | null} pinnedOut @param {string | null} pinnedIn
 * @param {number} rank this loop's place among the loops on its node
 * @returns {{ out: string, in: string, nest: number }}
 */
export function loopSides(outs, ins, pinnedOut, pinnedIn, rank) {
    const outOk = outs || LINK_SIDES;
    const inOk = ins || LINK_SIDES;
    /** @param {string} from @param {string[]} among */
    const nearest = (from, among) => {
        if (among.includes(from)) return from;
        const i = LINK_SIDES.indexOf(from);
        const steps = (/** @type {string} */ s) => {
            const d = Math.abs(LINK_SIDES.indexOf(s) - i);
            return Math.min(d, 4 - d);
        };
        return among.slice().sort((a, b) => steps(a) - steps(b))[0];
    };
    if (pinnedOut || pinnedIn) {
        const out = pinnedOut || nearest(/** @type {string} */ (pinnedIn), outOk);
        return { out, in: pinnedIn || nearest(out, inOk), nest: rank };
    }
    const both = LINK_SIDES.filter((s) => outOk.includes(s) && inOk.includes(s));
    if (both.length) {
        const side = both[rank % both.length];
        return { out: side, in: side, nest: Math.floor(rank / both.length) };
    }
    const out = outOk[0];
    return { out, in: nearest(out, inOk), nest: rank };
}

/** @type {Record<string, { x: number, y: number }>} outward normal per side */
export const SIDE_NORMALS = {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
};

/** @type {Record<string, string>} */
const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/**
 * A node's rectangle, in scene coordinates. Half-extents rather than width/height
 * because every test here is "how far out from the centre".
 * @typedef {object} LinkBox
 * @property {number} cx @property {number} cy
 * @property {number} hw @property {number} hh
 */

/**
 * Where a link meets a box: an edge, or null to slide, and a position along it.
 * @typedef {object} LinkPort
 * @property {string | null} side one of LINK_SIDES, or null (slide)
 * @property {number} offset signed fraction of the edge from its midpoint
 */

/**
 * A resolved end: the edge the route leaves by and the point it leaves from.
 * @typedef {object} LinkAnchor
 * @property {string} side
 * @property {number} offset
 * @property {number} x
 * @property {number} y
 */

/**
 * The orthogonal visibility grid over every node box, built once per chart build.
 * @typedef {object} RoutingGrid
 * @property {number[]} xs sorted x lines
 * @property {number[]} ys sorted y lines
 * @property {LinkBox[]} boxes the obstacles
 * @property {number} margin how far lines sit off a box edge
 */

/**
 * @typedef {object} RouteResult
 * @property {[number, number][]} points the polyline, anchors included, simplified
 * @property {string} sourceSide the edge the route leaves by
 * @property {string} targetSide the edge it arrives at
 * @property {number} crossings how many (leg, box) crossings the route still has
 */

/**
 * @typedef {object} RouteRequest
 * @property {{ box: LinkBox, port: LinkPort }} source
 * @property {{ box: LinkBox, port: LinkPort }} target
 * @property {number} [sourceGap] clearance off the source edge, in px
 * @property {number} [targetGap] clearance off the target edge, in px
 * @property {LinkBox[]} [obstacles] every node box in the chart (the two ends included)
 * @property {RoutingGrid} [grid] the shared grid; without one, no obstacle repair
 */

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Drop coincident points, then interior vertices that don't actually turn. Both
 * matter before rounding: a corner routine handed a straight-through vertex would
 * round a corner that isn't there, and one handed a zero-length leg divides by it.
 * A reversal (doubling straight back) is a real turn and is kept.
 * @param {[number, number][]} points
 * @returns {[number, number][]}
 */
export function simplify(points) {
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
        const dot = (v[0] - a[0]) * (b[0] - v[0]) + (v[1] - a[1]) * (b[1] - v[1]);
        if (Math.abs(cross) < 0.01 && dot > 0) out.splice(i, 1);
    }
    return out;
}

/**
 * Where a PINNED port sits: the edge's midpoint, pushed OUT by `gap`, then slid
 * along the edge by `offset` (a fraction of that edge, clamped to ±MAX_SLIDE).
 *
 * A positive offset runs CLOCKWISE around the box — rightward along the top,
 * downward along the right, leftward along the bottom, upward along the left.
 * Rotational rather than screen-axis on purpose: it is what lets one signed
 * number separate a reciprocal pair by arithmetic. `+bow` on the source and
 * `-bow` on the target shifts A→B one way along both its edges, and the same
 * rule shifts B→A the other way, so the two never draw on top of each other.
 * @param {LinkBox} box @param {string} side @param {number} gap @param {number} offset
 * @param {number} [limit] how far from the midpoint the port may go; a sliding end
 *   may reach the corner (0.5) so its position stays continuous across it
 * @returns {LinkAnchor}
 */
export function anchorOn(box, side, gap, offset, limit = MAX_SLIDE) {
    const n = SIDE_NORMALS[side];
    const half = n.x ? box.hh : box.hw;
    const t = clamp(offset, -limit, limit);
    const along = t * half * 2;
    return {
        side,
        offset: t,
        x: box.cx + n.x * (box.hw + gap) + -n.y * along,
        y: box.cy + n.y * (box.hh + gap) + n.x * along,
    };
}

/**
 * Where a SLIDING port sits: the point where the ray from the box's centre toward
 * `toward` leaves the box, pushed out by `gap`, clamped MAX_SLIDE off the corner.
 * The side is whichever edge that point lies on, so it follows from the geometry
 * rather than from a decision — the whole reason a sliding end never jumps. `offset`
 * (a clockwise fraction, as on anchorOn) is added on top, which is how the
 * reciprocal-pair bow still separates two sliding links.
 *
 * Which edge the ray exits is the standard aspect test: compare the ray's slope to
 * the box's diagonal. A zero-length ray (concentric boxes) has no exit; it is the
 * caller's degenerate case and is reported as the right edge's midpoint.
 *
 * The port may reach the corner. Holding it MAX_SLIDE short, as a declared offset
 * is, would move it a tenth of the edge at the moment the side flips — the one
 * jump a sliding end exists to avoid.
 * @param {LinkBox} box @param {{ x: number, y: number }} toward @param {number} gap
 * @param {number} [offset]
 * @returns {LinkAnchor}
 */
export function perimeterPort(box, toward, gap, offset = 0) {
    const dx = toward.x - box.cx;
    const dy = toward.y - box.cy;
    const hw = box.hw || 1e-6;
    const hh = box.hh || 1e-6;
    /** @type {string} */
    let side;
    /** @type {number} */
    let along; // signed px along the edge from its midpoint, in anchorOn's clockwise sense
    if (Math.abs(dx) * hh >= Math.abs(dy) * hw) {
        // Exits a vertical edge. Position along it: where the ray meets x = ±hw.
        side = dx >= 0 ? 'right' : 'left';
        const y = dx === 0 ? 0 : dy * (hw / Math.abs(dx));
        // Clockwise along the right edge is +y; along the left edge it is -y.
        along = side === 'right' ? y : -y;
    } else {
        side = dy >= 0 ? 'bottom' : 'top';
        const x = dy === 0 ? 0 : dx * (hh / Math.abs(dy));
        // Clockwise along the top edge is +x; along the bottom edge it is -x.
        along = side === 'top' ? x : -x;
    }
    const n = SIDE_NORMALS[side];
    const edge = (n.x ? hh : hw) * 2;
    return anchorOn(box, side, gap, along / edge + offset, 0.5);
}

/**
 * Pull two facing sliding ends into line when they nearly are. A chord crosses the
 * two boxes at different points along their edges, so an orthogonal route between
 * them is a Z with a small jog — the one thing a sliding end cannot absorb on its
 * own. Each sliding end may move up to MIN_STUB toward the other, so a jog of less
 * than two stubs closes to a straight leg and a larger one shrinks by that much:
 * continuous in the offset, with no threshold to flip across. A pinned end never
 * moves; a side the schema or an author fixed is fixed.
 * @param {LinkAnchor} a @param {LinkAnchor} b
 * @param {LinkBox} A @param {LinkBox} B
 * @param {boolean} slideA @param {boolean} slideB
 * @returns {{ a: LinkAnchor, b: LinkAnchor }}
 */
function alignFacing(a, b, A, B, slideA, slideB) {
    const nA = SIDE_NORMALS[a.side];
    const nB = SIDE_NORMALS[b.side];
    if (nA.x !== -nB.x || nA.y !== -nB.y) return { a, b };
    if (!ahead(a, b, nA)) return { a, b };
    const horizontal = !!nA.x;
    const off = horizontal ? b.y - a.y : b.x - a.x;
    if (Math.abs(off) < 0.01) return { a, b };
    const s = Math.sign(off);
    // How far each end can still go toward the other along its edge, in px.
    const room = (/** @type {LinkAnchor} */ p, /** @type {LinkBox} */ box, /** @type {number} */ dir) => {
        const half = horizontal ? box.hh : box.hw;
        const at = horizontal ? p.y - box.cy : p.x - box.cx;
        return Math.max(0, half - dir * at);
    };
    const budgetA = slideA ? Math.min(MIN_STUB, room(a, A, s)) : 0;
    const budgetB = slideB ? Math.min(MIN_STUB, room(b, B, -s)) : 0;
    const total = Math.min(Math.abs(off), budgetA + budgetB);
    if (!total) return { a, b };
    const dA = (total * budgetA) / (budgetA + budgetB) * s;
    const dB = total * s - dA;
    return {
        a: horizontal ? { ...a, y: a.y + dA } : { ...a, x: a.x + dA },
        b: horizontal ? { ...b, y: b.y - dB } : { ...b, x: b.x - dB },
    };
}

/**
 * Does the axis-aligned leg a→b pass through `box` padded by `pad`? A leg that only
 * touches the padded edge does not count — that is the lane a route runs down.
 * @param {[number, number]} a @param {[number, number]} b @param {LinkBox} box @param {number} pad
 */
export function legCrossesBox(a, b, box, pad) {
    const x0 = box.cx - box.hw - pad;
    const x1 = box.cx + box.hw + pad;
    const y0 = box.cy - box.hh - pad;
    const y1 = box.cy + box.hh + pad;
    const lx0 = Math.min(a[0], b[0]);
    const lx1 = Math.max(a[0], b[0]);
    const ly0 = Math.min(a[1], b[1]);
    const ly1 = Math.max(a[1], b[1]);
    return lx0 < x1 && lx1 > x0 && ly0 < y1 && ly1 > y0;
}

/**
 * Is `b` the same box as `a` — the same object, or the same rectangle? A caller
 * that copies its boxes must still get the own-box exemption.
 * @param {LinkBox} a @param {LinkBox} b
 */
function sameBox(a, b) {
    return a === b || (a.cx === b.cx && a.cy === b.cy && a.hw === b.hw && a.hh === b.hh);
}

/**
 * How many (leg, box) pairs a route runs through. The first leg is exempt from the
 * box it leaves and the last from the box it enters: those are the stubs.
 * @param {[number, number][]} points
 * @param {LinkBox} A @param {LinkBox} B @param {LinkBox[]} obstacles
 */
function countCrossings(points, A, B, obstacles) {
    let n = 0;
    const last = points.length - 2;
    for (let i = 0; i <= last; i++) {
        for (const box of obstacles) {
            if (i === 0 && sameBox(box, A)) continue;
            if (i === last && sameBox(box, B)) continue;
            if (legCrossesBox(points[i], points[i + 1], box, OBSTACLE_MARGIN)) n++;
        }
    }
    return n;
}

/**
 * Is `to` on the outward side of `from` along `n` (or level with it)?
 * @param {{x:number,y:number}} from @param {{x:number,y:number}} to @param {{x:number,y:number}} n
 */
function ahead(from, to, n) {
    return (to.x - from.x) * n.x + (to.y - from.y) * n.y >= 0;
}

/**
 * Join two stubs with axis-aligned legs. Four cases, decided by how the two side
 * NORMALS relate — not by where the nodes are, which the sides already encode:
 *
 *   opposite, with room     a Z, jogging halfway between the two anchors (the stubs
 *                           shrink when the boxes are closer than two of them —
 *                           a tight Z is what adjacent boxes want, not a detour)
 *   opposite, without room  a C, detouring past both boxes on the other axis
 *   the same side           a C on that axis, out past the further stub
 *   perpendicular           an L, at whichever of the two corners lies ahead of both
 *
 * @param {{x:number,y:number}} p0 @param {{x:number,y:number}} p1
 * @param {{x:number,y:number}} p3 @param {{x:number,y:number}} p4
 * @param {{x:number,y:number}} nA @param {{x:number,y:number}} nB
 * @param {LinkBox} A @param {LinkBox} B @param {number} stub
 * @returns {[number, number][]}
 */
export function joinOrthogonal(p0, p1, p3, p4, nA, nB, A, B, stub) {
    /** @type {[number, number]} */
    const a0 = [p0.x, p0.y];
    /** @type {[number, number]} */
    const a1 = [p1.x, p1.y];
    /** @type {[number, number]} */
    const a3 = [p3.x, p3.y];
    /** @type {[number, number]} */
    const a4 = [p4.x, p4.y];

    if (nA.x === -nB.x && nA.y === -nB.y) {
        if (ahead(p0, p4, nA)) {
            if (nA.x) {
                const xm = (p0.x + p4.x) / 2;
                return [a0, [xm, p0.y], [xm, p4.y], a4];
            }
            const ym = (p0.y + p4.y) / 2;
            return [a0, [p0.x, ym], [p4.x, ym], a4];
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

    if (nA.x === nB.x && nA.y === nB.y) {
        if (nA.x) {
            const x = nA.x > 0 ? Math.max(p1.x, p3.x) : Math.min(p1.x, p3.x);
            return [a0, a1, [x, p1.y], [x, p3.y], a3, a4];
        }
        const y = nA.y > 0 ? Math.max(p1.y, p3.y) : Math.min(p1.y, p3.y);
        return [a0, a1, [p1.x, y], [p3.x, y], a3, a4];
    }

    const natural = nA.x ? { x: p3.x, y: p1.y } : { x: p1.x, y: p3.y };
    const into = { x: -nB.x, y: -nB.y };
    if (ahead(p1, natural, nA) && ahead(natural, p3, into)) {
        return [a0, a1, [natural.x, natural.y], a3, a4];
    }
    const other = nA.x ? { x: p1.x, y: p3.y } : { x: p3.x, y: p1.y };
    return [a0, a1, [other.x, other.y], a3, a4];
}

/**
 * Resolve the two ends of a link against each other: a pinned port sits at its
 * edge; a sliding port aims at the other end — at its anchor when that end is
 * pinned, at its centre otherwise — so one pinned end pulls the other toward the
 * place the route will actually arrive.
 * @param {LinkBox} A @param {LinkPort} portA @param {number} gapA
 * @param {LinkBox} B @param {LinkPort} portB @param {number} gapB
 * @returns {{ a: LinkAnchor, b: LinkAnchor }}
 */
export function resolveEnds(A, portA, gapA, B, portB, gapB) {
    const tA = +portA.offset || 0;
    const tB = +portB.offset || 0;
    const pinnedA = portA.side ? anchorOn(A, portA.side, gapA, tA) : null;
    const pinnedB = portB.side ? anchorOn(B, portB.side, gapB, tB) : null;
    const a = pinnedA || perimeterPort(A, pinnedB || { x: B.cx, y: B.cy }, gapA, tA);
    const b = pinnedB || perimeterPort(B, pinnedA || { x: A.cx, y: A.cy }, gapB, tB);
    return { a, b };
}

/**
 * Route an orthogonal connector between two boxes.
 * @param {RouteRequest} req
 * @returns {RouteResult | null} null when there is nothing sensible to draw
 */
export function routeOrthogonal(req) {
    const A = req.source.box;
    const B = req.target.box;
    // Concentric boxes have no side facing anything. Draw nothing rather than guess.
    if (A.cx === B.cx && A.cy === B.cy) return null;
    const gapA = req.sourceGap || 0;
    const gapB = req.targetGap || 0;
    const stub = Math.max(MIN_STUB, gapA, gapB);
    const obstacles = req.obstacles || [];

    const ends = resolveEnds(A, req.source.port, gapA, B, req.target.port, gapB);
    const { a, b } = alignFacing(ends.a, ends.b, A, B, !req.source.port.side, !req.target.port.side);
    const nA = SIDE_NORMALS[a.side];
    const nB = SIDE_NORMALS[b.side];
    const p1 = { x: a.x + nA.x * stub, y: a.y + nA.y * stub };
    const p3 = { x: b.x + nB.x * stub, y: b.y + nB.y * stub };
    const points = simplify(joinOrthogonal(a, p1, p3, b, nA, nB, A, B, stub));
    const crossings = countCrossings(points, A, B, obstacles);
    const plain = { points, sourceSide: a.side, targetSide: b.side, crossings };
    if (crossings && req.grid) {
        const repaired = searchGrid(req.grid, A, B, a, b, stub);
        if (repaired) return repaired;
    }
    return plain;
}

// ── The grid ────────────────────────────────────────────────────────────────

/**
 * Sorted, deduplicated, with the midline between each consecutive pair added so a
 * corridor between two boxes has a centre line to run down.
 * @param {number[]} values
 * @returns {number[]}
 */
function gridLines(values) {
    const sorted = [...values].sort((a, b) => a - b);
    /** @type {number[]} */
    const out = [];
    for (const v of sorted) {
        if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
    }
    /** @type {number[]} */
    const withMid = [];
    for (let i = 0; i < out.length; i++) {
        if (i) withMid.push((out[i - 1] + out[i]) / 2);
        withMid.push(out[i]);
    }
    return withMid;
}

/**
 * The orthogonal visibility grid over every node box. Built once per chart build
 * and shared by every link that needs a repair.
 * @param {LinkBox[]} boxes
 * @param {number} [margin]
 * @returns {RoutingGrid}
 */
export function routingGrid(boxes, margin = OBSTACLE_MARGIN) {
    /** @type {number[]} */
    const xs = [];
    /** @type {number[]} */
    const ys = [];
    for (const b of boxes) {
        xs.push(b.cx - b.hw - margin, b.cx + b.hw + margin);
        ys.push(b.cy - b.hh - margin, b.cy + b.hh + margin);
    }
    return { xs: gridLines(xs), ys: gridLines(ys), boxes, margin };
}

/**
 * `lines` with `extra` merged in, sorted and deduplicated.
 * @param {number[]} lines @param {number[]} extra
 * @returns {number[]}
 */
function withLines(lines, extra) {
    const out = [...lines];
    for (const v of extra) {
        let lo = 0;
        let hi = out.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (out[mid] < v) lo = mid + 1; else hi = mid;
        }
        if (Math.abs((out[lo] ?? Infinity) - v) < 0.01) continue;
        if (lo > 0 && Math.abs(out[lo - 1] - v) < 0.01) continue;
        out.splice(lo, 0, v);
    }
    return out;
}

/**
 * Index of `v` in sorted `lines`, which must contain it (within 0.01).
 * @param {number[]} lines @param {number} v
 */
function lineIndex(lines, v) {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const d = lines[mid] - v;
        if (Math.abs(d) < 0.01) return mid;
        if (d < 0) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
}

/** A minimal binary min-heap of [priority, payload]. */
class Heap {
    constructor() {
        /** @type {[number, number][]} */
        this.a = [];
    }
    get size() { return this.a.length; }
    /** @param {number} p @param {number} v */
    push(p, v) {
        const a = this.a;
        a.push([p, v]);
        let i = a.length - 1;
        while (i > 0) {
            const j = (i - 1) >> 1;
            if (a[j][0] <= a[i][0]) break;
            [a[i], a[j]] = [a[j], a[i]];
            i = j;
        }
    }
    /** @returns {[number, number]} */
    pop() {
        const a = this.a;
        const top = a[0];
        const end = /** @type {[number, number]} */ (a.pop());
        if (a.length) {
            a[0] = end;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let m = i;
                if (l < a.length && a[l][0] < a[m][0]) m = l;
                if (r < a.length && a[r][0] < a[m][0]) m = r;
                if (m === i) break;
                [a[i], a[m]] = [a[m], a[i]];
                i = m;
            }
        }
        return top;
    }
}

// Heading index → step, in LINK_SIDES order (top, right, bottom, left).
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * A* over the grid from the source anchor to the target anchor, detouring around
 * every box. Heading is part of the state so a turn can be charged.
 *
 * The search starts and ends at the ANCHORS, not at the stub points, with the
 * first step forced along the source normal and the arrival forced along the
 * target's. A stub point can sit inside a neighbouring box — a node parked a few
 * px from the one a link enters — and a search started there found nothing, so the
 * route fell back to the very crossing it was meant to repair. The stub points are
 * still added as grid lines, so the natural first turn is available when it is
 * clear; the anchor's own line is what makes a shorter first leg possible when it
 * is not.
 * @param {RoutingGrid} grid
 * @param {LinkBox} A @param {LinkBox} B
 * @param {LinkAnchor} a the resolved source end @param {LinkAnchor} b the resolved target end
 * @param {number} stub
 * @returns {RouteResult | null}
 */
export function searchGrid(grid, A, B, a, b, stub) {
    const nA = SIDE_NORMALS[a.side];
    const nB = SIDE_NORMALS[b.side];
    const start = { x: a.x, y: a.y };
    const goal = { x: b.x, y: b.y };

    const xs = withLines(grid.xs, [start.x, goal.x, a.x + nA.x * stub, b.x + nB.x * stub]);
    const ys = withLines(grid.ys, [start.y, goal.y, a.y + nA.y * stub, b.y + nB.y * stub]);
    const nx = xs.length;
    const ny = ys.length;
    if (nx * ny > MAX_GRID_POINTS) return null;

    const pad = grid.margin - 0.5;
    const boxes = grid.boxes;
    // -1 unknown, 0 clear, 1 inside a box, 2 clear but hugging one.
    const cell = new Int8Array(nx * ny).fill(-1);
    const classify = (/** @type {number} */ i, /** @type {number} */ j) => {
        const k = j * nx + i;
        if (cell[k] >= 0) return cell[k];
        const x = xs[i];
        const y = ys[j];
        let v = 0;
        for (const bx of boxes) {
            const dx = Math.abs(x - bx.cx) - bx.hw;
            const dy = Math.abs(y - bx.cy) - bx.hh;
            if (dx < pad && dy < pad) { v = 1; break; }
            if (dx <= grid.margin + 0.5 && dy <= grid.margin + 0.5) v = 2;
        }
        cell[k] = v;
        return v;
    };

    const si = lineIndex(xs, start.x);
    const sj = lineIndex(ys, start.y);
    const gi = lineIndex(xs, goal.x);
    const gj = lineIndex(ys, goal.y);
    if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null;
    // An anchor sits on its own box's edge, inside that box's padding by
    // construction; it is blocked only by ANOTHER box (two nodes overlapping).
    const insideOther = (/** @type {{x:number,y:number}} */ p, /** @type {LinkBox} */ own) =>
        boxes.some((bx) => !sameBox(bx, own)
            && Math.abs(p.x - bx.cx) - bx.hw < pad && Math.abs(p.y - bx.cy) - bx.hh < pad);
    if (insideOther(start, A) || insideOther(goal, B)) return null;
    const goalDir = LINK_SIDES.indexOf(OPPOSITE[b.side]);

    const n = nx * ny * 4;
    const g = new Float64Array(n).fill(Infinity);
    const parent = new Int32Array(n).fill(-1);
    const heap = new Heap();
    const h = (/** @type {number} */ i, /** @type {number} */ j) =>
        Math.abs(xs[i] - xs[gi]) + Math.abs(ys[j] - ys[gj]);

    const startKey = (sj * nx + si) * 4 + LINK_SIDES.indexOf(a.side);
    g[startKey] = 0;
    heap.push(h(si, sj), startKey);

    let bestTotal = Infinity;
    let bestState = -1;
    while (heap.size) {
        const [f, k] = heap.pop();
        if (f >= bestTotal) break;
        const dir = k & 3;
        const p = k >> 2;
        const i = p % nx;
        const j = (p - i) / nx;
        const gk = g[k];
        if (f > gk + h(i, j) + 1e-9) continue; // stale entry
        // The goal counts only when reached square-on: the last leg runs into the
        // target along its normal, as every other route's does.
        if (i === gi && j === gj && dir === goalDir) {
            if (gk < bestTotal) { bestTotal = gk; bestState = k; }
        }
        for (let d = 0; d < 4; d++) {
            // The first leg leaves along the source normal; no turn at the anchor.
            if (k === startKey && d !== dir) continue;
            const ni = i + DIRS[d][0];
            const nj = j + DIRS[d][1];
            if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
            // The goal is reachable although it lies in its own box's padding.
            const c = ni === gi && nj === gj ? 0 : classify(ni, nj);
            if (c === 1) continue;
            const len = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
            const cost = gk + len * (c === 2 ? 1 + HUG_COST : 1) + (d === dir ? 0 : BEND_COST);
            const nk = (nj * nx + ni) * 4 + d;
            if (cost < g[nk]) {
                g[nk] = cost;
                parent[nk] = k;
                heap.push(cost + h(ni, nj), nk);
            }
        }
    }
    if (bestState < 0) return null;

    /** @type {[number, number][]} */
    const points = [];
    for (let k = bestState; k >= 0; k = parent[k]) {
        const p = k >> 2;
        const i = p % nx;
        points.push([xs[i], ys[(p - i) / nx]]);
    }
    points.reverse();
    // The chain runs anchor to anchor already.
    const route = simplify(points);
    return { points: route, sourceSide: a.side, targetSide: b.side, crossings: 0 };
}
