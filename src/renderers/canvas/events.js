// @ts-check
// The canvas interaction layer. SVG got hit-testing and event routing for free:
// the browser picks the element under the pointer, d3 hands back its bound node, and
// pointer-events:none marks are skipped by CSS. A canvas is one opaque element, so
// this module reconstructs that contract by hand — one pointer state machine over
// the single canvas, resolving `direct`-pick targets geometrically (via pick.js's
// hitTest) and emitting the SAME renderer events the engine already understands.
//
// It emits, verbatim to the engine's `onEvent`:
//   click / dblclick         — plane (no node) or a mark (with node, on a still press)
//   dragstart / drag / dragend — node present for a direct-pick drag, absent for plane
//   hover / hoverout         — plane, plane-on-top only (mirrors the D3 plane gestures)
// Keyboard nudge and the text-edit `commit` are deliberately not wired yet.
import { hitTest } from '../../edit/pick.js';

// Movement (px) before a press becomes a drag. `direct` matches d3.drag's
// clickDistance(4): a press that stays within it is a click, not a drag. `plane`
// matches the D3 plane gesture's 3px threshold.
const DIRECT_CLICK_DISTANCE = 4;
const PLANE_DRAG_THRESHOLD = 3;

/**
 * Attach the pointer state machine to a canvas, once. All per-render inputs
 * (onEvent, planeOnTop, margins, scene, dims) are read live from `getCtx()`, so the
 * listeners survive the engine's re-render on every drag-move without rebinding —
 * the same reason the D3 renderer keeps its plane gesture state off the DOM.
 * @param {HTMLCanvasElement} canvas
 * @param {() => any} getCtx returns the latest render context stashed by the renderer
 */
