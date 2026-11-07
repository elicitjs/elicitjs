// @vitest-environment jsdom
// A title, subtitle or caption reserves its band of layout space like a legend:
// the chart keeps its declared size and the plot shrinks. A gradient fill rides
// on the node and is painted through <defs>.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function chart(extra = {}) {
    const el = Elicit({
        width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
        schema: { k: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [0, 10] } },
        data: [{ k: 'a', v: 4 }, { k: 'b', v: 8 }],
        marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}
const sceneTransform = (el) => el.querySelector('g.scene-container').getAttribute('transform');

describe('titles', () => {
    it('reserve space at the top and bottom, leaving the svg size alone', async () => {
        const plain = chart();
        const titled = chart({ title: 'Sales', subtitle: 'by region', caption: 'Source: survey' });
        await tick();
        expect(titled.querySelector('svg').getAttribute('height')).toBe(plain.querySelector('svg').getAttribute('height'));
        expect(sceneTransform(plain)).toBe('translate(10,10)');
        const m = sceneTransform(titled).match(/translate\(([\d.]+),([\d.]+)\)/);
        expect(+m[2]).toBeGreaterThan(10);
        const texts = [...titled.querySelectorAll('text')].map((t) => t.textContent);
        expect(texts).toContain('Sales');
        expect(texts).toContain('by region');
        expect(texts).toContain('Source: survey');
        const title = [...titled.querySelectorAll('text')].find((t) => t.textContent === 'Sales');
        expect(title.getAttribute('font-weight')).toBe('600');
        // The caption sits at the chart's bottom edge, below the author's margin (where an axis draws).
        const caption = [...titled.querySelectorAll('text')].find((t) => t.textContent === 'Source: survey');
        const top = +m[2];
        const plotBottom = 200 - top - 10; // outer height − effective top − author bottom margin... (scene y of the margin's end)
        expect(+caption.getAttribute('y')).toBeGreaterThan(plotBottom);
    });
    it('do not warn as unknown spec keys', async () => {
        const { setWarnings: sw } = await import('../src/index.js');
        sw(true);
        const warned = [];
        const orig = console.warn;
        console.warn = (m) => warned.push(String(m));
        chart({ title: 'T' });
        await tick();
        console.warn = orig;
        sw(false);
        expect(warned.some((w) => /title/.test(w))).toBe(false);
    });
});

describe('gradient', () => {
    it('paints a bar through a <linearGradient> in <defs>', async () => {
        const el = chart({ marks: [plot.barY({ gradient: { stops: [[0, '#fff'], [1, '#00f']] }, channels: { x: { field: 'k' }, y: { field: 'v' } } })] });
        await tick();
        const rects = [...el.querySelectorAll('rect.mark')];
        expect(rects[0].getAttribute('fill')).toMatch(/^url\(#/);
        expect(el.querySelectorAll('defs linearGradient').length).toBe(1);
        expect(el.querySelectorAll('defs linearGradient stop').length).toBe(2);
    });
    it('an area band takes one too', async () => {
        const el = chart({
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 0, y: 2 }, { x: 1, y: 6 }, { x: 2, y: 4 }],
            marks: [plot.areaY({ gradient: { stops: [[0, '#fff'], [1, '#f00']], direction: 'horizontal' }, channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        await tick();
        expect(el.querySelector('path.mark-line').getAttribute('fill')).toMatch(/^url\(#/);
    });
});
