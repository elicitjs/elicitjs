// @ts-check
// rough: the chart's shapes redrawn by hand. Lines wobble and are drawn twice,
// corners overshoot, and a mark's fill is hatched.
//
// A redrawn shape keeps its own node, made invisible, as what the pointer hits,
// so picking, cursors and edits read the true geometry. Its strokes and fill are
// drawn beside it as inert paths. Text and images are left as they are.
import { LOOK_OPTIONS } from '../vocabulary.js';
import { makeLook, warnUnknownLookOptions, numberOption, inScope } from '../core/looks.js';
import { warn } from '../core/dev.js';
import { lineGenerator } from '../core/curves.js';
import { markCenter } from '../edit/shared.js';
import { parsePath, flatten } from '../plot/shapes.js';

/** @typedef {[number, number]} Point */
/** @typedef {{ points: Point[], closed: boolean, smooth?: boolean }} Outline */

// The paint each layer gives a node that sets none, as the renderers do.
/** @type {Record<string, Record<string, { fill?: string, stroke?: string }>>} */
const LAYER_PAINT = {
    marks: { path: { stroke: 'black' }, rect: { fill: 'black' }, circle: { fill: 'black' }, ellipse: { fill: 'black' }, line: { stroke: 'black' } },
    background: { line: { stroke: '#6b7280' }, path: { stroke: 'black' } },
    guide: { line: { stroke: 'black' }, path: { stroke: 'black' } },
    effect: {},
};

// Hatching: line spacing and weight in px, and the angle the lines run at.
const HATCH_GAP = 4.5;
const HATCH_WEIGHT = 1.1;
const HATCH_ANGLE = (-41 * Math.PI) / 180;
// A polygon with more edges than this is filled solid: hatching it costs too much.
const HATCH_EDGE_LIMIT = 4000;
// A vertex between two segments shorter than this, turning less than SOFT_TURN,
// is a sample of a curve and not a corner.
const SOFT_LENGTH = 14;
const SOFT_TURN = (30 * Math.PI) / 180;

const CACHE_LIMIT = 4000;
/** @type {Map<string, { stroke: string, fill: string | null, hatch: string | null, points: Point[] }>} */
const cache = new Map();

