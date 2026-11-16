// @vitest-environment jsdom
// Linked hover: the `hovered` state shared by the charts of a dataset, and the
// `others` (mute) and `neighbours` treatments of any state.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { normalizeSchema } from '../src/core/schema.js';
import { neighboursOf } from '../src/core/neighbours.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((c) => { c.destroy(); c.dom().remove(); }); });
const mount = (chart) => { document.body.appendChild(chart.dom()); mounted.push(chart); return chart; };

function captureWarnings(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; }
    return seen;
}

const data = () => ({
    schema: { x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 100] } },
    data: [0, 1, 2].map((x) => ({ x, y: 50 })),
});
// A view-only chart: no edits.
const view = (extra = {}) => ({
    width: 300, height: 200,
    marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
    ...extra,
});
const circles = (chart) => [...chart.dom().querySelectorAll('g.mark-layer circle')];
const circleOf = (chart, i) => circles(chart).find((c) => c.__data__ && c.__data__.index === i);
const outlines = (chart) => chart.dom().querySelectorAll('g.effects-data > *').length;
const faded = (chart) => circles(chart).filter((c) => c.style.opacity !== '' && Number(c.style.opacity) < 1)
    .map((c) => c.__data__.index).sort();
const over = (chart, i) => chart.emit({ type: 'pointerover', node: circleOf(chart, i).__data__ });
const out = (chart, i) => chart.emit({ type: 'pointerout', node: circleOf(chart, i).__data__ });

async function pair(a = view(), b = view({ height: 400 })) {
    const ds = Elicit.dataset(data());
    const A = mount(ds.chart(a));
    const B = mount(ds.chart(b));
    await tick();
    await tick();
    return { ds, A, B };
}

describe('a lone chart', () => {
    it('keeps hover as it was: inert marks do not hover, nothing fades', async () => {
        const chart = mount(Elicit({ ...data(), ...view() }));
        await tick();
        expect(circles(chart).some((c) => c.__data__.hoverable)).toBe(false);
        expect(chart.getHover()).toBe(null);
    });

    it('does not send its hover to the dataset', async () => {
        const chart = mount(Elicit({
            ...data(), width: 300, height: 200,
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
        }));
        await tick();
        over(chart, 1);
        expect(outlines(chart)).toBe(1);
        expect(chart.getHover()).toBe(null);
        expect(faded(chart)).toEqual([]);
    });

    it('highlights and mutes by the same path once link is on', async () => {
        const chart = mount(Elicit({ ...data(), ...view({ effects: { hovered: { link: true } } }) }));
        await tick();
        over(chart, 1);
        expect(chart.getHover()).toBe(1);
        expect(outlines(chart)).toBe(1);
        expect(faded(chart)).toEqual([0, 2]);
    });

    it('paints a hover set from outside when it shows the hover', async () => {
        const chart = mount(Elicit({ ...data(), ...view({ effects: { hovered: { link: 'receive' } } }) }));
        await tick();
        expect(chart.hover(2)).toBe(true);
        expect(outlines(chart)).toBe(1);
        expect(faded(chart)).toEqual([0, 1]);
        chart.hover(null);
        expect(outlines(chart)).toBe(0);
        expect(faded(chart)).toEqual([]);
    });

    it('selected.others mutes the unselected rows, but not a hovered one', async () => {
        const chart = mount(Elicit({
            ...data(), width: 300, height: 200,
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
            effects: { selected: { others: { opacity: 0.2 } } },
        }));
        await tick();
        chart.select(0);
        expect(faded(chart)).toEqual([1, 2]);
        over(chart, 1);
        expect(faded(chart)).toEqual([2]);
        chart.clearSelection();
        out(chart, 1);
        expect(faded(chart)).toEqual([]);
    });
});

describe('two charts on one dataset', () => {
    it('a hover in one shows in the other, mutes the rest, and writes no data', async () => {
        const { ds, A, B } = await pair();
        const seen = [];
        let changes = 0;
        ds.on('hover', (row) => seen.push(row));
        ds.on('change', () => { changes++; });
        const before = ds.getData();
        over(A, 1);
        expect(seen).toEqual([1]);
        expect(ds.getHover()).toBe(1);
        expect(outlines(A)).toBe(1);
        expect(outlines(B)).toBe(1);
        expect(faded(B)).toEqual([0, 2]);
        out(A, 1);
        expect(seen).toEqual([1, null]);
        expect(outlines(B)).toBe(0);
        expect(faded(B)).toEqual([]);
        expect(changes).toBe(0);
        expect(ds.getData()).toEqual(before);
        expect(ds.canUndo()).toBe(false);
    });

    it("link: 'receive' shows the hover and sends none; link: false does neither", async () => {
        const { ds, A, B } = await pair(view({ effects: { hovered: { link: 'receive' } } }), view({ effects: { hovered: { link: false } } }));
        ds.hover(0);
        expect(outlines(A)).toBe(1);
        expect(outlines(B)).toBe(0);
        ds.hover(null);
        over(A, 1);
        expect(ds.getHover()).toBe(null);
        expect(circles(B).some((c) => c.__data__.hoverable)).toBe(false);
    });

    it('only the chart that set the hover clears it by leaving', async () => {
        const { ds, A, B } = await pair();
        over(A, 1);
        out(B, 1);
        expect(ds.getHover()).toBe(1);
        out(A, 1);
        expect(ds.getHover()).toBe(null);
    });

    it('others: false keeps the outline and drops the fade', async () => {
        const { A, B } = await pair(view(), view({ effects: { hovered: { others: false } } }));
        over(A, 2);
        expect(outlines(B)).toBe(1);
        expect(faded(B)).toEqual([]);
        expect(faded(A)).toEqual([0, 1]);
    });

    it("a commit in another chart drops the hover", async () => {
        const { ds, A, B } = await pair(view(), {
            width: 300, height: 200,
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'drag' }) } } })],
        });
        over(A, 1);
        B.control('drag', 0).set(80);
        expect(ds.getHover()).toBe(null);
        expect(outlines(A)).toBe(0);
    });

    it('a press on a hover-only mark is not swallowed', async () => {
        const { ds, A } = await pair({
            width: 300, height: 200,
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } }, edits: [edit.create({ name: 'add' })] })],
        });
        const node = circleOf(A, 0).__data__;
        A.emit({ type: 'click', node, x: 150, y: 20, rawEvent: {} });
        expect(ds.getData().length).toBe(4);
    });
});

