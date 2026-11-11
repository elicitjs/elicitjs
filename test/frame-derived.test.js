// @vitest-environment jsdom
// Two forms of a composite's local frame that a jointed glyph needs:
//   { fn, frame: true }   a position DERIVED in local units, so one part sits
//                         where another part's value puts it (an elbow at the
//                         end of an upper arm)
//   a categorical field   a point frame scale: categories spread evenly over the
//                         range, inverting to the nearest one
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { createFrameScale } from '../src/core/scales.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('createFrameScale over a discrete domain', () => {
    it('spreads categories from the first stop to the last, with no padding', () => {
        const s = createFrameScale({ domain: ['down', 'out', 'up'], localRange: [-90, 90], discrete: true });
        expect(s.kind).toBe('point');
        expect(s.encode('down')).toBeCloseTo(-90, 6);
        expect(s.encode('out')).toBeCloseTo(0, 6);
        expect(s.encode('up')).toBeCloseTo(90, 6);
        expect(s.invertValue(60)).toBe('up');
        expect(s.invertValue(-20)).toBe('out');
    });
    it('places positional categories inside the box', () => {
        const s = createFrameScale({
            domain: ['a', 'b'], localRange: [-1, 1], origin: 100, halfSize: 50, family: 'x', discrete: true,
        });
        expect(s.encode('a')).toBeCloseTo(50, 6);
        expect(s.encode('b')).toBeCloseTo(150, 6);
    });
});

/** A one-row box with a needle whose pivot is derived from `upper`. */
function arm(schema, data, extra = {}) {
    const el = Elicit({
        width: 200, height: 200, axes: false, margins: { top: 0, right: 0, bottom: 0, left: 0 },
        schema, data,
        marks: [plot.composite({
            channels: { size: { value: 100 } },
            parts: [
                plot.needle({ channels: {
                    x: { frame: 0 }, y: { frame: 0 }, size: { frame: 0.5 },
                    theta: { field: 'upper', frame: [-90, 90], edit: edit.rotate({ name: 'upper', pivot: 'mark', fold: false, pick: 'direct' }) },
                } }),
                plot.point({ channels: {
                    x: { fn: (d) => 0.5 * Math.cos(extra.deg(d) * Math.PI / 180), frame: true },
                    y: { fn: (d) => 0.5 * Math.sin(extra.deg(d) * Math.PI / 180), frame: true },
                    size: { value: 3 },
                } }),
            ],
        })],
    });
    document.body.appendChild(el);
    return el;
}

describe('{ fn, frame: true }', () => {
    it('places a part in local units, at the end of the segment it hangs from', async () => {
        const el = arm(
            { upper: { type: 'quantitative', domain: [0, 180] } },
            [{ upper: 90 }],
            { deg: (d) => d.upper - 90 },
        );
        await tick();
        // upper 90 -> bearing 0: the segment points right, 0.5 * 100px from the centre.
        const dot = [...el.querySelectorAll('circle.mark')].find((c) => c.getAttribute('r') === '3');
        expect(Number(dot.getAttribute('cx'))).toBeCloseTo(150, 3);
        expect(Number(dot.getAttribute('cy'))).toBeCloseTo(100, 3);
    });
    it('a categorical frame field snaps an edit to the nearest category', async () => {
        const deg = { down: -90, out: 0, up: 90 };
        const el = arm(
            { upper: { type: 'categorical', domain: ['down', 'out', 'up'] } },
            [{ upper: 'down' }],
            { deg: (d) => deg[d.upper] },
        );
        await tick();
        const ctl = el.control('upper', 0);
        expect(ctl.accepts().domain).toEqual(['down', 'out', 'up']);
        ctl.set('up');
        expect(el.getData()[0].upper).toBe('up');
        await tick();
        const dot = [...el.querySelectorAll('circle.mark')].find((c) => c.getAttribute('r') === '3');
        expect(Number(dot.getAttribute('cx'))).toBeCloseTo(100, 3);
        expect(Number(dot.getAttribute('cy'))).toBeCloseTo(50, 3);
    });
});
