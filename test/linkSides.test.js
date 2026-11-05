// `link` reads a side from its OWN channels: `sourceSide: { field }` names the
// column, and a null cell slides. The node box comes from the box rule the engine
// hands over (`context.nodeBox`), as it would from the mark drawing the nodes.
import { describe, it, expect } from 'vitest';
import { plot } from '../src/index.js';
import { normalizeSchema } from '../src/core/schema.js';

const schema = normalizeSchema({
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
const identity = { encode: (v, fallback) => (typeof v === 'number' ? v : fallback) };
const scales = { x: identity, y: identity };
const nodes = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 100, y: 250 }];
// An 80×40 box about each node, as a rect drawing the nodes would declare.
const nodeBox = (row) => ({ cx: row.x, cy: row.y, hw: 40, hh: 20 });

const bodyOf = (links, channels) => {
    const mark = plot.link({ curve: 'orthogonal', cornerRadius: 0, channels });
    const out = mark.build(links, scales, 400, 300, { tables: { nodes, links }, schema, table: 'links', nodeBox });
    return out.filter((n) => n.type === 'path' && !n.hit && n.points)[0].points;
};
const sides = { sourceSide: { field: 'fromSide' }, targetSide: { field: 'toSide' } };

describe('link sides', () => {
    it('leaves and enters the edges its side channels name', () => {
        const pts = bodyOf([{ source: 'a', target: 'b', fromSide: 'right', toSide: 'left' }], sides);
        // The table is directed, so the target end stops the arrowhead (6px) short.
        expect(pts[0]).toEqual([140, 100]);                      // a's right edge
        expect(pts[pts.length - 1]).toEqual([54, 250]);          // b's left edge, less the arrow
    });

    it('slides an end whose cell is null', () => {
        const pts = bodyOf([{ source: 'a', target: 'b', fromSide: null, toSide: null }], sides);
        expect(pts[0]).toEqual([100, 120]);                      // a's bottom, straight down
        expect(pts[pts.length - 1]).toEqual([100, 224]);         // b's top, less the arrow
        expect(pts).toHaveLength(2);
    });

    it('records nothing and slides when no channel names a side column', () => {
        const pts = bodyOf([{ source: 'a', target: 'b', fromSide: 'right', toSide: 'left' }]);
        expect(pts[0]).toEqual([100, 120]);
    });

    it('meets a node with ports AT a port: an unpinned end takes the usable port facing the other end', () => {
        // a leaves right only; b takes links in on its top and left.
        const nodePorts = (row) => (row.id === 'a' ? { right: 'out' } : { top: 'in', left: 'in' });
        const mark = plot.link({ curve: 'orthogonal', cornerRadius: 0, inset: 10, channels: sides });
        const links = [{ source: 'a', target: 'b', fromSide: null, toSide: null }];
        const out = mark.build(links, scales, 400, 300, { tables: { nodes, links }, schema, table: 'links', nodeBox, nodePorts });
        const pts = out.filter((n) => n.type === 'path' && !n.hit && n.points)[0].points;
        // a's right port, with no buffer: a port is where the link connects.
        expect(pts[0]).toEqual([140, 100]);
        // b's top port faces a (above it); the arrowhead (6px) is the only gap.
        expect(pts[pts.length - 1]).toEqual([100, 224]);
    });
});

describe('the connection buffer', () => {
    it('stops a link `inset` px off the shape of a node without ports', () => {
        const mark = plot.link({ curve: 'line', arrow: false, inset: 5 });
        const links = [{ source: 'a', target: 'b' }];
        const out = mark.build(links, scales, 400, 300, { tables: { nodes, links }, schema, table: 'links', nodeBox });
        const body = out.filter((n) => n.type === 'path' && !n.hit)[0];
        const pts = body.points || [];
        // a's bottom edge is y=120, b's top edge y=230: 5px off each.
        expect(pts[0][1]).toBeCloseTo(125, 5);
        expect(pts[pts.length - 1][1]).toBeCloseTo(225, 5);
    });

    it('meets a round node on its circle, not the corner of its square', () => {
        const dots = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 200, y: 200 }];
        const roundBox = (row) => ({ cx: row.x, cy: row.y, hw: 10, hh: 10, round: true });
        const mark = plot.link({ curve: 'line', arrow: false, inset: 3, curvature: 0 });
        const links = [{ source: 'a', target: 'b' }];
        const out = mark.build(links, scales, 400, 300, { tables: { nodes: dots, links }, schema, table: 'links', nodeBox: roundBox });
        const pts = out.filter((n) => n.type === 'path' && !n.hit)[0].points;
        expect(Math.hypot(pts[0][0] - 100, pts[0][1] - 100)).toBeCloseTo(13, 5);
    });
});

