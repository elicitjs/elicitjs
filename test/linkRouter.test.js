// The orthogonal link router is pure geometry — boxes in, a polyline out — so its
// rules are checked here without a chart. A sliding end docks where the line
// between the two centres leaves the box and never jumps; a pinned end sits at its
// edge; a route that crosses a node is repaired on the grid.
import { describe, it, expect } from 'vitest';
import {
    routeOrthogonal, routingGrid, legCrossesBox, perimeterPort, resolveEnds,
    SIDE_NORMALS, MIN_STUB, MAX_SLIDE,
} from '../src/plot/linkRouter.js';
import { LINK_SHAPES } from '../src/plot/linkGeometry.js';

const box = (cx, cy, w, h) => ({ cx, cy, hw: w / 2, hh: h / 2 });
const port = (side = null, offset = 0) => ({ side, offset });

/** Route A→B with every box in `others` as an obstacle; `withGrid` enables the detour. */
function route(A, B, others = [], opts = {}) {
    const obstacles = [A, B, ...others];
    return routeOrthogonal({
        source: { box: A, port: opts.sourcePort || port() },
        target: { box: B, port: opts.targetPort || port() },
        sourceGap: opts.sourceGap || 0,
        targetGap: opts.targetGap || 0,
        obstacles,
        grid: opts.withGrid ? routingGrid(obstacles) : undefined,
    });
}

const legs = (pts) => pts.slice(1).map((p, i) => Math.abs(p[0] - pts[i][0]) + Math.abs(p[1] - pts[i][1]));
const bends = (pts) => pts.length - 2;
const dir = (a, b) => ({ x: Math.sign(b[0] - a[0]) || 0, y: Math.sign(b[1] - a[1]) || 0 });

/** The first leg runs along the source normal, the last along the target's. */
function squareEnds(r) {
    const pts = r.points;
    const first = dir(pts[0], pts[1]);
    const last = dir(pts[pts.length - 2], pts[pts.length - 1]);
    const nA = SIDE_NORMALS[r.sourceSide];
    const nB = SIDE_NORMALS[r.targetSide];
    expect(first).toEqual({ x: nA.x || 0, y: nA.y || 0 });
    expect(last).toEqual({ x: -nB.x || 0, y: -nB.y || 0 });
}

/** Does any leg run through a box it does not dock to? Unpadded: the real rectangle. */
function crossings(r, boxes, A, B) {
    const pts = r.points;
    let n = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        for (const b of boxes) {
            if (i === 0 && b === A) continue;
            if (i === pts.length - 2 && b === B) continue;
            if (legCrossesBox(pts[i], pts[i + 1], b, 0)) n++;
        }
    }
    return n;
}

describe('perimeterPort: a sliding end', () => {
    const A = box(0, 0, 92, 40);

    it('docks where the ray toward the other node leaves the box', () => {
        expect(perimeterPort(A, { x: 300, y: 0 }, 0)).toMatchObject({ side: 'right', x: 46, y: 0 });
        expect(perimeterPort(A, { x: 0, y: -200 }, 0)).toMatchObject({ side: 'top', x: 0, y: -20 });
        // 45° toward the lower left on a wide box leaves the bottom edge.
        const p = perimeterPort(A, { x: -100, y: 100 }, 0);
        expect(p.side).toBe('bottom');
        expect(p.y).toBe(20);
        expect(p.x).toBeCloseTo(-20);
    });

    it('pushes out by the gap along the edge normal', () => {
        expect(perimeterPort(A, { x: 300, y: 10 }, 6).x).toBe(52);
    });

    it('is continuous: a 1px move of the other node moves the anchor by less than 2px', () => {
        let prev = perimeterPort(A, { x: 200, y: -150 }, 0);
        for (let x = 201; x <= 400; x++) {
            const next = perimeterPort(A, { x, y: -150 }, 0);
            expect(Math.hypot(next.x - prev.x, next.y - prev.y)).toBeLessThan(2);
            prev = next;
        }
    });

    it('may reach the corner, so the side flip moves nothing', () => {
        const onDiagonal = { x: 460, y: 200 }; // exactly along the box diagonal
        const p = perimeterPort(A, onDiagonal, 0);
        expect([p.x, p.y]).toEqual([46, 20]);
    });
});

