// @vitest-environment jsdom
// The renderer contract beyond `render`: declared capabilities, teardown, and the
// places the canvas renderer must draw and pick as the SVG renderer does.
import { describe, it, expect, vi } from 'vitest';
import { Elicit, plot, edit, D3Renderer, CanvasRenderer, setWarnings } from '../src/index.js';
import { hitTest } from '../src/edit/pick.js';
import { paintScene } from '../src/renderers/canvas/draw.js';
import { bindPointerEvents } from '../src/renderers/pointer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

const base = {
    width: 320, height: 220, axes: false,
    schema: { x: { type: 'quantitative', domain: [0, 3] }, y: { type: 'quantitative', domain: [0, 100] }, t: { type: 'categorical' } },
    data: [{ x: 1, y: 50, t: 'hello' }],
};
const point = () => plot.point({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } });

/** A renderer that draws nothing and declares `supports`. */
const stub = (supports) => ({ render() {}, ...(supports ? { supports } : {}) });

/** Build a chart with warnings on, wait for its first render, return what was warned. */
async function warningsOf(spec) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try {
        const chart = Elicit({ ...base, marks: [point()], ...spec });
        document.body.appendChild(chart.dom());
        await tick();
        chart.destroy();
    } finally { console.warn = orig; setWarnings(false); }
    return seen.filter((m) => /this renderer|renderer's inline editor/.test(m));
}

describe('renderer capabilities', () => {
    it('the built-in renderers declare theirs', () => {
        expect(new D3Renderer().supports).toEqual({ keyboard: true, textEditor: true, filter: true, overflow: true });
        expect(new CanvasRenderer().supports).toMatchObject({ keyboard: false, textEditor: false, overflow: false });
    });

    it('the SVG renderer warns about none of them', async () => {
        const seen = await warningsOf({
            overflow: 'visible', focusOutline: true,
            marks: [plot.sticker({ channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 't', edit: edit.editText() } } })],
        });
        expect(seen).toEqual([]);
    });

    it('a renderer with no overflow warns on overflow: "visible"', async () => {
        const seen = await warningsOf({ overflow: 'visible', renderer: stub({ filter: true }) });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/overflow: "visible"/);
    });

    it('a renderer with no keyboard warns on focusOutline', async () => {
        const seen = await warningsOf({ focusOutline: true, renderer: stub({ filter: true }) });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/focusOutline/);
    });

    it('a renderer with no filter warns on the effect that needs one', async () => {
        const seen = await warningsOf({ effects: { selected: { filter: 'blur(1px)' }, grabbed: false }, renderer: stub({}) });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/effects\.selected\.filter/);
    });

    it('a renderer with no text editor warns on a typed edit', async () => {
        const seen = await warningsOf({
            renderer: stub({ filter: true }),
            marks: [plot.sticker({ channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 't', edit: edit.editText() } } })],
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/editText\(\) on "sticker\/label"/);
    });

    it('a renderer that declares nothing supports nothing', async () => {
        const seen = await warningsOf({ overflow: 'visible', effects: { grabbed: false }, renderer: stub(null) });
        expect(seen).toHaveLength(1);
    });
});

describe('renderer teardown', () => {
    it('chart.destroy() releases the renderer', async () => {
        const renderer = { render() {}, destroy: vi.fn() };
        const chart = Elicit({ ...base, marks: [point()], renderer });
        await tick();
        chart.destroy();
        expect(renderer.destroy).toHaveBeenCalledTimes(1);
    });

    it('a renderer without destroy() is left alone', async () => {
        const chart = Elicit({ ...base, marks: [point()], renderer: { render() {} } });
        await tick();
        expect(() => chart.destroy()).not.toThrow();
    });

    it('the SVG renderer drops its window listeners', () => {
        const renderer = new D3Renderer();
        const removed = vi.spyOn(window, 'removeEventListener');
        renderer._watchModifiers(0, 0, () => {});
        renderer._trackPlaneGesture();
        renderer.destroy();
        expect(removed.mock.calls.map((c) => c[0]).sort())
            .toEqual(['keydown', 'keyup', 'pointercancel', 'pointermove', 'pointerup']);
        removed.mockRestore();
    });

    it('unbinding the pointer stops its events', () => {
        const canvas = document.createElement('canvas');
        const events = [];
        const ctx = { scene: { children: [] }, width: 200, height: 200, margins: { left: 0, top: 0 }, planeOnTop: true, onEvent: (e) => events.push(e) };
        const pointer = bindPointerEvents(canvas, () => ctx);
        canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5 }));
        pointer.unbind();
        canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 5 }));
        expect(events.map((e) => e.type)).toEqual(['click']);
    });
});