/** @param {string} text @returns {number} a 32-bit hash (FNV-1a) */
function hashOf(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** @param {number} seed @returns {() => number} numbers in 0..1 (mulberry32) */
function randomOf(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** @param {number} n */
const fmt = (n) => (Math.round(n * 10) / 10).toString();

/**
 * Turn points about a pivot by a node's `angle`, as the renderers rotate it.
 * @param {Point[]} points @param {any} node
 * @returns {Point[]}
 */
function turned(points, node) {
    if (!node.angle) return points;
    const c = markCenter(node);
    if (!c) return points;
    const a = (-node.angle * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return points.map(([x, y]) => {
        const dx = x - c.cx, dy = y - c.cy;
        return [c.cx + dx * cos - dy * sin, c.cy + dx * sin + dy * cos];
    });
}

/**
 * Points round an ellipse.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry
 * @returns {Point[]}
 */
function ellipsePoints(cx, cy, rx, ry) {
    const n = Math.max(10, Math.min(48, Math.round((Math.PI * (rx + ry)) / 9)));
    /** @type {Point[]} */
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = (i / n) * 2 * Math.PI;
        out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return out;
}

/**
 * A node's shape as polylines, or null for one that is not redrawn.
 * @param {any} node
 * @returns {Outline[] | null}
 */
function outlinesOf(node) {
    if (node.type === 'line') {
        return [{ points: turned([[node.x1, node.y1], [node.x2, node.y2]], node), closed: false }];
    }
    if (node.type === 'rect') {
        const { x, y, width: w } = node;
        const h = Math.max(0, node.height);
        if (!(w > 0) || !(h > 0)) return null;
        const rx = Math.min(Math.max(0, node.rx != null ? node.rx : (node.ry || 0)), w / 2);
        const ry = Math.min(Math.max(0, node.ry != null ? node.ry : (node.rx || 0)), h / 2);
        /** @type {Point[]} */
        let points;
        if (rx > 1 && ry > 1) {
            // Each rounded corner as a few points on its ellipse.
            points = [];
            /** @type {[number, number, number][]} */
            const corners = [[x + w - rx, y + ry, -0.5], [x + w - rx, y + h - ry, 0], [x + rx, y + h - ry, 0.5], [x + rx, y + ry, 1]];
            for (const [cx, cy, start] of corners) {
                for (let k = 0; k <= 4; k++) {
                    const t = (start + k / 8) * Math.PI;
                    points.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
                }
            }
        } else {
            points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        }
        return [{ points: turned(points, node), closed: true }];
    }
    if (node.type === 'circle') {
        const r = Math.max(0, node.r != null ? node.r : 5);
        if (!(r > 0)) return null;
        return [{ points: ellipsePoints(node.cx, node.cy, r, r), closed: true, smooth: true }];
    }
    if (node.type === 'ellipse') {
        const rx = Math.max(0, node.rx != null ? node.rx : 5);
        const ry = Math.max(0, node.ry != null ? node.ry : 5);
        if (!(rx > 0) || !(ry > 0)) return null;
        return [{ points: turned(ellipsePoints(node.cx, node.cy, rx, ry), node), closed: true, smooth: true }];
    }
    if (node.type === 'path') {
        const d = node.d || lineGenerator(node.curve)(node.points || []);
        const segments = d ? parsePath(d) : null;
        if (!segments) return null;
        // `flatten` drops the Z, so read which subpaths were closed from the segments.
        /** @type {boolean[]} */
        const closed = [];
        let open = false;
        for (const s of segments) {
            if (s.cmd === 'M') { if (open) closed.push(false); open = true; }
            else if (s.cmd === 'Z' && open) { closed.push(true); open = false; }
        }
        if (open) closed.push(false);
        return flatten(segments)
            .map((points, i) => ({ points, closed: !!closed[i] }))
            .filter((o) => o.points.length > 1);
    }
    return null;
}

/**
 * One hand-drawn stroke from `a` to `b`: a cubic that bows a little and misses
 * both ends a little.
 * @param {string[]} out path commands, appended to
 * @param {Point} a @param {Point} b
 * @param {number} roughness @param {() => number} random
 * @param {boolean} second the fainter second pass, which strays less
 */
function strokeLine(out, a, b, roughness, random, second) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return;
    // Long lines stray less per px; short ones never by more than a tenth of their length.
    const gain = length < 200 ? 1 : length > 500 ? 0.4 : 1.2333 - 0.0016668 * length;
    const stray = Math.min(roughness * 2 * gain, length / 10) * (second ? 0.5 : 1);
    const jitter = () => (random() * 2 - 1) * stray;
    const bow = (random() * 2 - 1) * roughness * (length / 100) * gain;
    const nx = -dy / length, ny = dx / length;
    const at = 0.2 + random() * 0.2;
    out.push(
        `M${fmt(a[0] + jitter())},${fmt(a[1] + jitter())}` +
        `C${fmt(a[0] + dx * at + nx * bow + jitter())},${fmt(a[1] + dy * at + ny * bow + jitter())}` +
        ` ${fmt(a[0] + dx * 2 * at + nx * bow + jitter())},${fmt(a[1] + dy * 2 * at + ny * bow + jitter())}` +
        ` ${fmt(b[0] + jitter())},${fmt(b[1] + jitter())}`,
    );
}

/**
 * A smooth curve through points, as cubics (Catmull-Rom).
 * @param {string[]} out @param {Point[]} pts @param {boolean} closed
 */
function strokeCurve(out, pts, closed) {
    const n = pts.length;
    if (n < 2) return;
    /** @param {number} i */
    const at = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
    let d = `M${fmt(pts[0][0])},${fmt(pts[0][1])}`;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
        const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
        d += `C${fmt(p1[0] + (p2[0] - p0[0]) / 6)},${fmt(p1[1] + (p2[1] - p0[1]) / 6)}` +
            ` ${fmt(p2[0] - (p3[0] - p1[0]) / 6)},${fmt(p2[1] - (p3[1] - p1[1]) / 6)}` +
            ` ${fmt(p2[0])},${fmt(p2[1])}`;
    }
    out.push(d);
}

/**
 * Points along a polyline, about `step` px apart, ends included.
 * @param {Point[]} pts @param {number} step
 * @returns {Point[]}
 */
function resample(pts, step) {
    /** @type {Point[]} */
    const out = [pts[0]];
    let carried = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let t = step - carried;
        while (t < length) {
            out.push([a[0] + ((b[0] - a[0]) * t) / length, a[1] + ((b[1] - a[1]) * t) / length]);
            t += step;
        }
        carried = length - (t - step);
    }
    const end = pts[pts.length - 1];
    const tail = out[out.length - 1];
    // Drop a sample that lands on the end, then finish there exactly.
    if (out.length > 1 && Math.hypot(end[0] - tail[0], end[1] - tail[1]) < step / 3) out.pop();
    out.push(end);
    return out;
}

