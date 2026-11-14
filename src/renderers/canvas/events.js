// @ts-check
// Canvas interaction: one pointer state machine that hit-tests nodes (pick.js)
// and emits the same renderer events as the D3 renderer:
//   click / dblclick           — plane (no node) or a mark (with node, on a still press)
//   dragstart / drag / dragend — with node for a direct-pick drag, without for plane
//   hover / hoverout           — plane, plane-on-top only
// Keyboard nudge and the text-edit `commit` are not wired yet.
import { hitTest, clipVisible } from '../../edit/pick.js';
import { frameThrottle, MODIFIER_KEYS } from '../shared.js';

// Movement (px) before a press becomes a drag, matching the D3 renderer.
const DIRECT_CLICK_DISTANCE = 4;
const PLANE_DRAG_THRESHOLD = 3;

/**
 * Attach the pointer state machine to a canvas, once. Per-render inputs are read
 * live from `getCtx()`, so listeners survive re-renders without rebinding.
 * @param {HTMLCanvasElement} canvas
 * @param {() => any} getCtx returns the latest render context stashed by the renderer
 */
export function bindCanvasEvents(canvas, getCtx) {
    /** @type {any} */
    let gesture = null;      // { mode, node?, sx, sy, dragging, moved }
    // The hovered mark as `featureId:index`; pointerover/out fire only when it changes.
    /** @type {string | null} */
    let hoverKey = null;
    let suppressClick = false; // swallow the native click that trails a drag / mark-click

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

    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';

    /** @param {MouseEvent} e @returns {[number, number]} pointer in inner scene space */
    const toInner = (e) => {
        const ctx = getCtx();
        const rect = canvas.getBoundingClientRect();
        // Undo CSS stretching in 'scale' mode.
        const sx = rect.width ? ctx.width / rect.width : 1;
        const sy = rect.height ? ctx.height / rect.height : 1;
        return [
            (e.clientX - rect.left) * sx - ctx.margins.left,
            (e.clientY - rect.top) * sy - ctx.margins.top
        ];
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
        // Released off the canvas: `pointerleave` doesn't fire while captured, so end hover here.
        const r = canvas.getBoundingClientRect();
        const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (outside) {
            if (ctx.planeOnTop) ctx.onEvent({ type: 'hoverout', rawEvent: e });
            else if (hoverKey !== null) { hoverKey = null; ctx.onEvent({ type: 'pointerout', rawEvent: e }); }
        }
    };

    canvas.addEventListener('pointerdown', (e) => {
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
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    });

    // Pointer position for `tracksPointer` guides, once per frame.
    const track = frameThrottle((/** @type {any} */ e, /** @type {number} */ x, /** @type {number} */ y) => {
        getCtx().onEvent({ type: 'pointermove', x, y, rawEvent: e });
    });

    canvas.addEventListener('pointermove', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);
        if (ctx.tracksPointer) track(e, x, y);

        // No button held with a gesture open: the release was lost, so end the gesture.
        if (gesture && e.pointerType === 'mouse' && e.buttons === 0) { endGesture(e, x, y); return; }

        if (!gesture) {
            if (ctx.planeOnTop) {
                // The plane owns the pointer; `hover` feeds proximity / probe drivers.
                watchModifiers(x, y);
                ctx.onEvent({ type: 'hover', x, y, rawEvent: e });
                canvas.style.cursor = ctx.planeCursor || 'pointer';
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
                canvas.style.cursor = node && node.editable ? (node.cursor || 'move') : 'default';
            }
            return;
        }

        if (gesture.mode === 'direct') {
            if (Math.hypot(x - gesture.sx, y - gesture.sy) > DIRECT_CLICK_DISTANCE) gesture.moved = true;
            ctx.onEvent({ type: 'drag', x, y, node: gesture.node, rawEvent: e });
        } else {
            if (!gesture.dragging && Math.hypot(x - gesture.sx, y - gesture.sy) > PLANE_DRAG_THRESHOLD) {
                gesture.dragging = true;
                ctx.onEvent({ type: 'dragstart', x: gesture.sx, y: gesture.sy, rawEvent: e });
            }
            if (gesture.dragging) ctx.onEvent({ type: 'drag', x, y, rawEvent: e });
        }
    });

    canvas.addEventListener('pointerup', (e) => {
        const [x, y] = toInner(e);
        endGesture(e, x, y);
    });

    // A cancelled pointer never delivers pointerup; end the stroke.
    canvas.addEventListener('pointercancel', (e) => {
        const [x, y] = toInner(e);
        endGesture(e, x, y, false);
    });

    canvas.addEventListener('pointerleave', (e) => {
        unwatchModifiers();
        {
            const ctx = getCtx();
            if (ctx.tracksPointer) ctx.onEvent({ type: 'pointerleave', rawEvent: e });
        }
        if (!gesture) {
            const ctx = getCtx();
            if (ctx.planeOnTop) ctx.onEvent({ type: 'hoverout', rawEvent: e });
            else if (hoverKey !== null) { hoverKey = null; ctx.onEvent({ type: 'pointerout', rawEvent: e }); }
        }
    });

    // The wheel gesture, only when an active edit listens (then page scroll is prevented).
    canvas.addEventListener('wheel', (e) => {
        const ctx = getCtx();
        if (!ctx.hasWheel) return;
        e.preventDefault();
        const [x, y] = toInner(e);
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        ctx.onEvent({ type: 'wheel', x, y, deltaX: (e.deltaX || 0) * unit, deltaY: (e.deltaY || 0) * unit, rawEvent: e });
    }, { passive: false });

    canvas.addEventListener('click', (e) => {
        if (suppressClick) { suppressClick = false; return; }
        const ctx = getCtx();
        const [x, y] = toInner(e);
        ctx.onEvent({ type: 'click', x, y, rawEvent: e });
    });

    canvas.addEventListener('dblclick', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);
        // Carry the mark under the pointer, if any; dblclick edits can sit on a node.
        const node = ctx.planeOnTop ? null : pick(ctx, x, y);
        ctx.onEvent({ type: 'dblclick', x, y, ...(node ? { node } : {}), rawEvent: e });
    });
}