describe('the pointer cursor', () => {
    const ctxOf = (node, more = {}) => ({ scene: { children: [node] }, width: 200, height: 200, margins: { left: 0, top: 0 }, planeOnTop: false, onEvent: () => {}, ...more });
    const over = (canvas) => canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 50 }));

    it("takes an effect's cursor over the node's own", () => {
        const canvas = document.createElement('canvas');
        const node = { type: 'circle', cx: 50, cy: 50, r: 10, featureId: 'f', index: 0, editable: true, cursor: 'ns-resize' };
        let ctx = ctxOf(node);
        const pointer = bindPointerEvents(canvas, () => ctx);
        over(canvas);
        expect(canvas.style.cursor).toBe('ns-resize');
        // The next frame's node carries the effect; no pointer move is needed.
        ctx = ctxOf({ ...node, effectStyle: { cursor: 'grabbing' } });
        pointer.refresh();
        expect(canvas.style.cursor).toBe('grabbing');
    });

    it('follows the plane cursor between pointer moves', () => {
        const canvas = document.createElement('canvas');
        let ctx = ctxOf({ type: 'circle', cx: 50, cy: 50, r: 10 }, { planeOnTop: true, planeCursor: 'crosshair' });
        const pointer = bindPointerEvents(canvas, () => ctx);
        over(canvas);
        expect(canvas.style.cursor).toBe('crosshair');
        ctx = { ...ctx, planeCursor: 'ew-resize' };
        pointer.refresh();
        expect(canvas.style.cursor).toBe('ew-resize');
    });
});

describe('canvas paint', () => {
    /** A 2D context that records its calls and the style in force at each. */
    const recorder = () => {
        const calls = [];
        const state = {};
        const ctx = new Proxy(state, {
            get: (t, k) => (k in t ? t[k] : (...args) => { calls.push({ op: k, args, lineWidth: t.lineWidth, textAlign: t.textAlign, font: t.font }); }),
            set: (t, k, v) => { t[k] = v; return true; },
        });
        return { ctx, calls };
    };
    const io = { images: new Map(), requestRepaint: () => {} };

    it('rounds a rect with rx and ry apart as ellipses', () => {
        const { ctx, calls } = recorder();
        paintScene(ctx, [{ type: 'rect', x: 0, y: 0, width: 100, height: 40, rx: 20, ry: 8, fill: 'red' }], io);
        const corners = calls.filter((c) => c.op === 'ellipse');
        expect(corners).toHaveLength(4);
        expect(corners.every((c) => c.args[2] === 20 && c.args[3] === 8)).toBe(true);
    });

    it('caps a corner radius at half the side', () => {
        const { ctx, calls } = recorder();
        paintScene(ctx, [{ type: 'rect', x: 0, y: 0, width: 100, height: 10, rx: 20, fill: 'red' }], io);
        const corner = calls.find((c) => c.op === 'ellipse');
        expect([corner.args[2], corner.args[3]]).toEqual([20, 5]);
    });

    it('draws no stroke at strokeWidth 0', () => {
        const { ctx, calls } = recorder();
        paintScene(ctx, [
            { type: 'line', x1: 0, y1: 0, x2: 10, y2: 0, stroke: 'red', strokeWidth: 3 },
            { type: 'line', x1: 0, y1: 5, x2: 10, y2: 5, stroke: 'red', strokeWidth: 0 },
        ], io);
        expect(calls.filter((c) => c.op === 'stroke').map((c) => c.lineWidth)).toEqual([3]);
    });

    it('anchors mark text in the middle and uses the host font', () => {
        const { ctx, calls } = recorder();
        paintScene(ctx, [{ type: 'text', x: 50, y: 50, text: 'hi', fill: 'black' }], { ...io, fontFamily: 'Georgia' });
        const drawn = calls.find((c) => c.op === 'fillText');
        expect(drawn.textAlign).toBe('center');
        expect(drawn.font).toMatch(/Georgia$/);
    });
});

describe('a text node is hit by its box', () => {
    const label = { type: 'text', x: 20, y: 50, text: 'a fairly long label', fontSize: 12, textAnchor: 'start', editable: true };

    it('along its whole length', () => {
        expect(hitTest([label], 90, 50)).toBe(label);
    });

    it('not on the far side of its anchor', () => {
        expect(hitTest([label], 4, 50)).toBe(null);
    });

    it('not a line above it', () => {
        expect(hitTest([label], 30, 20)).toBe(null);
    });
});
