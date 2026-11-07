// @vitest-environment jsdom
// Zoom is a DOMAIN change: a wheel over the plot narrows the axis's declared
// domain about the value under the pointer, through the same commit a handle
// drag takes (undoable, notified), and `setDomain` is its external twin.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function chart(extra = {}) {
    const changes = [];
    const el = Elicit({
        width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { x: { type: 'quantitative', domain: [0, 100] }, y: { type: 'quantitative', domain: [0, 10] } },
        data: [{ x: 50, y: 5 }],
        axes: { x: { edit: edit.axis.zoom() }, y: {} },
        onChange: (d) => changes.push(d),
        marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return { el, changes };
}

describe('edit.axis.zoom', () => {
    it('narrows the x domain about the pointer on a wheel-up, and widens on wheel-down up to the declared domain', async () => {
        const { el } = chart();
        await tick();
        // Pointer at the plot's centre: x = 50.
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        let d = el.getSchema().x.domain;
        expect(d[1] - d[0]).toBeLessThan(100);
        expect((d[0] + d[1]) / 2).toBeCloseTo(50, 3);
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: 300, rawEvent: {} });
        d = el.getSchema().x.domain;
        expect(d).toEqual([0, 100]); // the declared domain is the ceiling
    });

    it('is the only edit the plane runs, leaves y alone, and coalesces into one undo step', async () => {
        const { el, changes } = chart();
        await tick();
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        expect(el.getSchema().y.domain).toEqual([0, 10]);
        expect(changes.length).toBe(2);
        await new Promise((r) => setTimeout(r, 400));
        el.undo();
        expect(el.getSchema().x.domain).toEqual([0, 100]);
    });

    it('a wheel edit never raises the plane', async () => {
        const { driverFor, needsPlaneOnTop } = await import('../src/edit/drivers/index.js');
        const e = edit.axis.zoom();
        expect(e.pick).toBe('plane');
        expect(driverFor(e).name).toBe('plane');
        expect(needsPlaneOnTop([e])).toBe(false);
    });
});

describe('el.setDomain', () => {
    it('sets a field domain, notifies, and null restores the declared one', async () => {
        const { el, changes } = chart({ axes: { x: {}, y: {} } });
        await tick();
        expect(el.setDomain('x', [20, 40])).toBe(true);
        expect(el.getSchema().x.domain).toEqual([20, 40]);
        expect(changes.length).toBe(1);
        expect(el.setDomain('x', null)).toBe(true);
        expect(el.getSchema().x.domain).toEqual([0, 100]);
        expect(el.setDomain('nope', [0, 1])).toBe(false);
        el.undo();
        expect(el.getSchema().x.domain).toEqual([20, 40]);
    });
});
