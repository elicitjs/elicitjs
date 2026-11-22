// @ts-check
// trackGeometry.js — the geometry behind `plot.track`: a route read from an SVG
// path, the first fraction of it, and the fraction nearest a pointer. No DOM.
//
// A route is made of lanes: each `M` in the path starts one. Only lanes hold
// value, so the readable length is the sum of the lanes. A join between two
// lanes is drawn ('round' | 'straight') or not ('none'), and never counts.
import { parsePath, flatten } from './shapes.js';
import { sampleCubic } from './hitpath.js';

/**
 * One lane: its polyline and the length along it at each point.
 * @typedef {{ pts: [number, number][], cum: number[], len: number }} Lane
 */

/**
 * The route of an SVG path in pixels, or null when the path can't be read.
 * A closed subpath (`Z`) runs back to its start.
 * @param {string} d
 * @returns {{ lanes: Lane[], total: number } | null}
 */
export function routeOf(d) {
    const segs = parsePath(String(d));
    if (!segs) return null;
    // `flatten` drops the closing edge, so spell it as a line.
    /** @type {import('./shapes.js').Segment[]} */
    const open = [];
    let sx = 0, sy = 0;
    for (const s of segs) {
        if (s.cmd === 'M') { sx = s.pts[0]; sy = s.pts[1]; }
        open.push(s.cmd === 'Z' ? { cmd: 'L', pts: [sx, sy] } : s);
    }
    /** @type {Lane[]} */
    const lanes = [];
    for (const pts of flatten(open)) {
        const cum = [0];
        for (let k = 1; k < pts.length; k++) {
            cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        }
        const len = cum[cum.length - 1];
        if (len > 0) lanes.push({ pts, cum, len });
    }
    if (!lanes.length) return null;
    return { lanes, total: lanes.reduce((sum, l) => sum + l.len, 0) };
}

/**
 * The unit direction of a polyline at its start or its end.
 * @param {[number, number][]} pts @param {'start' | 'end'} at
 * @returns {[number, number]}
 */
function direction(pts, at) {
    const [a, b] = at === 'start' ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
    const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / n, (b[1] - a[1]) / n];
}

/**
 * The points that join the end of one lane to the start of the next. 'round'
 * leaves along the first lane's heading and arrives along the second's, so two
 * lanes running opposite ways get a half circle.
 * @param {Lane} from @param {Lane} to @param {'round' | 'straight'} join
 * @returns {[number, number][]} the points after `from`'s end, ending at `to`'s start
 */
function joinPoints(from, to, join) {
    const a = from.pts[from.pts.length - 1], b = to.pts[0];
    const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (gap === 0) return [];
    if (join === 'straight') return [b];
    // A cubic with arms of 2/3 the gap traces a half circle across it.
    const arm = (2 / 3) * gap;
    const ta = direction(from.pts, 'end'), tb = direction(to.pts, 'start');
    return sampleCubic(a, [a[0] + ta[0] * arm, a[1] + ta[1] * arm], [b[0] - tb[0] * arm, b[1] - tb[1] * arm], b).slice(1);
}

/**
 * The first `fraction` of a route's readable length, as polylines: one per
 * stretch with no gap. Joins are drawn into a stretch; with 'none' each lane
 * is its own stretch. A join is drawn only once the next lane has some value.
 * @param {{ lanes: Lane[], total: number }} route
 * @param {number} fraction 0 to 1
 * @param {'round' | 'straight' | 'none'} join
 * @returns {[number, number][][]}
 */
export function alongRoute(route, fraction, join) {
    let left = Math.max(0, Math.min(1, fraction)) * route.total;
    /** @type {[number, number][][]} */
    const out = [];
    /** @type {[number, number][] | null} */
    let cur = null;
    for (let k = 0; k < route.lanes.length && left > 1e-9; k++) {
        const lane = route.lanes[k];
        if (cur && join !== 'none') cur.push(...joinPoints(route.lanes[k - 1], lane, join));
        else { cur = [lane.pts[0]]; out.push(cur); }
        for (let p = 1; p < lane.pts.length; p++) {
            const step = lane.cum[p] - lane.cum[p - 1];
            if (step >= left) {
                const t = step > 0 ? left / step : 1;
                const [x0, y0] = lane.pts[p - 1], [x1, y1] = lane.pts[p];
                cur.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
                left = 0;
                break;
            }
            cur.push(lane.pts[p]);
            left -= step;
        }
    }
    return out;
}

