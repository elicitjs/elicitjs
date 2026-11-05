// @vitest-environment jsdom
// Ports are a CHANNEL on the mark that draws the nodes. These pin the three halves:
// the value forms (`portRolesOf`), the desugaring into a port feature on the host's
// own box, and what `connect` / `rewire` write — the columns the LINK mark's
// channels name, and the side a drop takes.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit } from '../src/index.js';
import { portRolesOf } from '../src/plot/port.js';
import { normalizeSchema } from '../src/core/schema.js';

describe('portRolesOf', () => {
    it('reads every value form', () => {
        expect(portRolesOf(true, true)).toEqual({ top: 'both', right: 'both', bottom: 'both', left: 'both' });
        expect(portRolesOf('right', true)).toEqual({ right: 'both' });
        expect(portRolesOf(['left', 'right'], true)).toEqual({ left: 'both', right: 'both' });
        expect(portRolesOf({ out: ['right'], in: ['left', 'right'] }, true)).toEqual({ right: 'both', left: 'in' });
        expect(portRolesOf(false, true)).toBeNull();
        expect(portRolesOf([], true)).toBeNull();
    });

    it('collapses out/in to both ways on an undirected table', () => {
        expect(portRolesOf({ out: ['right'], in: ['left'] }, false)).toEqual({ right: 'both', left: 'both' });
    });
});

// ── The edits, against a hand-built context ─────────────────────────────────
const spec = normalizeSchema({
    structure: 'network',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            x: { type: 'quantitative', domain: [0, 400] },
            y: { type: 'quantitative', domain: [0, 300] },
        },
        links: {
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
});
const nodes = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 300, y: 100 }, { id: 'c', x: 300, y: 250 }];
const nodeBox = (row) => ({ cx: row.x, cy: row.y, hw: 40, hh: 20 });
const rightToLeft = () => ({ right: 'out', left: 'in' });

/** A connect/rewire context: the pointer, the session and the rules. */
function ctxFor(e, { pointer, links = [], session, nodePorts = rightToLeft, targetChannels, index, node, preview = false }) {
    return {
        schemaSpec: spec,
        tables: { nodes, links },
        table: 'links',
        data: links,
        schema: spec.tables.links.fields,
        datum: index != null ? links[index] : undefined,
        index,
        node: node || null,
        pointer,
        scales: {},
        width: 400,
        height: 300,
        session,
        nodeBox,
        nodePorts,
        targetChannels,
        markChannels: targetChannels || {},
        preview,
        edit: e,
        channels: [],
    };
}
const sides = { sourceSide: { field: 'fromSide' }, targetSide: { field: 'toSide' } };

describe('edit.network.connect', () => {
    const connect = edit.network.connect();

    it('writes the side columns the link mark names', () => {
        const out = connect.apply(ctxFor(connect, {
            pointer: { x: 260, y: 100 },                     // b's left port
            session: { fromIndex: 0, fromSide: 'right' },
            targetChannels: sides,
        }));
        expect(out.at(-1)).toMatchObject({ source: 'a', target: 'b', fromSide: 'right', toSide: 'left' });
    });

    it('writes no side when the link mark names no side column', () => {
        const out = connect.apply(ctxFor(connect, {
            pointer: { x: 260, y: 100 },
            session: { fromIndex: 0, fromSide: 'right' },
            targetChannels: {},
        }));
        // The columns exist (the schema declares them), so they mint as null.
        expect(out.at(-1)).toMatchObject({ source: 'a', target: 'b', fromSide: null, toSide: null });
    });

    it('leaves a body drop unpinned — the link meets the node at its facing port', () => {
        const out = connect.apply(ctxFor(connect, {
            pointer: { x: 310, y: 255 },                     // inside c's body
            session: { fromIndex: 0, fromSide: 'right' },
            targetChannels: sides,
        }));
        expect(out.at(-1)).toMatchObject({ target: 'c', toSide: null });
    });

    it('leaves a body drop unpinned when the node allows every side', () => {
        const out = connect.apply(ctxFor(connect, {
            pointer: { x: 310, y: 255 },
            session: { fromIndex: 0, fromSide: 'right' },
            nodePorts: () => ({ top: 'both', right: 'both', bottom: 'both', left: 'both' }),
            targetChannels: sides,
        }));
        expect(out.at(-1).toSide).toBeNull();
    });

    it('makes nothing from a port a link may not leave by', () => {
        const ctx = ctxFor(connect, {
            pointer: { x: 260, y: 100 },
            session: { fromIndex: 0, fromSide: 'left' },     // an `in` port
            targetChannels: sides,
            preview: true,
        });
        expect(connect.apply(ctx)).toBeUndefined();
    });

    it('refuses a port that only lets links leave', () => {
        const out = connect.apply(ctxFor(connect, {
            pointer: { x: 344, y: 100 },                     // b's right port: `out` only
            session: { fromIndex: 0, fromSide: 'right' },
            targetChannels: sides,
        }));
        // Not a port drop; the pointer is outside b's box too, so nothing lands.
        expect(out).toBeUndefined();
    });

    it('lists only in-ports as drop targets', () => {
        const keys = connect.targets(ctxFor(connect, { pointer: { x: 0, y: 0 } })).map((t) => t.key);
        expect(keys).toHaveLength(3);
        expect(keys.every((k) => k.endsWith('left'))).toBe(true);
    });
});

