// @vitest-environment jsdom
// The `hierarchy` structure: nodes, a nesting table (one row = "child is inside
// parent") and an optional links table. Tree-ness is the schema's statement, so the
// engine holds it for seeds, for setData and for every edit that writes nesting.
import { describe, it, expect } from 'vitest';
import { normalizeSchema } from '../src/core/schema.js';
import { nestingOf, treeOf, treeProblems, enforceTree } from '../src/core/hierarchy.js';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

setWarnings(false);

const schema = (extra = {}) => ({
    structure: 'hierarchy',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            x: { type: 'quantitative', domain: [0, 100] },
            y: { type: 'quantitative', domain: [0, 100] },
        },
        nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
        ...extra,
    },
});
const nodes = (...ids) => ids.map((id, i) => ({ id, x: 10 + i * 10, y: 50 }));
const nest = (child, parent) => ({ child, parent });

describe('hierarchy schema', () => {
    it('needs nodes and nesting; links is optional', () => {
        const spec = normalizeSchema(schema());
        expect(spec.structure).toBe('hierarchy');
        expect(spec.primary).toBe('nodes');
        expect(spec.byRole.links).toBeUndefined();
        expect(nestingOf(spec)).toEqual({ table: 'nesting', child: 'child', parent: 'parent', nodes: 'nodes', key: 'id' });

        const linked = normalizeSchema(schema({ links: { source: { type: 'ref' }, target: { type: 'ref' } } }));
        expect(linked.byRole.links).toBe('links');

        expect(() => normalizeSchema({ structure: 'hierarchy', tables: { nodes: {} } })).toThrow(/nesting/);
    });

    it('resolves the tables by role, whatever they are named', () => {
        const spec = normalizeSchema({
            structure: 'hierarchy',
            tables: {
                things: { role: 'nodes', fields: { name: { type: 'categorical', key: true } } },
                inside: { role: 'nesting', fields: { item: { type: 'ref' }, box: { type: 'ref' } } },
            },
        });
        expect(nestingOf(spec)).toEqual({ table: 'inside', child: 'item', parent: 'box', nodes: 'things', key: 'name' });
    });

    it('a network still requires its links table', () => {
        expect(() => normalizeSchema({ structure: 'network', tables: { nodes: {} } })).toThrow(/links/);
    });
});

describe('treeOf', () => {
    const spec = normalizeSchema(schema());
    const tables = {
        nodes: nodes('a', 'b', 'c', 'd', 'e'),
        nesting: [nest('b', 'a'), nest('c', 'a'), nest('d', 'c')],
    };
    const tree = treeOf(spec, tables);

    it('answers parent, children, depth, ancestors and descendants by node index', () => {
        expect(tree.parentOf(0)).toBe(null);
        expect(tree.parentOf(3)).toBe(2);
        expect(tree.childrenOf(0)).toEqual([1, 2]);
        expect(tree.hasChildren(4)).toBe(false);
        expect(tree.depthOf(3)).toBe(2);
        expect(tree.ancestorsOf(3)).toEqual([2, 0]);
        expect(tree.descendantsOf(0)).toEqual([1, 2, 3]);
    });

    it('lists children before their parent in bottomUp', () => {
        const at = (i) => tree.bottomUp.indexOf(i);
        expect(at(3)).toBeLessThan(at(2));
        expect(at(2)).toBeLessThan(at(0));
    });

    it('is cached per table identity', () => {
        expect(treeOf(spec, tables)).toBe(tree);
        expect(treeOf(spec, { ...tables, nesting: [...tables.nesting] })).not.toBe(tree);
    });

    it('is flat for a structure with no nesting', () => {
        const net = normalizeSchema({ structure: 'network', tables: { nodes: { id: { type: 'categorical', key: true } }, links: { s: { type: 'ref' }, t: { type: 'ref' } } } });
        expect(treeOf(net, { nodes: nodes('a'), links: [] }).hasChildren(0)).toBe(false);
    });
});

