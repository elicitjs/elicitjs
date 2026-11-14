// @vitest-environment jsdom
// Regression tests for the constraint, edit and guide fixes of the audit.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Elicit, plot, edit, constraints, guides, setWarnings } from '../src/index.js';
import { applyConstraint } from '../src/constraints/define.js';
import { GUIDE_OPTIONS, GUIDE_UNIVERSAL_OPTIONS } from '../src/vocabulary.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

const day = (n) => new Date(Date.UTC(2024, 0, n));
const DAY = 24 * 3600 * 1000;

describe('unique', () => {
    it('accepts an edit that writes no column when it names no field', () => {
        const rows = [{ a: 1 }, { a: 2 }];
        expect(applyConstraint(constraints.unique(), rows, rows, {})).toBeUndefined();
    });
});

describe('maintainSum redistribute', () => {
    it('splits a negative budget in proportion, not evenly', () => {
        const old = [{ v: -50 }, { v: -30 }, { v: -20 }];
        const next = [{ v: -60 }, { v: -30 }, { v: -20 }];
        const out = applyConstraint(
            constraints.maintainSum({ total: -100, field: 'v', strategy: 'redistribute' }),
            next, old, { activeIndex: 0 },
        );
        expect(out[0].v).toBe(-60);
        expect(out[1].v).toBeCloseTo(-24, 6);
        expect(out[2].v).toBeCloseTo(-16, 6);
    });
});

describe('Date columns stay Dates', () => {
    it('ordering', () => {
        const old = [{ lo: day(1), hi: day(5) }];
        const next = [{ lo: day(8), hi: day(5) }];
        const out = applyConstraint(constraints.ordering({ field: ['lo', 'hi'] }), next, old, { activeIndex: 0 });
        expect(out[0].lo).toBeInstanceOf(Date);
        expect(out[0].hi).toBeInstanceOf(Date);
        expect(out[0].hi.getTime()).toBe(day(8).getTime());
    });
    it('spacing', () => {
        const old = [{ t: day(1) }, { t: day(5) }];
        const next = [{ t: day(5) }, { t: day(5) }];
        const out = applyConstraint(constraints.spacing({ field: 't', min: DAY }), next, old, { activeIndex: 0 });
        expect(out[1].t).toBeInstanceOf(Date);
        expect(out[1].t.getTime()).toBe(day(6).getTime());
    });
    it('spacing, capped at the domain', () => {
        const old = [{ t: day(1) }, { t: day(5) }];
        const next = [{ t: day(1) }, { t: day(12) }];
        const out = applyConstraint(constraints.spacing({ field: 't', min: DAY }), next, old,
            { activeIndex: 1, schema: { t: { domain: [day(1), day(10)] } } });
        expect(out[1].t).toBeInstanceOf(Date);
        expect(out[1].t.getTime()).toBe(day(10).getTime());
    });
    it('monotonic', () => {
        const old = [{ x: 0, t: day(1) }, { x: 1, t: day(5) }];
        const next = [{ x: 0, t: day(8) }, { x: 1, t: day(5) }];
        const out = applyConstraint(constraints.monotonic({ field: 't', along: 'x' }), next, old, { activeIndex: 0 });
        expect(out[1].t).toBeInstanceOf(Date);
        expect(out[1].t.getTime()).toBe(day(8).getTime());
    });
    it('monotonic, capped by a locked row', () => {
        const old = [{ x: 0, t: day(1) }, { x: 1, t: day(5) }];
        const next = [{ x: 0, t: day(8) }, { x: 1, t: day(5) }];
        const out = applyConstraint(constraints.monotonic({ field: 't', along: 'x' }), next, old,
            { activeIndex: 0, locked: (_row, i) => i === 1 });
        expect(out[0].t).toBeInstanceOf(Date);
        expect(out[0].t.getTime()).toBe(day(5).getTime());
    });
});

