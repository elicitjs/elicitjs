// @vitest-environment jsdom
// `ui.network`: the icons beside a port and on a link, the menu and the grips,
// each backed by a named edit of the spec.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, ui, setWarnings } from '../src/index.js';
import { flowSpec, px, steps, tick, frame, linger, fire } from './ui-fixtures.js';

const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => { el.destroy(); el.dom().remove(); }); });
async function mount(spec, options) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    await tick();
    ui.attach(el, [ui.network(options)]);
    return el;
}
const buttons = (el) => [...el.dom().querySelectorAll('.elicit-ui-group:not([hidden]) .elicit-ui-button')];
const names = (el) => buttons(el).map((b) => b.getAttribute('aria-label'));
const rowsOf = (el) => [...el.dom().querySelectorAll('.elicit-ui-menu [role^=menuitem]')];
const S = steps();
// A port's pixel: the middle of one side of a sticker's box.
const portOf = (el, index, side) => el.scene({ mark: 'note', index, channel: 'port', side })[0].center;
async function near(el, point) {
    fire(el.dom(), 'pointermove', point);
    await frame();
}

const button = (el, label) => buttons(el).find((b) => b.getAttribute('aria-label') === label);
const ADD = 'Add a linked node', LINK = 'Link to a node', DETACH = 'Detach link';

