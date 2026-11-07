// @vitest-environment jsdom
// `radius` is the polar family's second axis: a slice's rim sits at the value its
// field encodes to, between the mark's inner and outer radius, and a move on it
// inverts the pointer's distance from the centre.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, elements, setWarnings } from '../src/index.js';
import { axisOf, radiusExtent } from '../src/core/encoding.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function rose(extra = {}) {
    const el = Elicit({
        width: 300, height: 300, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { k: { type: 'categorical', domain: ['a', 'b', 'c', 'd'] }, share: { type: 'quantitative', domain: [0, 100] }, r: { type: 'quantitative', domain: [0, 100] } },
        data: [{ k: 'a', share: 25, r: 20 }, { k: 'b', share: 25, r: 40 }, { k: 'c', share: 25, r: 60 }, { k: 'd', share: 25, r: 100 }],
        marks: [plot.arc({ outerRadius: 120, innerRadius: 20, channels: {
            theta: { field: 'share' }, fill: { field: 'k' },
            radius: { field: 'r', edit: edit.move({ name: 'rim' }) },
        } })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}

describe('radius channel', () => {
    it('is a positional axis with the mark\'s ring as its range', () => {
        expect(axisOf('radius')).toBe('radius');
        expect(radiusExtent({ inner: 20, outer: 120 }, { width: 280, height: 280 })).toEqual({ inner: 20, outer: 120 });
        expect(radiusExtent({ inner: 0.5, outer: null }, { width: 200, height: 300 })).toEqual({ inner: 40, outer: 80 });
    });
    it('gives each slice its own rim', async () => {
        const el = rose();
        await tick();
        const radii = [...el.querySelectorAll('path.mark-line')].map((p) => p.__data__.sector.r1);
        expect(radii.length).toBe(4);
        expect(radii[0]).toBeLessThan(radii[1]);
        expect(radii[1]).toBeLessThan(radii[2]);
        expect(radii[3]).toBeCloseTo(120, 3);
        expect(radii[0]).toBeCloseTo(20 + (120 - 20) * 0.2, 3);
    });
    it('a move on radius writes the field from the pointer\'s distance to the centre', async () => {
        const el = rose();
        await tick();
        const a = el.control('rim', 0).accepts();
        expect(a.field).toBe('r');
        expect(a.domain).toEqual([0, 100]);
        el.control('rim', 0).set(70);
        expect(el.getData()[0].r).toBeCloseTo(70, 3);
    });
    it('axisRadial({ channel: "radius" }) draws rings', async () => {
        const el = rose({ elements: [elements.axisRadial({ channel: 'radius', ticks: 4 })] });
        await tick();
        const rings = [...el.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === 'none');
        expect(rings.length).toBeGreaterThan(1);
    });
});
