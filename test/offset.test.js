// @vitest-environment jsdom
// `xOffset` / `yOffset` nest a second category inside each x (y) category: the
// category's slot is split into one sub-band per value, which is a grouped bar, a
// grouped waffle, a dodged dot. Every mark that places by category reads it through
// one helper (`categorySlot`) or through `encodeChannel`, and an edit inverts it
// with the rest of the position.
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { scaleTypeFor, offsetParentOf, axisOf } from '../src/core/encoding.js';
import { createScale, slotOf, slotWidthOf } from '../src/core/scales.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

const cats = ['A', 'B', 'C'];
const groups = ['x', 'y', 'z'];
const rows = () => cats.flatMap((category) => groups.map((group) => ({ category, group, value: 50 })));
const schema = {
    category: { type: 'categorical', domain: cats },
    group: { type: 'categorical', domain: groups },
    value: { type: 'quantitative', domain: [0, 100] },
};

// Inner plot 300 x 200.
function chart(marks, extra = {}) {
    const el = Elicit({
        width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema, data: rows(), marks, ...extra,
    });
    document.body.appendChild(el);
    return el;
}
const nodes = (el, sel) => [...el.querySelectorAll(sel)].map((n) => n.__data__).filter((d) => d && d.data);

describe('offset channels: the family', () => {
    it('are not axes, nest inside x/y, and always take a band for a category', () => {
        expect(axisOf('xOffset')).toBeUndefined();
        expect(offsetParentOf('xOffset')).toBe('x');
        expect(offsetParentOf('yOffset')).toBe('y');
        expect(scaleTypeFor('xOffset', 'categorical', 'point')).toBe('band');
        expect(scaleTypeFor('xOffset', 'quantitative', 'band')).toBe('linear');
    });
    it('a point scale has a slot one step wide, centred on its tick', () => {
        const p = createScale({ type: 'point', domain: ['a', 'b'] }, [0, 200]);
        expect(slotWidthOf(p)).toBe(100);
        expect(slotOf(p, 'a')).toEqual({ start: 0, width: 100 });
        expect(slotOf(createScale({ type: 'linear', domain: [0, 1] }, [0, 1]), 0)).toBeNull();
    });
});

