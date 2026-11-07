// @vitest-environment jsdom
// A one-column rule (snap, clamp) holds for the WHOLE proposal, not just the cell
// the gesture touched: `changedCells` lists every (row, field) the proposal
// changed, so a push by a sibling rule is snapped/clamped too, and a temporal
// value stays a Date.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, constraints, setWarnings } from '../src/index.js';
import { changedCells } from '../src/constraints/define.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('changedCells', () => {
    it('lists the active cell plus every changed cell over `fields`, and all fields of an appended row', () => {
        const oldData = [{ a: 1, b: 2 }, { a: 3, b: 4 }];
        const data = [{ a: 1, b: 9 }, { a: 3, b: 4 }, { a: 5, b: 6 }];
        const cells = changedCells({ data, oldData, activeIndex: 0, field: 'a', fields: ['a', 'b'] });
        expect(cells).toEqual([{ i: 0, field: 'a' }, { i: 0, field: 'b' }, { i: 2, field: 'a' }, { i: 2, field: 'b' }]);
    });
    it('treats equal Dates as unchanged', () => {
        const d = () => new Date(2020, 0, 1);
        expect(changedCells({ data: [{ t: d() }], oldData: [{ t: d() }], activeIndex: null, field: undefined, fields: ['t'] })).toEqual([]);
    });
});

