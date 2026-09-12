// @vitest-environment jsdom
// One gesture, end to end, with no browser: mount a chart, drive a named edit
// through `el.control`, and check the committed data, the change event, and undo.
// The path is the same one a pointer takes (control synthesises renderer-shaped
// events), so this pins dispatch -> computeEdit -> constraints -> commit -> notify.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, constraints } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function chart(extra = {}) {
    const changes = [];
    const el = Elicit({
        width: 300, height: 200,
        schema: { x: { type: 'categorical', domain: ['A', 'B'] }, y: { type: 'quantitative', domain: [0, 100] } },
        data: [{ x: 'A', y: 10 }, { x: 'B', y: 20 }],
        constraints: [constraints.clamp({ min: 0, max: 50, field: 'y' })],
        onChange: (d) => changes.push(d),
        marks: [plot.barY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'pos' }) } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return { el, changes };
}

describe('Elicit smoke', () => {
    it('renders, commits a controlled edit, notifies once, and undoes', async () => {
        const { el, changes } = chart();
        await tick();
        expect(el.querySelector('svg')).not.toBeNull();
        expect(el.getData()).toEqual([{ x: 'A', y: 10 }, { x: 'B', y: 20 }]);

        el.control('pos', 1).set(30);
        expect(el.getData()[1].y).toBeCloseTo(30, 6);
        expect(changes.length).toBe(1);

        // The clamp is a dataset invariant, so it repairs a value the control sets.
        el.control('pos', 1).set(90);
        expect(el.getData()[1].y).toBeCloseTo(50, 6);

        expect(el.canUndo()).toBe(true);
        el.undo();
        expect(el.getData()[1].y).toBeCloseTo(30, 6);
        el.undo();
        expect(el.getData()[1].y).toBe(20);
        expect(el.canUndo()).toBe(false);
    });

    it('accepts() reports the channel domain and kind', async () => {
        const { el } = chart();
        await tick();
        const a = el.control('pos', 0).accepts();
        expect(a.field).toBe('y');
        expect(a.kind).toBe('continuous');
        expect(a.domain).toEqual([0, 100]);
    });
});

describe('chart elements in spec.elements', () => {
    it('renders axes and a grid passed through `elements` with `axes: false`', async () => {
        const { elements } = await import('../src/index.js');
        const el = Elicit({
            width: 420, height: 220,
            schema: { cat: { type: 'categorical', domain: ['A', 'B', 'C'] }, n: { type: 'quantitative', domain: [0, 100] } },
            data: [{ cat: 'A', n: 40 }, { cat: 'B', n: 70 }, { cat: 'C', n: 55 }],
            axes: false,
            elements: [elements.axisX({ ticks: 3, title: 'category' }), elements.axisY({ ticks: 4, title: 'n' }), elements.gridY()],
            marks: [plot.barY({ channels: { x: { field: 'cat' }, y: { field: 'n', edit: edit.move() } } })],
        });
        document.body.appendChild(el);
        await tick();
        const svg = el.querySelector('svg');
        expect(svg).not.toBeNull();
        expect(svg.querySelectorAll('rect').length).toBeGreaterThanOrEqual(3);
        expect(svg.querySelectorAll('text').length).toBeGreaterThan(3);
    });
});
