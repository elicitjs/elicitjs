// @vitest-environment jsdom
// An option an edit factory does not read is reported, not swallowed. `makeEdit`
// stamps what its factory's vocabulary cannot account for; the engine subtracts the
// knobs the edit's DRIVER declares (`Driver.options`) and warns on the rest.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { UNVERIFIED } from '../src/edit/shared.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
let warned;
beforeEach(() => { setWarnings(true); warned = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warned.mockRestore(); setWarnings(false); });

const messages = () => warned.mock.calls.map((c) => c.join(' ')).filter((m) => m.includes('[elicit]'));

async function mount(edits) {
    const el = Elicit({
        width: 200, height: 100,
        schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
        data: [{ x: 5, y: 5 }],
        marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } }, edits })],
    });
    document.body.appendChild(el);
    await tick();
    return el;
}

describe('edit option validation', () => {
    it('makeEdit stamps keys neither the universal set nor the factory vocabulary knows', () => {
        expect(edit.slide({ exent: 200 })[UNVERIFIED]).toEqual(['exent']);
        expect(edit.slide({ extent: 200, axis: 'y' })[UNVERIFIED]).toBeUndefined();
        expect(edit.move({ mode: 'relative', stage: 1, guide: true })[UNVERIFIED]).toBeUndefined();
    });

    it('reports a typo on a mark, once', async () => {
        await mount([edit.rotate({ pivot: 'mark', fold: false, pviot: 'plot' })]);
        const hits = messages().filter((m) => m.includes('pviot'));
        expect(hits.length).toBe(1);
        expect(hits[0]).toMatch(/rotate\(\)/);
    });

    it("does not report a knob the edit's driver declares", async () => {
        await mount([edit.brushRect({ resize: 'x', edgeInset: 6 })]);
        expect(messages().filter((m) => m.includes('editopt'))).toEqual([]);
        // The same knob on an edit that reaches the driver by pick alone is fine too.
        await mount([edit.custom(() => undefined, { pick: 'brush', channels: ['x1', 'x2'], edgeInset: 4 })]);
        expect(messages().filter((m) => m.includes('editopt'))).toEqual([]);
    });
});