describe('grouped bar', () => {
    const grouped = (extra = {}) => chart([plot.barY({ channels: {
        x: { field: 'category' }, xOffset: { field: 'group' },
        y: { field: 'value', edit: edit.move() }, fill: { field: 'group' },
    } })], extra);

    it('splits each band into abutting sub-bands, one per group, in domain order', async () => {
        const el = grouped();
        await tick();
        const bars = nodes(el, 'rect.mark');
        expect(bars.length).toBe(9);
        const inA = bars.filter((b) => b.data.category === 'A').sort((a, b) => a.x - b.x);
        expect(inA.map((b) => b.data.group)).toEqual(groups);
        const w = inA[0].width;
        for (const b of inA) expect(b.width).toBeCloseTo(w, 6);
        // abut: each sub-band starts where the previous one ends
        expect(inA[1].x).toBeCloseTo(inA[0].x + w, 6);
        expect(inA[2].x).toBeCloseTo(inA[1].x + w, 6);
        // and the three fill A's band, which sits left of B's
        const inB = bars.filter((b) => b.data.category === 'B').sort((a, b) => a.x - b.x);
        expect(inA[2].x + w).toBeLessThan(inB[0].x);
    });

    it('a scale padding opens a gap inside each group', async () => {
        const el = chart([plot.barY({ channels: {
            x: { field: 'category' }, xOffset: { field: 'group', scale: { padding: 0.2 } }, y: { field: 'value' },
        } })]);
        await tick();
        const inA = nodes(el, 'rect.mark').filter((b) => b.data.category === 'A').sort((a, b) => a.x - b.x);
        expect(inA[1].x - (inA[0].x + inA[0].width)).toBeGreaterThan(1);
    });

    it('a move on y still writes the value of the bar under the pointer', async () => {
        const el = grouped();
        await tick();
        const bar = nodes(el, 'rect.mark').find((b) => b.data.category === 'B' && b.data.group === 'z');
        const node = { ...bar };
        const x = bar.x + bar.width / 2;
        el.emit({ type: 'dragstart', node, x, y: bar.y });
        el.emit({ type: 'drag', node, x, y: 40 });
        el.emit({ type: 'dragend', node, x, y: 40 });
        const d = el.getData().find((r) => r.category === 'B' && r.group === 'z');
        expect(d.value).toBeCloseTo(80, 0);
        expect(el.getData().filter((r) => r.value !== 50).length).toBe(1);
    });

    it('horizontal: yOffset lists the first group at the bottom of its slot', async () => {
        const el = chart([plot.barX({ channels: {
            y: { field: 'category' }, yOffset: { field: 'group' }, x: { field: 'value' },
        } })]);
        await tick();
        const inA = nodes(el, 'rect.mark').filter((b) => b.data.category === 'A');
        const byGroup = Object.fromEntries(inA.map((b) => [b.data.group, b]));
        expect(byGroup.x.y).toBeGreaterThan(byGroup.z.y);
        expect(byGroup.x.height).toBeCloseTo(byGroup.z.height, 6);
    });

    it('a stacked AND grouped bar stacks within each sub-band', async () => {
        const data = [
            { category: 'A', group: 'x', part: 'p', value: 20 }, { category: 'A', group: 'x', part: 'q', value: 30 },
            { category: 'A', group: 'y', part: 'p', value: 10 },
        ];
        const el = chart([plot.barY({ stack: true, channels: {
            x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' }, series: { field: 'part' },
        } })], { data, schema: { ...schema, part: { type: 'categorical', domain: ['p', 'q'] } } });
        await tick();
        const bars = nodes(el, 'rect.mark');
        const ax = bars.filter((b) => b.data.group === 'x').sort((a, b) => b.y - a.y);
        const ay = bars.find((b) => b.data.group === 'y');
        // the two x segments stack on each other; the y segment starts at the baseline
        expect(ax[0].y).toBeCloseTo(ax[1].y + ax[1].height, 6);
        expect(ay.y + ay.height).toBeCloseTo(200, 6);
        expect(ay.x).toBeGreaterThan(ax[0].x);
    });

    it('a row with a category but no group draws nothing', async () => {
        const el = chart([plot.barY({ channels: {
            x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' },
        } })], { data: [...rows(), { category: 'A', group: null, value: 90 }] });
        await tick();
        expect(nodes(el, 'rect.mark').length).toBe(9);
    });
});

