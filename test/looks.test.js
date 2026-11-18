// @vitest-environment jsdom
// Looks restyle how the finished chart is drawn. They must leave picking, cursors
// and edits on the true geometry, and say so when a renderer cannot run one.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, looks, compile, recorder, setWarnings } from '../src/index.js';
import { LOOK_OPTIONS, LOOK_UNIVERSAL_OPTIONS } from '../src/vocabulary.js';
import { hitTest } from '../src/edit/pick.js';
import { shaderSource, cleanUniforms, resolveLooks } from '../src/core/looks.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

/** Run `fn` with warnings on and return what was warned. */
function warningsOf(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; setWarnings(false); }
    return seen;
}

const GLSL = 'vec4 look(vec2 uv) { return texture2D(u_frame, uv); }';
const make = { rough: looks.rough, sketch: looks.sketch, cartoon: looks.cartoon, halftone: looks.halftone, custom: (o) => looks.custom(GLSL, o) };

describe('look factories', () => {
    it('stamp their keyword, kind and the default scope', () => {
        expect(looks.rough()).toMatchObject({ type: 'rough', kind: 'geometry', scope: 'marks' });
        for (const type of ['sketch', 'cartoon', 'halftone', 'custom']) {
            expect(make[type]()).toMatchObject({ type, kind: 'shader', scope: 'marks' });
        }
        expect(looks.sketch({ scope: 'frame' }).scope).toBe('frame');
    });

    it('have a vocabulary list per keyword', () => {
        expect(Object.keys(LOOK_OPTIONS).sort()).toEqual(Object.keys(looks).sort());
    });

    it('read every option their list names, and warn on one it does not', () => {
        const values = { scope: 'frame', fill: 'solid', ink: '#222', uniforms: { k: 1 } };
        for (const [type, list] of Object.entries(LOOK_OPTIONS)) {
            const options = Object.fromEntries([...LOOK_UNIVERSAL_OPTIONS, ...list].map((k) => [k, k in values ? values[k] : 1]));
            // `levels` and `size` start at 2.
            for (const k of ['levels', 'size']) if (k in options) options[k] = 4;
            expect(warningsOf(() => make[type](options)), type).toEqual([]);
            const seen = warningsOf(() => make[type]({ nope: 1 }));
            expect(seen, type).toHaveLength(1);
            expect(seen[0]).toMatch(new RegExp(`looks\\.${type}\\(\\{ nope`));
        }
    });

    it('clamp a number past its range and say so', () => {
        const seen = warningsOf(() => expect(looks.sketch({ amount: 9 }).uniforms.amount).toBe(2));
        expect(seen[0]).toMatch(/amount runs from 0 to 2/);
    });

    it('refuse a scope that is neither', () => {
        const seen = warningsOf(() => expect(looks.halftone({ scope: 'axes' }).scope).toBe('marks'));
        expect(seen[0]).toMatch(/scope is "marks" or "frame"/);
    });

    it('skip a custom fragment with no look()', () => {
        const seen = warningsOf(() => expect(looks.custom('void main() {}').fragment).toBe(null));
        expect(seen[0]).toMatch(/defines `vec4 look\(vec2 uv\)`/);
    });
});

describe('shader source', () => {
    it('declares a uniform by how many numbers it holds', () => {
        const source = shaderSource(looks.custom(GLSL, { uniforms: { k: 1, at: [1, 2], tint: [1, 0, 0], box: [0, 0, 1, 1] } }));
        expect(source).toContain('uniform float k;');
        expect(source).toContain('uniform vec2 at;');
        expect(source).toContain('uniform vec3 tint;');
        expect(source).toContain('uniform vec4 box;');
        expect(source).toContain('gl_FragColor = look(v_uv);');
    });

    it('drops a uniform GLSL cannot declare', () => {
        const seen = warningsOf(() => {
            expect(cleanUniforms('custom', { u_frame: 1, 'a-b': 1, many: [1, 2, 3, 4, 5], text: 'x', ok: 2 })).toEqual({ ok: 2 });
        });
        expect(seen).toHaveLength(4);
    });
});