describe('resolveEnds', () => {
    it('aims a sliding end at a pinned end\'s anchor, not the centre', () => {
        const A = box(0, 0, 92, 40);
        const B = box(300, 120, 92, 40);
        const { a, b } = resolveEnds(A, port(), 0, B, port('top'), 0);
        expect(b).toMatchObject({ side: 'top', x: 300, y: 100 });
        const aimed = perimeterPort(A, { x: 300, y: 100 }, 0);
        expect(a.x).toBeCloseTo(aimed.x);
        expect(a.y).toBeCloseTo(aimed.y);
    });
});

describe('routeOrthogonal: sides follow the geometry', () => {
    it('routes a steep diagonal with a tight gap without a cramped jog', () => {
        // The pair from the bug report: side by side 50px apart, 74px out of line.
        const A = box(208, 580, 254, 60);
        const B = box(491, 506, 207, 57);
        const r = route(A, B);
        expect(r).not.toBeNull();
        expect(bends(r.points)).toBeLessThanOrEqual(2);
        expect(legs(r.points).every((l) => l >= MIN_STUB)).toBe(true);
        squareEnds(r);
    });

    it('joins two near-aligned stacked boxes with one straight leg', () => {
        const A = box(0, 0, 92, 40);
        const B = box(12, 110, 92, 40);
        const r = route(A, B);
        expect(r.points).toHaveLength(2);
        expect(r.sourceSide).toBe('bottom');
        expect(r.targetSide).toBe('top');
        squareEnds(r);
    });

    it('draws a Z between two offset stacked boxes', () => {
        const A = box(0, 0, 92, 40);
        const B = box(60, 150, 92, 40);
        const r = route(A, B);
        expect(bends(r.points)).toBe(2);
        squareEnds(r);
    });

    it('closes a small jog continuously: the jog shrinks by one stub per sliding end', () => {
        const A = box(0, 0, 200, 40);
        const jogOf = (dx) => {
            const r = route(A, box(dx, 150, 200, 40));
            return r.points.length === 2 ? 0 : Math.abs(r.points[2][0] - r.points[1][0]);
        };
        // 150px apart on a 200px-wide box: the chord crosses each edge at
        // ~0.13·dx, so the raw jog is ~0.73·dx. 40px of offset closes to straight;
        // 80px leaves a jog, smaller than the raw one by about two stubs.
        expect(jogOf(40)).toBe(0);
        const raw80 = 80 * (1 - 2 * 20 / 150);
        expect(jogOf(80)).toBeGreaterThan(0);
        expect(jogOf(80)).toBeCloseTo(raw80 - 2 * MIN_STUB, 0);
        // A pinned end never moves: only the sliding end absorbs.
        const r = route(A, box(40, 150, 200, 40), [], { targetPort: port('top') });
        expect(r.points[r.points.length - 1][0]).toBe(40);
    });

    it('honours a pinned side wherever the target sits, going round its own box', () => {
        const A = box(300, 0, 92, 40);
        const B = box(0, 0, 92, 40); // to the LEFT
        // The plain same-side route would run straight back through A; the grid
        // repair (always present in a chart) takes it around.
        const r = route(A, B, [], { sourcePort: port('right'), withGrid: true });
        expect(r.sourceSide).toBe('right');
        expect(r.points[0]).toEqual([A.cx + A.hw, A.cy]);
        expect(r.points[1][0]).toBeGreaterThan(r.points[0][0]);
        expect(crossings(r, [A, B], A, B)).toBe(0);
        squareEnds(r);
    });

    it('places a declared offset along a pinned edge, clockwise from its midpoint', () => {
        const A = box(0, 0, 92, 40);
        const B = box(300, 0, 92, 40);
        // +0.3 on the right edge runs DOWN; -0.3 on the left edge runs down too,
        // because positive is clockwise around each box.
        const r = route(A, B, [], { sourcePort: port('right', 0.3), targetPort: port('left', -0.3) });
        expect(r.points[0][1]).toBeCloseTo(A.cy + 0.3 * 40);
        expect(r.points[r.points.length - 1][1]).toBeCloseTo(B.cy + 0.3 * 40);
        expect(r.points).toHaveLength(2);
        squareEnds(r);
    });

    it('clamps an offset so a link never leaves from a corner', () => {
        const A = box(0, 0, 92, 40);
        const B = box(300, 0, 92, 40);
        const r = route(A, B, [], { sourcePort: port('right', 5) });
        expect(r.points[0][1]).toBeCloseTo(A.cy + MAX_SLIDE * 40);
    });

    it('keeps an arrowhead gap off the edge it docks to', () => {
        const A = box(0, 0, 92, 40);
        const B = box(300, 0, 92, 40);
        const r = route(A, B, [], { sourceGap: 4, targetGap: 10 });
        expect(r.points[0][0]).toBeCloseTo(A.cx + A.hw + 4);
        expect(r.points[r.points.length - 1][0]).toBeCloseTo(B.cx - B.hw - 10);
    });

    it('declines two concentric boxes', () => {
        const A = box(0, 0, 92, 40);
        expect(route(A, box(0, 0, 40, 20))).toBeNull();
    });
});

