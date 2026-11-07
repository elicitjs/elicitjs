// @ts-check
// shapes.js — the geometry behind `plot.shape`: a vocabulary of named shapes,
// an SVG path parser, and the one placement that bakes a unit shape into a
// positioned, scaled, rotated path with a hit polygon.
//
// Pure (no DOM), so the mark, the legend's shape chip and the tests share it.
// A shape is kept in UNIT form — centred on the origin, fitting [-1, 1] — and
// placed per row by `placeShape`, so `size` means the same thing it does on a
// `point` (the radius of the box the shape fits) whatever the path's native
// coordinates were.
import * as d3 from 'd3';
import { sampleQuadratic, sampleCubic } from './hitpath.js';

/** The named shapes a `symbol` range may use (d3's symbol set). */
export const DEFAULT_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'wye'];

/** @type {Record<string, any>} */
const D3_SYMBOLS = {
    circle: d3.symbolCircle,
    square: d3.symbolSquare,
    triangle: d3.symbolTriangle,
    diamond: d3.symbolDiamond,
    star: d3.symbolStar,
    cross: d3.symbolCross,
    wye: d3.symbolWye,
};

/**
 * One parsed, absolute path segment. `pts` holds the control points and the end
 * point for L / Q / C (2 numbers each); M holds the start; Z holds none.
 * @typedef {{ cmd: 'M' | 'L' | 'Q' | 'C' | 'Z', pts: number[] }} Segment
 */

/** @type {Map<string, { segments: Segment[] } | null>} */
const unitCache = new Map();

/**
 * Tokenize an SVG path `d` into commands with their numbers.
 * @param {string} d
 * @returns {{ cmd: string, nums: number[] }[] | null}
 */
function tokenize(d) {
    const out = [];
    const re = /([MmLlHhVvZzCcSsQqTtAa])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
    let m;
    /** @type {{ cmd: string, nums: number[] } | null} */
    let cur = null;
    let consumed = 0;
    while ((m = re.exec(d)) !== null) {
        consumed += m[0].length;
        if (m[1]) { cur = { cmd: m[1], nums: [] }; out.push(cur); }
        else if (cur) cur.nums.push(parseFloat(m[2]));
        else return null;
    }
    // Anything that was not a command, a number, whitespace or a comma is noise.
    const rest = d.replace(re, '').replace(/[\s,]/g, '');
    if (rest.length) return null;
    return out.length ? out : null;
}

/**
 * Convert an elliptical arc (endpoint form) to cubic Béziers.
 * @param {number} x1 @param {number} y1 @param {number} rx @param {number} ry
 * @param {number} phiDeg @param {number} fa @param {number} fs @param {number} x2 @param {number} y2
 * @returns {number[][]} cubics as [c1x, c1y, c2x, c2y, x, y]
 */
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    if (x1 === x2 && y1 === y2) return [];
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
    const phi = (phiDeg * Math.PI) / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
    const sign = fa === fs ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = sign * Math.sqrt(Math.max(0, num / den));
    const cxp = coef * ((rx * y1p) / ry), cyp = coef * (-(ry * x1p) / rx);
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    /** @param {number} ux @param {number} uy @param {number} vx @param {number} vy */
    const angle = (ux, uy, vx, vy) => {
        const dot = ux * vx + uy * vy;
        const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!fs && dtheta > 0) dtheta -= 2 * Math.PI;
    if (fs && dtheta < 0) dtheta += 2 * Math.PI;
    const n = Math.max(1, Math.ceil(Math.abs(dtheta) / (Math.PI / 2)));
    const step = dtheta / n;
    const out = [];
    let t = theta1;
    for (let i = 0; i < n; i++) {
        const t2 = t + step;
        const alpha = (4 / 3) * Math.tan((t2 - t) / 4);
        /** @param {number} a */
        const at = (a) => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
        /** @param {number} a */
        const deriv = (a) => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
        const p0 = at(t), p3 = at(t2), d0 = deriv(t), d3v = deriv(t2);
        out.push([p0[0] + alpha * d0[0], p0[1] + alpha * d0[1], p3[0] - alpha * d3v[0], p3[1] - alpha * d3v[1], p3[0], p3[1]]);
        t = t2;
    }
    return out;
}

