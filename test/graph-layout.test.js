// @vitest-environment jsdom
// Graph layouts: `layout.network.layered | tree | force` place a network's nodes by
// its links, `layout.tidy` lines up any table, and `layout.hierarchy.contain` is
// the hierarchy's. Pure algorithms first (core/graph/), then the engine.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Elicit, plot, edit, layout, setWarnings } from '../src/index.js';
import { compile } from '../src/json/index.js';
import { layered } from '../src/core/graph/layered.js';
import { tidyTree } from '../src/core/graph/tree.js';
import { stress } from '../src/core/graph/stress.js';
import { tidy } from '../src/core/graph/tidy.js';

// ── helpers ──────────────────────────────────────────────────────────────────
const box = (cx, cy, hw = 30, hh = 15) => ({ cx, cy, hw, hh });
const cross = (p1, p2, p3, p4) => {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-9) return false;
    const ua = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const ub = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return ua > 1e-6 && ua < 1 - 1e-6 && ub > 1e-6 && ub < 1 - 1e-6;
};
const crossings = (pts, edges) => {
    let c = 0;
    for (let i = 0; i < edges.length; i++) {
        for (let j = i + 1; j < edges.length; j++) {
            const [a, b] = edges[i], [p, q] = edges[j];
            if (a === p || a === q || b === p || b === q) continue;
            if (cross(pts[a], pts[b], pts[p], pts[q])) c++;
        }
    }
    return c;
};
const overlaps = (boxes, pts, gap = 0) => {
    let n = 0;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            if (Math.abs(pts[i].x - pts[j].x) < boxes[i].hw + boxes[j].hw + gap - 0.5
                && Math.abs(pts[i].y - pts[j].y) < boxes[i].hh + boxes[j].hh + gap - 0.5) n++;
        }
    }
    return n;
};

// A planar DAG drawn in a tangle: a diamond with a tail and a side branch.
const dagEdges = [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [2, 5]];
const tangled = [box(200, 300), box(50, 20), box(320, 40), box(180, 160), box(30, 200), box(60, 90)];

describe('layered (pure)', () => {
    it('draws a planar DAG with every link pointing down and no crossings', () => {
        const pts = layered(tangled, dagEdges);
        expect(crossings(pts, dagEdges)).toBe(0);
        for (const [s, t] of dagEdges) expect(pts[t].y).toBeGreaterThan(pts[s].y);
        expect(overlaps(tangled, pts)).toBe(0);
    });

    it('turns with `direction`', () => {
        const right = layered(tangled, dagEdges, { direction: 'right' });
        for (const [s, t] of dagEdges) expect(right[t].x).toBeGreaterThan(right[s].x);
        const up = layered(tangled, dagEdges, { direction: 'up' });
        for (const [s, t] of dagEdges) expect(up[t].y).toBeLessThan(up[s].y);
        const left = layered(tangled, dagEdges, { direction: 'left' });
        for (const [s, t] of dagEdges) expect(left[t].x).toBeLessThan(left[s].x);
    });

    it('breaks a cycle by reversing one link, and is deterministic', () => {
        const edges = [[0, 1], [1, 2], [2, 0]];
        const boxes = [box(0, 0), box(100, 50), box(0, 100)];
        const a = layered(boxes, edges);
        const b = layered(boxes, edges);
        expect(a).toEqual(b);
        const down = edges.filter(([s, t]) => a[t].y > a[s].y).length;
        expect(down).toBe(2);
    });

    it('keeps its own drawing', () => {
        const once = layered(tangled, dagEdges);
        const again = layered(tangled.map((b, i) => box(once[i].x, once[i].y, b.hw, b.hh)), dagEdges);
        const shift = { x: again[0].x - once[0].x, y: again[0].y - once[0].y };
        again.forEach((p, i) => {
            expect(p.x - shift.x).toBeCloseTo(once[i].x, 6);
            expect(p.y - shift.y).toBeCloseTo(once[i].y, 6);
        });
    });
});

