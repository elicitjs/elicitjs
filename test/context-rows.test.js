// @vitest-environment jsdom
// CONTEXT rows (spec.context) are reference rows of the elicited table: drawn,
// locked, and left out of everything the chart reports. Membership is decided
// once, over the seed, and held as row identity.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';
import { lockConstraint } from '../src/core/lock.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const HISTORY = [{ year: 2000, value: 20 }, { year: 2010, value: 30 }, { year: 2020, value: 40 }];
const FORECAST = [{ year: 2025, value: 50 }, { year: 2030, value: 50 }];

function chart(extra = {}) {
    const changes = [];
    const el = Elicit({
        width: 300, height: 200, axes: false, margins: { top: 10, right: 10, bottom: 10, left: 10 },
        schema: { year: { type: 'quantitative', domain: [2000, 2030] }, value: { type: 'quantitative', domain: [0, 100] } },
        data: [...HISTORY, ...FORECAST],
        context: (d) => d.year <= 2020,
        onChange: (d) => changes.push(d),
        marks: [
            plot.point({
                channels: { x: { field: 'year' }, y: { field: 'value' } },
                edits: [edit.move({ name: 'xy', channels: ['x', 'y'] })],
            }),
        ],
        ...extra,
    });
    document.body.appendChild(el);
    return { el, changes };
}

afterEach(() => { vi.restoreAllMocks(); setWarnings(true); });

describe('context rows', () => {
    it('are left out of getData() and onChange, which stay bare arrays', async () => {
        setWarnings(false);
        const { el, changes } = chart();
        await tick();
        expect(el.getData()).toEqual(FORECAST);
        expect(Object.keys(el.getSchema())).toEqual(['year', 'value']);
        el.control('xy', 0).set({ value: 70 });
        expect(changes.length).toBe(1);
        expect(changes[0].length).toBe(2);
        expect(changes[0][0].year).toBe(2025);       // index 0 is the first REPORTED row
        expect(changes[0][0].value).toBeCloseTo(70, 6);
    });

    it('are drawn and locked', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        const dots = [...el.querySelectorAll('circle.mark:not([data-hit])')];
        expect(dots.length).toBe(5);
        const inert = dots.filter((c) => c.style.pointerEvents === 'none');
        expect(inert.length).toBe(3);
    });

    it('are decided once: an answer moved into the predicate region stays an answer', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        el.control('xy', 0).set({ year: 2005, value: 10 });
        const data = el.getData();
        expect(data.length).toBe(2);
        expect(data[0].year).toBeCloseTo(2005, 0);
    });

    it('`context: true` makes every seeded row context; created rows are reported', async () => {
        setWarnings(false);
        const { el } = chart({
            context: true,
            marks: [plot.point({ channels: { x: { field: 'year' }, y: { field: 'value' } }, edits: [edit.create({ name: 'add' })] })],
        });
        await tick();
        expect(el.getData()).toEqual([]);
        el.emit({ type: 'click', x: 140, y: 90 });
        expect(el.getData().length).toBe(1);
    });

    it('survive setData() and undo', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        el.setData([{ year: 2026, value: 10 }]);
        await tick();
        expect(el.getData()).toEqual([{ year: 2026, value: 10 }]);
        expect(el.querySelectorAll('circle.mark:not([data-hit])').length).toBe(4);
        el.control('xy', 0).set({ value: 60 });
        expect(el.getData()[0].value).toBeCloseTo(60, 6);
        el.undo();
        expect(el.getData()).toEqual([{ year: 2026, value: 10 }]);
        el.redo();
        expect(el.getData().length).toBe(1);
        expect(el.getData()[0].value).toBeCloseTo(60, 6);
    });

    it('selection speaks reported indices', async () => {
        setWarnings(false);
        const { el } = chart();
        await tick();
        el.selectAll();
        expect(el.getSelectionAll()).toEqual([0, 1]);
        el.select(1);
        expect(el.getSelection()).toBe(1);
        el.selectWhere('year', 2030);
        expect(el.getSelection()).toBe(1);
        el.selectWhere('year', 2000);           // a context row is not selectable by the API
        expect(el.getSelection()).toBe(null);
    });

    it('the removed `{ context: true, fields }` table form says what replaced it', () => {
        expect(() => Elicit({
            schema: { data: { y: { type: 'quantitative' } }, history: { context: true, fields: { y: { type: 'quantitative' } } } },
            marks: [],
        })).toThrow(/spec.*context|`context` on the spec/);
    });

    it('warns when the predicate matches no seeded row', async () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        setWarnings(true);
        chart({ context: (d) => d.year < 1900 });
        await tick();
        expect(spy.mock.calls.some((c) => /spec\.context matched none/.test(String(c[0])))).toBe(true);
    });
});

describe('lockConstraint keeps locked rows by identity', () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const lockFirst = lockConstraint((_d, i) => i === 0);

    it('a whole-dataset rebuild gets the original locked object back', () => {
        const out = lockFirst.apply({ data: rows.map((d) => ({ ...d })), oldData: rows });
        expect(out[0]).toBe(rows[0]);
    });

    it('a delete that rebuilt the survivors gets the original locked object back', () => {
        const out = lockFirst.apply({ data: [{ a: 1 }, { a: 3 }], oldData: rows });
        expect(out[0]).toBe(rows[0]);
        expect(out.length).toBe(2);
    });

    it('deleting a locked row is still refused', () => {
        expect(lockFirst.apply({ data: [rows[1], rows[2]], oldData: rows })).toBe(false);
    });
});

