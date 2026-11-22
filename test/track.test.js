// @vitest-environment jsdom
// plot.track: a value drawn as a length along a route. Only lanes hold value;
// joins are drawn but never counted. `move` on `length` follows the route.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings, compile } from '../src/index.js';
import { routeOf, alongRoute, trackFraction } from '../src/plot/trackGeometry.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);
afterEach(() => setWarnings(false));

// Two lanes 300px long, 10px apart: right along y=50, back left along y=60.
const TWO_LANES = 'M0,50 L300,50 M300,60 L0,60';

describe('trackGeometry', () => {
    it('reads lanes and counts only them', () => {
        const route = routeOf(TWO_LANES);
        expect(route.lanes.length).toBe(2);
        expect(route.total).toBeCloseTo(600);
        // A closed subpath runs back to its start.
        expect(routeOf('M0,0 L10,0 L10,10 Z').total).toBeCloseTo(10 + 10 + Math.hypot(10, 10));
        expect(routeOf('nonsense')).toBeNull();
    });

    it('draws the first fraction, with joins drawn but not counted', () => {
        const route = routeOf(TWO_LANES);
        const [half] = alongRoute(route, 0.25, 'round');
        expect(half[half.length - 1]).toEqual([150, 50]);
        // Into the second lane: one stretch through a round join that bulges right.
        const round = alongRoute(route, 0.75, 'round');
        expect(round.length).toBe(1);
        const end = round[0][round[0].length - 1];
        expect(end[0]).toBeCloseTo(150);
        expect(end[1]).toBeCloseTo(60);
        expect(Math.max(...round[0].map((p) => p[0]))).toBeGreaterThan(300);
        // 'none' draws each lane as its own stretch.
        expect(alongRoute(route, 0.75, 'none').length).toBe(2);
        // At exactly the end of a lane the next join is not drawn.
        const atTurn = alongRoute(route, 0.5, 'round');
        expect(Math.max(...atTurn[0].map((p) => p[0]))).toBeCloseTo(300);
        expect(alongRoute(route, 0, 'round')).toEqual([]);
    });

    it('takes the nearest fraction with no current value', () => {
        const route = routeOf(TWO_LANES);
        const t = { lanes: route.lanes.map((l) => l.pts), total: route.total };
        expect(trackFraction(t, { x: 150, y: 48 })).toBeCloseTo(0.25);
        expect(trackFraction(t, { x: 150, y: 62 })).toBeCloseTo(0.75);
    });

    it('follows the route from the current value instead of jumping lanes', () => {
        const route = routeOf(TWO_LANES);
        const t = { lanes: route.lanes.map((l) => l.pts), total: route.total };
        // Nearer the second lane, but the bar ends on the first: stay on it.
        expect(trackFraction(t, { x: 200, y: 56 }, 100 / 600, 16)).toBeCloseTo(200 / 600);
        // At the turn, the walk crosses into the second lane.
        expect(trackFraction(t, { x: 290, y: 60 }, 299 / 600, 16)).toBeCloseTo(310 / 600, 1);
        // Ending exactly at a lane's end, the bar can carry on into the next lane.
        expect(trackFraction(t, { x: 280, y: 60 }, 0.5, 16)).toBeCloseTo(320 / 600, 1);
        // Clearly on another part of the route (by more than the slack): jump.
        expect(trackFraction(t, { x: 100, y: 60 }, 10 / 600, 0)).toBeCloseTo(500 / 600);
    });
});

