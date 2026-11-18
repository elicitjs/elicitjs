// Slot layouts for a container's contents (src/core/arrange.js).
import { describe, it, expect } from 'vitest';
import { slotsOf, nearestSlot, readingOrder } from '../src/core/arrange.js';

const item = (w, h, round = false) => ({ hw: w / 2, hh: h / 2, round });
const opts = (arrange, extra = {}) => ({
    arrange, gap: 10, columns: null, origin: { x: 0, y: 0 }, limit: { x: null, y: null }, ...extra,
});
const boxes = (items, slots) => items.map((m, k) => ({ ...m, cx: slots[k].x, cy: slots[k].y }));
const clear = (a, b, gap) => Math.abs(a.cx - b.cx) >= a.hw + b.hw + gap - 0.01
    || Math.abs(a.cy - b.cy) >= a.hh + b.hh + gap - 0.01;
const allClear = (bs, gap) => bs.every((a, i) => bs.slice(i + 1).every((b) => clear(a, b, gap)));

describe('row', () => {
    it('lines children up from the top-left, in order, the gap apart', () => {
        const items = [item(40, 20), item(60, 30), item(20, 20)];
        const s = slotsOf(items, opts('row', { origin: { x: 5, y: 7 } }));
        expect(s).toEqual([{ x: 25, y: 17 }, { x: 85, y: 22 }, { x: 135, y: 17 }]);
    });

    it('wraps at the limit, and only when there is one', () => {
        const items = [item(40, 20), item(40, 20), item(40, 20)];
        const wrapped = slotsOf(items, opts('row', { limit: { x: 100, y: null } }));
        expect(wrapped[2]).toEqual({ x: 20, y: 40 });
        expect(slotsOf(items, opts('row'))[2].y).toBe(10);
    });

    it('puts a child wider than the room on a line of its own', () => {
        const s = slotsOf([item(200, 20), item(20, 20)], opts('row', { limit: { x: 100, y: null } }));
        expect(s[0]).toEqual({ x: 100, y: 10 });
        expect(s[1].y).toBe(40);
    });
});

describe('column', () => {
    it('stacks children top to bottom and wraps into a new column at the limit', () => {
        const items = [item(40, 20), item(30, 20), item(40, 20)];
        expect(slotsOf(items, opts('column')).map((p) => p.y)).toEqual([10, 40, 70]);
        const wrapped = slotsOf(items, opts('column', { limit: { x: null, y: 50 } }));
        expect(wrapped[2]).toEqual({ x: 70, y: 10 });
    });
});

describe('grid', () => {
    it('puts each child in an equal cell, `columns` to a row', () => {
        const items = [item(40, 20), item(20, 30), item(40, 20), item(40, 20)];
        const s = slotsOf(items, opts('grid', { columns: 3 }));
        expect(s[0]).toEqual({ x: 20, y: 15 });
        expect(s[1]).toEqual({ x: 70, y: 15 });
        expect(s[3]).toEqual({ x: 20, y: 55 });
    });

    it('fits as many columns as the width allows, else a square', () => {
        const items = Array.from({ length: 5 }, () => item(40, 20));
        expect(new Set(slotsOf(items, opts('grid', { limit: { x: 120, y: null } })).map((p) => p.x)).size).toBe(2);
        expect(new Set(slotsOf(items, opts('grid')).map((p) => p.x)).size).toBe(3);
    });
});

describe('pack', () => {
    const at = (r, cx, cy, moved = false) => ({ ...item(2 * r, 2 * r, true), cx, cy, moved });
    const apart = (items, s) => {
        let closest = Infinity;
        for (let i = 0; i < s.length; i++) {
            for (let j = i + 1; j < s.length; j++) {
                closest = Math.min(closest, Math.hypot(s[i].x - s[j].x, s[i].y - s[j].y) - items[i].hw - items[j].hw);
            }
        }
        return closest;
    };

    it('packs circles that start on one spot their gap apart, touching', () => {
        const items = [10, 20, 15, 8, 12, 25, 6].map((r, k) => at(r, 100 + k, 50));
        const s = slotsOf(items, opts('pack', { gap: 4 }));
        expect(apart(items, s)).toBeCloseTo(4, 1);
        expect(new Set(s.map((p) => Math.round(p.y))).size).toBeGreaterThan(1);
    });

    it('leaves a packed group where it is', () => {
        const items = [10, 20, 15, 8, 12, 25, 6].map((r, k) => at(r, 100 + k, 50));
        const s = slotsOf(items, opts('pack', { gap: 4 }));
        const again = slotsOf(items.map((m, k) => ({ ...m, cx: s[k].x, cy: s[k].y })), opts('pack', { gap: 4 }));
        again.forEach((p, k) => {
            expect(p.x).toBeCloseTo(s[k].x, 6);
            expect(p.y).toBeCloseTo(s[k].y, 6);
        });
    });

    it('gives a moved circle the free spot nearest it; the others stay', () => {
        // three in a row, touching (gap 0), and a fourth dropped onto the middle one
        const items = [at(10, 0, 0), at(10, 20, 0), at(10, 40, 0), at(10, 22, 3, true)];
        const s = slotsOf(items, opts('pack', { gap: 0 }));
        expect(s.slice(0, 3)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }]);
        expect(apart(items, s)).toBeGreaterThan(-0.01);
        // it nestles on the side it was dropped, against the middle one
        expect(s[3].y).toBeGreaterThan(0);
        expect(Math.hypot(s[3].x - 20, s[3].y)).toBeCloseTo(20, 3);
    });

    it('draws a circle put away from the group in to touch it', () => {
        const items = [at(10, 0, 0), at(10, 20, 0), at(5, 100, 0, true)];
        const s = slotsOf(items, opts('pack', { gap: 0 }));
        expect(s[2].x).toBeCloseTo(35, 5);
        expect(s[2].y).toBeCloseTo(0, 5);
    });
});

describe('nearestSlot', () => {
    it('gives a moved child the slot nearest where it was put', () => {
        const others = [item(40, 20), item(40, 20), item(40, 20)];
        const o = opts('column');
        // slots of four: y = 10, 40, 70, 100
        expect(nearestSlot(others, { ...item(40, 20), cx: 20, cy: -5 }, o)).toBe(0);
        expect(nearestSlot(others, { ...item(40, 20), cx: 20, cy: 45 }, o)).toBe(1);
        expect(nearestSlot(others, { ...item(40, 20), cx: 20, cy: 400 }, o)).toBe(3);
    });

    it('leaves no overlap whichever slot it takes', () => {
        const others = [item(40, 20), item(60, 20), item(30, 20)];
        const o = opts('row', { limit: { x: 120, y: null } });
        for (const cx of [0, 50, 100, 150]) {
            const moved = { ...item(40, 20), cx, cy: 10 };
            const order = [...others];
            order.splice(nearestSlot(others, moved, o), 0, moved);
            expect(allClear(boxes(order, slotsOf(order, o)), 10)).toBe(true);
        }
    });
});

describe('readingOrder', () => {
    it('reads a wrapped row by line, then left to right', () => {
        const at = (cx, cy) => ({ cx, cy, hw: 10, hh: 10 });
        const rows = [at(50, 40), at(80, 10), at(20, 40), at(20, 10)];
        expect(rows.sort(readingOrder('row', true))).toEqual([at(20, 10), at(80, 10), at(20, 40), at(50, 40)]);
    });
});
