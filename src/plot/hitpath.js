// @ts-check
// hitpath.js — Bézier samplers for the wide transparent hit path a curved mark
// draws over its visible `d` path. Picking only measures `points` polylines, so a
// `d`-only path can't be grabbed (and canvas can't hit-test it at all).
// The hit path leaves `pointerEvents` unset so the engine decides, and is never
// raised above the real marks.

// Segments per sampled Bézier.
const HIT_SAMPLES = 16;

// Minimum grab width for an invisible hit path, in px.
export const HIT_WIDTH = 16;

/**
 * Sample a quadratic Bézier into a polyline. `samples` lets a rounded corner
 * (linkGeometry.js) use fewer segments.
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
