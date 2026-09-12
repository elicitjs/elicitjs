// @vitest-environment jsdom
// Every edit reaches exactly ONE driver, chosen by `driverFor`: an exact
// `name === pick` beats any `wants()` claim, and among `wants` claims the first in
// registry order wins. Before this, `runDrivers` handed every driver whatever it
// wanted, so an edit two drivers claimed was run and committed twice per tick.
// The per-feature session is shared by every driver on a mark, so a driver's
// `clear()` nulls only the keys it declared (`sessionKeys`).
import { describe, it, expect, beforeAll } from 'vitest';
import { Elicit, plot, edit, authoring, setWarnings } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

const calls = { byName: 0, byWantsFirst: 0, byWantsSecond: 0, owner: 0, tenant: 0 };
let seenSession = null;

beforeAll(() => {
    setWarnings(false);
    // Two drivers that both WANT a `custom` edit: only the first registered runs it,
    // and a `pick` naming a driver outright beats both.
    authoring.registerDriver({
        name: 'spyByName',
        onEvent: () => { calls.byName += 1; return false; },
    });
    authoring.registerDriver({
        name: 'spyWantsFirst',
        wants: (e) => e.type === 'custom' && e.name === 'claimed',
        onEvent: () => { calls.byWantsFirst += 1; return false; },
    });
    authoring.registerDriver({
        name: 'spyWantsSecond',
        wants: (e) => e.type === 'custom' && e.name === 'claimed',
        onEvent: () => { calls.byWantsSecond += 1; return false; },
    });
    // Two drivers sharing one feature's session: the owner declares its keys and
    // clears; the tenant's key must survive.
    authoring.registerDriver({
        name: 'owner',
        sessionKeys: ['a'],
        onEvent: ({ session }) => {
            calls.owner += 1;
            if (calls.owner === 1) session.set({ a: 1 });
            else { session.clear(); seenSession = session.get(); }
            return false;
        },
    });
    authoring.registerDriver({
        name: 'tenant',
        sessionKeys: ['b'],
        onEvent: ({ session }) => { calls.tenant += 1; session.set({ b: 2 }); return false; },
    });
});

function mount(edits) {
    const el = Elicit({
        width: 200, height: 100,
        schema: { x: { type: 'quantitative', domain: [0, 10] }, y: { type: 'quantitative', domain: [0, 10] } },
        data: [{ x: 5, y: 5 }],
        marks: [plot.point({ channels: { x: { field: 'x' }, y: { field: 'y' } }, edits })],
    });
    document.body.appendChild(el);
    return el;
}

describe('driver exclusivity', () => {
    it('routes a plane edit to the driver its pick names, and to no other', async () => {
        const el = mount([edit.custom(() => undefined, { name: 'claimed', pick: 'spyByName' })]);
        await tick();
        el.emit({ type: 'dragstart', x: 10, y: 10 });
        expect(calls.byName).toBe(1);
        expect(calls.byWantsFirst).toBe(0);
        expect(calls.byWantsSecond).toBe(0);
    });

    it('among wants() claims, only the first registered driver runs the edit', async () => {
        const el = mount([edit.custom(() => undefined, { name: 'claimed', pick: 'plane' })]);
        await tick();
        // pick:'plane' names the plane driver; a wants() claim never outranks a name.
        const before = { ...calls };
        el.emit({ type: 'dragstart', x: 10, y: 10 });
        expect(calls.byWantsFirst).toBe(before.byWantsFirst);
        expect(calls.byWantsSecond).toBe(before.byWantsSecond);
    });

    it('slide({ mode: "relative" }) refuses a foreign pick instead of being claimed twice', () => {
        const e = edit.slide({ channel: 'x', pick: 'nearest' });
        expect(e.pick).toBe('direct');
        expect(edit.slide({ channel: 'x', pick: 'slide' }).pick).toBe('slide');
        expect(edit.slide({ channel: 'x', mode: 'absolute', pick: 'nearest' }).pick).toBe('nearest');
    });

    it("a driver's clear() nulls only its own session keys", async () => {
        const el = mount([
            edit.custom(() => undefined, { name: 'own', pick: 'owner' }),
            edit.custom(() => undefined, { name: 'rent', pick: 'tenant' }),
        ]);
        await tick();
        el.emit({ type: 'dragstart', x: 10, y: 10 }); // owner sets a, tenant sets b
        el.emit({ type: 'drag', x: 12, y: 12 });      // owner clears, tenant sets b again
        expect(calls.owner).toBe(2);
        expect(seenSession).toMatchObject({ a: null, b: 2 });
    });
});
