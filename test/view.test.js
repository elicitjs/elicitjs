// @vitest-environment jsdom
// The chart's read surface (engine/view.js): what is drawn and where, the scales,
// the declared edits, the pixel spaces, and the `render` / `destroy` events.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.dom().remove()); });

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    return el;
}

// Inner size 400 x 300 (no margins): a node's pixel is (x * 4, 300 - y * 3).
const flowSpec = (extra = {}) => ({
    width: 400, height: 300,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    axes: false,
    schema: {
        structure: 'network',
        tables: {
            steps: {
                role: 'nodes',
                fields: {
                    id: { type: 'categorical', key: true, open: true },
                    label: { type: 'categorical', open: true },
                    kind: { type: 'categorical', domain: ['a', 'b', 'c'] },
                    w: { type: 'quantitative', domain: [60, 200] },
                    x: { type: 'quantitative', domain: [0, 100] },
                    y: { type: 'quantitative', domain: [0, 100] },
                },
            },
            flows: { role: 'links', fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
        },
    },
    data: {
        steps: [
            { id: 's1', label: 'One', kind: 'a', w: 100, x: 20, y: 80 },
            { id: 's2', label: 'Two', kind: 'b', w: 120, x: 70, y: 30 },
        ],
        flows: [{ source: 's1', target: 's2' }],
    },
    marks: [
        plot.link({ id: 'flow', edits: [edit.network.rewire({ name: 'rewire' }), edit.remove({ name: 'unlink', gesture: 'commit' })] }),
        plot.sticker({
            id: 'note',
            edits: [edit.remove({ name: 'delete', gesture: 'commit', stage: 1 })],
            channels: {
                x: { field: 'x', edit: edit.move({ name: 'drag', channels: ['x', 'y'], mode: 'relative' }) },
                y: { field: 'y' },
                text: { field: 'label' },
                fill: { field: 'kind' },
                width: { field: 'w', scale: { range: [60, 200] } },
                ports: { value: true, edit: edit.network.connect({ name: 'link' }) },
            },
        }),
    ],
    ...extra,
});

describe('chart.scene()', () => {
    it('reports a row\'s drawn pieces with their boxes, in inner pixels', async () => {
        const el = mount(flowSpec());
        await tick();
        const body = el.scene({ mark: 'note/body', index: 0 });
        expect(body).toHaveLength(1);
        expect(body[0]).toMatchObject({ mark: 'note/body', table: 'steps', index: 0, type: 'rect', editable: true, visible: true });
        expect(body[0].box.width).toBeCloseTo(100, 6);
        expect(body[0].center.x).toBeCloseTo(80, 6);
        expect(body[0].center.y).toBeCloseTo(60, 6);
        expect(body[0].datum).toEqual({ id: 's1', label: 'One', kind: 'a', w: 100, x: 20, y: 80 });
    });

    it('names a glyph by its id: the box, the label and the ports', async () => {
        const el = mount(flowSpec());
        await tick();
        const marks = new Set(el.scene({ mark: 'note', index: 1 }).map((v) => v.mark));
        expect([...marks].sort()).toEqual(['note/body', 'note/body/ports', 'note/label']);
    });

    it('tells a row\'s handles apart by channel and side, and says a resting port is hidden', async () => {
        const el = mount(flowSpec());
        await tick();
        const right = el.scene({ mark: 'note', index: 0, channel: 'port', side: 'right' });
        expect(right).toHaveLength(1);
        expect(right[0]).toMatchObject({ channel: 'port', side: 'right', visible: false });
        expect(right[0].center.x).toBeCloseTo(130, 6);
        const ends = el.scene({ mark: 'flow', index: 0 }).filter((v) => v.channel);
        expect(ends.map((v) => v.channel).sort()).toEqual(['source', 'target']);
    });

    it('puts a link\'s centre on its line', async () => {
        const el = mount(flowSpec());
        await tick();
        const line = el.scene({ mark: 'flow', index: 0 }).find((v) => v.type === 'path' && !v.channel);
        const [a, b] = ['source', 'target'].map((ch) => el.scene({ mark: 'flow', channel: ch })[0].center);
        expect(line.center.x).toBeCloseTo((a.x + b.x) / 2, 4);
        expect(line.center.y).toBeCloseTo((a.y + b.y) / 2, 4);
    });

    it('hands out copies: changing a view or its datum changes nothing', async () => {
        const el = mount(flowSpec());
        await tick();
        const v = el.scene({ mark: 'note/body', index: 0 })[0];
        v.box.x = -999;
        v.datum.label = 'changed';
        expect(el.scene({ mark: 'note/body', index: 0 })[0].box.x).toBeCloseTo(30, 6);
        expect(el.getData().steps[0].label).toBe('One');
    });

    it('counts reported rows, leaving context rows out', async () => {
        const el = mount({
            width: 300, height: 200,
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 9 }],
            context: (d) => d.x === 1,
            marks: [plot.point({ id: 'dot', channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'y' }) } } })],
        });
        await tick();
        const views = el.scene({ mark: 'dot' });
        expect(views.map((v) => v.index)).toEqual([null, 0, 1]);
        expect(el.scene({ mark: 'dot', index: 0 })[0].datum).toEqual({ x: 5, y: 5 });
    });

    it('reports selection', async () => {
        const el = mount(flowSpec());
        await tick();
        el.select(1);
        await tick();
        expect(el.scene({ mark: 'note/body' }).map((v) => v.selected)).toEqual([false, true]);
    });
});

