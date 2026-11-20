// @vitest-environment jsdom
// Pictures, as CSS lays them out: the `image` channel is a shape's background
// image, `plot.image`'s `src` is an <img>, and `guides.image` sits behind the marks.
// Settings (fit, position, repeat) are params of the channel.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, guides, elements, compile, setWarnings } from '../src/index.js';
import { paintScene } from '../src/renderers/canvas/draw.js';
import { imageLayout, imageTiles } from '../src/renderers/shared.js';
import { parsePosition } from '../src/plot/mark.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

const schema = {
    k: { type: 'categorical', domain: ['a', 'b'] },
    v: { type: 'quantitative', domain: [0, 10] },
    x: { type: 'quantitative', domain: [0, 10] },
    y: { type: 'quantitative', domain: [0, 10] },
};
const data = [
    { k: 'a', v: 4, x: 2, y: 2, pic: 'a.png' },
    { k: 'b', v: 8, x: 6, y: 6, pic: 'b.png' },
];

/** The scene a chart hands its renderer. */
async function sceneOf(spec) {
    let children = [];
    const chart = Elicit({ width: 300, height: 200, axes: false, schema, data, ...spec, renderer: { render(c) { children = c.scene.children; } } });
    await tick();
    chart.destroy();
    return children;
}

/** What a chart warns, with warnings on. `make` builds the spec, so factory warnings count. */
async function warningsOf(make) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { await sceneOf(make()); } finally { console.warn = orig; setWarnings(false); }
    return seen;
}

const bars = (o = {}) => plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } }, ...o });

