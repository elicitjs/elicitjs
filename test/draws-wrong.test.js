// @vitest-environment jsdom
// Drawing bugs from the gallery study (§3): continuous schemes keep every stop,
// adopted scales take the schema domain, a constant stroke takes no palette slot,
// a missing value breaks a line, an area orders an ordinal x by its domain, a
// clockwise arc draws, and guides honour their declared options.
import { describe, it, expect, vi } from 'vitest';
import * as d3 from 'd3';
import { Elicit, plot, edit, guides, setWarnings } from '../src/index.js';
import { createScale, adoptScale } from '../src/core/scales.js';
import { schemeRange } from '../src/core/encoding.js';
import { lineGenerator, areaGenerator } from '../src/core/curves.js';
import { waffleLayout } from '../src/plot/waffle.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('continuous colour schemes', () => {
    it('a named scheme on a sequential scale keeps its interior colours', () => {
        const range = schemeRange('viridis', 'sequential', 2);
        expect(range.length).toBeGreaterThan(2);
        const s = createScale({ channel: 'fill', type: 'sequential', domain: [0, 1] }, range);
        expect(d3.color(s(0.5)).formatHex()).toBe(d3.color(d3.interpolateViridis(0.5)).formatHex());
    });
    it('a three-stop range on a sequential scale passes through its middle stop', () => {
        const s = createScale({ channel: 'fill', type: 'sequential', domain: [0, 10] }, ['#000000', '#ff0000', '#ffffff']);
        expect(d3.color(s(5)).formatHex()).toBe('#ff0000');
    });
    it('a diverging scheme keeps its neutral at the pivot', () => {
        const range = schemeRange('rdbu', 'diverging', 2);
        const s = createScale({ channel: 'fill', type: 'diverging', domain: [-1, 1] }, range);
        expect(d3.color(s(0)).formatHex()).toBe(d3.color(d3.interpolateRdBu(0.5)).formatHex());
    });
    it('a linear scale given a long colour range spreads its domain over every stop', () => {
        const s = createScale({ channel: 'fill', type: 'linear', domain: [0, 1] }, ['#000000', '#ff0000', '#ffffff']);
        expect(d3.color(s(0.5)).formatHex()).toBe('#ff0000');
    });
});

describe('adoptScale', () => {
    it('applies a declared schema domain even when the instance has d3\'s default [0, 1]', () => {
        const s = adoptScale(d3.scaleLinear(), { domain: [0, 100], declared: true });
        expect(s.domain()).toEqual([0, 100]);
    });
    it('fills only an empty domain when the domain was inferred', () => {
        const s = adoptScale(d3.scaleLinear().domain([5, 6]), { domain: [0, 100], declared: false });
        expect(s.domain()).toEqual([5, 6]);
    });
});

describe('palette rotation', () => {
    it('a constant stroke on one mark takes no scheme slot from the next', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 10] }, s: { type: 'categorical', domain: ['a', 'b'] } },
            data: [{ x: 0, y: 1, s: 'a' }, { x: 1, y: 2, s: 'a' }, { x: 0, y: 3, s: 'b' }, { x: 1, y: 4, s: 'b' }],
            marks: [
                plot.lineY({ stroke: 'white', strokeWidth: 6, channels: { x: { field: 'x' }, y: { field: 'y' }, series: { field: 's' } } }),
                plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' }, stroke: { field: 's' } } }),
            ],
        });
        document.body.appendChild(el);
        await tick();
        const paths = [...el.querySelectorAll('path.mark-line')];
        const strokes = new Set(paths.map((p) => p.getAttribute('stroke')).filter((c) => c && c !== 'white'));
        // tableau10 (the default palette) starts with #4e79a7; Dark2 would give #1b9e77.
        expect([...strokes].some((c) => /4e79a7/i.test(c))).toBe(true);
        expect([...strokes].some((c) => /1b9e77/i.test(c))).toBe(false);
    });
});

