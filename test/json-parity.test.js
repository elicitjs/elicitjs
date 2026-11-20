// JSON and JavaScript are one grammar: a spec written in JavaScript, recorded as
// JSON and compiled back, must make the same factory calls with the same options.
// Factories are replaced by spies that return their call, so the two specs are
// compared as call trees; nothing is drawn.
import { describe, it, expect } from 'vitest';
import { SPEC_POSITIONAL } from '../src/vocabulary.js';
import { createCompiler } from '../src/json/compile.js';
import { createRecorder } from '../src/json/record.js';
import { keywordTables } from '../src/json/keywords.js';
import { NAMESPACES } from '../src/json/index.js';

/** A namespace whose factories return `{ $call, args }` instead of building. */
function spies(ns, path) {
    return Object.fromEntries(Object.entries(ns).map(([name, member]) => {
        const at = `${path}.${name}`;
        if (typeof member === 'function') {
            return [name, (...args) => {
                const call = { $call: at, args };
                // Some factories return a list, so an author may spread the result.
                Object.defineProperty(call, Symbol.iterator, { value: function* () { yield call; } });
                return call;
            }];
        }
        if (member && typeof member === 'object') return [name, spies(member, at)];
        return [name, member];
    }));
}

const SPY = {
    plot: spies(NAMESPACES.plot, 'plot'),
    elements: spies(NAMESPACES.elements, 'elements'),
    guides: spies(NAMESPACES.guides, 'guides'),
    looks: spies(NAMESPACES.looks, 'looks'),
    constraints: spies(NAMESPACES.constraints, 'constraints'),
    widgets: spies(NAMESPACES.widgets, 'widgets'),
    // `when` and `format` stay real: a spec holds their results as values.
    edit: { ...spies(NAMESPACES.edit, 'edit'), when: NAMESPACES.edit.when },
    format: NAMESPACES.format,
    renderers: NAMESPACES.renderers,
};
const compile = createCompiler(SPY);
const recorder = createRecorder(SPY);

/** A call tree with what cannot be compared made comparable. */
function canonical(value) {
    if (typeof value === 'function') return '[function]';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.flat(Infinity).map(canonical);
    if (value && typeof value === 'object') {
        if (value.constructor && value.constructor !== Object) return `[${value.constructor.name}]`;
        const out = {};
        for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = canonical(v);
        if (Array.isArray(out.args)) {
            // `move()` and `move({})` are the same call.
            while (out.args.length) {
                const last = out.args[out.args.length - 1];
                if (last === undefined || (last && typeof last === 'object' && !Array.isArray(last) && !Object.keys(last).length)) out.args.pop();
                else break;
            }
        }
        return out;
    }
    return value;
}

/** Run a fixture both ways and return the two call trees. */
function bothWays(fixture) {
    const direct = fixture(SPY);
    const rec = recorder();
    const { json, functions } = rec.toJSON(fixture(rec));
    const compiled = compile(JSON.parse(JSON.stringify(json)), { functions });
    return { direct: canonical(direct), compiled: canonical(compiled), json };
}

const snap = (ctx) => { ctx.event.preventDefault(); };
const tipText = (d) => [`${d.party}`, `${d.share.toFixed(0)}%`];

