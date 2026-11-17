// @vitest-environment jsdom
// The widget designs: every widget draws in every design, a design is chosen by
// theme, the default look is the one the widgets have always had, and a design
// registered from outside restyles the same widgets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Elicit, widgets, compile, themes, resolveTheme, DEFAULT_THEME, setWarnings, authoring } from '../src/index.js';
import { designOf } from '../src/widgets/designs.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const DESIGN_THEMES = [undefined, 'survey', 'surveyBlocks', 'surveyLines'];
const OPTIONS = {
    likert: { options: ['a', 'b', 'c'], value: 'b', question: 'Q' },
    multipleChoice: { options: ['a', 'b', 'c'], value: ['a'], max: 2, question: 'Q' },
    slider: { domain: [0, 100], value: 40 },
    matrix: { questions: ['q1', 'q2'], options: ['x', 'y', 'z'], value: [{ question: 'q1', option: 'y' }] },
    ranking: { items: ['Cost', 'Speed', 'Quality'] },
    allocation: {}, probabilityTokens: {}, interval: {}, histogram: {}, region: {}, thermometer: {},
    labeledValue: {}, lineCone: {},
};

/** Mount a spec and draw it once. */
const mount = (spec) => {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    vi.advanceTimersByTime(20);
    return el;
};
/** Run `fn` and collect every `[elicit]` warning it makes. */
const warningsOf = (fn) => {
    const seen = [];
    const original = console.warn;
    console.warn = (...args) => seen.push(args.join(' '));
    setWarnings(true);
    try { fn(); } finally { setWarnings(false); console.warn = original; }
    return seen.filter((w) => w.includes('[elicit]'));
};
const all = (el, tag) => [...el.dom().querySelectorAll(tag)];
const num = (node, name) => +node.getAttribute(name);

describe('every widget in every design', () => {
    it('covers all thirteen widgets', () => {
        expect(Object.keys(OPTIONS).sort()).toEqual(Object.keys(widgets).sort());
    });
    for (const theme of [...DESIGN_THEMES, 'dark']) {
        it(`draws with no warning in ${theme || 'the default theme'}`, () => {
            const warnings = warningsOf(() => {
                for (const [name, o] of Object.entries(OPTIONS)) {
                    const el = mount(widgets[name]({ ...o, theme }));
                    expect(el.dom().querySelector('svg')).toBeTruthy();
                    el.destroy();
                }
            });
            expect(warnings).toEqual([]);
        });
    }
    it('compiles from JSON with a theme beside it', () => {
        for (const [name, o] of Object.entries(OPTIONS)) {
            const made = compile(JSON.parse(JSON.stringify({ widget: { type: name, ...o }, theme: 'surveyBlocks' })));
            expect(Array.isArray(made.marks)).toBe(true);
            expect(made.theme).toBe('surveyBlocks');
        }
        // The widget's own `theme` option is plain data too.
        const made = compile({ widget: { type: 'ranking', items: ['a', 'b'], theme: 'surveyLines' } });
        expect(made.theme.widget.design).toBe('line');
    });
});

describe('the widget tokens', () => {
    const TOKENS = Object.keys(DEFAULT_THEME.widget);
    it('are all resolved by every named theme', () => {
        for (const name of Object.keys(themes)) {
            const t = resolveTheme(name).widget;
            for (const key of TOKENS) expect(t[key], `${name}.widget.${key}`).not.toBeUndefined();
        }
    });
    it('name a design per survey theme', () => {
        expect(resolveTheme().widget.design).toBe('ring');
        expect(resolveTheme('survey').widget.design).toBe('box');
        expect(resolveTheme('surveyBlocks').widget.design).toBe('block');
        expect(resolveTheme('surveyLines').widget.design).toBe('line');
    });
    it('let any colour theme take any design', () => {
        const t = resolveTheme({ extends: 'dark', widget: { design: 'block' } }).widget;
        expect(t.design).toBe('block');
        expect(t.accent).toBe(themes.dark.widget.accent);
    });
    it('are pinned on the spec, so marks and guides read one look', () => {
        const spec = widgets.likert({ options: ['a', 'b'], theme: { widget: { accent: '#123456' } } });
        expect(spec.theme.widget.accent).toBe('#123456');
        expect(spec.theme.widget.design).toBe('ring');
        expect(spec.marks[0].channels.fill.value).toBe('#123456');
    });
});

