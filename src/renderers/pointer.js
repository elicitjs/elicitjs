// @ts-check
// Pointer input for a renderer that draws to one element (a canvas): one state
// machine that hit-tests scene nodes (pick.js) and emits the same renderer
// events as the D3 renderer:
//   click / dblclick           — plane (no node) or a mark (with node, on a still press)
//   dragstart / drag / dragend — with node for a direct-pick drag, without for plane
//   hover / hoverout           — plane, plane-on-top only
// Nothing here is canvas-specific, so another single-element renderer can bind it.
// Keyboard nudge and the text-edit `commit` are not wired here.
import { hitTest, clipVisible } from '../edit/pick.js';
import { frameThrottle, MODIFIER_KEYS, CLICK_DISTANCE, PLANE_DRAG_THRESHOLD, wheelDelta } from './shared.js';

/**
 * The cursor a node asks for: an effect's, else its own when editable.
 * @param {any} node
 * @returns {string}
 */
function cursorOf(node) {
    if (node.effectStyle && node.effectStyle.cursor != null) return node.effectStyle.cursor;
    return node.editable ? (node.cursor || 'move') : 'default';
}

/**
 * Attach the pointer state machine to a surface, once. Per-render inputs are read
 * live from `getCtx()`, so listeners survive re-renders without rebinding.
 * @param {HTMLElement} surface the element the renderer draws to
 * @param {() => any} getCtx returns the latest render context stashed by the renderer
 * @returns {{ refresh: () => void, unbind: () => void }} `refresh` re-reads the
 *   cursor after a render; `unbind` removes every listener.
 */