describe('tree (pure)', () => {
    const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]];
    const boxes = [box(100, 0), box(40, 80), box(160, 80), box(10, 160), box(70, 160), box(160, 160)];

    it('centres each parent over its children and grows down one line per depth', () => {
        const { points, spanning } = tidyTree(boxes, edges);
        expect(spanning).toBe(false);
        expect(points[1].x).toBeCloseTo((points[3].x + points[4].x) / 2, 6);
        expect(points[0].y).toBeLessThan(points[1].y);
        expect(points[1].y).toBeCloseTo(points[2].y, 6);
        expect(points[3].y).toBeCloseTo(points[5].y, 6);
        expect(crossings(points, edges)).toBe(0);
    });

    it('keeps siblings in the order they were drawn', () => {
        const swapped = boxes.slice();
        swapped[3] = box(90, 160);
        swapped[4] = box(10, 160);
        const { points } = tidyTree(swapped, edges);
        expect(points[4].x).toBeLessThan(points[3].x);
    });

    it('reports when the links are not a tree', () => {
        const { spanning } = tidyTree(boxes, [...edges, [2, 4]]);
        expect(spanning).toBe(true);
    });

    it('puts the root in the middle when radial', () => {
        const { points } = tidyTree(boxes, edges, { direction: 'radial' });
        expect(points[0].x).toBeCloseTo(0, 6);
        expect(points[0].y).toBeCloseTo(0, 6);
        const r1 = Math.hypot(points[1].x, points[1].y), r3 = Math.hypot(points[3].x, points[3].y);
        expect(r3).toBeGreaterThan(r1);
    });
});

describe('stress (pure)', () => {
    const ring = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];

    it('spreads a pile so linked nodes sit about one length apart', () => {
        const pile = Array.from({ length: 6 }, (_, i) => ({ x: 100 + i, y: 100 + (i % 2) }));
        const { points, fresh } = stress(pile, ring, { length: 80 });
        expect(fresh).toBe(true);
        for (const [s, t] of ring) {
            expect(Math.hypot(points[s].x - points[t].x, points[s].y - points[t].y)).toBeGreaterThan(60);
            expect(Math.hypot(points[s].x - points[t].x, points[s].y - points[t].y)).toBeLessThan(100);
        }
        expect(crossings(points, ring)).toBe(0);
    });

    it('never moves a fixed node, and places a new one beside its neighbours', () => {
        const start = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }, null];
        const { points } = stress(start, [[0, 1], [1, 2], [1, 3]], { length: 100, fixed: new Set([0, 1, 2]) });
        expect(points.slice(0, 3)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
        expect(Math.hypot(points[3].x - 100, points[3].y)).toBeGreaterThan(70);
        expect(Math.hypot(points[3].x - 100, points[3].y)).toBeLessThan(130);
    });
});

describe('tidy (pure)', () => {
    const sketch = [box(62, 84), box(196, 70), box(318, 92), box(55, 180), box(184, 192), box(328, 170)];

    it('snaps near rows and columns into lines, and is a fixed point', () => {
        const pts = tidy(sketch, { snap: 20 });
        expect(new Set(pts.map((p) => p.y)).size).toBe(2);
        expect(new Set(pts.map((p) => p.x)).size).toBe(3);
        const again = tidy(pts.map((p, i) => box(p.x, p.y, sketch[i].hw, sketch[i].hh)), { snap: 20 });
        expect(again).toEqual(pts);
    });

    it('lines a group up on a fixed box', () => {
        const pts = tidy([box(0, 100), box(100, 108), box(200, 95)], { snap: 20, fixed: new Set([1]) });
        expect(pts.map((p) => p.y)).toEqual([108, 108, 108]);
    });

    it('moves an overlapping node that stands alone to the nearest free cell', () => {
        const pts = tidy([box(60, 80), box(190, 80), box(60, 180), box(190, 180), box(60, 280), box(95, 280)], { snap: 20 });
        expect(pts[5]).toEqual({ x: 190, y: 280 });
    });
});

// ── the engine ───────────────────────────────────────────────────────────────
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.dom().remove()); setWarnings(false); });
setWarnings(false);

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    return el;
}

// Inner size 400 x 300 with identity scales, so a row's x and y are its pixel centre.
const networkSchema = {
    structure: 'network',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true, open: true },
            x: { type: 'quantitative' },
            y: { type: 'quantitative' },
        },
        links: { directed: true, fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
    },
};
const nodeMark = () => plot.rect({
    id: 'nodes',
    channels: {
        x: { field: 'x', scale: null },
        y: { field: 'y', scale: null },
        width: { value: 60, scale: null },
        height: { value: 30, scale: null },
    },
    edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' })],
});
const networkSpec = (nodes, links, layouts, extra = {}) => ({
    width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
    schema: networkSchema,
    data: { nodes, links },
    marks: [plot.link({ id: 'links' }), nodeMark()],
    layout: layouts,
    ...extra,
});
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const chainLinks = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['d', 'e'], ['c', 'f']].map(([source, target]) => ({ source, target }));
const at = (el) => Object.fromEntries(el.getData().nodes.map((d) => [d.id, d]));

