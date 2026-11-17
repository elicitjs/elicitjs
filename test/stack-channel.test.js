// @vitest-environment jsdom
// The `stack` channel names each part of a whole. On a bar it turns stacking on;
// on an arc it orders the slices. Order is the field's schema domain, else first
// appearance. `edit.stack.cut` writes the new segment's category into it.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { stackOrder } from '../src/plot/stack.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

const schema = {
    band: { type: 'categorical', domain: ['A', 'B'] },
    part: { type: 'categorical', domain: ['p', 'q', 'r'] },
    value: { type: 'quantitative', domain: [0, 100] },
};

// Inner plot 300 x 200.
function chart(marks, extra = {}) {
    const el = Elicit({
        width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema, marks, ...extra,
    });
    document.body.appendChild(el.dom());
    return el;
}
const nodes = (el, sel) => [...el.dom().querySelectorAll(sel)].map((n) => n.__data__).filter((d) => d && d.data);

/** Run `fn` with warnings on and return what was warned. */
async function warningsOf(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { await fn(); } finally { console.warn = orig; setWarnings(false); }
    return seen;
}

describe('bar: the stack channel', () => {
    it('stacks in the schema domain order, whatever the data order', async () => {
        const data = [
            { band: 'A', part: 'q', value: 30 },
            { band: 'A', part: 'p', value: 20 },
        ];
        const el = chart([plot.barY({ channels: {
            x: { field: 'band' }, y: { field: 'value' }, stack: { field: 'part' },
        } })], { data });
        await tick();
        const bars = nodes(el, 'rect.mark');
        const p = bars.find((b) => b.data.part === 'p');
        const q = bars.find((b) => b.data.part === 'q');
        // p sits on the baseline, q on top of it
        expect(p.y + p.height).toBeCloseTo(200, 6);
        expect(q.y + q.height).toBeCloseTo(p.y, 6);
    });

    it('without a stack channel, rows sharing a band warn that they overlap', async () => {
        const data = [{ band: 'A', part: 'p', value: 20 }, { band: 'A', part: 'q', value: 30 }];
        const seen = await warningsOf(async () => {
            chart([plot.barY({ channels: { x: { field: 'band' }, y: { field: 'value' }, fill: { field: 'part' } } })], { data });
            await tick();
        });
        expect(seen.some((m) => m.includes('draw over each other'))).toBe(true);
    });

    it('does not warn for rows that hide nothing: no value, opposite signs, or translucent', async () => {
        const schemaSigned = { ...schema, value: { type: 'quantitative', domain: [-100, 100] } };
        const cases = [
            { data: [{ band: 'A', value: 20 }, { band: 'A', value: null }], opts: {} },
            { data: [{ band: 'A', value: -20 }, { band: 'A', value: 30 }], opts: {} },
            { data: [{ band: 'A', value: 20 }, { band: 'A', value: 30 }], opts: { opacity: 0.6 } },
        ];
        for (const { data, opts } of cases) {
            const seen = await warningsOf(async () => {
                chart([plot.barY({ ...opts, channels: { x: { field: 'band' }, y: { field: 'value' } } })], { data, schema: schemaSigned });
                await tick();
            });
            expect(seen.some((m) => m.includes('draw over each other'))).toBe(false);
        }
    });

    it('a dodged bar does not warn', async () => {
        const data = [{ band: 'A', part: 'p', value: 20 }, { band: 'A', part: 'q', value: 30 }];
        const seen = await warningsOf(async () => {
            chart([plot.barY({ channels: { x: { field: 'band' }, xOffset: { field: 'part' }, y: { field: 'value' } } })], { data });
            await tick();
        });
        expect(seen.some((m) => m.includes('draw over each other'))).toBe(false);
    });

    it('warns when the stack field is not categorical or ordinal', async () => {
        const data = [{ band: 'A', part: 'p', value: 20 }];
        const seen = await warningsOf(async () => {
            chart([plot.barY({ channels: { x: { field: 'band' }, y: { field: 'value' }, stack: { field: 'value' } } })], { data });
            await tick();
        });
        expect(seen.some((m) => m.includes('`stack` field "value" is quantitative'))).toBe(true);
    });

    it('turns on edit.stack.*: an unstacked bar does not support it', () => {
        expect(plot.barY({ channels: { x: { field: 'band' }, y: { field: 'value' } } }).supportsStack).toBe(false);
        expect(plot.barY({ channels: { x: { field: 'band' }, y: { field: 'value' }, stack: { field: 'part' } } }).supportsStack).toBe(true);
    });
});

