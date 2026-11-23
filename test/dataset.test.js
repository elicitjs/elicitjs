// @vitest-environment jsdom
// The public surface of a dataset and its chart: `Elicit.dataset(spec).chart(spec)`,
// and `Elicit(spec)` as the one-call form of the same thing.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, edit, constraints, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((c) => { c.destroy(); c.dom().remove(); }); });

function mount(chart) {
    document.body.appendChild(chart.dom());
    mounted.push(chart);
    return chart;
}

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
const view = () => ({
    width: 300, height: 200,
    marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move({ name: 'drag' }) } } })],
});

const DATASET_METHODS = [
    'getData', 'getSchema', 'setData', 'setDomain', 'undo', 'redo', 'canUndo', 'canRedo',
    'getSelection', 'getSelectionAll', 'select', 'toggleSelection', 'selectAll', 'selectWhere', 'clearSelection',
    'hover', 'getHover',
];

describe('Elicit.dataset(spec).chart(spec)', () => {
    it('renders and edits', async () => {
        const ds = Elicit.dataset(data());
        const chart = mount(ds.chart(view()));
        await tick();
        expect(chart.dom().querySelectorAll('circle').length).toBe(3);
        chart.control('drag', 1).set(80);
        expect(ds.getData()[1].y).toBeCloseTo(80, 0);
        expect(ds.canUndo()).toBe(true);
        ds.undo();
        expect(ds.getData()[1].y).toBe(50);
    });

    it('carries the dataset methods as the same functions', () => {
        const ds = Elicit.dataset(data());
        const chart = ds.chart(view());
        expect(chart.dataset).toBe(ds);
        for (const m of DATASET_METHODS) expect(chart[m]).toBe(ds[m]);
    });

    it('dom() returns the container, and the chart is not a node', () => {
        const chart = Elicit({ ...data(), ...view() });
        expect(chart.dom()).toBeInstanceOf(HTMLDivElement);
        expect(chart.dom()).toBe(chart.dom());
        expect(chart instanceof Node).toBe(false);
        expect(chart.dataset.getData()).toEqual(chart.getData());
    });

    it('forwards change and select to the dataset, keeps stage on the chart', async () => {
        const ds = Elicit.dataset(data());
        const chart = mount(ds.chart(view()));
        await tick();
        const seen = [];
        chart.on('change', () => seen.push('change'));
        chart.on('select', () => seen.push('select'));
        chart.on('stage', () => seen.push('stage'));
        ds.setDomain('y', [0, 200]);
        ds.select(0);
        chart.setStage(1);
        // A stage change clears the shared selection, which `select` hears.
        expect(seen).toEqual(['change', 'select', 'select', 'stage']);
        const warnings = captureWarnings(() => ds.on('stage', () => {}));
        expect(warnings.some((w) => w.includes('on("stage")'))).toBe(true);
        expect(chart.getSchema().y.domain).toEqual([0, 200]);
    });

    it('setData re-renders the chart and clears history', async () => {
        const ds = Elicit.dataset(data());
        const chart = mount(ds.chart(view()));
        await tick();
        chart.control('drag', 0).set(80);
        ds.setData([{ x: 0, y: 10 }, { x: 4, y: 90 }]);
        expect(chart.getData()).toEqual([{ x: 0, y: 10 }, { x: 4, y: 90 }]);
        expect(ds.canUndo()).toBe(false);
        expect(chart.dom().querySelectorAll('circle').length).toBe(2);
    });

    it('warns on a dataset key passed to ds.chart(), naming Elicit.dataset', () => {
        const ds = Elicit.dataset(data());
        const warnings = captureWarnings(() => ds.chart({ ...view(), constraints: [] }));
        expect(warnings.some((w) => w.includes('dataset.chart({ constraints') && w.includes('Elicit.dataset'))).toBe(true);
    });

    it('warns on a chart key or an unknown key passed to Elicit.dataset()', () => {
        const warnings = captureWarnings(() => Elicit.dataset({ ...data(), marks: [], colour: 'red' }));
        expect(warnings.some((w) => w.includes('Elicit.dataset({ marks') && w.includes('dataset.chart'))).toBe(true);
        expect(warnings.some((w) => w.includes('Elicit.dataset({ colour') && w.includes('ignored'))).toBe(true);
    });

    it('takes both key sets on Elicit(spec) without a warning', () => {
        const warnings = captureWarnings(() => Elicit({ ...data(), ...view(), constraints: [], onChange: () => {} }));
        expect(warnings.filter((w) => w.includes('spec') || w.includes('ignored'))).toEqual([]);
    });

    it('destroy() detaches the chart from its dataset', async () => {
        const ds = Elicit.dataset(data());
        const chart = ds.chart(view());
        document.body.appendChild(chart.dom());
        await tick();
        chart.destroy();
        const before = chart.dom().innerHTML;
        ds.setData([{ x: 2, y: 20 }]);
        await tick();
        expect(chart.dom().innerHTML).toBe(before);
        expect(ds.getData()).toEqual([{ x: 2, y: 20 }]);
        chart.dom().remove();
    });
});

