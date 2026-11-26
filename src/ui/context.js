// @ts-check
import { button as makeButton, menu as openMenu } from './dom.js';
import { iconElement } from './icons.js';
import { position } from './place.js';
import { watchPointer, dragOn, capturePress } from './pointer.js';

/**
 * What a part's `mount(ctx)` is handed: the chart, the layer, and helpers that
 * clean up after themselves when the layer detaches.
 *
 * @param {import('../types').Chart} chart
 * @param {HTMLElement} layer
 * @returns {{ ctx: import('../types').UiContext, dispose: () => void }}
 */
export function createContext(chart, layer) {
    const doc = layer.ownerDocument;
    /** @type {Set<() => void>} */
    const cleanups = new Set();
    /** @param {() => void} off @returns {() => void} */
    const track = (off) => {
        const once = () => { if (cleanups.delete(once)) off(); };
        cleanups.add(once);
        return once;
    };

    /** @type {{ close: () => void } | null} */
    let menuOpen = null;
    // Every live placement, so `refresh` can re-run them between frames.
    /** @type {Set<() => void>} */
    const placements = new Set();

    /** @type {import('../types').UiContext} */
    const ctx = {
        chart,
        layer,
        // Keep `el` at an anchor: a point, a view, or a function read on every
        // render. A view is looked up again each frame, so it follows its row.
        // `placement` may be a function too, read with the anchor.
        place(el, anchor, placement) {
            if (el.parentNode !== layer) layer.appendChild(el);
            const read = () => {
                if (typeof anchor === 'function') return anchor();
                if (anchor && typeof anchor === 'object' && 'mark' in anchor) {
                    const v = /** @type {import('../types').SceneView} */ (anchor);
                    if (v.index == null) return v;
                    return chart.scene({
                        mark: v.mark, index: v.index,
                        ...(v.channel != null ? { channel: v.channel } : {}),
                        ...(v.side != null ? { side: v.side } : {}),
                    }).find((s) => s.type === v.type) || null;
                }
                return anchor;
            };
            const update = () => { position(chart, el, read(), typeof placement === 'function' ? placement() : placement); };
            update();
            placements.add(update);
            const off = chart.on('render', update);
            return track(() => { off(); placements.delete(update); el.remove(); });
        },
        // Re-run every placement now: after a part changes what it is anchored to.
        refresh() { for (const update of [...placements]) update(); },
        button: (options) => makeButton(doc, options),
        icon: (icon) => iconElement(doc, icon),
        // One menu at a time. `at` is in inner chart pixels.
        menu(items, at) {
            if (menuOpen) menuOpen.close();
            const page = chart.toClient(at);
            const host = layer.getBoundingClientRect();
            const m = openMenu(layer, items, { x: page.x - host.left, y: page.y - host.top }, {
                onClose: () => { if (menuOpen === handle) menuOpen = null; },
            });
            const handle = { close: m.close, element: m.element };
            menuOpen = handle;
            return handle;
        },
        onRender: (cb) => track(chart.on('render', cb)),
        onPointer: (cb) => track(watchPointer(chart, cb)),
        drag: (el, handlers) => track(dragOn(chart, el, handlers)),
        capture: (handlers) => track(capturePress(chart, handlers)),
    };

    const dispose = () => {
        if (menuOpen) menuOpen.close();
        for (const off of [...cleanups]) off();
    };
    return { ctx, dispose };
}