describe('layout.network.layered in a chart', () => {
    it("places every row with no position (place: 'new') and leaves placed rows as they are", () => {
        const nodes = ids.map((id) => ({ id, x: null, y: null }));
        nodes[0] = { id: 'a', x: 50, y: 40 };
        const el = mount(networkSpec(nodes, chainLinks, [layout.network.layered()]));
        const rows = at(el);
        expect(rows.a).toEqual({ id: 'a', x: 50, y: 40 });
        for (const id of ids) {
            expect(Number.isFinite(rows[id].x)).toBe(true);
            expect(Number.isFinite(rows[id].y)).toBe(true);
        }
        for (const { source, target } of chainLinks) expect(rows[target].y).toBeGreaterThan(rows[source].y);
    });

    it('centres a drawing that had no positions at all in the plot', () => {
        const el = mount(networkSpec(ids.map((id) => ({ id, x: null, y: null })), chainLinks, [layout.network.layered()]));
        const rows = Object.values(at(el));
        const xs = rows.map((r) => r.x), ys = rows.map((r) => r.y);
        expect((Math.min(...xs) - 30 + Math.max(...xs) + 30) / 2).toBeCloseTo(200, 6);
        expect((Math.min(...ys) - 15 + Math.max(...ys) + 15) / 2).toBeCloseTo(150, 6);
    });

    it("re-lays every row on a commit with place: 'all', and a change to the links re-settles it", async () => {
        const nodes = ids.map((id, i) => ({ id, x: 40 + i * 60, y: 280 - i * 40 }));
        const el = mount(networkSpec(nodes, chainLinks.slice(0, 5), [layout.network.layered({ place: 'all' })], {
            marks: [plot.link({ id: 'links', edits: [edit.remove({ name: 'unlink', gesture: 'commit' })] }), nodeMark()],
        }));
        let rows = at(el);
        for (const { source, target } of chainLinks.slice(0, 5)) expect(rows[target].y).toBeGreaterThan(rows[source].y);
        // Removing the link d → e leaves e a root, so it moves up to the top rank.
        const before = rows.e.y;
        await new Promise((r) => setTimeout(r, 0));
        el.control('unlink', 4).fire();
        rows = at(el);
        expect(el.getData().links).toHaveLength(4);
        expect(rows.e.y).not.toBe(before);
    });

    it('never moves a locked row', () => {
        const nodes = ids.map((id, i) => ({ id, x: 40 + i * 60, y: 280 - i * 40 }));
        const el = mount(networkSpec(nodes, chainLinks, [layout.network.layered({ place: 'all' })], {
            lock: (d, i, table) => table === 'nodes' && d.id === 'a',
        }));
        expect(at(el).a).toEqual({ id: 'a', x: 40, y: 280 });
    });
});

describe('layout.network.tree and force in a chart', () => {
    it('draws a tree with each parent centred over its children', () => {
        const links = [['a', 'b'], ['a', 'c'], ['b', 'd'], ['b', 'e']].map(([source, target]) => ({ source, target }));
        const el = mount(networkSpec(ids.slice(0, 5).map((id) => ({ id, x: null, y: null })), links, [layout.network.tree()]));
        const r = at(el);
        expect(r.b.x).toBeCloseTo((r.d.x + r.e.x) / 2, 6);
        expect(r.a.y).toBeLessThan(r.b.y);
    });

    it('spreads a pile of nodes so no boxes overlap', () => {
        const nodes = ids.map((id, i) => ({ id, x: 200 + (i % 3) * 4, y: 150 + i * 2 }));
        const el = mount(networkSpec(nodes, chainLinks, [layout.network.force({ place: 'all', length: 90 })]));
        const rows = el.getData().nodes;
        const boxes = rows.map(() => ({ hw: 30, hh: 15 }));
        expect(overlaps(boxes, rows)).toBe(0);
    });
});

