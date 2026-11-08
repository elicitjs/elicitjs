// @vitest-environment jsdom
// Zoom is a DOMAIN change: a wheel over the plot narrows the axis's declared
// domain about the value under the pointer, through the same commit a handle
// drag takes (undoable, notified), and `setDomain` is its external twin.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { clipRect, clipProblem } from '../src/core/scene.js';
import { clipVisible } from '../src/edit/pick.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

function chart(extra = {}) {
    const changes = [];
    const el = Elicit({
        width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { x: { type: 'quantitative', domain: [0, 100] }, y: { type: 'quantitative', domain: [0, 10] } },
        data: [{ x: 50, y: 5 }],
        axes: { x: { edit: edit.axis.zoom() }, y: {} },
        onChange: (d) => changes.push(d),
        marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        ...extra,
    });
    document.body.appendChild(el);
    return { el, changes };
}

describe('edit.axis.zoom', () => {
    it('narrows the x domain about the pointer on a wheel-up, and widens on wheel-down up to the declared domain', async () => {
        const { el } = chart();
        await tick();
        // Pointer at the plot's centre: x = 50.
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        let d = el.getSchema().x.domain;
        expect(d[1] - d[0]).toBeLessThan(100);
        expect((d[0] + d[1]) / 2).toBeCloseTo(50, 3);
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: 300, rawEvent: {} });
        d = el.getSchema().x.domain;
        expect(d).toEqual([0, 100]); // the declared domain is the ceiling
    });

    it('is the only edit the plane runs, leaves y alone, and coalesces into one undo step', async () => {
        const { el, changes } = chart();
        await tick();
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        expect(el.getSchema().y.domain).toEqual([0, 10]);
        expect(changes.length).toBe(2);
        await new Promise((r) => setTimeout(r, 400));
        el.undo();
        expect(el.getSchema().x.domain).toEqual([0, 100]);
    });

    it('a wheel edit never raises the plane', async () => {
        const { driverFor, needsPlaneOnTop } = await import('../src/edit/drivers/index.js');
        const e = edit.axis.zoom();
        expect(e.pick).toBe('plane');
        expect(driverFor(e).name).toBe('plane');
        expect(needsPlaneOnTop([e])).toBe(false);
    });
});

describe('el.setDomain', () => {
    it('sets a field domain, notifies, and null restores the declared one', async () => {
        const { el, changes } = chart({ axes: { x: {}, y: {} } });
        await tick();
        expect(el.setDomain('x', [20, 40])).toBe(true);
        expect(el.getSchema().x.domain).toEqual([20, 40]);
        expect(changes.length).toBe(1);
        expect(el.setDomain('x', null)).toBe(true);
        expect(el.getSchema().x.domain).toEqual([0, 100]);
        expect(el.setDomain('nope', [0, 1])).toBe(false);
        el.undo();
        expect(el.getSchema().x.domain).toEqual([20, 40]);
    });
});

describe('clip and a zoom-only axis', () => {
    it('clip: true confines the mark layer, and a zoom-only axis draws no handles', async () => {
        const { el } = chart({ clip: true });
        await tick();
        expect(el.querySelector('g.mark-layer').getAttribute('clip-path')).toMatch(/^url\(#/);
        // The x axis carries only a zoom: no end-handles (the axis's circles) are drawn.
        expect([...el.querySelectorAll('circle.mark')].filter((c) => c.__data__ && c.__data__.axisHandle).length).toBe(0);
        // Shift-wheel arrives as deltaX.
        el.emit({ type: 'wheel', x: 140, y: 90, deltaX: -100, deltaY: 0, rawEvent: {} });
        const d = el.getSchema().x.domain;
        expect(d[1] - d[0]).toBeLessThan(100);
    });
});

describe('zoom on a log axis', () => {
    it('keeps the value under the pointer in view', async () => {
        const el = Elicit({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 },
            schema: { x: { type: 'quantitative', domain: [100, 1e6] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 1000, y: 5 }],
            scales: { x: { type: 'log' } },
            axes: { x: { edit: edit.axis.zoom() }, y: {} },
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })],
        });
        document.body.appendChild(el);
        await tick();
        // Pointer at x ≈ 11.5k on [100, 1e6] over 280 px: log10 position 0.515 → 144 px.
        const px = 280 * (Math.log10(11500) - 2) / 4;
        for (let i = 0; i < 4; i++) el.emit({ type: 'wheel', x: px, y: 90, deltaY: -100, rawEvent: {} });
        const d = el.getSchema().x.domain;
        expect(d[0]).toBeLessThan(11500);
        expect(d[1]).toBeGreaterThan(11500);
        expect(d[1] / d[0]).toBeLessThan(1e4);
    });
});

