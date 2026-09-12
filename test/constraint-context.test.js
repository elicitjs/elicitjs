// @vitest-environment jsdom
// A constraint is a descriptor `{ type, field?, options, apply }`. Its `field`
// resolves to the column the DISPATCHING EDIT writes when the rule names none, so
// `clamp({ max })` on a chart whose value column is `p` clamps `p` — there is no
// column name baked into the library. The data-only context also carries which
// table the rows are and the rest of the dataset.
import { describe, it, expect } from 'vitest';
import { Elicit, plot, edit, constraints, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
setWarnings(false);

describe('constraint descriptor + context', () => {
    it('built-ins are descriptors with one identity key', () => {
        const c = constraints.clamp({ min: 0, max: 5 });
        expect(typeof c).toBe('object');
        expect(c.type).toBe('clamp');
        expect(c.field).toBeUndefined();
        expect(typeof c.apply).toBe('function');
        expect(constraints.ordering({ field: ['lo', 'hi'] }).field).toEqual(['lo', 'hi']);
        expect(constraints.maintainSum({ total: 10 }).options.total).toBe(10);
        expect(constraints.custom(() => undefined).type).toBe('custom');
    });

    it('a field-less clamp governs the column the edit writes', async () => {
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a', 'b'] }, p: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', p: 10 }, { k: 'b', p: 20 }],
            constraints: [constraints.clamp({ max: 40 })],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'p', edit: edit.move({ name: 'v' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 0).set(90);
        expect(el.getData()[0].p).toBeCloseTo(40, 6);
    });

    it('a custom rule sees field, table and tables, and a bare function still runs', async () => {
        const seen = {};
        let bareRan = false;
        const el = Elicit({
            width: 300, height: 200,
            schema: { k: { type: 'categorical', domain: ['a'] }, p: { type: 'quantitative', domain: [0, 100] } },
            data: [{ k: 'a', p: 10 }],
            constraints: [
                constraints.custom((ctx) => { Object.assign(seen, { field: ctx.field, table: ctx.table, tables: Object.keys(ctx.tables) }); return undefined; }),
                (rows) => { bareRan = true; return rows; },
            ],
            marks: [plot.barY({ channels: { x: { field: 'k' }, y: { field: 'p', edit: edit.move({ name: 'v' }) } } })],
        });
        document.body.appendChild(el);
        await tick();
        el.control('v', 0).set(30);
        expect(seen).toEqual({ field: 'p', table: 'data', tables: ['data'] });
        expect(bareRan).toBe(true);
        expect(el.getData()[0].p).toBeCloseTo(30, 6);
    });
});
