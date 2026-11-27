// @vitest-environment jsdom
// Spatial layout processes (`layout.*`), pure-data `constraints.contain`, and
// `mark.contains` sugar across tables, networks and hierarchies.
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, constraints, layout, setWarnings } from '../src/index.js';

setWarnings(false);

const hierarchySchema = {
    structure: 'hierarchy',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            kind: { type: 'categorical', domain: ['lane', 'card'] },
            x: { type: 'quantitative', domain: [0, 400] },
            y: { type: 'quantitative', domain: [0, 300] },
            w: { type: 'quantitative', domain: [0, 400], default: 100 },
            h: { type: 'quantitative', domain: [0, 300], default: 60 },
        },
        nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
    },
};

const byId = (el) => Object.fromEntries(el.getData().nodes.map((d) => [d.id, d]));
const drag = (el, featureId, index, from, to) => {
    const node = { index, featureId };
    el.emit({ type: 'dragstart', node, ...from });
    el.emit({ type: 'drag', node, ...to });
    el.emit({ type: 'dragend', node, ...to });
};

describe('constraints.contain (pure-data nesting invariant)', () => {
    const seed = () => ({
        nodes: [
            { id: 'L1', kind: 'lane', x: 100, y: 150, w: 120, h: 160 },
            { id: 'L2', kind: 'lane', x: 300, y: 150, w: 120, h: 160 },
            { id: 'c1', kind: 'card', x: 100, y: 180, w: 80, h: 30 },
            { id: 'c2', kind: 'card', x: 200, y: 50, w: 80, h: 30 },
            { id: 'c3', kind: 'card', x: 250, y: 50, w: 80, h: 30 },
        ],
        nesting: [{ child: 'c1', parent: 'L1' }],
    });

    it('gates edit.hierarchy.nest and lets drops on a non-container leaf fall through to its parent lane', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: hierarchySchema,
            data: seed(),
            constraints: [constraints.contain({ parent: (d) => d.kind === 'lane', child: (d) => d.kind === 'card' })],
            marks: [plot.rect({
                id: 'boxes',
                channels: { x: { field: 'x' }, y: { field: 'y' }, width: { field: 'w', scale: null }, height: { field: 'h', scale: null } },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el.dom());
        // Drop c2 directly on top of c1 (which sits inside L1): skips c1 and lands in L1.
        drag(el, 'boxes', 3, { x: 200, y: 250 }, { x: 100, y: 120 });
        expect(el.getData().nesting).toContainEqual({ child: 'c2', parent: 'L1' });
        // Dragging a lane onto another lane is rejected by `child: d => d.kind === 'card'`.
        drag(el, 'boxes', 1, { x: 300, y: 150 }, { x: 100, y: 150 });
        expect(el.getData().nesting.some((r) => r.child === 'L2')).toBe(false);
    });

    it('enforces maxChildren and maxDepth on both drag and Dataset.set', () => {
        const ds = Elicit.dataset({
            schema: hierarchySchema,
            data: seed(),
            constraints: [constraints.contain({ parent: (d) => d.kind === 'lane', maxChildren: 1, maxDepth: 1 })],
        });
        const el = ds.chart({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            marks: [plot.rect({
                id: 'boxes',
                channels: { x: { field: 'x' }, y: { field: 'y' }, width: { field: 'w', scale: null }, height: { field: 'h', scale: null } },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
            })],
        });
        document.body.appendChild(el.dom());
        // L1 already has 1 child (c1), so dropping c2 into L1 is rejected.
        drag(el, 'boxes', 3, { x: 200, y: 250 }, { x: 100, y: 150 });
        expect(ds.getData().nesting).toEqual([{ child: 'c1', parent: 'L1' }]);
        // L2 has 0 children, so dropping c2 into L2 succeeds.
        drag(el, 'boxes', 3, { x: 200, y: 250 }, { x: 300, y: 150 });
        expect(ds.getData().nesting).toContainEqual({ child: 'c2', parent: 'L2' });
        // Dataset.set cannot re-parent c1 into a card (rejected by `parent` invariant).
        expect(ds.set('parent', 'c2', { table: 'nesting', index: 0 })).toBe(false);
        expect(ds.getData().nesting[0]).toEqual({ child: 'c1', parent: 'L1' });
    });
});

describe('multi-level Kanban composition (layout.row + layout.column + layout.contain)', () => {
    it('arranges top-level lanes in a row and each lane\'s cards in a column with y-only fit', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: hierarchySchema,
            data: {
                nodes: [
                    { id: 'L1', kind: 'lane', x: 50, y: 200, w: 120, h: 100 },
                    { id: 'L2', kind: 'lane', x: 200, y: 200, w: 120, h: 100 },
                    { id: 'c1', kind: 'card', x: 50, y: 220, w: 80, h: 24 },
                    { id: 'c2', kind: 'card', x: 50, y: 180, w: 80, h: 24 },
                    { id: 'c3', kind: 'card', x: 200, y: 220, w: 80, h: 24 },
                ],
                nesting: [
                    { child: 'c1', parent: 'L1' },
                    { child: 'c2', parent: 'L1' },
                    { child: 'c3', parent: 'L2' },
                ],
            },
            marks: [plot.rect({
                id: 'boxes',
                channels: { x: { field: 'x' }, y: { field: 'y' }, width: { field: 'w', scale: null }, height: { field: 'h', scale: null } },
            })],
            layout: [
                layout.hierarchy.contain({ where: (d) => d.kind === 'lane', padding: { top: 24, left: 10, right: 10, bottom: 10 }, fit: 'y' }),
                layout.column({ in: (d) => d.kind === 'lane', gap: 6 }),
                layout.row({ in: 'roots', gap: 16 }),
            ],
        });
        document.body.appendChild(el.dom());
        const d = byId(el);
        // Lanes keep fixed width 120 (fit: 'y') and auto-fit height to their cards + padding.
        expect(d.L1.w).toBe(120);
        expect(d.L1.h).toBeCloseTo(24 + 24 + 6 + 24 + 10, 5);
        expect(d.L2.h).toBeCloseTo(24 + 24 + 10, 5);
        // Lanes are lined up in a row from the plot's left edge, 16px apart.
        expect(d.L1.x).toBeCloseTo(60, 5);
        expect(d.L2.x).toBeCloseTo(120 + 16 + 60, 5);
        // Cards inside L1 are stacked in a column, 6px apart.
        expect(d.c1.x).toBeCloseTo(d.c2.x, 5);
        expect(d.c1.y - d.c2.y).toBeCloseTo(24 + 6, 5);
    });
});