describe('plot.track', () => {
    function chart(channels = {}, extra = {}) {
        const el = Elicit({
            width: 400, height: 120, axes: false, margins: { top: 0, right: 0, bottom: 0, left: 0 },
            schema: { name: { type: 'categorical' }, v: { type: 'quantitative', domain: [0, 600] } },
            data: [{ name: 'a', v: 150 }],
            marks: [plot.track({
                path: TWO_LANES, join: 'round',
                channels: { length: { field: 'v', edit: edit.move() }, strokeWidth: { value: 6 }, ...channels },
            })],
            ...extra,
        });
        document.body.appendChild(el.dom());
        return el;
    }
    const nodes = (el) => [...el.dom().querySelectorAll('path')].map((p) => p.__data__).filter((n) => n && n.track);

    it('draws a hit path over the whole route and the bar from the value', async () => {
        const el = chart();
        await tick();
        const [hit, bar] = nodes(el);
        expect(hit.hit).toBe(true);
        expect(Math.max(...hit.points.map((p) => p[0]))).toBeGreaterThan(300);
        expect(bar.d).toMatch(/^M0,50L150,50$/);
        expect(bar.fill).toBe('none');
        expect(bar.track.total).toBeCloseTo(600);
    });

    it('move drags the end of the bar along the route and round the turn', async () => {
        const el = chart();
        await tick();
        const [, bar] = nodes(el);
        const path = [[150, 50], [250, 50], [298, 52], [306, 55], [298, 60], [200, 60]];
        el.emit({ type: 'dragstart', node: bar, x: path[0][0], y: path[0][1] });
        for (const [x, y] of path.slice(1)) el.emit({ type: 'drag', node: bar, x, y });
        el.emit({ type: 'dragend', node: bar, x: 200, y: 60 });
        // 300 along the first lane, then 100 back along the second.
        expect(el.getData()[0].v).toBeCloseTo(400, 0);
    });

    it('a drag past a nearby lane does not jump onto it', async () => {
        const el = chart();
        await tick();
        const [, bar] = nodes(el);
        el.emit({ type: 'dragstart', node: bar, x: 150, y: 50 });
        el.emit({ type: 'drag', node: bar, x: 100, y: 58 });
        el.emit({ type: 'dragend', node: bar, x: 100, y: 58 });
        expect(el.getData()[0].v).toBeCloseTo(100, 0);
    });

    it('slide still adds to the value', async () => {
        const el = chart({ length: { field: 'v', edit: edit.slide({ axis: 'y', increase: 'down', extent: 100 }) } });
        await tick();
        const [, bar] = nodes(el);
        el.emit({ type: 'dragstart', node: bar, x: 100, y: 50 });
        el.emit({ type: 'drag', node: bar, x: 100, y: 60 });
        el.emit({ type: 'dragend', node: bar, x: 100, y: 60 });
        expect(el.getData()[0].v).toBeCloseTo(210, 0);
    });

    it('places a unit-form path when x, y or size is bound', async () => {
        const el = Elicit({
            width: 200, height: 200, axes: false, margins: { top: 0, right: 0, bottom: 0, left: 0 },
            schema: { v: { type: 'quantitative', domain: [0, 1] } },
            data: [{ v: 1 }],
            marks: [plot.track({ path: 'M-1,0 L1,0', channels: { length: { field: 'v' }, x: { value: 100 }, y: { value: 40 }, size: { value: 50 } } })],
        });
        document.body.appendChild(el.dom());
        await tick();
        const bar = nodes(el)[1];
        expect(bar.d).toBe('M50,40L150,40');
    });

    it('compiles from JSON', async () => {
        const spec = compile({
            width: 400, height: 120, axes: false,
            schema: { v: { type: 'quantitative', domain: [0, 600] } },
            data: [{ v: 300 }],
            marks: [{ type: 'track', path: TWO_LANES, join: 'straight', channels: { length: { field: 'v', edit: { type: 'move' } } } }],
        });
        const el = Elicit(spec);
        document.body.appendChild(el.dom());
        await tick();
        expect(nodes(el).length).toBe(2);
    });

    it('warns when move on length has no route to read', async () => {
        const seen = [];
        const orig = console.warn;
        console.warn = (m) => seen.push(String(m));
        setWarnings(true);
        try {
            const el = Elicit({
                width: 200, height: 200, axes: false,
                schema: { v: { type: 'quantitative', domain: [0, 10] } },
                data: [{ v: 5 }],
                marks: [plot.shape({ channels: { x: { value: 100 }, y: { value: 100 }, length: { field: 'v', edit: edit.move() } } })],
            });
            document.body.appendChild(el.dom());
            await tick();
            const node = el.dom().querySelector('path').__data__;
            el.emit({ type: 'dragstart', node, x: 100, y: 100 });
            el.emit({ type: 'drag', node, x: 120, y: 100 });
            el.emit({ type: 'dragend', node, x: 120, y: 100 });
        } finally {
            console.warn = orig;
        }
        expect(seen.some((m) => m.includes('length') && m.includes('plot.track'))).toBe(true);
    });
});