describe('tree rules', () => {
    const spec = normalizeSchema(schema());

    it('reports a second parent, a self-nest and a cycle, keeping the earlier row', () => {
        const tables = {
            nodes: nodes('a', 'b', 'c'),
            nesting: [nest('b', 'a'), nest('b', 'c'), nest('c', 'c'), nest('c', 'b'), nest('a', 'c')],
        };
        expect(treeProblems(spec, tables).map((p) => [p.kind, p.row])).toEqual([
            ['second-parent', 1], ['self', 2], ['cycle', 4],
        ]);
        const dropped = enforceTree(spec, tables);
        expect(dropped).toHaveLength(3);
        expect(tables.nesting).toEqual([nest('b', 'a'), nest('c', 'b')]);
        expect(treeProblems(spec, tables)).toEqual([]);
    });

    it('treeOf draws the same tree enforceTree keeps', () => {
        const tables = { nodes: nodes('a', 'b', 'c'), nesting: [nest('b', 'a'), nest('a', 'b'), nest('c', 'b'), nest('c', 'a')] };
        const tree = treeOf(spec, tables);
        expect(tree.parentOf(0)).toBe(null);
        expect(tree.parentOf(1)).toBe(0);
        expect(tree.parentOf(2)).toBe(1);
    });
});

describe('the engine holds the tree', () => {
    const chart = (data, marks) => {
        const el = Elicit({ width: 300, height: 200, schema: schema(), data, marks: marks || [plot.point({ x: { field: 'x' }, y: { field: 'y' } })] });
        document.body.appendChild(el);
        return el;
    };

    it('drops seeded rows that break it and reports all three tables', () => {
        const el = chart({ nodes: nodes('a', 'b'), nesting: [nest('b', 'a'), nest('a', 'b')] });
        expect(el.getData()).toEqual({ nodes: nodes('a', 'b'), nesting: [nest('b', 'a')] });
    });

    it('setData repairs a dangling membership and a cycle', () => {
        const el = chart({ nodes: nodes('a', 'b'), nesting: [] });
        el.setData({ nodes: nodes('a', 'b', 'c'), nesting: [nest('b', 'a'), nest('c', 'zzz'), nest('a', 'b')] });
        expect(el.getData().nesting).toEqual([nest('b', 'a')]);
    });

    it('deleting a container releases its children', () => {
        const el = chart(
            { nodes: nodes('a', 'b', 'c'), nesting: [nest('b', 'a'), nest('c', 'b')] },
            [plot.point({ id: 'pts', x: { field: 'x' }, y: { field: 'y' }, edits: [edit.remove()] })]
        );
        el.emit({ type: 'click', node: { index: 0, featureId: 'pts' }, x: 0, y: 0 });
        const out = el.getData();
        expect(out.nodes.map((d) => d.id)).toEqual(['b', 'c']);
        expect(out.nesting).toEqual([nest('c', 'b')]);
    });
});

// ── Geometry: fitted containers, carried subtrees, the size lock ──────────────
const boxSchema = {
    structure: 'hierarchy',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            x: { type: 'quantitative', domain: [0, 400] },
            y: { type: 'quantitative', domain: [0, 300] },
            w: { type: 'quantitative', domain: [0, 400] },
            h: { type: 'quantitative', domain: [0, 300] },
        },
        nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
    },
};
const box = (id, x, y, w = 40, h = 20) => ({ id, x, y, w, h });
const boxes = (edits = []) => plot.rect({
    id: 'boxes',
    channels: {
        x: { field: 'x' }, y: { field: 'y' },
        width: { field: 'w', scale: null, fit: true },
        height: { field: 'h', scale: null, fit: true },
        contains: { value: true, padding: 10 },
    },
    edits,
});
const boxChart = (data, edits) => {
    const el = Elicit({
        width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
        schema: boxSchema, data, marks: [boxes(edits)],
    });
    document.body.appendChild(el);
    return el;
};
const byId = (el) => Object.fromEntries(el.getData().nodes.map((d) => [d.id, d]));