describe('chart.hit()', () => {
    it('finds the piece at a point, and nothing over empty space', async () => {
        const el = mount(flowSpec());
        await tick();
        expect(el.hit({ x: 80, y: 60 })).toMatchObject({ table: 'steps', index: 0 });
        expect(el.hit({ x: 380, y: 20 })).toBeNull();
    });

    it('reaches the nearest piece within `reach`', async () => {
        const el = mount(flowSpec());
        await tick();
        // 10px left of the first sticker's left edge (x = 30).
        expect(el.hit({ x: 20, y: 60 })).toBeNull();
        expect(el.hit({ x: 20, y: 60 }, { reach: 12 })).toMatchObject({ mark: 'note/body', index: 0 });
        expect(el.hit({ x: 20, y: 60 }, { reach: 5 })).toBeNull();
    });

    it('skips a hidden port', async () => {
        const el = mount(flowSpec());
        await tick();
        // The right port of row 0 sits at (130, 60), on the box's edge.
        const v = el.hit({ x: 132, y: 60 });
        expect(v && v.channel).not.toBe('port');
    });
});

describe('chart.scale()', () => {
    it('encodes and inverts through the mark\'s channel', async () => {
        const el = mount(flowSpec());
        await tick();
        const x = el.scale('x', { mark: 'note' });
        expect(x).toMatchObject({ channel: 'x', field: 'x', table: 'steps', kind: 'continuous', invertible: true });
        expect(x.encode(50)).toBeCloseTo(200, 6);
        expect(x.invert(200)).toBeCloseTo(50, 6);
        const w = el.scale('width', { mark: 'note' });
        expect(w.field).toBe('w');
        expect(w.invert(130)).toBeCloseTo(130, 6);
    });

    it('lists a discrete channel\'s values and what they map onto', async () => {
        const el = mount(flowSpec());
        await tick();
        const fill = el.scale('fill', { mark: 'note' });
        expect(fill.domain).toEqual(['a', 'b', 'c']);
        expect(fill.invert).toBeNull();
        expect(typeof fill.encode('b')).toBe('string');
    });

    it('is null for a channel no mark binds', async () => {
        const el = mount(flowSpec());
        await tick();
        expect(el.scale('angle', { mark: 'note' })).toBeNull();
        expect(el.scale('x', { mark: 'nope' })).toBeNull();
    });
});

