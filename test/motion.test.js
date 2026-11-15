// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { createMotion, easeRows, resolveMotion } from '../src/core/motion.js';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => { vi.useRealTimers(); });

const frames = (n) => { for (let k = 0; k < n; k++) vi.advanceTimersByTime(16); };

describe('a motion track', () => {
    const goals = (x) => new Map([['a', { x }]]);

    it('starts a new key at its goal, then eases to a new goal without overshoot', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        motion.begin();
        expect(track.step(goals(0)).get('a').x).toBe(0);
        const seen = [];
        for (let k = 0; k < 40; k++) {
            vi.advanceTimersByTime(16);
            motion.begin();
            seen.push(track.step(goals(100)).get('a').x);
        }
        expect(seen[0]).toBeGreaterThan(0);
        expect(seen[0]).toBeLessThan(15); // eases in
        seen.forEach((x, k) => { if (k) expect(x).toBeGreaterThanOrEqual(seen[k - 1]); });
        expect(Math.max(...seen)).toBe(100); // arrives exactly, never past
        expect(motion.moving()).toBe(false);
    });

    it('bends toward a goal that changes mid-flight, with no jump', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        motion.begin();
        track.step(goals(0));
        let last = 0;
        const step = (g) => { vi.advanceTimersByTime(16); motion.begin(); return track.step(goals(g)).get('a').x; };
        for (let k = 0; k < 5; k++) last = step(100);
        const turned = step(-100);
        expect(Math.abs(turned - last)).toBeLessThan(12);
        expect(motion.moving()).toBe(true);
    });

    it('never eases a fixed key, and snaps on request', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        motion.begin();
        track.step(goals(0));
        vi.advanceTimersByTime(16); motion.begin();
        expect(track.step(goals(50), { fixed: () => true }).get('a').x).toBe(50);
        vi.advanceTimersByTime(16); motion.begin();
        expect(track.step(goals(90), { snap: true }).get('a').x).toBe(90);
        expect(motion.moving()).toBe(false);
    });

    it('eases any table\'s rows through their columns, and hands back the rows once arrived', () => {
        const motion = createMotion(200);
        const track = motion.track('rows');
        // a column drawn at twice its value
        const columns = [{ field: 'v', encode: (v) => v * 2, invert: (px) => px / 2 }];
        const opts = { keyOf: (row) => row.id };
        const at = (v) => [{ id: 'a', v, note: 'kept' }];
        motion.begin();
        easeRows(track, at(0), columns, opts);
        vi.advanceTimersByTime(16); motion.begin();
        const goal = at(10);
        const mid = easeRows(track, goal, columns, opts);
        expect(mid).not.toBe(goal);
        expect(mid[0].v).toBeGreaterThan(0);
        expect(mid[0].v).toBeLessThan(10);
        expect(mid[0].note).toBe('kept');
        let out = mid;
        for (let k = 0; k < 40; k++) { vi.advanceTimersByTime(16); motion.begin(); out = easeRows(track, goal, columns, opts); }
        expect(out).toBe(goal);
    });
});

describe('spec.motion', () => {
    it('resolves to a duration, and to none when off or when reduced motion is asked for', () => {
        expect(resolveMotion(undefined)).toBe(220);
        expect(resolveMotion(false)).toBe(0);
        expect(resolveMotion({ duration: 90 })).toBe(90);
        const original = globalThis.matchMedia;
        globalThis.matchMedia = () => ({ matches: true });
        expect(resolveMotion({ duration: 90 })).toBe(0);
        globalThis.matchMedia = original;
    });

    it('warns on an option it does not have', () => {
        const warnings = [];
        const original = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        setWarnings(true);
        resolveMotion({ speed: 2 });
        setWarnings(false);
        console.warn = original;
        expect(warnings.some((w) => w.includes('[elicit]') && w.includes('speed'))).toBe(true);
    });
});

