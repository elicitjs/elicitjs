// @vitest-environment jsdom
// Two ways a handle used to lie about what a gesture would do:
//   · a band sweep's HOVER outlined the row's first node (the lower edge) while
//     the press then locked the upper one — the highlight must name the edge the
//     stroke will paint;
//   · a line drew its vertex handles on LOCKED and CONTEXT rows, which no drag can
//     move — a row handle draws only where a live edit can reach the row.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

// Inner plot 300x200: value v sits at y = 200 - 2v; column x sits at x = 100·x.
const yOf = (v) => 200 - 2 * v;
const frame = { width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
const schema = { x: { type: 'quantitative', domain: [0, 3] }, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] }, y: { type: 'quantitative', domain: [0, 100] } };

/** The hovered effect's solid outline (the catchment ring is dashed). */
const hoverOutline = (el) => [...el.querySelectorAll('circle.effect')].find((c) => !c.getAttribute('stroke-dasharray'));
/** The handle circles a mark drew (not the effect overlays, not the hit plane). */
const handles = (el) => [...el.querySelectorAll('circle')].filter((c) => !c.classList.contains('effect'));

function band() {
    const el = Elicit({
        ...frame, schema,
        data: [0, 1, 2, 3].map((x) => ({ x, lo: 30, hi: 70 })),
        marks: [plot.areaY({ channels: {
            x: { field: 'x' },
            y1: { field: 'lo', edit: edit.line.sweep() },
            y2: { field: 'hi', edit: edit.line.sweep() },
        } })],
    });
    document.body.appendChild(el);
    return el;
}

describe('a band sweep\'s hover', () => {
    it('outlines the upper edge when the pointer is nearer it', async () => {
        const el = band();
        await tick();
        el.emit({ type: 'hover', x: 100, y: yOf(75) });
        await tick();
        expect(Number(hoverOutline(el).getAttribute('cy'))).toBeCloseTo(yOf(70));
    });
    it('outlines the lower edge when the pointer is nearer it', async () => {
        const el = band();
        await tick();
        el.emit({ type: 'hover', x: 100, y: yOf(25) });
        await tick();
        expect(Number(hoverOutline(el).getAttribute('cy'))).toBeCloseTo(yOf(30));
    });
});

function line(extra) {
    const el = Elicit({
        ...frame, schema,
        data: [0, 1, 2, 3].map((x) => ({ x, y: 50 })),
        marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep() } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}

describe('row handles', () => {
    it('draw on every row of an editable line', async () => {
        const el = line({});
        await tick();
        expect(handles(el).length).toBe(4);
    });
    it('do not draw on locked rows', async () => {
        const el = line({ lock: (d) => d.x < 2 });
        await tick();
        expect(handles(el).map((c) => Number(c.getAttribute('cx')))).toEqual([200, 300]);
    });
    it('do not draw on context rows', async () => {
        const el = line({ context: (d) => d.x === 0 });
        await tick();
        expect(handles(el).length).toBe(3);
    });
    it('draw as ink on every row when an inert line states handles: true', async () => {
        const el = Elicit({
            ...frame, schema,
            data: [0, 1, 2, 3].map((x) => ({ x, y: 50 })),
            context: (d) => d.x < 2,
            marks: [plot.lineY({ handles: true, channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(handles(el).length).toBe(4);
    });
    it('do not draw while every edit waits for a later stage', async () => {
        const el = Elicit({
            ...frame, schema,
            data: [0, 1, 2, 3].map((x) => ({ x, y: 50 })),
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep({ stage: 1 }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(handles(el).length).toBe(0);
        el.setStage(1);
        await tick();
        expect(handles(el).length).toBe(4);
    });
});
