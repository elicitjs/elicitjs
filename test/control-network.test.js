// @vitest-environment jsdom
// External control on a network: `control(name, { index, channel, side })` names
// one handle of a row (a port's side, a link's end), a stroke releases where its
// pointer last was, `cancel()` abandons it, and a control never asks `when`.
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

// Inner size 400 x 300, so a node's pixel is (x * 4, 300 - y * 3).
const px = (row) => ({ x: row.x * 4, y: 300 - row.y * 3 });
const steps = [
    { id: 's1', label: 'One', kind: 'a', x: 20, y: 80 },
    { id: 's2', label: 'Two', kind: 'a', x: 75, y: 60 },
    { id: 's3', label: 'Three', kind: 'b', x: 30, y: 20 },
];

const flowSpec = (stickerEdits = [], extra = {}) => ({
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
                    x: { type: 'quantitative', domain: [0, 100] },
                    y: { type: 'quantitative', domain: [0, 100] },
                },
            },
            flows: {
                role: 'links',
                directed: true,
                fields: {
                    source: { type: 'ref' },
                    target: { type: 'ref' },
                    fromSide: { type: 'categorical', domain: ['top', 'right', 'bottom', 'left'] },
                    toSide: { type: 'categorical', domain: ['top', 'right', 'bottom', 'left'] },
                },
            },
        },
    },
    data: { steps, flows: [{ source: 's1', target: 's2', fromSide: 'right', toSide: 'left' }] },
    marks: [
        plot.link({
            channels: { sourceSide: { field: 'fromSide' }, targetSide: { field: 'toSide' } },
            edits: [edit.network.rewire({ name: 'rewire' }), edit.remove({ name: 'unlink', gesture: 'commit' })],
        }),
        plot.sticker({
            edits: stickerEdits,
            channels: {
                x: { field: 'x' },
                y: { field: 'y' },
                text: { field: 'label' },
                ports: { value: true, edit: edit.network.connect({ name: 'link', ...extra }) },
            },
        }),
    ],
});

describe('control() on a network', () => {
    it('starts a connect from the port side it names and lands where the stroke ends', async () => {
        const el = mount(flowSpec());
        await tick();
        const c = el.control('link', { index: 0, channel: 'port', side: 'bottom' });
        c.begin();
        c.emit({ type: 'drag', ...px(steps[2]) });
        c.end();
        const flows = el.getData().flows;
        expect(flows).toHaveLength(2);
        expect(flows[1]).toMatchObject({ source: 's1', target: 's3', fromSide: 'bottom' });
        expect(el.undo()).toBe(true);
        expect(el.getData().flows).toHaveLength(1);
    });

    it('re-points the link end it names', async () => {
        const el = mount(flowSpec());
        await tick();
        const c = el.control('rewire', { index: 0, channel: 'target' });
        c.begin();
        c.emit({ type: 'drag', ...px(steps[2]) });
        c.end();
        expect(el.getData().flows).toEqual([expect.objectContaining({ source: 's1', target: 's3' })]);
    });

    it('cancel() abandons a stroke: nothing is written and nothing can be undone', async () => {
        const el = mount(flowSpec());
        await tick();
        const c = el.control('rewire', { index: 0, channel: 'target' });
        c.begin();
        c.emit({ type: 'drag', x: 390, y: 290 });
        c.cancel();
        expect(el.getData().flows).toHaveLength(1);
        expect(el.canUndo()).toBe(false);
        // The stroke is closed, so a later end() does nothing.
        c.end();
        expect(el.getData().flows).toHaveLength(1);
    });

    it('does not ask the edit\'s `when`', async () => {
        const el = mount(flowSpec([], { when: edit.when.shift }));
        await tick();
        const c = el.control('link', { index: 0, channel: 'port', side: 'bottom' });
        c.begin();
        c.emit({ type: 'drag', ...px(steps[2]) });
        c.end();
        expect(el.getData().flows).toHaveLength(2);
    });

    it('fires a commit-gesture remove that no pointer gesture reaches', async () => {
        const el = mount(flowSpec());
        await tick();
        el.control('unlink', 0).fire();
        expect(el.getData().flows).toHaveLength(0);
    });
});

describe('network.reverse', () => {
    it('swaps the ends and keeps each node at its own port', async () => {
        const spec = flowSpec();
        spec.marks[0] = plot.link({
            channels: { sourceSide: { field: 'fromSide' }, targetSide: { field: 'toSide' } },
            edits: [edit.network.reverse({ name: 'reverse', gesture: 'commit' })],
        });
        const el = mount(spec);
        await tick();
        // s1 leaves by its right side, s2 is met on its left.
        el.control('reverse', 0).fire();
        expect(el.getData().flows[0]).toEqual({ source: 's2', target: 's1', fromSide: 'left', toSide: 'right' });
        el.control('reverse', 0).fire();
        expect(el.getData().flows[0]).toEqual({ source: 's1', target: 's2', fromSide: 'right', toSide: 'left' });
    });
});

describe('a named plane edit', () => {
    it('fires alone among several creates, at the point given', async () => {
        const el = mount(flowSpec([
            edit.create({ name: 'addA', gesture: 'commit', defaults: { label: 'A', kind: 'a' } }),
            edit.create({ name: 'addB', gesture: 'commit', defaults: { label: 'B', kind: 'b' } }),
        ]));
        await tick();
        el.control('addB').emit({ type: 'commit', x: 200, y: 150 });
        const rows = el.getData().steps;
        expect(rows).toHaveLength(4);
        expect(rows[3]).toMatchObject({ label: 'B', kind: 'b' });
        expect(rows[3].x).toBeCloseTo(50, 6);
        expect(rows[3].y).toBeCloseTo(50, 6);
    });

    it('is not fired by a click on the chart', async () => {
        const el = mount(flowSpec([edit.create({ name: 'add', gesture: 'commit', defaults: { label: 'A' } })]));
        await tick();
        el.emit({ type: 'click', x: 200, y: 150 });
        expect(el.getData().steps).toHaveLength(3);
    });
});

describe('the inline editor\'s commit', () => {
    it('writes the typed text and leaves a set() on another channel alone', async () => {
        const spec = flowSpec([edit.editText(), edit.remove({ name: 'del', gesture: 'commit' })]);
        spec.marks[1] = plot.sticker({
            edits: [edit.editText(), edit.remove({ name: 'del', gesture: 'commit' })],
            channels: {
                x: { field: 'x' }, y: { field: 'y' }, text: { field: 'label' },
                fill: { field: 'kind', edit: edit.set({ name: 'kind' }) },
            },
        });
        const el = mount(spec);
        await tick();
        // What the renderer's editor reports: a commit on the node, no edit named.
        const body = el.dom().querySelector('.mark').__data__;
        el.emit({ type: 'commit', node: { featureId: body.featureId, index: 0 }, value: 'typed' });
        const rows = el.getData().steps;
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({ label: 'typed', kind: 'a' });
        // The set() still answers its own control.
        el.control('kind', 0).set('c');
        expect(el.getData().steps[0].kind).toBe('c');
    });
});
