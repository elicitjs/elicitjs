// The hover / selection outline: traced on the mark's edge, in a darker shade of the
// mark's own colour, unless a fixed colour is given.
import { describe, it, expect } from 'vitest';
import { color } from 'd3';
import { outlineColor, outlineNodes, resolveEffects, OUTLINE_FALLBACK } from '../src/core/effects.js';

const hovered = resolveEffects().hovered;

describe('outline colour', () => {
    it('defaults to a darker shade of the mark fill', () => {
        expect(outlineColor({ fill: '#50AEB7' }, hovered.outline))
            .toBe(color('#50AEB7').darker(0.6).formatHex());
    });

    it('takes the stroke when the fill is missing or near-white', () => {
        const dark = color('#2B5D87').darker(0.6).formatHex();
        expect(outlineColor({ fill: 'none', stroke: '#2B5D87' }, hovered.outline)).toBe(dark);
        expect(outlineColor({ fill: '#ffffff', stroke: '#2B5D87' }, hovered.outline)).toBe(dark);
    });

    it('uses a fixed colour as is', () => {
        expect(outlineColor({ fill: '#50AEB7' }, { color: 'crimson', darken: 2 })).toBe('crimson');
    });

    it('reads the named paint, lightens on a negative darken, and falls back', () => {
        const node = { fill: '#50AEB7', stroke: '#2B5D87' };
        expect(outlineColor(node, { color: 'stroke', darken: 0 })).toBe('#2b5d87');
        expect(outlineColor(node, { color: 'fill', darken: -1 })).toBe(color('#50AEB7').brighter(1).formatHex());
        expect(outlineColor({ fill: 'url(#g)' }, { color: 'auto' })).toBe(OUTLINE_FALLBACK);
    });

    it('hands a function the derived colour', () => {
        expect(outlineColor({ fill: '#000000' }, { color: (c) => `${c}!`, darken: 0 })).toBe('#000000!');
    });
});

describe('outline geometry', () => {
    it('traces a rect on its edge and keeps its corner radius', () => {
        const [o] = outlineNodes({ type: 'rect', x: 10, y: 20, width: 30, height: 40, rx: 3, fill: '#50AEB7' }, hovered);
        expect([o.x, o.y, o.width, o.height, o.rx]).toEqual([10, 20, 30, 40, 3]);
        expect(o.stroke).toBe(color('#50AEB7').darker(0.6).formatHex());
    });

    it('re-strokes a line wider than itself instead of boxing it', () => {
        const [o] = outlineNodes({ type: 'line', x1: 0, y1: 0, x2: 10, y2: 10, stroke: '#2B5D87', strokeWidth: 2 }, hovered);
        expect(o.type).toBe('line');
        expect(o.strokeWidth).toBe(2 + hovered.outline.width);
    });

    it('still pads when asked', () => {
        const [o] = outlineNodes({ type: 'circle', cx: 0, cy: 0, r: 5, fill: '#50AEB7' }, { outline: { width: 2, pad: 4, color: 'auto' } });
        expect(o.r).toBe(9);
    });
});
