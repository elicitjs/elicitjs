// @vitest-environment jsdom
// `coerceToType` is the one place a gesture's value is brought into the form a
// field's declared measure stores. A typed "250" on a quantitative column commits
// the number 250; letters are refused rather than stored.
import { describe, it, expect } from 'vitest';
import { coerceToType } from '../src/core/schema.js';
import { Elicit, plot, edit, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('coerceToType', () => {
    const q = { type: 'quantitative' };
    const t = { type: 'temporal' };
    const c = { type: 'categorical' };
    it('quantitative: parses numeric strings, nulls empties, refuses letters', () => {
        expect(coerceToType('250', q)).toBe(250);
        expect(coerceToType(' 1.5 ', q)).toBe(1.5);
        expect(coerceToType(7, q)).toBe(7);
        expect(coerceToType('', q)).toBeNull();
        expect(coerceToType(null, q)).toBeNull();
        expect(coerceToType('abc', q)).toBeUndefined();
        expect(coerceToType(NaN, q)).toBeUndefined();
    });
    it('temporal: keeps a Date, parses a number or string, refuses garbage', () => {
        const d = new Date(2020, 0, 1);
        expect(coerceToType(d, t)).toBe(d);
        expect(coerceToType(d.getTime(), t).getTime()).toBe(d.getTime());
        expect(coerceToType('2020-01-01T00:00:00Z', t) instanceof Date).toBe(true);
        expect(coerceToType('not a date', t)).toBeUndefined();
    });
    it('discrete and undeclared: unchanged', () => {
        expect(coerceToType('x', c)).toBe('x');
        expect(coerceToType(3, c)).toBe(3);
        expect(coerceToType('3', undefined)).toBe('3');
    });
});

describe('editText / set on a quantitative field', () => {
    function mount() {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, n: { type: 'quantitative', domain: [0, 1000] } },
            data: [{ k: 'a', n: 10 }],
            marks: [plot.text({ channels: { x: { field: 'k' }, y: { field: 'n' }, text: { field: 'n', edit: edit.editText({ name: 'type' }) } } })],
        });
        document.body.appendChild(el);
        return el;
    }
    it('stores the typed number as a number', async () => {
        const el = mount();
        await tick();
        el.control('type', 0).set('250');
        expect(el.getData()[0].n).toBe(250);
    });
    it('refuses letters and leaves the row alone', async () => {
        const el = mount();
        await tick();
        el.control('type', 0).set('lots');
        expect(el.getData()[0].n).toBe(10);
    });
});
