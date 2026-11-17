// The expression language of a JSON spec: what it accepts, what it refuses, and
// that an arrow function lifts to the same expression.
import { describe, it, expect } from 'vitest';
import { compileExpr, liftExpr, parseExpr } from '../src/json/expr.js';

const ROW = ['datum', 'index', 'data'];
const run = (source, ...args) => compileExpr(source, ROW)(...args);

describe('expr evaluates a JavaScript-expression subset', () => {
    it('reads the option\'s variables and their own properties', () => {
        expect(run('datum.x', { x: 3 })).toBe(3);
        expect(run("datum['a b']", { 'a b': 4 })).toBe(4);
        expect(run('data[index].x', null, 1, [{ x: 1 }, { x: 2 }])).toBe(2);
        expect(run('data.length', null, 0, [1, 2, 3])).toBe(3);
        expect(run('datum.missing.deeper', {})).toBeUndefined();
    });
    it('follows JavaScript precedence', () => {
        expect(run('1 + 2 * 3')).toBe(7);
        expect(run('(1 + 2) * 3')).toBe(9);
        expect(run('10 - 4 - 3')).toBe(3);
        expect(run('-datum.h / 2 - 8', { h: 4 })).toBe(-10);
        expect(run('1 < 2 && 2 < 1 || 5')).toBe(5);
        expect(run('datum.a ?? 7', {})).toBe(7);
        expect(run('!datum.a', { a: 0 })).toBe(true);
    });
    it('compares strictly, so == never coerces', () => {
        expect(run("datum.x == '1'", { x: 1 })).toBe(false);
        expect(run('datum.x === 1', { x: 1 })).toBe(true);
        expect(run("datum.kind != 'a'", { kind: 'b' })).toBe(true);
    });
    it('nests ternaries to the right', () => {
        const label = "datum.v == -1 ? 'low' : datum.v == 1 ? 'high' : 'mid'";
        expect([-1, 0, 1].map((v) => run(label, { v }))).toEqual(['low', 'mid', 'high']);
    });
    it('builds arrays, objects and strings', () => {
        expect(run('[datum.a, datum.a + 1]', { a: 1 })).toEqual([1, 2]);
        expect(run("{ in: ['left'], n: index }", null, 2)).toEqual({ in: ['left'], n: 2 });
        expect(run("datum.n + ' week' + (datum.n == 1 ? '' : 's')", { n: 2 })).toBe('2 weeks');
        expect(run("'it\\'s'")).toBe("it's");
    });
    it('calls the built-ins', () => {
        const rows = [{ y: 1 }, { y: 3 }, { y: null }];
        expect(run("mean(data, 'y')", null, 0, rows)).toBe(2);
        expect(run("[minOf(data, 'y'), maxOf(data, 'y')]", null, 0, rows)).toEqual([1, 3]);
        expect(run("format(datum.v, '.0%')", { v: 0.25 })).toBe('25%');
        expect(run("timeFormat(datum.d, '%Y')", { d: '2021-06-01T12:00:00' })).toBe('2021');
        expect(run('month(datum.d)', { d: new Date(2020, 0, 5) })).toBe(0);
        expect(run('clamp(datum.v, 0, 1)', { v: 4 })).toBe(1);
        expect(run("length(distinct(data, 'y'))", null, 0, rows)).toBe(3);
    });
    it('reads a context object\'s keys as variables', () => {
        const fn = compileExpr('{ y: height / 2 }', 'ctx');
        expect(fn({ height: 10 })).toEqual({ y: 5 });
    });
});

describe('expr refuses what is not an expression over its variables', () => {
    const bad = [
        ['datum.x >', 'unexpected end'],
        ['row.x', 'unknown variable "row"'],
        ['alert(1)', 'unknown function "alert"'],
        ['datum.toString()', 'only the built-in functions'],
        ['datum.constructor', 'cannot be read'],
        ['datum.__proto__', 'cannot be read'],
        ['{ __proto__: 1 }', 'cannot be a key'],
        ['datum.x = 1', 'unexpected'],
        ['`${datum.x}`', 'unexpected'],
        ['(d) => d', 'unexpected'],
    ];
    for (const [source, message] of bad) {
        it(source, () => expect(() => compileExpr(source, ROW)).toThrow(message));
    }
    it('reads no inherited property, and no forbidden one through a computed key', () => {
        expect(run('datum.toString', {})).toBeUndefined();
        expect(run('datum.hasOwnProperty', {})).toBeUndefined();
        expect(() => run("datum['constr' + 'uctor']", {})).toThrow('cannot be read');
    });
});

describe('liftExpr turns an arrow into the expression it states', () => {
    const lifts = [
        [(d) => d.share > 50 ? '#EE7B5E' : '#50AEB7', "datum.share > 50 ? '#EE7B5E' : '#50AEB7'"],
        [(d, i, rows) => i === rows.length - 1 ? 1 : 0.5, 'index == data.length - 1 ? 1 : 0.5'],
        [(d) => ({ in: ['left'] }), "{ in: ['left'] }"],
        [(d) => (d.a + 1) * 2 - (3 - d.b), '(datum.a + 1) * 2 - (3 - datum.b)'],
        [(d) => !d.a && (d.b || d.c), '!datum.a && (datum.b || datum.c)'],
        [(d) => d.kind !== "end", "datum.kind != 'end'"],
    ];
    for (const [fn, expr] of lifts) {
        it(expr, () => {
            expect(liftExpr(fn, ROW)).toBe(expr);
            // What it prints, it parses.
            expect(() => parseExpr(expr)).not.toThrow();
        });
    }
    it('agrees with the arrow it came from', () => {
        const fn = (d, i) => d.h > 2 ? -d.h / 2 - i : d.w * (i + 1);
        const lifted = compileExpr(liftExpr(fn, ROW), ROW);
        for (const d of [{ h: 1, w: 3 }, { h: 5, w: 3 }]) expect(lifted(d, 2)).toBe(fn(d, 2));
    });
    it('reads a destructured context', () => {
        expect(liftExpr(({ height }) => ({ y: height / 2 }), 'ctx')).toBe('{ y: height / 2 }');
        expect(liftExpr((ctx) => ctx.height, 'ctx')).toBeNull();
    });
    const outside = 3;
    const keeps = [
        (d) => Math.round(d.a),              // a call
        (d) => d.a + outside,                // a variable from outside
        (d) => d.a == 1,                     // loose equality coerces
        (d) => `${d.a}px`,                   // a template
        (d) => { return d.a; },              // a block
        function (d) { return d.a; },        // not an arrow
        (d, i, rows, extra) => d.a,          // more parameters than the option has
    ];
    keeps.forEach((fn, i) => it(`keeps a function it cannot state (${i})`, () => expect(liftExpr(fn, ROW)).toBeNull()));
});
