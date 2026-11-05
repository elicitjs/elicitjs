// What a links table ALLOWS — the four NetworkX kinds plus self-loops — is the
// schema's statement (`directed`, `multi`, `selfLoops` on the links table), and
// `connect` / `rewire` read it rather than taking an option each. A loop is drawn
// docked on its node: a teardrop off one edge, or round the node between two.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { plot, edit, setWarnings } from '../src/index.js';
import { normalizeSchema, denormalizeSchema, linkRulesOf, validateTables } from '../src/core/schema.js';
import { loopSides } from '../src/plot/linkRouter.js';

const schemaOf = (facts) => normalizeSchema({
    structure: 'network',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            x: { type: 'quantitative', domain: [0, 400] },
            y: { type: 'quantitative', domain: [0, 300] },
        },
        links: { role: 'links', ...facts, fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
    },
});

describe('link facts on the schema', () => {
    it('keeps multi and selfLoops, and hands them back out', () => {
        const spec = schemaOf({ directed: true, multi: true, selfLoops: true });
        expect(linkRulesOf(spec)).toEqual({ multi: true, selfLoops: true });
        const out = denormalizeSchema(spec);
        expect(out.tables.links).toMatchObject({ directed: true, multi: true, selfLoops: true });
    });

    it('allows neither when unstated', () => {
        expect(linkRulesOf(schemaOf({}))).toEqual({ multi: false, selfLoops: false });
    });

    describe('seed checks', () => {
        let warned;
        beforeEach(() => { setWarnings(true); warned = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
        afterEach(() => { warned.mockRestore(); setWarnings(false); });
        const messages = () => warned.mock.calls.map((c) => c.join(' '));
        const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }];

        it('reports a parallel pair or a loop only against an explicit false', () => {
            const links = [{ source: 'a', target: 'b' }, { source: 'a', target: 'b' }, { source: 'a', target: 'a' }];
            validateTables(schemaOf({}), { nodes, links });
            expect(messages().filter((m) => /multi|selfLoops/.test(m))).toEqual([]);
            validateTables(schemaOf({ multi: false, selfLoops: false }), { nodes, links });
            expect(messages().some((m) => m.includes('multi: false'))).toBe(true);
            expect(messages().some((m) => m.includes('selfLoops: false'))).toBe(true);
        });

        it('counts a mirror as the same pair on an undirected table', () => {
            const links = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }];
            validateTables(schemaOf({ directed: true, multi: false }), { nodes, links });
            expect(messages().some((m) => m.includes('multi: false'))).toBe(false);
            validateTables(schemaOf({ directed: false, multi: false }), { nodes, links });
            expect(messages().some((m) => m.includes('multi: false'))).toBe(true);
        });
    });
});

// ── The gestures ─────────────────────────────────────────────────────────────
const nodes = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 300, y: 100 }];
const nodeBox = (row) => ({ cx: row.x, cy: row.y, hw: 40, hh: 20 });
const allSides = () => ({ top: 'both', right: 'both', bottom: 'both', left: 'both' });

function ctxFor(spec, e, { pointer, links = [], session, index, node, preview = false, nodePorts = allSides }) {
    return {
        schemaSpec: spec, tables: { nodes, links }, table: 'links', data: links,
        schema: spec.tables.links.fields, datum: index != null ? links[index] : undefined,
        index, node: node || null, pointer, scales: {}, width: 400, height: 300,
        session, nodeBox, nodePorts, targetChannels: {}, markChannels: {}, preview, edit: e, channels: [],
    };
}