export function bindPointerEvents(surface, getCtx) {
    /** @type {any} */
    let gesture = null;      // { mode, node?, sx, sy, dragging, moved }
    // The hovered mark as `featureId:index`; pointerover/out fire only when it changes.
    /** @type {string | null} */
    let hoverKey = null;
    let suppressClick = false; // swallow the native click that trails a drag / mark-click
    // Where the pointer last was over the surface, in inner scene space.
    /** @type {{ x: number, y: number } | null} */
    let at = null;

    /** @type {[string, any, any][]} */
    const bound = [];
    /** @param {string} type @param {(e: any) => void} fn @param {any} [opts] */
    const on = (type, fn, opts) => {
        surface.addEventListener(type, fn, opts);
        bound.push([type, fn, opts]);
    };

    // Re-report the plane hover when a modifier key changes under a still pointer,
    // so `when`-gated edits re-arbitrate. Bound only while the pointer is over the plane.
    /** @type {{ x: number, y: number } | null} */
    let modifierHover = null;
    /** @param {KeyboardEvent} e */
    const onModifier = (e) => {
        if (!MODIFIER_KEYS.has(e.key) || gesture || !modifierHover) return;
        const ctx = getCtx();
        if (ctx.planeOnTop) ctx.onEvent({ type: 'hover', x: modifierHover.x, y: modifierHover.y, rawEvent: e });
    };
    /** @param {number} x @param {number} y */
    const watchModifiers = (x, y) => {
        if (!modifierHover && typeof window !== 'undefined') {
            window.addEventListener('keydown', onModifier);
            window.addEventListener('keyup', onModifier);
        }
        modifierHover = { x, y };
    };
    const unwatchModifiers = () => {
        if (modifierHover && typeof window !== 'undefined') {
            window.removeEventListener('keydown', onModifier);
            window.removeEventListener('keyup', onModifier);
        }
        modifierHover = null;
    };

    // The editable mark under (x, y); marks clipped out of view are not hit.
    /** @param {any} ctx @param {number} x @param {number} y @param {boolean} [hover] also a `hoverable` node */
    const pick = (ctx, x, y, hover = false) => hitTest(clipVisible(ctx.scene.children, x, y, ctx.clip || null), x, y, hover);

    surface.style.touchAction = 'none';
    surface.style.userSelect = 'none';

    /** @param {MouseEvent} e @returns {[number, number]} pointer in inner scene space */
    const toInner = (e) => {
        const ctx = getCtx();
        const rect = surface.getBoundingClientRect();
        // Undo CSS stretching in 'scale' mode.
        const sx = rect.width ? ctx.width / rect.width : 1;
        const sy = rect.height ? ctx.height / rect.height : 1;
        return [
            (e.clientX - rect.left) * sx - ctx.margins.left,
            (e.clientY - rect.top) * sy - ctx.margins.top
        ];
    };

    // The cursor for the frame just drawn. An effect's cursor only exists on the
    // nodes of that frame, so the renderer calls this after every render.
    const refresh = () => {
        const ctx = getCtx();
        if (!ctx) return;
        if (ctx.planeOnTop) { surface.style.cursor = ctx.planeCursor || 'pointer'; return; }
        if (gesture && gesture.mode === 'direct') {
            // The grabbed node as this frame drew it.
            const grabbed = gesture.node;
            const live = (ctx.scene.children || []).find((/** @type {any} */ n) =>
                n && n.editable && n.featureId === grabbed.featureId && n.index === grabbed.index);
            if (live) surface.style.cursor = cursorOf(live);
            return;
        }
        if (!at) return;
        const node = pick(ctx, at.x, at.y, true);
        surface.style.cursor = node ? cursorOf(node) : 'default';
    };

    /**
     * Close the open gesture. `released` is false for an abandoned stroke
     * (pointercancel, or a move with no button held), which is never a click.
     * @param {PointerEvent} e @param {number} x @param {number} y @param {boolean} [released]
     */
    const endGesture = (e, x, y, released = true) => {
        const ctx = getCtx();
        if (gesture) {
            if (gesture.mode === 'direct') {
                ctx.onEvent({ type: 'dragend', x, y, node: gesture.node, rawEvent: e });
                // A still press is a mark click; the trailing native plane click is suppressed.
                if (released && !gesture.moved) ctx.onEvent({ type: 'click', x, y, node: gesture.node, rawEvent: e });
                if (released) suppressClick = true;
            } else if (gesture.dragging) {
                ctx.onEvent({ type: 'dragend', x, y, rawEvent: e });
                if (released) suppressClick = true;
            }
            // A plane tap that never dragged falls through to the native plane click.
        }
        gesture = null;
        // Released off the surface: `pointerleave` doesn't fire while captured, so end hover here.
        const r = surface.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) {
            at = null;
            if (ctx.planeOnTop) ctx.onEvent({ type: 'hoverout', rawEvent: e });
            else if (hoverKey !== null) { hoverKey = null; ctx.onEvent({ type: 'pointerout', rawEvent: e }); }
        }
    };

    on('pointerdown', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);

        if (ctx.planeOnTop) {
            // Plane modes: the driver picks its own target from the coordinates.
            gesture = { mode: 'plane', sx: x, sy: y, dragging: false };
        } else {
            const node = pick(ctx, x, y);
            if (node) {
                // dragstart on press, so the undo transaction brackets the whole stroke.
                gesture = { mode: 'direct', node, sx: x, sy: y, moved: false };
                ctx.onEvent({ type: 'dragstart', x, y, node, rawEvent: e });
            } else {
                // Empty space: let the native click fire a plane click.
                gesture = null;
                return; // no capture, so the browser still fires click/dblclick
            }
        }
        e.preventDefault();
        try { surface.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    });

    // Pointer position for `tracksPointer` guides, once per frame.
    const track = frameThrottle((/** @type {any} */ e, /** @type {number} */ x, /** @type {number} */ y) => {
        getCtx().onEvent({ type: 'pointermove', x, y, rawEvent: e });
    });

    on('pointermove', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);
        at = { x, y };
        if (ctx.tracksPointer) track(e, x, y);

        // No button held with a gesture open: the release was lost, so end the gesture.
        if (gesture && e.pointerType === 'mouse' && e.buttons === 0) { endGesture(e, x, y); return; }

        if (!gesture) {
            if (ctx.planeOnTop) {
                // The plane owns the pointer; `hover` feeds proximity / probe drivers.
                watchModifiers(x, y);
                ctx.onEvent({ type: 'hover', x, y, rawEvent: e });
            } else {
                // Report the hovered mark as state (pointerover/out), never to an edit.
                const node = pick(ctx, x, y, true);
                const key = node ? `${node.featureId}:${node.index}` : null;
                if (key !== hoverKey) {
                    hoverKey = key;
                    ctx.onEvent(node
                        ? { type: 'pointerover', node, rawEvent: e }
                        : { type: 'pointerout', rawEvent: e });
                }
            }
            refresh();
            return;
        }

        if (gesture.mode === 'direct') {
            if (Math.hypot(x - gesture.sx, y - gesture.sy) > CLICK_DISTANCE) gesture.moved = true;
            ctx.onEvent({ type: 'drag', x, y, node: gesture.node, rawEvent: e });
        } else {
            if (!gesture.dragging && Math.hypot(x - gesture.sx, y - gesture.sy) > PLANE_DRAG_THRESHOLD) {
                gesture.dragging = true;
                ctx.onEvent({ type: 'dragstart', x: gesture.sx, y: gesture.sy, rawEvent: e });
            }
            if (gesture.dragging) ctx.onEvent({ type: 'drag', x, y, rawEvent: e });
        }
    });

    on('pointerup', (e) => {
        const [x, y] = toInner(e);
        endGesture(e, x, y);
    });

    // A cancelled pointer never delivers pointerup; end the stroke.
    on('pointercancel', (e) => {
        const [x, y] = toInner(e);
        endGesture(e, x, y, false);
    });

    on('pointerleave', (e) => {
        unwatchModifiers();
        const ctx = getCtx();
        if (ctx.tracksPointer) ctx.onEvent({ type: 'pointerleave', rawEvent: e });
        if (!gesture) {
            at = null;
            if (ctx.planeOnTop) ctx.onEvent({ type: 'hoverout', rawEvent: e });
            else if (hoverKey !== null) { hoverKey = null; ctx.onEvent({ type: 'pointerout', rawEvent: e }); }
        }
    });

    // The wheel gesture, only when an active edit listens (then page scroll is prevented).
    on('wheel', (e) => {
        const ctx = getCtx();
        if (!ctx.hasWheel) return;
        e.preventDefault();
        const [x, y] = toInner(e);
        ctx.onEvent({ type: 'wheel', x, y, ...wheelDelta(e), rawEvent: e });
    }, { passive: false });

    on('click', (e) => {
        if (suppressClick) { suppressClick = false; return; }
        const ctx = getCtx();
        const [x, y] = toInner(e);
        ctx.onEvent({ type: 'click', x, y, rawEvent: e });
    });

    on('dblclick', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);
        // Carry the mark under the pointer, if any; dblclick edits can sit on a node.
        const node = ctx.planeOnTop ? null : pick(ctx, x, y);
        ctx.onEvent({ type: 'dblclick', x, y, ...(node ? { node } : {}), rawEvent: e });
    });

    const unbind = () => {
        for (const [type, fn, opts] of bound) surface.removeEventListener(type, fn, opts);
        bound.length = 0;
        unwatchModifiers();
        gesture = null;
        at = null;
    };

    return { refresh, unbind };
}