describe('routeOrthogonal: obstacles', () => {
    it('reports a crossing and leaves it when there is no grid', () => {
        const A = box(0, 0, 92, 40);
        const B = box(400, 0, 92, 40);
        const C = box(200, 0, 92, 40);
        expect(route(A, B, [C]).crossings).toBeGreaterThan(0);
    });

    it('detours around a box in the way when given the grid', () => {
        const A = box(0, 0, 92, 40);
        const B = box(400, 0, 92, 40);
        const wall = box(200, 0, 40, 400);
        const r = route(A, B, [wall], { withGrid: true });
        expect(r.crossings).toBe(0);
        expect(crossings(r, [A, B, wall], A, B)).toBe(0);
        expect(r.points.some(([, y]) => Math.abs(y) > 200)).toBe(true);
        squareEnds(r);
    });

    it('leaves a route alone when nothing is in the way, grid or not', () => {
        const A = box(0, 0, 92, 40);
        const B = box(400, 60, 92, 40);
        const C = box(200, 300, 92, 40);
        expect(route(A, B, [C], { withGrid: true }).points).toEqual(route(A, B, [C]).points);
    });

    it('falls back to the plain route when the boxes overlap and no path exists', () => {
        const A = box(0, 0, 92, 40);
        const B = box(30, 10, 92, 40);
        const r = route(A, B, [], { withGrid: true });
        expect(r).not.toBeNull();
        expect(r.points).toEqual(route(A, B).points);
    });
});

describe('routingGrid', () => {
    it('has a line at every padded edge and the midline of every gap', () => {
        const g = routingGrid([box(0, 0, 100, 40), box(300, 0, 100, 40)], 8);
        expect(g.xs).toEqual([-58, 0, 58, 150, 242, 300, 358]);
        expect(g.ys).toEqual([-28, 0, 28]);
    });
});

describe('LINK_SHAPES', () => {
    const opts = (extra = {}) => ({
        source: box(0, 0, 92, 40),
        target: box(300, 0, 92, 40),
        cornerRadius: 0,
        ...extra,
    });

    it('orthogonal: splays a reciprocal pair by sliding the ports in opposite directions', () => {
        const ab = LINK_SHAPES.orthogonal.build({ x1: 0, y1: 0, x2: 300, y2: 0 }, 0.16, opts());
        const ba = LINK_SHAPES.orthogonal.build({ x1: 300, y1: 0, x2: 0, y2: 0 }, 0.16, opts({
            source: box(300, 0, 92, 40), target: box(0, 0, 92, 40),
        }));
        expect(ab.points).not.toEqual([...ba.points].reverse());
        expect(ab.start.y).not.toBeCloseTo(ba.end.y);
    });

    it('orthogonal: reports the edges it chose as its tangents', () => {
        const s = LINK_SHAPES.orthogonal.build({ x1: 0, y1: 0, x2: 300, y2: 0 }, 0, opts());
        expect(s.tangentIn).toEqual({ x: 1, y: 0 });
        expect(s.tangentOut).toEqual({ x: 1, y: 0 });
        expect(s.start).toEqual({ x: 46, y: 0 });
        expect(s.end).toEqual({ x: 254, y: 0 });
    });

    it('orthogonal: still accepts the side-only spelling, and "auto" means slide', () => {
        const s = LINK_SHAPES.orthogonal.build({ x1: 0, y1: 0, x2: 300, y2: 0 }, 0, opts({
            sourceSide: 'top', targetSide: 'auto',
        }));
        expect(s.tangentIn).toEqual({ x: 0, y: -1 });
        expect(s.start).toEqual({ x: 0, y: -20 });
    });

    it('bezier: a pinned end leaves perpendicular to its edge', () => {
        const seg = { x1: 0, y1: -20, x2: 254, y2: 0 };
        const free = LINK_SHAPES.bezier.build(seg, 0, {});
        const pinned = LINK_SHAPES.bezier.build(seg, 0, { sourceNormal: SIDE_NORMALS.top });
        expect(free.tangentIn).toEqual({ x: 1, y: 0 });
        expect(pinned.tangentIn).toEqual({ x: 0, y: -1 });
    });
});
