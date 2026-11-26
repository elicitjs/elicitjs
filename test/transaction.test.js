// @vitest-environment jsdom
// `transaction()` holds one undo entry open across any number of commits, whoever
// makes them: `set`, a control, a gesture.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.dom().remove()); });

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    return el;
}

const spec = () => ({
    width: 300, height: 200,
    schema: {
        x: { type: 'quantitative', domain: [0, 100] },
        y: { type: 'quantitative', domain: [0, 100] },
        w: { type: 'quantitative', domain: [10, 200] },
    },
    data: [{ x: 50, y: 50, w: 80 }, { x: 20, y: 20, w: 40 }],
    marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'y' }) } } })],
});

describe('transaction()', () => {
    it('makes several set() calls one undo entry', async () => {
        const el = mount(spec());
        await tick();
        const end = el.transaction();
        el.set('w', 120, { index: 0 });
        el.set('x', 60, { index: 0 });
        el.set('w', 140, { index: 0 });
        end();
        expect(el.getData()[0]).toEqual({ x: 60, y: 50, w: 140 });
        expect(el.undo()).toBe(true);
        expect(el.getData()[0]).toEqual({ x: 50, y: 50, w: 80 });
        expect(el.canUndo()).toBe(false);
        expect(el.redo()).toBe(true);
        expect(el.getData()[0]).toEqual({ x: 60, y: 50, w: 140 });
    });

    it('spans a set() and a controlled edit', async () => {
        const el = mount(spec());
        await tick();
        const end = el.transaction();
        el.set('w', 120, { index: 1 });
        el.control('y', 1).set(90);
        end();
        expect(el.getData()[1]).toMatchObject({ w: 120 });
        expect(el.getData()[1].y).toBeCloseTo(90, 6);
        el.undo();
        expect(el.getData()[1]).toEqual({ x: 20, y: 20, w: 40 });
        expect(el.canUndo()).toBe(false);
    });

    it('closes once: commits after end() are their own entries', async () => {
        const el = mount(spec());
        await tick();
        const end = el.transaction();
        el.set('w', 120, { index: 0 });
        end();
        end();
        el.set('w', 130, { index: 0 });
        el.undo();
        expect(el.getData()[0].w).toBe(120);
        el.undo();
        expect(el.getData()[0].w).toBe(80);
    });

    it('is closed by undo, so the next commit records again', async () => {
        const el = mount(spec());
        await tick();
        const end = el.transaction();
        el.set('w', 120, { index: 0 });
        el.undo();
        el.set('w', 130, { index: 0 });
        end();
        el.set('w', 150, { index: 0 });
        el.undo();
        expect(el.getData()[0].w).toBe(130);
    });

    it('that commits nothing leaves no entry', async () => {
        const el = mount(spec());
        await tick();
        el.transaction()();
        expect(el.canUndo()).toBe(false);
    });

    it('is the dataset\'s, shared by its charts', async () => {
        const ds = Elicit.dataset({ schema: spec().schema, data: spec().data });
        const end = ds.transaction();
        ds.set('w', 100, { index: 0 });
        ds.set('w', 110, { index: 0 });
        end();
        ds.undo();
        expect(ds.getData()[0].w).toBe(80);
    });
});
