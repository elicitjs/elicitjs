// @vitest-environment jsdom
// A new line's identity comes from the SCHEMA when the series field declares a
// domain (the next unused category, honouring `open`), and a freehand stroke
// never continues a locked line. `nextCategory` accepts a label function.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { nextSeriesKey, nextCategory, lastFreeSeries, seriesKeyOf } from '../src/edit/shared.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('nextSeriesKey', () => {
    it('takes the next declared category, and the integer path without a domain', () => {
        const rows = [{ k: 'a' }];
        expect(nextSeriesKey(rows, 'k', { k: { type: 'categorical', domain: ['a', 'b', 'c'] } })).toBe('b');
        expect(nextSeriesKey(rows, 'k', { k: { type: 'categorical' } })).toBe(0);
        expect(nextSeriesKey([{ k: 0 }, { k: 1 }], 'k', {})).toBe(2);
        expect(nextSeriesKey(rows, null)).toBe(0);
    });
    it('refuses a closed, exhausted domain and mints a placeholder on an open one', () => {
        const rows = [{ k: 'a' }, { k: 'b' }];
        expect(nextSeriesKey(rows, 'k', { k: { domain: ['a', 'b'] } })).toBeUndefined();
        expect(nextSeriesKey(rows, 'k', { k: { domain: ['a', 'b'], open: true } })).toBe('k 3');
    });
    it('groups Date series by time', () => {
        const d = new Date(2020, 0, 1);
        expect(seriesKeyOf(d)).toBe(d.getTime());
        expect(seriesKeyOf('x')).toBe('x');
    });
});

describe('nextCategory with a label function', () => {
    it('names the placeholder with the function, not its source text', () => {
        const name = nextCategory([{ s: 'a' }], 's', ['a'], { open: true, label: (n) => `sport ${n}` });
        expect(name).toBe('sport 2');
    });
});

describe('lastFreeSeries', () => {
    it('skips locked rows from the end and is undefined when all are locked', () => {
        const rows = [{ k: 'a' }, { k: 'b' }, { k: 'c' }];
        expect(lastFreeSeries(rows, 'k', null)).toBe('c');
        expect(lastFreeSeries(rows, 'k', (d, i) => i >= 1)).toBe('a');
        expect(lastFreeSeries(rows, 'k', () => true)).toBeUndefined();
    });
});

describe('line.anchor', () => {
    it('mints the next declared series category on a click in empty space', async () => {
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            axes: false,
            schema: {
                x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] },
                sym: { type: 'categorical', domain: ['AAPL', 'IBM'] },
            },
            data: [{ x: 1, y: 9, sym: 'AAPL' }, { x: 2, y: 9, sym: 'AAPL' }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' }, series: { field: 'sym' } }, edits: [edit.line.anchor()] })],
        });
        document.body.appendChild(el);
        await tick();
        // Far from the AAPL line (which sits near the top).
        el.emit({ type: 'click', x: 250, y: 170 });
        const rows = el.getData();
        expect(rows.length).toBe(3);
        expect(rows[2].sym).toBe('IBM');
    });

    it('does not extend a locked freehand path', async () => {
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            axes: false,
            lock: 'seed',
            schema: {
                x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] },
                s: { type: 'categorical' },
            },
            data: [{ x: 1, y: 9, s: 0 }, { x: 2, y: 9, s: 0 }],
            marks: [plot.path({ channels: { x: { field: 'x' }, y: { field: 'y' }, series: { field: 's' } }, edits: [edit.line.anchor()] })],
        });
        document.body.appendChild(el);
        await tick();
        el.emit({ type: 'click', x: 250, y: 170 });
        const rows = el.getData();
        expect(rows.length).toBe(3);
        expect(rows[2].s).not.toBe(0);
    });
});