describe('layout.network.force in a small plot', () => {
    it('keeps every node inside the plot and clear of the others', () => {
        const ring = Array.from({ length: 12 }, (_, i) => String.fromCharCode(97 + i));
        const links = ring.map((id, i) => ({ source: id, target: ring[(i + 1) % ring.length] }));
        const el = mount({
            ...networkSpec(ring.map((id) => ({ id, x: null, y: null })), links, [layout.network.force({ place: 'all', length: 120 })]),
            width: 360, height: 260,
        });
        const rows = el.getData().nodes;
        expect(overlaps(rows.map(() => ({ hw: 30, hh: 15 })), rows)).toBe(0);
        for (const r of rows) {
            expect(r.x).toBeGreaterThanOrEqual(30 - 1e-6);
            expect(r.x).toBeLessThanOrEqual(330 + 1e-6);
            expect(r.y).toBeGreaterThanOrEqual(15 - 1e-6);
            expect(r.y).toBeLessThanOrEqual(245 + 1e-6);
        }
    });
});

describe('a network layout in a hierarchy with links', () => {
    const schema = {
        structure: 'hierarchy',
        tables: {
            nodes: {
                id: { type: 'categorical', key: true, open: true },
                kind: { type: 'categorical', domain: ['stage', 'step', 'note'] },
                x: { type: 'quantitative' },
                y: { type: 'quantitative' },
                w: { type: 'quantitative', default: 60 },
                h: { type: 'quantitative', default: 30 },
            },
            nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
            links: { directed: true, fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
        },
    };
    const steps = ['a', 'b', 'c', 'd', 'e'];
    const flows = [['a', 'b'], ['b', 'c'], ['a', 'd'], ['d', 'e']].map(([source, target]) => ({ source, target }));
    const spec = (place, positions) => ({
        width: 600, height: 400, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
        schema,
        data: {
            nodes: [
                { id: 'stage', kind: 'stage', x: 200, y: 200, w: 200, h: 150 },
                ...steps.map((id, i) => ({ id, kind: 'step', ...(positions ? { x: 150 + i * 20, y: 180 + (i % 2) * 30 } : { x: null, y: null }), w: 60, h: 30 })),
                { id: 'note', kind: 'note', x: 520, y: 60, w: 80, h: 40 },
            ],
            nesting: steps.map((child) => ({ child, parent: 'stage' })),
            links: flows,
        },
        marks: [
            plot.link(),
            plot.rect({ channels: { x: { field: 'x', scale: null }, y: { field: 'y', scale: null }, width: { field: 'w', scale: null }, height: { field: 'h', scale: null } } }),
        ],
        layout: [
            layout.hierarchy.contain({ padding: 10, fit: true }),
            layout.network.layered({ direction: 'right', where: (d) => d.kind === 'step', place }),
        ],
    });
    const check = (el) => {
        const r = Object.fromEntries(el.getData().nodes.map((d) => [d.id, d]));
        expect(r.note).toEqual({ id: 'note', kind: 'note', x: 520, y: 60, w: 80, h: 40 });
        for (const { source, target } of flows) expect(r[target].x).toBeGreaterThan(r[source].x);
        // The stage fits round the steps the layout placed.
        const s = r.stage;
        for (const id of steps) {
            expect(r[id].x - 30).toBeGreaterThanOrEqual(s.x - s.w / 2 + 10 - 1e-6);
            expect(r[id].x + 30).toBeLessThanOrEqual(s.x + s.w / 2 - 10 + 1e-6);
            expect(r[id].y - 15).toBeGreaterThanOrEqual(s.y - s.h / 2 + 10 - 1e-6);
            expect(r[id].y + 15).toBeLessThanOrEqual(s.y + s.h / 2 - 10 + 1e-6);
        }
        return r;
    };

    it("places only the rows `where` picks, and the container fits round them (place: 'all')", () => {
        const r = check(mount(spec('all', true)));
        // The steps stay round where they were drawn, not mid-plot.
        expect(Math.abs((r.a.x + r.c.x) / 2 - 190)).toBeLessThan(60);
    });

    it("places nested rows that arrive with no position (place: 'new')", () => {
        check(mount(spec('new', false)));
    });

    it('warns about a node its mark cannot size, and leaves it out', () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const s = spec('all', false);
        s.data.nodes = s.data.nodes.map((d) => (d.id === 'e' ? { id: 'e', kind: 'step', x: null, y: null } : d));
        mount(s);
        expect(spy.mock.calls.some(([m]) => String(m).includes('has no box to place'))).toBe(true);
        spy.mockRestore();
    });
});