/**
 * Polylines as an SVG path.
 * @param {[number, number][][]} lines
 * @returns {string}
 */
export function pathOfLines(lines) {
    /** @param {number} v */
    const f = (v) => (Math.round(v * 100) / 100).toString();
    return lines.map((pts) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L')).join('');
}

// Pieces the follow walk steps through, in px. Short, so the walk is local.
const PIECE = 4;

/**
 * The fraction of the route nearest the pointer. During a drag (`from` is the
 * current fraction) it follows the route from there, as a bead on a wire: it
 * walks along the route while the pointer gets closer, crossing from one lane
 * to the next through the gap between them. It jumps to another part of the
 * route only when that part is nearer than the followed one by more than
 * `slack` px. With no `from` it takes the nearest.
 * @param {{ lanes: [number, number][][], total: number }} track the node's `track`
 * @param {{ x: number, y: number }} pointer
 * @param {number} [from] the current fraction
 * @param {number} [slack]
 * @returns {number | undefined}
 */
export function trackFraction(track, pointer, from, slack = 0) {
    if (!track || !(track.total > 0)) return undefined;
    // Short pieces in order along the route. A gap between lanes is a piece
    // too, at the length where the lanes meet.
    /** @type {{ dist: number, s: number, s0: number, s1: number }[]} */
    const pieces = [];
    /** @param {[number, number]} a @param {[number, number]} b @param {number} s0 @param {boolean} hold */
    const add = (a, b, s0, hold) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        // A gap is one piece: it holds one length, so splitting it gains nothing.
        const n = hold ? 1 : Math.max(1, Math.ceil(len / PIECE));
        for (let k = 0; k < n; k++) {
            const x0 = a[0] + (dx * k) / n, y0 = a[1] + (dy * k) / n;
            const px = dx / n, py = dy / n, plen = len / n;
            const t = plen > 0 ? Math.max(0, Math.min(1, ((pointer.x - x0) * px + (pointer.y - y0) * py) / (plen * plen))) : 0;
            const dist = Math.hypot(pointer.x - (x0 + px * t), pointer.y - (y0 + py * t));
            pieces.push(hold
                ? { dist, s: s0, s0, s1: s0 }
                : { dist, s: s0 + ((k + t) * len) / n, s0: s0 + (k * len) / n, s1: s0 + ((k + 1) * len) / n });
        }
    };
    let s0 = 0;
    track.lanes.forEach((pts, l) => {
        if (l > 0) add(track.lanes[l - 1][track.lanes[l - 1].length - 1], pts[0], s0, true);
        for (let k = 1; k < pts.length; k++) {
            const len = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
            add(pts[k - 1], pts[k], s0, false);
            s0 += len;
        }
    });
    if (!pieces.length) return undefined;
    let nearest = 0;
    for (let k = 1; k < pieces.length; k++) if (pieces[k].dist < pieces[nearest].dist) nearest = k;
    if (from == null || !Number.isFinite(from)) return Math.min(1, pieces[nearest].s / track.total);

    // Walk out while the pointer gets closer, from every piece that holds the
    // current length: at a lane's end that is the end, the gap and the next start.
    const at = Math.max(0, Math.min(1, from)) * track.total;
    const eps = 1e-6;
    let starts = pieces.flatMap((g, k) => (at >= g.s0 - eps && at <= g.s1 + eps ? [k] : []));
    if (!starts.length) starts = [pieces.length - 1];
    let follow = starts[0];
    for (const start of starts) {
        if (pieces[start].dist < pieces[follow].dist) follow = start;
        for (let k = start + 1; k < pieces.length && pieces[k].dist <= pieces[k - 1].dist + 1e-9; k++) {
            if (pieces[k].dist < pieces[follow].dist) follow = k;
        }
        for (let k = start - 1; k >= 0 && pieces[k].dist <= pieces[k + 1].dist + 1e-9; k--) {
            if (pieces[k].dist < pieces[follow].dist) follow = k;
        }
    }
    const pick = pieces[nearest].dist + slack < pieces[follow].dist ? nearest : follow;
    return Math.min(1, pieces[pick].s / track.total);
}