describe('ui.network: beside a port', () => {
    it('a free port offers a new node and a link; a port holding a link also offers to detach it', async () => {
        const el = await mount(flowSpec());
        await near(el, portOf(el, 0, 'bottom'));
        expect(names(el)).toEqual([ADD, LINK]);
        // The seeded link leaves row 0 by its right side.
        await near(el, portOf(el, 0, 'right'));
        expect(names(el)).toEqual([ADD, LINK, DETACH]);
    });

    it('shows nothing away from every port and link', async () => {
        const el = await mount(flowSpec());
        await near(el, px(S[0]));
        expect(buttons(el)).toHaveLength(0);
    });

    it('stays for a moment after the pointer leaves the port', async () => {
        const el = await mount(flowSpec());
        await near(el, portOf(el, 0, 'bottom'));
        await near(el, { x: 390, y: 290 });
        expect(names(el)).toEqual([ADD, LINK]);
        await linger();
        expect(buttons(el)).toHaveLength(0);
    });

    it('clicking "+" adds a node on that side, like this one and linked from it, as one undo step', async () => {
        const el = await mount(flowSpec());
        const at = portOf(el, 0, 'bottom');
        await near(el, at);
        const plus = button(el, ADD);
        fire(plus, 'pointerdown', at);
        fire(plus, 'pointerup', at);
        const { steps: rows, flows } = el.getData();
        expect(rows).toHaveLength(4);
        // Below row 0, with its category and its width.
        expect(rows[3]).toMatchObject({ kind: 'a', w: 100, label: 'New' });
        expect(rows[3].x).toBeCloseTo(20, 4);
        expect(rows[3].y).toBeLessThan(rows[0].y - 20);
        expect(flows).toHaveLength(2);
        expect(flows[1]).toMatchObject({ source: 's1', target: rows[3].id, fromSide: 'bottom', toSide: 'top' });
        expect(el.undo()).toBe(true);
        expect(el.getData().steps).toHaveLength(3);
        expect(el.getData().flows).toHaveLength(1);
        expect(el.canUndo()).toBe(false);
    });

    it('puts the new node clear of one that is already there', async () => {
        const spec = flowSpec();
        // A node right where "+" would put one below row 0.
        spec.data.steps.push({ id: 's4', label: 'In the way', kind: 'b', w: 100, x: 20, y: 48.6 });
        const el = await mount(spec);
        const at = portOf(el, 0, 'bottom');
        await near(el, at);
        const plus = button(el, ADD);
        fire(plus, 'pointerdown', at);
        fire(plus, 'pointerup', at);
        const rows = el.getData().steps;
        expect(rows).toHaveLength(5);
        const fresh = el.scene({ mark: 'note/body', index: 4 })[0].box;
        const taken = el.scene({ mark: 'note/body', index: 3 })[0].box;
        const apart = fresh.x + fresh.width <= taken.x || taken.x + taken.width <= fresh.x
            || fresh.y + fresh.height <= taken.y || taken.y + taken.height <= fresh.y;
        expect(apart).toBe(true);
    });

    it('dragging "+" onto a node links to it', async () => {
        const el = await mount(flowSpec());
        const from = portOf(el, 0, 'bottom');
        await near(el, from);
        const plus = button(el, ADD);
        fire(plus, 'pointerdown', from);
        fire(plus, 'pointermove', { x: 120, y: 200 });
        fire(plus, 'pointermove', px(S[2]));
        fire(plus, 'pointerup', px(S[2]));
        const { steps: rows, flows } = el.getData();
        expect(rows).toHaveLength(3);
        expect(flows).toHaveLength(2);
        expect(flows[1]).toMatchObject({ source: 's1', target: 's3', fromSide: 'bottom' });
    });

    it('dragging "+" onto empty space makes the node there', async () => {
        const el = await mount(flowSpec());
        const from = portOf(el, 0, 'bottom');
        await near(el, from);
        const plus = button(el, ADD);
        fire(plus, 'pointerdown', from);
        fire(plus, 'pointermove', { x: 200, y: 160 });
        fire(plus, 'pointerup', { x: 200, y: 150 });
        const { steps: rows, flows } = el.getData();
        expect(rows).toHaveLength(4);
        expect(rows[3].x).toBeCloseTo(50, 4);
        expect(rows[3].y).toBeCloseTo(50, 4);
        expect(flows[1]).toMatchObject({ source: 's1', target: rows[3].id });
        expect(el.undo()).toBe(true);
        expect(el.getData().steps).toHaveLength(3);
    });

    it('clicking the link icon arms it: the next press on the chart is the drop, and the chart\'s own gestures stay out', async () => {
        const el = await mount(flowSpec());
        await near(el, portOf(el, 0, 'bottom'));
        const link = button(el, LINK);
        const at = portOf(el, 0, 'bottom');
        fire(link, 'pointerdown', at);
        fire(link, 'pointerup', at);
        expect(link.dataset.active).toBe('');
        const body = el.dom().querySelector('svg .mark');
        const press = fire(body, 'pointerdown', px(S[2]));
        expect(press.defaultPrevented).toBe(true);
        expect(el.getData().flows).toHaveLength(2);
        expect(el.getData().flows[1]).toMatchObject({ source: 's1', target: 's3' });
        // Nothing was moved by that press, and no node was added.
        expect(el.getData().steps).toHaveLength(3);
        expect(el.getData().steps[2]).toMatchObject({ x: 30, y: 20 });
    });

    it('Escape disarms it without a link', async () => {
        const el = await mount(flowSpec());
        await near(el, portOf(el, 0, 'bottom'));
        const link = button(el, LINK);
        const at = portOf(el, 0, 'bottom');
        fire(link, 'pointerdown', at);
        fire(link, 'pointerup', at);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fire(el.dom().querySelector('svg .mark'), 'pointerdown', px(S[2]));
        expect(el.getData().flows).toHaveLength(1);
        expect(el.canUndo()).toBe(false);
    });

    it('with no create edit, a port offers the link icon alone', async () => {
        const el = await mount(flowSpec(), { edits: { create: 'nope' } });
        await near(el, portOf(el, 0, 'bottom'));
        expect(names(el)).toEqual([LINK]);
    });

    it('clicking detach removes the link docked there', async () => {
        const el = await mount(flowSpec());
        const at = portOf(el, 0, 'right');
        await near(el, at);
        const detach = button(el, DETACH);
        fire(detach, 'pointerdown', at);
        fire(detach, 'pointerup', at);
        detach.click();
        expect(el.getData().flows).toHaveLength(0);
    });

    it('dragging detach re-points that end of the link', async () => {
        const el = await mount(flowSpec());
        const at = portOf(el, 0, 'right');
        await near(el, at);
        const detach = button(el, DETACH);
        fire(detach, 'pointerdown', at);
        fire(detach, 'pointermove', { x: 150, y: 150 });
        fire(detach, 'pointermove', px(S[2]));
        fire(detach, 'pointerup', px(S[2]));
        expect(el.getData().flows).toEqual([expect.objectContaining({ source: 's3', target: 's2' })]);
    });

    it('with several links at one port, detach asks which', async () => {
        const links = [
            { source: 's1', target: 's2', fromSide: 'right', toSide: 'left' },
            { source: 's3', target: 's1', fromSide: 'top', toSide: 'right' },
        ];
        const el = await mount(flowSpec({ links }));
        const at = portOf(el, 0, 'right');
        await near(el, at);
        expect(names(el)).toEqual([ADD, LINK, 'Detach a link']);
        const detach = button(el, 'Detach a link');
        fire(detach, 'pointerdown', at);
        fire(detach, 'pointerup', at);
        detach.click();
        expect(rowsOf(el).map((r) => r.textContent)).toEqual(['Remove link to s2', 'Remove link from s3']);
        rowsOf(el)[1].click();
        expect(el.getData().flows).toEqual([expect.objectContaining({ target: 's2' })]);
    });
});