describe('the default look is unchanged', () => {
    it('likert: rings on a track, a filled dot, labels under the rings', () => {
        const spec = widgets.likert({ options: ['a', 'b', 'c'], value: 'b', question: 'Q' });
        expect([spec.width, spec.height]).toEqual([560, 130]);
        expect(spec.margins).toEqual({ top: 34, right: 60, bottom: 44, left: 60 });
        expect(spec.scales).toEqual({ x: { type: 'band' } });
        const el = mount(spec);
        const circles = all(el, 'circle');
        const rings = circles.filter((c) => c.getAttribute('fill') === 'none');
        const dots = circles.filter((c) => c.getAttribute('fill') === '#2563eb');
        expect(rings.map((c) => num(c, 'r'))).toEqual([11, 11, 11]);
        expect(rings.every((c) => c.getAttribute('stroke') === '#cbd5e1' && num(c, 'stroke-width') === 1.5)).toBe(true);
        expect(dots.map((c) => num(c, 'r'))).toEqual([8]);
        expect(num(dots[0], 'cx')).toBeCloseTo(num(rings[1], 'cx'), 6);
        expect(num(dots[0], 'cy')).toBe(26); // the plot's centre line
        const track = all(el, 'line').filter((l) => l.getAttribute('stroke') === '#e2e8f0');
        expect(track.length).toBe(2);
        expect(num(track[0], 'x1')).toBeCloseTo(num(rings[0], 'cx') + 11, 6);
        expect(num(track[0], 'stroke-width')).toBe(3);
        const labels = all(el, 'text').filter((t) => ['a', 'b', 'c'].includes(t.textContent));
        expect(labels.map((t) => num(t, 'y'))).toEqual([56, 56, 56]); // 30 under the centre line
        expect(labels.every((t) => num(t, 'font-size') === 12 && t.getAttribute('fill') === '#334155')).toBe(true);
        const question = all(el, 'text').find((t) => t.textContent === 'Q');
        expect([num(question, 'y'), num(question, 'font-size'), question.getAttribute('font-weight')]).toEqual([-18, 13, null]);
        el.destroy();
    });
    it('multiple choice, slider and matrix keep their size, margins and answer mark', () => {
        const choice = widgets.multipleChoice({ options: ['a', 'b'], value: ['a'] });
        expect([choice.height, choice.margins.left, choice.marks[0].type]).toEqual([130, 60, 'point']);
        expect(choice.marks[0].channels.size.value).toBe(8);
        expect(Object.keys(choice.scales)).toEqual(['x']);
        const slider = widgets.slider({});
        expect([slider.height, slider.marks[0].channels.size.value, slider.marks[0].channels.fill.value]).toEqual([120, 9, '#2563eb']);
        expect(slider.marks[0].channels.stroke).toBeUndefined();
        const matrix = widgets.matrix({ questions: ['q'], options: ['x', 'y'] });
        expect([matrix.height, matrix.marks[0].type, matrix.marks[0].channels.size.value]).toEqual([146, 'point', 8]);
        const el = mount(matrix);
        const cells = all(el, 'rect').filter((r) => r.getAttribute('fill') === '#f8fafc');
        expect(cells.length).toBe(2);
        expect(cells.every((r) => r.getAttribute('stroke') === '#e2e8f0')).toBe(true);
        el.destroy();
    });
});

