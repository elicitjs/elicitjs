// Shared by the ui tests: a sticker flowchart whose every action has a named edit.
import { plot, edit } from '../src/index.js';

// Inner size 400 x 300 (no margins): a node's pixel is (x * 4, 300 - y * 3).
export const px = (row) => ({ x: row.x * 4, y: 300 - row.y * 3 });

export const steps = () => [
    { id: 's1', label: 'One', kind: 'a', w: 100, x: 20, y: 80 },
    { id: 's2', label: 'Two', kind: 'b', w: 120, x: 75, y: 60 },
    { id: 's3', label: 'Three', kind: 'b', w: 100, x: 30, y: 20 },
];

/**
 * @param {{ named?: boolean, fillEdit?: any, extra?: object, links?: any[] }} [o]
 */
export function flowSpec(o = {}) {
    const { named = true, fillEdit, extra = {}, links } = o;
    const n = (name) => (named ? { name } : {});
    return {
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
        data: { steps: steps(), flows: links || [{ source: 's1', target: 's2', fromSide: 'right', toSide: 'left' }] },
        marks: [
            plot.link({
                id: 'flow',
                channels: { sourceSide: { field: 'fromSide' }, targetSide: { field: 'toSide' } },
                edits: [
                    edit.network.rewire(n('rewire')),
                    edit.network.reverse({ ...n('reverse'), gesture: 'commit' }),
                    edit.remove({ ...n('unlink'), gesture: 'commit' }),
                ],
            }),
            plot.sticker({
                id: 'note',
                edits: [
                    edit.create({ ...n('add'), gesture: 'commit', defaults: { label: 'New' } }),
                    edit.remove({ ...n('delete'), gesture: 'commit' }),
                ],
                channels: {
                    x: { field: 'x', edit: edit.move({ ...n('drag'), channels: ['x', 'y'], mode: 'relative' }) },
                    y: { field: 'y' },
                    text: { field: 'label' },
                    fill: fillEdit ? { field: 'kind', edit: fillEdit } : { field: 'kind' },
                    width: { field: 'w', scale: { range: [60, 200] } },
                    ports: { value: true, edit: edit.network.connect(n('link')) },
                },
            }),
        ],
        ...extra,
    };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
// Long enough for a frame-throttled pointer move to be delivered.
export const frame = () => new Promise((r) => setTimeout(r, 40));

// Longer than the moment a group of icons outlives the pointer leaving its target.
export const linger = () => new Promise((r) => setTimeout(r, 420));

/** Dispatch a pointer-ish event at a point in the chart's inner pixels. */
export function fire(el, type, at = {}, init = {}) {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at.x || 0, clientY: at.y || 0, ...init });
    el.dispatchEvent(e);
    return e;
}

export function captureWarnings(setWarnings, fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; }
    return seen;
}
