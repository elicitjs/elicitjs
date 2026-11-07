// @vitest-environment jsdom
// Papercuts every gallery author hit (§4) and the false-positive warnings (§5).
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, elements, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const quiet = () => setWarnings(false);
/** Collect [elicit] warnings emitted while `fn` runs. */
async function warningsDuring(fn) {
    setWarnings(true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await fn(); } finally { spy.mockRestore(); setWarnings(false); }
    return spy.mock.calls.map((c) => String(c[0]));
}

describe('slide on x', () => {
    it('increases to the right by default', async () => {
        quiet();
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { k: { type: 'categorical', domain: ['a'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 50 }],
            marks: [plot.point({ size: 10, channels: { x: { value: 140 }, y: { field: 'k' }, size: { field: 'v', edit: edit.slide({ axis: 'x', extent: 100, name: 's' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        const c = el.querySelector('circle.mark');
        const x = +c.getAttribute('cx'), y = +c.getAttribute('cy');
        el.emit({ type: 'dragstart', node: null, x, y });
        // Drive through the node: a direct drag.
        const node = { ...c.__data__ };
        el.emit({ type: 'dragstart', node, x, y });
        el.emit({ type: 'drag', node, x: x + 50, y });
        el.emit({ type: 'dragend', node, x: x + 50, y });
        expect(el.getData()[0].v).toBeGreaterThan(50);
    });
});

describe('line and area handles', () => {
    it('draw no handles when nothing can grab them, and do with an edit', async () => {
        quiet();
        const base = {
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 3 }],
        };
        const plain = Elicit({ ...base, marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' } } }), plot.areaY({ channels: { x: { field: 'x' }, y: { field: 'y' } } })] });
        document.body.appendChild(plain);
        await tick();
        expect(plain.querySelectorAll('circle.mark').length).toBe(0);
        const live = Elicit({ ...base, marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })] });
        document.body.appendChild(live);
        await tick();
        expect(live.querySelectorAll('circle.mark').length).toBe(3);
    });

    it('fill a handle with the series colour', async () => {
        quiet();
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 1] }, y: { type: 'quantitative', domain: [0, 10] }, s: { type: 'categorical', domain: ['a', 'b'] } },
            data: [{ x: 0, y: 2, s: 'a' }, { x: 1, y: 4, s: 'a' }, { x: 0, y: 6, s: 'b' }, { x: 1, y: 8, s: 'b' }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() }, stroke: { field: 's' } } })],
        });
        document.body.appendChild(el);
        await tick();
        const lines = [...el.querySelectorAll('path.mark-line')].map((p) => p.getAttribute('stroke'));
        const fills = [...el.querySelectorAll('circle.mark')].map((c) => c.getAttribute('fill'));
        expect(new Set(fills)).toEqual(new Set(lines));
    });
});

describe('y-axis title', () => {
    it('is rotated along the axis by default and flat with titleAngle: 0', async () => {
        quiet();
        const spec = {
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 50 }],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        };
        const el = Elicit({ ...spec, axes: { x: {}, y: { title: 'value' } } });
        document.body.appendChild(el);
        await tick();
        const t = [...el.querySelectorAll('text')].find((n) => n.textContent === 'value');
        expect(t.getAttribute('transform')).toMatch(/rotate/);
        const flat = Elicit({ ...spec, axes: false, elements: [elements.axisY({ title: 'value', titleAngle: 0 })] });
        document.body.appendChild(flat);
        await tick();
        const f = [...flat.querySelectorAll('text')].find((n) => n.textContent === 'value');
        expect(f.getAttribute('transform') || '').not.toMatch(/rotate/);
    });
});

describe('false-positive warnings', () => {
    it('slide on a sequential fill is not reported as a dead channel', async () => {
        const seen = await warningsDuring(async () => {
            const el = Elicit({
                width: 300, height: 200,
                schema: { k: { type: 'categorical', domain: ['a'] }, n: { type: 'quantitative', domain: [0, 100] } },
                data: [{ k: 'a', n: 30 }],
                marks: [plot.point({ channels: { x: { field: 'k' }, y: { value: 50 }, fill: { field: 'n', scale: { scheme: 'blues' }, edit: edit.slide({ axis: 'x' }) } } })],
            });
            document.body.appendChild(el);
            await tick();
        });
        expect(seen.some((w) => /cannot be inverted/.test(w))).toBe(false);
    });
    it('an axis edit beside a nearest move is not a duplicate plane edit', async () => {
        const seen = await warningsDuring(async () => {
            const el = Elicit({
                width: 300, height: 200,
                schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
                data: [{ x: 1, y: 1 }],
                axes: { x: { edit: edit.axis.scale() }, y: {} },
                marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ pick: 'nearest' }) } } })],
            });
            document.body.appendChild(el);
            await tick();
        });
        expect(seen.some((w) => /plane-pick edit over the same rows/.test(w))).toBe(false);
    });
    it('a planar (identity) projection is not checked for ring winding', async () => {
        const square = { type: 'Polygon', coordinates: [[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]] };
        const seen = await warningsDuring(async () => {
            const el = Elicit({
                width: 300, height: 200,
                projection: { type: 'identity', domain: square },
                schema: { geometry: { type: 'categorical' } },
                data: [{ geometry: square }],
                marks: [plot.geoPolygon({ channels: { geometry: { field: 'geometry', scale: null } } })],
            });
            document.body.appendChild(el);
            await tick();
        });
        expect(seen.some((w) => /ring winding/.test(w))).toBe(false);
    });
});
