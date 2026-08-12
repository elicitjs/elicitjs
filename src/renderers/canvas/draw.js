// @ts-check
// Painting: typed FeatureNodes -> canvas 2D calls. The mirror image of the D3
// renderer's semantic draws — same node types, same role layers + array z-order,
// same per-draw style defaults — but emitting `ctx.fill()`/`ctx.stroke()` instead
// of SVG attributes. No interaction here; this module is a pure function of
// (context, nodes).
import * as d3 from 'd3';
import { markCenter } from '../../edit/shared.js';
import { STYLE_FIELDS, resolveCurve, partitionScene } from '../shared.js';

// The active theme's font tokens for this paint pass. Set once at the top of
// paintScene (synchronous, single-threaded — so a module-level slot is safe) and
// read by text(), which fires from several draw paths. Null family => 'sans-serif',
// matching the pre-theme canvas default.
/** @type {{ family: string | null, size: number } | null} */
let activeFont = null;

// SVG text-anchor -> canvas textAlign. `middle` is the only rename.
/** @type {Record<string, CanvasTextAlign>} */
const ALIGN = { start: 'start', middle: 'center', end: 'end', left: 'left', right: 'right', center: 'center' };
// SVG dominant-baseline -> canvas textBaseline. Unset falls back to alphabetic
// (SVG's default), matching how axis tick labels render.
/** @type {Record<string, CanvasTextBaseline>} */
const BASELINE = {
    middle: 'middle', central: 'middle', hanging: 'hanging',
    'text-before-edge': 'top', 'text-after-edge': 'bottom',
    alphabetic: 'alphabetic', ideographic: 'ideographic'
};

/**
 * Resolve a node's style channels against per-draw defaults, exactly like the D3
 * renderer's `_applyStyle`: per-node value wins, else the caller's default, else the
 * shared base (null).
 *
 * An interaction effect the engine's state pass stamped on the node
 * (`node.effectStyle` — see core/effects.js) wins over all of it, which is this
 * renderer's equivalent of a CSS style property beating an SVG presentation
 * attribute. It cannot leak: a canvas is repainted from scene state every frame, so
 * an effect that ended simply isn't there next pass. `filter` and `cursor` are the
 * two properties with no canvas equivalent here (there is no element to hover and no
 * per-shape filter), so they are skipped rather than faked — everything the effects
 * vocabulary can PAINT works in both renderers.
 * @param {any} node
 * @param {Record<string, any>} defaults
 * @returns {Record<string, any>}
 */
function styleOf(node, defaults) {
    /** @type {Record<string, any>} */
    const s = {};
    const eff = node.effectStyle;
    for (const { field, base } of STYLE_FIELDS) {
        const def = field in defaults ? defaults[field] : base;
        s[field] = eff && eff[field] != null
            ? eff[field]
            : (node[field] != null ? node[field] : def);
    }
    return s;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} dash strokeDasharray as a string ("4 4" / "4,4"), array, or null
 */
function setDash(ctx, dash) {
    if (dash == null || dash === 'none') { ctx.setLineDash([]); return; }
    if (Array.isArray(dash)) { ctx.setLineDash(dash); return; }
    ctx.setLineDash(String(dash).split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n)));
}

/**
 * Fill then stroke a path (SVG paints fill under stroke). `opacity` composites both;
 * `fillOpacity`/`strokeOpacity` scale each pass — approximated with globalAlpha,
 * which is close enough to the SVG semantics for every mark in this library.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Record<string, any>} s resolved style
 * @param {Path2D} [path] optional Path2D (else the ctx's current path)
 */