describe('a fitted container', () => {
    const seed = () => ({
        nodes: [box('g', 0, 0, 5, 5), box('a', 100, 100), box('b', 200, 140)],
        nesting: [nest('a', 'g'), nest('b', 'g')],
    });

    it('takes the union of its children plus padding, written to its columns', () => {
        const g = byId(boxChart(seed())).g;
        // children span x 80..220, y(px) of 100 and 140 with h 20 -> 40px tall union + 20
        expect(g.w).toBeCloseTo(140 + 20, 5);
        expect(g.h).toBeCloseTo(60 + 20, 5);
        expect(g.x).toBeCloseTo(150, 5);
        expect(g.y).toBeCloseTo(120, 5);
    });

    it('leaves a leaf and an unnested chart alone', () => {
        const el = boxChart({ nodes: [box('a', 100, 100)], nesting: [] });
        expect(el.getData().nodes).toEqual([box('a', 100, 100)]);
    });

    it('fits bottom-up through two levels', () => {
        const el = boxChart({
            nodes: [box('top', 0, 0), box('mid', 0, 0), box('leaf', 100, 100)],
            nesting: [nest('mid', 'top'), nest('leaf', 'mid')],
        });
        const d = byId(el);
        expect(d.mid.w).toBeCloseTo(60, 5);
        expect(d.top.w).toBeCloseTo(80, 5);
        expect(d.top.x).toBeCloseTo(100, 5);
    });

    it('re-fits when setData re-parents, and places a child sent with no position', () => {
        const el = boxChart(seed());
        const data = el.getData();
        el.setData({
            nodes: [...data.nodes, { id: 'c', x: null, y: null, w: 40, h: 20 }],
            nesting: [nest('a', 'g'), nest('c', 'g')],
        });
        const d = byId(el);
        expect(Number.isFinite(d.c.x) && Number.isFinite(d.c.y)).toBe(true);
        // The new child was put inside the group it joined...
        expect(Math.abs(d.c.x - data.nodes[0].x)).toBeLessThan(data.nodes[0].w / 2);
        // ...and b left it, so the group drew in.
        expect(d.g.w).toBeLessThan(data.nodes[0].w);
    });

    it('carries its contents when it is moved', () => {
        const el = boxChart(seed(), [edit.move({ channels: ['x', 'y'] })]);
        const before = byId(el);
        el.emit({ type: 'drag', node: { index: 0, featureId: 'boxes' }, x: before.g.x + 30, y: 200 });
        const after = byId(el);
        expect(after.a.x - before.a.x).toBeCloseTo(30, 5);
        expect(after.b.x - before.b.x).toBeCloseTo(30, 5);
        expect(after.g.x - before.g.x).toBeCloseTo(30, 5);
        expect(after.g.w).toBeCloseTo(before.g.w, 5);
        expect(after.a.y - before.a.y).toBeCloseTo(after.b.y - before.b.y, 5);
    });

    it('follows a child that moves', () => {
        const el = boxChart(seed(), [edit.move({ channels: ['x', 'y'] })]);
        const before = byId(el);
        el.emit({ type: 'drag', node: { index: 2, featureId: 'boxes' }, x: 300, y: 300 - before.b.y });
        const after = byId(el);
        expect(after.b.x).toBeCloseTo(300, 5);
        expect(after.g.w).toBeGreaterThan(before.g.w);
    });
});

describe('the size lock', () => {
    const seed = () => ({
        nodes: [box('g', 0, 0, 5, 5), box('a', 100, 100), box('b', 200, 140)],
        nesting: [nest('a', 'g'), nest('b', 'g')],
    });
    const grow = edit.custom((ctx) => ({ ...ctx.datum, w: 300 }), { name: 'grow', gesture: 'click', channels: ['width'] });

    it('refuses a size edit on a row that holds others, and allows it on a leaf', () => {
        const el = boxChart(seed(), [grow]);
        const before = byId(el);
        el.emit({ type: 'click', node: { index: 0, featureId: 'boxes' }, x: 0, y: 0 });
        expect(byId(el).g.w).toBeCloseTo(before.g.w, 5);
        el.emit({ type: 'click', node: { index: 1, featureId: 'boxes' }, x: 0, y: 0 });
        expect(byId(el).a.w).toBe(300);
    });
});

describe('paint order', () => {
    it('draws a container beneath its contents even when its row comes later', async () => {
        const el = boxChart({
            nodes: [box('a', 100, 100), box('g', 0, 0), box('b', 200, 140)],
            nesting: [nest('a', 'g'), nest('b', 'g')],
        });
        await new Promise((r) => setTimeout(r, 0));
        const widths = [...el.querySelectorAll('rect')].map((r) => +r.getAttribute('width'));
        const container = widths.findIndex((w) => w > 100);
        const firstChild = widths.indexOf(40);
        expect(container).toBeGreaterThanOrEqual(0);
        expect(container).toBeLessThan(firstChild);
    });
});