// Pan: a plane drag slides the domain by the pointer's pixel travel. Inner plot
// is 280 × 180 px, so on x one pixel is 100/280 of a unit at the declared domain.
describe('edit.axis.pan', () => {
    const panChart = (extra = {}) => chart({
        axes: {
            x: { edits: [edit.axis.zoom(), edit.axis.pan()] },
            y: { edits: [edit.axis.pan()] },
        },
        ...extra,
    });
    const drag = (el, from, to) => {
        el.emit({ type: 'dragstart', x: from[0], y: from[1], rawEvent: {} });
        el.emit({ type: 'drag', x: to[0], y: to[1], rawEvent: {} });
        el.emit({ type: 'dragend', x: to[0], y: to[1], rawEvent: {} });
    };

    it('is served by its own driver, raises the plane, and draws no axis handles', async () => {
        const { driverFor, needsPlaneOnTop } = await import('../src/edit/drivers/index.js');
        const e = edit.axis.pan();
        expect(e.type).toBe('axis.pan');
        expect(driverFor(e).name).toBe('pan');
        expect(needsPlaneOnTop([e])).toBe(true);
        expect(e.viewport).toBe(true);
        const { el } = panChart();
        await tick();
        expect([...el.querySelectorAll('circle.mark')].filter((c) => c.__data__ && c.__data__.axisHandle).length).toBe(0);
    });

    it('stays inside the declared domain at full view', async () => {
        const { el } = panChart();
        await tick();
        drag(el, [100, 90], [160, 90]);
        expect(el.getSchema().x.domain).toEqual([0, 100]);
    });

    it('slides a zoomed window against the pointer on both axes, as one undo step', async () => {
        const { el } = panChart();
        await tick();
        el.setDomain('x', [20, 40]);
        el.setDomain('y', [2, 4]);
        // 28 px right on x at 20 units / 280 px = 2 units left; 18 px down on y at
        // 2 units / 180 px = 0.2 units up (screen y runs down, values up).
        drag(el, [100, 90], [128, 108]);
        const x = el.getSchema().x.domain;
        const y = el.getSchema().y.domain;
        expect(x[0]).toBeCloseTo(18, 6);
        expect(x[1]).toBeCloseTo(38, 6);
        expect(y[0]).toBeCloseTo(2.2, 6);
        expect(y[1]).toBeCloseTo(4.2, 6);
        el.undo();
        expect(el.getSchema().x.domain).toEqual([20, 40]);
        expect(el.getSchema().y.domain).toEqual([2, 4]);
    });

    it('stops at the declared edge and keeps the span', async () => {
        const { el } = panChart();
        await tick();
        el.setDomain('x', [10, 30]);
        drag(el, [100, 90], [260, 90]); // far more than 10 units to the right
        expect(el.getSchema().x.domain).toEqual([0, 20]);
    });

    it('composes with a wheel zoom mid-drag', async () => {
        const { el } = panChart();
        await tick();
        el.setDomain('x', [20, 60]);
        el.emit({ type: 'dragstart', x: 140, y: 90, rawEvent: {} });
        el.emit({ type: 'drag', x: 154, y: 90, rawEvent: {} }); // 14 px = 2 units
        expect(el.getSchema().x.domain[0]).toBeCloseTo(18, 6);
        el.emit({ type: 'wheel', x: 140, y: 90, deltaY: -100, rawEvent: {} });
        const z = el.getSchema().x.domain;
        expect(z[1] - z[0]).toBeLessThan(40);
        // The next tick pans the ZOOMED window by its own pixels.
        el.emit({ type: 'drag', x: 168, y: 90, rawEvent: {} });
        const p = el.getSchema().x.domain;
        expect(p[1] - p[0]).toBeCloseTo(z[1] - z[0], 6);
        expect(p[0]).toBeCloseTo(z[0] - (z[1] - z[0]) * 14 / 280, 6);
        el.emit({ type: 'dragend', x: 168, y: 90, rawEvent: {} });
    });

    it('a press on a draggable mark grabs the mark, not the view', async () => {
        const { el } = panChart({
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
        });
        await tick();
        el.setDomain('x', [0, 100]);
        // The point sits at (140, 90).
        drag(el, [140, 90], [140, 54]);
        expect(el.getData()[0].y).toBeCloseTo(7, 6);
        expect(el.getSchema().x.domain).toEqual([0, 100]);
    });
});

