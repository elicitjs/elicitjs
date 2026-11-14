// @ts-check
// CanvasRenderer: the renderer contract (`render(context)`, events via
// `context.onEvent`) drawn on a canvas. Each render is a full clear-and-repaint.
// Not yet supported: keyboard `nudge`, focusOutline, the inline text editor, and
// the grab/proximity effect visuals.
import { paintScene } from './draw.js';
import { bindCanvasEvents } from './events.js';

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

        // Back the canvas at device pixels for crisp output, present it at CSS px.
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const bw = Math.round(width * dpr);
        const bh = Math.round(height * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        if (responsive === 'scale') {
            // Stretch to the parent; events.js toInner maps the pointer back.
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
        } else {
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        this._repaint();
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
        bindCanvasEvents(canvas, () => this._ctx);
    }

    /**
     * Paint the last render context; also called when a raster tile loads.
     */
    _repaint() {
        const context = this._ctx;
        const ctx = this._2d;
        if (!context || !ctx) return;
        const { scene, width, height, margins } = context;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // Inner scene space: DPR scale, then the margins.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.translate(margins.left, margins.top);
        paintScene(ctx, scene.children, {
            images: this._images,
            theme: context.theme,
            requestRepaint: () => this._repaint(),
            clip: context.clip || null,
            innerWidth: width - margins.left - margins.right,
            innerHeight: height - margins.top - margins.bottom,
        });
    }
}
