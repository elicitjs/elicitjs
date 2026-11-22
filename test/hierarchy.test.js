// @vitest-environment jsdom
// The `hierarchy` structure: nodes, a nesting table (one row = "child is inside
// parent") and an optional links table. Tree-ness is the schema's statement, so the
// engine holds it for seeds, for setData and for every edit that writes nesting.
import { describe, it, expect, vi } from 'vitest';
import { normalizeSchema } from '../src/core/schema.js';
import { nestingOf, treeOf, treeProblems, enforceTree } from '../src/core/hierarchy.js';
import { Elicit, plot, edit, layout, setWarnings } from '../src/index.js';

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
        document.body.appendChild(el.dom());
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
// Every chart here sets `motion: false`: the tests read the drawing right after an event.
// Eased drawing is covered in motion.test.js.
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
        width: { field: 'w', scale: null },
        height: { field: 'h', scale: null },
    },
    contains: { padding: 10, fit: true },
    edits,
});
const boxChart = (data, edits) => {
    const el = Elicit({
        width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
        schema: boxSchema, data, marks: [boxes(edits)],
    });
    document.body.appendChild(el.dom());
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
        const widths = [...el.dom().querySelectorAll('rect')].map((r) => +r.getAttribute('width'));
        const container = widths.findIndex((w) => w > 100);
        const firstChild = widths.indexOf(40);
        expect(container).toBeGreaterThanOrEqual(0);
        expect(container).toBeLessThan(firstChild);
    });
});

describe('paint order of a node and its label', () => {
    it('paints each row whole, so a label never shows through the node above it', async () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: { ...boxSchema, tables: { ...boxSchema.tables, nodes: { ...boxSchema.tables.nodes, label: { type: 'categorical', open: true } } } },
            data: { nodes: [{ ...box('a', 100, 100), label: 'A' }, { ...box('b', 110, 105), label: 'B' }], nesting: [] },
            marks: [boxes(), plot.text({ channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 'label' } } })],
        });
        document.body.appendChild(el.dom());
        await new Promise((r) => setTimeout(r, 0));
        const drawn = [...el.dom().querySelectorAll('rect, text')]
            .filter((n) => n.tagName === 'text' || Math.round(+n.getAttribute('width')) === 40)
            .map((n) => (n.tagName === 'text' ? n.textContent : 'box'));
        expect(drawn).toEqual(['box', 'A', 'box', 'B']);
    });
});

describe('nested and linked', () => {
    it('draws links between nodes of a hierarchy, docked to a fitted container', async () => {
        const warnings = [];
        const original = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        setWarnings(true);
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
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
        document.body.appendChild(el.dom());
        await new Promise((r) => setTimeout(r, 0));
        setWarnings(false);
        console.warn = original;
        expect(warnings.filter((w) => w.includes('[elicit]'))).toEqual([]);
        expect(el.getData().links).toHaveLength(2);
        expect(el.dom().querySelectorAll('path, line, polyline').length).toBeGreaterThanOrEqual(2);
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

    it('holds the old container data still while its child is in flight, and draws where it will settle', () => {
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
        // but is drawn as the release will leave it: shrunk round what stays
        const widths = [...el.dom().querySelectorAll('rect')].map((r) => +r.getAttribute('width')).filter((w) => w < 400);
        const drawnWidth = Math.max(...widths);
        expect(drawnWidth).toBeLessThan(before.g.w - 1);
        el.emit({ type: 'dragend', node, x: from.x - 60, y: from.y });
        const after = byId(el);
        expect(el.getData().nesting).toEqual([nest('a2', 'g')]);
        expect(after.g.w).toBeLessThan(before.g.w);
        expect(drawnWidth).toBeCloseTo(after.g.w, 5);
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
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: boxSchema,
            data: { nodes: [box('note', 100, 200), box('group', 300, 200), box('b', 200, 60)], nesting: [] },
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                },
                contains: { where: (d) => d.id === 'group', fit: true },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el.dom());
        drag(el, 2, px(el.getData().nodes[0]));
        expect(el.getData().nesting).toEqual([]);
        drag(el, 2, px(el.getData().nodes[1]));
        expect(el.getData().nesting).toEqual([nest('b', 'group')]);
    });
});

describe('drop feedback', () => {
    it('lights the container a release would land in and draws it at its new size', async () => {
        const el = boxChart(
            { nodes: [box('g', 0, 0), box('a', 100, 200), box('b', 200, 60)], nesting: [nest('a', 'g')] },
            [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()]
        );
        await new Promise((r) => setTimeout(r, 0));
        const count = () => el.dom().querySelectorAll('rect').length;
        const widest = () => Math.max(...[...el.dom().querySelectorAll('rect:not([data-ghost])')].map((r) => +r.getAttribute('width') || 0).filter((w) => w < 400)); // not the plot's own rects
        const atRest = count();
        const g = byId(el).g;
        const node = { index: 2, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, x: 200, y: 240 });
        el.emit({ type: 'drag', node, x: g.x - g.w / 2 + 4, y: 300 - g.y });
        // The container itself is drawn at the size it would take, with a `target`
        // outline. No ghost copy.
        expect(el.dom().querySelectorAll('[data-ghost]').length).toBe(0);
        expect(count()).toBe(atRest + 1);
        expect(widest()).toBeGreaterThan(g.w + 1);
        expect(byId(el).g.w).toBe(g.w); // the data waits for the release
        el.emit({ type: 'drag', node, x: 380, y: 280 });
        expect(count()).toBe(atRest);
        expect(widest()).toBeCloseTo(g.w, 5);
        el.emit({ type: 'dragend', node, x: 380, y: 280 });
        expect(el.getData().nesting).toEqual([nest('a', 'g')]);
    });
});