/**
 * Parse an SVG path into absolute M / L / Q / C / Z segments. Relative commands,
 * H/V, the smooth S/T forms and arcs (converted to cubics) are all accepted.
 * Returns null on anything it cannot read.
 * @param {string} d
 * @returns {Segment[] | null}
 */
export function parsePath(d) {
    const tokens = tokenize(d);
    if (!tokens) return null;
    /** @type {Segment[]} */
    const segs = [];
    let x = 0, y = 0, sx = 0, sy = 0;
    /** @type {number[] | null} */
    let lastC = null;
    /** @type {number[] | null} */
    let lastQ = null; // previous control points, for S / T
    for (const { cmd, nums } of tokens) {
        const rel = cmd === cmd.toLowerCase();
        const C = cmd.toUpperCase();
        /** @param {number} n */
        const take = (n) => {
            if (nums.length % n !== 0 || (!nums.length && C !== 'Z')) return null;
            const groups = [];
            for (let i = 0; i < nums.length; i += n) groups.push(nums.slice(i, i + n));
            return groups;
        };
        if (C === 'Z') { segs.push({ cmd: 'Z', pts: [] }); x = sx; y = sy; lastC = lastQ = null; continue; }
        if (C === 'M' || C === 'L') {
            const g = take(2); if (!g) return null;
            g.forEach(([px, py], k) => {
                const nx = rel ? x + px : px, ny = rel ? y + py : py;
                const isMove = C === 'M' && k === 0;
                segs.push({ cmd: isMove ? 'M' : 'L', pts: [nx, ny] });
                if (isMove) { sx = nx; sy = ny; }
                x = nx; y = ny;
            });
            lastC = lastQ = null; continue;
        }
        if (C === 'H' || C === 'V') {
            const g = take(1); if (!g) return null;
            for (const [v] of g) {
                if (C === 'H') x = rel ? x + v : v; else y = rel ? y + v : v;
                segs.push({ cmd: 'L', pts: [x, y] });
            }
            lastC = lastQ = null; continue;
        }
        if (C === 'C') {
            const g = take(6); if (!g) return null;
            for (const [a, b, c, dd, e, f] of g) {
                const p = rel ? [x + a, y + b, x + c, y + dd, x + e, y + f] : [a, b, c, dd, e, f];
                segs.push({ cmd: 'C', pts: p }); lastC = [p[2], p[3]]; x = p[4]; y = p[5];
            }
            lastQ = null; continue;
        }
        if (C === 'S') {
            const g = take(4); if (!g) return null;
            for (const [c, dd, e, f] of g) {
                /** @type {number[]} */
                const c1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
                /** @type {number[]} */
                const p = [c1[0], c1[1], rel ? x + c : c, rel ? y + dd : dd, rel ? x + e : e, rel ? y + f : f];
                segs.push({ cmd: 'C', pts: p }); lastC = [p[2], p[3]]; x = p[4]; y = p[5];
            }
            lastQ = null; continue;
        }
        if (C === 'Q') {
            const g = take(4); if (!g) return null;
            for (const [a, b, e, f] of g) {
                const p = rel ? [x + a, y + b, x + e, y + f] : [a, b, e, f];
                segs.push({ cmd: 'Q', pts: p }); lastQ = [p[0], p[1]]; x = p[2]; y = p[3];
            }
            lastC = null; continue;
        }
        if (C === 'T') {
            const g = take(2); if (!g) return null;
            for (const [e, f] of g) {
                /** @type {number[]} */
                const c = lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
                /** @type {number[]} */
                const p = [c[0], c[1], rel ? x + e : e, rel ? y + f : f];
                segs.push({ cmd: 'Q', pts: p }); lastQ = [p[0], p[1]]; x = p[2]; y = p[3];
            }
            lastC = null; continue;
        }
        if (C === 'A') {
            const g = take(7); if (!g) return null;
            for (const [rx, ry, rot, fa, fs, e, f] of g) {
                const ex = rel ? x + e : e, ey = rel ? y + f : f;
                for (const cub of arcToCubics(x, y, rx, ry, rot, fa, fs, ex, ey)) segs.push({ cmd: 'C', pts: cub });
                x = ex; y = ey;
            }
            lastC = lastQ = null; continue;
        }
        return null;
    }
    return segs.length ? segs : null;
}

