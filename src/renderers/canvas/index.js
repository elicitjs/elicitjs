// @ts-check
// CanvasRenderer — a second implementation of the renderer contract (D3Renderer is
// the reference). It exists to prove the seam is real: marks, edits, scales, guides,
// constraints and the engine are all renderer-agnostic, so a whole different drawing
// backend drops in through `spec.renderer` with no changes upstream.
//
// The contract, mirrored from D3Renderer:
//   - `render(context)` where context carries { container, scene, width, height,
//     margins, planeOnTop, planeCursor, responsive, overflow, focusOutline,
//     effects, onEvent, ... }. (focusOutline is SVG-only; ignored here — canvas
//     has no keyboard focus path yet.)
//   - Emits renderer events back through `context.onEvent` (see events.js).
//
// Retained-mode SVG diffs a scene graph; a canvas has nothing to retain, so each
// render is a full clear-and-repaint. That fits the engine, which already rebuilds
// every node each update — the SVG data-join was only ever a DOM optimisation.
//
// Deferred (documented gaps, not blockers): keyboard `nudge`, the inline text-edit
// overlay, and the grab/proximity effect visuals.
import { paintScene } from './draw.js';
import { bindCanvasEvents } from './events.js';

export class CanvasRenderer {
    constructor() {
        /** @type {HTMLCanvasElement | null} */
        this._canvas = null;
        /** @type {CanvasRenderingContext2D | null} */
        this._2d = null;
        // Latest render context, read live by the event listeners (which are bound
        // once and must survive the engine's re-render on every drag-move).
        /** @type {any} */
        this._ctx = null;
        // href -> { img, ready }: raster tiles persist across renders so a basemap
        // that stays on screen never re-fetches (the canvas analogue of a keyed join).
        /** @type {Map<string, any>} */
        this._images = new Map();
    }

    /**
     * @param {any} context
     */
    render(context) {
        const { container, scene, width, height, margins } = context;
        const responsive = context.responsive || 'fixed';

        this._ensure(container);
        // Stash for the event listeners + the async-image repaint.
        this._ctx = context;

        // Chart backdrop (theme.background; null => transparent). A CSS background on
        // the canvas element, matching the D3 renderer's svg background — it sits
        // under the cleared/painted pixels, so a dark theme fills the whole chart.
        const canvasEl = /** @type {HTMLCanvasElement} */ (this._canvas);
        canvasEl.style.background = (context.theme && context.theme.background) || '';

        const canvas = /** @type {HTMLCanvasElement} */ (this._canvas);
        const ctx = /** @type {CanvasRenderingContext2D} */ (this._2d);

        // Back the canvas at device pixels for crisp output, present it at CSS px.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const bw = Math.round(width * dpr);
        const bh = Math.round(height * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        if (responsive === 'scale') {
            // Stretch to the parent (aspect ratio preserved); pointer mapping divides
            // by the displayed/design ratio (see events.js toInner).
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
        } else {
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        // Enter inner scene space: DPR scale, then the margins translate (the SVG
        // renderer's <g transform="translate(left,top)">).
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.translate(margins.left, margins.top);

        paintScene(ctx, scene.children, {
            images: this._images,
            theme: context.theme,
            requestRepaint: () => this._repaint()
        });
    }

    /**
     * Idempotent scaffolding: one <canvas> in the container, event listeners bound
     * once. Mirrors D3Renderer._ensureScene.
     * @param {HTMLElement} container
     */
    _ensure(container) {
        if (this._canvas && this._canvas.parentNode === container) return;
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        container.appendChild(canvas);
        this._canvas = canvas;
        this._2d = canvas.getContext('2d');
        bindCanvasEvents(canvas, () => this._ctx);
    }

    /**
     * Repaint from the last render context, without the engine driving it — used when
     * an async raster tile finishes loading. Re-runs the same transform + paint the
     * last `render` used, so it stays in lockstep with the engine's current scene.
     */
    _repaint() {
        const context = this._ctx;
        const ctx = this._2d;
        if (!context || !ctx) return;
        const { scene, width, height, margins } = context;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.translate(margins.left, margins.top);
        paintScene(ctx, scene.children, {
            images: this._images,
            theme: context.theme,
            requestRepaint: () => this._repaint()
        });
    }
}