describe('clip', () => {
    it('is on by default with a zoom or pan, and clip: false turns it off', async () => {
        const on = chart();
        await tick();
        expect(on.el.querySelector('g.mark-layer').getAttribute('clip-path')).toMatch(/^url\(#/);
        expect(on.el.querySelector('g.effects-data').getAttribute('clip-path')).toMatch(/^url\(#/);
        const off = chart({ clip: false });
        await tick();
        expect(off.el.querySelector('g.mark-layer').getAttribute('clip-path')).toBeNull();
        const plain = chart({ axes: { x: {}, y: {} } });
        await tick();
        expect(plain.el.querySelector('g.mark-layer').getAttribute('clip-path')).toBeNull();
    });

    it('keeps a chart element\'s handles out of the clip', async () => {
        const { el } = chart({ axes: { x: { edit: edit.axis.scale() }, y: { edit: edit.axis.zoom() } } });
        await tick();
        const handles = [...el.querySelectorAll('g.chrome-layer circle.mark')].filter((c) => c.__data__ && c.__data__.axisHandle);
        expect(handles.length).toBe(2);
        expect([...el.querySelectorAll('g.mark-layer circle.mark')].some((c) => c.__data__ && c.__data__.axisHandle)).toBe(false);
    });

    it('a mark zoomed out of the plot rect is not grabbed past the axis', async () => {
        const { el } = chart({
            axes: { x: { edits: [edit.axis.zoom(), edit.axis.pan()] }, y: {} },
            marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
        });
        await tick();
        el.setDomain('x', [0, 20]);
        // x = 50 now sits at 700 px, past the right edge (280 px). A press there,
        // in the margin, must not move the hidden point.
        el.emit({ type: 'dragstart', x: 700, y: 90, rawEvent: {} });
        el.emit({ type: 'drag', x: 700, y: 20, rawEvent: {} });
        el.emit({ type: 'dragend', x: 700, y: 20, rawEvent: {} });
        expect(el.getData()[0].y).toBe(5);
    });
});

describe('clip: pad and per-mark opt-out', () => {
    it('clipRect grows the plot rect by pad, on every side or per side', () => {
        expect(clipRect(undefined, false, 280, 180)).toBeNull();
        expect(clipRect(undefined, true, 280, 180)).toEqual({ x: 0, y: 0, width: 280, height: 180 });
        expect(clipRect(false, true, 280, 180)).toBeNull();
        expect(clipRect({ pad: 6 }, false, 280, 180)).toEqual({ x: -6, y: -6, width: 292, height: 192 });
        expect(clipRect({ pad: { top: 4, left: 10 } }, false, 280, 180)).toEqual({ x: -10, y: -4, width: 290, height: 184 });
    });

    it('clipProblem names a misspelled clip and passes a correct one', () => {
        expect(clipProblem(true)).toBeNull();
        expect(clipProblem({ pad: 6 })).toBeNull();
        expect(clipProblem({ pad: { top: 2, right: 3 } })).toBeNull();
        expect(clipProblem({ padding: 6 })).toMatch(/padding/);
        expect(clipProblem({ pad: { up: 2 } })).toMatch(/up/);
        expect(clipProblem({ pad: '6px' })).toMatch(/number of pixels/);
    });

    it('clipVisible measures from the padded rect\'s own corner', () => {
        const marks = [{ id: 'a' }, { id: 'b', unclipped: true }];
        const rect = { x: -6, y: -6, width: 292, height: 192 };
        expect(clipVisible(marks, -4, -4, rect)).toHaveLength(2);
        expect(clipVisible(marks, -8, 50, rect)).toEqual([marks[1]]);
    });

    it('draws the clipPath rect with the pad', async () => {
        const { el } = chart({ clip: { pad: { left: 8, top: 4 } } });
        await tick();
        const r = el.querySelector('clipPath rect');
        expect([r.getAttribute('x'), r.getAttribute('y'), r.getAttribute('width'), r.getAttribute('height')])
            .toEqual(['-8', '-4', '288', '184']);
    });

    it('a pad turns the clip on for a chart with no zoom or pan', async () => {
        const { el } = chart({ axes: { x: {}, y: {} }, clip: { pad: 4 } });
        await tick();
        expect(el.querySelector('g.mark-layer').getAttribute('clip-path')).toMatch(/^url\(#/);
    });

    it('a mark with clip: false paints outside the clip and is grabbed past the axis', async () => {
        const { el } = chart({
            axes: { x: { edit: edit.axis.zoom() }, y: {} },
            marks: [
                plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
                plot.point({ clip: false, channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } }),
            ],
        });
        await tick();
        const inChrome = [...el.querySelectorAll('g.chrome-layer circle.mark')].filter((c) => c.__data__ && !c.__data__.axisHandle);
        expect(inChrome).toHaveLength(1);
        expect(el.querySelectorAll('g.mark-layer circle.mark')).toHaveLength(1);
        el.setDomain('x', [0, 20]);
        // x = 50 now sits at 700 px, past the right edge; the opted-out point is
        // drawn there, so a press there grabs it.
        el.emit({ type: 'dragstart', x: 700, y: 90, rawEvent: {} });
        el.emit({ type: 'drag', x: 700, y: 36, rawEvent: {} });
        el.emit({ type: 'dragend', x: 700, y: 36, rawEvent: {} });
        expect(el.getData()[0].y).toBeCloseTo(8, 0);
    });

    it('a composite with clip: false stamps it on every part', () => {
        const parts = plot.composite({ clip: false, parts: [plot.point({}), plot.text({ clip: true })] });
        expect(parts.map((p) => p.clip)).toEqual([false, true]);
    });
});