/**
 * Flatten segments into one polyline per subpath (curves sampled).
 * @param {Segment[]} segs
 * @returns {[number, number][][]}
 */
export function flatten(segs) {
    /** @type {[number, number][][]} */
    const paths = [];
    /** @type {[number, number][]} */
    let cur = [];
    let x = 0, y = 0;
    for (const s of segs) {
        if (s.cmd === 'M') { if (cur.length) paths.push(cur); cur = [[s.pts[0], s.pts[1]]]; x = s.pts[0]; y = s.pts[1]; continue; }
        if (s.cmd === 'L') { cur.push([s.pts[0], s.pts[1]]); x = s.pts[0]; y = s.pts[1]; continue; }
        if (s.cmd === 'Q') {
            cur.push(...sampleQuadratic([x, y], [s.pts[0], s.pts[1]], [s.pts[2], s.pts[3]]).slice(1));
            x = s.pts[2]; y = s.pts[3]; continue;
        }
        if (s.cmd === 'C') {
            cur.push(...sampleCubic([x, y], [s.pts[0], s.pts[1]], [s.pts[2], s.pts[3]], [s.pts[4], s.pts[5]]).slice(1));
            x = s.pts[4]; y = s.pts[5]; continue;
        }
        if (s.cmd === 'Z') { if (cur.length) { paths.push(cur); cur = []; } }
    }
    if (cur.length) paths.push(cur);
    return paths;
}

/**
 * A shape in UNIT form: parsed, centred on its bounding box, scaled so the box
 * fits [-1, 1]. `spec` is a named shape or an SVG path. Cached. Null when the
 * path cannot be read.
 * @param {string} spec
 * @returns {{ segments: Segment[] } | null}
 */
export function unitShape(spec) {
    const key = String(spec);
    if (unitCache.has(key)) return /** @type {any} */ (unitCache.get(key));
    let segs = null;
    const sym = D3_SYMBOLS[key.toLowerCase()];
    if (sym) segs = parsePath(String(d3.symbol().type(sym).size(100)()));
    else if (/^\s*[Mm]/.test(key)) segs = parsePath(key);
    if (!segs) { unitCache.set(key, null); return null; }
    const pts = flatten(segs).flat();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of pts) { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const half = Math.max(maxX - minX, maxY - minY) / 2 || 1;
    const unit = {
        segments: segs.map((s) => ({ cmd: s.cmd, pts: s.pts.map((v, i) => (i % 2 === 0 ? (v - cx) / half : (v - cy) / half)) })),
    };
    unitCache.set(key, unit);
    return unit;
}

/**
 * Place a unit shape: scale to radius `r`, rotate by `angle` (math degrees,
 * counter-clockwise on screen — the same convention a node's `angle` carries),
 * translate to (cx, cy). The transform is BAKED into `d` (a path carries no
 * `angle` of its own, as needle's does), and `points` is the outline polygon
 * (the first subpath) the pick layer measures and the canvas can draw.
 * @param {{ segments: Segment[] }} unit
 * @param {number} cx @param {number} cy @param {number} r @param {number} [angle]
 * @returns {{ d: string, points: [number, number][] }}
 */
export function placeShape(unit, cx, cy, r, angle = 0) {
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    /** @param {number} ux @param {number} uy @returns {[number, number]} */
    const place = (ux, uy) => [cx + r * (ux * cos + uy * sin), cy + r * (-ux * sin + uy * cos)];
    /** @param {number} v */
    const f = (v) => (Math.round(v * 100) / 100).toString();
    const segs = unit.segments.map((s) => {
        const pts = [];
        for (let i = 0; i < s.pts.length; i += 2) pts.push(...place(s.pts[i], s.pts[i + 1]));
        return { cmd: s.cmd, pts };
    });
    const d = segs.map((s) => (s.cmd === 'Z' ? 'Z' : `${s.cmd}${s.pts.map(f).join(',')}`)).join('');
    const polys = flatten(segs);
    return { d, points: polys[0] || [] };
}
