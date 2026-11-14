// @ts-check
// Paints FeatureNodes with canvas 2D calls: same node types, layers and style
// defaults as the D3 renderer. No interaction here.
import { markCenter } from '../../edit/shared.js';
import { STYLE_FIELDS, lineGenerator, partitionScene } from '../shared.js';

// The theme's font tokens for the current paint pass, set by paintScene and read by text().
/** @type {{ family: string | null, size: number } | null} */
let activeFont = null;

// SVG text-anchor -> canvas textAlign. `middle` is the only rename.
/** @type {Record<string, CanvasTextAlign>} */
const ALIGN = { start: 'start', middle: 'center', end: 'end', left: 'left', right: 'right', center: 'center' };
// SVG dominant-baseline -> canvas textBaseline. Unset falls back to alphabetic.
/** @type {Record<string, CanvasTextBaseline>} */
const BASELINE = {
    middle: 'middle', central: 'middle', hanging: 'hanging',
    'text-before-edge': 'top', 'text-after-edge': 'bottom',
    alphabetic: 'alphabetic', ideographic: 'ideographic'
};

/**
 * Resolve a node's style: `node.effectStyle` wins, then the node's own value, then
 * the caller's default, then the shared base. `filter` and `cursor` have no canvas
 * equivalent and are skipped.
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
 * Fill then stroke a path. Opacities are approximated with globalAlpha.
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
        ctx.lineCap = s.strokeLinecap || 'butt';
        setDash(ctx, s.strokeDasharray);
        path ? ctx.stroke(path) : ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.setLineDash([]);
}

/**
 * Run `draw` rotated by the node's `angle` (math degrees, CCW) about markCenter,
 * the same pivot the SVG renderer uses.
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

/**
 * A node's gradient fill as a canvas gradient over its box.
 * @param {CanvasRenderingContext2D} ctx @param {any} node
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @returns {CanvasGradient | null}
 */
function gradientOf(ctx, node, box) {
    const spec = node.fillGradient;
    if (!spec || !spec.stops) return null;
    const horizontal = spec.direction === 'horizontal';
    const g = horizontal
        ? ctx.createLinearGradient(box.x, box.y, box.x + box.width, box.y)
        : ctx.createLinearGradient(box.x, box.y + box.height, box.x, box.y);
    for (const [offset, color] of spec.stops) g.addColorStop(Math.max(0, Math.min(1, offset)), color);
    return g;
}

