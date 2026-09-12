// ONE orientation rule for every directional mark (plot/mark.js resolveValueAxis):
// the option, then a declared pair (meaning what the mark's `extent` says), then a
// band scale, then a lone channel (meaning what `single` says), then y. The
// `…X`/`…Y` variants are sugar that pin the option.
import { describe, it, expect } from 'vitest';
import { authoring, plot } from '../src/index.js';

const band = { kind: 'band' }, lin = { kind: 'continuous' };
const { resolveValueAxis } = authoring;

describe('resolveValueAxis', () => {
    it.each([
        // option wins
        [{ x: {}, y: {} }, { x: band, y: lin }, { orientation: 'horizontal' }, 'x'],
        // a pair: the value (area/rect) vs the chord (rule/tick/curve)
        [{ x: {}, y1: {}, y2: {} }, null, { extent: 'value' }, 'y'],
        [{ x: {}, y1: {}, y2: {} }, null, { extent: 'span' }, 'x'],
        [{ x1: {}, x2: {}, y: {} }, null, { extent: 'span' }, 'y'],
        // a band scale is the category, so the value is the other axis
        [{ x: {}, y: {} }, { x: band, y: lin }, {}, 'y'],
        [{ x: {}, y: {} }, { x: lin, y: band }, {}, 'x'],
        [{ x: {} }, { x: band }, { single: 'value' }, 'y'],
        // a lone channel: where the mark sits (rule/text) vs the category (waffle/dotStack)
        [{ x: {} }, null, { single: 'value' }, 'x'],
        [{ y: {} }, null, { single: 'other' }, 'x'],
        [{ x: {} }, null, { single: 'other' }, 'y'],
        // the default
        [{ x: {}, y: {} }, { x: lin, y: lin }, {}, 'y'],
        [{}, null, {}, 'y'],
    ])('%j / scales %j / %j -> %s', (channels, scales, opts, want) => {
        expect(resolveValueAxis(channels, scales, opts)).toBe(want);
    });
});

describe('variants are sugar over the option', () => {
    it('every …Y / …X pair pins orientation and builds the same mark as the bare form', () => {
        for (const name of ['bar', 'rect', 'tick', 'rule', 'waffle', 'dotStack', 'line', 'area', 'curve', 'text']) {
            const y = plot[name + 'Y']({ channels: { x: { field: 'x' }, y: { field: 'y' } } });
            const x = plot[name + 'X']({ channels: { x: { field: 'x' }, y: { field: 'y' } } });
            const viaOption = plot[name]({ channels: { x: { field: 'x' }, y: { field: 'y' } }, orientation: 'vertical' });
            for (const m of [y, x, viaOption]) expect(m.type).toBe(name);
            expect(Object.keys(y).sort()).toEqual(Object.keys(viaOption).sort());
        }
    });
});