const FIXTURES = {
    'looks: options, a positional fragment and uniforms': ({ plot, looks }) => ({
        marks: [plot.barY({ channels: { x: { field: 'party' } } })],
        looks: [
            looks.rough({ scope: 'frame', roughness: 2, fill: 'solid' }),
            looks.halftone(),
            looks.custom('vec4 look(vec2 uv) { return texture2D(u_frame, uv); }', { uniforms: { k: 1, tint: [1, 0, 0] } }),
        ],
    }),
    'a bar chart with an edit and a constraint': ({ plot, edit, constraints }) => ({
        width: 400, height: 300,
        data: [{ party: 'A', share: 40 }],
        schema: { party: { type: 'categorical' }, share: { type: 'quantitative', domain: [0, 100] } },
        constraints: [constraints.clamp({ min: 0, max: 100 }), constraints.ordering({ field: ['lo', 'hi'] })],
        marks: [plot.barY({
            fill: '#50AEB7',
            channels: { x: { field: 'party' }, y: { field: 'share', edit: edit.move({ when: edit.when.noAlt }) } },
        })],
    }),
    'functions: expressions, named functions and predicates': ({ plot, edit, constraints, guides, format }) => ({
        lock: (d, i, table) => table === 'nodes' && d.kind === 'bucket',
        context: (d) => d.year <= 2020,
        onChange: snap,
        constraints: [constraints.custom(({ active }) => (active ? { hi: active.hi } : undefined), { table: 'nesting' })],
        marks: [plot.text({
            format: format.percent('.0%'),
            wrap: (d) => d.w,
            tip: tipText,
            dy: (d) => (d.kind === 'phase' ? -d.h / 2 - 8 : 0),
            channels: {
                fill: { fn: (d) => (d.kind === 'phase' ? '#F9EEEC' : '#F6D5CB') },
                text: { fn: (d, i, rows) => (i === rows.length - 1 ? d.label : '') },
                x: { field: 'x', legend: { tickFormat: (v) => v + ' km' } },
            },
            edits: [
                edit.custom(snap, { gesture: 'drag', when: edit.when.shift }),
                edit.remove({ when: edit.when.modifier('metaKey') }),
                edit.stack.cut({ label: (n) => 'Part ' + n }),
            ],
        })],
        guides: [
            guides.rule({ y: ({ data }) => data.length, label: 'mean' }),
            guides.custom(({ scales }) => [{ type: 'line', x1: scales.x.encode(0) }]),
            guides.prompt('How likely?', { y: -20 }),
            guides.tip({ text: tipText, format: '.1f' }),
            guides.remaining({ total: 100, label: (left, used, total) => left + ' of ' + total }),
        ],
        axes: {
            x: { tickFormat: format.time('%b'), tickSize: (v, i) => (i === 0 ? 14 : 4), grid: { strokeDash: (v) => (v === 0 ? null : '2 2') } },
            y: { transform: ({ height }) => ({ y: height / 2 }), edit: edit.axis.scale({ mode: 'grow' }) },
        },
        effects: { hovered: { outline: { color: (color) => color } } },
    }),
    'lists, elements among marks, glyphs and legends': ({ plot, elements, edit }) => ({
        marks: [
            ...plot.composite({ parts: [plot.point({ size: 4 }), plot.rule({ channels: { y1: { frame: -1 } } })], edits: [...edit.scale.categories({ field: 'g' })] }),
            [plot.lineY({ curve: 'natural' }), plot.areaY({ gradient: { stops: ['#fff', '#000'] } })],
            elements.legendColor({ anchor: 'bottom', edits: [edit.legend.category()] }),
            elements.axisRadial({ ticks: 4 }),
        ],
        elements: [elements.gridY({ stroke: (v, i) => (i === 0 ? 'red' : 'grey') })],
        legends: { fill: { anchor: 'right', row: 0 }, size: false },
        scales: { x: { type: 'log' } },
        projection: { type: 'mercator', domain: { type: 'FeatureCollection', features: [] } },
        theme: { marks: { bar: { rx: 2 } }, extends: 'nyt' },
        stageLabels: ['one', null],
    }),
    'pictures in marks and behind them': ({ plot, guides }) => ({
        marks: [
            plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' }, image: { value: 'icon.png', fit: 'contain', position: 'bottom', repeat: 'repeat-y' } } }),
            plot.image({ size: 20, channels: { x: { field: 'x' }, y: { field: 'y' }, src: { field: 'pic', fit: 'cover', position: 'top' } } }),
            plot.point({ image: (d) => d.pic }),
            plot.image({ src: 'a.png' }),
        ],
        guides: [
            guides.image({ src: 'room.png' }),
            guides.image({ src: 'logo.png', x: [0, 5], y: ({ height }) => [0, height], fit: 'contain', position: 'left top', repeat: 'repeat', opacity: 0.5 }),
        ],
    }),
    'a glyph that eases': ({ plot, edit }) => ({
        schema: { item: { type: 'categorical' }, rank: { type: 'ordinal', domain: [1, 2, 3] } },
        scales: { y: { type: 'band', range: [0, 120] } },
        marks: [plot.composite({
            id: 'card', motion: true, channels: {},
            parts: [
                plot.rect({ height: 30, rx: 6, channels: { y: { field: 'rank', edit: edit.rank({ cursor: 'grab' }) } } }),
                plot.text({ channels: { x: { value: 20 }, y: { field: 'rank' }, text: { field: 'item' } } }),
            ],
        })],
    }),
    'a hierarchy that arranges its contents': ({ plot, edit }) => ({
        schema: {
            structure: 'hierarchy',
            tables: {
                nodes: { id: { type: 'categorical', key: true }, w: { type: 'quantitative', default: 120 } },
                nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
            },
        },
        marks: [plot.rect({
            channels: {
                width: { field: 'w', scale: null, fit: true },
                contains: { fn: (d) => d.kind === 'lane', padding: { top: 24 }, arrange: 'grid', gap: 6, columns: 2 },
                dodge: false,
            },
            edits: [edit.move({ mode: 'relative' }), edit.hierarchy.nest()],
        })],
    }),
    'a hierarchy that packs its contents by angle': ({ plot, edit }) => ({
        schema: {
            structure: 'hierarchy',
            tables: {
                nodes: { id: { type: 'categorical', key: true }, w: { type: 'quantitative', default: 120 } },
                nesting: { child: { type: 'ref' }, parent: { type: 'ref' } },
            },
        },
        marks: [plot.rect({
            channels: {
                width: { field: 'w', scale: null, fit: true },
                contains: { fn: (d) => d.kind === 'zone', arrange: 'pack', keep: 'angle', gap: 4 },
            },
            edits: [edit.move({ mode: 'relative' }), edit.hierarchy.nest()],
        })],
    }),
    'a widget with chart keys beside it': ({ widgets }) => ({
        ...widgets.slider({ question: 'How much?', domain: [0, 10], format: (v) => v + ' pts' }),
        responsive: 'reflow',
    }),
};

