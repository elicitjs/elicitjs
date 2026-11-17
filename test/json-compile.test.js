// @vitest-environment jsdom
// compile(): a JSON spec becomes the spec Elicit() takes. Every keyword resolves,
// functions come from the registry or the per-compile map, data is never entered,
// and a spec the grammar cannot place is refused with its path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Elicit, compile, registerFunction, setWarnings, plot, elements, guides, constraints, edit, widgets } from '../src/index.js';
import { SPEC_POSITIONAL } from '../src/vocabulary.js';
import { keywordTables } from '../src/json/keywords.js';
import { NAMESPACES } from '../src/json/index.js';

beforeAll(() => setWarnings(false));
afterAll(() => setWarnings(true));

const tick = () => new Promise((r) => setTimeout(r, 0));
const json = (value) => JSON.parse(JSON.stringify(value));

describe('every exported factory is a keyword', () => {
    const tables = keywordTables(NAMESPACES);
    const SLOT = { plot: 'marks', elements: 'elements', guides: 'guides', constraints: 'constraints' };
    it('covers each namespace', () => {
        expect([...tables.plot.keys()].sort()).toEqual(Object.keys(plot).sort());
        expect([...tables.elements.keys()].sort()).toEqual(Object.keys(elements).sort());
        expect([...tables.guides.keys()].sort()).toEqual(Object.keys(guides).sort());
        expect([...tables.constraints.keys()].sort()).toEqual(Object.keys(constraints).sort());
        expect([...tables.widgets.keys()].sort()).toEqual(Object.keys(widgets).sort());
        expect(tables.edit.has('move') && tables.edit.has('line.draw') && !tables.edit.has('when')).toBe(true);
        expect(tables.format.has('resolveFormat')).toBe(false);
    });
    for (const [ns, slot] of Object.entries(SLOT)) {
        for (const type of tables[ns].keys()) {
            it(`${ns}.${type}`, () => {
                const positional = SPEC_POSITIONAL[`${ns}.${type}`] || [];
                const d = { type, ...Object.fromEntries(positional.map((p) => [p, p === 'fn' ? 'noop' : 'text'])) };
                let direct;
                try { direct = NAMESPACES[ns][type](...positional.map((p) => (p === 'fn' ? () => undefined : 'text')), {}); } catch { return; }
                const made = compile({ [slot]: [d] }, { functions: { noop: () => undefined } })[slot];
                expect(made.map((m) => m.type)).toEqual([direct].flat(Infinity).map((m) => m.type));
            });
        }
    }
    for (const type of tables.edit.keys()) {
        it(`edit.${type}`, () => {
            const d = type === 'custom' ? { type, fn: 'noop' } : { type };
            let direct;
            try { direct = type === 'custom' ? edit.custom(() => undefined) : tables.edit.get(type)({}); } catch { return; }
            const made = compile({ marks: [{ type: 'point', edits: [d] }] }, { functions: { noop: () => undefined } }).marks[0].edits;
            expect(made.map((e) => e.type)).toEqual([direct].flat(Infinity).map((e) => e.type));
        });
    }
    for (const type of tables.widgets.keys()) {
        it(`widgets.${type}`, () => {
            const made = compile({ widget: { type }, responsive: 'reflow' });
            expect(Array.isArray(made.marks)).toBe(true);
            expect(made.responsive).toBe('reflow');
        });
    }
});

describe('a descriptor takes its namespace from where it sits', () => {
    it('resolves `rule` and `custom` by position', () => {
        const fn = () => [];
        const spec = compile({
            marks: [{ type: 'rule', edits: [{ type: 'custom', fn: 'f' }] }],
            guides: [{ type: 'rule', y: 1 }, { type: 'custom', fn: 'f' }],
            constraints: [{ type: 'custom', fn: 'f', table: 'nesting' }],
        }, { functions: { f: fn } });
        expect(spec.marks[0].views).not.toBe('state');
        expect(spec.guides[0].views).toBe('state');
        expect(spec.marks[0].edits[0].apply).toBe(fn);
        expect(spec.constraints[0].apply).toBe(fn);
        expect(spec.constraints[0].table).toBe('nesting');
    });
    it('takes elements in `marks`, as the engine does', () => {
        const spec = compile({ marks: [{ type: 'point' }, { type: 'axisX' }, { type: 'legendColor' }] });
        expect(spec.marks.map((m) => m.type)).toEqual(['point', 'axis', 'legend']);
    });
    it('flattens a factory that returns a list', () => {
        const spec = compile({ marks: [{ type: 'point', edits: [{ type: 'scale.categories' }, { type: 'move' }] }] });
        expect(spec.marks[0].edits.map((e) => e.type)).toEqual(['scale.addCategory', 'scale.renameCategory', 'scale.removeCategory', 'move']);
    });
    it('names `when` and `format` members, and calls the ones that take arguments', () => {
        const spec = compile({
            marks: [{ type: 'point', format: '.1f', edits: [
                { type: 'move', when: 'shift' },
                { type: 'remove', when: { type: 'modifier', key: 'metaKey' } },
                { type: 'toggle', when: { expr: 'event.altKey' } },
            ] }],
            axes: { x: { tickFormat: { type: 'suffix', suffix: ' km', inner: '.1f' } }, y: { tickFormat: '.0%' } },
        });
        const [move, remove, toggle] = spec.marks[0].edits;
        expect(move.when({ event: { shiftKey: true } })).toBe(true);
        expect(remove.when({ event: { metaKey: true } })).toBe(true);
        expect(toggle.when({ event: { altKey: true } })).toBe(true);
        expect(spec.axes.x.tickFormat(2)).toBe('2.0 km');
        expect(spec.axes.y.tickFormat).toBe('.0%');
    });
    it('builds a renderer from its name', () => {
        expect(compile({ renderer: 'canvas' }).renderer.constructor.name).toBe('CanvasRenderer');
    });
});

