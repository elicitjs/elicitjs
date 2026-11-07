// @vitest-environment jsdom
// `strokeDash` is a style channel: a constant dash array, or a field through an
// ordinal scale onto the dash vocabulary — painted as the scene's `stroke-dasharray`.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, guides, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('strokeDash', () => {
    it('as a constant shorthand paints stroke-dasharray', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 1] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 0, y: 2 }, { x: 1, y: 4 }],
            marks: [plot.lineY({ strokeDash: '4 2', channels: { x: { field: 'x' }, y: { field: 'y' } } }), plot.ruleY({ strokeDash: '2 2', channels: { y: { datum: 5 } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(el.querySelector('path.mark-line').getAttribute('stroke-dasharray')).toBe('4 2');
        expect([...el.querySelectorAll('line')].some((l) => l.getAttribute('stroke-dasharray') === '2 2')).toBe(true);
    });
    it('as a field gives each series its own dash and keys a legend', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 1] }, y: { type: 'quantitative', domain: [0, 10] }, k: { type: 'categorical', domain: ['actual', 'forecast'] } },
            data: [{ x: 0, y: 2, k: 'actual' }, { x: 1, y: 4, k: 'actual' }, { x: 0, y: 6, k: 'forecast' }, { x: 1, y: 8, k: 'forecast' }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' }, strokeDash: { field: 'k', legend: true }, series: { field: 'k' } } })],
        });
        document.body.appendChild(el);
        await tick();
        const dashes = [...el.querySelectorAll('path.mark-line')].map((p) => p.getAttribute('stroke-dasharray'));
        expect(new Set(dashes).size).toBe(2);
        const texts = [...el.querySelectorAll('text')].map((t) => t.textContent);
        expect(texts).toContain('forecast');
    });
    it('guides.rule takes strokeDash', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 1] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 0, y: 2 }],
            guides: [guides.rule({ y: 5, strokeDash: '7 1' })],
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect([...el.querySelectorAll('line')].some((l) => l.getAttribute('stroke-dasharray') === '7 1')).toBe(true);
    });
});
