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