// Reference rows with other columns share the table, each filling its own: a mark
// over columns a row leaves empty draws nothing for that row.
describe('a row missing a mark\'s columns draws nothing for it', () => {
    const rows = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { cat: 'a', lo: 1, hi: 3, label: 'L' }, { cat: 'b', lo: 2, hi: 4, label: 'M' }];
    const draw = async (mark) => {
        const el = Elicit({
            width: 300, height: 200, axes: false, context: true,
            schema: {
                x: { type: 'quantitative', domain: [0, 5] }, y: { type: 'quantitative', domain: [0, 5] },
                cat: { type: 'categorical', domain: ['a', 'b'] }, lo: { type: 'quantitative' },
                hi: { type: 'quantitative' }, label: { type: 'categorical' },
            },
            data: rows, marks: [mark],
        });
        document.body.appendChild(el);
        await tick();
        return el;
    };

    it('text', async () => {
        const el = await draw(plot.text({ channels: { x: { field: 'lo' }, y: { field: 'hi' }, text: { field: 'label' } } }));
        expect([...el.querySelectorAll('text.mark')].map((t) => t.textContent)).toEqual(['L', 'M']);
    });

    it('rect', async () => {
        const el = await draw(plot.rect({ channels: { x1: { field: 'lo' }, x2: { field: 'hi' }, y1: { field: 'lo' }, y2: { field: 'hi' } } }));
        expect(el.querySelectorAll('rect.mark:not([data-hit])').length).toBe(2);
    });

    it('bar with no category', async () => {
        const el = await draw(plot.barY({ channels: { x: { field: 'cat' }, y1: { field: 'lo' }, y2: { field: 'hi' } } }));
        expect(el.querySelectorAll('rect.mark:not([data-hit])').length).toBe(2);
    });
});

describe('a span rule over a row missing its columns draws nothing', () => {
    it('neither at the centre nor as a zero-length line', async () => {
        setWarnings(false);
        const el = Elicit({
            width: 300, height: 200, axes: false, context: (d) => d.hp != null,
            schema: {
                hp: { type: 'quantitative', domain: [0, 240] }, mpg: { type: 'quantitative', domain: [0, 50] },
                lo: { type: 'quantitative', domain: [0, 50] }, hi: { type: 'quantitative', domain: [0, 50] },
            },
            data: [{ hp: 100, mpg: 20 }, { lo: 25, hi: 30 }],
            marks: [
                plot.ruleY({ channels: { x1: { datum: 0 }, x2: { datum: 240 }, y: { field: 'lo' } } }),
                plot.ruleX({ channels: { x: { field: 'hp' }, y1: { field: 'lo' }, y2: { field: 'hi' } } }),
            ],
        });
        document.body.appendChild(el);
        await tick();
        // One horizontal rule for the answer row; no vertical rule (no hp on it,
        // and the car row has no lo/hi).
        expect(el.querySelectorAll('line.mark').length).toBe(1);
    });
});

// Every mark: a row that fills none of the mark's columns adds nothing to it.
describe('every mark ignores a row with none of its columns', () => {
    const schema = {
        x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] },
        x2: { type: 'quantitative', domain: [0, 10] }, y2: { type: 'quantitative', domain: [0, 10] },
        cat: { type: 'categorical', domain: ['a', 'b'] }, v: { type: 'quantitative', domain: [0, 10] },
        intercept: { type: 'quantitative', domain: [0, 10] }, slope: { type: 'quantitative', domain: [-2, 2] },
        other: { type: 'quantitative' },
    };
    const full = { x: 2, y: 3, x2: 5, y2: 6, cat: 'a', v: 4, intercept: 3, slope: 0.5 };
    const cases = {
        point: () => plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
        shape: () => plot.shape({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
        ellipse: () => plot.ellipse({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
        text: () => plot.text({ channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 'cat' } } }),
        trend: () => plot.trend({ channels: { intercept: { field: 'intercept' }, slope: { field: 'slope' } } }),
        curve: () => plot.curve({ channels: { x1: { field: 'x' }, y1: { field: 'y' }, x2: { field: 'x2' }, y2: { field: 'y2' } } }),
        needle: () => plot.needle({ channels: { theta: { field: 'v' } } }),
        waffle: () => plot.waffle({ channels: { x: { field: 'cat' }, count: { field: 'v' } } }),
        dotStack: () => plot.dotStack({ channels: { x: { field: 'cat' } } }),
        barY: () => plot.barY({ channels: { x: { field: 'cat' }, y: { field: 'v' } } }),
        ruleY: () => plot.ruleY({ channels: { y: { field: 'y' } } }),
    };
    // A line or area over a row with none of its columns neither draws it nor
    // breaks there: the two answer points stay joined.
    it('line and area stay joined across a row with none of their columns', async () => {
        setWarnings(false);
        for (const make of [() => plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
            () => plot.areaY({ channels: { x: { field: 'x' }, y: { field: 'y' } } })]) {
            const el = Elicit({ width: 300, height: 200, axes: false, schema, context: (d) => d.other != null,
                data: [{ x: 1, y: 1 }, { other: 1 }, { x: 9, y: 9 }], marks: [make()] });
            document.body.appendChild(el);
            await tick();
            const paths = [...el.querySelectorAll('svg path')].filter((p) => !p.hasAttribute('data-hit'));
            expect(paths.length).toBe(1);
            expect((paths[0].getAttribute('d').match(/M/g) || []).length).toBe(1);
        }
    });
    const count = async (mark, data) => {
        const el = Elicit({ width: 300, height: 200, axes: false, schema, data, context: true, marks: [mark] });
        document.body.appendChild(el);
        await tick();
        return el.querySelectorAll('svg .mark:not([data-hit])').length;
    };
    for (const [name, make] of Object.entries(cases)) {
        it(name, async () => {
            setWarnings(false);
            expect(await count(make(), [full, { other: 1 }])).toBe(await count(make(), [full]));
        });
    }
});
