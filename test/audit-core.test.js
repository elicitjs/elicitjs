// @vitest-environment jsdom
// Regression tests for the core/engine audit fixes.
import { describe, it, expect, afterEach } from 'vitest';
import * as d3 from 'd3';
import { Elicit, plot, edit, elements, setWarnings } from '../src/index.js';
import { resolveScales } from '../src/core/resolve.js';
import { inferDomainFromValues, unionDomains } from '../src/core/encoding.js';
import { resolveLock } from '../src/core/lock.js';
import { warnDeadEditChannels } from '../src/core/guards.js';
import { reserveTitles } from '../src/core/titles.js';
import { resolveTheme } from '../src/core/theme.js';
import { normalizeSchema } from '../src/core/schema.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => el.remove()); setWarnings(false); });
setWarnings(false);

function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el);
    mounted.push(el);
    return el;
}

function captureWarnings(fn) {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => seen.push(a.join(' '));
    setWarnings(true);
    try { fn(); } finally { console.warn = orig; setWarnings(false); }
    return seen;
}

const dims = { width: 200, height: 100 };
const point = (channels, extra = {}) => ({ channels, table: 'data', ...extra });
const specOf = (schema) => {
    const schemaSpec = normalizeSchema(schema);
    return { schema: schemaSpec.tables[schemaSpec.primary].fields, schemaSpec };
};

describe('adopted d3 scale', () => {
    it('keeps taking the schema domain after the first resolve', () => {
        const instance = d3.scaleLinear();
        const features = [point({ x: { field: 'x', scale: instance } })];
        const tables = { data: [{ x: 5 }] };
        const first = resolveScales(features, tables, specOf({ x: { type: 'quantitative', domain: [0, 100] } }), dims);
        expect(first.x.domain()).toEqual([0, 100]);
        const second = resolveScales(features, tables, specOf({ x: { type: 'quantitative', domain: [0, 50] } }), dims);
        expect(second.x.domain()).toEqual([0, 50]);
    });

    it('follows el.setDomain on a chart', async () => {
        const el = mount({
            width: 220, height: 120, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 100] }, y: { type: 'quantitative', domain: [0, 10] } },
            data: [{ x: 50, y: 5 }],
            marks: [plot.point({ channels: { x: { field: 'x', scale: d3.scaleLinear() }, y: { field: 'y' } } })],
        });
        await tick();
        expect(+el.querySelector('circle').getAttribute('cx')).toBeCloseTo(100, 3);
        el.setDomain('x', [0, 50]);
        expect(+el.querySelector('circle').getAttribute('cx')).toBeCloseTo(200, 3);
    });

    it('picks up new categories on an adopted band scale with an inferred domain', () => {
        const features = [point({ x: { field: 'k', scale: d3.scaleBand().padding(0.3) } })];
        const spec = specOf({ k: { type: 'categorical' } });
        expect(resolveScales(features, { data: [{ k: 'a' }] }, spec, dims).x.domain()).toEqual(['a']);
        const next = resolveScales(features, { data: [{ k: 'a' }, { k: 'b' }] }, spec, dims).x;
        expect(next.domain()).toEqual(['a', 'b']);
        expect(next.padding()).toBeCloseTo(0.3);
    });

    it('leaves a domain the author set, and what they configured, alone', () => {
        const instance = d3.scaleLinear().domain([-6, 0, 6]).clamp(true);
        const features = [point({ x: { field: 'x', scale: instance } })];
        const spec = specOf({ x: { type: 'quantitative', domain: [0, 100] } });
        resolveScales(features, { data: [{ x: 5 }] }, spec, dims);
        const s = resolveScales(features, { data: [{ x: 5 }] }, spec, dims).x;
        expect(s.domain()).toEqual([-6, 0, 6]);
        expect(s.clamp()).toBe(true);
        expect(s.kind).toBe('continuous');
        expect(s.invertible).toBe(true);
    });
});

