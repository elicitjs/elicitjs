// @vitest-environment jsdom
// The general `ui` parts: the context menu, proximity actions and resize handles.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, ui, edit, plot, setWarnings } from '../src/index.js';
import { flowSpec, px, steps, tick, frame, linger, fire, captureWarnings } from './ui-fixtures.js';

const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => { el.destroy(); el.dom().remove(); }); });
async function mount(spec, parts) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    await tick();
    ui.attach(el, parts);
    return el;
}
const menuOf = (el) => el.dom().querySelector('.elicit-ui-menu');
const rowsOf = (el) => [...el.dom().querySelectorAll('.elicit-ui-menu [role^=menuitem]')];
const labels = (el) => rowsOf(el).map((r) => r.textContent);
const choose = (el, label) => rowsOf(el).find((r) => r.textContent === label).click();
const S = steps();

describe('ui.contextMenu', () => {
    it('with no items, offers what the named edits allow: add on empty space, remove on a row', async () => {
        const el = await mount(flowSpec(), [ui.contextMenu()]);
        const e = fire(el.dom(), 'contextmenu', { x: 380, y: 280 });
        expect(e.defaultPrevented).toBe(true);
        expect(labels(el)).toEqual(['Add']);
        choose(el, 'Add');
        const rows = el.getData().steps;
        expect(rows).toHaveLength(4);
        expect(rows[3].x).toBeCloseTo(95, 4);

        fire(el.dom(), 'contextmenu', px(S[0]));
        expect(labels(el)).toEqual(['Remove']);
        choose(el, 'Remove');
        expect(el.getData().steps.map((r) => r.id)).not.toContain('s1');
    });

    it('leaves the browser\'s menu alone where it has nothing to offer', async () => {
        const el = await mount(flowSpec({ named: false }), [ui.contextMenu({ items: [{ label: 'Only here', on: 'note' }] })]);
        const e = fire(el.dom(), 'contextmenu', { x: 380, y: 280 });
        expect(e.defaultPrevented).toBe(false);
        expect(menuOf(el)).toBeNull();
    });

    it('writes a channel\'s value with chart.set when the spec declares no edit for it', async () => {
        const el = await mount(flowSpec(), [ui.contextMenu({ items: [{ channel: 'fill', label: 'Kind' }] })]);
        fire(el.dom(), 'contextmenu', px(S[0]));
        expect(menuOf(el).querySelector('.elicit-ui-heading').textContent).toBe('Kind');
        expect(labels(el)).toEqual(['a', 'b', 'c']);
        expect(rowsOf(el).map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
        expect(rowsOf(el).every((r) => r.querySelector('.elicit-ui-swatch'))).toBe(true);
        choose(el, 'c');
        expect(el.getData().steps[0].kind).toBe('c');
        expect(el.undo()).toBe(true);
        expect(el.getData().steps[0].kind).toBe('a');
    });

    it('uses a declared value edit on the channel when there is one', async () => {
        const el = await mount(flowSpec({ fillEdit: edit.set({ name: 'kind' }) }), [ui.contextMenu({ items: [{ channel: 'fill' }] })]);
        const driven = [];
        const control = el.control;
        el.control = (name, target) => { driven.push(name); return control(name, target); };
        fire(el.dom(), 'contextmenu', px(S[0]));
        choose(el, 'b');
        expect(driven).toEqual(['kind']);
        expect(el.getData().steps[0].kind).toBe('b');
    });

    it('adds a row with the chosen value as one undo step', async () => {
        const el = await mount(flowSpec(), [ui.contextMenu({ items: [{ edit: 'add', channel: 'fill', mark: 'note' }] })]);
        fire(el.dom(), 'contextmenu', { x: 200, y: 150 });
        expect(labels(el)).toEqual(['a', 'b', 'c']);
        choose(el, 'c');
        const rows = el.getData().steps;
        expect(rows).toHaveLength(4);
        expect(rows[3]).toMatchObject({ kind: 'c', label: 'New' });
        expect(rows[3].x).toBeCloseTo(50, 4);
        expect(el.undo()).toBe(true);
        expect(el.getData().steps).toHaveLength(3);
        expect(el.canUndo()).toBe(false);
    });

    it('leaves a channel entry with no mark off a mark that does not bind it, quietly', async () => {
        const el = await mount(flowSpec(), [ui.contextMenu({ items: [{ channel: 'fill' }, { edit: 'unlink' }] })]);
        const link = el.scene({ table: 'flows' }).find((v) => v.center && !v.channel);
        const w = captureWarnings(setWarnings, () => fire(el.dom(), 'contextmenu', link.center));
        expect(labels(el)).toEqual(['Remove']);
        expect(w).toEqual([]);
    });

    it('runs a row of your own with what was clicked', async () => {
        let got = null;
        const el = await mount(flowSpec(), [ui.contextMenu({ items: (t) => [{ label: t.view ? 'On a note' : 'On nothing', onSelect: (target) => { got = target; } }] })]);
        fire(el.dom(), 'contextmenu', px(S[1]));
        choose(el, 'On a note');
        expect(got.view).toMatchObject({ table: 'steps', index: 1 });
    });

    it('warns for an edit name the spec does not have', async () => {
        const el = await mount(flowSpec(), [ui.contextMenu({ items: [{ edit: 'nope' }] })]);
        const w = captureWarnings(setWarnings, () => fire(el.dom(), 'contextmenu', px(S[0])));
        expect(w.some((m) => m.includes('no edit is named "nope"'))).toBe(true);
        expect(menuOf(el)).toBeNull();
    });

    it('warns about an unknown option', () => {
        const w = captureWarnings(setWarnings, () => ui.contextMenu({ itmes: [] }));
        expect(w.some((m) => m.includes('unknown option "itmes"'))).toBe(true);
    });
});

describe('ui.actions', () => {
    const parts = () => [ui.actions({
        on: { mark: 'note' },
        items: [{ edit: 'delete', icon: 'trash', label: 'Remove', tone: 'danger' }],
    })];
    const buttons = (el) => [...el.dom().querySelectorAll('.elicit-ui-group:not([hidden]) .elicit-ui-button')];

    it('shows its icons beside the row the pointer is near, and hides them when it leaves', async () => {
        const el = await mount(flowSpec(), parts());
        expect(buttons(el)).toHaveLength(0);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        expect(buttons(el).map((b) => b.getAttribute('aria-label'))).toEqual(['Remove']);
        // They outlive the pointer leaving for a moment, so it can reach them.
        fire(el.dom(), 'pointermove', { x: 390, y: 290 });
        await frame();
        expect(buttons(el)).toHaveLength(1);
        await linger();
        expect(buttons(el)).toHaveLength(0);
        fire(el.dom(), 'pointermove', px(S[1]));
        await frame();
        fire(el.dom(), 'pointerleave');
        expect(buttons(el)).toHaveLength(0);
    });

    it('moves straight to another row the pointer comes to', async () => {
        const el = await mount(flowSpec(), [ui.actions({ on: { mark: 'note' }, items: [{ icon: 'check', label: 'Pick', onClick: () => {} }] })]);
        const anchor = () => el.dom().querySelector('.elicit-ui-group').style.transform;
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        const first = anchor();
        fire(el.dom(), 'pointermove', px(S[1]));
        await frame();
        expect(buttons(el)).toHaveLength(1);
        expect(anchor()).not.toBe(first);
    });

    it('fires the edit on that row', async () => {
        const el = await mount(flowSpec(), parts());
        fire(el.dom(), 'pointermove', px(S[1]));
        await frame();
        buttons(el)[0].click();
        expect(el.getData().steps.map((r) => r.id)).toEqual(['s1', 's3']);
    });

    it('drives a drag edit from its button', async () => {
        const el = await mount(flowSpec(), [ui.actions({ on: { mark: 'note' }, items: [{ edit: 'drag', icon: 'grip', label: 'Move' }] })]);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        const b = buttons(el)[0];
        fire(b, 'pointerdown', { x: 100, y: 40 });
        fire(b, 'pointermove', { x: 140, y: 70 });
        fire(b, 'pointerup', { x: 140, y: 70 });
        // The note travels as far as the pointer did: 40px right, 30px down.
        const row = el.getData().steps[0];
        expect(row.x).toBeCloseTo(30, 4);
        expect(row.y).toBeCloseTo(70, 4);
        expect(el.undo()).toBe(true);
        expect(el.getData().steps[0]).toMatchObject({ x: 20, y: 80 });
        expect(el.canUndo()).toBe(false);
    });

    it('calls a button of your own with the piece', async () => {
        let got = null;
        const el = await mount(flowSpec(), [ui.actions({ on: { mark: 'note' }, items: [{ icon: 'check', label: 'Pick', onClick: (v) => { got = v; } }] })]);
        fire(el.dom(), 'pointermove', px(S[2]));
        await frame();
        buttons(el)[0].click();
        expect(got).toMatchObject({ table: 'steps', index: 2 });
    });
});

describe('ui.handles', () => {
    const grips = (el) => [...el.dom().querySelectorAll('.elicit-ui-handle:not([hidden])')];

    it('puts a grip on each side the mark sizes from data, on the row the pointer is near', async () => {
        const el = await mount(flowSpec(), [ui.handles({ on: { mark: 'note' } })]);
        expect(grips(el)).toHaveLength(0);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        expect(grips(el).map((g) => g.getAttribute('aria-label'))).toEqual(['Resize from the left', 'Resize from the right']);
        // Row 0's box spans x 30..130, y 41..79. Its right side's middle holds a
        // port, so the grip takes the corner below it.
        expect(grips(el)[1].style.transform).toContain('translate(130px, 79px)');
        expect(grips(el)[1].dataset.corner).toBe('');
    });

    it('sits mid-side on a mark with no handle there, on any chart', async () => {
        const el = await mount({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: {
                note: { type: 'categorical', open: true },
                w: { type: 'quantitative', domain: [60, 200] },
                x: { type: 'quantitative', domain: [0, 100] },
                y: { type: 'quantitative', domain: [0, 100] },
            },
            data: [{ note: 'A note', w: 100, x: 50, y: 50 }],
            marks: [plot.sticker({ id: 'note', channels: { x: { field: 'x' }, y: { field: 'y' }, text: { field: 'note' }, width: { field: 'w', scale: { range: [60, 200] } } } })],
        }, [ui.handles()]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        expect(grips(el)).toHaveLength(2);
        expect(grips(el)[1].style.transform).toContain('translate(250px, 150px)');
        expect(grips(el)[1].dataset.corner).toBeUndefined();
        const right = grips(el)[1];
        fire(right, 'pointerdown', { x: 250, y: 150 });
        fire(right, 'pointermove', { x: 270, y: 150 });
        fire(right, 'pointerup', { x: 270, y: 150 });
        expect(el.getData()[0]).toMatchObject({ w: 120 });
        expect(el.scene({ mark: 'note/body', index: 0 })[0].box.x).toBeCloseTo(150, 4);
    });

    it('on a turned box, a grip sits on the turned side and drags along it', async () => {
        const el = await mount({
            width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
            schema: {
                w: { type: 'quantitative', domain: [60, 200] },
                x: { type: 'quantitative', domain: [0, 100] },
                y: { type: 'quantitative', domain: [0, 100] },
            },
            data: [{ w: 100, x: 50, y: 50 }],
            marks: [plot.rect({ id: 'box', height: 40, angle: 90, channels: { x: { field: 'x' }, y: { field: 'y' }, width: { field: 'w', scale: { range: [60, 200] } } } })],
        }, [ui.handles()]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        // 100 wide turned a quarter: the right side faces up, 50px above the centre.
        const right = grips(el)[1];
        expect(right.style.transform).toContain('translate(200px, 100px)');
        fire(right, 'pointerdown', { x: 200, y: 100 });
        fire(right, 'pointermove', { x: 200, y: 80 });
        fire(right, 'pointerup', { x: 200, y: 80 });
        const row = el.getData()[0];
        expect(row.w).toBeCloseTo(120, 4);
        // The left side (now at the bottom, y 200) stays: the centre moves up 10px.
        expect(row.x).toBeCloseTo(50, 4);
        expect(300 - row.y * 3).toBeCloseTo(140, 4);
    });

    // A 100 x 40 box at the centre of the plot, turned by its `a` column.
    const turnSpec = (a = 0) => ({
        width: 400, height: 300, margins: { top: 0, right: 0, bottom: 0, left: 0 }, axes: false,
        schema: {
            x: { type: 'quantitative', domain: [0, 100] },
            y: { type: 'quantitative', domain: [0, 100] },
            a: { type: 'quantitative', domain: [-180, 180] },
        },
        data: [{ x: 50, y: 50, a }],
        marks: [plot.rect({ id: 'box', width: 100, height: 40, channels: { x: { field: 'x' }, y: { field: 'y' }, angle: { field: 'a', scale: { range: [-180, 180] } } } })],
    });
    const gripAt = (g) => { const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(g.style.transform); return { x: +m[1], y: +m[2] }; };
    const kind = (el, k) => el.dom().querySelector(`.elicit-ui-handle[data-kind=${k}]:not([hidden])`);

    it('rotate: a grip above the box turns it about its centre, as one undo step', async () => {
        const el = await mount(turnSpec(), [ui.handles({ rotate: true, resize: false })]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        const grip = kind(el, 'rotate');
        expect(grip.getAttribute('aria-label')).toBe('Rotate');
        const at = gripAt(grip);
        expect(at.x).toBeCloseTo(200, 4);
        expect(at.y).toBeLessThan(130);
        // From above the centre to its right: a quarter turn clockwise.
        fire(grip, 'pointerdown', at);
        fire(grip, 'pointermove', { x: 250, y: 140 });
        fire(grip, 'pointermove', { x: 300, y: 150 });
        fire(grip, 'pointerup', { x: 300, y: 150 });
        expect(el.getData()[0].a).toBeCloseTo(-90, 4);
        expect(el.undo()).toBe(true);
        expect(el.getData()[0].a).toBe(0);
        expect(el.canUndo()).toBe(false);
    });

    it('rotate: Shift snaps to 15 degrees, and the grip follows the turn', async () => {
        const el = await mount(turnSpec(), [ui.handles({ rotate: true, resize: false })]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        const grip = kind(el, 'rotate');
        fire(grip, 'pointerdown', gripAt(grip));
        // 50px right of the centre and 100px up: about 26.6 degrees clockwise.
        fire(grip, 'pointermove', { x: 250, y: 50 }, { shiftKey: true });
        fire(grip, 'pointerup', { x: 250, y: 50 }, { shiftKey: true });
        expect(el.getData()[0].a).toBeCloseTo(-30, 6);
        await frame();
        // Turned 30 degrees clockwise, the grip moves right of the centre.
        expect(gripAt(kind(el, 'rotate')).x).toBeGreaterThan(200);
    });

    it('rotate: arrow keys turn it', async () => {
        const el = await mount(turnSpec(), [ui.handles({ rotate: true, resize: false })]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        kind(el, 'rotate').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        expect(el.getData()[0].a).toBeCloseTo(5, 4);
        kind(el, 'rotate').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
        expect(el.getData()[0].a).toBeCloseTo(-10, 4);
    });

    it('move: a grip below the box moves it as far as the pointer went', async () => {
        const el = await mount(turnSpec(), [ui.handles({ move: true, resize: false })]);
        fire(el.dom(), 'pointermove', { x: 200, y: 150 });
        await frame();
        const grip = kind(el, 'move');
        expect(grip.getAttribute('aria-label')).toBe('Move');
        const at = gripAt(grip);
        expect(at.y).toBeGreaterThan(170);
        fire(grip, 'pointerdown', at);
        fire(grip, 'pointermove', { x: at.x + 40, y: at.y - 30 });
        fire(grip, 'pointerup', { x: at.x + 40, y: at.y - 30 });
        // 40px is 10 on x; 30px up is 10 on y.
        expect(el.getData()[0]).toMatchObject({ x: 60, y: 60 });
        expect(el.undo()).toBe(true);
        expect(el.getData()[0]).toMatchObject({ x: 50, y: 50 });
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(el.getData()[0].x).toBeCloseTo(51, 4);
    });

    it('warns when the mark binds nothing to turn', async () => {
        const w = [];
        const orig = console.warn;
        console.warn = (...a) => w.push(a.join(' '));
        setWarnings(true);
        try { await mount(flowSpec(), [ui.handles({ on: { mark: 'note' }, rotate: true })]); } finally { console.warn = orig; }
        expect(w.some((s) => s.includes('"angle"'))).toBe(true);
    });

    it('dragging the right grip widens the box and keeps its left side still, as one undo step', async () => {
        const el = await mount(flowSpec(), [ui.handles({ on: { mark: 'note' } })]);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        const right = grips(el)[1];
        fire(right, 'pointerdown', { x: 130, y: 60 });
        fire(right, 'pointermove', { x: 150, y: 60 });
        fire(right, 'pointermove', { x: 170, y: 60 });
        fire(right, 'pointerup', { x: 170, y: 60 });
        const row = el.getData().steps[0];
        expect(row.w).toBeCloseTo(140, 4);
        const box = el.scene({ mark: 'note/body', index: 0 })[0].box;
        expect(box.x).toBeCloseTo(30, 4);
        expect(box.width).toBeCloseTo(140, 4);
        expect(el.undo()).toBe(true);
        expect(el.getData().steps[0]).toMatchObject({ w: 100, x: 20 });
        expect(el.canUndo()).toBe(false);
    });

    it('dragging the left grip keeps the right side still, and stops at the scale\'s range', async () => {
        const el = await mount(flowSpec(), [ui.handles({ on: { mark: 'note' } })]);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        const left = grips(el)[0];
        fire(left, 'pointerdown', { x: 30, y: 60 });
        fire(left, 'pointermove', { x: 300, y: 60 });
        fire(left, 'pointerup', { x: 300, y: 60 });
        const box = el.scene({ mark: 'note/body', index: 0 })[0].box;
        expect(box.width).toBeCloseTo(60, 4);
        expect(box.x + box.width).toBeCloseTo(130, 4);
    });

    it('Escape mid-drag puts the box back', async () => {
        const el = await mount(flowSpec(), [ui.handles({ on: { mark: 'note' } })]);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        const right = grips(el)[1];
        fire(right, 'pointerdown', { x: 130, y: 60 });
        fire(right, 'pointermove', { x: 170, y: 60 });
        expect(el.getData().steps[0].w).toBeCloseTo(140, 4);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(el.getData().steps[0]).toMatchObject({ w: 100, x: 20 });
    });

    it('an arrow key steps the side', async () => {
        const el = await mount(flowSpec(), [ui.handles({ on: { mark: 'note' } })]);
        fire(el.dom(), 'pointermove', px(S[0]));
        await frame();
        grips(el)[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(el.getData().steps[0].w).toBeCloseTo(104, 4);
    });

    it('warns when the mark sizes nothing from data', async () => {
        const spec = flowSpec();
        const w = [];
        const orig = console.warn;
        console.warn = (...a) => w.push(a.join(' '));
        setWarnings(true);
        try { await mount(spec, [ui.handles({ on: { mark: 'flow' } })]); } finally { console.warn = orig; }
        expect(w.some((m) => m.includes('nothing to resize'))).toBe(true);
    });
});
