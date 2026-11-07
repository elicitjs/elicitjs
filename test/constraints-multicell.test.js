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