/**
 * A hand-drawn curve along a run of curve samples.
 * @param {string[]} out @param {Point[]} run @param {boolean} closed
 * @param {number} roughness @param {() => number} random @param {boolean} second
 */
function strokeRun(out, run, closed, roughness, random, second) {
    let length = 0;
    for (let i = 1; i < run.length; i++) length += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    const pts = closed ? run : resample(run, Math.max(8, Math.min(20, length / 3)));
    const stray = roughness * (second ? 0.6 : 1.1);
    /** @type {Point[]} */
    const moved = pts.map(([x, y]) => [x + (random() * 2 - 1) * stray, y + (random() * 2 - 1) * stray]);
    strokeCurve(out, moved, closed);
}

/**
 * One pass of the pen along an outline: lines between corners, curves through
 * runs of curve samples.
 * @param {string[]} out @param {Outline} outline
 * @param {number} roughness @param {() => number} random @param {boolean} second
 */
function strokeOutline(out, outline, roughness, random, second) {
    if (outline.smooth) { strokeRun(out, outline.points, true, roughness, random, second); return; }
    const pts = outline.closed ? [...outline.points, outline.points[0]] : outline.points;
    const n = pts.length;
    // A soft vertex is a curve sample: short segments either side, a small turn.
    /** @type {boolean[]} */
    const soft = pts.map((p, i) => {
        if (i === 0 || i === n - 1) return false;
        const ax = p[0] - pts[i - 1][0], ay = p[1] - pts[i - 1][1];
        const bx = pts[i + 1][0] - p[0], by = pts[i + 1][1] - p[1];
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (!(la > 0) || !(lb > 0) || la > SOFT_LENGTH || lb > SOFT_LENGTH) return false;
        return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) < SOFT_TURN;
    });
    for (let start = 0; start < n - 1;) {
        let end = start + 1;
        while (end < n - 1 && soft[end]) end++;
        if (end === start + 1) strokeLine(out, pts[start], pts[end], roughness, random, second);
        else strokeRun(out, pts.slice(start, end + 1), false, roughness, random, second);
        start = end;
    }
}

/**
 * Hatch lines across polygons (even-odd), each drawn as one hand-drawn stroke.
 * A line keeps its own randomness by where it sits, so the hatching holds
 * still while the shape grows.
 * @param {string[]} out @param {Point[][]} polygons
 * @param {number} roughness @param {number} seed
 */
function hatch(out, polygons, roughness, seed) {
    const cos = Math.cos(HATCH_ANGLE), sin = Math.sin(HATCH_ANGLE);
    // Work where the hatch lines are horizontal.
    const turnedPolys = polygons.map((poly) => poly.map(([x, y]) => /** @type {Point} */ ([x * cos + y * sin, -x * sin + y * cos])));
    let lo = Infinity, hi = -Infinity;
    for (const poly of turnedPolys) for (const p of poly) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    if (!Number.isFinite(lo)) return;
    for (let k = Math.ceil(lo / HATCH_GAP); k * HATCH_GAP <= hi; k++) {
        const y = k * HATCH_GAP + 0.01;
        /** @type {number[]} */
        const xs = [];
        for (const poly of turnedPolys) {
            for (let i = 0; i < poly.length; i++) {
                const p = poly[i], q = poly[(i + 1) % poly.length];
                if ((p[1] <= y) === (q[1] <= y)) continue;
                xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
            }
        }
        xs.sort((a, b) => a - b);
        const random = randomOf(seed ^ Math.imul(k, 2654435761));
        for (let i = 0; i + 1 < xs.length; i += 2) {
            // Back to chart space.
            /** @type {Point} */
            const a = [xs[i] * cos - y * sin, xs[i] * sin + y * cos];
            /** @type {Point} */
            const b = [xs[i + 1] * cos - y * sin, xs[i + 1] * sin + y * cos];
            strokeLine(out, a, b, roughness * 0.5, random, false);
        }
    }
}