describe("an edit's own guard survives a caller's `when`", () => {
    const yes = () => true;
    const body = { node: { channel: 'body' }, pointer: { x: 0, y: 0 }, marks: [] };
    it('geo.dragVertex', () => {
        expect(edit.geo.dragVertex({ when: yes }).when(body)).toBe(false);
        expect(edit.geo.dragVertex({ when: yes }).when({ node: { channel: 'vertex' } })).toBe(true);
        expect(edit.geo.dragVertex({ when: () => false }).when({ node: { channel: 'vertex' } })).toBe(false);
    });
    it('geo.removeVertex', () => {
        expect(edit.geo.removeVertex({ when: yes }).when(body)).toBe(false);
    });
    it('geo.createRect', () => {
        const over = { pointer: { x: 5, y: 5 }, marks: [{ type: 'rect', index: 0, x: 0, y: 0, width: 10, height: 10 }] };
        expect(edit.geo.createRect({ when: yes }).when(over)).toBe(false);
        expect(edit.geo.createRect({ when: yes }).when({ pointer: { x: 50, y: 50 }, marks: over.marks })).toBe(true);
    });
    it('network.rewire', () => {
        expect(edit.network.rewire({ when: yes }).when(body)).toBe(false);
        expect(edit.network.rewire({ when: yes }).when({ node: { channel: 'source' } })).toBe(true);
    });
});

describe('a fast sweep over bars', () => {
    it('paints every bar it crossed between two pointer events', async () => {
        const cats = ['a', 'b', 'c', 'd', 'e'];
        const el = Elicit({
            width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { k: { type: 'categorical', domain: cats }, v: { type: 'quantitative', domain: [0, 100] } },
            data: cats.map((k) => ({ k, v: 20 })),
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move({ pick: 'sweep' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        // One jump from the first bar to the last, at value 80 (y = 200 - 160).
        el.emit({ type: 'dragstart', x: 20, y: 40 });
        el.emit({ type: 'drag', x: 280, y: 40 });
        el.emit({ type: 'dragend', x: 280, y: 40 });
        const vs = el.getData().map((d) => d.v);
        expect(vs.every((v) => v > 70)).toBe(true);
    });
});

describe('line.removeSeries', () => {
    it('removes every row of a Date-keyed series', () => {
        const data = [{ s: day(1), y: 1 }, { s: day(1), y: 2 }, { s: day(2), y: 3 }];
        const out = edit.line.removeSeries().apply({ data, datum: data[0], index: 0, seriesKey: 's' });
        expect(out).toEqual([data[2]]);
    });
});

describe('line.newSeries', () => {
    it('never writes a column the line does not encode as a field', async () => {
        const el = Elicit({
            width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { t: { type: 'quantitative', domain: [0, 10] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [],
            marks: [
                plot.point({ channels: { x: { field: 't' }, y: { field: 'v' } } }),
                plot.lineY({ channels: { x: { field: 't' }, y: { value: 50 } }, edits: [edit.line.newSeries()] }),
            ],
        });
        document.body.appendChild(el);
        await tick();
        el.emit({ type: 'dblclick', x: 100, y: 100 });
        for (const row of el.getData()) {
            expect(Object.keys(row)).not.toContain('y');
            expect(Object.keys(row)).not.toContain('undefined');
        }
    });
});

describe('maintainSum guide', () => {
    it('draws no NaN cap when a row has no value yet', async () => {
        const el = Elicit({
            width: 320, height: 220,
            schema: { k: { type: 'categorical', domain: ['a', 'b', 'c'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 20 }, { k: 'b', v: 30 }, { k: 'c' }],
            constraints: [constraints.maintainSum({ total: 100, field: 'v' })],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move({ guide: true }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        // One cap per bar; a NaN position reaches the DOM as a missing attribute.
        const caps = [...el.querySelectorAll('line.guide-line')];
        expect(caps.length).toBe(3);
        expect(caps.every((l) => Number.isFinite(parseFloat(l.getAttribute('y1'))))).toBe(true);
    });
});

describe('survey guides validate their options', () => {
    const cases = {
        optionRings: () => guides.optionRings({ raduis: 4 }),
        cellGrid: () => guides.cellGrid({ padding: 2 }),
        sliderTrack: () => guides.sliderTrack({ fromat: String }),
        prompt: () => guides.prompt('q', { dy: 4 }),
        quadrants: () => guides.quadrants({ z: 'depth' }),
    };
    for (const [name, make] of Object.entries(cases)) {
        it(name, () => {
            setWarnings(true);
            const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
            make();
            const hits = warned.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes(`guides.${name}(`));
            warned.mockRestore();
            setWarnings(false);
            expect(hits.length).toBe(1);
        });
    }
});

describe('guide option vocabularies', () => {
    it('custom declares tracksPointer', () => {
        expect(GUIDE_OPTIONS.custom).toContain('tracksPointer');
    });
});