describe('chart.edits()', () => {
    it('lists declared edits with their names, marks and tables', async () => {
        const el = mount(flowSpec());
        await tick();
        const byName = Object.fromEntries(el.edits().map((e) => [e.name, e]));
        expect(byName.link).toMatchObject({ type: 'network.connect', mark: 'note/body/ports', table: 'steps', cardinality: 'append' });
        expect(byName.rewire).toMatchObject({ type: 'network.rewire', mark: 'flow', table: 'flows' });
        expect(byName.drag).toMatchObject({ type: 'move', channels: ['x', 'y'], fields: ['x', 'y'] });
        expect(byName.unlink).toMatchObject({ type: 'remove', gesture: 'commit', cardinality: 'delete' });
    });

    it('narrows to a mark and a handle', async () => {
        const el = mount(flowSpec());
        await tick();
        expect(el.edits({ mark: 'flow' }).map((e) => e.name).sort()).toEqual(['rewire', 'unlink']);
        // The link's line takes `unlink`; only its end handles take `rewire`.
        expect(el.edits({ mark: 'flow', index: 0, channel: 'target' }).map((e) => e.name)).toContain('rewire');
        expect(el.edits({ mark: 'note', index: 0, channel: 'port', side: 'right' }).map((e) => e.name)).toEqual(['link']);
    });

    it('says whether an edit can run now', async () => {
        const el = mount(flowSpec());
        await tick();
        const del = () => el.edits({ mark: 'note/body' }).find((e) => e.name === 'delete');
        expect(del().available).toBe(false);
        el.setStage(1);
        expect(del().available).toBe(true);
    });
});

describe('pixel spaces', () => {
    it('metrics() reports the size and margins', async () => {
        const el = mount({ ...flowSpec(), margins: { top: 10, right: 20, bottom: 30, left: 40 } });
        await tick();
        expect(el.metrics()).toMatchObject({
            width: 400, height: 300, innerWidth: 340, innerHeight: 260,
            margins: { top: 10, right: 20, bottom: 30, left: 40 }, scale: 1,
        });
    });

    it('toInner() and toClient() undo each other, through the margins and a CSS stretch', async () => {
        const el = mount({ ...flowSpec(), margins: { top: 10, right: 20, bottom: 30, left: 40 } });
        await tick();
        // The drawing sits at (100, 50) on the page, drawn at twice its size.
        const svg = el.dom().querySelector('svg');
        svg.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50 });
        expect(el.metrics().scale).toBe(2);
        expect(el.toInner({ x: 100, y: 50 })).toEqual({ x: -40, y: -10 });
        expect(el.toInner({ x: 380, y: 170 })).toEqual({ x: 100, y: 50 });
        expect(el.toClient({ x: 100, y: 50 })).toEqual({ x: 380, y: 170 });
    });
});

describe('chart events and theme', () => {
    it('fires `render` after each frame', async () => {
        const el = mount(flowSpec());
        let n = 0;
        const off = el.on('render', () => { n++; });
        await tick();
        expect(n).toBe(1);
        el.control('drag', 0).set({ x: 40, y: 40 });
        expect(n).toBeGreaterThan(1);
        const before = n;
        off();
        el.select(0);
        await tick();
        expect(n).toBe(before);
    });

    it('lets a `render` listener read the frame just drawn', async () => {
        const el = mount(flowSpec());
        await tick();
        let x = null;
        el.on('render', () => { x = el.scene({ mark: 'note/body', index: 0 })[0].center.x; });
        el.control('drag', 0).set({ x: 50, y: 50 });
        expect(x).toBeCloseTo(200, 4);
    });

    it('fires `destroy` once, and no `render` after it', async () => {
        const el = mount(flowSpec());
        await tick();
        let destroyed = 0, renders = 0;
        el.on('destroy', () => { destroyed++; });
        el.on('render', () => { renders++; });
        el.destroy();
        expect(destroyed).toBe(1);
        expect(renders).toBe(0);
    });

    it('exposes the resolved theme as a copy', async () => {
        const el = mount({ ...flowSpec(), theme: { accent: '#123456' } });
        expect(el.theme.accent).toBe('#123456');
        el.theme.accent = 'red';
        expect(el.theme).toBe(el.theme);
    });
});