// ── Several charts on one dataset ─────────────────────────────────────────────

// Row i's circle in a chart, by its bound node.
const circleOf = (chart, i) => [...chart.dom().querySelectorAll('g.mark-layer circle')]
    .find((c) => c.__data__ && c.__data__.index === i && !c.__data__.ghost);
const cyOf = (chart, i) => Number(circleOf(chart, i).getAttribute('cy'));
const outlines = (chart) => chart.dom().querySelectorAll('g.effects-data > *').length;

const pointView = (y = {}, extra = {}) => ({
    width: 300, height: 200,
    marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', ...y } } })],
    ...extra,
});

async function pair(spec = {}, a = pointView({ edit: edit.move({ name: 'drag' }) }), b = pointView({ edit: edit.move({ name: 'drag' }) }, { height: 400 })) {
    const ds = Elicit.dataset({ ...data(), ...spec });
    const A = mount(ds.chart(a));
    const B = mount(ds.chart(b));
    await tick();
    return { ds, A, B };
}

describe('several charts on one dataset', () => {
    it('an edit in one chart redraws the other', async () => {
        const { ds, A, B } = await pair();
        const before = cyOf(B, 1);
        A.control('drag', 1).set(80);
        expect(ds.getData()[1].y).toBeCloseTo(80, 0);
        expect(cyOf(B, 1)).toBeLessThan(before);
        expect(cyOf(B, 0)).toBe(before);
    });

    it('a dataset constraint repairs edits from either chart', async () => {
        const { ds, A, B } = await pair({ constraints: [constraints.clamp({ field: 'y', max: 60 })] });
        A.control('drag', 0).set(80);
        expect(ds.getData()[0].y).toBe(60);
        B.control('drag', 1).set(90);
        expect(ds.getData()[1].y).toBe(60);
    });

    it('fires change once per commit, however many charts draw the dataset', async () => {
        let calls = 0;
        const { ds, A } = await pair({ onChange: () => { calls++; } });
        let heard = 0;
        ds.on('change', () => { heard++; });
        A.control('drag', 0).set(70);
        expect(calls).toBe(1);
        expect(heard).toBe(1);
    });

    it('one gesture in either chart is one undo step, and undo redraws both', async () => {
        const { ds, A, B } = await pair();
        const start = [cyOf(A, 0), cyOf(B, 0)];
        const a = A.control('drag', 0);
        a.begin(); a.set(60); a.set(70); a.end();
        const b = B.control('drag', 0);
        b.begin(); b.set(80); b.set(90); b.end();
        expect(ds.getData()[0].y).toBeCloseTo(90, 0);
        expect(ds.undo()).toBe(true);
        expect(ds.getData()[0].y).toBeCloseTo(70, 0);
        expect(ds.undo()).toBe(true);
        expect(ds.getData()[0].y).toBe(50);
        expect(ds.canUndo()).toBe(false);
        expect([cyOf(A, 0), cyOf(B, 0)]).toEqual(start);
    });

    it("events in one chart do not split another chart's gesture", async () => {
        const { ds, A, B } = await pair();
        const a = A.control('drag', 0);
        a.begin(); a.set(60);
        // A hover and a click in B, mid-gesture in A.
        B.emit({ type: 'hover', x: 10, y: 10, rawEvent: {} });
        B.emit({ type: 'click', x: 10, y: 10, rawEvent: {} });
        a.set(70); a.end();
        expect(ds.undo()).toBe(true);
        expect(ds.getData()[0].y).toBe(50);
        expect(ds.canUndo()).toBe(false);
    });

    it('a selection made in one chart shows in the other and fires select once', async () => {
        const { ds, A, B } = await pair({}, pointView({ edit: edit.select({ name: 'pick' }) }), pointView());
        const seen = [];
        ds.on('select', (i) => seen.push(i));
        expect(outlines(B)).toBe(0);
        A.control('pick', 2).fire();
        expect(seen).toEqual([2]);
        expect(ds.getSelection()).toBe(2);
        expect(outlines(B)).toBe(1);
    });

    it('a stage change clears the shared selection in every chart', async () => {
        const { ds, A, B } = await pair();
        ds.select(1);
        expect(outlines(B)).toBe(1);
        const seen = [];
        ds.on('select', (i) => seen.push(i));
        A.setStage(1);
        expect(seen).toEqual([null]);
        expect(outlines(B)).toBe(0);
        A.setStage(0);
        expect(seen).toEqual([null]); // nothing was selected, so nothing to hear
    });

    it("another chart's commit clears hover and preview; a chart's own commits keep its session", async () => {
        const { ds, A, B } = await pair(
            {},
            pointView({ edit: edit.move({ name: 'grab', mode: 'relative' }) }),
            pointView({ edit: edit.move({ name: 'probe', pick: 'probe' }) }, { height: 400 }),
        );
        // Hover a point in B, and park a probe preview (a ghost) there.
        B.emit({ type: 'pointerover', node: circleOf(B, 0).__data__ });
        expect(outlines(B)).toBe(1);
        const circles = B.dom().querySelectorAll('g.mark-layer circle').length;
        B.emit({ type: 'hover', x: 0, y: 200, rawEvent: {} });
        expect(B.dom().querySelectorAll('g.mark-layer circle').length).toBeGreaterThan(circles);
        // A relative move in A: each tick reads the anchor its session holds.
        const a = A.control('grab', 1);
        a.begin(); a.set(60);
        const first = ds.getData()[1].y;
        expect(first).toBeGreaterThan(50);
        expect(outlines(B)).toBe(0);
        expect(B.dom().querySelectorAll('g.mark-layer circle').length).toBe(circles);
        a.set(75); a.end();
        expect(ds.getData()[1].y).toBeGreaterThan(first);
        expect(ds.undo()).toBe(true);
        expect(ds.getData()[1].y).toBe(50);
    });

    it("another chart's commit drops a chart's driver session", async () => {
        const { ds, A, B } = await pair({}, undefined, pointView({ edit: edit.move({ name: 'grab', mode: 'relative' }) }));
        const b = B.control('grab', 0);
        b.begin(); b.set(70);
        const moved = ds.getData()[0].y;
        expect(moved).toBeGreaterThan(50);
        // A commits mid-gesture in B: B's move anchor is dropped, so its next tick is inert.
        A.control('drag', 1).set(70);
        b.set(90); b.end();
        expect(ds.getData()[0].y).toBe(moved);
        expect(ds.getData()[1].y).toBeCloseTo(70, 0);
    });

    it('destroy() on one chart leaves the other working, and undo skips it', async () => {
        const { ds, A, B } = await pair();
        A.control('drag', 0).set(70);
        A.destroy();
        const frozen = A.dom().innerHTML;
        B.control('drag', 1).set(80);
        expect(ds.getData()[1].y).toBeCloseTo(80, 0);
        expect(ds.undo()).toBe(true);
        expect(ds.undo()).toBe(true);
        expect(ds.getData().map((d) => d.y)).toEqual([50, 50, 50]);
        expect(A.dom().innerHTML).toBe(frozen);
        expect(cyOf(B, 0)).toBe(cyOf(B, 2));
    });

    it('a chart attached after a snapshot redraws on undo', async () => {
        const ds = Elicit.dataset(data());
        const A = mount(ds.chart(pointView({ edit: edit.move({ name: 'drag' }) })));
        await tick();
        A.control('drag', 0).set(70);
        const B = mount(ds.chart(pointView({}, { height: 400 })));
        await tick();
        const moved = cyOf(B, 0);
        expect(ds.undo()).toBe(true);
        expect(cyOf(B, 0)).toBeGreaterThan(moved);
        expect(cyOf(B, 0)).toBe(cyOf(B, 1));
    });

    it('an edit.axis grow resizes only the committing chart, and undo restores it', async () => {
        const axisView = (extra = {}) => ({
            ...pointView(), margins: { top: 10, right: 10, bottom: 10, left: 10 },
            axes: { x: { edit: edit.axis.scale({ mode: 'grow' }) }, y: {} }, ...extra,
        });
        const { ds, A, B } = await pair({}, axisView(), axisView({ height: 400 }));
        const widthOf = (c) => Number(c.dom().querySelector('svg').getAttribute('width'));
        expect([widthOf(A), widthOf(B)]).toEqual([300, 300]);
        const handle = [...A.dom().querySelectorAll('circle')]
            .map((c) => c.__data__).find((n) => n && n.axisHandle && n.cx > 100);
        A.emit({ type: 'dragstart', node: handle, x: handle.cx, y: handle.cy, rawEvent: {} });
        A.emit({ type: 'drag', node: handle, x: handle.cx + 140, y: handle.cy, rawEvent: {} });
        A.emit({ type: 'dragend', node: handle, x: handle.cx + 140, y: handle.cy, rawEvent: {} });
        expect(ds.getSchema().x.domain[1]).toBeGreaterThan(4);
        expect(widthOf(A)).toBeGreaterThan(300);
        expect(widthOf(B)).toBe(300);
        expect(ds.undo()).toBe(true);
        expect(ds.getSchema().x.domain).toEqual([0, 4]);
        expect([widthOf(A), widthOf(B)]).toEqual([300, 300]);
    });
});