describe('looks.rough', () => {
    const bar = { type: 'rect', x: 10, y: 20, width: 40, height: 100, fill: 'teal', featureId: 'bars', index: 0, editable: true, cursor: 'ns-resize' };
    const axis = { type: 'line', x1: 0, y1: 120, x2: 200, y2: 120, stroke: 'grey', background: true, pointerEvents: 'none', featureId: 'axis' };
    const label = { type: 'text', x: 30, y: 10, text: 'A', background: true };
    const redraw = (nodes, options) => looks.rough(options).transform(nodes);

    it('keeps the shape as an unseen hit target and draws inert paths beside it', () => {
        const [target, ...parts] = redraw([bar]);
        expect(target).toMatchObject({ type: 'rect', x: 10, width: 40, fill: 'transparent', featureId: 'bars', index: 0, editable: true, cursor: 'ns-resize' });
        expect(parts.length).toBe(2); // hatching, and an edge in the fill's colour
        for (const part of parts) {
            expect(part).toMatchObject({ type: 'path', rough: true, pointerEvents: 'none', stroke: 'teal', fill: 'none' });
            expect(part.featureId).toBeUndefined();
            expect(part.d).toMatch(/^M/);
        }
    });

    it('leaves picking on the true shape', () => {
        const scene = redraw([bar]);
        expect(hitTest(scene, 30, 70)).toBe(scene[0]);
        expect(hitTest(scene, 80, 70)).toBe(null);
    });

    it('draws the same chart twice, and another hand for another seed', () => {
        const d = (options) => redraw([bar], options).slice(1).map((n) => n.d).join('|');
        expect(d()).toBe(d());
        expect(d({ seed: 2 })).not.toBe(d());
    });

    it('fills solid when asked', () => {
        const [, fill, edge] = redraw([bar], { fill: 'solid' });
        expect(fill).toMatchObject({ fill: 'teal', stroke: 'none' });
        expect(edge).toMatchObject({ fill: 'none', stroke: 'teal' });
    });

    it('covers marks by default and the whole frame when asked, text aside', () => {
        expect(redraw([axis, label, bar]).slice(0, 2)).toEqual([axis, label]);
        const frame = redraw([axis, label, bar], { scope: 'frame' });
        // The inert axis line is replaced by its drawn stroke; the label is untouched.
        expect(frame[0]).toMatchObject({ type: 'path', rough: true, background: true, stroke: 'grey' });
        expect(frame[1]).toBe(label);
    });

    it('puts an effect on what is drawn and its cursor on what is hit', () => {
        const grabbed = { ...bar, effectStyle: { fill: 'red', filter: 'brightness(0.8)', cursor: 'grabbing' } };
        const [target, ...parts] = redraw([grabbed]);
        expect(target.effectStyle).toEqual({ cursor: 'grabbing' });
        expect(target.fill).toBe('transparent');
        for (const part of parts) {
            expect(part.stroke).toBe('red');
            expect(part.effectStyle).toEqual({ filter: 'brightness(0.8)' });
        }
    });

    it('never redraws what it drew', () => {
        // The target is unseen now and the parts are marked, so a second pass changes nothing.
        const once = redraw([bar]);
        expect(redraw(once)).toEqual(once);
    });

    it('redraws a path, a circle and a rotated ellipse', () => {
        const nodes = [
            { type: 'path', d: 'M0,0L50,0L50,50Z', fill: 'red', featureId: 'p', index: 0, pointerEvents: 'none' },
            { type: 'circle', cx: 50, cy: 50, r: 20, fill: 'blue', featureId: 'c', index: 0, pointerEvents: 'none' },
            { type: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 10, angle: 45, stroke: 'black', fill: 'none', featureId: 'e', index: 0, pointerEvents: 'none' },
        ];
        const out = redraw(nodes);
        expect(out.every((n) => n.rough && n.type === 'path' && n.d.length > 10)).toBe(true);
        expect(out.length).toBe(5);
    });
});

describe('a chart with looks', () => {
    const spec = (more) => ({
        width: 320, height: 220, axes: false,
        schema: { x: { type: 'quantitative', domain: [0, 3] }, y: { type: 'quantitative', domain: [0, 100] } },
        data: [{ x: 1, y: 50 }],
        marks: [plot.point({ size: 10, channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } })],
        ...more,
    });

    it('draws rough in SVG and still edits the point it hides', async () => {
        const chart = Elicit(spec({ looks: [looks.rough()] }));
        document.body.appendChild(chart.dom());
        await tick();
        const circle = chart.dom().querySelector('circle.mark');
        expect(circle.getAttribute('fill')).toBe('transparent');
        expect(chart.dom().querySelectorAll('path').length).toBeGreaterThan(0);
        const node = circle.__data__;
        chart.emit({ type: 'dragstart', node, x: node.cx, y: node.cy });
        chart.emit({ type: 'drag', node, x: node.cx, y: node.cy - 40 });
        chart.emit({ type: 'dragend', node, x: node.cx, y: node.cy - 40 });
        expect(chart.getData()[0].y).toBeGreaterThan(55);
        chart.destroy();
    });

    it('warns when its renderer cannot run a shader, and not for geometry', () => {
        const seen = warningsOf(() => Elicit(spec({ looks: [looks.rough(), looks.halftone()] })).destroy());
        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatch(/looks\.halftone\(\) is a shader, which this renderer cannot run/);
    });

    it('does not warn on a renderer that supports shaders', () => {
        const renderer = { render() {}, supports: { shaders: true, filter: true } };
        expect(warningsOf(() => Elicit(spec({ renderer, looks: [looks.cartoon()] })).destroy())).toEqual([]);
    });

    it('hands the renderer its looks', async () => {
        let got = null;
        const renderer = { render(context) { got = context.looks; }, supports: { shaders: true, filter: true } };
        const chart = Elicit(spec({ renderer, looks: [looks.sketch()] }));
        await tick();
        expect(got.map((l) => l.type)).toEqual(['sketch']);
        chart.destroy();
    });

    it('drops what is not a look', () => {
        const seen = warningsOf(() => expect(resolveLooks([looks.rough(), 'sketch', { type: 'rough' }])).toHaveLength(1));
        expect(seen).toHaveLength(2);
    });
});

describe('looks in JSON', () => {
    it('compile to the same looks', () => {
        const spec = compile({ looks: [{ type: 'rough', scope: 'frame' }, { type: 'custom', fragment: GLSL, uniforms: { k: 2 } }] });
        expect(spec.looks[0]).toMatchObject({ type: 'rough', kind: 'geometry', scope: 'frame' });
        expect(spec.looks[1]).toMatchObject({ type: 'custom', kind: 'shader', fragment: GLSL, uniforms: { k: 2 } });
    });

    it('are recorded as descriptors', () => {
        const rec = recorder();
        const { json } = rec.toJSON({ looks: [rec.looks.sketch({ amount: 1 }), rec.looks.custom(GLSL, { seed: 3 })] });
        expect(json.looks).toEqual([{ type: 'sketch', amount: 1 }, { type: 'custom', fragment: GLSL, seed: 3 }]);
    });

    it('reject an unknown look', () => {
        expect(() => compile({ looks: [{ type: 'watercolour' }] })).toThrow(/unknown looks keyword "watercolour"/);
    });
});
