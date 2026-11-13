// @vitest-environment jsdom
// `el.control(name, index)` on a PLANE-pick edit. A nearest or sweep pick only
// chooses the row its edit runs on, so a control that names the row drives it
// directly. A plane edit that needs a pointer path (a draw) can't be driven by a
// row index, and says so instead of doing nothing in silence.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.remove()); });

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el);
    mounted.push(el);
    return el;
}

function captureWarnings(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; }
    return seen;
}

const lineSpec = (yEdit) => ({
    width: 300, height: 200,
    schema: { x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 100] } },
    data: [0, 1, 2, 3, 4].map((x) => ({ x, y: 50 })),
    marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: yEdit } } })],
});

describe('control() on plane-pick edits', () => {
    it('drives a sweep edit on the named row, as one undo entry', async () => {
        const el = mount(lineSpec(edit.move({ pick: 'sweep', name: 'paint' })));
        await tick();
        el.control('paint', 3).set(80);
        const d = el.getData();
        expect(d[3].y).toBeCloseTo(80, 6);
        expect(d.filter((r, i) => i !== 3).every((r) => r.y === 50)).toBe(true);
        expect(el.undo()).toBe(true);
        expect(el.getData()[3].y).toBe(50);
    });

    it('writes the NAMED row under a nearest pick, even with another row closer to the target', async () => {
        const el = mount({
            width: 300, height: 200,
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
            // Row 1 sits exactly where row 0's target lands; a pointer search would take it.
            data: [{ x: 5, y: 2 }, { x: 5, y: 9 }],
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ pick: 'nearest', name: 'near' }) } } })],
        });
        await tick();
        el.control('near', 0).set(9);
        expect(el.getData()).toEqual([{ x: 5, y: 9 }, { x: 5, y: 9 }]);
    });

    it('still honours the edit\'s `when`', async () => {
        const el = mount(lineSpec(edit.move({ pick: 'sweep', name: 'paint', when: () => false })));
        await tick();
        el.control('paint', 1).set(90);
        expect(el.getData()[1].y).toBe(50);
    });

    it('warns, and writes nothing, for a plane edit that needs a pointer path', async () => {
        const el = mount({
            ...lineSpec(undefined),
            schema: { s: { type: 'categorical' }, x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 100] } },
            marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' } }, edits: [edit.line.draw({ name: 'pen' })] })],
        });
        await tick();
        const before = el.getData();
        const warnings = captureWarnings(() => el.control('pen', 0).set(70));
        expect(el.getData()).toEqual(before);
        expect(warnings.some((w) => w.includes('el.control("pen").set()') && w.includes('pick: "draw"') && w.includes('el.emit'))).toBe(true);
    });
});