describe('the image channel', () => {
    it('paints one URL inside every bar: cover, centred, no repeat', async () => {
        const rects = (await sceneOf({ marks: [bars({ image: 'icon.png' })] })).filter((n) => n.type === 'rect');
        expect(rects).toHaveLength(2);
        for (const r of rects) expect(r.fillImage).toEqual({ href: 'icon.png', fit: 'cover', position: [0.5, 0.5], repeat: 'no-repeat' });
    });

    it('reads a column of URLs and takes its settings as channel params', async () => {
        const image = { field: 'pic', fit: 'contain', position: 'bottom', repeat: 'repeat-y' };
        const rects = (await sceneOf({ marks: [bars({ channels: { x: { field: 'k' }, y: { field: 'v' }, image } })] }))
            .filter((n) => n.type === 'rect');
        expect(rects.map((r) => r.fillImage)).toEqual([
            { href: 'a.png', fit: 'contain', position: [0.5, 1], repeat: 'repeat-y' },
            { href: 'b.png', fit: 'contain', position: [0.5, 1], repeat: 'repeat-y' },
        ]);
    });

    it('fills points, ellipses, shapes and filled waffle cells', async () => {
        const xy = { x: { field: 'x' }, y: { field: 'y' } };
        const nodes = await sceneOf({
            marks: [
                plot.point({ image: 'p.png', channels: xy }),
                plot.ellipse({ image: 'e.png', channels: xy }),
                plot.shape({ image: 's.png', channels: xy }),
            ],
        });
        const hrefs = new Set(nodes.filter((n) => n.fillImage).map((n) => n.fillImage.href));
        expect(hrefs).toEqual(new Set(['p.png', 'e.png', 's.png']));

        const cells = (await sceneOf({ marks: [plot.waffle({ image: 'w.png', channels: { x: { field: 'k' }, count: { field: 'v' } } })] }))
            .filter((n) => n.grid);
        const filled = cells.filter((n) => n.fillImage);
        expect(filled.length).toBeGreaterThan(0);
        expect(filled.length).toBeLessThan(cells.length);
    });

    it('warns on a mark that does not draw it, and on settings CSS would not take', async () => {
        const xy = { x: { field: 'x' }, y: { field: 'y' } };
        expect((await warningsOf(() => ({ marks: [plot.lineY({ image: 'l.png', channels: xy })] }))).some((m) => /does not draw an `image`/.test(m))).toBe(true);
        expect((await warningsOf(() => ({ marks: [plot.point({ src: 'p.png', channels: xy })] }))).some((m) => /does not draw a `src`/.test(m))).toBe(true);
        const bad = { x: { field: 'k' }, y: { field: 'v' }, image: { value: 'i.png', fit: 'stretch', position: 'middle', repeat: 'tile' } };
        const seen = await warningsOf(() => ({ marks: [bars({ channels: bad })] }));
        expect(seen.some((m) => /fit is one of/.test(m))).toBe(true);
        expect(seen.some((m) => /position takes CSS keywords/.test(m))).toBe(true);
        expect(seen.some((m) => /repeat is one of/.test(m))).toBe(true);
    });

    it('reads positions as CSS does', () => {
        expect(parsePosition('center')).toEqual([0.5, 0.5]);
        expect(parsePosition('bottom')).toEqual([0.5, 1]);
        expect(parsePosition('left')).toEqual([0, 0.5]);
        expect(parsePosition('top right')).toEqual([1, 0]);
        expect(parsePosition('25% 75%')).toEqual([0.25, 0.75]);
        expect(parsePosition('middle')).toBeNull();
    });

    it('draws as an SVG pattern holding the picture', async () => {
        const chart = Elicit({ width: 300, height: 200, axes: false, schema, data, marks: [bars({ image: 'icon.png' })] });
        document.body.appendChild(chart.dom());
        await tick();
        const rect = chart.dom().querySelector('rect.mark');
        const id = /url\(#(.+)\)/.exec(rect.getAttribute('fill'))[1];
        const pattern = chart.dom().querySelector(`pattern#${id}`);
        expect(pattern.querySelector('image').getAttribute('href')).toBe('icon.png');
        chart.destroy();
    });
});

describe('plot.image', () => {
    it('draws one picture per row from src, in a square of side 2 * size, contain by default', async () => {
        const rows = [...data, { k: 'a', v: 1, x: 5, y: 5 }];
        let children = [];
        const chart = Elicit({
            width: 300, height: 200, axes: false, schema, data: rows,
            marks: [plot.image({ channels: { x: { field: 'x' }, y: { field: 'y' }, src: { field: 'pic' } } })],
            renderer: { render(c) { children = c.scene.children; } },
        });
        await tick();
        chart.destroy();
        const pics = children.filter((n) => n.fillImage);
        // The row with no URL draws nothing.
        expect(pics).toHaveLength(2);
        expect(pics[0]).toMatchObject({ type: 'rect', width: 32, height: 32, fillImage: { href: 'a.png', fit: 'contain', position: [0.5, 0.5] } });
    });

    it('warns with no src, and on a repeat (an <img> does not repeat)', async () => {
        expect((await warningsOf(() => ({ marks: [plot.image({ channels: { x: { field: 'x' }, y: { field: 'y' } } })] })))
            .some((m) => /no `src` channel/.test(m))).toBe(true);
        expect((await warningsOf(() => ({ marks: [plot.image({ channels: { x: { field: 'x' }, y: { field: 'y' }, src: { value: 'a.png', repeat: 'repeat' } } })] })))
            .some((m) => /repeat applies to a background image/.test(m))).toBe(true);
    });
});

describe('guides.image', () => {
    it('fills the plot with no x/y, beneath the gridlines', async () => {
        const children = await sceneOf({
            theme: { panel: { fill: '#eee' } },
            elements: [elements.gridY()],
            marks: [bars()],
            guides: [guides.image({ src: 'room.png' })],
        });
        const pic = children.find((n) => n.fillImage);
        expect(pic).toMatchObject({ x: 0, y: 0, background: true, fillImage: { href: 'room.png', fit: 'fill', repeat: 'no-repeat' } });
        const at = children.indexOf(pic);
        expect(children[at - 1].panel).toBe(true);
        const firstGrid = children.findIndex((n) => n.type === 'line' && n.background);
        expect(firstGrid).toBeGreaterThan(at);
    });

    it('places a box in data space', async () => {
        const children = await sceneOf({ marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })], guides: [guides.image({ src: 'logo.png', x: [0, 5], y: [5, 10] })] });
        const pic = children.find((n) => n.fillImage);
        const scene = await sceneOf({ marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } })] });
        expect(scene.find((n) => n.fillImage)).toBeUndefined();
        expect(pic.x).toBe(0);
        expect(pic.y).toBe(0);
        expect(pic.width).toBeGreaterThan(0);
        expect(pic.height).toBeGreaterThan(0);
    });
});

