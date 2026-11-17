// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { createMotion, easeRows, easeNodes, resolveMotion } from '../src/core/motion.js';

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
        document.body.appendChild(el.dom());
        vi.advanceTimersByTime(1); // the first render
        return el;
    };
    // The 60-wide boxes as drawn, by centre.
    const small = (el) => [...el.dom().querySelectorAll('rect')]
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

describe('easing built nodes', () => {
    const rects = (ys) => ys.map((y, index) => ({ type: 'rect', x: 0, y, width: 100, height: 20, index }));
    const keyOf = (n) => n.index;

    it('starts a node at its goal, eases it to a new one, and reports who is short', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        motion.begin();
        expect(easeNodes(track, rects([0, 40]), { keyOf }).size).toBe(0);
        vi.advanceTimersByTime(16); motion.begin();
        const next = rects([40, 0]);
        const short = easeNodes(track, next, { keyOf });
        expect(next[0].y).toBeGreaterThan(0);
        expect(next[0].y).toBeLessThan(8);
        expect(next[0].x).toBe(0);
        expect(short.size).toBe(2);
        let last = next;
        for (let k = 0; k < 60; k++) { vi.advanceTimersByTime(16); motion.begin(); last = rects([40, 0]); easeNodes(track, last, { keyOf }); }
        expect(last.map((n) => n.y)).toEqual([40, 0]);
        expect(motion.moving()).toBe(false);
    });

    it('draws a shifted node where it is held, then eases it home from there', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        motion.begin();
        easeNodes(track, rects([0, 40]), { keyOf });
        vi.advanceTimersByTime(16); motion.begin();
        const held = rects([0, 40]);
        const short = easeNodes(track, held, { keyOf, shift: (n) => (n.index === 0 ? { y: 25 } : null) });
        expect(held[0].y).toBe(25);
        expect(held[0].x).toBe(0);     // only the carried axis moves
        expect(held[1].y).toBe(40);
        expect(short.has(held[0])).toBe(true);
        expect(motion.moving()).toBe(false); // the pointer's events redraw it, not the clock
        vi.advanceTimersByTime(16); motion.begin();
        const free = rects([0, 40]);
        easeNodes(track, free, { keyOf });
        expect(free[0].y).toBeLessThan(25);
        expect(free[0].y).toBeGreaterThan(18); // no jump on release
        expect(motion.moving()).toBe(true);
    });

    it('leaves a path alone and moves a node\'s edit box with it', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        const scene = (y) => [
            { type: 'path', d: 'M0 0L1 1', index: 0 },
            { type: 'text', x: 5, y, index: 1, editBox: { x: 0, y: y - 8, width: 40, height: 16 } },
        ];
        motion.begin();
        easeNodes(track, scene(10), { keyOf });
        vi.advanceTimersByTime(16); motion.begin();
        const next = scene(50);
        easeNodes(track, next, { keyOf });
        expect(next[0].d).toBe('M0 0L1 1');
        expect(next[1].y).toBeLessThan(50);
        expect(next[1].editBox.y).toBeCloseTo(next[1].y - 8, 6);
    });

    it('redraws a placed path at its eased centre', () => {
        const motion = createMotion(200);
        const track = motion.track('t');
        const scene = (cy) => [{ type: 'path', d: 'old', cx: 10, cy, index: 0, placed: { unit: { segments: [] }, r: 4, angle: 0 } }];
        motion.begin();
        easeNodes(track, scene(10), { keyOf });
        vi.advanceTimersByTime(16); motion.begin();
        const next = scene(50);
        const redrawn = [];
        easeNodes(track, next, { keyOf, redraw: (n) => { redrawn.push(n.cy); n.d = 'new'; } });
        expect(next[0].cy).toBeLessThan(50);
        expect(redrawn).toEqual([next[0].cy]);
        expect(next[0].d).toBe('new');
    });

    it('takes one frame for the first step after a rest, however long the rest was', () => {
        const motion = createMotion(220);
        const track = motion.track('t');
        motion.begin();
        track.step(new Map([['a', { x: 0 }]]));
        vi.advanceTimersByTime(1000);
        motion.begin();
        expect(track.step(new Map([['a', { x: 100 }]])).get('a').x).toBeLessThan(15);
    });
});

