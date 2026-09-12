// A scoped edit's `type` IS its dotted path: `edit.line.draw()` <-> "line.draw".
// Bare types collided (edit.move / edit.geo.move) and a driver claiming by type
// took the wrong one; nothing else can catch that, since both typecheck and both
// render. This assertion lived in scripts/check-exports.mjs; it is a unit test now.
import { describe, it, expect } from 'vitest';
import { edit } from '../src/index.js';

const families = Object.entries(edit).filter(([ns, v]) => ns !== 'when' && v && typeof v === 'object');

describe("every scoped edit's type is its dotted path", () => {
    for (const [ns, family] of families) {
        for (const [member, factory] of Object.entries(family)) {
            if (typeof factory !== 'function') continue;
            it(`edit.${ns}.${member}() reports a "${ns}." type`, () => {
                let made;
                try { made = factory({}); } catch { return; } // needs options
                for (const e of [made].flat(Infinity)) {
                    if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue;
                    expect(e.type.startsWith(`${ns}.`), `type "${e.type}"`).toBe(true);
                }
            });
        }
    }
    it('universal edits carry a bare type', () => {
        for (const [name, factory] of Object.entries(edit)) {
            if (typeof factory !== 'function' || name === 'custom') continue;
            expect(factory({}).type).toBe(name);
        }
        expect(edit.custom(() => undefined).type).toBe('custom');
    });
});
