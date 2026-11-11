// @vitest-environment jsdom
// The theme as a STYLE layer for chrome as well as marks: named themes (by object,
// by string, by `extends`), the axis/grid/panel/legend tokens, and the typography
// that reaches a text node. Named themes after Flint (microsoft/flint-chart).
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, plot, elements, themes, resolveTheme, setTheme, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);
afterEach(() => setTheme(null));

const schema = {
    k: { type: 'categorical', domain: ['a', 'b', 'c'] },
    v: { type: 'quantitative', domain: [-5, 10] },
};
const data = [{ k: 'a', v: 4 }, { k: 'b', v: 8 }, { k: 'c', v: -2 }];

function bars(extra = {}, markOpts = {}) {
    const el = Elicit({
        width: 320, height: 220, margins: { top: 10, right: 10, bottom: 30, left: 40 },
        schema, data,
        marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' } }, ...markOpts })],
        ...extra,
    });
    document.body.appendChild(el);
    return el;
}
/** Every scene node the renderer bound, by element selector. */
const nodes = (el, sel) => [...el.querySelectorAll(sel)].map((n) => n.__data__).filter(Boolean);
const bgLines = (el) => nodes(el, 'g line').filter((d) => d.background);
const labels = (el) => nodes(el, 'text').filter((d) => d.background);

describe('named themes', () => {
    it('resolve by name as well as by object', () => {
        expect(resolveTheme('dark').background).toBe(themes.dark.background);
        expect(resolveTheme(themes.nyt).ink).toBe('#2f6b9a');
        expect(resolveTheme('nyt').ink).toBe('#2f6b9a');
    });

    it('a partial may extend a named theme and override it', () => {
        const t = resolveTheme({ extends: 'economist', ink: 'crimson' });
        expect(t.ink).toBe('crimson');
        expect(t.palette[0]).toBe('#006ba2');
        expect(t.font.family).toContain('Helvetica Neue');
    });

    it('pop extends swiss, as in Flint', () => {
        const t = resolveTheme('pop');
        expect(t.background).toBe('#fff200');
        // Inherited from swiss, not restated by pop.
        expect(t.axis.continuous.tickSize).toBeGreaterThan(0);
    });

    it('setTheme takes a name too', () => {
        setTheme('bbc');
        expect(resolveTheme().ink).toBe('#1380a1');
    });

    it('an unknown name falls back to the default look', () => {
        expect(resolveTheme('nope').ink).toBe(resolveTheme().ink);
    });

    it('every built-in theme renders a bar chart, a line chart and a legend', async () => {
        setWarnings(true);
        const warned = [];
        const orig = console.warn;
        console.warn = (m) => warned.push(String(m));
        try {
            for (const name of Object.keys(themes)) {
                bars({ theme: name, title: 'T', subtitle: 'S', caption: 'C' });
                const el = Elicit({
                    width: 300, height: 200, theme: name, legends: true,
                    schema: { x: { type: 'quantitative', domain: [0, 2] }, y: { type: 'quantitative', domain: [0, 10] }, s: { type: 'categorical', domain: ['p', 'q'] } },
                    data: [{ x: 0, y: 1, s: 'p' }, { x: 2, y: 5, s: 'p' }, { x: 0, y: 3, s: 'q' }, { x: 2, y: 9, s: 'q' }],
                    marks: [plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' }, stroke: { field: 's' } } })],
                });
                document.body.appendChild(el);
            }
            await tick();
        } finally {
            console.warn = orig;
            setWarnings(false);
        }
        expect(warned.filter((w) => w.includes('[elicit]'))).toEqual([]);
    });

    it('a theme that asks for a value grid gets one on the value axis only', async () => {
        const el = bars({ theme: 'datawrapper' });
        await tick();
        const grid = bgLines(el).filter((d) => d.y1 === d.y2 && d.x1 === 0);
        const vertical = bgLines(el).filter((d) => d.x1 === d.x2 && d.y1 === 0);
        expect(grid.length).toBeGreaterThan(2);
        expect(vertical.length).toBe(0);
    });

    it('the band padding follows the theme', async () => {
        const plain = bars();
        const wide = bars({ theme: 'bbc' }); // bandFraction 0.9 -> padding 0.1 … same
        const narrow = bars({ theme: 'nature' }); // bandFraction 0.55 -> padding 0.45
        await tick();
        const w = (el) => nodes(el, 'rect.mark')[0].width;
        expect(w(narrow)).toBeLessThan(w(plain));
        expect(Math.abs(w(wide) - w(plain))).toBeLessThan(25);
    });

    it('a rounded house rounds its bars', async () => {
        const el = bars({ theme: 'material' });
        await tick();
        expect(nodes(el, 'rect.mark')[0].rx).toBe(4);
    });
});

describe('axis styling', () => {
    it('line: false drops the spine and tickSize: 0 the ticks', async () => {
        const el = bars({ axes: { x: { line: false, tickSize: 0 }, y: false } });
        await tick();
        expect(bgLines(el).length).toBe(0);
        expect(labels(el).map((d) => d.text)).toEqual(['a', 'b', 'c']);
    });

    it('labelAngle turns the labels and reserves room for them', async () => {
        const flat = bars({ axes: { x: {}, y: false } });
        const turned = bars({ axes: { x: { labelAngle: 45, tickFormat: (v) => `category ${v}` }, y: false } });
        await tick();
        const l = labels(turned)[0];
        expect(l.angle).toBe(45);
        expect(l.textAnchor).toBe('end');
        const top = (el) => +el.querySelector('g.scene-container').getAttribute('transform').match(/,([\d.]+)\)/)[1];
        const plotH = (el) => nodes(el, 'rect.mark').reduce((m, d) => Math.max(m, d.y + d.height), 0);
        expect(top(turned)).toBe(top(flat));
        expect(plotH(turned)).toBeLessThan(plotH(flat));
    });

    it('a newline in a tick label is a second line', async () => {
        const el = bars({ axes: { x: { tickFormat: (v) => `${v}\n2024` }, y: false } });
        await tick();
        const l = labels(el)[0];
        expect(l.lines).toEqual(['a', '2024']);
        expect(l.lineAnchor).toBe('top');
    });

    it('tick options take a per-tick function', async () => {
        const el = bars({ axes: { x: { tickSize: (v) => (v === 'b' ? 12 : 4), fontWeight: (v) => (v === 'b' ? 'bold' : null) }, y: false } });
        await tick();
        const ticks = bgLines(el).filter((d) => d.x1 === d.x2);
        expect(ticks.map((d) => d.y2 - d.y1).sort((a, b) => a - b)).toEqual([4, 4, 12]);
        expect(labels(el).find((d) => d.text === 'b').fontWeight).toBe('bold');
        expect(labels(el).find((d) => d.text === 'a').fontWeight).toBeUndefined();
    });

    it('theme tokens per scale kind', async () => {
        const el = bars({ theme: { axis: { continuous: { line: false }, discrete: { tickSize: 0 } } } });
        await tick();
        const spines = bgLines(el).filter((d) => (d.x1 === d.x2 && d.y2 - d.y1 > 100) || (d.y1 === d.y2 && d.x2 - d.x1 > 100));
        // Only the x (discrete) spine survives; the y (continuous) one is gone.
        expect(spines.length).toBe(1);
        expect(spines[0].y1).toBe(spines[0].y2);
    });

    it('title paint is separate from label paint', async () => {
        const el = bars({ axes: { x: false, y: { title: 'Value', fill: 'red', titleFill: 'blue', titleFontWeight: 700 } } });
        await tick();
        const title = labels(el).find((d) => d.text === 'Value');
        expect(title.fill).toBe('blue');
        expect(title.fontWeight).toBe(700);
        expect(labels(el).find((d) => d.text !== 'Value').fill).toBe('red');
    });
});