describe('where, on any layout', () => {
    const flat = (layouts) => ({
        width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
        schema: { kind: { type: 'categorical', domain: ['a', 'b'] }, x: { type: 'quantitative' }, y: { type: 'quantitative' } },
        data: [
            { kind: 'a', x: 50, y: 60 }, { kind: 'b', x: 200, y: 250 }, { kind: 'a', x: 300, y: 140 }, { kind: 'b', x: 120, y: 200 },
        ],
        marks: [plot.rect({ channels: { x: { field: 'x', scale: null }, y: { field: 'y', scale: null }, width: { value: 40, scale: null }, height: { value: 20, scale: null } } })],
        layout: layouts,
    });

    it('slots only the rows `where` picks (layout.row)', () => {
        const el = mount(flat([layout.row({ where: (d) => d.kind === 'a', gap: 10 })]));
        const rows = el.getData();
        expect(rows[1]).toEqual({ kind: 'b', x: 200, y: 250 });
        expect(rows[3]).toEqual({ kind: 'b', x: 120, y: 200 });
        expect(rows[0].y).toBe(rows[2].y);
        expect(rows[2].x - rows[0].x).toBeCloseTo(50, 6);
    });

    it('lets layout.custom change only the rows `where` picks', () => {
        const el = mount(flat([layout.custom(({ rows, write }) => {
            rows.forEach((d, i) => write(i, { y: 10 }));
        }, { where: (d) => d.kind === 'b' })]));
        expect(el.getData().map((d) => d.y)).toEqual([60, 10, 140, 10]);
        const el2 = mount(flat([layout.custom(({ rows }) => rows.map((d) => ({ ...d, x: 0 })), { where: (d) => d.kind === 'a' })]));
        expect(el2.getData().map((d) => d.x)).toEqual([0, 200, 0, 120]);
    });

    it('compiles `where` from JSON on every layout', () => {
        const spec = compile({ layout: [
            { type: 'row', where: { expr: "datum.kind === 'a'" } },
            { type: 'network.force', where: { expr: "datum.kind === 'a'" } },
            { type: 'custom', fn: 'noop', where: { expr: "datum.kind === 'b'" } },
        ] }, { functions: { noop: () => {} } });
        expect(spec.layout[0].options.where({ kind: 'a' })).toBe(true);
        expect(spec.layout[1].options.where({ kind: 'b' })).toBe(false);
        expect(spec.layout[2].options.where({ kind: 'b' })).toBe(true);
    });
});

describe('scope', () => {
    it('warns and ignores a network layout on a dataset that is not a network', () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const data = [{ x: 10, y: 10 }, { x: 12, y: 11 }];
        const el = mount({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: { x: { type: 'quantitative' }, y: { type: 'quantitative' } },
            data,
            marks: [plot.point({ channels: { x: { field: 'x', scale: null }, y: { field: 'y', scale: null } } })],
            layout: [layout.network.force({ place: 'all' })],
        });
        expect(el.getData()).toEqual(data);
        expect(spy.mock.calls.some(([m]) => String(m).includes('layout.network.force() places nodes by their links, but this dataset has no links table'))).toBe(true);
        spy.mockRestore();
    });

    it('lines up a flat table with layout.tidy', () => {
        const data = [{ x: 62, y: 84 }, { x: 196, y: 70 }, { x: 318, y: 92 }, { x: 55, y: 180 }, { x: 184, y: 192 }, { x: 328, y: 170 }];
        const el = mount({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: { x: { type: 'quantitative' }, y: { type: 'quantitative' } },
            data,
            marks: [plot.rect({ channels: { x: { field: 'x', scale: null }, y: { field: 'y', scale: null }, width: { value: 60, scale: null }, height: { value: 30, scale: null } } })],
            layout: [layout.tidy({ snap: 20 })],
        });
        const rows = el.getData();
        expect(new Set(rows.map((d) => d.y)).size).toBe(2);
        expect(new Set(rows.map((d) => d.x)).size).toBe(3);
    });
});

describe('JSON', () => {
    it('compiles scoped layout keywords by their dotted type', () => {
        const spec = compile({
            layout: [
                { type: 'network.layered', direction: 'right', place: 'all' },
                { type: 'hierarchy.contain', fit: true },
                { type: 'tidy', snap: 12 },
            ],
        });
        expect(spec.layout).toEqual([
            layout.network.layered({ direction: 'right', place: 'all' }),
            layout.hierarchy.contain({ fit: true }),
            layout.tidy({ snap: 12 }),
        ]);
        expect(spec.layout[0]).toMatchObject({ type: 'network.layered', structure: 'network' });
    });
});
