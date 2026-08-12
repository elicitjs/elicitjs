// @ts-check
// hitpath.js — how a curved path becomes grabbable.
//
// A stroked path is a few pixels wide, so grabbing one is nearly impossible, and
// the pick layer can't help: `edit/pick.js` measures distance along a node's
// `points` polyline and has no branch for a `d`-only path at all. A path that
// carries geometry ONLY as `d` is therefore invisible to proximity picking under
// every renderer, and untouchable under canvas, which hit-tests entirely in JS.
//
// So a curved mark emits its visible path plus a fat TRANSPARENT one over the same
// geometry, sampled into `points`. `curve` (the mark) established the pattern;
// `link` needs exactly the same thing for its bodies, and two copies of a Bézier
// sampler is one copy too many.
//
// The hit path leaves `pointerEvents` UNSET on purpose: the engine silences any
// mark with no direct-pick edit, so an inert path can't swallow a sibling handle's
// drag, while an editable one gets the pointer back automatically. It must also
// never be raised above the real marks — it is a fallback for a shape with no area
// to hit, not something that outranks a node genuinely drawn there.

// How many segments a Bézier is sampled into. Enough that the straight-line error
// stays well under the hit stroke's own width at any curvature this library draws.
export const HIT_SAMPLES = 16;

// Minimum grab width for an invisible hit path, in px.
export const HIT_WIDTH = 16;

/**
 * Sample a quadratic Bézier into a polyline.
 *
 * `samples` exists for the one caller that is not building a hit path: a rounded
 * corner (linkGeometry.js) IS a quadratic, and rounding it through this sampler is
 * what keeps an elbow a `points` polyline instead of a `d` string with a companion
 * hit path. A corner spans a few px, so it needs far fewer segments than a link
 * body — but a second sampler for the difference would be one copy too many.
 *
 * @param {[number, number]} p1 @param {[number, number]} c @param {[number, number]} p2
 * @param {number} [samples] segments to divide the curve into
 * @returns {[number, number][]}
 */
export function sampleQuadratic(p1, c, p2, samples = HIT_SAMPLES) {
    /** @type {[number, number][]} */
    const pts = [];
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const u = 1 - t;
        pts.push([
            u * u * p1[0] + 2 * u * t * c[0] + t * t * p2[0],
            u * u * p1[1] + 2 * u * t * c[1] + t * t * p2[1],
        ]);
    }
    return pts;
}

/**
 * Sample a cubic Bézier into a polyline.
 * @param {[number, number]} p1 @param {[number, number]} c1
 * @param {[number, number]} c2 @param {[number, number]} p2
 * @returns {[number, number][]}
 */
export function sampleCubic(p1, c1, c2, p2) {
    /** @type {[number, number][]} */
    const pts = [];
    for (let i = 0; i <= HIT_SAMPLES; i++) {
        const t = i / HIT_SAMPLES;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const e = t * t * t;
        pts.push([
            a * p1[0] + b * c1[0] + c * c2[0] + e * p2[0],
            a * p1[1] + b * c1[1] + c * c2[1] + e * p2[1],
        ]);
    }
    return pts;
}