/**
 * The hand-drawn geometry for one node: its strokes, a solid fill outline, and
 * hatching. Cached by geometry, so only a shape that moved is redrawn.
 * @param {any} node @param {Outline[]} outlines
 * @param {{ roughness: number, hachure: boolean }} how @param {number} seed
 */
function drawn(node, outlines, how, seed) {
    const shape = node.type === 'path'
        ? (node.d || `${node.curve || ''}|${(node.points || []).join(';')}`)
        : [node.x, node.y, node.width, node.height, node.rx, node.ry, node.cx, node.cy, node.r, node.x1, node.y1, node.x2, node.y2, node.angle].join(',');
    const key = `${node.type}|${shape}|${how.roughness}|${how.hachure}|${seed}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const random = randomOf(seed);
    /** @type {string[]} */
    const stroke = [];
    for (const o of outlines) strokeOutline(stroke, o, how.roughness, random, false);
    for (const o of outlines) strokeOutline(stroke, o, how.roughness, random, true);

    const polygons = outlines.filter((o) => o.points.length > 2).map((o) => o.points);
    const edges = polygons.reduce((sum, p) => sum + p.length, 0);
    /** @type {string | null} */
    let fill = null;
    /** @type {string | null} */
    let hatched = null;
    if (polygons.length) {
        if (how.hachure && edges <= HATCH_EDGE_LIMIT) {
            /** @type {string[]} */
            const lines = [];
            hatch(lines, polygons, how.roughness, seed);
            hatched = lines.join('');
        } else {
            // A solid fill whose edge strays a little from the true one.
            const stray = how.roughness * 0.6;
            fill = polygons.map((poly) => 'M' + poly.map(([x, y]) =>
                `${fmt(x + (random() * 2 - 1) * stray)},${fmt(y + (random() * 2 - 1) * stray)}`).join('L') + 'Z').join('');
        }
    }
    const made = { stroke: stroke.join(''), fill, hatch: hatched, points: polygons.flat() };
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, made);
    return made;
}

/** @param {any} paint @returns {boolean} does this paint draw anything? */
const visible = (paint) => paint != null && paint !== 'none' && paint !== 'transparent';

/**
 * Redraw one node by hand. Returns the nodes to draw in its place.
 * @param {any} node
 * @param {{ roughness: number, hachure: boolean, seed: number, scope: 'marks' | 'frame' }} how
 * @param {Map<string, number>} seen how many nodes each stable key has named, this frame
 * @returns {any[]}
 */
function redraw(node, how, seen) {
    if (!node || node.rough || node.hit || node.type === 'text' || node.type === 'image') return [node];
    if (!inScope(node, how.scope)) return [node];
    // A guide's band sits behind the marks only as a rect; leave it one.
    if (node.guide && !node.effect && node.type === 'rect' && !node.front) return [node];

    const layer = node.effect ? 'effect' : node.background ? 'background' : node.guide ? 'guide' : 'marks';
    const base = (LAYER_PAINT[layer] || {})[node.type] || {};
    const eff = node.effectStyle || {};
    const fill = eff.fill != null ? eff.fill : (node.fill != null ? node.fill : (base.fill || 'none'));
    const stroke = eff.stroke != null ? eff.stroke : (node.stroke != null ? node.stroke : (base.stroke || 'none'));
    const strokeWidth = eff.strokeWidth != null ? eff.strokeWidth : (node.strokeWidth != null ? node.strokeWidth : 1);
    const opacity = eff.opacity != null ? eff.opacity : (node.opacity != null ? node.opacity : 1);
    const filled = node.type !== 'line' && (visible(fill) || !!node.fillGradient);
    const stroked = visible(stroke) && strokeWidth !== 0;
    if ((!filled && !stroked) || opacity === 0) return [node];

    const outlines = outlinesOf(node);
    if (!outlines || !outlines.length) return [node];

    // The same node gets the same hand every frame: named by its mark and row,
    // else by where it is.
    const name = node.featureId != null
        ? `${node.featureId}|${node.index != null ? node.index : ''}|${node.channel || ''}`
        : `${node.type}|${Math.round(outlines[0].points[0][0])}|${Math.round(outlines[0].points[0][1])}`;
    const nth = seen.get(name) || 0;
    seen.set(name, nth + 1);
    const seed = hashOf(`${how.seed}|${name}|${nth}`);

    // Only what draws data is hatched: a hatched panel or tip box would bury its text.
    const hachure = how.hachure && layer === 'marks' && !node.fillGradient;
    const made = drawn(node, outlines, { roughness: how.roughness, hachure }, seed);

    // What every redrawn part shares: its layer, and no part in picking.
    const part = {
        type: 'path', rough: true, pointerEvents: 'none',
        ...(node.background ? { background: true } : {}),
        ...(node.guide ? { guide: true } : {}),
        ...(node.front ? { front: true } : {}),
        ...(node.effect ? { effect: true } : {}),
        ...(node.unclipped ? { unclipped: true } : {}),
        ...(node.ghost ? { ghost: true } : {}),
        ...(eff.filter != null ? { effectStyle: { filter: eff.filter } } : {}),
    };
    const fillOpacity = node.fillOpacity != null ? node.fillOpacity : 1;
    /** @type {any[]} */
    const parts = [];
    if (filled && made.hatch) {
        parts.push({ ...part, d: made.hatch, fill: 'none', stroke: fill, strokeWidth: HATCH_WEIGHT, strokeLinecap: 'round', opacity: opacity * fillOpacity });
    } else if (filled && made.fill) {
        parts.push({
            ...part, d: made.fill, fill: visible(fill) ? fill : 'none', stroke: 'none', opacity, fillOpacity,
            ...(node.fillGradient && eff.fill == null ? { fillGradient: node.fillGradient, points: made.points } : {}),
        });
    }
    if (stroked) {
        parts.push({
            ...part, d: made.stroke, fill: 'none', stroke, strokeWidth, opacity,
            ...(node.strokeOpacity != null ? { strokeOpacity: node.strokeOpacity } : {}),
            ...(node.strokeDasharray != null ? { strokeDasharray: node.strokeDasharray } : {}),
            strokeLinecap: node.strokeLinecap || 'round',
        });
    } else if (filled && visible(fill)) {
        // A fill with no stroke still gets a drawn edge, in its own colour.
        parts.push({ ...part, d: made.stroke, fill: 'none', stroke: fill, strokeWidth: 1.2, strokeLinecap: 'round', opacity: opacity * fillOpacity });
    }

    // An inert node has nothing to hit, so its parts stand in for it.
    if (node.pointerEvents === 'none') return parts;
    // Otherwise it stays, unseen, as what the pointer hits. An effect's cursor
    // stays with it; the rest of the effect is on the parts.
    const target = {
        ...node,
        ...(filled ? { fill: 'transparent' } : {}),
        ...(stroked ? { stroke: 'transparent' } : {}),
        effectStyle: eff.cursor != null ? { cursor: eff.cursor } : null,
    };
    delete target.fillGradient;
    return [target, ...parts];
}

/**
 * A hand-drawn look in geometry: every shape is redrawn with a wobbling pen, and
 * a mark's fill is hatched. Works in any renderer.
 * @param {import('../types').RoughLookOptions} [options]
 * @returns {import('../types').Look}
 */
export function rough(options = {}) {
    warnUnknownLookOptions('rough', options, LOOK_OPTIONS.rough);
    const fill = options.fill != null ? options.fill : 'hachure';
    if (fill !== 'hachure' && fill !== 'solid') {
        warn(`lookopt:rough:fill:${fill}`, `looks.rough({ fill: ${JSON.stringify(fill)} }): fill is "hachure" or "solid"; using "hachure".`);
    }
    const look = makeLook('rough', 'geometry', options, {});
    const how = {
        roughness: numberOption('rough', 'roughness', options.roughness, 1, 0, 3),
        hachure: fill !== 'solid',
        seed: numberOption('rough', 'seed', options.seed, 1, -1e6, 1e6),
        scope: look.scope,
    };
    look.transform = (nodes) => {
        /** @type {Map<string, number>} */
        const seen = new Map();
        return nodes.flatMap((node) => redraw(node, how, seen));
    };
    return look;
}