describe('connect and rewire follow the table', () => {
    const connect = edit.network.connect();
    const rewire = edit.network.rewire();
    const ab = [{ source: 'a', target: 'b' }];
    // a's right port to b's left port.
    const fromA = { fromIndex: 0, fromSide: 'right', fromPoint: { x: 140, y: 100 } };
    const toB = { x: 260, y: 100 };

    it('refuses a second link between one pair unless the table is multi', () => {
        expect(connect.apply(ctxFor(schemaOf({ directed: true }), connect, { pointer: toB, links: ab, session: fromA }))).toBeUndefined();
        const out = connect.apply(ctxFor(schemaOf({ directed: true, multi: true }), connect, { pointer: toB, links: ab, session: fromA }));
        expect(out).toHaveLength(2);
        expect(out[1]).toMatchObject({ source: 'a', target: 'b' });
    });

    it('refuses the mirror on an undirected table unless it is multi', () => {
        const fromB = { fromIndex: 1, fromSide: 'left', fromPoint: { x: 260, y: 100 } };
        const toA = { x: 140, y: 100 };
        expect(connect.apply(ctxFor(schemaOf({ directed: false }), connect, { pointer: toA, links: ab, session: fromB }))).toBeUndefined();
        expect(connect.apply(ctxFor(schemaOf({ directed: false, multi: true }), connect, { pointer: toA, links: ab, session: fromB }))).toHaveLength(2);
    });

    it('rewires onto the other end\'s node only with loops allowed', () => {
        const links = [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }];
        const sourceEnd = { index: 1, channel: 'source' };
        const onA = { x: 100, y: 100 };
        // Without loops, a's body is no landing for b→a's source: dropped on nothing.
        expect(rewire.apply(ctxFor(schemaOf({ directed: true }), rewire, { pointer: onA, links, index: 1, node: sourceEnd })))
            .toEqual([links[0]]);
        expect(rewire.apply(ctxFor(schemaOf({ directed: true, selfLoops: true }), rewire, { pointer: onA, links, index: 1, node: sourceEnd })))
            .toMatchObject({ source: 'a', target: 'a' });
    });

    it('rewires onto an existing pair only on a multi table', () => {
        // Move the loop a→a's target onto b: a second a→b.
        const links = [{ source: 'a', target: 'b' }, { source: 'a', target: 'a' }];
        const targetEnd = { index: 1, channel: 'target' };
        const onB = { x: 300, y: 100 };
        expect(rewire.apply(ctxFor(schemaOf({ directed: true, selfLoops: true }), rewire, { pointer: onB, links, index: 1, node: targetEnd })))
            .toBeUndefined();
        expect(rewire.apply(ctxFor(schemaOf({ directed: true, selfLoops: true, multi: true }), rewire, { pointer: onB, links, index: 1, node: targetEnd })))
            .toMatchObject({ source: 'a', target: 'b' });
    });

    describe('a loop by connect', () => {
        const spec = schemaOf({ directed: true, selfLoops: true });
        it('lands on another port of the node it started from', () => {
            const out = connect.apply(ctxFor(spec, connect, { pointer: { x: 100, y: 80 }, session: fromA }));
            expect(out[0]).toMatchObject({ source: 'a', target: 'a' });
        });

        it('never on the port it started from: a click is not a loop', () => {
            expect(connect.apply(ctxFor(spec, connect, { pointer: { x: 140, y: 100 }, session: fromA }))).toBeUndefined();
        });

        it('on its body only once the pointer has left the press', () => {
            const near = { x: 136, y: 100 };
            expect(connect.apply(ctxFor(spec, connect, { pointer: near, session: fromA, nodePorts: null }))).toBeUndefined();
            const far = { x: 110, y: 100 };
            expect(connect.apply(ctxFor(spec, connect, { pointer: far, session: fromA, nodePorts: null }))[0])
                .toMatchObject({ source: 'a', target: 'a' });
        });

        it('not at all unless the table allows loops', () => {
            const out = connect.apply(ctxFor(schemaOf({ directed: true }), connect, { pointer: { x: 100, y: 80 }, session: fromA }));
            expect(out).toBeUndefined();
        });
    });
});

// ── Drawing a loop ───────────────────────────────────────────────────────────
describe('loopSides', () => {
    it('spreads loops over the edges a node allows, then nests', () => {
        expect(loopSides(null, null, null, null, 0)).toEqual({ out: 'top', in: 'top', nest: 0 });
        expect(loopSides(null, null, null, null, 1)).toEqual({ out: 'right', in: 'right', nest: 0 });
        expect(loopSides(null, null, null, null, 4)).toEqual({ out: 'top', in: 'top', nest: 1 });
        expect(loopSides(['right'], ['right'], null, null, 1)).toEqual({ out: 'right', in: 'right', nest: 1 });
    });

    it('goes out by an out edge and back by the nearest in edge', () => {
        expect(loopSides(['right'], ['left'], null, null, 0)).toEqual({ out: 'right', in: 'left', nest: 0 });
        expect(loopSides(['right'], ['bottom', 'left'], null, null, 0)).toEqual({ out: 'right', in: 'bottom', nest: 0 });
    });

    it('keeps a pinned edge', () => {
        expect(loopSides(null, null, 'left', null, 0)).toEqual({ out: 'left', in: 'left', nest: 0 });
    });
});

describe('a loop docks on its node', () => {
    const spec = schemaOf({ directed: true, selfLoops: true });
    const identity = { encode: (v, fallback) => (typeof v === 'number' ? v : fallback) };
    const scales = { x: identity, y: identity };
    const build = (links, nodePorts) => plot.link({ arrow: false })
        .build(links, scales, 400, 300, { tables: { nodes, links }, schema: spec, table: 'links', nodeBox, nodePorts })
        .filter((n) => n.type === 'path' && !n.hit);

    it('leaves and returns by the top edge, outside the box', () => {
        const [body] = build([{ source: 'a', target: 'a' }]);
        const m = /^M([-\d.]+),([-\d.]+)C.* ([-\d.]+),([-\d.]+)$/.exec(body.d);
        expect(+m[2]).toBe(80);                                  // a's top edge
        expect(+m[4]).toBe(80);
        expect(+m[1]).toBeLessThan(+m[3]);                       // out on the left, back on the right
    });

    it('takes a different edge for a second loop on the node', () => {
        const [first, second] = build([{ source: 'a', target: 'a' }, { source: 'a', target: 'a' }]);
        expect(first.d).not.toEqual(second.d);
        expect(+/^M([-\d.]+)/.exec(second.d)[1]).toBe(140);       // a's right edge
    });

    it('goes round the node from an out port to an in port', () => {
        const [body] = build([{ source: 'a', target: 'a' }], () => ({ right: 'out', left: 'in' }));
        const pts = body.points;
        expect(pts[0]).toEqual([140, 100]);                      // the right port
        expect(pts[pts.length - 1]).toEqual([60, 100]);          // the left port
        expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(80);  // over the top
    });
});