describe('missing values', () => {
    it('lineGenerator breaks the path at an undefined point', () => {
        const d = lineGenerator('linear')([[0, 0], [10, 10], null, [20, 20], [30, 30]]);
        expect((d.match(/M/g) || []).length).toBe(2);
    });
    it('areaGenerator curves both edges consistently and breaks at a missing sample', () => {
        const d = areaGenerator('stepAfter')([{ x: 0, y0: 100, y1: 10 }, { x: 10, y0: 100, y1: 20 }, { x: 20, y0: 100, y1: null }, { x: 30, y0: 100, y1: 40 }, { x: 40, y0: 100, y1: 50 }]);
        expect((d.match(/M/g) || []).length).toBe(2);
    });
    it('a line with a null value draws a gap and no handle there', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: null }, { x: 3, y: 4 }, { x: 4, y: 2 }],
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
        });
        document.body.appendChild(el);
        await tick();
        const path = el.querySelector('path.mark-line');
        expect((path.getAttribute('d').match(/M/g) || []).length).toBe(2);
        expect(el.querySelectorAll('circle.mark').length).toBe(4);
    });
});

describe('area over an ordinal x', () => {
    it('orders the band by the declared domain, not alphabetically', async () => {
        const el = Elicit({
            width: 300, height: 200, axes: false, margins: { top: 0, right: 0, bottom: 0, left: 0 },
            schema: { k: { type: 'categorical', domain: ['zeta', 'alpha', 'mid'] }, v: { type: 'quantitative', domain: [0, 10] } },
            data: [{ k: 'mid', v: 5 }, { k: 'alpha', v: 2 }, { k: 'zeta', v: 8 }],
            marks: [plot.areaY({ handles: false, channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        });
        document.body.appendChild(el);
        await tick();
        const d = el.querySelector('path.mark-line').getAttribute('d');
        const xs = [...d.matchAll(/([ML])([\d.]+),/g)].slice(0, 3).map((m) => +m[2]);
        expect(xs[0]).toBeLessThan(xs[1]);
        expect(xs[1]).toBeLessThan(xs[2]);
    });
});

describe('a clockwise arc', () => {
    it('draws one slice per row', async () => {
        const el = Elicit({
            width: 200, height: 200, axes: false,
            schema: { k: { type: 'categorical', domain: ['a', 'b', 'c'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 10 }, { k: 'b', v: 20 }, { k: 'c', v: 30 }],
            marks: [plot.arc({ start: 90, end: -270, channels: { theta: { field: 'v' }, fill: { field: 'k' } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(el.querySelectorAll('path.mark-line').length).toBe(3);
    });
});

describe('geo coordinates read raw', () => {
    it('geoPoint projects a constant `{ value }` latitude', async () => {
        const el = Elicit({
            width: 300, height: 200, projection: 'mercator',
            schema: { lon: { type: 'quantitative', domain: [-180, 180] }, name: { type: 'categorical' } },
            data: [{ lon: 10, name: 'x' }],
            marks: [plot.geoPoint({ channels: { lon: { field: 'lon' }, lat: { value: 49 } } })],
        });
        document.body.appendChild(el);
        await tick();
        expect(el.querySelectorAll('circle.mark').length).toBe(1);
    });
});

describe('waffleLayout', () => {
    it('is width-limited when square cells cannot fill the block', () => {
        const l = waffleLayout({ totalCells: 20, thickness: 40, blockLen: 400, multiple: 10 });
        expect(l.cellSize).toBe(4);
        expect(l.rows * l.cellSize).toBeLessThan(400);
    });
});

describe('guides', () => {
    it('region draws its label and stroke; remaining accepts a d3 format and a unit pair', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 30 }],
            guides: [
                guides.region({ y: [20, 40], stroke: 'red', label: 'target' }),
                guides.remaining({ field: 'v', total: 100, format: '.1f', unit: ['person', 'people'] }),
            ],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        });
        document.body.appendChild(el);
        await tick();
        const texts = [...el.querySelectorAll('text')].map((t) => t.textContent);
        expect(texts).toContain('target');
        expect(texts).toContain('70.0 people left');
        const outlined = [...el.querySelectorAll('rect')].some((r) => r.getAttribute('stroke') === 'red');
        expect(outlined).toBe(true);
    });
    it('proximity() with no options does not throw', () => {
        expect(() => guides.proximity()).not.toThrow();
    });
});