describe('nested and linked', () => {
    it('draws links between nodes of a hierarchy, docked to a fitted container', async () => {
        const warnings = [];
        const original = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        setWarnings(true);
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: {
                structure: 'hierarchy',
                tables: { ...boxSchema.tables, links: { source: { type: 'ref' }, target: { type: 'ref' } } },
            },
            data: {
                nodes: [box('g', 0, 0), box('a', 100, 100), box('b', 300, 250)],
                nesting: [nest('a', 'g')],
                links: [{ source: 'a', target: 'b' }, { source: 'g', target: 'b' }],
            },
            marks: [boxes(), plot.link({})],
        });
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 0));
        setWarnings(false);
        console.warn = original;
        expect(warnings.filter((w) => w.includes('[elicit]'))).toEqual([]);
        expect(el.getData().links).toHaveLength(2);
        expect(el.querySelectorAll('path, line, polyline').length).toBeGreaterThanOrEqual(2);
    });
});

// ── Drag and drop: edit.hierarchy.nest beside a relative move ────────────────
describe('edit.hierarchy.nest', () => {
    // pixel == data on x; y is flipped (domain 0..300 over 300px).
    const px = (d) => ({ x: d.x, y: 300 - d.y });
    const seed = () => ({
        nodes: [box('g', 0, 0), box('a', 100, 200), box('h', 0, 0), box('c', 300, 200), box('b', 200, 60)],
        nesting: [nest('a', 'g'), nest('c', 'h')],
    });
    const chart = () => boxChart(seed(), [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()]);
    // A point in a container's padding: inside it, and over none of its contents.
    const rim = (d) => ({ x: d.x - d.w / 2 + 4, y: 300 - d.y });
    const drag = (el, index, to, steps = 4) => {
        const from = px(el.getData().nodes[index]);
        const node = { index, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, ...from });
        for (let k = 1; k <= steps; k++) {
            el.emit({ type: 'drag', node, x: from.x + (to.x - from.x) * k / steps, y: from.y + (to.y - from.y) * k / steps });
        }
        el.emit({ type: 'dragend', node, ...to });
    };

    it('drops a node into the container under the pointer, which grows to hold it', () => {
        const el = chart();
        const before = byId(el);
        drag(el, 4, rim(before.g));
        expect(el.getData().nesting).toContainEqual(nest('b', 'g'));
        expect(byId(el).g.w).toBeGreaterThan(before.g.w);
        expect(el.getData().nesting).toHaveLength(3);
    });

    it('takes a node out when it is released over no container', () => {
        const el = chart();
        drag(el, 1, { x: 200, y: 20 });
        expect(el.getData().nesting).toEqual([nest('c', 'h')]);
    });

    it('moves a node between containers and leaves it exactly one parent', () => {
        const el = chart();
        drag(el, 1, rim(byId(el).h));
        const rows = el.getData().nesting.filter((r) => r.child === 'a');
        expect(rows).toEqual([nest('a', 'h')]);
        const d = byId(el);
        // h now spans both of its children.
        expect(d.h.w).toBeGreaterThan(60);
    });

    it('never nests a container inside its own contents', () => {
        const el = chart();
        const before = el.getData().nesting;
        // g is dragged; the pointer ends over a, which g carries along with it.
        drag(el, 0, { x: 150, y: 150 });
        expect(el.getData().nesting).toEqual(before);
    });

    it('holds the old container still while its child is in flight, then lets it go', () => {
        const el = boxChart(
            { nodes: [box('g', 0, 0), box('a', 100, 200), box('a2', 160, 200)], nesting: [nest('a', 'g'), nest('a2', 'g')] },
            [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()]
        );
        const before = byId(el);
        const node = { index: 1, featureId: 'boxes' };
        const from = px(before.a);
        el.emit({ type: 'dragstart', node, ...from });
        el.emit({ type: 'drag', node, x: from.x - 60, y: from.y });
        const mid = byId(el);
        expect(mid.a.x).toBeCloseTo(before.a.x - 60, 5);
        expect(mid.g.w).toBeCloseTo(before.g.w, 5);
        expect(mid.g.x).toBeCloseTo(before.g.x, 5);
        el.emit({ type: 'dragend', node, x: from.x - 60, y: from.y });
        const after = byId(el);
        expect(el.getData().nesting).toEqual([nest('a2', 'g')]);
        expect(after.g.w).toBeLessThan(before.g.w);
    });

    it('re-fits on release even when the node stays in its container', () => {
        const el = boxChart(
            { nodes: [box('g', 0, 0), box('a', 100, 200), box('a2', 160, 200)], nesting: [nest('a', 'g'), nest('a2', 'g')] },
            [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()]
        );
        const before = byId(el);
        const node = { index: 1, featureId: 'boxes' };
        const from = px(before.a);
        el.emit({ type: 'dragstart', node, ...from });
        el.emit({ type: 'drag', node, x: from.x + 10, y: from.y - 15 });
        el.emit({ type: 'dragend', node, x: from.x + 10, y: from.y - 15 });
        const after = byId(el);
        expect(el.getData().nesting).toHaveLength(2);
        expect(after.g.h).toBeGreaterThan(before.g.h);
    });

    it('is one undo entry for the whole drag', () => {
        const el = chart();
        const before = el.getData();
        drag(el, 4, rim(byId(el).g));
        expect(el.getData()).not.toEqual(before);
        el.undo();
        expect(el.getData()).toEqual(before);
    });

    it('only offers rows the `contains` channel allows', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: boxSchema,
            data: { nodes: [box('note', 100, 200), box('group', 300, 200), box('b', 200, 60)], nesting: [] },
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null, fit: true }, height: { field: 'h', scale: null, fit: true },
                    contains: { fn: (d) => d.id === 'group' },
                },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el);
        drag(el, 2, px(el.getData().nodes[0]));
        expect(el.getData().nesting).toEqual([]);
        drag(el, 2, px(el.getData().nodes[1]));
        expect(el.getData().nesting).toEqual([nest('b', 'group')]);
    });
});