describe('the space-saving axis', () => {
    const spaceSaving = () => {
        const el = Elicit({
            width: 300, height: 180, margins: { top: 20, right: 10, bottom: 30, left: 4 },
            schema: { k: { type: 'categorical', domain: ['a', 'b', 'c'] }, v: { type: 'quantitative', domain: [0, 10] } },
            data: [{ k: 'a', v: 4 }, { k: 'b', v: 8 }, { k: 'c', v: 6 }],
            axes: {
                x: false,
                y: {
                    line: false, tickSize: 0, tickPadding: -5, labelAlign: 'start', labelOffset: -15,
                    title: 'Origin', titleAngle: 0, titleAnchor: 'end',
                    grid: { bandPosition: 0 },
                },
            },
            marks: [plot.barX({ channels: { y: { field: 'k', scale: { padding: 0 } }, x: { field: 'v' } } })],
        });
        document.body.appendChild(el);
        return el;
    };

    it('puts the labels inside the plot, above each band centre', async () => {
        const el = spaceSaving();
        await tick();
        const ls = labels(el).filter((d) => ['a', 'b', 'c'].includes(d.text));
        expect(ls.every((d) => d.textAnchor === 'start' && d.x === 5)).toBe(true);
        const bar = nodes(el, 'rect.mark').find((d) => d.data.k === 'a');
        const centre = bar.y + bar.height / 2;
        expect(ls.find((d) => d.text === 'a').y).toBeLessThan(centre);
    });

    it('reserves no side room for inward labels', async () => {
        const el = spaceSaving();
        await tick();
        expect(el.querySelector('g.scene-container').getAttribute('transform')).toMatch(/^translate\(4,/);
    });

    it('draws band gridlines between the categories', async () => {
        const el = spaceSaving();
        await tick();
        const grid = bgLines(el).filter((d) => d.y1 === d.y2).map((d) => d.y1).sort((a, b) => a - b);
        // Three bands of a 130px plot with no padding: edges at 0, 43.3, 86.7.
        expect(grid.length).toBe(3);
        expect(grid[0]).toBeCloseTo(0, 5);
        expect(grid[1]).toBeCloseTo(130 / 3, 3);
    });

    it('sets a flat y title at the top of the axis', async () => {
        const el = spaceSaving();
        await tick();
        const t = labels(el).find((d) => d.text === 'Origin');
        expect(t.y).toBeLessThan(0);
        expect(t.textAnchor).toBe('start');
        expect(t.angle).toBeUndefined();
    });

    it('anchors a rotated title at either end', async () => {
        const el = bars({ axes: { x: { title: 'k', titleAnchor: 'end' }, y: { title: 'v', titleAnchor: 'end' } } });
        await tick();
        const ty = labels(el).find((d) => d.text === 'v');
        const tx = labels(el).find((d) => d.text === 'k');
        expect(ty.y).toBe(0);
        expect(ty.textAnchor).toBe('end');
        expect(tx.textAnchor).toBe('end');
    });
});

describe('grid, panel, legend and text', () => {
    it('a grid takes a dash, and a zero line', async () => {
        const el = bars({ axes: { x: false, y: { grid: { strokeDash: '1 3', zero: { stroke: 'black', strokeWidth: 2 } } } } });
        await tick();
        const grid = bgLines(el).filter((d) => d.x1 === 0 && d.y1 === d.y2);
        expect(grid.some((d) => d.strokeDasharray === '1 3')).toBe(true);
        expect(grid.some((d) => d.stroke === 'black' && d.strokeWidth === 2)).toBe(true);
    });

    it('theme.panel paints the plot area under everything', async () => {
        const el = bars({ theme: { panel: { fill: '#ebebeb' } }, axes: { y: { grid: true } } });
        await tick();
        const panel = nodes(el, 'rect.bg-rect').find((d) => d.panel);
        expect(panel.fill).toBe('#ebebeb');
        const bg = el.querySelector('rect.bg-rect');
        expect(bg.__data__).toBe(panel);
    });

    it('legend chips round with the theme', async () => {
        const el = bars({ theme: 'material', legends: true }, { channels: { x: { field: 'k' }, y: { field: 'v' }, fill: { field: 'k' } } });
        await tick();
        const chips = nodes(el, 'rect.bg-rect').filter((d) => !d.panel && d.width === d.height);
        expect(chips.length).toBe(3);
        expect(chips[0].rx).toBe(7);
    });

    it('a text mark carries weight, style and family to the svg', async () => {
        const el = Elicit({
            width: 200, height: 100, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 1] } },
            data: [{ x: 0.5 }],
            marks: [plot.text({ text: 'hi', fontWeight: 'bold', fontStyle: 'italic', fontFamily: 'Georgia', channels: { x: { field: 'x' } } })],
        });
        document.body.appendChild(el);
        await tick();
        const t = [...el.querySelectorAll('text')].find((n) => n.textContent === 'hi');
        expect(t.getAttribute('font-weight')).toBe('bold');
        expect(t.getAttribute('font-style')).toBe('italic');
        expect(t.getAttribute('font-family')).toBe('Georgia');
    });

    it('a title takes its own family', async () => {
        const el = bars({ title: 'Headline', theme: 'nyt' });
        await tick();
        const t = [...el.querySelectorAll('text')].find((n) => n.textContent === 'Headline');
        expect(t.getAttribute('font-family')).toBe('Georgia, serif');
    });

    it('bar takes rx', async () => {
        const el = bars({}, { rx: 3 });
        await tick();
        expect(nodes(el, 'rect.mark').every((d) => d.rx === 3)).toBe(true);
    });

    it('elements.gridY reads theme dash', async () => {
        const el = bars({ theme: { grid: { strokeDash: '2 2' } }, axes: false, elements: [elements.gridY()] });
        await tick();
        expect(bgLines(el).every((d) => d.strokeDasharray === '2 2')).toBe(true);
    });
});