describe('a hierarchy drag with motion', () => {
    const nest = (child, parent) => ({ child, parent });
    const box = (id, x, y, w = 40, h = 20) => ({ id, x, y, w, h });
    const schema = {
        structure: 'hierarchy',
        tables: {
            nodes: {
                id: { type: 'categorical', key: true },
                x: { type: 'quantitative', domain: [0, 400] }, y: { type: 'quantitative', domain: [0, 300] },
                w: { type: 'quantitative', domain: [0, 400] }, h: { type: 'quantitative', domain: [0, 300] },
            },
            nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
        },
    };
    const chart = (motion) => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion,
            schema,
            data: {
                nodes: [box('g', 200, 150, 200, 200), box('a', 150, 200, 60, 30), box('b', 250, 100, 60, 30)],
                nesting: [nest('a', 'g'), nest('b', 'g')],
            },
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                    contains: { fn: (d) => d.id === 'g' }, dodge: true,
                },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el);
        vi.advanceTimersByTime(1); // the first render
        return el;
    };
    // The 60-wide boxes as drawn, by centre.
    const small = (el) => [...el.querySelectorAll('rect')]
        .filter((r) => +r.getAttribute('width') === 60)
        .map((r) => ({ x: +r.getAttribute('x') + 30, y: +r.getAttribute('y') + 15 }));
    // b is the one that is not under the pointer.
    const drawnB = (el, pointer) => small(el)
        .sort((p, q) => Math.hypot(q.x - pointer.x, q.y - pointer.y) - Math.hypot(p.x - pointer.x, p.y - pointer.y))[0];
    const node = { index: 1, featureId: 'boxes' };
    const to = { x: 250, y: 200 }; // a dropped on b

    it('eases a sibling out of the way, keeps the dragged node on the pointer, and leaves the data alone', () => {
        const el = chart(undefined);
        el.emit({ type: 'dragstart', node, x: 150, y: 100 });
        el.emit({ type: 'drag', node, ...to });
        // the node in flight is drawn at the pointer at once
        expect(small(el).some((r) => Math.abs(r.x - 250) < 0.01 && Math.abs(r.y - 200) < 0.01)).toBe(true);
        // b has not moved yet
        expect(drawnB(el, to).y).toBeCloseTo(200, 1);
        const ys = [];
        for (let k = 0; k < 40; k++) { frames(1); ys.push(drawnB(el, to).y); }
        const steps = ys.map((y, k) => Math.abs(y - (k ? ys[k - 1] : 200)));
        expect(Math.max(...steps)).toBeLessThan(12); // no jump
        expect(Math.abs(ys[ys.length - 1] - 200)).toBeGreaterThan(20); // it made room
        expect(el.getData().nodes[2].y).toBe(100); // the data waits for the release
        el.emit({ type: 'dragend', node, ...to });
        // the data is final at once, where the drawing already was
        expect(300 - el.getData().nodes[2].y).toBeCloseTo(ys[ys.length - 1], 1);
        frames(40);
        expect(drawnB(el, to).y).toBeCloseTo(300 - el.getData().nodes[2].y, 3);
    });

    it('draws every change at once with `motion: false`', () => {
        const el = chart(false);
        el.emit({ type: 'dragstart', node, x: 150, y: 100 });
        el.emit({ type: 'drag', node, ...to });
        const shown = drawnB(el, to).y;
        expect(Math.abs(shown - 200)).toBeGreaterThan(20);
        frames(10);
        expect(drawnB(el, to).y).toBe(shown);
    });

    it('draws data from outside at once', () => {
        const el = chart(undefined);
        const data = el.getData();
        el.setData({ ...data, nodes: data.nodes.map((d) => (d.id === 'b' ? { ...d, x: 160, y: 120 } : d)) });
        vi.advanceTimersByTime(0);
        const b = el.getData().nodes[2];
        expect(small(el).some((r) => Math.abs(r.x - b.x) < 0.01 && Math.abs(r.y - (300 - b.y)) < 0.01)).toBe(true);
    });
});