describe('snap', () => {
    it('keeps a temporal field a Date', async () => {
        const day = 86400000;
        const el = Elicit({
            width: 300, height: 200,
            schema: { t: { type: 'temporal', domain: [new Date(2020, 0, 1), new Date(2020, 0, 31)] }, k: { type: 'categorical', domain: ['a'] } },
            data: [{ t: new Date(2020, 0, 10), k: 'a' }],
            constraints: [constraints.snap({ field: 't', step: day, origin: new Date(2020, 0, 1).getTime() })],
            marks: [plot.point({ channels: { x: { field: 't', edit: edit.move({ name: 'v' }) }, y: { field: 'k' } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 0).set(new Date(2020, 0, 15, 13));
        const t = el.getData()[0].t;
        expect(t instanceof Date).toBe(true);
        expect(t.getTime()).toBe(new Date(2020, 0, 16).getTime());
    });

    it('snaps a sibling column an ordering push moved', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', lo: 10, hi: 20 }],
            constraints: [constraints.ordering({ field: ['lo', 'hi'] }), constraints.snap({ field: ['lo', 'hi'], step: 5 })],
            marks: [plot.point({ channels: { x: { field: 'k' }, y: { field: 'lo', edit: edit.move({ name: 'lo' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('lo', 0).set(33);
        const row = el.getData()[0];
        expect(row.lo).toBe(35);
        expect(row.hi).toBe(35);  // pushed by ordering, then snapped
    });
});

describe('clamp', () => {
    it('clamps a column a monotonic push moved, and does nothing to untouched rows', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { x: { type: 'quantitative', domain: [0, 3] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }],
            constraints: [constraints.monotonic({ field: 'y', along: 'x' }), constraints.clamp({ field: 'y', max: 50 })],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'v' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 0).set(80);
        const ys = el.getData().map((d) => d.y);
        expect(ys[0]).toBe(50);
        expect(ys[1]).toBe(50);
        expect(ys[2]).toBe(50);
    });
});

describe('maintainSum with a negative total', () => {
    it('redistributes within [total, 0] instead of zeroing every row', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [-100, 0] } },
            data: [{ k: 'a', v: -50 }, { k: 'b', v: -50 }],
            constraints: [constraints.maintainSum({ field: 'v', total: -100, strategy: 'redistribute' })],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move({ name: 'v' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 0).set(-30);
        const vs = el.getData().map((d) => d.v);
        expect(vs[0]).toBeCloseTo(-30, 6);
        expect(vs[1]).toBeCloseTo(-70, 6);
    });
});

describe('unique with unfilled rows', () => {
    it('does not treat null as a category', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { slot: { type: 'categorical', domain: ['s1', 's2', 's3'] }, sport: { type: 'categorical', domain: ['run', 'swim', 'row'] } },
            data: [{ slot: 's1', sport: null }, { slot: 's2', sport: null }, { slot: 's3', sport: null }],
            constraints: [constraints.unique({ field: 'sport' })],
            marks: [plot.point({ channels: { x: { field: 'slot' }, y: { value: 50 }, fill: { field: 'sport', edit: edit.set({ name: 'pick' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('pick', 0).set('run');
        expect(el.getData()[0].sport).toBe('run');
        el.control('pick', 1).set('run');
        expect(el.getData()[1].sport).toBeNull(); // a real duplicate is still refused
    });
});

describe('monotonic beside a lock', () => {
    it('caps the dragged value at the locked neighbour instead of leaving the run broken', async () => {
        const el = Elicit({
            width: 300, height: 200,
            lock: (d) => d.x === 0,
            schema: { x: { type: 'quantitative', domain: [0, 3] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 0, y: 50 }, { x: 1, y: 50 }, { x: 2, y: 50 }],
            constraints: [constraints.monotonic({ field: 'y', along: 'x' })],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'v' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 1).set(40);
        expect(el.getData().map((d) => d.y)).toEqual([50, 50, 50]);
        el.control('v', 1).set(70);
        expect(el.getData().map((d) => d.y)).toEqual([50, 70, 70]);
    });
});

describe('rank', () => {
    it('shifts the rows between the old and new slot by one', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { name: { type: 'categorical', domain: ['a', 'b', 'c', 'd', 'e'] }, rank: { type: 'ordinal', domain: [1, 2, 3, 4, 5] }, len: { type: 'quantitative', domain: [0, 1] } },
            data: ['a', 'b', 'c', 'd', 'e'].map((name, i) => ({ name, rank: i + 1, len: 1 })),
            marks: [plot.barX({ channels: { y: { field: 'rank', edit: edit.rank({ name: 'r' }) }, x: { field: 'len' } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('r', 0).set(4);
        expect(el.getData().map((d) => d.rank)).toEqual([4, 1, 2, 3, 5]);
        el.control('r', 4).set(1);
        expect(el.getData().map((d) => d.rank)).toEqual([5, 2, 3, 4, 1]);
    });
});

describe('brushSpan', () => {
    function mount(extra) {
        const el = Elicit({
            width: 300, height: 300, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            schema: { k: { type: 'categorical', domain: ['a'] }, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', lo: 40, hi: 60 }],
            ...extra,
        });
        document.body.appendChild(el);
        return el;
    }
    it('keeps low below high through a body drag on a VERTICAL span, with ordering declared', async () => {
        const el = mount({
            constraints: [constraints.ordering({ field: ['lo', 'hi'] })],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y1: { field: 'lo' }, y2: { field: 'hi' } }, edits: [edit.brushSpan({ channels: ['y1', 'y2'] })] })],
        });
        await tick();
        // The span's centre: value 50 of [0,100] over an inner height of 280 → y=140.
        el.emit({ type: 'dragstart', x: 140, y: 140 });
        el.emit({ type: 'drag', x: 140, y: 100 });
        el.emit({ type: 'dragend', x: 140, y: 100 });
        const row = el.getData()[0];
        expect(row.lo).toBeLessThan(row.hi);
        expect(row.hi - row.lo).toBeCloseTo(20, 3);
        expect(row.lo).toBeGreaterThan(40);
    });
    it('takes the mark\'s own span pair when placed with no channels', async () => {
        const el = mount({
            marks: [plot.barY({ channels: { x: { field: 'k' }, y1: { field: 'lo' }, y2: { field: 'hi' } }, edits: [edit.brushSpan()] })],
        });
        await tick();
        el.emit({ type: 'dragstart', x: 140, y: 140 });
        el.emit({ type: 'drag', x: 140, y: 100 });
        el.emit({ type: 'dragend', x: 140, y: 100 });
        const row = el.getData()[0];
        expect(row.lo).toBeGreaterThan(40);
        expect(row.hi - row.lo).toBeCloseTo(20, 3);
    });
});

describe('spacing beside a clamp', () => {
    it('stops the dragged threshold where the chain still fits the domain', async () => {
        const el = Elicit({
            width: 420, height: 170,
            schema: { grade: { type: 'categorical', domain: ['D', 'C', 'B', 'A'] }, at: { type: 'quantitative', domain: [0, 100] } },
            data: [{ grade: 'D', at: 50 }, { grade: 'C', at: 65 }, { grade: 'B', at: 78 }, { grade: 'A', at: 90 }],
            constraints: [constraints.spacing({ field: 'at', min: 8 }), constraints.clamp({ min: 0, max: 100, field: 'at' })],
            marks: [plot.tickX({ channels: { x: { field: 'at', edit: edit.move({ name: 't' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('t', 0).set(99);
        const ats = el.getData().map((d) => d.at).sort((a, b) => a - b);
        const gaps = ats.slice(1).map((v, i) => v - ats[i]);
        expect(gaps.every((g) => g >= 8 - 1e-9)).toBe(true);
        expect(Math.max(...ats)).toBeLessThanOrEqual(100);
    });
});

describe('clamp with no bounds over a column another mark draws', () => {
    it('falls back to the schema domain', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, lo: { type: 'quantitative', domain: [0, 10] }, mean: { type: 'quantitative', domain: [0, 10] }, hi: { type: 'quantitative', domain: [0, 10] } },
            data: [{ k: 'a', lo: 3, mean: 5, hi: 7 }],
            constraints: [constraints.follow({ field: ['lo', 'hi'], lead: 'mean' }), constraints.clamp({ field: ['lo', 'mean', 'hi'] })],
            marks: [plot.point({ channels: { x: { field: 'k' }, y: { field: 'mean', edit: edit.move({ name: 'm' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('m', 0).set(9);
        const r = el.getData()[0];
        expect(r.hi).toBeLessThanOrEqual(10);
        expect(r.lo).toBeCloseTo(7, 6);
    });
});