describe('a nesting table declared like any other table', () => {
    it('takes any name through `role`, carries its own columns, and is written by nest', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
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
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                },
                contains: { fit: true },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el.dom());
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

// ── Padding and spacing ──────────────────────────────────────────────────────
describe('container padding', () => {
    const chart = (data, lay = []) => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: boxSchema, data,
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                },
            })],
            layout: lay,
        });
        document.body.appendChild(el.dom());
        return el;
    };

    it('takes a side each, so a fitted container leaves room for a title', () => {
        const el = chart(
            { nodes: [box('g', 0, 0), box('a', 100, 100)], nesting: [nest('a', 'g')] },
            [layout.contain({ padding: { top: 30, left: 4 }, fit: true })]
        );
        const g = byId(el).g;
        expect(g.w).toBeCloseTo(40 + 4 + 10, 5);   // right takes the default
        expect(g.h).toBeCloseTo(20 + 30 + 10, 5);
        expect(g.x).toBeCloseTo(100 + (10 - 4) / 2, 5);
        expect(g.y).toBeCloseTo(100 + (30 - 10) / 2, 5); // data y runs up: the extra room is above
    });

    it('keeps the contents of a fixed-size container inside its padding', () => {
        const el = chart(
            { nodes: [box('g', 200, 150, 200, 100), box('a', 105, 150), box('b', 200, 300)], nesting: [nest('a', 'g'), nest('b', 'g')] },
            [layout.contain({ padding: 12, fit: false })]
        );
        const d = byId(el);
        expect(d.g.w).toBe(200);
        expect(d.a.x).toBeCloseTo(100 + 12 + 20, 5);
        expect(d.b.y).toBeCloseTo(200 - 12 - 10, 5);
    });
});

