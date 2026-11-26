// @vitest-environment jsdom
// `ui.attach`: the layer over a chart, the part context, and teardown.
import { describe, it, expect, afterEach } from 'vitest';
import { Elicit, ui, authoring, setWarnings } from '../src/index.js';
import { flowSpec, tick, fire, captureWarnings } from './ui-fixtures.js';

const mounted = [];
afterEach(() => { mounted.splice(0).forEach((el) => { el.destroy(); el.dom().remove(); }); });
function mount(spec) {
    const el = Elicit(spec);
    document.body.appendChild(el.dom());
    mounted.push(el);
    return el;
}

describe('ui.attach', () => {
    it('adds the layer after the drawing, once the chart has drawn', async () => {
        const el = mount(flowSpec());
        let ctxSeen = null;
        ui.attach(el, [ui.custom((ctx) => { ctxSeen = ctx; })]);
        expect(el.dom().querySelector('.elicit-ui')).toBeNull();
        expect(ctxSeen).toBeNull();
        await tick();
        const kids = [...el.dom().children];
        expect(kids.map((k) => k.tagName.toLowerCase())).toEqual(['svg', 'div']);
        expect(kids[1].className).toBe('elicit-ui');
        expect(ctxSeen.layer).toBe(kids[1]);
        expect(ctxSeen.chart).toBe(el);
    });

    it('mounts at once on a chart that has already drawn', async () => {
        const el = mount(flowSpec());
        await tick();
        let n = 0;
        ui.attach(el, ui.custom(() => { n++; }));
        expect(n).toBe(1);
    });

    it('leaves the renderer its own svg when a part adds one', async () => {
        const el = mount(flowSpec());
        await tick();
        ui.attach(el, [ui.custom((ctx) => { ctx.place(ctx.button({ icon: 'plus', label: 'Add' }), { x: 10, y: 10 }); })]);
        el.control('drag', 0).set({ x: 50, y: 50 });
        // The chart still draws into the first svg; the icon's svg is untouched.
        expect(el.dom().querySelectorAll(':scope > svg')).toHaveLength(1);
        expect(el.dom().querySelector('.elicit-ui-button svg path')).not.toBeNull();
        expect(el.dom().querySelector(':scope > svg .mark-layer')).not.toBeNull();
    });

    it('hands the theme\'s ui tokens to the layer as CSS variables, and one stylesheet to the page', async () => {
        const a = mount(flowSpec());
        const b = mount(flowSpec({ extra: { theme: 'dark' } }));
        await tick();
        ui.attach(a, []);
        ui.attach(b, []);
        const va = a.dom().querySelector('.elicit-ui').style;
        const vb = b.dom().querySelector('.elicit-ui').style;
        expect(va.getPropertyValue('--elicit-ui-surface')).toBe('#ffffff');
        expect(va.getPropertyValue('--elicit-ui-size')).toBe('22px');
        expect(vb.getPropertyValue('--elicit-ui-surface')).toBe('#161a21');
        expect(document.head.querySelectorAll('style[data-elicit-ui]')).toHaveLength(1);
    });

    it('detach() takes down every part and the layer', async () => {
        const el = mount(flowSpec());
        await tick();
        let down = 0;
        const layer = ui.attach(el, [ui.custom(() => () => { down++; }), [ui.custom(() => () => { down++; })]]);
        layer.detach();
        layer.detach();
        expect(down).toBe(2);
        expect(el.dom().querySelector('.elicit-ui')).toBeNull();
    });

    it('chart.destroy() detaches it', async () => {
        const el = mount(flowSpec());
        await tick();
        let down = 0;
        ui.attach(el, [ui.custom(() => () => { down++; })]);
        el.destroy();
        expect(down).toBe(1);
        expect(el.dom().querySelector('.elicit-ui')).toBeNull();
    });

    it('warns for a part with no mount', async () => {
        const el = mount(flowSpec());
        await tick();
        const w = captureWarnings(setWarnings, () => ui.attach(el, [{ type: 'nope' }]));
        expect(w.some((m) => m.includes('mount(ctx)'))).toBe(true);
    });
});

