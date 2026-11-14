// @vitest-environment jsdom
// Mark and renderer bugs from the audit: each test fails without its fix.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, elements, setWarnings } from '../src/index.js';
import { hitTest } from '../src/edit/pick.js';
import { normalizeSchema } from '../src/core/schema.js';
import { resolveTheme } from '../src/core/theme.js';
import { paintScene } from '../src/renderers/canvas/draw.js';
import { bindCanvasEvents } from '../src/renderers/canvas/events.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

// Inner plot 300x200: value v sits at y = 200 - 2v; column x sits at x = 100·x.
const yOf = (v) => 200 - 2 * v;
const frame = { width: 320, height: 220, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 } };
const xy = { x: { type: 'quantitative', domain: [0, 3] }, y: { type: 'quantitative', domain: [0, 100] } };

/** Mount a chart and wait for its first render. */
async function mount(spec) {
    const el = Elicit({ ...frame, ...spec });
    document.body.appendChild(el);
    await tick();
    return el;
}
/** The scene nodes bound to the drawn elements matching `selector`. */
const nodesOf = (el, selector) => [...el.querySelectorAll(selector)].map((n) => n.__data__).filter(Boolean);

describe('area span edits', () => {
    it('a mark-level edit on one edge does not move the other', async () => {
        const el = await mount({
            schema: { ...xy, lo: { type: 'quantitative', domain: [0, 100] }, hi: { type: 'quantitative', domain: [0, 100] } },
            data: [0, 1, 2, 3].map((x) => ({ x, lo: 30, hi: 70 })),
            marks: [plot.areaY({
                channels: { x: { field: 'x' }, y1: { field: 'lo' }, y2: { field: 'hi' } },
                edits: [edit.move({ channels: ['y1'] }), edit.move({ channels: ['y2'] })],
            })],
        });
        const node = { ...nodesOf(el, 'circle').find((n) => n.channel === 'y1' && n.index === 1) };
        el.emit({ type: 'dragstart', node, x: 100, y: yOf(30) });
        el.emit({ type: 'drag', node, x: 100, y: yOf(20) });
        el.emit({ type: 'dragend', node, x: 100, y: yOf(20) });
        const row = el.getData()[1];
        expect(row.lo).toBeCloseTo(20);
        expect(row.hi).toBe(70);
    });
});

/** Run `fn` with warnings on and return what was warned. */
function warningsOf(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; setWarnings(false); }
    return seen;
}

describe('trend handles', () => {
    it('take handleColor', async () => {
        const el = await mount({
            schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ intercept: 2, slope: 0.5 }],
            marks: [plot.trend({ handles: true, handleColor: '#ff0000', channels: { intercept: { field: 'intercept' }, slope: { field: 'slope' } } })],
        });
        const fills = nodesOf(el, 'circle').map((n) => n.fill);
        expect(fills.length).toBeGreaterThan(0);
        expect(new Set(fills)).toEqual(new Set(['#ff0000']));
    });
});

const geoFrame = {
    projection: { type: 'mercator', domain: { type: 'LineString', coordinates: [[-10, -10], [10, 10]] } },
    schema: { coordinates: { type: 'categorical' }, lon: { type: 'quantitative' }, lat: { type: 'quantitative' } },
};
const route = [{ coordinates: [[-5, -5], [0, 5], [5, -5]] }];

describe('geoLine vertices', () => {
    const vertices = (el) => nodesOf(el, 'circle').filter((n) => n.channel === 'vertex');
    it('draw none under handles: false', async () => {
        const el = await mount({ ...geoFrame, data: route, marks: [plot.geoLine({ handles: false, showVertices: true, channels: { coordinates: { field: 'coordinates', scale: null } } })] });
        expect(vertices(el).length).toBe(0);
    });
    it('stay grabbable but unpainted under handles: "hit"', async () => {
        const el = await mount({ ...geoFrame, data: route, marks: [plot.geoLine({ handles: 'hit', showVertices: true, channels: { coordinates: { field: 'coordinates', scale: null } } })] });
        const vs = vertices(el);
        expect(vs.length).toBe(3);
        expect(vs.every((n) => n.fill === 'transparent' && n.stroke === 'none')).toBe(true);
    });
    it('ring with the theme handle stroke', async () => {
        const el = await mount({ ...geoFrame, theme: { handleStroke: '#123456' }, data: route, marks: [plot.geoLine({ showVertices: true, channels: { coordinates: { field: 'coordinates', scale: null } } })] });
        expect(vertices(el).every((n) => n.stroke === '#123456')).toBe(true);
    });
    it('follow the same contract when connecting rows', async () => {
        const rows = [{ lon: -5, lat: -5 }, { lon: 5, lat: 5 }];
        const spec = (o) => ({ ...geoFrame, theme: { handleStroke: '#123456' }, data: rows, marks: [plot.geoLine({ showVertices: true, ...o, channels: { lon: { field: 'lon' }, lat: { field: 'lat' } } })] });
        expect(nodesOf(await mount(spec({})), 'circle').every((n) => n.stroke === '#123456')).toBe(true);
        expect(nodesOf(await mount(spec({ handles: false })), 'circle').length).toBe(0);
    });
});