describe('dodge', () => {
    const chart = (data, { edits = [], dodge = layout.dodge(), fit = true } = {}) => {
        const lay = [layout.contain({ where: (d) => d.id.startsWith('g'), fit })];
        if (dodge) lay.push(dodge);
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: boxSchema, data,
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                },
                edits,
            })],
            layout: lay,
        });
        document.body.appendChild(el.dom());
        return el;
    };
    const clear = (a, b, gap = 0) => Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + gap - 0.02
        || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + gap - 0.02;
    const allClear = (rows, gap) => rows.every((a, i) => rows.slice(i + 1).every((b) => clear(a, b, gap)));

    it('separates seeded siblings, inside a container and at the top level', () => {
        const el = chart({
            nodes: [box('g1', 0, 0), box('a', 100, 100), box('b', 110, 104), box('c', 105, 96), box('g2', 0, 0), box('d', 130, 100)],
            nesting: [nest('a', 'g1'), nest('b', 'g1'), nest('c', 'g1'), nest('d', 'g2')],
        });
        const d = byId(el);
        expect(allClear([d.a, d.b, d.c], 8)).toBe(true);
        expect(allClear([d.g1, d.g2], 8)).toBe(true);
        // settled: another render moves nothing
        const once = el.getData();
        el.setData(once);
        expect(el.getData()).toEqual(once);
    });

    it('is opt-in, and honours `gap` and a per-row `where` predicate', () => {
        const data = () => ({ nodes: [box('a', 100, 100), box('b', 110, 100), box('c', 104, 100)], nesting: [] });
        expect(chart(data(), { dodge: null }).getData().nodes).toEqual(data().nodes);
        const wide = byId(chart(data(), { dodge: layout.dodge({ gap: 30 }) }));
        expect(allClear([wide.a, wide.b, wide.c], 30)).toBe(true);
        const some = byId(chart(data(), { dodge: layout.dodge({ where: (d) => d.id !== 'c' }) }));
        expect(some.c.x).toBe(104);
        expect(clear(some.a, some.b, 8)).toBe(true);
    });

    it('waits for the release, then makes room around the node that was dropped', () => {
        const el = chart(
            { nodes: [box('a', 100, 100), box('b', 300, 100)], nesting: [] },
            { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()] }
        );
        const node = { index: 0, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, x: 100, y: 200 });
        el.emit({ type: 'drag', node, x: 290, y: 200 });
        expect(byId(el).b.x).toBe(300); // nothing scatters mid-drag
        el.emit({ type: 'dragend', node, x: 290, y: 200 });
        const d = byId(el);
        expect(d.a.x).toBeCloseTo(290, 5); // the dropped node stays where it was put
        expect(clear(d.a, d.b, 8)).toBe(true);
        el.undo();
        expect(byId(el).b.x).toBe(300);
        expect(byId(el).a.x).toBe(100);
    });

    it('pushes a neighbouring container away when one grows to take a drop', () => {
        const el = chart({
            nodes: [box('g1', 0, 0), box('a', 100, 150), box('g2', 0, 0), box('b', 170, 150), box('c', 100, 40)],
            nesting: [nest('a', 'g1'), nest('b', 'g2')],
        }, { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()] });
        const before = byId(el);
        const node = { index: 4, featureId: 'boxes' };
        // drop c in g1's right-hand padding, so g1 grows toward g2
        const to = { x: before.g1.x + before.g1.w / 2 - 3, y: 300 - before.g1.y };
        el.emit({ type: 'dragstart', node, x: 100, y: 260 });
        el.emit({ type: 'drag', node, ...to });
        el.emit({ type: 'dragend', node, ...to });
        const d = byId(el);
        expect(el.getData().nesting).toContainEqual(nest('c', 'g1'));
        expect(allClear([d.a, d.c], 8)).toBe(true);
        expect(allClear([d.g1, d.g2], 8)).toBe(true);
        // g2 gave way and took its contents along
        expect(d.b.x - d.g2.x).toBeCloseTo(before.b.x - before.g2.x, 5);
    });

    it('never moves a container aside for a child dragged out of it', () => {
        // b sits above a in g; a leaves over the top and ends just above what is left of g.
        const el = chart({
            nodes: [box('g', 0, 0), box('a', 200, 150), box('b', 200, 200)],
            nesting: [nest('a', 'g'), nest('b', 'g')],
        }, { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()] });
        const before = byId(el);
        const node = { index: 1, featureId: 'boxes' };
        const drawnYs = () => [...el.dom().querySelectorAll('rect')].filter((r) => +r.getAttribute('width') === 40).map((r) => +r.getAttribute('y'));
        el.emit({ type: 'dragstart', node, x: 200, y: 150 });
        el.emit({ type: 'drag', node, x: 200, y: 75 });
        expect(drawnYs().some((y) => Math.abs(y - (300 - before.b.y - 10)) < 0.01)).toBe(true); // b is drawn where it was
        el.emit({ type: 'dragend', node, x: 200, y: 75 });
        const d = byId(el);
        expect(el.getData().nesting).toEqual([nest('b', 'g')]);
        expect(d.b.x).toBe(before.b.x); // the container's contents did not move
        expect(d.b.y).toBe(before.b.y);
        expect(d.g.y).toBeCloseTo(before.b.y, 5);
        expect(d.a.y).toBeGreaterThan(225); // the dropped node gave way instead
        expect(clear(d.a, d.g, 8)).toBe(true);
    });

    it('slides a node dropped on a container\'s edge clear, and leaves the container', () => {
        const el = chart({
            nodes: [box('g', 0, 0), box('a', 200, 150), box('c', 60, 150)],
            nesting: [nest('a', 'g')],
        }, { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()] });
        const before = byId(el);
        const node = { index: 2, featureId: 'boxes' };
        // grabbed by its right end, so the pointer stays outside g while c overlaps it
        const to = { x: before.g.x - before.g.w / 2 - 2, y: 150 };
        el.emit({ type: 'dragstart', node, x: 60 + 18, y: 150 });
        el.emit({ type: 'drag', node, ...to });
        el.emit({ type: 'dragend', node, ...to });
        const d = byId(el);
        expect(el.getData().nesting).toEqual([nest('a', 'g')]);
        expect(d.g.x).toBe(before.g.x);
        expect(d.a.x).toBe(before.a.x);
        expect(clear(d.c, d.g, 8)).toBe(true);
    });

    it('leaves no overlap in a crowded fixed container, one card at a time', () => {
        // Five 96x26 cards in a 150x210 bucket: one column, with 12px to spare.
        const card = (id) => ({ id, x: 60, y: 20, w: 96, h: 26 });
        const el = chart({
            nodes: [{ id: 'g', x: 200, y: 150, w: 150, h: 210 }, ...['c1', 'c2', 'c3', 'c4', 'c5'].map(card)],
            nesting: [],
        }, { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()], fit: false });
        // Drops that left two cards overlapping when siblings were only pushed in pairs.
        const drops = [[240, 230], [215, 210], [240, 175], [212, 140], [230, 100]];
        drops.forEach(([x, y], k) => {
            const index = k + 1;
            const at = byId(el)[`c${index}`];
            const node = { index, featureId: 'boxes' };
            el.emit({ type: 'dragstart', node, x: at.x, y: 300 - at.y });
            el.emit({ type: 'drag', node, x, y });
            el.emit({ type: 'dragend', node, x, y });
        });
        const d = byId(el);
        expect(el.getData().nesting).toHaveLength(5);
        expect(allClear([d.c1, d.c2, d.c3, d.c4, d.c5], 8)).toBe(true);
        for (const c of [d.c1, d.c2, d.c3, d.c4, d.c5]) {
            expect(Math.abs(c.x - d.g.x) + c.w / 2).toBeLessThanOrEqual(d.g.w / 2 - 10 + 0.02);
            expect(Math.abs(c.y - d.g.y) + c.h / 2).toBeLessThanOrEqual(d.g.h / 2 - 10 + 0.02);
        }
    });

    it('shows siblings making room while a node moves inside its container', () => {
        const el = chart({
            nodes: [box('g', 200, 150, 200, 200), box('a', 150, 200, 60, 30), box('b', 250, 100, 60, 30)],
            nesting: [nest('a', 'g'), nest('b', 'g')],
        }, { edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()], fit: false });
        const drawnB = () => [...el.dom().querySelectorAll('rect')].map((r) => ({ x: +r.getAttribute('x') + 30, y: +r.getAttribute('y') + 15, w: +r.getAttribute('width') }))
            .filter((r) => r.w === 60)
            // a is drawn under the pointer at (250, 200); b is the other one
            .sort((p, q) => Math.hypot(q.x - 250, q.y - 200) - Math.hypot(p.x - 250, p.y - 200))[0];
        const node = { index: 1, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, x: 150, y: 100 });
        el.emit({ type: 'drag', node, x: 250, y: 200 }); // a now sits on b
        const shown = drawnB();
        expect(byId(el).b.y).toBe(100); // the data waits for the release
        expect(Math.abs(300 - shown.y - 100)).toBeGreaterThan(1); // but b is drawn out of the way
        el.emit({ type: 'dragend', node, x: 250, y: 200 });
        expect(300 - byId(el).b.y).toBeCloseTo(shown.y, 5); // where it was shown
        expect(clear(byId(el).a, byId(el).b, 8)).toBe(true);
    });

    it('keeps circles their gap apart edge to edge, not as squares', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: { ...boxSchema, tables: { ...boxSchema.tables, nodes: { ...boxSchema.tables.nodes, r: { type: 'quantitative', domain: [0, 100] } } } },
            data: { nodes: [{ id: 'a', x: 200, y: 150, r: 20 }, { id: 'b', x: 212, y: 160, r: 20 }, { id: 'c', x: 195, y: 140, r: 20 }], nesting: [] },
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } } })],
            layout: [layout.dodge()],
        });
        document.body.appendChild(el.dom());
        const n = el.getData().nodes;
        const gaps = [[0, 1], [0, 2], [1, 2]].map(([i, j]) => Math.hypot(n[i].x - n[j].x, n[i].y - n[j].y) - n[i].r - n[j].r);
        expect(Math.min(...gaps)).toBeGreaterThan(8 - 0.05);
        expect(Math.min(...gaps)).toBeLessThan(8.5);
    });

    it('dodges a composite as a whole, every part included', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: boxSchema,
            data: { nodes: [{ id: 'a', x: 180, y: 150 }, { id: 'b', x: 230, y: 150 }], nesting: [] },
            marks: [plot.composite({
                channels: { x: { field: 'x' }, y: { field: 'y' } },
                // a small dot with a wide bar under it: the dots are clear, the bars are not
                parts: [plot.point({ channels: { size: { value: 6 } } }), plot.rect({ channels: { width: { value: 80 }, height: { value: 10 } } })],
            })],
            layout: [layout.dodge()],
        });
        document.body.appendChild(el.dom());
        const [a, b] = el.getData().nodes;
        expect(Math.abs(a.x - b.x) >= 88 - 0.05 || Math.abs(a.y - b.y) >= 18 - 0.05).toBe(true);
    });

    it('spaces children an outside caller adds with no position', () => {
        const el = chart({ nodes: [box('g', 200, 150), box('a', 200, 150)], nesting: [nest('a', 'g')] });
        const data = el.getData();
        el.setData({
            nodes: [...data.nodes, { id: 'n1', w: 40, h: 20 }, { id: 'n2', w: 40, h: 20 }, { id: 'n3', w: 40, h: 20 }],
            nesting: [...data.nesting, nest('n1', 'g'), nest('n2', 'g'), nest('n3', 'g')],
        });
        const d = byId(el);
        expect(allClear([d.a, d.n1, d.n2, d.n3], 8)).toBe(true);
    });
});

