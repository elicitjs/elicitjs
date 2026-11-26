// @ts-check
// The pointer over the chart, in inner chart pixels, read from DOM events on the
// chart's own container: the layer needs no help from a renderer.

/** @param {import('../types').Chart} chart @param {{ clientX: number, clientY: number }} e */
const innerOf = (chart, e) => chart.toInner({ x: e.clientX, y: e.clientY });

/**
 * Follow the pointer over the chart: `move` once per frame, `leave`, and `menu`
 * for a right-click (a listener calls `event.preventDefault()` to take it).
 * @param {import('../types').Chart} chart
 * @param {(e: import('../types').UiPointerEvent) => void} cb
 * @returns {() => void} stop
 */
export function watchPointer(chart, cb) {
    const host = chart.dom();
    const view = host.ownerDocument.defaultView;
    const raf = view && view.requestAnimationFrame ? view.requestAnimationFrame.bind(view) : (/** @type {any} */ f) => setTimeout(f, 16);
    /** @type {PointerEvent | null} */
    let pending = null;
    let queued = false;
    let stopped = false;
    const flush = () => {
        queued = false;
        const e = pending;
        pending = null;
        if (e && !stopped) cb({ type: 'move', point: innerOf(chart, e), event: e });
    };
    const onMove = (/** @type {any} */ e) => {
        pending = e;
        if (!queued) { queued = true; raf(flush); }
    };
    const onLeave = (/** @type {any} */ e) => { pending = null; cb({ type: 'leave', point: null, event: e }); };
    const onMenu = (/** @type {any} */ e) => cb({ type: 'menu', point: innerOf(chart, e), event: e });
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('contextmenu', onMenu);
    return () => {
        stopped = true;
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('contextmenu', onMenu);
    };
}

// How far a press may travel and still be a click.
const CLICK_SLOP = 3;

/**
 * Make `el` a drag source. `start` runs on the first movement, with the point of
 * the press; `move` on that movement and each after it; `end` on release. A press
 * that never moved is a `click`. Escape or a lost pointer is a `cancel`.
 * @param {import('../types').Chart} chart
 * @param {HTMLElement} el
 * @param {import('../types').UiDragHandlers} handlers
 * @returns {() => void} stop
 */
export function dragOn(chart, el, handlers) {
    const doc = el.ownerDocument;
    /** @type {{ id: number, x: number, y: number, moved: boolean, point: import('../types').Point } | null} */
    let press = null;
    const info = (/** @type {any} */ e) => ({
        point: innerOf(chart, e),
        dx: press ? e.clientX - press.x : 0,
        dy: press ? e.clientY - press.y : 0,
        event: e,
    });
    const finish = () => {
        press = null;
        doc.removeEventListener('keydown', onKey, true);
        delete el.dataset.active;
    };
    const onDown = (/** @type {any} */ e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, point: innerOf(chart, e) };
        try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
        doc.addEventListener('keydown', onKey, true);
        e.preventDefault();
        e.stopPropagation();
    };
    const onMove = (/** @type {any} */ e) => {
        if (!press || e.pointerId !== press.id) return;
        if (!press.moved) {
            if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK_SLOP) return;
            press.moved = true;
            el.dataset.active = '';
            // The drag starts where the press went down, not where it was noticed.
            if (handlers.start) handlers.start({ point: press.point, dx: 0, dy: 0, event: e });
        }
        if (handlers.move) handlers.move(info(e));
    };
    const onUp = (/** @type {any} */ e) => {
        if (!press || e.pointerId !== press.id) return;
        const moved = press.moved;
        const at = info(e);
        finish();
        if (moved) { if (handlers.end) handlers.end(at); }
        else if (handlers.click) handlers.click(at);
    };
    const onCancel = () => {
        if (!press) return;
        const moved = press.moved;
        finish();
        if (moved && handlers.cancel) handlers.cancel();
    };
    const onKey = (/** @type {any} */ e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    // A keyboard or assistive click never presses: it is a click.
    const onClick = (/** @type {any} */ e) => { if (e.detail === 0 && handlers.click) handlers.click(info(e)); };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('click', onClick);
    return () => {
        onCancel();
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onCancel);
        el.removeEventListener('click', onClick);
    };
}

// Every event a renderer might start a gesture from.
const PRESS_EVENTS = ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick'];

/**
 * Take the chart's next press for the layer: until `release()`, the chart's own
 * gestures see nothing. `move` follows the pointer, `press` is the press itself,
 * `cancel` is Escape. For a two-step action: click an icon, then click a target.
 * @param {import('../types').Chart} chart
 * @param {{ move?: (point: import('../types').Point) => void, press?: (point: import('../types').Point) => void, cancel?: () => void }} handlers
 * @returns {() => void} release
 */
export function capturePress(chart, handlers) {
    const host = chart.dom();
    const doc = host.ownerDocument;
    let live = true;
    const swallow = (/** @type {any} */ e) => {
        // The layer's own controls keep working.
        if (e.target && e.target.closest && e.target.closest('.elicit-ui')) return;
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        if (e.type === 'pointerdown' && handlers.press) handlers.press(innerOf(chart, e));
    };
    const onMove = (/** @type {any} */ e) => { if (handlers.move) handlers.move(innerOf(chart, e)); };
    const onKey = (/** @type {any} */ e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        if (handlers.cancel) handlers.cancel();
    };
    for (const type of PRESS_EVENTS) host.addEventListener(type, swallow, true);
    host.addEventListener('pointermove', onMove, true);
    doc.addEventListener('keydown', onKey, true);
    return () => {
        if (!live) return;
        live = false;
        for (const type of PRESS_EVENTS) host.removeEventListener(type, swallow, true);
        host.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('keydown', onKey, true);
    };
}