describe('every category-placed mark honours it', () => {
    it('point and text sit at their sub-band centre', async () => {
        const el = chart([
            plot.barY({ channels: { x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' } } }),
            plot.point({ channels: { x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' } } }),
        ]);
        await tick();
        const bars = nodes(el, 'rect.mark');
        const dots = nodes(el, 'circle.mark');
        for (const dot of dots) {
            const bar = bars.find((b) => b.data === dot.data);
            expect(dot.cx).toBeCloseTo(bar.x + bar.width / 2, 6);
        }
    });

    it('tick spans its sub-band', async () => {
        const el = chart([plot.tickY({ channels: { x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' } } })]);
        await tick();
        const ticks = nodes(el, 'line.mark').filter((t) => t.data.category === 'A').sort((a, b) => a.x1 - b.x1);
        expect(ticks.length).toBe(3);
        expect(ticks[0].x2).toBeLessThanOrEqual(ticks[1].x1 + 1e-6);
    });

    it('waffle: one block per (category, group), side by side', async () => {
        const el = chart([plot.waffleY({ unit: 10, channels: {
            x: { field: 'category' }, xOffset: { field: 'group' }, count: { field: 'value' },
        } })], { schema: { ...schema, value: { type: 'quantitative', domain: [0, 100] } } });
        await tick();
        const cells = nodes(el, 'rect.mark');
        expect(cells.length).toBe(9 * 10);
        const blocks = new Map();
        for (const c of cells) {
            const k = c.data.category + c.data.group;
            const b = blocks.get(k) || { lo: Infinity, hi: -Infinity };
            b.lo = Math.min(b.lo, c.x); b.hi = Math.max(b.hi, c.x + c.width);
            blocks.set(k, b);
        }
        expect(blocks.size).toBe(9);
        expect(blocks.get('Ax').hi).toBeLessThanOrEqual(blocks.get('Ay').lo + 1e-6);
        expect(blocks.get('Ay').hi).toBeLessThanOrEqual(blocks.get('Az').lo + 1e-6);
    });

    it('dotStack: tokens stack per (category, group), and every sub-slot gets a ghost', async () => {
        const data = [{ category: 'A', group: 'x' }, { category: 'A', group: 'x' }, { category: 'A', group: 'y' }];
        const el = chart([plot.dotStackY({ size: 4, channels: { x: { field: 'category' }, xOffset: { field: 'group' } } })],
            { data, schema: { category: schema.category, group: schema.group } });
        await tick();
        const all = [...el.querySelectorAll('circle')].map((n) => n.__data__);
        const tokens = all.filter((d) => d && d.data);
        const ghosts = all.filter((d) => d && !d.data && d.fill === 'none');
        expect(ghosts.length).toBe(9);
        const ax = tokens.filter((t) => t.data.group === 'x');
        const ay = tokens.find((t) => t.data.group === 'y');
        expect(ax[0].cx).toBeCloseTo(ax[1].cx, 6);
        expect(ax[0].cy).not.toBeCloseTo(ax[1].cy, 1);
        expect(ay.cx).toBeGreaterThan(ax[0].cx);
        expect(ay.cy).toBeCloseTo(Math.max(ax[0].cy, ax[1].cy), 6);
    });
});

describe('an edit inverts the offset with the position', () => {
    it('create names a category AND a group from one click', async () => {
        const el = chart([plot.dotStackY({ size: 4, channels: { x: { field: 'category' }, xOffset: { field: 'group' } },
            edits: [edit.create()] })], { data: [], schema: { category: schema.category, group: schema.group } });
        await tick();
        // Point scale over A, B, C with step 100: B's slot is [100, 200]; z's third is [167, 200].
        el.emit({ type: 'click', x: 185, y: 150 });
        expect(el.getData()).toEqual([{ category: 'B', group: 'z' }]);
        el.emit({ type: 'click', x: 10, y: 150 });
        expect(el.getData()[1]).toEqual({ category: 'A', group: 'x' });
    });

    it('move on x and xOffset re-files a bar in another category and group', async () => {
        const el = chart([plot.barY({ channels: {
            x: { field: 'category' }, xOffset: { field: 'group' }, y: { field: 'value' },
        }, edits: [edit.move({ channels: ['x', 'xOffset'] })] })]);
        await tick();
        const bar = nodes(el, 'rect.mark').find((b) => b.data.category === 'A' && b.data.group === 'x');
        const target = nodes(el, 'rect.mark').find((b) => b.data.category === 'C' && b.data.group === 'y');
        const node = { ...bar };
        const to = { x: target.x + target.width / 2, y: 100 };
        el.emit({ type: 'dragstart', node, x: bar.x + 1, y: 100 });
        el.emit({ type: 'drag', node, ...to });
        el.emit({ type: 'dragend', node, ...to });
        expect(el.getData()[0]).toMatchObject({ category: 'C', group: 'y' });
    });
});

describe('diagnostics', () => {
    it('warns when the parent axis is continuous, and draws undodged', async () => {
        setWarnings(true);
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const el = chart([plot.point({ channels: {
            x: { field: 'value' }, xOffset: { field: 'group' }, y: { field: 'value' },
        } })]);
        await tick();
        const said = spy.mock.calls.map((c) => String(c[0])).join('\n');
        spy.mockRestore();
        setWarnings(false);
        expect(said).toMatch(/xOffset.*continuous/);
        const dots = nodes(el, 'circle.mark');
        expect(dots[0].cx).toBeCloseTo(150, 6);
    });
});
