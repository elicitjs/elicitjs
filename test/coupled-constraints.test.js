// @vitest-environment jsdom
// `follow` carries a range with its lead column; `symmetric` mirrors a pair
// about a centre. With `ordering` they couple any mean-with-interval glyph,
// and widgets.interval is built on them.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, constraints, widgets, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function glyph(extraConstraints = []) {
    const el = Elicit({
        width: 300, height: 300,
        schema: { k: { type: 'categorical', domain: ['a'] }, lo: { type: 'quantitative', domain: [0, 100] }, mean: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
        data: [{ k: 'a', lo: 30, mean: 50, hi: 70 }],
        constraints: [constraints.follow({ field: ['lo', 'hi'], lead: 'mean' }), ...extraConstraints, constraints.ordering({ field: ['lo', 'mean', 'hi'] })],
        marks: [
            plot.ruleY({ channels: { x: { field: 'k' }, y1: { field: 'lo' }, y2: { field: 'hi' } } }),
            plot.point({ channels: { x: { field: 'k' }, y: { field: 'mean', edit: edit.move({ name: 'mean' }) } } }),
            plot.tickY({ channels: { x: { field: 'k' }, y: { field: 'lo', edit: edit.move({ name: 'lo' }) } } }),
            plot.tickY({ channels: { x: { field: 'k' }, y: { field: 'hi', edit: edit.move({ name: 'hi' }) } } }),
        ],
    });
    document.body.appendChild(el);
    return el;
}

describe('follow', () => {
    it('moves lo and hi with the mean, by the same delta', async () => {
        const el = glyph();
        await tick();
        el.control('mean', 0).set(60);
        const r = el.getData()[0];
        expect(r.mean).toBeCloseTo(60, 6);
        expect(r.lo).toBeCloseTo(40, 6);
        expect(r.hi).toBeCloseTo(80, 6);
    });
    it('leaves the mean alone when an end moves (independent ends)', async () => {
        const el = glyph();
        await tick();
        el.control('lo', 0).set(20);
        const r = el.getData()[0];
        expect(r.lo).toBeCloseTo(20, 6);
        expect(r.mean).toBe(50);
        expect(r.hi).toBe(70);
    });
    it('is an inert descriptor without its options', () => {
        const c = constraints.follow();
        expect(c.type).toBe('follow');
        expect(c.apply({ data: [], oldData: [], activeIndex: 0, active: {}, fields: [] })).toBeUndefined();
    });
});

describe('symmetric', () => {
    it('mirrors the other end about the mean when one end moves', async () => {
        const el = glyph([constraints.symmetric({ field: ['lo', 'hi'], about: 'mean' })]);
        await tick();
        el.control('lo', 0).set(20);
        let r = el.getData()[0];
        expect(r.lo).toBeCloseTo(20, 6);
        expect(r.hi).toBeCloseTo(80, 6);
        expect(r.mean).toBe(50);
        el.control('hi', 0).set(55);
        r = el.getData()[0];
        expect(r.hi).toBeCloseTo(55, 6);
        expect(r.lo).toBeCloseTo(45, 6);
    });
    it('does nothing when the mean moves (follow already carried both)', async () => {
        const el = glyph([constraints.symmetric({ field: ['lo', 'hi'], about: 'mean' })]);
        await tick();
        el.control('mean', 0).set(55);
        const r = el.getData()[0];
        expect(r.lo).toBeCloseTo(35, 6);
        expect(r.hi).toBeCloseTo(75, 6);
    });
});

describe('widgets.interval', () => {
    it('moves both caps with the mean, and mirrors with symmetric: true', async () => {
        const el = Elicit(widgets.interval({ mean: 50, lo: 30, hi: 70 }));
        document.body.appendChild(el);
        await tick();
        // Find the mean's edit through the composite: the point part carries it.
        const circle = el.querySelector('circle.mark');
        expect(circle).not.toBeNull();
        const node = { ...circle.__data__ };
        const cy = +circle.getAttribute('cy');
        el.emit({ type: 'dragstart', node, x: +circle.getAttribute('cx'), y: cy });
        el.emit({ type: 'drag', node, x: +circle.getAttribute('cx'), y: cy - 20 });
        el.emit({ type: 'dragend', node, x: +circle.getAttribute('cx'), y: cy - 20 });
        const r = el.getData()[0];
        expect(r.mean).toBeGreaterThan(50);
        expect(r.hi - r.lo).toBeCloseTo(40, 6);
        const sym = Elicit(widgets.interval({ mean: 50, lo: 30, hi: 70, symmetric: true }));
        document.body.appendChild(sym);
        await tick();
        const spec = widgets.interval({ symmetric: true });
        expect(spec.constraints.some((c) => c.type === 'symmetric')).toBe(true);
    });
});
