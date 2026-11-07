// @vitest-environment jsdom
// plot.shape: one path per row, placed from a unit shape — named (d3 symbols)
// or an SVG path — so `size` is its box radius and `angle` rotates it; picked by
// its outline polygon on both renderers; a node for networks.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { parsePath, unitShape, placeShape, flatten } from '../src/plot/shapes.js';
import { pointInPolygon, hitTest } from '../src/edit/pick.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('shapes.js', () => {
    it('parses absolute, relative, H/V, S/T and arc commands', () => {
        expect(parsePath('M0,0 L10,0 l0,10 H0 V0 Z').map((s) => s.cmd)).toEqual(['M', 'L', 'L', 'L', 'L', 'Z']);
        expect(parsePath('M0 0 C1 1 2 1 3 0 S5 -1 6 0 Q7 1 8 0 T10 0').map((s) => s.cmd)).toEqual(['M', 'C', 'C', 'Q', 'Q']);
        const arc = parsePath('M0,0 A1,1 0 0 1 2,0');
        expect(arc.some((s) => s.cmd === 'C')).toBe(true);
        expect(parsePath('not a path')).toBeNull();
    });
    it('normalizes a named shape and a path to a unit box, and places it', () => {
        const star = unitShape('star');
        const pts = flatten(star.segments).flat();
        const maxAbs = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
        expect(maxAbs).toBeCloseTo(1, 6);
        const sq = unitShape('M0,0 L20,0 L20,20 L0,20 Z');
        const placed = placeShape(sq, 100, 50, 10);
        const xs = placed.points.map((p) => p[0]), ys = placed.points.map((p) => p[1]);
        expect(Math.min(...xs)).toBeCloseTo(90, 6);
        expect(Math.max(...xs)).toBeCloseTo(110, 6);
        expect(Math.min(...ys)).toBeCloseTo(40, 6);
        expect(placed.d.startsWith('M')).toBe(true);
    });
    it('rotates a triangle in place', () => {
        const tri = unitShape('M0,-1 L1,1 L-1,1 Z');
        const up = placeShape(tri, 0, 0, 10, 0).points;
        const turned = placeShape(tri, 0, 0, 10, 90).points;
        // The apex (0,-10) at 90° counter-clockwise on screen lands at (-10, 0).
        expect(up[0][1]).toBeCloseTo(-10, 6);
        expect(turned[0][0]).toBeCloseTo(-10, 6);
        expect(Math.abs(turned[0][1])).toBeLessThan(1e-6);
    });
    it('pointInPolygon', () => {
        const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
        expect(pointInPolygon(sq, 5, 5)).toBe(true);
        expect(pointInPolygon(sq, 15, 5)).toBe(false);
    });
});

describe('plot.shape', () => {
    function chart(extra = {}) {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] }, kind: { type: 'categorical', domain: ['cow', 'pig'] }, n: { type: 'quantitative', domain: [0, 20] } },
            data: [{ x: 2, y: 5, kind: 'cow', n: 10 }, { x: 8, y: 5, kind: 'pig', n: 15 }],
            marks: [plot.shape({ channels: { x: { field: 'x', edit: edit.move({ name: 'm' }) }, y: { field: 'y' }, symbol: { field: 'kind' }, size: { field: 'n' } } })],
            ...extra,
        });
        document.body.appendChild(el);
        return el;
    }
    it('draws one baked path per row with a polygon and a centre', async () => {
        const el = chart();
        await tick();
        const paths = [...el.querySelectorAll('path.mark-line')];
        expect(paths.length).toBe(2);
        const n = paths[0].__data__;
        expect(n.polygon).toBe(true);
        expect(n.points.length).toBeGreaterThan(2);
        expect(typeof n.cx).toBe('number');
        expect(n.d).toMatch(/^M/);
        // Two kinds → two different shapes.
        expect(paths[0].__data__.d.length).not.toBe(paths[1].__data__.d.length);
    });
    it('is picked inside its body and moved by the universal edits', async () => {
        const el = chart();
        await tick();
        const node = el.querySelector('path.mark-line').__data__;
        expect(hitTest([node], node.cx, node.cy)).toBe(node);
        el.control('m', 0).set(6);
        expect(el.getData()[0].x).toBeCloseTo(6, 3);
    });
    it('takes a path option (constant or function) and falls back loudly', async () => {
        const el = chart({ marks: [plot.shape({ path: (d) => (d.kind === 'cow' ? 'M0,0 L2,0 L1,2 Z' : 'nonsense'), channels: { x: { field: 'x' }, y: { field: 'y' } } })] });
        await tick();
        expect(el.querySelectorAll('path.mark-line').length).toBe(2);
    });
    it('declares a node box, so it can carry ports in a network', () => {
        const m = plot.shape({ channels: { x: { field: 'x' }, y: { field: 'y' }, size: { value: 9 } } });
        const box = m.nodeBox({ x: 1, y: 1 }, 0, [], { x: { encode: () => 10, invertible: true, kind: 'continuous' }, y: { encode: () => 20, invertible: true, kind: 'continuous' } }, 100, 100);
        expect(box.hw).toBe(9);
        expect(box.round).toBe(false);
    });
});