describe('a derived channel gets (d, i, data)', () => {
    /** A fill fn that records its arguments. */
    const spy = () => {
        const calls = [];
        return { calls, fn: (d, i, data) => { calls.push([i, data]); return '#abcdef'; } };
    };
    const complete = (calls) => calls.length > 0 && calls.every(([i, data]) => typeof i === 'number' && Array.isArray(data));
    const square = { type: 'Polygon', coordinates: [[[-5, -5], [-5, 5], [5, 5], [5, -5], [-5, -5]]] };

    it('geoPolygon', async () => {
        const s = spy();
        await mount({ ...geoFrame, schema: { geometry: { type: 'categorical' } }, data: [{ geometry: square }], marks: [plot.geoPolygon({ fill: s.fn, channels: { geometry: { field: 'geometry', scale: null } } })] });
        expect(complete(s.calls)).toBe(true);
    });
    it('geoLine, per row and connecting rows', async () => {
        const a = spy();
        await mount({ ...geoFrame, data: route, marks: [plot.geoLine({ stroke: a.fn, channels: { coordinates: { field: 'coordinates', scale: null } } })] });
        expect(complete(a.calls)).toBe(true);
        const b = spy();
        await mount({ ...geoFrame, data: [{ lon: -5, lat: -5 }, { lon: 5, lat: 5 }], marks: [plot.geoLine({ stroke: b.fn, channels: { lon: { field: 'lon' }, lat: { field: 'lat' } } })] });
        expect(complete(b.calls)).toBe(true);
    });
    it('geoRect', async () => {
        const s = spy();
        await mount({
            ...geoFrame, schema: { west: { type: 'quantitative' }, south: { type: 'quantitative' }, east: { type: 'quantitative' }, north: { type: 'quantitative' } },
            data: [{ west: -5, south: -5, east: 5, north: 5 }],
            marks: [plot.geoRect({ fill: s.fn, channels: { west: { field: 'west', scale: null }, south: { field: 'south', scale: null }, east: { field: 'east', scale: null }, north: { field: 'north', scale: null } } })],
        });
        expect(complete(s.calls)).toBe(true);
    });
    it('dotStack position', async () => {
        const calls = [];
        await mount({
            schema: { k: { type: 'categorical', domain: ['a', 'b'] } },
            data: [{ k: 'a' }, { k: 'a' }, { k: 'b' }],
            marks: [plot.dotStackY({ ghost: false, channels: { x: { fn: (d, i, data) => { calls.push([i, data]); return d.k === 'a' ? 50 : 150; } } } })],
        });
        expect(complete(calls)).toBe(true);
    });
});