describe('the part context', () => {
    it('place() keeps an element on a row as the row moves', async () => {
        const el = mount(flowSpec());
        await tick();
        let dot;
        ui.attach(el, [ui.custom((ctx) => {
            dot = document.createElement('div');
            ctx.place(dot, ctx.chart.scene({ mark: 'note/body', index: 0 })[0], { at: 'right', offset: 6 });
        })]);
        // Row 0's box spans x 30..130 at y 60: its right side, 6px out.
        expect(dot.style.transform).toContain('translate(136px, 60px)');
        el.control('drag', 0).set({ x: 50, y: 50 });
        expect(dot.style.transform).toContain('translate(256px, 150px)');
    });

    it('place() hides an element whose anchor is gone, and removes it on teardown', async () => {
        const el = mount(flowSpec());
        await tick();
        let dot, off;
        ui.attach(el, [ui.custom((ctx) => {
            dot = document.createElement('div');
            off = ctx.place(dot, () => null);
        })]);
        expect(dot.hidden).toBe(true);
        off();
        expect(dot.isConnected).toBe(false);
    });

    it('button() is a labelled button with an icon; an unknown icon name warns', async () => {
        const el = mount(flowSpec());
        await tick();
        authoring.registerIcon('dot', 'M8 8h.01');
        let ctx;
        ui.attach(el, [ui.custom((c) => { ctx = c; })]);
        const b = ctx.button({ icon: 'dot', label: 'Dot', tone: 'danger' });
        expect(b.getAttribute('aria-label')).toBe('Dot');
        expect(b.dataset.tone).toBe('danger');
        expect(b.querySelector('path').getAttribute('d')).toBe('M8 8h.01');
        const w = captureWarnings(setWarnings, () => ctx.icon('no-such-icon'));
        expect(w.some((m) => m.includes('no icon is named'))).toBe(true);
    });

    it('menu() is a keyboard menu: arrows move, Enter chooses, Escape closes and returns focus', async () => {
        const el = mount(flowSpec());
        await tick();
        let ctx;
        ui.attach(el, [ui.custom((c) => { ctx = c; })]);
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const chosen = [];
        const items = [
            { heading: 'Kind' },
            { label: 'A', checked: false, onSelect: () => chosen.push('A') },
            { label: 'B', checked: true, onSelect: () => chosen.push('B') },
            { separator: true },
            { label: 'Remove', tone: 'danger', onSelect: () => chosen.push('rm') },
        ];
        let m = ctx.menu(items, { x: 20, y: 20 });
        expect(m.element.getAttribute('role')).toBe('menu');
        const rows = () => [...m.element.querySelectorAll('[role^=menuitem]')];
        expect(rows().map((r) => r.getAttribute('role'))).toEqual(['menuitemradio', 'menuitemradio', 'menuitem']);
        // Focus opens on the current choice.
        expect(document.activeElement.textContent).toBe('B');
        fire(document, 'keydown', {}, {});
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement.textContent).toBe('Remove');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(document.activeElement.textContent).toBe('A');
        document.activeElement.click();
        expect(chosen).toEqual(['A']);
        expect(m.element.isConnected).toBe(false);
        expect(document.activeElement).toBe(opener);

        m = ctx.menu(items, { x: 20, y: 20 });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(m.element.isConnected).toBe(false);
        expect(document.activeElement).toBe(opener);
        // Opening a second menu closes the first.
        const first = ctx.menu(items, { x: 20, y: 20 });
        const second = ctx.menu(items, { x: 40, y: 40 });
        expect(first.element.isConnected).toBe(false);
        second.close();
        opener.remove();
    });

    it('onPointer() reports the pointer in inner pixels and a right-click as `menu`', async () => {
        const el = mount(flowSpec({ extra: { margins: { top: 10, right: 0, bottom: 0, left: 20 } } }));
        await tick();
        const seen = [];
        ui.attach(el, [ui.custom((ctx) => { ctx.onPointer((e) => seen.push([e.type, e.point])); })]);
        fire(el.dom(), 'contextmenu', { x: 120, y: 60 });
        fire(el.dom(), 'pointerleave');
        expect(seen).toEqual([['menu', { x: 100, y: 50 }], ['leave', null]]);
    });
});
