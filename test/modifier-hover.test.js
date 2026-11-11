// @vitest-environment jsdom
// A plane edit gated on a modifier (`move({ pick: "nearest", when: when.shift })`)
// lights a hover ring only while the modifier is down. When the modifier is
// released, the next hover must retire that ring: the gated edit no longer
// accepts the hover, so without the engine telling its driver the pointer left,
// the ring stayed lit until the pointer left the chart.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function chart() {
    const el = Elicit({
        width: 300, height: 300, axes: false, margins: { top: 0, right: 0, bottom: 0, left: 0 },
        schema: { a: { type: 'quantitative', domain: [0, 10] }, b: { type: 'quantitative', domain: [0, 10] } },
        data: [{ a: 5, b: 5 }],
        marks: [plot.point({ channels: {
            x: { field: 'a', edit: edit.move({ channels: ['x', 'y'], pick: 'nearest', when: edit.when.shift }) },
            y: { field: 'b' }, size: { value: 20 },
        } })],
    });
    document.body.appendChild(el);
    return el;
}

const rings = (el) => el.querySelectorAll('.effect').length;

describe('a modifier-gated plane edit\'s hover', () => {
    it('lights while the modifier is down and retires when it is released', async () => {
        const el = chart();
        await tick();
        expect(rings(el)).toBe(0);
        el.emit({ type: 'hover', x: 150, y: 150, rawEvent: { shiftKey: true } });
        await tick();
        expect(rings(el)).toBeGreaterThan(0);
        // Shift released, pointer still: the renderer re-reports the hover.
        el.emit({ type: 'hover', x: 150, y: 150, rawEvent: { shiftKey: false } });
        await tick();
        expect(rings(el)).toBe(0);
    });
    it('a hoverout reaches the gated edit even with the modifier up', async () => {
        const el = chart();
        await tick();
        el.emit({ type: 'hover', x: 150, y: 150, rawEvent: { shiftKey: true } });
        await tick();
        el.emit({ type: 'hoverout', rawEvent: { shiftKey: false } });
        await tick();
        expect(rings(el)).toBe(0);
    });
});
