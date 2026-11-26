// @ts-check
import { warn } from '../core/dev.js';
import { ensureStyles, applyTokens } from './styles.js';
import { createContext } from './context.js';

/** @param {any} parts @returns {any[]} */
const flatten = (parts) => (Array.isArray(parts) ? parts.flat(Infinity) : [parts]).filter(Boolean);

/**
 * Lay UI over a chart: menus, icons and handles that drive it through external
 * control. Not part of the spec; attach after `Elicit(spec)`.
 *
 * The layer is one element over the chart's drawing. Each part mounts into it
 * and is torn down by `detach()` or by `chart.destroy()`.
 * @param {import('../types').Chart} chart
 * @param {import('../types').UiPart | import('../types').UiPart[] | any[]} parts
 * @returns {{ detach: () => void }}
 */
export function attach(chart, parts) {
    const list = flatten(parts);
    for (const part of list) {
        if (!part || typeof part.mount !== 'function') {
            warn('ui:part', 'ui.attach(chart, parts): every part needs a `mount(ctx)` function. Build one with ui.custom(mount).');
        }
    }
    if (!chart || typeof chart.dom !== 'function') {
        warn('ui:chart', 'ui.attach(chart, parts): `chart` must be a chart, as `Elicit(spec)` returns.');
        return { detach() {} };
    }
    const host = chart.dom();
    const doc = host.ownerDocument;
    const layer = doc.createElement('div');
    layer.className = 'elicit-ui';

    /** @type {(() => void)[]} */
    let disposers = [];
    /** @type {(() => void) | null} */
    let disposeCtx = null;
    let state = 'waiting'; // -> 'mounted' -> 'detached'

    // The renderer's drawing must be in the container first: it finds its own
    // root by tag, and the layer goes after it.
    const drawn = () => Array.from(host.children).some((el) => /^(svg|canvas)$/i.test(el.tagName));
    const mount = () => {
        if (state !== 'waiting' || !drawn()) return;
        state = 'mounted';
        ensureStyles(doc);
        applyTokens(layer, chart.theme.ui);
        host.appendChild(layer);
        const { ctx, dispose } = createContext(chart, layer);
        disposeCtx = dispose;
        for (const part of list) {
            if (!part || typeof part.mount !== 'function') continue;
            const off = part.mount(ctx);
            if (typeof off === 'function') disposers.push(off);
        }
    };

    const detach = () => {
        if (state === 'detached') return;
        state = 'detached';
        offRender();
        offDestroy();
        for (const off of disposers.splice(0)) off();
        if (disposeCtx) disposeCtx();
        layer.remove();
    };
    const offRender = chart.on('render', mount);
    const offDestroy = chart.on('destroy', detach);
    mount();
    return { detach };
}

/**
 * A part of your own: `mount(ctx)` builds it in the layer and may return a
 * function that takes it down. `ctx` is the chart, the layer and its helpers.
 * @param {(ctx: import('../types').UiContext) => (void | (() => void))} mount
 * @returns {import('../types').UiPart}
 */
export function custom(mount) {
    if (typeof mount !== 'function') {
        warn('ui:custom', 'ui.custom(mount): `mount` must be a function of the layer context.');
        return { type: 'custom', mount: () => {} };
    }
    return { type: 'custom', mount };
}