describe('mark.contains sugar on multiple marks', () => {
    it('lets one mark contain while a sibling mark over the same table cannot', () => {
        const schema = {
            structure: 'hierarchy',
            tables: {
                nodes: {
                    id: { type: 'categorical', key: true },
                    kind: { type: 'categorical', domain: ['group', 'dot'] },
                    x: { type: 'quantitative', domain: [0, 400] },
                    y: { type: 'quantitative', domain: [0, 300] },
                    w: { type: 'quantitative', domain: [0, 400], default: 80 },
                    h: { type: 'quantitative', domain: [0, 300], default: 60 },
                    r: { type: 'quantitative', domain: [0, 50], default: 12 },
                },
                nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
            },
        };
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema,
            data: {
                nodes: [
                    { id: 'g', kind: 'group', x: 100, y: 150, w: 120, h: 100, r: null },
                    { id: 'p1', kind: 'dot', x: 280, y: 150, w: null, h: null, r: 14 },
                    { id: 'p2', kind: 'dot', x: 350, y: 150, w: null, h: null, r: 14 },
                ],
                nesting: [],
            },
            marks: [
                plot.rect({
                    id: 'groups',
                    channels: { x: { field: 'x' }, y: { field: 'y' }, width: { field: 'w', scale: null }, height: { field: 'h', scale: null } },
                    contains: { padding: 10, fit: true },
                    edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
                }),
                plot.point({
                    id: 'dots',
                    channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } },
                    edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' }), edit.hierarchy.nest()],
                }),
            ],
        });
        document.body.appendChild(el.dom());
        // Dropping p2 onto p1 (a dot, no `contains`) does NOT nest.
        drag(el, 'dots', 2, { x: 350, y: 150 }, { x: 280, y: 150 });
        expect(el.getData().nesting).toEqual([]);
        // Dropping p2 onto g (a rect with `contains`) DOES nest and fits g.
        drag(el, 'dots', 2, { x: 280, y: 150 }, { x: 100, y: 150 });
        expect(el.getData().nesting).toEqual([{ child: 'p2', parent: 'g' }]);
        expect(byId(el).g.w).toBeCloseTo(28 + 20, 5);
    });
});