describe('a ranked list with motion', () => {
    const chart = (extra = {}, markMotion = true) => {
        const el = Elicit({
            width: 200, height: 160, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: {
                item: { type: 'categorical' },
                rank: { type: 'ordinal', domain: [1, 2, 3, 4] },
            },
            scales: { y: { type: 'band', range: [0, 160] } },
            data: ['a', 'b', 'c', 'd'].map((item, i) => ({ item, rank: i + 1 })),
            marks: [
                plot.rect({
                    id: 'cards', motion: markMotion, width: 180, height: 30,
                    channels: { x: { value: 100 }, y: { field: 'rank', edit: edit.rank() } },
                }),
                plot.text({
                    id: 'labels', motion: markMotion,
                    channels: { x: { value: 100 }, y: { field: 'rank' }, text: { field: 'item' } },
                }),
            ],
            ...extra,
        });
        document.body.appendChild(el.dom());
        vi.advanceTimersByTime(1);
        return el;
    };
    // Card centres as drawn, by item (the label says which card is which).
    const drawn = (el) => {
        const out = {};
        for (const t of el.dom().querySelectorAll('text')) {
            if (/^[abcd]$/.test(t.textContent)) out[t.textContent] = +t.getAttribute('y');
        }
        return out;
    };
    const cardYs = (el) => [...el.dom().querySelectorAll('rect')]
        .filter((r) => +r.getAttribute('width') === 180)
        .map((r) => +r.getAttribute('y') + 15);
    const ranks = (el) => Object.fromEntries(el.getData().map((d) => [d.item, d.rank]));
    const node = { index: 0, featureId: 'cards' };
    // The four slot centres, top to bottom, read off the first drawing.
    const slotsOf = (el) => { const d = drawn(el); return [d.a, d.b, d.c, d.d]; };
    const near = (got, want) => { for (const k of Object.keys(want)) expect(got[k]).toBeCloseTo(want[k], 5); };

    it('puts rank 1 at the top', () => {
        const el = chart();
        const s = slotsOf(el);
        expect(s[0]).toBeLessThan(s[1]);
        expect(s[2]).toBeLessThan(s[3]);
        el.destroy();
    });

    it('draws the grabbed card and its label at the pointer inside a slot, and leaves the data alone', () => {
        const el = chart();
        const s = slotsOf(el);
        el.emit({ type: 'dragstart', node, x: 100, y: s[0] + 2 });
        el.emit({ type: 'drag', node, x: 100, y: s[0] + 12 });
        expect(ranks(el)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
        expect(drawn(el).a).toBeCloseTo(s[0] + 10, 5);   // the 2px grab offset is kept
        expect(cardYs(el).some((y) => Math.abs(y - (s[0] + 10)) < 1e-6)).toBe(true);
        expect(drawn(el).b).toBeCloseTo(s[1], 5);
        el.emit({ type: 'dragend', node, x: 100, y: s[0] + 12 });
        el.destroy();
    });

    it('rewrites the data as the pointer crosses a slot, and eases the others into place', () => {
        const el = chart();
        const s = slotsOf(el);
        const at = s[1] + 9;
        el.emit({ type: 'dragstart', node, x: 100, y: s[0] });
        el.emit({ type: 'drag', node, x: 100, y: at });
        expect(ranks(el)).toEqual({ a: 2, b: 1, c: 3, d: 4 }); // at once
        expect(drawn(el).a).toBeCloseTo(at, 5);                 // on the pointer
        expect(drawn(el).b).toBeCloseTo(s[1], 5);               // has not moved yet
        const seen = [];
        for (let k = 0; k < 40; k++) { frames(1); seen.push(drawn(el).b); }
        expect(seen[0]).toBeLessThan(s[1]);
        expect(seen[0]).toBeGreaterThan(s[1] - 12);
        seen.forEach((y, k) => { if (k) expect(seen[k - 1] - y).toBeLessThan(12); });
        expect(seen[seen.length - 1]).toBeCloseTo(s[0], 5);
        expect(drawn(el).a).toBeCloseTo(at, 5);
        el.emit({ type: 'dragend', node, x: 100, y: at });
        el.destroy();
    });

    it('eases the released card into its slot with no jump, and keeps it on top until it is home', () => {
        const el = chart();
        const s = slotsOf(el);
        const at = s[1] + 9;
        el.emit({ type: 'dragstart', node, x: 100, y: s[0] });
        el.emit({ type: 'drag', node, x: 100, y: at });
        frames(40);
        el.emit({ type: 'dragend', node, x: 100, y: at });
        expect(Math.abs(drawn(el).a - at)).toBeLessThan(2); // the release itself is no jump
        const lastCard = () => { const ys = cardYs(el); return ys[ys.length - 1]; };
        frames(1);
        expect(drawn(el).a).toBeLessThan(at);
        expect(drawn(el).a).toBeGreaterThan(s[1]);
        expect(lastCard()).toBeCloseTo(drawn(el).a, 5); // painted last: on top
        frames(40);
        near(drawn(el), { a: s[1], b: s[0], c: s[2], d: s[3] });
        el.destroy();
    });

    it('never carries the card past the first or last slot', () => {
        const el = chart();
        const s = slotsOf(el);
        el.emit({ type: 'dragstart', node, x: 100, y: s[0] });
        el.emit({ type: 'drag', node, x: 100, y: 400 });
        expect(drawn(el).a).toBeCloseTo(s[3], 5);
        expect(ranks(el).a).toBe(4);
        el.emit({ type: 'dragend', node, x: 100, y: 400 });
        el.destroy();
    });

    it('eases an undo and a redo, with the data restored at once', () => {
        const el = chart();
        const s = slotsOf(el);
        el.emit({ type: 'dragstart', node, x: 100, y: s[0] });
        el.emit({ type: 'drag', node, x: 100, y: s[2] });
        el.emit({ type: 'dragend', node, x: 100, y: s[2] });
        frames(40);
        near(drawn(el), { a: s[2], b: s[0], c: s[1], d: s[3] });
        el.undo();
        expect(ranks(el)).toEqual({ a: 1, b: 2, c: 3, d: 4 });
        frames(1);
        expect(drawn(el).a).toBeLessThan(s[2]);
        expect(drawn(el).a).toBeGreaterThan(s[2] - 24);
        frames(40);
        near(drawn(el), { a: s[0], b: s[1], c: s[2], d: s[3] });
        el.redo();
        frames(40);
        near(drawn(el), { a: s[2], b: s[0], c: s[1], d: s[3] });
        el.destroy();
    });

    it('draws every change at once without the mark option, with spec.motion off, and under reduced motion', () => {
        const still = (el) => {
            const s = slotsOf(el);
            el.emit({ type: 'dragstart', node, x: 100, y: s[0] });
            el.emit({ type: 'drag', node, x: 100, y: s[0] + 12 });
            expect(drawn(el).a).toBeCloseTo(s[0], 5);   // not carried
            el.emit({ type: 'drag', node, x: 100, y: s[1] + 9 });
            near(drawn(el), { a: s[1], b: s[0], c: s[2], d: s[3] });
            el.emit({ type: 'dragend', node, x: 100, y: s[1] + 9 });
            el.destroy();
        };
        still(chart({}, false));
        still(chart({ motion: false }));
        const original = globalThis.matchMedia;
        globalThis.matchMedia = () => ({ matches: true });
        still(chart());
        globalThis.matchMedia = original;
    });

    it('draws new data at once', () => {
        const el = chart();
        const s = slotsOf(el);
        el.setData(['a', 'b', 'c', 'd'].map((item, i) => ({ item, rank: 4 - i })));
        frames(1);
        near(drawn(el), { a: s[3], b: s[2], c: s[1], d: s[0] });
        el.destroy();
    });
});

describe('motion on a continuous drag', () => {
    it('keeps the grabbed node on the data: nothing is carried', () => {
        const el = Elicit({
            width: 200, height: 200, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 200] }, y: { type: 'quantitative', domain: [0, 200] } },
            data: [{ x: 50, y: 50 }, { x: 150, y: 150 }],
            marks: [plot.point({
                id: 'dots', motion: true, size: 6,
                channels: { x: { field: 'x' }, y: { field: 'y' } },
                edits: [edit.move({ channels: ['x', 'y'] })],
            })],
        });
        document.body.appendChild(el.dom());
        vi.advanceTimersByTime(1);
        const node = { index: 0, featureId: 'dots' };
        el.emit({ type: 'dragstart', node, x: 50, y: 150 });
        el.emit({ type: 'drag', node, x: 90, y: 120 });
        const c = el.dom().querySelectorAll('circle')[0];
        expect(+c.getAttribute('cx')).toBe(90);
        expect(+c.getAttribute('cy')).toBe(120);
        expect(el.getData()[0]).toMatchObject({ x: 90, y: 80 });
        el.emit({ type: 'dragend', node, x: 90, y: 120 });
        el.destroy();
    });
});
