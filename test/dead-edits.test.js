// @vitest-environment jsdom
// Edits that used to die in silence (gallery findings §2): a sweep over bars, a
// mark-level sweep with no channel, an anchor extending a locked line, and a node
// mark whose only edit is on its ports.
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('move({ pick: "sweep" }) on bars', () => {
    it('paints the bar under the pointer', async () => {
        setWarnings(false);
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            schema: { k: { type: 'categorical', domain: ['a', 'b', 'c'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 20 }, { k: 'b', v: 20 }, { k: 'c', v: 20 }],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move({ pick: 'sweep' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        // Inner plot 280x180; bar b spans the middle third; value 80 sits at y=36.
        el.emit({ type: 'dragstart', x: 140, y: 36 });
        el.emit({ type: 'drag', x: 141, y: 36 });
        el.emit({ type: 'dragend', x: 141, y: 36 });
        const vs = el.getData().map((d) => d.v);
        expect(vs[1]).toBeGreaterThan(70);
        expect(vs[0]).toBe(20);
        expect(vs[2]).toBe(20);
    });
});

describe('a mark-level edit.line.sweep()', () => {
    it('sweeps y and warns that no channel was named', async () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 0, y: 20 }, { x: 1, y: 20 }, { x: 2, y: 20 }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' } }, edits: [edit.line.sweep()] })],
        });
        document.body.appendChild(el);
        await tick();
        expect(spy.mock.calls.some((c) => /names no channel/.test(String(c[0])))).toBe(true);
        spy.mockRestore();
        setWarnings(false);
        el.emit({ type: 'dragstart', x: 150, y: 36 });
        el.emit({ type: 'drag', x: 151, y: 36 });
        el.emit({ type: 'dragend', x: 151, y: 36 });
        expect(el.getData()[1].y).toBeGreaterThan(70);
    });

    it('warns when handles: false leaves a sweep nothing to target', async () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 0, y: 20 }, { x: 1, y: 20 }],
            marks: [plot.areaY({ handles: false, channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep() } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(spy.mock.calls.some((c) => /handles: false/.test(String(c[0])))).toBe(true);
        spy.mockRestore();
        setWarnings(false);
    });
});

describe('line.anchor({ into: "nearest" }) beside a locked line', () => {
    it('extends the locked line (appending breaks no locked row)', async () => {
        setWarnings(false);
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            lock: 'seed',
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] }, s: { type: 'categorical', domain: ['given', 'other'] } },
            data: [{ x: 1, y: 5, s: 'given' }, { x: 5, y: 5, s: 'given' }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' }, series: { field: 's' } }, edits: [edit.line.anchor()] })],
        });
        document.body.appendChild(el);
        await tick();
        // Just above the line's midpoint (y=5 → pixel 90), within the 40px threshold.
        el.emit({ type: 'click', x: 100, y: 80 });
        const rows = el.getData();
        expect(rows.length).toBe(3);
        expect(rows[2].s).toBe('given');
    });
});

describe('a sticker whose only edit is on its ports', () => {
    it('keeps the host hoverable, so its ports can light on hover', async () => {
        setWarnings(false);
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: {
                structure: 'network',
                tables: {
                    nodes: { id: { type: 'categorical', key: true }, x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
                    links: { source: { type: 'ref' }, target: { type: 'ref' } },
                },
            },
            data: { nodes: [{ id: 'a', x: 2, y: 5 }, { id: 'b', x: 8, y: 5 }], links: [] },
            marks: [
                plot.point({ size: 12, channels: { x: { field: 'x' }, y: { field: 'y' }, ports: { value: true, edit: edit.network.connect() } } }),
                plot.link(),
            ],
        });
        document.body.appendChild(el);
        await tick();
        const circles = [...el.querySelectorAll('circle.mark')].filter((c) => c.getAttribute('r') === '12');
        expect(circles.length).toBe(2);
        expect(circles[0].style.pointerEvents).not.toBe('none');
    });
});