describe('drop feedback', () => {
    it('lights the container a release would land in and ghosts it at its new size', async () => {
        const el = boxChart(
            { nodes: [box('g', 0, 0), box('a', 100, 200), box('b', 200, 60)], nesting: [nest('a', 'g')] },
            [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()]
        );
        await new Promise((r) => setTimeout(r, 0));
        const count = () => el.querySelectorAll('rect').length;
        const atRest = count();
        const g = byId(el).g;
        const node = { index: 2, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, x: 200, y: 240 });
        el.emit({ type: 'drag', node, x: g.x - g.w / 2 + 4, y: 300 - g.y });
        // A ghost of the grown container and a `target` outline on the committed one.
        expect(count()).toBeGreaterThanOrEqual(atRest + 2);
        el.emit({ type: 'drag', node, x: 380, y: 280 });
        expect(count()).toBeLessThan(atRest + 2);
        el.emit({ type: 'dragend', node, x: 380, y: 280 });
        expect(el.getData().nesting).toEqual([nest('a', 'g')]);
    });
});

describe('a nesting table declared like any other table', () => {
    it('takes any name through `role`, carries its own columns, and is written by nest', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: {
                structure: 'hierarchy',
                tables: {
                    cards: {
                        role: 'nodes',
                        fields: {
                            name: { type: 'categorical', key: true },
                            x: boxSchema.tables.nodes.x, y: boxSchema.tables.nodes.y,
                            w: boxSchema.tables.nodes.w, h: boxSchema.tables.nodes.h,
                        },
                    },
                    memberships: {
                        role: 'nesting',
                        fields: {
                            item: { type: 'ref' },
                            box: { type: 'ref' },
                            sure: { type: 'quantitative', domain: [0, 1], default: 0.5 },
                        },
                    },
                },
            },
            data: {
                cards: [{ name: 'g', x: 100, y: 150, w: 120, h: 80 }, { name: 'a', x: 300, y: 150, w: 40, h: 20 }, { name: 'b', x: 300, y: 50, w: 40, h: 20 }],
                memberships: [],
            },
            marks: [plot.rect({
                id: 'b',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null, fit: true }, height: { field: 'h', scale: null, fit: true },
                    contains: { value: true },
                },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el);
        const drop = (index, from, to) => {
            const node = { index, featureId: 'b' };
            el.emit({ type: 'dragstart', node, ...from });
            el.emit({ type: 'drag', node, ...to });
            el.emit({ type: 'dragend', node, ...to });
        };
        drop(1, { x: 300, y: 150 }, { x: 50, y: 150 });
        // The schema default fills the column the gesture did not state.
        expect(el.getData().memberships).toEqual([{ item: 'a', box: 'g', sure: 0.5 }]);
        expect(el.getSchema().tables.memberships.role).toBe('nesting');
        expect(Object.keys(el.getData())).toEqual(['cards', 'memberships']);
    });
});