describe('functions', () => {
    it('lowers an `expr` to a function, so the core never sees one', () => {
        const spec = compile({
            lock: { expr: "datum.kind == 'actual'" },
            marks: [{
                type: 'barY',
                opacity: { expr: 'index == 0 ? 0.5 : 1' },
                channels: { fill: { expr: "datum.y > 50 ? 'red' : 'teal'" }, y: { field: 'y' } },
            }],
            guides: [{ type: 'rule', y: { expr: "mean(data, 'y')" } }],
            axes: { y: { tickSize: { expr: 'index == 0 ? 10 : 4' }, grid: { stroke: { expr: "value > 5 ? 'red' : 'grey'" } } } },
        });
        expect(spec.lock({ kind: 'actual' })).toBe(true);
        const { fill, opacity } = spec.marks[0].channels;
        expect(fill.expr).toBeUndefined();
        expect(fill.fn({ y: 60 })).toBe('red');
        expect(opacity.fn({}, 0)).toBe(0.5);
        expect(spec.axes.y.tickSize(0, 0)).toBe(10);
        expect(spec.axes.y.grid.stroke(9, 0)).toBe('red');
    });
    it('resolves a name from the per-compile map before the registry', () => {
        const registered = () => 'registered';
        const local = () => 'local';
        registerFunction('json-test-fill', registered);
        const d = { marks: [{ type: 'point', fill: { fn: 'json-test-fill' } }] };
        expect(compile(d).marks[0].channels.fill.fn).toBe(registered);
        expect(compile(d, { functions: { 'json-test-fill': local } }).marks[0].channels.fill.fn).toBe(local);
    });
    it('refuses a bad registration', () => {
        expect(() => registerFunction('', () => 1)).toThrow('non-empty string');
        expect(() => registerFunction('x', 1)).toThrow('must be a function');
    });
});

describe('data is never entered', () => {
    it('leaves rows, defaults, constants and themes as written', () => {
        const row = { fn: 'not a function', type: 'bar', edit: { type: 'move' }, when: 'shift' };
        const spec = compile(json({
            data: [row],
            schema: { fn: { type: 'categorical' } },
            theme: { marks: { bar: { rx: 2 } } },
            marks: [{
                type: 'point',
                channels: { x: { value: { fn: 'literal' } }, y: { datum: { expr: 'literal' } } },
                edits: [{ type: 'create', defaults: { format: { type: 'nope' }, when: 'never' } }],
            }],
        }));
        expect(spec.data).toEqual([row]);
        expect(spec.theme).toEqual({ marks: { bar: { rx: 2 } } });
        expect(spec.marks[0].channels.x.value).toEqual({ fn: 'literal' });
        expect(spec.marks[0].channels.y.datum).toEqual({ expr: 'literal' });
    });
    it('turns a temporal column back into dates, and no other', () => {
        const spec = compile({
            data: [{ at: '2020-01-01T00:00:00.000Z', label: '2020-01-01' }],
            schema: { at: { type: 'temporal' }, label: { type: 'categorical' } },
        });
        expect(spec.data[0].at).toBeInstanceOf(Date);
        expect(spec.data[0].label).toBe('2020-01-01');
        const tables = compile({
            data: { nodes: [{ id: 'a', at: '2020-01-01' }], links: [] },
            schema: { structure: 'network', tables: { nodes: { id: { type: 'categorical', key: true }, at: { type: 'temporal' } }, links: { source: { type: 'categorical', ref: 'nodes' }, target: { type: 'categorical', ref: 'nodes' } } } },
        });
        expect(tables.data.nodes[0].at).toBeInstanceOf(Date);
    });
    it('does not change the JSON it was given', () => {
        const input = { marks: [{ type: 'point', channels: { x: { expr: 'index' } } }], constraints: [{ type: 'custom', fn: 'f' }] };
        const before = JSON.stringify(input);
        compile(input, { functions: { f: () => undefined } });
        expect(JSON.stringify(input)).toBe(before);
    });
});