describe('edit.network.rewire', () => {
    const rewire = edit.network.rewire();
    const links = [{ source: 'a', target: 'b', fromSide: 'right', toSide: 'left' }];
    const end = { channel: 'target', index: 0 };

    it('re-points the end onto another node, pinning the port it lands on', () => {
        const out = rewire.apply(ctxFor(rewire, {
            pointer: { x: 260, y: 250 }, links, index: 0, node: end, targetChannels: sides,
        }));
        expect(out).toMatchObject({ source: 'a', target: 'c', toSide: 'left' });
    });

    it('removes the link when the end is dropped on nothing', () => {
        const out = rewire.apply(ctxFor(rewire, {
            pointer: { x: 200, y: 280 }, links, index: 0, node: end, targetChannels: sides,
        }));
        expect(out).toEqual([]);
    });

    it('frees the end to follow the pointer while aiming', () => {
        const out = rewire.apply(ctxFor(rewire, {
            pointer: { x: 200, y: 280 }, links, index: 0, node: end, targetChannels: sides, preview: true,
        }));
        expect(out).toMatchObject({ source: 'a', target: null });
    });

    it('only claims an end handle, never the link body', () => {
        expect(rewire.when(ctxFor(rewire, { pointer: { x: 0, y: 0 }, links, index: 0, node: { index: 0 } }))).toBe(false);
        expect(rewire.when(ctxFor(rewire, { pointer: { x: 0, y: 0 }, links, index: 0, node: end }))).toBe(true);
    });
});

// ── The channel, mounted ───────────────────────────────────────────────────
describe('a ports channel', () => {
    it('draws ports on the host\'s own box, only on the sides it names', async () => {
        const el = Elicit({
            width: 400, height: 300, axes: false,
            schema: {
                structure: 'network',
                tables: {
                    nodes: {
                        id: { type: 'categorical', key: true },
                        x: { type: 'quantitative', domain: [0, 400] },
                        y: { type: 'quantitative', domain: [0, 300] },
                    },
                    links: { source: { type: 'ref' }, target: { type: 'ref' } },
                },
            },
            scales: { x: { range: [0, 400] }, y: { range: [0, 300] } },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            data: { nodes, links: [] },
            marks: [
                plot.link(),
                plot.point({
                    size: 12,
                    channels: {
                        x: { field: 'x' },
                        y: { field: 'y' },
                        ports: { value: { out: ['right'], in: ['left'] }, edit: edit.network.connect() },
                    },
                }),
            ],
        });
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 0));
        const dots = [...el.querySelectorAll('circle')].filter((c) => c.getAttribute('r') === '12');
        const ports = [...el.querySelectorAll('circle')].filter((c) => c.getAttribute('r') === '5');
        expect(dots).toHaveLength(3);
        expect(ports).toHaveLength(6);
        // Each port sits on its dot's edge: 12px either side of the centre.
        const xs = ports.map((c) => Math.round(+c.getAttribute('cx'))).sort((a, b) => a - b);
        const centres = dots.map((c) => Math.round(+c.getAttribute('cx')));
        for (const x of xs) expect(centres.some((cx) => Math.abs(Math.abs(x - cx) - 12) < 1)).toBe(true);
    });
});