describe('inferred domains', () => {
    it('skip a NaN value', () => {
        expect(inferDomainFromValues('linear', [3, NaN, 7])).toEqual([3, 7]);
        expect(inferDomainFromValues('linear', [NaN])).toEqual([0, 1]);
    });

    it('read ISO-string dates on a time scale', () => {
        const d = inferDomainFromValues('time', ['2020-01-01', '2021-06-01', new Date('2019-03-01')]);
        expect(d.map(Number)).toEqual([+new Date('2019-03-01'), +new Date('2021-06-01')]);
    });

    it('union ISO-string temporal domains', () => {
        const d = unionDomains('temporal', [['2020-01-01', '2021-01-01'], ['2019-01-01', '2020-06-01']]);
        expect(d.map(Number)).toEqual([+new Date('2019-01-01'), +new Date('2021-01-01')]);
    });

    it('give a finite temporal axis from string dates with no declared domain', () => {
        const features = [point({ x: { field: 't' } })];
        const s = resolveScales(features, { data: [{ t: '2020-01-01' }, { t: '2022-01-01' }] }, specOf({ t: { type: 'temporal' } }), dims).x;
        expect(s.domain().map(Number).every(Number.isFinite)).toBe(true);
        expect(s.encode('2021-01-01')).toBeGreaterThan(0);
    });
});

describe('spec.lock', () => {
    it('reports a bad value through warn(), once', () => {
        const seen = captureWarnings(() => {
            expect(resolveLock(/** @type {any} */ ('sead'), () => 0)).toBe(null);
            resolveLock(/** @type {any} */ ('sead'), () => 0);
        });
        const hits = seen.filter((m) => m.includes('spec.lock'));
        expect(hits.length).toBe(1);
        expect(hits[0].startsWith('[elicit] spec.lock')).toBe(true);
    });

    it('stays quiet with warnings off', () => {
        const seen = [];
        const orig = console.warn;
        console.warn = (...a) => seen.push(a.join(' '));
        setWarnings(false);
        try { resolveLock(/** @type {any} */ ('sead2'), () => 0); } finally { console.warn = orig; }
        expect(seen).toEqual([]);
    });
});

describe('dead-edit warning', () => {
    it('names the scale it tested, not the bare-channel alias', () => {
        const scales = {
            fill: { type: 'linear', invertible: true },
            'fill\u0000mood': { type: 'ordinal', invertible: false },
        };
        const feature = { type: 'point', id: 'p', channels: { fill: { field: 'mood' } } };
        const seen = captureWarnings(() => {
            warnDeadEditChannels(feature, [/** @type {any} */ ({ type: 'move', inverts: true, channels: ['fill'] })], /** @type {any} */ (scales));
        });
        expect(seen.length).toBe(1);
        expect(seen[0]).toContain('(ordinal)');
    });
});

describe('chart title', () => {
    it('reserves its band at the width it is drawn at, beside a left legend', async () => {
        const el = mount({
            width: 300, height: 240, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            title: 'aaaa bbbb cccc dddd eeee ffff gggg',
            schema: { k: { type: 'categorical', domain: ['alpha', 'beta'] }, v: { type: 'quantitative', domain: [0, 10] } },
            data: [{ k: 'alpha', v: 4 }, { k: 'beta', v: 8 }],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'v' }, fill: { field: 'k', legend: { anchor: 'left' } } } })],
        });
        await tick();
        const m = el.querySelector('g.scene-container').getAttribute('transform').match(/translate\(([\d.]+),([\d.]+)\)/);
        expect(+m[1]).toBeGreaterThan(10); // the legend took room on the left
        const title = [...el.querySelectorAll('text')].find((t) => t.textContent.startsWith('aaaa'));
        const drawn = Math.max(1, title.querySelectorAll('tspan').length);
        expect(drawn).toBeGreaterThan(1);
        expect(+m[2]).toBeCloseTo(10 + 16 * 1.3 * drawn + 6, 3);
    });
});

const networkSchema = {
    structure: 'network',
    tables: {
        nodes: {
            id: { type: 'categorical', key: true },
            x: { type: 'quantitative', domain: [0, 10] },
            y: { type: 'quantitative', domain: [0, 10] },
            w: { type: 'categorical', domain: ['lo', 'hi'] },
        },
        links: {
            role: 'links',
            fields: {
                source: { type: 'ref' }, target: { type: 'ref' },
                w: { type: 'quantitative', domain: [0, 10] },
                a: { type: 'quantitative', domain: [0, 10], default: 2 },
                b: { type: 'quantitative', domain: [0, 10], default: 4 },
            },
        },
    },
};
const networkData = {
    nodes: [{ id: 'n1', x: 2, y: 2, w: 'lo' }, { id: 'n2', x: 8, y: 8, w: 'hi' }],
    links: [{ source: 'n1', target: 'n2', w: 5, a: 1, b: 3 }],
};