describe('tick', () => {
    it('draws nothing for a row with no category', async () => {
        const el = await mount({
            schema: { k: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', v: 40 }, { k: null, v: 80 }],
            marks: [plot.tickY({ channels: { x: { field: 'k' }, y: { field: 'v' } } })],
        });
        expect(nodesOf(el, 'line').filter((n) => n.data).map((n) => n.index)).toEqual([0]);
    });
});

describe('axis per-tick fill', () => {
    it('falls back to the theme where the function returns nothing', async () => {
        const el = await mount({
            axes: false,
            schema: xy, data: [{ x: 1, y: 50 }],
            elements: [elements.axisX({ tickValues: [0, 1, 2], fill: (v) => (v === 1 ? '#ff0000' : undefined) })],
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        const fills = nodesOf(el, 'text').filter((n) => n.background).map((n) => n.fill);
        const themed = resolveTheme().axis.labelFill;
        expect(fills).toEqual([themed, '#ff0000', themed]);
    });
});

describe('axisRadial title', () => {
    it('takes the theme label colour', async () => {
        const el = await mount({
            theme: { axis: { labelFill: '#123456' } },
            schema: { v: { type: 'quantitative', domain: [0, 100] } }, data: [{ v: 40 }],
            elements: [elements.axisRadial({ title: 'Speed' })],
            marks: [plot.needle({ channels: { theta: { field: 'v' } } })],
        });
        const title = nodesOf(el, 'text').find((n) => n.text === 'Speed');
        expect(title.fill).toBe('#123456');
    });
});

describe('needle body', () => {
    it('carries its outline, so a geometric hit test finds it', async () => {
        const el = await mount({
            schema: { v: { type: 'quantitative', domain: [0, 100] } }, data: [{ v: 40 }],
            marks: [plot.needle({ baseWidth: 12, tipWidth: 12, channels: { theta: { field: 'v', edit: edit.rotate() } } })],
        });
        const body = nodesOf(el, 'path').find((n) => n.data && n.d);
        expect(body.polygon).toBe(true);
        const mid = [0, 1].map((k) => body.points.reduce((sum, p) => sum + p[k], 0) / body.points.length);
        const grabbable = { ...body, editable: true, pointerEvents: undefined };
        expect(hitTest([grabbable], mid[0], mid[1])).toBe(grabbable);
    });
});

describe('link without a node key', () => {
    it('does not recommend an option link() lacks', () => {
        const schema = normalizeSchema({
            structure: 'network',
            tables: {
                nodes: { id: { type: 'categorical' }, x: { type: 'quantitative' }, y: { type: 'quantitative' } },
                links: { role: 'links', fields: { source: { type: 'ref' }, target: { type: 'ref' } } },
            },
        });
        const links = [{ source: 'a', target: 'b' }];
        const seen = warningsOf(() => plot.link().build(links, {}, 400, 300, { tables: { nodes: [], links }, schema, table: 'links' }));
        const msg = seen.find((m) => /identifies a node/.test(m));
        expect(msg).toBeTruthy();
        expect(msg).not.toMatch(/link\(\{ key/);
    });
});

describe('label typography on a preset', () => {
    const type = { fontWeight: 'bold', fontStyle: 'italic', fontFamily: 'serif' };
    const labelOf = (el) => nodesOf(el, 'text').find((n) => n.text === 'hello');
    it('sticker gives it to the label', async () => {
        const el = await mount({
            schema: xy, data: [{ x: 1, y: 50, t: 'hello' }],
            marks: [plot.sticker({ ...type, channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 't' } } })],
        });
        expect(labelOf(el)).toMatchObject(type);
    });
    it('node gives it to the label', async () => {
        const el = await mount({
            schema: xy, data: [{ x: 1, y: 50, t: 'hello' }],
            marks: [plot.node({ ...type, channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 't' } } })],
        });
        expect(labelOf(el)).toMatchObject(type);
    });
});

describe('canvas renderer', () => {
    it('reports hover for a hoverable node', () => {
        const canvas = document.createElement('canvas');
        const node = { type: 'circle', cx: 50, cy: 50, r: 10, featureId: 'f', index: 0, hoverable: true };
        const events = [];
        const ctx = { scene: { children: [node] }, width: 200, height: 200, margins: { left: 0, top: 0 }, planeOnTop: false, onEvent: (e) => events.push(e) };
        bindCanvasEvents(canvas, () => ctx);
        const move = (x, y) => canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
        move(50, 50);
        expect(events.map((e) => e.type)).toEqual(['pointerover']);
        expect(events[0].node).toBe(node);
        expect(canvas.style.cursor).toBe('default');
        move(150, 150);
        expect(events.map((e) => e.type)).toEqual(['pointerover', 'pointerout']);
    });

    it('paints background paths in scene order', () => {
        const hadPath2D = 'Path2D' in globalThis;
        if (!hadPath2D) globalThis.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
        const strokes = [];
        const ctx = new Proxy({ strokeStyle: null }, {
            get: (t, k) => (k in t ? t[k] : (k === 'stroke' ? () => strokes.push(t.strokeStyle) : () => {})),
            set: (t, k, v) => { t[k] = v; return true; },
        });
        try {
            paintScene(ctx, [
                { type: 'path', d: 'M0,0L10,10', stroke: 'red', background: true },
                { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10, stroke: 'blue', background: true },
            ], { images: new Map(), requestRepaint: () => {} });
        } finally {
            if (!hadPath2D) delete globalThis.Path2D;
        }
        expect(strokes).toEqual(['red', 'blue']);
    });
});

describe('a tip over a curved link', () => {
    it('finds the link from its body', async () => {
        const el = await mount({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 },
            scales: { x: { range: [0, 400] }, y: { range: [0, 300] } },
            schema: {
                structure: 'network',
                tables: {
                    nodes: { id: { type: 'categorical', key: true }, x: { type: 'quantitative', domain: [0, 400] }, y: { type: 'quantitative', domain: [0, 300] } },
                    links: { role: 'links', fields: { source: { type: 'ref' }, target: { type: 'ref' }, why: { type: 'categorical' } } },
                },
            },
            data: { nodes: [{ id: 'a', x: 100, y: 150 }, { id: 'b', x: 300, y: 150 }], links: [{ source: 'a', target: 'b', why: 'because' }] },
            marks: [
                plot.link({ curve: 'arc', curvature: 0.6, tip: ['why'] }),
                plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
            ],
        });
        const body = nodesOf(el, 'path').find((n) => n.d && !n.hit && n.data && n.data.why);
        const hit = nodesOf(el, 'path').find((n) => n.hit);
        const [mx, my] = hit.points[Math.floor(hit.points.length / 2)];
        expect(Math.abs(my - 150)).toBeGreaterThan(20); // well off the chord
        el.emit({ type: 'pointermove', x: mx, y: my });
        const texts = [...el.querySelectorAll('.guide-front-layer text')].map((t) => t.textContent);
        expect(texts.some((t) => /because/.test(t))).toBe(true);
    });
});