export function bindCanvasEvents(canvas, getCtx) {
    /** @type {any} */
    let gesture = null;      // { mode, node?, sx, sy, dragging, moved }
    // Which mark the pointer is currently over, as `featureId:index`. A canvas has
    // no elements to hang pointerenter/leave on, so the enter/leave EDGE has to be
    // derived: emit only when the hit test's answer changes, or the engine would get
    // a pointerover on every pixel of movement.
    /** @type {string | null} */
    let hoverKey = null;
    let suppressClick = false; // swallow the native click that trails a drag / mark-click

    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';

    /** @param {MouseEvent} e @returns {[number, number]} pointer in inner scene space */
    const toInner = (e) => {
        const ctx = getCtx();
        const rect = canvas.getBoundingClientRect();
        // In 'scale' mode the canvas is CSS-stretched, so map client px back through
        // the design/displayed ratio; in fixed/reflow the ratio is 1.
        const sx = rect.width ? ctx.width / rect.width : 1;
        const sy = rect.height ? ctx.height / rect.height : 1;
        return [
            (e.clientX - rect.left) * sx - ctx.margins.left,
            (e.clientY - rect.top) * sy - ctx.margins.top
        ];
    };

    /**
     * Close the open gesture, wherever the pointer is. `released` is false for an
     * ABANDONED stroke (pointercancel, or a move with no button held): there is no
     * native click trailing it, and a still press that was cancelled rather than
     * released is not a click.
     * @param {PointerEvent} e @param {number} x @param {number} y @param {boolean} [released]
     */
    const endGesture = (e, x, y, released = true) => {
        const ctx = getCtx();
        if (gesture) {
            if (gesture.mode === 'direct') {
                ctx.onEvent({ type: 'dragend', x, y, node: gesture.node, rawEvent: e });
                // A still press is a mark click (routed to the node's click edits). d3
                // gets this from the native click on the element; we synthesize it and
                // suppress the plane click the canvas would otherwise fire.
                if (released && !gesture.moved) ctx.onEvent({ type: 'click', x, y, node: gesture.node, rawEvent: e });
                if (released) suppressClick = true;
            } else if (gesture.dragging) {
                ctx.onEvent({ type: 'dragend', x, y, rawEvent: e });
                if (released) suppressClick = true;
            }
            // A plane tap that never dragged falls through to the native plane click.
        }
        gesture = null;
        // Released off the canvas: `pointerleave` never fires while the pointer is
        // captured, so nothing else retires the driver's hover session.
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
            // Plane-driven modes (sweep / draw / nearest): never resolve a node; the
            // driver picks its own target from the coordinates.
            gesture = { mode: 'plane', sx: x, sy: y, dragging: false };
        } else {
            // Direct pick: is there an editable mark under the pointer?
            const node = hitTest(ctx.scene.children, x, y);
            if (node) {
                // d3.drag fires 'start' on press (before any movement); mirror that so
                // the engine's undo transaction brackets the whole stroke.
                gesture = { mode: 'direct', node, sx: x, sy: y, moved: false };
                ctx.onEvent({ type: 'dragstart', x, y, node, rawEvent: e });
            } else {
                // Empty space with no plane drag bound (D3 binds none when !planeOnTop):
                // let the native click below fire a plane click.
                gesture = null;
                return; // no capture, so the browser still fires click/dblclick
            }
        }
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    });

    canvas.addEventListener('pointermove', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);

        // No button held while a gesture is open: the release was never delivered
        // (let go outside the browser window, or the window lost focus). Without
        // this the gesture stays live and the next move over the canvas — button
        // up — resumes editing. The D3 renderer guards its plane drag the same way.
        if (gesture && e.pointerType === 'mouse' && e.buttons === 0) { endGesture(e, x, y); return; }

        if (!gesture) {
            if (ctx.planeOnTop) {
                // Plane-on-top: the plane owns the pointer, and `hover` is what a
                // proximity / probe driver tracks.
                ctx.onEvent({ type: 'hover', x, y, rawEvent: e });
                canvas.style.cursor = ctx.planeCursor || 'pointer';
            } else {
                // Direct-pick: report which editable mark the pointer is over, as
                // interaction STATE (pointerover/pointerout — never routed to an edit).
                // Mirrors the D3 renderer's per-node pointerenter/leave; on a canvas
                // there are no elements to bind to, so the hit test IS the enter/leave
                // boundary. Without this a direct-pick mark had no pre-press signal at
                // all beyond the cursor — see core/effects.js's `hovered` state.
                const node = hitTest(ctx.scene.children, x, y);
                const key = node ? `${node.featureId}:${node.index}` : null;
                if (key !== hoverKey) {
                    hoverKey = key;
                    ctx.onEvent(node
                        ? { type: 'pointerover', node, rawEvent: e }
                        : { type: 'pointerout', rawEvent: e });
                }
                canvas.style.cursor = node ? (node.cursor || 'move') : 'default';
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

    // A cancelled pointer (the browser took it over for a scroll/zoom, or the
    // element lost capture) never delivers pointerup. Retire the stroke rather
    // than leaving it live for the next move to resume.
    canvas.addEventListener('pointercancel', (e) => {
        const [x, y] = toInner(e);
        endGesture(e, x, y, false);
    });

    canvas.addEventListener('pointerleave', (e) => {
        if (!gesture) {
            const ctx = getCtx();
            if (ctx.planeOnTop) ctx.onEvent({ type: 'hoverout', rawEvent: e });
            else if (hoverKey !== null) { hoverKey = null; ctx.onEvent({ type: 'pointerout', rawEvent: e }); }
        }
    });

    canvas.addEventListener('click', (e) => {
        if (suppressClick) { suppressClick = false; return; }
        const ctx = getCtx();
        const [x, y] = toInner(e);
        ctx.onEvent({ type: 'click', x, y, rawEvent: e });
    });

    canvas.addEventListener('dblclick', (e) => {
        const ctx = getCtx();
        const [x, y] = toInner(e);
        // Route to the mark under the pointer when there is one, exactly as the
        // click path does — a dblclick edit sits on a NODE (edit.stack.merge grabs a
        // boundary handle) just as often as on the plane. Emitting only the plane
        // form here meant such an edit could never fire on canvas, while `create`'s
        // plane dblclick still worked, so the gesture looked half-implemented.
        const node = ctx.planeOnTop ? null : hitTest(ctx.scene.children, x, y);
        ctx.onEvent({ type: 'dblclick', x, y, ...(node ? { node } : {}), rawEvent: e });
    });
}