describe('dodge is opt-in', () => {
    it('leaves overlapping siblings where they sit when no `layout.dodge()` is declared', () => {
        const el = boxChart({
            nodes: [box('g', 0, 0), box('a', 100, 100), box('b', 110, 104), box('c', 300, 200), box('d', 305, 205)],
            nesting: [nest('a', 'g'), nest('b', 'g')],
        });
        const d = byId(el);
        expect(d.a.x).toBe(100);
        expect(d.b.x).toBe(110);
        expect(d.c.x).toBe(300);
        expect(d.d.x).toBe(305);
    });
});

describe('an emptied container', () => {
    const withDefaults = {
        ...boxSchema,
        tables: {
            ...boxSchema.tables,
            nodes: {
                ...boxSchema.tables.nodes,
                w: { type: 'quantitative', domain: [0, 400], default: 80 },
                h: { type: 'quantitative', domain: [0, 300], default: 50 },
            },
        },
    };
    const chart = (schemaSpec) => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: schemaSpec,
            data: { nodes: [box('g', 0, 0), box('a', 100, 200, 120, 60), box('n', 300, 60, 120, 60)], nesting: [nest('a', 'g')] },
            marks: [plot.rect({
                id: 'boxes',
                channels: {
                    x: { field: 'x' }, y: { field: 'y' },
                    width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
                },
                contains: { where: (d) => d.id === 'g', padding: 10, fit: true },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el.dom());
        return el;
    };
    const dragOut = (el) => {
        const node = { index: 1, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, x: 100, y: 100 });
        el.emit({ type: 'drag', node, x: 300, y: 120 });
        el.emit({ type: 'dragend', node, x: 300, y: 120 });
    };

    it('returns to its columns\' schema default, keeping its top-left', () => {
        const el = chart(withDefaults);
        const before = byId(el).g;
        expect(before.w).toBeCloseTo(140, 5);
        dragOut(el);
        const g = byId(el).g;
        expect(el.getData().nesting).toEqual([]);
        expect(g.w).toBe(80);
        expect(g.h).toBe(50);
        expect(g.x - g.w / 2).toBeCloseTo(before.x - before.w / 2, 5);
        expect(g.y + g.h / 2).toBeCloseTo(before.y + before.h / 2, 5); // data y runs up
    });

    it('shrinks to its padding and warns when the column declares no default', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setWarnings(true);
        try {
            const el = chart(boxSchema);
            dragOut(el);
            const g = byId(el).g;
            expect(g.w).toBeCloseTo(20, 5);
            expect(g.h).toBeCloseTo(20, 5);
            expect(spy.mock.calls.some(([m]) => /declares no `default`/.test(m))).toBe(true);
        } finally {
            setWarnings(false);
            spy.mockRestore();
        }
    });

    it('leaves a leaf that could hold others at its own size', () => {
        const el = boxChart({ nodes: [box('a', 100, 100, 90, 30), box('b', 300, 100)], nesting: [] });
        expect(byId(el).a.w).toBe(90);
    });
});

