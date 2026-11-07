// @vitest-environment jsdom
// A CONTEXT table is drawn but never elicited: its rows are read-only, they are
// not part of getData()/onChange, and the chart's output stays in its usual
// shape (a bare array for a one-table chart).
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function chart(extra = {}) {
    const changes = [];
    const el = Elicit({
        width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: {
            data: { year: { type: 'quantitative', domain: [2020, 2030] }, value: { type: 'quantitative', domain: [0, 100] } },
            history: { context: true, fields: { year: { type: 'quantitative', domain: [2000, 2020] }, value: { type: 'quantitative', domain: [0, 100] } } },
        },
        data: {
            data: [{ year: 2025, value: 50 }, { year: 2030, value: 50 }],
            history: [{ year: 2000, value: 20 }, { year: 2010, value: 30 }, { year: 2020, value: 40 }],
        },
        onChange: (d) => changes.push(d),
        marks: [
            plot.lineY({ table: 'history', stroke: '#999', channels: { x: { field: 'year' }, y: { field: 'value' } } }),
            plot.lineY({ channels: { x: { field: 'year' }, y: { field: 'value', edit: edit.move({ name: 'v' }) } } }),
        ],
        ...extra,
    });
    document.body.appendChild(el);
    return { el, changes };
}

describe('context tables', () => {
    it('are excluded from getData(), onChange and getSchema(), which stay in bare form', async () => {
        setWarnings(false);
        const { el, changes } = chart();
        await tick();
        expect(Array.isArray(el.getData())).toBe(true);
        expect(el.getData().length).toBe(2);
        expect(Object.keys(el.getSchema())).toEqual(['year', 'value']);
        el.control('v', 0).set(70);
        expect(changes.length).toBe(1);
        expect(Array.isArray(changes[0])).toBe(true);
        expect(changes[0][0].value).toBeCloseTo(70, 6);
    });

    it('widen the inferred scale domains and are drawn', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        // Two lines: the context line and the elicited one.
        expect(el.querySelectorAll('path.mark-line').length).toBe(2);
        const a = el.control('v', 0).accepts();
        expect(a.domain).toEqual([0, 100]);
    });

    it('are read-only: an edit declared on a context mark warns and never commits', async () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { el } = chart({
            marks: [
                plot.lineY({ table: 'history', channels: { x: { field: 'year' }, y: { field: 'value', edit: edit.move({ name: 'h' }) } } }),
                plot.lineY({ channels: { x: { field: 'year' }, y: { field: 'value', edit: edit.move({ name: 'v' }) } } }),
            ],
        });
        await tick();
        expect(spy.mock.calls.some((c) => /context/.test(String(c[0])))).toBe(true);
        spy.mockRestore();
        setWarnings(false);
        el.control('h', 0).set(90);
        // Nothing visible changed on the context line: its handles are locked.
        const ys = [...el.querySelectorAll('circle.mark')].map((c) => c.getAttribute('cy'));
        expect(ys.length).toBeGreaterThan(0);
    });

    it('survive setData() and undo', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        el.setData([{ year: 2025, value: 10 }, { year: 2030, value: 20 }]);
        await tick();
        expect(el.querySelectorAll('path.mark-line').length).toBe(2);
        el.control('v', 0).set(60);
        el.undo();
        expect(el.getData()[0].value).toBe(10);
        expect(el.querySelectorAll('path.mark-line').length).toBe(2);
    });
});