describe('an answer in each design', () => {
    for (const theme of DESIGN_THEMES) {
        it(`likert takes a click on an option in ${theme || 'the default theme'}`, () => {
            const spec = widgets.likert({ options: ['a', 'b', 'c'], width: 360, theme });
            const el = mount(spec);
            const inner = 360 - spec.margins.left - spec.margins.right;
            const plotHeight = spec.height - spec.margins.top - spec.margins.bottom;
            el.emit({ type: 'click', x: inner * 5 / 6, y: plotHeight / 2 });
            expect(el.getData()).toEqual([{ choice: 'c' }]);
            el.emit({ type: 'click', x: inner / 6, y: plotHeight / 2 });
            expect(el.getData()).toEqual([{ choice: 'a' }]); // one answer: it moves
            el.destroy();
        });
    }
    it('multiple choice stacks as a list in the three form designs, and runs in a row in rings', () => {
        expect(Object.keys(widgets.multipleChoice({ options: ['a'] }).scales)).toEqual(['x']);
        for (const theme of ['survey', 'surveyBlocks', 'surveyLines']) {
            expect(Object.keys(widgets.multipleChoice({ options: ['a'], theme }).scales)).toEqual(['y']);
        }
    });
    for (const theme of ['survey', 'surveyBlocks', 'surveyLines']) {
        it(`multiple choice toggles a row and holds to max in ${theme}`, () => {
            const spec = widgets.multipleChoice({ options: ['a', 'b', 'c'], max: 2, width: 360, theme });
            const el = mount(spec);
            const plotHeight = spec.height - spec.margins.top - spec.margins.bottom;
            const rowY = (i) => plotHeight * (i + 0.5) / 3;
            el.emit({ type: 'click', x: 150, y: rowY(0) });
            el.emit({ type: 'click', x: 150, y: rowY(2) });
            expect(el.getData().map((d) => d.choice).sort()).toEqual(['a', 'c']);
            el.emit({ type: 'click', x: 150, y: rowY(1) }); // a third is refused
            expect(el.getData().map((d) => d.choice).sort()).toEqual(['a', 'c']);
            el.emit({ type: 'click', x: 150, y: rowY(0) }); // and a chosen one comes off
            expect(el.getData().map((d) => d.choice)).toEqual(['c']);
            el.destroy();
        });
    }
    it('draws the chosen option as the design says', () => {
        const box = mount(widgets.likert({ options: ['a', 'b'], value: 'b', theme: 'survey' }));
        const boxes = all(box, 'rect').filter((r) => num(r, 'height') === 74 && num(r, 'rx') === 8);
        expect(boxes.map((r) => r.getAttribute('stroke'))).toEqual(['#d3d9e3', '#4f46e5']);
        expect(boxes[1].getAttribute('fill')).toBe('#eeeffe');
        box.destroy();
        const block = mount(widgets.likert({ options: ['a', 'b'], value: 'b', theme: 'surveyBlocks' }));
        const blocks = all(block, 'rect').filter((r) => num(r, 'height') === 54 && num(r, 'rx') === 6);
        // Two soft blocks, and the answer's own solid block over the second.
        expect(blocks.map((r) => r.getAttribute('fill')).sort()).toEqual(['#0f766e', '#eef1f6', '#eef1f6']);
        const solid = blocks.find((r) => r.getAttribute('fill') === '#0f766e');
        const under = blocks.filter((r) => r.getAttribute('fill') === '#eef1f6')[1];
        expect(num(solid, 'x')).toBeCloseTo(num(under, 'x'), 6);
        expect(num(solid, 'width')).toBeCloseTo(num(under, 'width'), 6);
        block.destroy();
    });
});