describe('arranged contents', () => {
    const laneMark = () => plot.rect({
        id: 'boxes',
        channels: {
            x: { field: 'x' }, y: { field: 'y' },
            width: { field: 'w', scale: null }, height: { field: 'h', scale: null },
        },
        edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
    });
    const chart = (data, lay = [layout.contain({ where: (d) => d.id.startsWith('L'), padding: 10, fit: true }), layout.column({ gap: 6 })]) => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: boxSchema, data, marks: [laneMark()], layout: lay,
        });
        document.body.appendChild(el.dom());
        return el;
    };
    // pixel y of each card, top first
    const order = (el, ids) => ids.map((id) => [id, byId(el)[id]]).sort((p, q) => q[1].y - p[1].y).map(([id]) => id);
    const drag = (el, index, to, steps = 4) => {
        const d = el.getData().nodes[index];
        const from = { x: d.x, y: 300 - d.y };
        const node = { index, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, ...from });
        for (let k = 1; k <= steps; k++) {
            el.emit({ type: 'drag', node, x: from.x + (to.x - from.x) * k / steps, y: from.y + (to.y - from.y) * k / steps });
        }
        el.emit({ type: 'dragend', node, ...to });
    };
    const seed = () => ({
        nodes: [box('L1', 80, 200), box('c1', 80, 250), box('c2', 90, 200), box('c3', 70, 150), box('L2', 300, 200), box('d1', 300, 200)],
        nesting: [nest('c1', 'L1'), nest('c2', 'L1'), nest('c3', 'L1'), nest('d1', 'L2')],
    });

    it('stacks a column\'s cards from its top-left, in the order they sit', () => {
        const el = chart(seed());
        const d = byId(el);
        expect(order(el, ['c1', 'c2', 'c3'])).toEqual(['c1', 'c2', 'c3']);
        expect(d.c1.x).toBe(d.c2.x);
        expect(d.c2.x).toBe(d.c3.x);
        expect(d.c1.y - d.c2.y).toBeCloseTo(20 + 6, 5);
        // the lane is fitted round them
        expect(d.L1.h).toBeCloseTo(3 * 20 + 2 * 6 + 20, 5);
        expect(d.L1.x - d.L1.w / 2).toBeCloseTo(d.c1.x - 20 - 10, 5);
    });

    it('reorders when a card is dropped between others, and leaves no gap', () => {
        const el = chart(seed());
        const top = byId(el).c1;
        drag(el, 3, { x: top.x, y: 300 - top.y - 12 }); // c3 to above c1
        expect(order(el, ['c1', 'c2', 'c3'])).toEqual(['c3', 'c1', 'c2']);
        const d = byId(el);
        expect(d.c3.y).toBeCloseTo(top.y, 5);
        expect(d.c1.y - d.c2.y).toBeCloseTo(26, 5);
        expect(el.getData().nesting).toHaveLength(4);
    });

    it('opens the slot while a card is dragged, and keeps the card under the pointer', () => {
        const el = chart(seed());
        const before = byId(el);
        const node = { index: 3, featureId: 'boxes' };
        const from = { x: before.c3.x, y: 300 - before.c3.y };
        const to = { x: before.c1.x, y: 300 - before.c1.y - 12 };
        el.emit({ type: 'dragstart', node, ...from });
        el.emit({ type: 'drag', node, ...to });
        const drawn = [...el.dom().querySelectorAll('rect')].filter((r) => +r.getAttribute('width') === 40)
            .map((r) => +r.getAttribute('y') + 10).sort((p, q) => p - q);
        // c1 and c2 drawn one slot down; c3 under the pointer
        expect(drawn.some((y) => Math.abs(y - (300 - before.c2.y)) < 0.5)).toBe(true);
        expect(drawn.some((y) => Math.abs(y - (300 - before.c3.y)) < 0.5)).toBe(true);
        expect(drawn.some((y) => Math.abs(y - to.y) < 0.5)).toBe(true);
        expect(byId(el).c1.y).toBe(before.c1.y); // the data waits for the release
        el.emit({ type: 'dragend', node, ...to });
    });

    it('puts a card from another lane in the slot nearest the drop', () => {
        const el = chart(seed());
        const d0 = byId(el);
        // just below halfway between c1 and c2
        drag(el, 5, { x: d0.c1.x, y: 300 - (d0.c1.y + d0.c2.y) / 2 + 4 });
        expect(el.getData().nesting).toContainEqual(nest('d1', 'L1'));
        expect(order(el, ['c1', 'c2', 'c3', 'd1'])).toEqual(['c1', 'd1', 'c2', 'c3']);
        const d = byId(el);
        expect(d.L1.h).toBeCloseTo(4 * 20 + 3 * 6 + 20, 5);
    });

    it('lines a row up left to right, and wraps a fixed one at its width', () => {
        const kids = ['a', 'b', 'c', 'd'];
        const data = () => ({
            nodes: [{ id: 'L', x: 200, y: 150, w: 130, h: 100 }, ...kids.map((id, k) => box(id, 150 + k * 10, 150))],
            nesting: kids.map((id) => nest(id, 'L')),
        });
        const grown = byId(chart(data(), [layout.contain({ where: (d) => d.id === 'L', padding: 10, fit: true }), layout.row({ gap: 6 })]));
        expect(kids.map((id) => grown[id].x)).toEqual([90, 136, 182, 228].map((x) => x + grown.a.x - 90));
        expect(new Set(kids.map((id) => grown[id].y)).size).toBe(1);
        const wrapped = byId(chart(data(), [layout.contain({ where: (d) => d.id === 'L', padding: 10, fit: false }), layout.row({ gap: 6 })]));
        expect(wrapped.L.w).toBe(130);
        // 110px inside: two 40px cards to a line
        expect(wrapped.a.y).toBe(wrapped.b.y);
        expect(wrapped.c.y).toBeCloseTo(wrapped.a.y - 26, 5);
        expect(wrapped.c.x).toBe(wrapped.a.x);
    });

    it('puts a card sent with no position in the last slot', () => {
        const el = chart(seed());
        const data = el.getData();
        el.setData({
            nodes: [...data.nodes, { id: 'c4', w: 40, h: 20 }],
            nesting: [...data.nesting, nest('c4', 'L1')],
        });
        expect(order(el, ['c1', 'c2', 'c3', 'c4'])).toEqual(['c1', 'c2', 'c3', 'c4']);
        const d = byId(el);
        expect(d.c3.y - d.c4.y).toBeCloseTo(26, 5);
        expect(d.c4.x).toBe(d.c1.x);
    });

    it('lays a grid out `columns` to a row', () => {
        const kids = ['a', 'b', 'c', 'd', 'e'];
        const el = chart({
            nodes: [box('L', 200, 150), ...kids.map((id, k) => box(id, 150 + k * 10, 150 - k))],
            nesting: kids.map((id) => nest(id, 'L')),
        }, [layout.contain({ where: (d) => d.id === 'L', padding: 10, fit: true }), layout.grid({ columns: 2, gap: 6 })]);
        const d = byId(el);
        expect(new Set(kids.map((id) => d[id].x)).size).toBe(2);
        expect(new Set(kids.map((id) => d[id].y)).size).toBe(3);
    });

    const packChart = () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: { ...boxSchema, tables: { ...boxSchema.tables, nodes: { ...boxSchema.tables.nodes, r: { type: 'quantitative', domain: [0, 200] } } } },
            data: {
                nodes: [{ id: 'S', x: 200, y: 150, r: 10 }, ...[12, 20, 8, 15, 10].map((r, k) => ({ id: `p${k}`, x: 200 + k, y: 150, r }))],
                nesting: [0, 1, 2, 3, 4].map((k) => nest(`p${k}`, 'S')),
            },
            marks: [plot.point({
                id: 'dots',
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
                channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } },
            })],
            layout: [
                layout.contain({ where: (d) => d.id === 'S', padding: 6, fit: true }),
                layout.pack({ gap: 4 }),
            ],
        });
        document.body.appendChild(el.dom());
        return el;
    };
    const packedApart = (kids, gap) => kids.every((a, i) => kids.slice(i + 1).every((b) =>
        Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r > gap - 0.05));

    it('packs round nodes in the set, their gap apart', () => {
        const el = packChart();
        const n = el.getData().nodes;
        const kids = n.slice(1);
        expect(packedApart(kids, 4)).toBe(true);
        for (const k of kids) {
            // inside the fitted set
            expect(Math.hypot(k.x - n[0].x, k.y - n[0].y) + k.r).toBeLessThanOrEqual(n[0].r + 0.05);
        }
    });

    it('holds a pack still while a node is dragged in it, and packs it on release', () => {
        const el = packChart();
        const before = el.getData().nodes;
        const drawn = () => [...el.dom().querySelectorAll('circle')].map((c) => [+c.getAttribute('cx'), +c.getAttribute('cy'), +c.getAttribute('r')].join());
        const node = { index: 1, featureId: 'dots' };
        const p0 = before[1];
        const from = { x: p0.x, y: 300 - p0.y };
        // onto another node
        const other = before[2];
        const to = { x: other.x + 3, y: 300 - other.y + 3 };
        el.emit({ type: 'dragstart', node, ...from });
        const still = drawn();
        for (let k = 1; k <= 4; k++) el.emit({ type: 'drag', node, x: from.x + (to.x - from.x) * k / 4, y: from.y + (to.y - from.y) * k / 4 });
        // only the dragged node moved: the others and the set are drawn as they were
        const mid = drawn();
        expect(mid.filter((c) => still.includes(c)).length).toBe(still.length - 1);
        el.emit({ type: 'dragend', node, ...to });
        const after = el.getData().nodes;
        expect(packedApart(after.slice(1), 4)).toBe(true);
        // the node it was dropped on stays; the dropped one lands beside it
        expect(after[2].x).toBeCloseTo(other.x, 5);
        expect(after[2].y).toBeCloseTo(other.y, 5);
        expect(Math.hypot(after[1].x - other.x, after[1].y - other.y)).toBeCloseTo(other.r + p0.r + 4, 3);
    });

    it('packs boxes in a fixed board along their angle from the middle one', () => {
        const kids = [['c0', 200, 150], ['c1', 300, 160], ['c2', 120, 220], ['c3', 210, 40]];
        const el = chart({
            nodes: [box('L', 200, 150, 380, 280), ...kids.map(([id, x, y]) => box(id, x, y))],
            nesting: kids.map(([id]) => nest(id, 'L')),
        }, [layout.contain({ where: (d) => d.id === 'L', fit: false }), layout.pack({ keep: 'angle', gap: 4 })]);
        const d = byId(el);
        for (const [id, x, y] of kids.slice(1)) {
            expect(Math.atan2(d[id].y - 150, d[id].x - 200)).toBeCloseTo(Math.atan2(y - 150, x - 200), 6);
            // drawn in to touch: closer to the middle than it was put
            expect(Math.hypot(d[id].x - 200, d[id].y - 150)).toBeLessThan(Math.hypot(x - 200, y - 150));
        }
        const ids = kids.map(([id]) => id);
        for (const a of ids) {
            for (const b of ids) {
                if (a === b) continue;
                const gap = Math.max(Math.abs(d[a].x - d[b].x) - 40, Math.abs(d[a].y - d[b].y) - 20);
                expect(gap).toBeGreaterThan(4 - 1e-6);
            }
        }
    });

    it('warns on a keep it does not know, or one outside a pack', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setWarnings(true);
        try {
            chart(seed(), [layout.pack({ keep: 'size' })]);
            expect(spy.mock.calls.some(([m]) => /keep: "size"/.test(m))).toBe(true);
            chart(seed(), [layout.row({ keep: 'angle' })]);
            expect(spy.mock.calls.some(([m]) => /only applies to layout\.pack/.test(m))).toBe(true);
        } finally {
            setWarnings(false);
            spy.mockRestore();
        }
    });
});