function paint(ctx, s, path) {
    const op = s.opacity != null ? s.opacity : 1;
    if (s.fill && s.fill !== 'none') {
        ctx.globalAlpha = op * (s.fillOpacity != null ? s.fillOpacity : 1);
        ctx.fillStyle = s.fill;
        path ? ctx.fill(path) : ctx.fill();
    }
    if (s.stroke && s.stroke !== 'none') {
        ctx.globalAlpha = op * (s.strokeOpacity != null ? s.strokeOpacity : 1);
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth = s.strokeWidth != null ? s.strokeWidth : 1;
        setDash(ctx, s.strokeDasharray);
        path ? ctx.stroke(path) : ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
}

/**
 * Run `draw` with the node's `angle` (math degrees, 0°=+x CCW) applied about its
 * centre. SVG uses rotate(-deg); the canvas equivalent is a negative rotation about
 * the same pivot (markCenter), so both renderers agree on where a rotated mark lands.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} node
 * @param {() => void} draw
 */
function withAngle(ctx, node, draw) {
    if (node.angle != null && node.angle !== 0) {
        const c = markCenter(node);
        if (c) {
            ctx.save();
            ctx.translate(c.cx, c.cy);
            ctx.rotate((-node.angle * Math.PI) / 180);
            ctx.translate(-c.cx, -c.cy);
            draw();
            ctx.restore();
            return;
        }
    }
    draw();
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function circle(ctx, node, defaults) {
    withAngle(ctx, node, () => {
        const r = Math.max(0, node.r != null ? node.r : 5);
        ctx.beginPath();
        ctx.arc(node.cx, node.cy, r, 0, 2 * Math.PI);
        paint(ctx, styleOf(node, defaults));
    });
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function ellipse(ctx, node, defaults) {
    withAngle(ctx, node, () => {
        const rx = Math.max(0, node.rx != null ? node.rx : 5);
        const ry = Math.max(0, node.ry != null ? node.ry : 5);
        ctx.beginPath();
        ctx.ellipse(node.cx, node.cy, rx, ry, 0, 0, 2 * Math.PI);
        paint(ctx, styleOf(node, defaults));
    });
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function rect(ctx, node, defaults) {
    withAngle(ctx, node, () => {
        const h = Math.max(0, node.height);
        ctx.beginPath();
        // Corner radius, when the node carries one and the platform can draw it.
        // `roundRect` is recent enough (Chrome 99, Safari 16) to be worth guarding;
        // a square corner is a graceful loss where it is missing, and this path is
        // shared with the effect overlay so a rounded shape's outline rounds too.
        if (node.rx != null && typeof (/** @type {any} */ (ctx).roundRect) === 'function') {
            const rx = Math.max(0, node.rx);
            const ry = node.ry != null ? Math.max(0, node.ry) : rx;
            /** @type {any} */ (ctx).roundRect(node.x, node.y, node.width, h, [rx, ry]);
        } else {
            ctx.rect(node.x, node.y, node.width, h);
        }
        paint(ctx, styleOf(node, defaults));
    });
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function line(ctx, node, defaults) {
    withAngle(ctx, node, () => {
        ctx.beginPath();
        ctx.moveTo(node.x1, node.y1);
        ctx.lineTo(node.x2, node.y2);
        paint(ctx, styleOf(node, defaults));
    });
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function path(ctx, node, defaults) {
    let p;
    if (node.d) {
        p = new Path2D(node.d);
    } else {
        // d3 shape generators accept any object with the canvas path methods; Path2D
        // qualifies, so the SAME curve factory that SVG feeds `d3.line()` draws here.
        p = new Path2D();
        d3.line().curve(resolveCurve(node.curve)).context(/** @type {any} */(p))(node.points || []);
    }
    paint(ctx, styleOf(node, defaults), p);
}

/**
 * @param {CanvasRenderingContext2D} ctx @param {any} node
 * @param {Record<string,any>} defaults @param {string} anchorDefault
 */
function text(ctx, node, defaults, anchorDefault) {
    if (node.text == null) return;
    withAngle(ctx, node, () => {
        const s = styleOf(node, defaults);
        const family = (activeFont && activeFont.family) || 'sans-serif';
        const size = node.fontSize != null ? node.fontSize : ((activeFont && activeFont.size) || 10);
        ctx.font = `${size}px ${family}`;
        ctx.textAlign = ALIGN[node.textAnchor || anchorDefault] || 'start';
        ctx.textBaseline = BASELINE[node.dominantBaseline] || 'alphabetic';

        // A WRAPPED label paints its `lines`; `text` stays the whole string, so
        // the single-line case is just a one-element list. The block is centred on
        // the node's own y — the anchor means the same thing at any line count.
        const lines = Array.isArray(node.lines) ? node.lines : [String(node.text)];
        const step = node.lineHeight != null ? node.lineHeight : Math.round(size * 1.35);
        const first = node.y - ((lines.length - 1) * step) / 2;

        const op = s.opacity != null ? s.opacity : 1;
        if (s.fill && s.fill !== 'none') {
            ctx.globalAlpha = op * (s.fillOpacity != null ? s.fillOpacity : 1);
            ctx.fillStyle = s.fill;
            lines.forEach((/** @type {any} */ l, /** @type {number} */ i) =>
                ctx.fillText(String(l), node.x, first + i * step));
        }
        if (s.stroke && s.stroke !== 'none') {
            ctx.globalAlpha = op * (s.strokeOpacity != null ? s.strokeOpacity : 1);
            ctx.strokeStyle = s.stroke;
            ctx.lineWidth = s.strokeWidth != null ? s.strokeWidth : 1;
            lines.forEach((/** @type {any} */ l, /** @type {number} */ i) =>
                ctx.strokeText(String(l), node.x, first + i * step));
        }
        ctx.globalAlpha = 1;
    });
}

/**
 * Draw a background raster tile. Images load asynchronously, so a cache miss kicks
 * off a load and repaints on arrival (via `requestRepaint`); until then the tile is
 * simply absent, exactly as an <image> with an unfetched href would be.
 * @param {CanvasRenderingContext2D} ctx @param {any} node
 * @param {Map<string, any>} cache @param {() => void} requestRepaint
 */
function image(ctx, node, cache, requestRepaint) {
    if (!node.href) return;
    let entry = cache.get(node.href);
    if (!entry) {
        const img = new Image();
        entry = { img, ready: false };
        img.onload = () => { entry.ready = true; requestRepaint(); };
        img.src = node.href;
        cache.set(node.href, entry);
    }
    if (!entry.ready) return;
    withAngle(ctx, node, () => {
        const prev = ctx.globalAlpha;
        if (node.opacity != null) ctx.globalAlpha = node.opacity;
        ctx.drawImage(entry.img, node.x, node.y, node.width, node.height);
        ctx.globalAlpha = prev;
    });
}

/**
 * Paint one ordinary mark node (non-background, non-guide). Defaults mirror the
 * D3 per-type draws.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} n
 */
function paintMark(ctx, n) {
    switch (n.type) {
        case 'path':
            path(ctx, n, { fill: 'none', stroke: 'black', strokeWidth: 1, opacity: 1 });
            break;
        case 'rect':
            rect(ctx, n, { fill: 'black' });
            break;
        case 'circle':
            circle(ctx, n, { fill: 'black' });
            break;
        case 'ellipse':
            ellipse(ctx, n, { fill: 'black' });
            break;
        case 'line':
            line(ctx, n, { stroke: 'black', strokeWidth: 1, opacity: 1 });
            break;
        case 'text':
            // Editable text marks centre-anchor; inert label marks start-anchor —
            // same split the D3 renderer uses between text.mark and guide-label.
            text(ctx, n, { fill: 'black', opacity: 1 }, n.editable ? 'middle' : 'start');
            break;
        case 'image':
            // Non-background images are rare; treat like a mark if they land here.
            break;
        default:
            break;
    }
}

/**
 * Paint a guide-front node (rules, ticks, labels). Defaults match the
 * D3 guide draws; per-node stroke/fill win via styleOf.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} n
 */
function paintGuideFront(ctx, n) {
    switch (n.type) {
        case 'line':
            line(ctx, n, { stroke: 'black', strokeWidth: 1, opacity: 1 });
            break;
        case 'circle':
            circle(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
            break;
        case 'path':
            path(ctx, n, { fill: 'none', stroke: 'black', strokeWidth: 1, opacity: 1 });
            break;
        case 'text':
            text(ctx, n, { fill: 'black', opacity: 1 }, 'start');
            break;
        default:
            break;
    }
}

/**
 * Paint an interaction-effect overlay (proximity ring / state outline).
 *
 * Every shape `outlineNodes` can emit, matching the D3 renderer's effect layer.
 * Circle and rect were the only two, so an ellipse's or a path's outline was built
 * and then dropped — the mark read as unresponsive. Each primitive routes through
 * `withAngle`, so an overlay carrying its source's `angle` turns with the mark.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any} n
 */
function paintEffect(ctx, n) {
    const defaults = { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 };
    switch (n.type) {
        case 'circle':
            circle(ctx, n, defaults);
            break;
        case 'rect':
            rect(ctx, n, defaults);
            break;
        case 'ellipse':
            ellipse(ctx, n, defaults);
            break;
        case 'line':
            line(ctx, n, defaults);
            break;
        case 'path':
            path(ctx, n, defaults);
            break;
        default:
            break;
    }
}

/**
 * Paint the whole scene in z-order. Role layers (background → guide regions →
 * marks → guide front → effects) are fixed; within the mark layer,
 * `scene.children` order is z-order (later features / parts on top). Draw
 * order IS z-order on a canvas (last wins).
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} children scene nodes
 * @param {{ images: Map<string, any>, requestRepaint: () => void, theme?: any }} io
 */
export function paintScene(ctx, children, io) {
    // The theme's font tokens for this pass (read by text()); null family keeps the
    // pre-theme 'sans-serif' default so an un-themed chart is unchanged.
    activeFont = (io && io.theme && io.theme.font) || null;
    const { background, guideRegions, marks, guideFront, effects } = partitionScene(children);

    // Background: tiles (floor), then legend chips/ramps + axis chrome, then
    // vector basemap paths (geoBasemap) so they sit above grids the way they did
    // in the old path pass. Rects/circles are the legend mark's inert swatches —
    // without them a non-interactive legend draws labels with no colour chips.
    background.filter((n) => n.type === 'image')
        .forEach((n) => image(ctx, n, io.images, io.requestRepaint));
    for (const n of background) {
        if (n.type === 'image' || n.type === 'path') continue;
        if (n.type === 'rect') rect(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'circle') circle(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'line') line(ctx, n, { stroke: '#6b7280', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'text') text(ctx, n, { fill: '#374151', opacity: 1 }, 'middle');
    }
    background.filter((n) => n.type === 'path')
        .forEach((n) => path(ctx, n, { fill: 'none', stroke: 'black', strokeWidth: 1, opacity: 1 }));

    guideRegions.forEach((n) => rect(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 }));

    // Ordinary marks in features/parts array order.
    marks.forEach((n) => paintMark(ctx, n));

    // Rules, constraint ticks, guide labels — in scene order.
    guideFront.forEach((n) => paintGuideFront(ctx, n));

    // Interaction overlays (proximity ring, select outline) — above everything.
    effects.forEach((n) => paintEffect(ctx, n));
}