describe('what the grammar cannot place is refused, with its path', () => {
    const bad = [
        [{ marks: [{ type: 'nope' }] }, 'marks[0]: unknown plot / elements keyword "nope"'],
        [{ marks: [{ channels: {} }] }, 'marks[0]: a descriptor needs a "type"'],
        [{ marks: ['bar'] }, 'marks[0]: expected { "type": … }'],
        [{ guides: [{ type: 'bar' }] }, 'guides[0]: unknown guides keyword "bar"'],
        [{ marks: [{ type: 'bar', rx: { fn: 'f' } }] }, 'marks[0].rx: this option takes no function'],
        [{ guides: [{ type: 'proximity', stroke: { expr: "'red'" } }] }, 'guides[0].stroke: this option takes no function'],
        [{ marks: [{ type: 'bar', fill: { fn: 'missing' } }] }, 'marks[0].fill: no function is registered as "missing"'],
        [{ marks: [{ type: 'bar', channels: { fill: { expr: 'datum.x >' } } }] }, 'marks[0].channels.fill.expr: expr "datum.x >"'],
        [{ marks: [{ type: 'bar', channels: { fill: { expr: 'row.x' } } }] }, 'unknown variable "row"'],
        [{ marks: [{ type: 'bar', channels: { fill: { fn: 'f', expr: '1' } } }] }, '`fn` or `expr`, not both'],
        [{ marks: [{ type: 'bar', channels: { y: { field: 'y', edit: { type: 'scale.categories' } } } }] }, 'a channel carries one edit'],
        [{ marks: [{ type: 'bar', edits: [{ type: 'move', when: 'modifier' }] }] }, '"modifier" takes key'],
        [{ marks: [{ type: 'bar', edits: [{ type: 'move', when: { type: 'shift' } }] }] }, 'write "shift" as a string'],
        [{ marks: [{ type: 'bar', edits: [{ type: 'move', when: 'sometimes' }] }] }, 'unknown predicate "sometimes"'],
        [{ marks: [{ type: 'bar', edits: [{ type: 'custom' }] }] }, 'edit.custom needs its function'],
        [{ onChange: { expr: 'data' } }, 'onChange: this option takes a registered function'],
        [{ renderer: 'webgl' }, 'unknown renderer "webgl"'],
        [{ axes: { x: { tickFormat: { type: 'time', nope: 1 } } } }, 'format.time takes specifier, not nope'],
        [{ effects: { hovered: { fill: { fn: 'f' } } } }, 'effects.hovered.fill: this option takes no function'],
    ];
    for (const [spec, message] of bad) {
        it(message, () => expect(() => compile(spec, { functions: { f: () => 1 } })).toThrow(message));
    }
    it('prefixes every error', () => expect(() => compile([])).toThrow('[elicit] compile: spec: a spec is an object.'));
});

describe('a compiled spec draws and edits like one written in JavaScript', () => {
    it('mounts, commits a controlled edit through a constraint, and reports it', async () => {
        const changes = [];
        const el = Elicit(compile(json({
            width: 300, height: 200,
            schema: { x: { type: 'categorical', domain: ['A', 'B'] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 'A', y: 10 }, { x: 'B', y: 20 }],
            constraints: [{ type: 'clamp', min: 0, max: 50, field: 'y' }],
            onChange: { fn: 'changed' },
            marks: [{
                type: 'barY',
                channels: {
                    x: { field: 'x' },
                    y: { field: 'y', edit: { type: 'move', name: 'pos' } },
                    fill: { expr: "datum.y > 25 ? '#ee7b5e' : '#50aeb7'" },
                },
            }],
            guides: [{ type: 'rule', y: { expr: "mean(data, 'y')" } }],
            axes: { y: { tickFormat: { expr: "value + '%'" } } },
        }), { functions: { changed: (d) => changes.push(d) } }));
        document.body.appendChild(el.dom());
        await tick();
        expect(el.dom().querySelector('svg')).not.toBeNull();
        expect(el.dom().textContent).toContain('%');

        el.control('pos', 1).set(30);
        expect(el.getData()[1].y).toBeCloseTo(30, 6);
        el.control('pos', 1).set(90);
        expect(el.getData()[1].y).toBeCloseTo(50, 6);
        expect(changes.length).toBe(2);
        el.destroy();
    });
});
