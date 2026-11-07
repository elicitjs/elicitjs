// @vitest-environment jsdom
// Pointer state is recorded, never dispatched: a tip or a crosshair draws from it
// and no mark becomes pointer-active to show one.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, guides, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function chart(extra = {}) {
    const el = Elicit({
        width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { k: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [0, 100] } },
        data: [{ k: 'a', v: 40 }, { k: 'b', v: 80 }],
        marks: [plot.barY({ tip: true, channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move() } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}
const guideTexts = (el) => [...el.querySelectorAll('.guide-front-layer text')].map((t) => t.textContent);

describe('mark tip', () => {
    it('shows the row under the pointer and hides when it leaves', async () => {
        const el = chart();
        await tick();
        expect(guideTexts(el).length).toBe(0);
        // Bar b spans the right half; value 80 → y = 180 * 0.2 = 36. Point inside it.
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        expect(guideTexts(el).some((t) => /k: b/.test(t) && /v: 80/.test(t))).toBe(true);
        el.emit({ type: 'pointermove', x: 2, y: 2 });
        expect(guideTexts(el).length).toBe(0);
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        el.emit({ type: 'pointerleave' });
        expect(guideTexts(el).length).toBe(0);
    });

    it('lists only the named columns, and works on a locked row', async () => {
        const el = chart({
            lock: 'seed',
            marks: [plot.barY({ tip: ['v'], channels: { x: { field: 'k' }, y: { field: 'v', edit: edit.move() } } })],
        });
        await tick();
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        const texts = guideTexts(el);
        expect(texts.some((t) => /v: 80/.test(t))).toBe(true);
        expect(texts.some((t) => /k:/.test(t))).toBe(false);
    });

    it('does not change dispatch: a drag under a tip still edits', async () => {
        const el = chart();
        await tick();
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        const node = { ...el.querySelectorAll('rect.mark')[1].__data__ };
        el.emit({ type: 'dragstart', node, x: 210, y: 36 });
        el.emit({ type: 'drag', node, x: 210, y: 90 });
        el.emit({ type: 'dragend', node, x: 210, y: 90 });
        expect(el.getData()[1].v).toBeLessThan(80);
    });

    it('without a pointer guide, pointer movement is not tracked', async () => {
        const el = chart({ marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } } })] });
        await tick();
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        expect(guideTexts(el).length).toBe(0);
    });
});

describe('guides.crosshair', () => {
    it('draws two rules at the pointer with axis readouts', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { x: { type: 'quantitative', domain: [0, 280] }, y: { type: 'quantitative', domain: [0, 180] } },
            data: [{ x: 10, y: 10 }],
            guides: [guides.crosshair()],
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.emit({ type: 'pointermove', x: 140, y: 90 });
        const lines = el.querySelectorAll('.guide-front-layer line');
        expect(lines.length).toBe(2);
        const texts = guideTexts(el);
        expect(texts).toContain('140');
        expect(texts).toContain('90');
    });
    it('quadrants is the old centre frame', () => {
        expect(guides.quadrants().type).toBe('quadrants');
        expect(guides.crosshair().type).toBe('crosshair');
    });
});

describe('tip layering and options', () => {
    it('draws its box above the marks and takes the object form with a format', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { k: { type: 'categorical', domain: ['a'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 42.1234 }],
            marks: [plot.barY({ tip: { text: ['v'], format: '.1f' }, channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.emit({ type: 'pointermove', x: 140, y: 150 });
        expect(el.querySelectorAll('.guide-front-layer rect.guide-rect').length).toBe(1);
        expect(el.querySelectorAll('.guide-back-layer rect, .guide-regions-layer rect').length).toBe(0);
        expect(guideTexts(el).some((t) => /v: 42\.1$/.test(t))).toBe(true);
    });
});

describe('a bound tip under an inert label', () => {
    it('still finds its own mark\'s row', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { k: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 40 }, { k: 'b', v: 80 }],
            marks: [
                plot.barY({ tip: ['v'], channels: { x: { field: 'k' }, y: { field: 'v' } } }),
                plot.text({ fontSize: 40, channels: { x: { field: 'k' }, y: { value: 100 }, text: { field: 'k' } } }),
            ],
        });
        document.body.appendChild(el);
        await tick();
        // Over the label's anchor, which sits on bar b.
        el.emit({ type: 'pointermove', x: 210, y: 100 });
        expect(guideTexts(el).some((t) => /v: 80/.test(t))).toBe(true);
    });
});

describe('a tip over a line or an area', () => {
    it('names the row of the nearest vertex', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 0, y: 10 }, { x: 1, y: 50 }, { x: 2, y: 90 }],
            marks: [plot.areaY({ tip: ['x', 'y'], channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        document.body.appendChild(el);
        await tick();
        // Inside the band near x = 1 (pixel 140), below the top edge.
        el.emit({ type: 'pointermove', x: 140, y: 150 });
        expect(guideTexts(el).some((t) => /x: 1/.test(t) && /y: 50/.test(t))).toBe(true);
    });
});