describe('canvas paint', () => {
    const recorder = () => {
        const calls = [];
        const ctx = new Proxy({}, {
            get: (t, k) => (k in t ? t[k] : (...args) => { calls.push({ op: k, args }); }),
            set: (t, k, v) => { t[k] = v; return true; },
        });
        return { ctx, calls };
    };
    const loaded = (href, w, h) => new Map([[href, { ready: true, img: { naturalWidth: w, naturalHeight: h } }]]);

    it('clips to the shape and covers it', async () => {
        const { ctx, calls } = recorder();
        paintScene(ctx, [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, fill: 'red', fillImage: { href: 'a.png', fit: 'cover', position: [0.5, 0.5], repeat: 'no-repeat' } }],
            { images: loaded('a.png', 200, 100), requestRepaint: () => {} });
        expect(calls.some((c) => c.op === 'clip')).toBe(true);
        const draw = calls.find((c) => c.op === 'drawImage');
        expect(draw.args.slice(1)).toEqual([-50, 0, 200, 100]);
        // The picture replaces the fill.
        expect(calls.some((c) => c.op === 'fill')).toBe(false);
    });

    it('contain + repeat-y + bottom stacks whole pictures up from the base', async () => {
        const { ctx, calls } = recorder();
        const fillImage = { href: 't.png', fit: 'contain', position: [0.5, 1], repeat: 'repeat-y' };
        paintScene(ctx, [{ type: 'rect', x: 0, y: 0, width: 20, height: 50, fillImage }],
            { images: loaded('t.png', 10, 10), requestRepaint: () => {} });
        const draws = calls.filter((c) => c.op === 'drawImage').map((c) => c.args.slice(1));
        // 50px of 20px tiles from the bottom: two whole, one cut by the clip at the top.
        expect(draws).toEqual([[0, -10, 20, 20], [0, 10, 20, 20], [0, 30, 20, 20]]);
    });

    it('sizes as object-fit does', () => {
        const box = { x: 0, y: 0, width: 100, height: 50 };
        const at = (fit, position = [0.5, 0.5]) => {
            const { x, y, width, height } = imageLayout({ href: '', fit, position, repeat: 'no-repeat' }, box, 40, 40);
            return [x, y, width, height];
        };
        expect(at('contain')).toEqual([25, 0, 50, 50]);
        expect(at('cover')).toEqual([0, -25, 100, 100]);
        expect(at('fill')).toEqual([0, 0, 100, 50]);
        expect(at('none')).toEqual([30, 5, 40, 40]);
        expect(at('scale-down')).toEqual([30, 5, 40, 40]);
        expect(at('none', [0, 1])).toEqual([0, 10, 40, 40]);
    });

    it('repeats across the whole box on both axes', () => {
        const box = { x: 0, y: 0, width: 30, height: 20 };
        const at = imageLayout({ href: '', fit: 'none', position: [0, 0], repeat: 'repeat' }, box, 10, 10);
        expect(imageTiles(at, box)).toHaveLength(6);
    });
});

describe('JSON', () => {
    it('compiles the mark, the channel and the guide', async () => {
        const spec = compile({
            marks: [
                { type: 'image', channels: { x: { field: 'x' }, y: { field: 'y' }, src: { value: 'a.png', fit: 'cover' } } },
                { type: 'point', channels: { x: { field: 'x' }, y: { field: 'y' }, image: { field: 'pic', repeat: 'repeat' } } },
            ],
            guides: [{ type: 'image', src: 'room.png', x: [0, 5], fit: 'cover', position: 'top' }],
        });
        expect(spec.marks[0].type).toBe('image');
        expect(spec.guides[0].type).toBe('image');
        const children = await sceneOf(spec);
        expect(children.filter((n) => n.fillImage).length).toBe(2 + 2 + 1);
    });
});