/** The bounding box of a path node's outline points. @param {any} node */
function pointsBox(node) {
    const pts = (node.points || []).filter((/** @type {any} */ p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** @param {CanvasRenderingContext2D} ctx @param {any} node @param {Record<string,any>} defaults */
function rect(ctx, node, defaults) {
    withAngle(ctx, node, () => {
        const h = Math.max(0, node.height);
        ctx.beginPath();
        // Rounded corners where `roundRect` exists; square otherwise.
        if (node.rx != null && typeof (/** @type {any} */ (ctx).roundRect) === 'function') {
            const rx = Math.max(0, node.rx);
            const ry = node.ry != null ? Math.max(0, node.ry) : rx;
            /** @type {any} */ (ctx).roundRect(node.x, node.y, node.width, h, [rx, ry]);
        } else {
            ctx.rect(node.x, node.y, node.width, h);
        }
        const s = styleOf(node, defaults);
        const g = gradientOf(ctx, node, { x: node.x, y: node.y, width: node.width, height: h });
        if (g && !(node.effectStyle && node.effectStyle.fill != null)) s.fill = g;
        paint(ctx, s);
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
        // The d3 line generator draws into a Path2D, so curves match the SVG renderer.
        p = new Path2D();
        lineGenerator(node.curve).context(/** @type {any} */(p))(node.points || []);
    }
    const s = styleOf(node, defaults);
    const box = node.fillGradient ? pointsBox(node) : null;
    const g = box ? gradientOf(ctx, node, box) : null;
    if (g && !(node.effectStyle && node.effectStyle.fill != null)) s.fill = g;
    paint(ctx, s, p);
}

/**
 * @param {CanvasRenderingContext2D} ctx @param {any} node
 * @param {Record<string,any>} defaults @param {string} anchorDefault
 */
function text(ctx, node, defaults, anchorDefault) {
    if (node.text == null) return;
    withAngle(ctx, node, () => {
        const s = styleOf(node, defaults);
        const family = node.fontFamily || (activeFont && activeFont.family) || 'sans-serif';
        const size = node.fontSize != null ? node.fontSize : ((activeFont && activeFont.size) || 10);
        ctx.font = `${node.fontStyle ? node.fontStyle + ' ' : ''}${node.fontWeight != null ? node.fontWeight + ' ' : ''}${size}px ${family}`;
        ctx.textAlign = ALIGN[node.textAnchor || anchorDefault] || 'start';
        ctx.textBaseline = BASELINE[node.dominantBaseline] || 'alphabetic';

        // A wrapped label paints its `lines`; otherwise one line of `text`.
        const lines = Array.isArray(node.lines) ? node.lines : [String(node.text)];
        const step = node.lineHeight != null ? node.lineHeight : Math.round(size * 1.35);
        // `lineAnchor` places the block about y: top hangs, bottom stacks, else centred.
        const first = node.lineAnchor === 'top' ? node.y
            : node.lineAnchor === 'bottom' ? node.y - (lines.length - 1) * step
                : node.y - ((lines.length - 1) * step) / 2;

        const op = s.opacity != null ? s.opacity : 1;
        // Stroke first: a stroke on text is a halo behind the glyphs.
        if (s.stroke && s.stroke !== 'none') {
            ctx.globalAlpha = op * (s.strokeOpacity != null ? s.strokeOpacity : 1);
            ctx.strokeStyle = s.stroke;
            ctx.lineWidth = s.strokeWidth != null ? s.strokeWidth : 1;
            lines.forEach((/** @type {any} */ l, /** @type {number} */ i) =>
                ctx.strokeText(String(l), node.x, first + i * step));
        }
        if (s.fill && s.fill !== 'none') {
            ctx.globalAlpha = op * (s.fillOpacity != null ? s.fillOpacity : 1);
            ctx.fillStyle = s.fill;
            lines.forEach((/** @type {any} */ l, /** @type {number} */ i) =>
                ctx.fillText(String(l), node.x, first + i * step));
        }
        ctx.globalAlpha = 1;
    });
}

/**
 * Draw a background raster tile. A cache miss starts a load and repaints when it
 * arrives; until then the tile is skipped.
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
 * Paint one ordinary mark node (non-background, non-guide).
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
            // Editable text marks default to a middle anchor, others to start.
            text(ctx, n, { fill: 'black', opacity: 1 }, n.editable ? 'middle' : 'start');
            break;
        case 'image':
            // Only background images are painted.
            break;
        default:
            break;
    }
}

/**
 * Paint a guide-front node (rules, ticks, labels).
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
        case 'rect':
            rect(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
            break;
        default:
            break;
    }
}

/**
 * Paint an interaction-effect overlay (proximity ring / state outline). Handles
 * every shape `outlineNodes` can emit.
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
 * Paint the whole scene in z-order: background, guide regions, marks, guide front,
 * effects. Within the mark layer, `scene.children` order is z-order.
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} children scene nodes
 * @param {{ images: Map<string, any>, requestRepaint: () => void, theme?: any, clip?: { x: number, y: number, width: number, height: number } | null, innerWidth?: number, innerHeight?: number }} io
 */
export function paintScene(ctx, children, io) {
    activeFont = (io && io.theme && io.theme.font) || null;
    const { background, guideRegions, marks, chrome, guideFront, effects, effectsChrome } =
        partitionScene(children, { clip: !!(io && io.clip) });
    // The clip rect confines marks and effects.
    const clip = io && io.clip;
    const clipped = (/** @type {() => void} */ paint) => {
        if (!clip) { paint(); return; }
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.width, clip.height);
        ctx.clip();
        paint();
        ctx.restore();
    };

    // Background: tiles (floor), then everything else in scene order, as SVG does.
    background.filter((n) => n.type === 'image')
        .forEach((n) => image(ctx, n, io.images, io.requestRepaint));
    for (const n of background) {
        if (n.type === 'image') continue;
        if (n.type === 'rect') rect(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'circle') circle(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'line') line(ctx, n, { stroke: '#6b7280', strokeWidth: 1, opacity: 1 });
        else if (n.type === 'text') text(ctx, n, { fill: '#374151', opacity: 1 }, 'middle');
        else if (n.type === 'path') path(ctx, n, { fill: 'none', stroke: 'black', strokeWidth: 1, opacity: 1 });
    }

    guideRegions.forEach((n) => rect(ctx, n, { fill: 'none', stroke: 'none', strokeWidth: 1, opacity: 1 }));

    // Marks (clipped), then unclipped chrome.
    clipped(() => marks.forEach((n) => paintMark(ctx, n)));
    chrome.forEach((n) => paintMark(ctx, n));

    // Rules, constraint ticks, guide labels — in scene order.
    guideFront.forEach((n) => paintGuideFront(ctx, n));

    // Interaction overlays on top, clipped with their marks.
    clipped(() => effects.forEach((n) => paintEffect(ctx, n)));
    effectsChrome.forEach((n) => paintEffect(ctx, n));
}