describe('ports on a glyph', () => {
    const schema = {
        structure: 'network',
        tables: {
            nodes: {
                id: { type: 'categorical', key: true },
                x: { type: 'quantitative', domain: [0, 400] },
                y: { type: 'quantitative', domain: [0, 300] },
                valence: { type: 'quantitative', domain: [-1, 1] },
                arousal: { type: 'quantitative', domain: [-1, 1] },
            },
            links: { source: { type: 'ref' }, target: { type: 'ref' } },
        },
    };
    const nodes = [
        { id: 'a', x: 100, y: 150, valence: 0, arousal: 0 },
        { id: 'b', x: 300, y: 150, valence: 0, arousal: 0 },
    ];

    it('puts a face\'s ports on its head, once per face, and docks links there', async () => {
        const el = Elicit({
            width: 400, height: 300,
            axes: false,
            schema,
            scales: { x: { range: [0, 400] }, y: { range: [0, 300] } },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            data: { nodes, links: [{ source: 'a', target: 'b' }] },
            marks: [
                plot.link({ arrow: false }),
                plot.face({
                    size: 30,
                    channels: {
                        x: { field: 'x' },
                        y: { field: 'y' },
                        ports: { value: ['left', 'right'], edit: edit.network.connect() },
                    },
                }),
            ],
        });
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 0));
        const ports = [...el.querySelectorAll('circle[data-channel="port"]')]
            .map((c) => Math.round(+c.getAttribute('cx'))).sort((p, q) => p - q);
        // Two faces, a port either side of each 30px head.
        expect(ports).toEqual([70, 130, 270, 330]);
        // The link meets a's right port and b's left one.
        const body = [...el.querySelectorAll('path')].find((p) => p.getAttribute('stroke') && p.getAttribute('stroke') !== 'none'
            && p.getAttribute('stroke') !== 'transparent');
        expect(body.getAttribute('d')).toMatch(/^M130,150L270,150$/);
    });
});

describe('any mark that draws a shape is a node', () => {
    const schema = {
        structure: 'network',
        tables: {
            nodes: {
                id: { type: 'categorical', key: true },
                x: { type: 'quantitative', domain: [0, 400] },
                y: { type: 'quantitative', domain: [0, 300] },
                label: { type: 'categorical' },
            },
            links: { source: { type: 'ref' }, target: { type: 'ref' } },
        },
    };
    const nodes = [
        { id: 'a', x: 100, y: 150, label: 'Alpha' },
        { id: 'b', x: 300, y: 150, label: 'Beta' },
    ];
    const mount = async (marks) => {
        const el = Elicit({
            width: 400, height: 300, axes: false, schema,
            scales: { x: { range: [0, 400] }, y: { range: [0, 300] } },
            margins: { top: 0, right: 0, bottom: 0, left: 0 },
            data: { nodes, links: [{ source: 'a', target: 'b' }] },
            marks: [plot.link({ arrow: false }), ...marks],
        });
        document.body.appendChild(el);
        await new Promise((r) => setTimeout(r, 0));
        const body = [...el.querySelectorAll('path')].find((p) => p.getAttribute('stroke')
            && p.getAttribute('stroke') !== 'none' && p.getAttribute('stroke') !== 'transparent');
        const ports = [...el.querySelectorAll('circle[data-channel="port"]')]
            .map((c) => Math.round(+c.getAttribute('cx'))).sort((p, q) => p - q);
        return { d: body.getAttribute('d'), ports };
    };
    const xs = { x: { field: 'x' }, y: { field: 'y' } };
    const ports = { value: ['left', 'right'], edit: edit.network.connect() };

    it('an ellipse: met on its radii, ports at its sides', async () => {
        const out = await mount([plot.ellipse({ channels: { ...xs, rx: { value: 30 }, ry: { value: 12 }, ports } })]);
        expect(out.d).toMatch(/^M130,150L270,150$/);
        expect(out.ports).toEqual([70, 130, 270, 330]);
    });

    it('a text mark (an emoji): its measured block is the node', async () => {
        const out = await mount([plot.text({ fontSize: 24, channels: { ...xs, text: { value: '🙂' }, ports } })]);
        expect(out.ports).toHaveLength(4);
        const [l, r] = out.ports;
        expect(r - 100).toBeGreaterThan(0);                       // right of a's centre
        expect(100 - l).toBe(r - 100);                            // centred on it
        const m = /^M([\d.]+),150L([\d.]+),150$/.exec(out.d);
        expect(+m[1]).toBeCloseTo(r, 0);
    });

    it('node(): the dot is the node, not its label', async () => {
        const out = await mount([plot.node({ size: 10, channels: { ...xs, text: { field: 'label' } } })]);
        expect(out.d).toMatch(/^M110,150L290,150$/);
    });

    it('a plain composite puts its ports on its shape, once', async () => {
        const out = await mount([plot.composite({
            channels: { ...xs, ports },
            parts: [plot.text({ dy: -20, channels: { text: { field: 'label' } } }), plot.point({ size: 8 })],
        })]);
        expect(out.ports).toEqual([92, 108, 292, 308]);
    });
});
