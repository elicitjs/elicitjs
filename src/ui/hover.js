// @ts-check
// A group of icon buttons that shows for one target at a time and stays put while
// the pointer travels to it. Shared by `ui.actions` and `ui.network`.

// How long the group outlives the pointer leaving its target, in ms.
const LINGER = 350;
// Slack around the group and the path to it, in CSS px.
const SLACK = 10;

/**
 * @template T
 * @param {import('../types').UiContext} ctx
 * @param {{
 *   find: (point: import('../types').Point, event: Event) => T | null,
 *   same: (a: T, b: T) => boolean,
 *   build: (target: T, add: (el: HTMLElement) => void, onClear: (off: () => void) => void) => void,
 *   anchor: (target: T) => import('../types').SceneView | import('../types').Point | null,
 *   placement: (target: T) => import('../types').Placement,
 *   light?: (target: T, on: boolean) => void,
 * }} config
 *   `find` names what the pointer is at; `build` adds its buttons; `anchor` and
 *   `placement` say where they sit; `light` marks the target in the chart.
 * @returns {{ show: (target: T | null) => void, busy: (on: boolean) => void, active: () => T | null, dispose: () => void }}
 */
export function hoverGroup(ctx, config) {
    const { chart } = ctx;
    const doc = ctx.layer.ownerDocument;
    const group = doc.createElement('div');
    group.className = 'elicit-ui-group';
    group.hidden = true;

    /** @type {T | null} */
    let active = null;
    let busy = false;
    /** @type {any} */
    let timer = null;
    /** @type {(() => void)[]} */
    let offs = [];

    const wait = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
    const clear = () => { offs.splice(0).forEach((off) => off()); group.replaceChildren(); };
    /** @param {T | null} target @param {boolean} on */
    const light = (target, on) => { if (target != null && config.light) config.light(target, on); };

    /** @param {T | null} target */
    const show = (target) => {
        wait();
        if (target != null && active != null && config.same(target, active)) return;
        if (target == null && active == null) return;
        light(active, false);
        clear();
        active = target;
        if (target != null) {
            config.build(target, (el) => group.appendChild(el), (off) => offs.push(off));
            if (!group.childElementCount) active = null;
        }
        group.hidden = active == null;
        light(active, true);
        ctx.refresh();
    };

    const offPlace = ctx.place(group, () => (active != null ? config.anchor(active) : null),
        () => (active != null ? config.placement(active) : {}));

    // Is the pointer on the group, or on its way there from the anchor?
    /** @param {any} e */
    const onTheWay = (e) => {
        if (active == null || group.hidden) return false;
        const r = group.getBoundingClientRect();
        // Not laid out (no layout engine): there is no path to keep.
        if (!r.width && !r.height) return false;
        const a = config.anchor(active);
        const p = a && 'center' in a ? a.center : a;
        const from = p ? chart.toClient(/** @type {any} */ (p)) : { x: r.left, y: r.top };
        const x0 = Math.min(r.left, from.x) - SLACK, x1 = Math.max(r.right, from.x) + SLACK;
        const y0 = Math.min(r.top, from.y) - SLACK, y1 = Math.max(r.bottom, from.y) + SLACK;
        return e.clientX >= x0 && e.clientX <= x1 && e.clientY >= y0 && e.clientY <= y1;
    };

    const offPointer = ctx.onPointer((e) => {
        if (busy) return;
        if (e.type === 'leave' || !e.point) { show(null); return; }
        if (e.type !== 'move') return;
        // A drag on the chart itself: stay out of its way.
        if (/** @type {any} */ (e.event).buttons) { show(null); return; }
        const target = /** @type {any} */ (e.event.target);
        if (target && target.closest && target.closest('.elicit-ui-group') === group) { wait(); return; }
        const found = config.find(e.point, e.event);
        if (found != null && active != null && config.same(found, active)) { wait(); return; }
        // Heading for the buttons: neither hide nor jump to what lies under the path.
        if (onTheWay(e.event)) { wait(); return; }
        if (found != null) { show(found); return; }
        // Off the target: give the pointer a moment to come back or reach the buttons.
        if (active != null && timer == null) timer = setTimeout(() => { timer = null; if (!busy) show(null); }, LINGER);
    });

    // On the buttons: stay, and keep the target marked.
    const onEnter = () => { wait(); light(active, true); };
    group.addEventListener('pointerenter', onEnter);

    return {
        show,
        // A stroke or a menu in flight: hold everything as it is.
        busy(on) { busy = on; if (on) wait(); },
        active: () => active,
        dispose() {
            wait();
            light(active, false);
            group.removeEventListener('pointerenter', onEnter);
            offPointer();
            offPlace();
            clear();
            group.remove();
        },
    };
}