describe('ui.network: on a link', () => {
    const lineOf = (el) => el.scene({ mark: 'flow', index: 0 }).find((v) => v.type === 'path' && !v.channel);

    it('offers reverse and remove where the pointer meets it', async () => {
        const el = await mount(flowSpec());
        const mid = lineOf(el).center;
        // A third of the way along, not the middle: the icons come to the pointer.
        const ends = ['source', 'target'].map((ch) => el.scene({ mark: 'flow', channel: ch })[0].center);
        const at = { x: ends[0].x + (ends[1].x - ends[0].x) / 3, y: ends[0].y + (ends[1].y - ends[0].y) / 3 };
        await near(el, at);
        expect(names(el)).toEqual(['Reverse link', 'Remove link']);
        const where = el.dom().querySelector('.elicit-ui-group').style.transform;
        // Beside the point the pointer met the link at, not at the link's middle.
        const [gx, gy] = where.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).slice(1).map(Number);
        expect(Math.hypot(gx - at.x, gy - at.y)).toBeLessThan(30);
        expect(Math.hypot(gx - mid.x, gy - mid.y)).toBeGreaterThan(10);
        // Off the line: above it.
        expect(gy).toBeLessThan(at.y);
        // They stay where they appeared as the pointer moves along the link.
        await near(el, mid);
        expect(el.dom().querySelector('.elicit-ui-group').style.transform).toBe(where);
    });

    it('reverse swaps the ends and leaves each node at its port', async () => {
        const el = await mount(flowSpec());
        await near(el, lineOf(el).center);
        button(el, 'Reverse link').click();
        expect(el.getData().flows[0]).toEqual({ source: 's2', target: 's1', fromSide: 'left', toSide: 'right' });
    });

    it('a port\'s icons take over from a link\'s near the port', async () => {
        const el = await mount(flowSpec());
        await near(el, lineOf(el).center);
        expect(names(el)).toEqual(['Reverse link', 'Remove link']);
        await near(el, portOf(el, 0, 'right'));
        expect(names(el)).toEqual([ADD, LINK, DETACH]);
        // One set at a time.
        expect(el.dom().querySelectorAll('.elicit-ui-group:not([hidden])')).toHaveLength(1);
    });
});

describe('ui.network: the menu', () => {
    it('adds a node of a chosen category on empty space, as one undo step', async () => {
        const el = await mount(flowSpec());
        fire(el.dom(), 'contextmenu', { x: 200, y: 280 });
        expect(el.dom().querySelector('.elicit-ui-heading').textContent).toBe('Add');
        rowsOf(el).find((r) => r.textContent === 'c').click();
        const rows = el.getData().steps;
        expect(rows).toHaveLength(4);
        expect(rows[3].kind).toBe('c');
        el.undo();
        expect(el.getData().steps).toHaveLength(3);
    });

    it('offers a node its category and Remove', async () => {
        const el = await mount(flowSpec());
        fire(el.dom(), 'contextmenu', px(S[1]));
        expect(rowsOf(el).map((r) => r.textContent)).toEqual(['a', 'b', 'c', 'Remove']);
        rowsOf(el)[0].click();
        expect(el.getData().steps[1].kind).toBe('a');
        fire(el.dom(), 'contextmenu', px(S[1]));
        rowsOf(el)[3].click();
        expect(el.getData().steps.map((r) => r.id)).toEqual(['s1', 's3']);
        // Its link went with it.
        expect(el.getData().flows).toHaveLength(0);
    });

    it('offers a link Reverse and Remove', async () => {
        const el = await mount(flowSpec());
        const line = el.scene({ mark: 'flow', index: 0 }).find((v) => v.type === 'path' && !v.channel);
        fire(el.dom(), 'contextmenu', line.center);
        expect(rowsOf(el).map((r) => r.textContent)).toEqual(['Reverse', 'Remove link']);
    });
});

describe('ui.network: what the spec does not name', () => {
    it('warns for each unnamed edit and offers nothing for it', async () => {
        const seen = [];
        const orig = console.warn;
        console.warn = (...a) => seen.push(a.join(' '));
        setWarnings(true);
        let el;
        try { el = await mount(flowSpec({ named: false })); } finally { console.warn = orig; }
        expect(seen.filter((m) => m.includes('has no name')).length).toBeGreaterThanOrEqual(4);
        await near(el, portOf(el, 0, 'bottom'));
        expect(buttons(el)).toHaveLength(0);
    });

    it('takes an edit by the name the author gives', async () => {
        const el = await mount(flowSpec(), { edits: { unlink: 'nope' } });
        const at = portOf(el, 0, 'right');
        await near(el, at);
        // No remove behind a click: detach is drag-only, so a click arms the re-point.
        expect(names(el)).toEqual([ADD, LINK, DETACH]);
    });

    it('grips resize a node whose width is data', async () => {
        const el = await mount(flowSpec());
        await near(el, px(S[0]));
        expect(el.dom().querySelectorAll('.elicit-ui-handle:not([hidden])')).toHaveLength(2);
    });

    it('warns on a chart that is not a network', async () => {
        const seen = [];
        const orig = console.warn;
        console.warn = (...a) => seen.push(a.join(' '));
        setWarnings(true);
        try {
            const el = Elicit({ width: 200, height: 100, schema: { x: { type: 'quantitative', domain: [0, 1] } }, data: [{ x: 0 }], marks: [] });
            document.body.appendChild(el.dom());
            mounted.push(el);
            await tick();
            ui.attach(el, [ui.network()]);
        } finally { console.warn = orig; }
        expect(seen.some((m) => m.includes('not a network'))).toBe(true);
    });
});