describe('arc: the stack channel', () => {
    it('orders the slices by the domain', async () => {
        const data = [
            { part: 'r', value: 10 }, { part: 'p', value: 10 }, { part: 'q', value: 10 },
        ];
        const el = chart([plot.arc({ channels: { theta: { field: 'value' }, stack: { field: 'part' } } })], { data });
        await tick();
        const slices = [...el.dom().querySelectorAll('path.mark-line')].map((n) => n.__data__).filter((d) => d && d.midAngle != null);
        const mid = (part) => slices.find((s) => data[s.index].part === part).midAngle;
        expect(mid('p')).toBeLessThan(mid('q'));
        expect(mid('q')).toBeLessThan(mid('r'));
    });
});

describe('edit.stack.cut: the stack field', () => {
    // A linear value axis where 1 px = 1 data unit.
    const scales = { y: { invertible: true, invertValue: (px) => px } };
    const markChannels = { x: { field: 'band' }, y: { field: 'value' }, stack: { field: 'part' } };
    const cutAt = (data, members, local, at, { schema: s = schema, channels = markChannels } = {}) =>
        edit.stack.cut().apply({
            data, schema: s, scales, markChannels: channels, pointer: { x: 0, y: at },
            node: { stack: { members, local, field: 'value', geometry: { kind: 'linear', axis: 'y' } } },
        });

    it('refuses and warns with no stack channel', async () => {
        const data = [{ band: 'A', part: 'p', value: 50 }];
        let out;
        const seen = await warningsOf(() => {
            out = cutAt(data, [0], 0, 20, { channels: { x: { field: 'band' }, y: { field: 'value' } } });
        });
        expect(out).toBeUndefined();
        expect(seen.some((m) => m.includes('needs a `stack` channel'))).toBe(true);
    });

    it('takes a free category just after the cut segment, so nothing reorders', () => {
        const s = { ...schema, part: { type: 'categorical', domain: ['p', 'q', 'r', 's'] } };
        const data = [{ band: 'A', part: 'p', value: 50 }, { band: 'A', part: 'r', value: 50 }];
        const out = cutAt(data, [0, 1], 0, 20, { schema: s });
        expect(out.data.map((d) => [d.part, d.value])).toEqual([['p', 20], ['q', 30], ['r', 50]]);
    });

    it('takes the lower part when the free category sorts just before', () => {
        const s = { ...schema, part: { type: 'categorical', domain: ['p', 'q', 'r', 's'] } };
        const data = [{ band: 'A', part: 'p', value: 50 }, { band: 'A', part: 's', value: 50 }];
        // Cut s (spanning 50..100) at 70: the free categories after s are none, q/r sort before it.
        const out = cutAt(data, [0, 1], 1, 70, { schema: s });
        expect(out.data.map((d) => [d.part, d.value])).toEqual([['p', 50], ['q', 20], ['s', 30]]);
    });

    it('an open domain mints a category in its place in the order', () => {
        const s = { ...schema, part: { type: 'categorical', domain: ['p', 'q'], open: true } };
        const data = [{ band: 'A', part: 'p', value: 50 }, { band: 'A', part: 'q', value: 50 }];
        const out = cutAt(data, [0, 1], 0, 20, { schema: s });
        const minted = out.data[1].part;
        expect(out.domains.part).toEqual(['p', minted, 'q']);
    });

    it('an undeclared field places the new row so first appearance keeps the order', () => {
        const s = { band: schema.band, value: schema.value };
        const data = [
            { band: 'A', part: 'p', value: 50 }, { band: 'A', part: 'q', value: 50 },
            { band: 'B', part: 'p', value: 50 }, { band: 'B', part: 'q', value: 50 },
        ];
        const out = cutAt(data, [2, 3], 0, 20, { schema: s });
        const minted = out.data.find((d) => !['p', 'q'].includes(d.part)).part;
        expect(stackOrder(out.data, 'part', undefined)).toEqual(['p', minted, 'q']);
        expect(out.domains).toEqual({});
    });
});
