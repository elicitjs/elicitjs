// @ts-check
// Drive a drag edit from a button. Press and drag the button: the stroke starts
// on the row and follows the pointer. Click it instead: the stroke follows the
// pointer until the next press on the chart, and Escape abandons it.

/**
 * @param {import('../types').UiContext} ctx
 * @param {HTMLElement} el the button
 * @param {string} name the edit
 * @param {() => import('../types').SceneRef | null} refOf the handle to start from, read at the press
 * @param {{ onStart?: () => void, onDone?: () => void }} [hooks]
 * @returns {() => void} stop
 */
export function driveStroke(ctx, el, name, refOf, hooks = {}) {
    const { chart } = ctx;
    /** @type {import('../types').EditControl | null} */
    let live = null;
    /** @type {(() => void) | null} */
    let release = null;

    // Press where the pointer is, so a relative edit travels as far as it does.
    /** @param {import('../types').Point} at */
    const begin = (at) => {
        const ref = refOf();
        if (!ref) return false;
        live = chart.control(name, ref);
        live.begin(at);
        el.dataset.active = '';
        if (hooks.onStart) hooks.onStart();
        return true;
    };
    /** @param {boolean} commit */
    const finish = (commit) => {
        const c = live;
        live = null;
        if (release) { release(); release = null; }
        delete el.dataset.active;
        if (c) { if (commit) c.end(); else c.cancel(); }
        if (hooks.onDone) hooks.onDone();
    };
    /** @param {import('../types').Point} p */
    const to = (p) => { if (live) live.emit({ type: 'drag', x: p.x, y: p.y }); };

    const off = ctx.drag(el, {
        start: ({ point }) => { if (live) finish(false); begin(point); },
        move: ({ point }) => to(point),
        end: ({ point }) => { to(point); finish(true); },
        cancel: () => finish(false),
        // A click arms it; the next press on the chart is the release.
        click: ({ point }) => {
            if (live) { finish(false); return; }
            if (!begin(point)) return;
            release = ctx.capture({
                move: to,
                press: (p) => { to(p); finish(true); },
                cancel: () => finish(false),
            });
        },
    });
    return () => { if (live) finish(false); off(); };
}