describe('the ranking card', () => {
    const items = ['Cost', 'Speed', 'Quality'];
    const labelY = (el) => Object.fromEntries(all(el, 'text')
        .filter((t) => items.includes(t.textContent)).map((t) => [t.textContent, num(t, 'y')]));
    for (const theme of DESIGN_THEMES) {
        it(`puts rank 1 at the top and reorders on a drag of the body in ${theme || 'the default theme'}`, () => {
            const el = mount(widgets.ranking({ items, theme }));
            const y = labelY(el);
            expect(y.Cost).toBeLessThan(y.Speed);
            expect(y.Speed).toBeLessThan(y.Quality);
            const node = { index: 0, featureId: 'rank/body' };
            el.emit({ type: 'dragstart', node, x: 100, y: y.Cost });
            el.emit({ type: 'drag', node, x: 100, y: y.Quality });
            el.emit({ type: 'dragend', node, x: 100, y: y.Quality });
            expect(el.getData().map((d) => [d.item, d.rank])).toEqual([['Cost', 3], ['Speed', 1], ['Quality', 2]]);
            el.destroy();
        });
    }
    it('is one glyph whose body alone takes the drag, and every part eases', () => {
        const marks = widgets.ranking({ items }).marks.flat();
        expect(marks.map((m) => m.id)).toEqual(['rank/body', 'rank/badge', 'rank/rank', 'rank/label', 'rank/grip']);
        expect(marks.every((m) => m.motion === true)).toBe(true);
        expect(new Set(marks.map((m) => m.glyph)).size).toBe(1);
        const edits = marks.map((m) => Object.values(m.channels).filter((c) => c && c.edit).length + (m.edits || []).length);
        expect(edits).toEqual([1, 0, 0, 0, 0]);
    });
    it('carries the whole card with the pointer and eases the others', () => {
        vi.useRealTimers();
        vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'] });
        const el = mount(widgets.ranking({ items, theme: 'survey' }));
        const y = labelY(el);
        const node = { index: 0, featureId: 'rank/body' };
        el.emit({ type: 'dragstart', node, x: 100, y: y.Cost });
        el.emit({ type: 'drag', node, x: 100, y: y.Cost + 13 });
        const body = all(el, 'rect').find((r) => Math.abs(num(r, 'y') + num(r, 'height') / 2 - (y.Cost + 13)) < 1e-6);
        expect(body).toBeTruthy();                             // the body is on the pointer
        expect(labelY(el).Cost).toBeCloseTo(y.Cost + 13, 5);   // and so is its label
        const grip = all(el, 'path').map((p) => p.getAttribute('d')).filter((d) => d && d.includes('C'));
        expect(new Set(grip).size).toBe(3);                    // the carried grip was redrawn apart from the others
        el.emit({ type: 'drag', node, x: 100, y: y.Speed + 6 });
        expect(labelY(el).Speed).toBeCloseTo(y.Speed, 5);      // not moved yet
        for (let k = 0; k < 40; k++) vi.advanceTimersByTime(16);
        expect(labelY(el).Speed).toBeCloseTo(y.Cost, 5);
        el.emit({ type: 'dragend', node, x: 100, y: y.Speed + 6 });
        for (let k = 0; k < 40; k++) vi.advanceTimersByTime(16);
        expect(labelY(el).Cost).toBeCloseTo(y.Speed, 5);
        el.destroy();
    });
});

describe('registering a design', () => {
    it('restyles the widgets from the parts it states, and takes the rest from what it extends', () => {
        authoring.registerDesign('test-pill', {
            extends: 'box',
            option: (o, t) => [{ type: 'rect', x: o.x, y: o.y, width: o.width, height: o.height, rx: o.height / 2,
                fill: o.selected ? t.accent : t.soft, stroke: 'none' }],
            theme: { extends: 'survey', widget: { accent: '#aa0055', optionHeight: 44 } },
        });
        expect(authoring.designNames()).toContain('test-pill');
        const design = designOf('test-pill');
        expect(design.tiles).toBe(true);                      // from `box`
        expect(typeof design.card).toBe('function');          // from `box`
        expect(typeof design.slots).toBe('function');         // from `ring`
        const t = resolveTheme('test-pill').widget;           // its theme is registered under its name
        expect([t.design, t.accent, t.optionHeight, t.questionWeight]).toEqual(['test-pill', '#aa0055', 44, 600]);
        const warnings = warningsOf(() => {
            const el = mount(widgets.likert({ options: ['a', 'b'], value: 'a', theme: 'test-pill' }));
            const pills = all(el, 'rect').filter((r) => num(r, 'height') === 44 && num(r, 'rx') === 22);
            expect(pills.map((r) => r.getAttribute('fill'))).toEqual(['#aa0055', resolveTheme('survey').widget.soft]);
            el.destroy();
            // Every other widget draws in it too.
            for (const [name, o] of Object.entries(OPTIONS)) mount(widgets[name]({ ...o, theme: 'test-pill' })).destroy();
        });
        expect(warnings).toEqual([]);
    });
    it('warns on a design that is not registered, and draws rings', () => {
        const warnings = warningsOf(() => {
            const spec = widgets.likert({ options: ['a'], theme: { widget: { design: 'no-such-design' } } });
            expect(spec.marks[0].type).toBe('point');
        });
        expect(warnings.some((w) => w.includes('no-such-design') && w.includes('registerDesign'))).toBe(true);
    });
    it('warns on a part a design cannot draw, and will not replace a built-in theme', () => {
        const warnings = warningsOf(() => {
            authoring.registerDesign('test-odd', { options: () => [] });
            authoring.registerDesign('dark', { theme: { widget: { accent: 'red' } } });
        });
        expect(warnings.some((w) => w.includes('"options"'))).toBe(true);
        expect(warnings.some((w) => w.includes('built-in theme'))).toBe(true);
        expect(themes.dark.widget.accent).toBe('#38bdf8');
    });
});
