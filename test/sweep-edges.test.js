// @vitest-environment jsdom
// A sweep over a BAND paints one edge: the one whose handle was nearest at
// dragstart. The other edge is untouched, and a point-by-point move on a handle
// still works.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function band(extra = {}) {
    const el = Elicit({
        width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { x: { type: 'quantitative', domain: [0, 3] }, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
        data: [0, 1, 2, 3].map((x) => ({ x, lo: 30, hi: 70 })),
        marks: [plot.areaY({ channels: {
            x: { field: 'x' },
            y1: { field: 'lo', edit: edit.line.sweep() },
            y2: { field: 'hi', edit: edit.line.sweep() },
        } })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}
// Inner plot 300x200: value v sits at y = 200 - 2v; column x sits at x = 100·x.
const yOf = (v) => 200 - 2 * v;

describe('band sweep', () => {
    it('sweeping along the top edge changes hi and leaves lo alone', async () => {
        const el = band();
        await tick();
        el.emit({ type: 'dragstart', x: 0, y: yOf(70) });
        el.emit({ type: 'drag', x: 100, y: yOf(90) });
        el.emit({ type: 'drag', x: 200, y: yOf(90) });
        el.emit({ type: 'dragend', x: 200, y: yOf(90) });
        const rows = el.getData();
        expect(rows[1].hi).toBeGreaterThan(80);
        expect(rows[2].hi).toBeGreaterThan(80);
        expect(rows.every((r) => r.lo === 30)).toBe(true);
    });
    it('sweeping along the bottom edge changes lo and leaves hi alone', async () => {
        const el = band();
        await tick();
        el.emit({ type: 'dragstart', x: 0, y: yOf(30) });
        el.emit({ type: 'drag', x: 100, y: yOf(10) });
        el.emit({ type: 'dragend', x: 100, y: yOf(10) });
        const rows = el.getData();
        expect(rows[1].lo).toBeLessThan(20);
        expect(rows.every((r) => r.hi === 70)).toBe(true);
    });
    it('a point-by-point move on a handle edits that handle\'s edge only', async () => {
        const el = band({
            marks: [plot.areaY({ channels: {
                x: { field: 'x' },
                y1: { field: 'lo', edit: edit.move({ name: 'lo' }) },
                y2: { field: 'hi', edit: edit.move({ name: 'hi' }) },
            } })],
        });
        await tick();
        // The y2 handle of row 2, dragged directly (the control API addresses a
        // row, and a band row has two handles).
        const handle = [...el.querySelectorAll('circle.mark')].find((c) => c.__data__.index === 2 && c.__data__.channel === 'y2');
        const node = { ...handle.__data__ };
        el.emit({ type: 'dragstart', node, x: node.cx, y: node.cy });
        el.emit({ type: 'drag', node, x: node.cx, y: yOf(95) });
        el.emit({ type: 'dragend', node, x: node.cx, y: yOf(95) });
        const rows = el.getData();
        expect(rows[2].hi).toBeCloseTo(95, 3);
        expect(rows[2].lo).toBe(30);
    });
});

describe('a fast sweep', () => {
    it('paints every column it crossed between two pointer events', async () => {
        const el = Elicit({
            width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: Array.from({ length: 11 }, (_, x) => ({ x, y: 20 })),
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep() } } })],
        });
        document.body.appendChild(el);
        await tick();
        // One jump from column 0 to column 10 at value 80 (y = 200 - 160 = 40).
        el.emit({ type: 'dragstart', x: 0, y: 160 });
        el.emit({ type: 'drag', x: 300, y: 40 });
        el.emit({ type: 'dragend', x: 300, y: 40 });
        const ys = el.getData().map((d) => d.y);
        expect(ys.every((v, i) => i === 0 || v > 20)).toBe(true);
        expect(ys[10]).toBeCloseTo(80, 0);
        expect(ys[5]).toBeGreaterThan(40);
        expect(ys[5]).toBeLessThan(60);
    });
});