describe('Dataset.set on a hierarchy', () => {
    const seed = () => ({
        nodes: [box('g', 0, 0, 5, 5), box('a', 100, 100), box('b', 200, 140)],
        nesting: [nest('a', 'g'), nest('b', 'g')],
    });

    it('re-fits the container around a child it moves', () => {
        const el = boxChart(seed());
        expect(byId(el).g.x).toBeCloseTo(150, 5);
        expect(el.set('x', 300, { table: 'nodes', index: 1 })).toBe(true);
        const d = byId(el);
        expect(d.a.x).toBe(300);
        // The children now span x 180..320, so the group moved to hold them.
        expect(d.g.x).toBeCloseTo(250, 5);
        expect(d.g.w).toBeCloseTo(140 + 20, 5);
    });

    it('refuses a write that breaks the tree', () => {
        const el = boxChart(seed());
        expect(el.set('parent', 'a', { table: 'nesting', index: 0 })).toBe(false);
        expect(el.getData().nesting).toEqual(seed().nesting);
        expect(el.canUndo()).toBe(false);
    });
});

// ── Several charts over one hierarchy ────────────────────────────────────────
// A chart settles the node rows in its own pixels. Only the chart whose pixels
// the rows were last settled in (a commit, or the first to take outside data)
// settles at render time; every other chart draws the stored boxes.
describe('a hierarchy drawn by several charts', () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const seed = () => ({
        nodes: [box('g', 0, 0, 5, 5), box('a', 100, 100), box('b', 200, 140), box('h', 0, 0), box('c', 300, 220), box('d', 60, 40)],
        nesting: [nest('a', 'g'), nest('b', 'g'), nest('c', 'h')],
    });
    const editsOf = () => [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()];
    // The box mark's sizes are pixels (`scale: null`), so a container's fitted
    // width differs between charts of different size.
    const view = (width, height) => ({
        width, height, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
        marks: [boxes(editsOf())],
    });
    const mount = (chart) => { document.body.appendChild(chart.dom()); return chart; };
    // A at the domain's size (pixel == data on x), B at half of it.
    const pair = async (data = seed()) => {
        const ds = Elicit.dataset({ schema: boxSchema, data });
        const A = mount(ds.chart(view(400, 300)));
        const B = mount(ds.chart(view(200, 150)));
        await tick();
        return { ds, A, B };
    };
    const solo = (width, height, data = seed()) => mount(Elicit({ schema: boxSchema, data, ...view(width, height) }));
    // Data -> a chart's pixels, for a chart `k` times the domain's size.
    const pxIn = (k) => (d) => ({ x: d.x * k, y: (300 - d.y) * k });
    const rim = (k, d) => ({ x: (d.x - d.w / 2) * k + 4, y: (300 - d.y) * k });
    const drag = (el, k, index, to) => {
        const from = pxIn(k)(el.getData().nodes[index]);
        const node = { index, featureId: 'boxes' };
        el.emit({ type: 'dragstart', node, ...from });
        for (let s = 1; s <= 4; s++) el.emit({ type: 'drag', node, x: from.x + (to.x - from.x) * s / 4, y: from.y + (to.y - from.y) * s / 4 });
        el.emit({ type: 'dragend', node, ...to });
    };
    // Renders that change no data: a hover in each chart, a selection round trip.
    const idle = (ds, ...charts) => {
        for (const c of charts) {
            const rect = [...c.dom().querySelectorAll('rect')].map((r) => r.__data__).find((n) => n && n.featureId === 'boxes');
            c.emit({ type: 'pointerover', node: rect });
            c.emit({ type: 'pointerout', node: rect });
        }
        ds.select(0);
        ds.clearSelection();
    };
    // The drawn box of a row in a chart `k` times the domain's size, read off its DOM.
    const drawn = (chart, k, d) => [...chart.dom().querySelectorAll('rect')].some((r) =>
        Math.abs(+r.getAttribute('width') - d.w) < 0.01 && Math.abs(+r.getAttribute('height') - d.h) < 0.01
        && Math.abs(+r.getAttribute('x') + d.w / 2 - d.x * k) < 0.01
        && Math.abs(+r.getAttribute('y') + d.h / 2 - (300 - d.y) * k) < 0.01);
    const drawsAll = (chart, k, ds) => ds.getData().nodes.every((d) => drawn(chart, k, d));

    it('settles once, in the first chart, and stays put however often either redraws', async () => {
        const { ds, A, B } = await pair();
        // The rows are A's settle: B's own would fit g to a different width.
        expect(ds.getData()).toEqual(solo(400, 300).getData());
        expect(solo(200, 150).getData().nodes[0].w).not.toBeCloseTo(ds.getData().nodes[0].w, 1);
        const once = ds.getData();
        for (let k = 0; k < 3; k++) idle(ds, A, B, B, A);
        expect(ds.getData()).toEqual(once);
        expect(drawsAll(A, 1, ds) && drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('a drag in A is drawn by B, and B redrawing moves nothing', async () => {
        const { ds, A, B } = await pair();
        drag(A, 1, 5, rim(1, byId(A).g));
        expect(ds.getData().nesting).toContainEqual(nest('d', 'g'));
        const after = ds.getData();
        expect(drawsAll(B, 0.5, ds)).toBe(true);
        idle(ds, B, A, B);
        expect(ds.getData()).toEqual(after);
        expect(drawsAll(A, 1, ds) && drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('a drag in B settles in B, is drawn by A, and A redrawing moves nothing', async () => {
        const { ds, A, B } = await pair();
        drag(B, 0.5, 5, rim(0.5, byId(B).g));
        expect(ds.getData().nesting).toContainEqual(nest('d', 'g'));
        const after = ds.getData();
        expect(drawsAll(A, 1, ds)).toBe(true);
        idle(ds, A, B, A);
        expect(ds.getData()).toEqual(after);
        expect(drawsAll(A, 1, ds) && drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('a stroke that commits nothing leaves the other chart\'s layout alone', async () => {
        const { ds, B } = await pair();
        const before = ds.getData();
        const node = { index: 1, featureId: 'boxes' };
        const at = pxIn(0.5)(before.nodes[1]);
        B.emit({ type: 'dragstart', node, ...at });
        B.emit({ type: 'dragend', node, ...at });
        expect(ds.getData()).toEqual(before);
        expect(ds.canUndo()).toBe(false);
    });

    it('setData and set settle once, in the first chart to render', async () => {
        const { ds, A, B } = await pair();
        const next = { ...seed(), nesting: [nest('a', 'g'), nest('c', 'g'), nest('d', 'h')] };
        ds.setData(next);
        const alone = solo(400, 300);
        alone.setData(next);
        expect(ds.getData()).toEqual(alone.getData());
        idle(ds, A, B);
        expect(ds.getData()).toEqual(alone.getData());
        expect(drawsAll(B, 0.5, ds)).toBe(true);

        expect(ds.set('x', 300, { table: 'nodes', index: 1 })).toBe(true);
        alone.set('x', 300, { table: 'nodes', index: 1 });
        expect(ds.getData()).toEqual(alone.getData());
        idle(ds, B, A);
        expect(ds.getData()).toEqual(alone.getData());
        expect(drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('undo and redo restore the committed rows exactly', async () => {
        const { ds, A, B } = await pair();
        const before = ds.getData();
        drag(B, 0.5, 5, rim(0.5, byId(B).g));
        const after = ds.getData();
        expect(after).not.toEqual(before);
        ds.undo();
        expect(ds.getData()).toEqual(before);
        idle(ds, A, B);
        expect(ds.getData()).toEqual(before);
        ds.redo();
        expect(ds.getData()).toEqual(after);
        idle(ds, A, B);
        expect(ds.getData()).toEqual(after);
        expect(drawsAll(A, 1, ds) && drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('a chart attached after the first has rendered moves no node', async () => {
        const ds = Elicit.dataset({ schema: boxSchema, data: seed() });
        const A = mount(ds.chart(view(400, 300)));
        await tick();
        const before = ds.getData();
        const B = mount(ds.chart(view(200, 150)));
        expect(ds.getData()).toEqual(before);
        await tick();
        idle(ds, B, A);
        expect(ds.getData()).toEqual(before);
        expect(drawsAll(B, 0.5, ds)).toBe(true);
    });

    it('a chart that draws no boxes leaves the settling to the chart that does', async () => {
        const ds = Elicit.dataset({ schema: boxSchema, data: seed() });
        const list = mount(ds.chart({
            width: 300, height: 200, axes: false, motion: false,
            marks: [plot.bar({ channels: { x: { field: 'id' }, y: { field: 'x', edit: edit.move({ name: 'move' }) } } })],
        }));
        const A = mount(ds.chart(view(400, 300)));
        await tick();
        expect(ds.getData()).toEqual(solo(400, 300).getData());
        list.control('move', 1).set(300);
        const d = byId(A);
        expect(d.a.x).toBeCloseTo(300, 0);
        // A re-fit g round the child the list moved.
        expect(d.g.x).toBeCloseTo((d.a.x - 20 + 220) / 2, 5);
        const after = ds.getData();
        idle(ds, A, list);
        expect(ds.getData()).toEqual(after);
    });

    it('one chart alone: idle redraws move nothing', async () => {
        const el = solo(400, 300);
        await tick();
        const once = el.getData();
        for (let k = 0; k < 3; k++) idle(el, el);
        expect(el.getData()).toEqual(once);
    });
});
