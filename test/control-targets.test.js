// @vitest-environment jsdom
// `chart.control(name, i)` aims at the node the edit acts on (a stack's edge
// handle, an area's y2 handle), and warns instead of doing nothing in silence.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.dom().remove()); });

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    return el;
}

function captureWarnings(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; }
    return seen;
}

const stackSpec = (edits) => ({
    width: 300, height: 100,
    schema: { cause: { type: 'categorical', domain: ['a', 'b', 'c'] }, share: { type: 'quantitative', domain: [0, 100] } },
    data: [{ cause: 'a', share: 30 }, { cause: 'b', share: 30 }, { cause: 'c', share: 40 }],
    marks: [plot.barX({ edits, channels: { x: { field: 'share' }, stack: { field: 'cause' }, fill: { field: 'cause' } } })],
});

const pointSpec = (yEdit, extra = {}) => ({
    width: 300, height: 200,
    schema: { x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 100] } },
    data: [0, 1, 2].map((x) => ({ x, y: 50 })),
    marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: yEdit } }, ...extra })],
});

describe('control() targets the node the edit acts on', () => {
    it('fires stack.merge on the edge handle above row i', async () => {
        const el = mount(stackSpec([edit.stack.merge({ name: 'merge' })]));
        await tick();
        el.control('merge', 0).fire();
        expect(el.getData()).toEqual([{ cause: 'a', share: 60 }, { cause: 'c', share: 40 }]);
    });

    it('drives stack.edge by pixels through begin / emit / end, keeping the total', async () => {
        const el = mount(stackSpec([edit.stack.edge({ name: 'edge' })]));
        await tick();
        const c = el.control('edge', 0);
        c.begin();
        c.emit({ type: 'drag', x: 100, y: 50 });
        c.end();
        const [a, b, rest] = el.getData().map((d) => d.share);
        expect(a).not.toBe(30);
        expect(a + b).toBeCloseTo(60, 6);
        expect(rest).toBe(40);
        expect(el.undo()).toBe(true);
        expect(el.getData().map((d) => d.share)).toEqual([30, 30, 40]);
    });

    it('drives the y2 handle of an area span', async () => {
        const el = mount({
            width: 300, height: 200,
            schema: { x: { type: 'quantitative', domain: [0, 4] }, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
            data: [0, 1, 2, 3, 4].map((x) => ({ x, lo: 20, hi: 80 })),
            marks: [plot.areaY({ channels: { x: { field: 'x' }, y1: { field: 'lo', edit: edit.move({ name: 'lo' }) }, y2: { field: 'hi', edit: edit.move({ name: 'hi' }) } } })],
        });
        await tick();
        el.control('lo', 2).set(10);
        el.control('hi', 2).set(90);
        expect(el.getData()[2].lo).toBeCloseTo(10, 6);
        expect(el.getData()[2].hi).toBeCloseTo(90, 6);
    });
});

describe('control() warns instead of doing nothing', () => {
    it('for a row with no node the edit acts on (the last stack segment)', async () => {
        const el = mount(stackSpec([edit.stack.merge({ name: 'merge' })]));
        await tick();
        const w = captureWarnings(() => el.control('merge', 2).fire());
        expect(el.getData()).toHaveLength(3);
        expect(w.some((m) => m.includes('row 2 draws no node'))).toBe(true);
    });

    it('for a row index out of range', async () => {
        const el = mount(pointSpec(edit.move({ name: 'y' })));
        await tick();
        const w = captureWarnings(() => el.control('y', 7).set(10));
        expect(el.getData().every((d) => d.y === 50)).toBe(true);
        expect(w.some((m) => m.includes('there is no row 7'))).toBe(true);
    });

    it('for an edit at another stage', async () => {
        const el = mount(pointSpec(edit.move({ name: 'y', stage: 1 })));
        await tick();
        const w = captureWarnings(() => el.control('y', 0).set(10));
        expect(el.getData()[0].y).toBe(50);
        expect(w.some((m) => m.includes('runs at stage 1'))).toBe(true);
        el.setStage(1);
        el.control('y', 0).set(10);
        expect(el.getData()[0].y).toBeCloseTo(10, 6);
    });

    it('for an edit whose `when` reads a modifier key', async () => {
        const el = mount(pointSpec(undefined, { edits: [edit.remove({ name: 'rm', when: edit.when.alt })] }));
        await tick();
        const w = captureWarnings(() => el.control('rm', 0).fire());
        expect(el.getData()).toHaveLength(3);
        expect(w.some((m) => m.includes('`when` declined'))).toBe(true);
    });

    it('for set() on a slide, whose value is not read off a scale', async () => {
        const el = mount(pointSpec(edit.slide({ name: 's', axis: 'y' })));
        await tick();
        const w = captureWarnings(() => el.control('s', 0).set(80));
        expect(el.getData()[0].y).toBe(50);
        expect(w.some((m) => m.includes('set(): this slide edit'))).toBe(true);
    });
});

describe('control() strokes', () => {
    it('set() on a relative move runs a whole stroke: exact, one undo entry', async () => {
        const el = mount(pointSpec(edit.move({ name: 'y', mode: 'relative' })));
        await tick();
        el.control('y', 1).set(80);
        expect(el.getData()[1].y).toBeCloseTo(80, 6);
        expect(el.undo()).toBe(true);
        expect(el.getData()[1].y).toBe(50);
        expect(el.canUndo()).toBe(false);
    });

    it('begin() and end() pair up across handles; end() alone does nothing', async () => {
        const el = mount(pointSpec(edit.move({ name: 'y' })));
        await tick();
        el.control('y', 0).end();
        expect(el.canUndo()).toBe(false);
        el.control('y', 0).begin();
        el.control('y', 0).set(20);
        el.control('y', 0).set(30);
        el.control('y', 0).end();
        expect(el.getData()[0].y).toBeCloseTo(30, 6);
        expect(el.undo()).toBe(true);
        expect(el.canUndo()).toBe(false);
    });

    it('set() on another row while a stroke is open warns', async () => {
        const el = mount(pointSpec(edit.move({ name: 'y' })));
        await tick();
        el.control('y', 0).begin();
        const w = captureWarnings(() => el.control('y', 1).set(20));
        el.control('y', 0).end();
        expect(el.getData()[1].y).toBe(50);
        expect(w.some((m) => m.includes('opened a stroke on another row'))).toBe(true);
    });
});
