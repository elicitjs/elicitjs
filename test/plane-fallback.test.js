// @vitest-environment jsdom
// With the plane raised for a proximity edit, a press anywhere arrives as a PLANE
// gesture — even one that landed on a mark whose DIRECT edit should have it. When
// no plane edit's `when` accepts the gesture, the engine resolves the node under
// the pointer itself and hands the event on as a direct one, so a `move` beside a
// Shift-gated sweep (or a vertex drag beside a geo draw) is reachable at all.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function mount(sweepWhen) {
    const el = Elicit({
        width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { x: { type: 'categorical', domain: ['A', 'B', 'C'] }, y: { type: 'quantitative', domain: [0, 100] } },
        data: [{ x: 'A', y: 50 }, { x: 'B', y: 50 }, { x: 'C', y: 50 }],
        axes: false,
        marks: [
            plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep({ when: sweepWhen }) } } }),
            plot.barY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ when: edit.when.noShift }) } } }),
        ],
    });
    document.body.appendChild(el);
    return el;
}

/** A point just inside the TOP of the n-th bar (where its value is), in scene coordinates. */
function barTop(el, n) {
    const rect = el.querySelectorAll('rect.mark')[n];
    const x = +rect.getAttribute('x') + +rect.getAttribute('width') / 2;
    const y = +rect.getAttribute('y') + 2;
    return { x, y };
}

describe('plane gesture falls back to the direct mark under the pointer', () => {
    it('a plain drag reaches the bar when the sweep is gated on Shift', async () => {
        const el = mount(edit.when.shift);
        await tick();
        expect(el.querySelector('rect.plane').nextElementSibling).not.toBeNull();
        const { x, y } = barTop(el, 1);
        const raw = { shiftKey: false };
        el.emit({ type: 'dragstart', x, y, rawEvent: raw });
        el.emit({ type: 'drag', x, y: y - 40, rawEvent: raw });
        el.emit({ type: 'dragend', x, y: y - 40, rawEvent: raw });
        const rows = el.getData();
        expect(rows[1].y).toBeGreaterThan(50);
        // The direct edit moved ONE row; a sweep would have swept the line.
        expect(rows[0].y).toBe(50);
        expect(rows[2].y).toBe(50);
    });

    it('a Shift drag goes to the sweep, not the bar', async () => {
        const el = mount(edit.when.shift);
        await tick();
        const { x, y } = barTop(el, 1);
        const raw = { shiftKey: true };
        el.emit({ type: 'dragstart', x, y, rawEvent: raw });
        el.emit({ type: 'drag', x: x + 1, y: y - 40, rawEvent: raw });
        el.emit({ type: 'dragend', x: x + 1, y: y - 40, rawEvent: raw });
        // The bar's move is gated noShift, so only the sweep could have written this.
        expect(el.getData()[1].y).toBeGreaterThan(50);
    });

    it('a drag that starts on empty space does nothing', async () => {
        const el = mount(edit.when.shift);
        await tick();
        const raw = { shiftKey: false };
        el.emit({ type: 'dragstart', x: 2, y: 2, rawEvent: raw });
        el.emit({ type: 'drag', x: 2, y: 40, rawEvent: raw });
        el.emit({ type: 'dragend', x: 2, y: 40, rawEvent: raw });
        expect(el.getData().map((d) => d.y)).toEqual([50, 50, 50]);
    });
});