describe('non-hierarchy structures (flat table and network)', () => {
    const flatSchema = {
        id: { type: 'categorical', key: true },
        x: { type: 'quantitative', domain: [0, 400] },
        y: { type: 'quantitative', domain: [0, 300] },
        r: { type: 'quantitative', domain: [0, 100] },
    };

    it('dodges overlapping points on a flat table, settling on release with one undo step', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: flatSchema,
            data: [
                { id: 'a', x: 100, y: 150, r: 20 },
                { id: 'b', x: 250, y: 150, r: 20 },
            ],
            marks: [plot.point({
                id: 'dots',
                channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' })],
            })],
            layout: [layout.dodge({ gap: 10 })],
        });
        document.body.appendChild(el.dom());
        // Drag a onto b: mid-drag b stays at 250 in data; on release b dodges clear by 10px.
        const node = { index: 0, featureId: 'dots' };
        el.emit({ type: 'dragstart', node, x: 100, y: 150 });
        el.emit({ type: 'drag', node, x: 245, y: 150 });
        expect(el.getData()[1].x).toBe(250);
        el.emit({ type: 'dragend', node, x: 245, y: 150 });
        const [a, b] = el.getData();
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(50 - 0.05);
        el.undo();
        expect(el.getData()[0].x).toBe(100);
        expect(el.getData()[1].x).toBe(250);
    });

    it('packs points on a flat table with layout.pack', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: flatSchema,
            data: [
                { id: 'a', x: 200, y: 150, r: 15 },
                { id: 'b', x: 202, y: 151, r: 20 },
                { id: 'c', x: 198, y: 149, r: 10 },
            ],
            marks: [plot.point({
                channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } },
            })],
            layout: [layout.pack({ gap: 4 })],
        });
        document.body.appendChild(el.dom());
        const d = el.getData();
        for (let i = 0; i < d.length; i++) {
            for (let j = i + 1; j < d.length; j++) {
                expect(Math.hypot(d[i].x - d[j].x, d[i].y - d[j].y) - d[i].r - d[j].r).toBeGreaterThanOrEqual(4 - 0.05);
            }
        }
    });

    it('arranges flat cards in a grid and reorders on drop', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: {
                id: { type: 'categorical', key: true },
                x: { type: 'quantitative', domain: [0, 400] },
                y: { type: 'quantitative', domain: [0, 300] },
            },
            data: ['a', 'b', 'c', 'd'].map((id, i) => ({ id, x: 20 + i * 10, y: 280 })),
            marks: [plot.rect({
                id: 'cards', width: 60, height: 30,
                channels: { x: { field: 'x' }, y: { field: 'y' } },
                edits: [edit.move({ channels: ['x', 'y'], mode: 'relative' })],
            })],
            layout: [layout.grid({ columns: 2, gap: 10 })],
        });
        document.body.appendChild(el.dom());
        const d = el.getData();
        expect(new Set(d.map((r) => Math.round(r.x))).size).toBe(2);
        expect(new Set(d.map((r) => Math.round(r.y))).size).toBe(2);
    });

    it('dodges network nodes while links stay docked', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: {
                structure: 'network',
                tables: {
                    nodes: flatSchema,
                    links: { source: { type: 'ref' }, target: { type: 'ref' } },
                },
            },
            data: {
                nodes: [
                    { id: 'a', x: 200, y: 150, r: 20 },
                    { id: 'b', x: 205, y: 150, r: 20 },
                ],
                links: [{ source: 'a', target: 'b' }],
            },
            marks: [
                plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' }, size: { field: 'r', scale: null } } }),
                plot.link({}),
            ],
            layout: [layout.dodge({ gap: 12 })],
        });
        document.body.appendChild(el.dom());
        const [a, b] = el.getData().nodes;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(52 - 0.05);
    });
});

describe('layout.custom and diagnostics', () => {
    it('runs layout.custom with access to rows, scales, nodeBox and write', () => {
        const el = Elicit({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false, motion: false,
            schema: { x: { type: 'quantitative', domain: [0, 400] }, y: { type: 'quantitative', domain: [0, 300] } },
            data: [{ x: 10, y: 150 }, { x: 20, y: 150 }],
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
            layout: [layout.custom(({ rows, write }) => {
                rows.forEach((_, i) => write(i, { x: 100 + i * 100 }));
            })],
        });
        document.body.appendChild(el.dom());
        expect(el.getData().map((d) => d.x)).toEqual([100, 200]);
    });

    it('warns on removed channel keys (`channels.contains`, `channels.dodge`, `fit: true`) and unknown layout options', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setWarnings(true);
        try {
            Elicit({
                width: 400, height: 300, axes: false, motion: false,
                schema: hierarchySchema,
                data: { nodes: [], nesting: [] },
                marks: [plot.rect({
                    channels: {
                        x: { field: 'x' }, y: { field: 'y' },
                        width: { field: 'w', scale: null, fit: true },
                        contains: { value: true },
                        dodge: true,
                    },
                })],
                layout: [layout.row({ columns: 3 }), layout.pack({ keep: 'size' })],
            });
            const msgs = spy.mock.calls.map(([m]) => String(m));
            expect(msgs.some((m) => /contains.*no longer a channel/.test(m))).toBe(true);
            expect(msgs.some((m) => /dodge.*no longer a channel/.test(m))).toBe(true);
            expect(msgs.some((m) => /fit: true.*no longer a channel/.test(m))).toBe(true);
            expect(msgs.some((m) => /layout\.row.*columns/.test(m))).toBe(true);
            expect(msgs.some((m) => /keep: "size"/.test(m))).toBe(true);
        } finally {
            setWarnings(false);
            spy.mockRestore();
        }
    });
});
