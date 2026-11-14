// @vitest-environment jsdom
// The cursor over an editable mark is read from its edits, not from its shape.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const schema = {
    cat: { type: 'nominal', domain: ['a', 'b'] },
    x: { type: 'quantitative', domain: [0, 10] },
    y: { type: 'quantitative', domain: [0, 10] },
};
const data = [{ cat: 'a', x: 5, y: 5 }, { cat: 'b', x: 2, y: 8 }];

async function mount(marks) {
    const el = Elicit({ width: 200, height: 100, schema, data, marks });
    document.body.appendChild(el);
    await tick();
    return el;
}
const cursorOf = (el, sel) => el.querySelector(sel).style.cursor;

describe('cursor heuristic', () => {
    it('a horizontal bar dragged along x shows ew-resize', async () => {
        const el = await mount([plot.bar({ channels: { y: { field: 'cat' }, x: { field: 'x', edit: edit.move() } } })]);
        expect(cursorOf(el, 'rect.mark')).toBe('ew-resize');
    });

    it('a vertical bar dragged along y shows ns-resize', async () => {
        const el = await mount([plot.bar({ channels: { x: { field: 'cat' }, y: { field: 'y', edit: edit.move() } } })]);
        expect(cursorOf(el, 'rect.mark')).toBe('ns-resize');
    });

    it('a point moved on both axes shows move; on one, that axis', async () => {
        const channels = { x: { field: 'x' }, y: { field: 'y' } };
        let el = await mount([plot.point({ channels, edits: [edit.move({ channels: ['x', 'y'] })] })]);
        expect(cursorOf(el, 'circle.mark')).toBe('move');
        el = await mount([plot.point({ channels, edits: [edit.move({ channel: 'x' })] })]);
        expect(cursorOf(el, 'circle.mark')).toBe('ew-resize');
    });

    it('a slide follows its travel axis, not its channel', async () => {
        const channels = { x: { field: 'x' }, y: { field: 'y' } };
        const el = await mount([plot.point({ channels, edits: [edit.slide({ channel: 'x', axis: 'y' })] })]);
        expect(cursorOf(el, 'circle.mark')).toBe('ns-resize');
    });

    it('a click edit shows pointer', async () => {
        const channels = { x: { field: 'x' }, y: { field: 'y' } };
        const el = await mount([plot.point({ channels, edits: [edit.remove({ pick: 'direct' })] })]);
        expect(cursorOf(el, 'circle.mark')).toBe('pointer');
    });

    it('an edit\'s own cursor wins', async () => {
        const el = await mount([plot.bar({ channels: { y: { field: 'cat' }, x: { field: 'x', edit: edit.move({ cursor: 'grab' }) } } })]);
        expect(cursorOf(el, 'rect.mark')).toBe('grab');
    });
});