describe('a mark on a non-primary table', () => {
    it('accepts() reads the field from the mark\'s own table', async () => {
        const el = mount({
            width: 300, height: 200, axes: false, schema: networkSchema, data: networkData,
            marks: [
                plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
                plot.point({ table: 'links', channels: { x: { field: 'w', edit: edit.move({ name: 'lw' }) }, y: { datum: 5 } } }),
            ],
        });
        await tick();
        const a = el.control('lw', 0).accepts();
        expect(a.field).toBe('w');
        expect(a.type).toBe('quantitative');
        expect(a.values).toBe(null);
    });

    it('create on an extent mark reads the span defaults from its own table', async () => {
        const seen = [];
        const orig = console.warn;
        console.warn = (...a) => seen.push(a.join(' '));
        setWarnings(true);
        try {
            mount({
                width: 300, height: 200, axes: false, schema: networkSchema, data: networkData,
                marks: [
                    plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } } }),
                    plot.rect({ id: 'spans', table: 'links', channels: { x1: { field: 'a' }, x2: { field: 'b' }, y: { datum: 5 } }, edits: [edit.create()] }),
                ],
            });
            await tick();
        } finally { console.warn = orig; setWarnings(false); }
        expect(seen.filter((m) => m.includes("doesn't seed"))).toEqual([]);
    });
});

describe('accepts()', () => {
    it('does not report a colour ramp\'s domain as a value set', async () => {
        const el = mount({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 10] }, v: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 5, v: 40 }],
            marks: [plot.point({ channels: { x: { field: 'x' }, fill: { field: 'v', edit: edit.slide({ name: 'heat' }) } } })],
        });
        await tick();
        const a = el.control('heat', 0).accepts();
        expect(a.kind).toBe('discrete');
        expect(a.domain).toEqual([0, 100]);
        expect(a.values).toBe(null);
    });

    it('still reports an ordinal colour scale\'s categories', async () => {
        const el = mount({
            width: 300, height: 200, axes: false,
            schema: { x: { type: 'quantitative', domain: [0, 10] }, g: { type: 'categorical', domain: ['a', 'b'] } },
            data: [{ x: 5, g: 'a' }],
            marks: [plot.point({ channels: { x: { field: 'x' }, fill: { field: 'g', edit: edit.cycle({ name: 'grp' }) } } })],
        });
        await tick();
        expect(el.control('grp', 0).accepts().values).toEqual(['a', 'b']);
    });
});

describe('plane stroke after a lost dragend', () => {
    it('does not route the next stroke to the mark the lost one grabbed', async () => {
        const el = mount({
            width: 300, height: 200, margins: { top: 10, right: 10, bottom: 10, left: 10 }, axes: false,
            schema: { x: { type: 'categorical', domain: ['A', 'B', 'C'] }, y: { type: 'quantitative', domain: [0, 100] } },
            data: [{ x: 'A', y: 50 }, { x: 'B', y: 50 }, { x: 'C', y: 50 }],
            marks: [
                plot.lineY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.line.sweep() } } }),
                plot.barY({ channels: { x: { field: 'x' }, y: { field: 'y', edit: edit.move() } } }),
            ],
        });
        await tick();
        const rect = (n) => el.querySelectorAll('rect.mark')[n];
        const midX = (n) => +rect(n).getAttribute('x') + +rect(n).getAttribute('width') / 2;
        const raw = {};
        // A direct grab of bar B whose dragend never arrives.
        const y1 = +rect(1).getAttribute('y') + 2;
        el.emit({ type: 'dragstart', x: midX(1), y: y1, rawEvent: raw });
        el.emit({ type: 'drag', x: midX(1), y: y1 - 20, rawEvent: raw });
        const heldB = el.getData()[1].y;
        expect(heldB).toBeGreaterThan(50);
        // The next stroke starts on empty plot above bar A: it is the sweep's.
        const x0 = midX(0);
        el.emit({ type: 'dragstart', x: x0, y: 30, rawEvent: raw });
        el.emit({ type: 'drag', x: x0 + 1, y: 20, rawEvent: raw });
        el.emit({ type: 'dragend', x: x0 + 1, y: 20, rawEvent: raw });
        const rows = el.getData();
        expect(rows[1].y).toBe(heldB);
        expect(rows[0].y).toBeGreaterThan(50);
    });
});
