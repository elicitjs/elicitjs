// @ts-check
// CanvasRenderer: the renderer contract (`render(context)`, events via
// `context.onEvent`) drawn on a canvas. Each render is a full clear-and-repaint.
// What it cannot do is declared in `supports`; the engine warns when a spec asks.
import { paintScene, canFilter } from './draw.js';
import { bindPointerEvents } from '../pointer.js';

// Longest backing-store side, in device px, however far a 'scale' chart is stretched.
const MAX_SIDE = 8192;

export class CanvasRenderer {
    constructor() {
        /** @type {HTMLCanvasElement | null} */
        this._canvas = null;
        /** @type {CanvasRenderingContext2D | null} */
        this._2d = null;
        // Latest render context, read live by the event listeners.
        /** @type {any} */
        this._ctx = null;
        // href -> { img, ready }: raster tiles cached across renders.
        /** @type {Map<string, any>} */
        this._images = new Map();
        /** @type {{ refresh: () => void, unbind: () => void } | null} */
        this._pointer = null;
        // 'scale' mode: the width the canvas is shown at, in CSS px, and its observer.
        this._shown = 0;
        /** @type {ResizeObserver | null} */
        this._sizes = null;
        // The host page's font, used when the theme names none.
        /** @type {string | null} */
        this._hostFont = null;
    }

    /**
     * No keyboard focus, no inline text editor, and nothing drawn outside the
     * canvas. `filter` depends on the browser's 2D context.
     * @returns {import('../../types').RendererSupports}
     */
    get supports() {
        return { keyboard: false, textEditor: false, filter: canFilter(), overflow: false };
    }

    /**
     * @param {any} context
     */
    render(context) {
        const { container, width, height } = context;
        const responsive = context.responsive || 'fixed';

        this._ensure(container);
        this._ctx = context;

        // Chart backdrop (theme.background) as a CSS background under the pixels.
        const canvas = /** @type {HTMLCanvasElement} */ (this._canvas);
        canvas.style.background = (context.theme && context.theme.background) || '';

        if (responsive === 'scale') {
            // Stretch to the parent; pointer.js toInner maps the pointer back.
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
        } else {
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }
        this._watchSize(responsive === 'scale');

        // A theme with no font family takes the host page's, as SVG text inherits it.
        const themed = context.theme && context.theme.font && context.theme.font.family;
        this._hostFont = themed || typeof getComputedStyle !== 'function'
            ? null
            : getComputedStyle(canvas).fontFamily || null;

        this._repaint();
        if (this._pointer) this._pointer.refresh();
    }

    /**
     * Release what outlives a frame: listeners, the size observer, cached tiles.
     * The last frame stays on the canvas.
     */
    destroy() {
        if (this._pointer) this._pointer.unbind();
        this._pointer = null;
        this._watchSize(false);
        this._images.clear();
        this._ctx = null;
    }

    /**
     * Create the <canvas> and bind its listeners, once per container.
     * @param {HTMLElement} container
     */
    _ensure(container) {
        if (this._canvas && this._canvas.parentNode === container) return;
        const canvas = document.createElement('canvas');
        canvas.style.display = 'block';
        container.appendChild(canvas);
        this._canvas = canvas;
        this._2d = canvas.getContext('2d');
        this._pointer = bindPointerEvents(canvas, () => this._ctx);
    }

    /**
     * In 'scale' mode the canvas is stretched with CSS, so follow the width it is
     * shown at and repaint at that size. Off in every other mode.
     * @param {boolean} on
     */
    _watchSize(on) {
        const canvas = this._canvas;
        if (!on || !canvas || typeof ResizeObserver === 'undefined') {
            if (this._sizes) this._sizes.disconnect();
            this._sizes = null;
            this._shown = 0;
            return;
        }
        if (this._sizes) return;
        this._shown = canvas.clientWidth || 0;
        this._sizes = new ResizeObserver(() => {
            const shown = canvas.clientWidth || 0;
            // Only a width change matters; the height follows from the aspect ratio.
            if (shown === this._shown) return;
            this._shown = shown;
            this._repaint();
        });
        this._sizes.observe(canvas);
    }

    /**
     * Paint the last render context; also called when a raster tile loads or the
     * shown size changes.
     */
    _repaint() {
        const context = this._ctx;
        const ctx = this._2d;
        const canvas = this._canvas;
        if (!context || !ctx || !canvas) return;
        const { scene, width, height, margins } = context;

        // Device pixels per chart px: the DPR, times the CSS stretch in 'scale' mode.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const stretch = this._shown && width ? this._shown / width : 1;
        const ratio = Math.min(dpr * stretch, MAX_SIDE / Math.max(width, height, 1));
        const bw = Math.max(1, Math.round(width * ratio));
        const bh = Math.max(1, Math.round(height * ratio));
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }

        // Inner scene space: the pixel ratio, then the margins.
        ctx.setTransform(bw / width, 0, 0, bh / height, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.translate(margins.left, margins.top);
        paintScene(ctx, scene.children, {
            images: this._images,
            theme: context.theme,
            fontFamily: this._hostFont,
            requestRepaint: () => this._repaint(),
            clip: context.clip || null,
            innerWidth: width - margins.left - margins.right,
            innerHeight: height - margins.top - margins.bottom,
        });
    }
}
