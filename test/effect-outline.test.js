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

describe('text outline', () => {
    const label = { type: 'text', x: 100, y: 50, text: 'hello', fontSize: 12, textAnchor: 'middle', lineAnchor: 'middle', fill: '#111' };

    it('draws nothing by default: the cursor is the feedback', () => {
        const fx = resolveEffects();
        expect(outlineNodes(label, fx.hovered)).toEqual([]);
        expect(outlineNodes(label, fx.selected)).toEqual([]);
    });

    it('a theme outline does not count as asked for', () => {
        const fx = resolveEffects({}, { hovered: { outline: { color: 'red', width: 2 } } });
        expect(outlineNodes(label, fx.hovered)).toEqual([]);
    });

    it('draws a box around the text when the spec sets an outline', () => {
        const fx = resolveEffects({ hovered: { outline: { color: 'red' } } });
        const [o] = outlineNodes(label, fx.hovered);
        expect(o.type).toBe('rect');
        expect(o.stroke).toBe('red');
        // Centred on the anchor, wider than tall for a word.
        expect(o.x + o.width / 2).toBeCloseTo(100);
        expect(o.y + o.height / 2).toBeCloseTo(50);
        expect(o.width).toBeGreaterThan(o.height);
    });

    it('places the box by textAnchor and lineAnchor', () => {
        const fx = resolveEffects({ hovered: { outline: { pad: 0 } } });
        const [o] = outlineNodes({ ...label, textAnchor: 'start', lineAnchor: 'top' }, fx.hovered);
        expect(o.x).toBeLessThan(100);
        expect(o.x).toBeGreaterThan(95);
        expect(o.y).toBeLessThan(50);
        expect(o.y).toBeGreaterThan(45);
    });

    it('turns a rotated label\'s box about the text anchor', () => {
        const fx = resolveEffects({ hovered: { outline: {} } });
        const [o] = outlineNodes({ ...label, angle: 90 }, fx.hovered);
        expect(o.type).toBe('path');
        expect(o.angle).toBeUndefined();
        expect(o.d.startsWith('M')).toBe(true);
    });
});