describe('neighbours', () => {
    const network = normalizeSchema({
        structure: 'network',
        tables: {
            nodes: { id: { type: 'categorical', key: true }, x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 4] } },
            links: { source: { type: 'ref' }, target: { type: 'ref' } },
        },
    });
    const tables = {
        nodes: ['a', 'b', 'c'].map((id, i) => ({ id, x: i, y: i })),
        links: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
    };
    const keys = (list) => list.map((n) => `${n.table}:${n.index}`).sort();

    it("a node's links and a link's nodes", () => {
        expect(keys(neighboursOf(network, tables, 'nodes', 0))).toEqual(['links:0']);
        expect(keys(neighboursOf(network, tables, 'nodes', 1))).toEqual(['links:0', 'links:1']);
        expect(keys(neighboursOf(network, tables, 'links', 1))).toEqual(['nodes:1', 'nodes:2']);
    });

    it('everything nested inside a hierarchy node', () => {
        const tree = normalizeSchema({
            structure: 'hierarchy',
            tables: {
                nodes: { id: { type: 'categorical', key: true } },
                nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
            },
        });
        const rows = {
            nodes: ['g', 'a', 'b', 'z'].map((id) => ({ id })),
            nesting: [{ child: 'a', parent: 'g' }, { child: 'b', parent: 'a' }],
        };
        const inNodes = neighboursOf(tree, rows, 'nodes', 0).filter((n) => n.table === 'nodes').map((n) => n.index).sort();
        expect(inNodes).toEqual([1, 2]);
    });

    it('lights the links of a hovered node and mutes the other links', async () => {
        const chart = mount(Elicit({
            width: 300, height: 200,
            schema: {
                structure: 'network',
                tables: {
                    nodes: { id: { type: 'categorical', key: true }, x: { type: 'quantitative', domain: [0, 4] }, y: { type: 'quantitative', domain: [0, 4] } },
                    links: { source: { type: 'ref' }, target: { type: 'ref' } },
                },
            },
            data: tables,
            marks: [
                plot.link({ arrow: false }),
                plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
            ],
            effects: { hovered: { neighbours: true, others: { opacity: 0.2 } } },
        }));
        await tick();
        over(chart, 0);
        const linkPaths = [...chart.dom().querySelectorAll('g.mark-layer path')]
            .filter((p) => p.__data__ && p.__data__.index != null && !p.__data__.hit);
        const mutedLinks = linkPaths.filter((p) => Number(p.style.opacity) === 0.2).map((p) => p.__data__.index);
        expect([...new Set(mutedLinks)]).toEqual([1]);
        expect(faded(chart)).toEqual([1, 2]);
    });

    it('warns on a dataset that links no rows', () => {
        const warnings = captureWarnings(() => Elicit({ ...data(), ...view({ effects: { hovered: { neighbours: true } } }) }).destroy());
        expect(warnings.some((w) => w.includes('effects.hovered.neighbours') && w.includes('network and hierarchy'))).toBe(true);
    });
});

describe('map chrome', () => {
    it('a basemap shape is not a row: no state reaches it', async () => {
        const square = (x) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
        const shapes = { type: 'FeatureCollection', features: [square(0), square(1), square(2)] };
        const chart = mount(Elicit({
            width: 300, height: 200,
            schema: { lon: { type: 'quantitative', domain: [0, 3] }, lat: { type: 'quantitative', domain: [0, 1] } },
            data: [{ lon: 0.5, lat: 0.5 }, { lon: 1.5, lat: 0.5 }],
            projection: { type: 'mercator', domain: shapes },
            marks: [
                plot.geoBasemap({ geojson: shapes }),
                plot.geoPoint({ channels: { lon: { field: 'lon' }, lat: { field: 'lat' } } }),
            ],
            effects: { hovered: { link: true } },
        }));
        await tick();
        const base = [...chart.dom().querySelectorAll('path')].filter((p) => p.__data__ && p.__data__.background);
        expect(base.length).toBe(3);
        expect(base.every((p) => p.__data__.index == null && !p.__data__.hoverable)).toBe(true);
        chart.hover(1);
        expect(outlines(chart)).toBe(1);
        expect(base.every((p) => p.style.opacity === '')).toBe(true);
        chart.select(1);
        expect(outlines(chart)).toBe(1);
    });
});

describe('effect settings', () => {
    it('warns on link outside hovered and on others.outline', () => {
        const warnings = captureWarnings(() => Elicit({
            ...data(), ...view({ effects: { selected: { link: true, others: { outline: { width: 2 } } } } }),
        }).destroy());
        expect(warnings.some((w) => w.includes('effects.selected.link'))).toBe(true);
        expect(warnings.some((w) => w.includes('effects.selected.others.outline'))).toBe(true);
    });
});