describe('Dataset.set', () => {
    it('writes a cell, redraws every chart, fires change once, and is one undo step', async () => {
        const { ds, A, B } = await pair();
        const before = [cyOf(A, 1), cyOf(B, 1)];
        const seen = [];
        ds.on('change', (d) => seen.push(d[1].y));
        expect(ds.set('y', 80, { index: 1 })).toBe(true);
        expect(ds.getData()[1].y).toBe(80);
        expect(seen).toEqual([80]);
        expect(cyOf(A, 1)).toBeLessThan(before[0]);
        expect(cyOf(B, 1)).toBeLessThan(before[1]);
        expect(ds.undo()).toBe(true);
        expect(ds.getData()[1].y).toBe(50);
        expect([cyOf(A, 1), cyOf(B, 1)]).toEqual(before);
        expect(ds.canUndo()).toBe(false);
    });

    it('defaults to row 0, coerces to the field type, and is delegated on a chart', async () => {
        const { ds, A } = await pair();
        expect(A.set).toBe(ds.set);
        expect(A.set('y', '75')).toBe(true);
        expect(ds.getData()[0].y).toBe(75);
        expect(ds.set('y', 75)).toBe(false); // unchanged
    });

    it('is repaired by a dataset constraint', async () => {
        const { ds } = await pair({ constraints: [constraints.clamp({ field: 'y', max: 60 })] });
        expect(ds.set('y', 90, { index: 2 })).toBe(true);
        expect(ds.getData()[2].y).toBe(60);
    });

    it('returns false when the repair leaves the data as it was', async () => {
        const { ds } = await pair({ constraints: [constraints.clamp({ field: 'y', max: 60 })] });
        expect(ds.set('y', 90, { index: 2 })).toBe(true); // now at the cap
        const seen = [];
        ds.on('change', () => seen.push(1));
        expect(ds.set('y', 95, { index: 2 })).toBe(false); // capped back to 60
        expect(seen).toEqual([]);
        ds.undo();
        expect(ds.canUndo()).toBe(false); // the refused write added no step
    });

    it('a rejecting constraint refuses it and changes nothing', async () => {
        const { ds } = await pair({ constraints: [(rows) => rows.every((d) => d.y <= 60)] });
        expect(ds.set('y', 90)).toBe(false);
        expect(ds.getData()[0].y).toBe(50);
        expect(ds.canUndo()).toBe(false);
    });

    it('is refused on a locked row', async () => {
        const { ds } = await pair({ lock: (d) => d.x === 1 });
        let changes = 0;
        ds.on('change', () => { changes++; });
        expect(ds.set('y', 90, { index: 1 })).toBe(false);
        expect(ds.getData()[1].y).toBe(50);
        expect(changes).toBe(0);
        expect(ds.set('y', 90, { index: 0 })).toBe(true);
    });

    it('counts reported rows, leaving context rows out', async () => {
        const { ds } = await pair({ context: (d) => d.x === 0 });
        expect(ds.set('y', 90, { index: 0 })).toBe(true);
        expect(ds.getData()).toEqual([{ x: 1, y: 90 }, { x: 2, y: 50 }]);
    });

    it('warns and refuses an undeclared field, an index out of range, or a value the type cannot hold', async () => {
        const { ds } = await pair();
        let results = [];
        const warnings = captureWarnings(() => {
            results = [ds.set('z', 1), ds.set('y', 1, { index: 9 }), ds.set('y', 'abc')];
        });
        expect(results).toEqual([false, false, false]);
        expect(warnings.some((w) => w.includes('set("z")') && w.includes('"x", "y"'))).toBe(true);
        expect(warnings.some((w) => w.includes('index: 9'))).toBe(true);
        expect(warnings.some((w) => w.includes('cannot hold'))).toBe(true);
        expect(ds.canUndo()).toBe(false);
    });

    it('does not run an edit-scoped constrain', async () => {
        const { ds } = await pair({}, pointView({ edit: edit.move({ name: 'drag', constrain: [constraints.clamp({ max: 60 })] }) }));
        expect(ds.set('y', 90)).toBe(true);
        expect(ds.getData()[0].y).toBe(90);
    });
});