describe('recorded JSON compiles to the calls the JavaScript made', () => {
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        it(name, () => {
            const { direct, compiled } = bothWays(fixture);
            expect(compiled).toEqual(direct);
        });
    }

    // Every keyword, with every option it could carry a function or a factory in.
    const tables = keywordTables(NAMESPACES);
    const call = (ns, space, type) => {
        const member = type.split('.').reduce((o, k) => o[k], ns[space]);
        const positional = (SPEC_POSITIONAL[`${space}.${type}`] || []).map((p) => (p === 'fn' ? snap : p));
        return member(...positional, { id: `${space}.${type}` });
    };
    for (const [space, slot] of [['plot', 'marks'], ['elements', 'elements'], ['guides', 'guides'], ['constraints', 'constraints']]) {
        it(`every ${space} keyword`, () => {
            const { direct, compiled } = bothWays((ns) => ({ [slot]: [...tables[space].keys()].map((type) => call(ns, space, type)) }));
            expect(compiled).toEqual(direct);
            expect(compiled[slot].length).toBe(tables[space].size);
        });
    }
    it('every edit keyword', () => {
        const { direct, compiled } = bothWays((ns) => ({
            marks: [ns.plot.point({ edits: [...tables.edit.keys()].map((type) => call(ns, 'edit', type)) })],
        }));
        expect(compiled).toEqual(direct);
    });
});

describe('the recorder writes the short form', () => {
    it('states an arrow as an expression and names what it cannot state', () => {
        const { json } = bothWays(FIXTURES['functions: expressions, named functions and predicates']);
        expect(json.lock).toEqual({ expr: "table == 'nodes' && datum.kind == 'bucket'" });
        expect(json.onChange).toEqual({ fn: 'onChange' });
        expect(json.constraints[0]).toEqual({ type: 'custom', expr: 'active ? { hi: active.hi } : undefined', table: 'nesting' });
        const [text] = json.marks;
        expect(text.format).toEqual({ type: 'percent', specifier: '.0%' });
        expect(text.tip).toEqual({ fn: 'tip' });
        expect(text.channels.fill).toEqual({ expr: "datum.kind == 'phase' ? '#F9EEEC' : '#F6D5CB'" });
        expect(text.edits[0]).toEqual({ type: 'custom', fn: 'onChange', gesture: 'drag', when: 'shift' });
        expect(text.edits[1].when).toEqual({ type: 'modifier', key: 'metaKey' });
        // One function, one name, wherever it is used.
        expect(json.guides[3].text).toEqual({ fn: 'tip' });
        expect(json.guides[2]).toEqual({ type: 'prompt', text: 'How likely?', y: -20 });
    });
    it('uses the names it is given', () => {
        const rec = recorder({ functions: { snapDrag: snap } });
        const { json, functions } = rec.toJSON({ marks: [rec.plot.point({ edits: [rec.edit.custom(snap)] })] });
        expect(json.marks[0].edits[0]).toEqual({ type: 'custom', fn: 'snapDrag' });
        expect(functions).toEqual({ snapDrag: snap });
    });
    it('writes a date as its ISO string and a renderer as its name', () => {
        const rec = recorder();
        const { json } = rec.toJSON({ data: [{ at: new Date(Date.UTC(2020, 0, 1)) }], renderer: new NAMESPACES.renderers.canvas() });
        expect(json.data[0].at).toBe('2020-01-01T00:00:00.000Z');
        expect(json.renderer).toBe('canvas');
    });
});

describe('the recorder refuses what has no JSON form', () => {
    const rec = recorder();
    const bad = [
        [() => ({ constraints: [rec.edit.custom(snap)] }), 'constraints[0]: edit.custom sits where a constraints keyword belongs'],
        [() => ({ marks: [{ type: 'bar', build: () => [] }] }), 'marks[0]: this is not the result of a spec keyword'],
        [() => ({ marks: [rec.plot.bar({ rx: (d) => d.r })] }), 'marks[0].rx: a function here has no JSON form'],
        [() => ({ data: [{ at: new Map() }] }), 'data[0].at: a Map has no JSON form'],
        [() => ({ marks: [rec.plot.bar({ handles: rec.plot.point() })] }), 'marks[0].handles: plot.point is not an option here'],
    ];
    for (const [make, message] of bad) it(message, () => expect(() => rec.toJSON(make())).toThrow(message));
});

describe('a recorded namespace builds for real once it is live', () => {
    it('so a function the spec keeps can still call a factory', () => {
        const rec = recorder();
        expect(JSON.stringify(rec.plot.point({ size: 2 }))).toBe('{"type":"point","size":2}');
        expect(rec.live(() => rec.plot.point({ size: 2 }))).toEqual({ $call: 'plot.point', args: [{ size: 2 }] });
        expect(rec.plot.point().type).toBe('point');
        rec.stop();
        expect(rec.edit.line.draw().$call).toBe('edit.line.draw');
    });
});
