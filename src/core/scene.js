// @ts-check

export class SceneGraph {
    constructor() {
        /** @type {import('../types').FeatureNode[]} */
        this.children = [];
    }

    /**
     * @param {import('../types').FeatureNode} node
     */
    add(node) {
        this.children.push(node);
    }

    clear() {
        this.children = [];
    }
}

/**
 * Where a node sits in its glyph's paint order. Hit nodes first (bottom), then
 * rows in dataset order; a node with no row (a series path) sits under them all.
 * @param {any} node
 * @returns {[number, number]}
 */
const glyphKey = (node) => [
    // A composite's box is an invisible grab target for the whole glyph, so it is
    // the same FALLBACK a `.mark-hit` rect is: it must never outrank a node that
    // is really drawn there. Interleaved with the parts it would, because a box
    // covers its glyph entirely — row 2's box would eat every handle of row 1.
    node.hit ? 0 : 1,
    typeof node.index === 'number' ? node.index : -1,
];

/**
 * Paint order for one chart's built features.
 *
 * Array order is z-order, and for ordinary marks that is exactly the feature
 * order: a whole mark paints over the mark before it. A GLYPH is the exception.
 * Its parts are separate features (see plot/composite.js), so painting them
 * feature by feature draws every row's body, then every row's label — and two
 * overlapping stickers come out interleaved, the lower note's text sitting on
 * top of the upper note's paper. A glyph is one OBJECT, so its features are
 * grouped (`Mark.glyph`) and their nodes are ordered by ROW first: each glyph
 * paints whole, in its parts' declared order, and a later row covers an earlier
 * one completely. A node flagged `raise` goes last of all.
 *
 * @param {{ glyph?: string, nodes: any[] }[]} built features in scene order,
 *   each with the nodes its `build()` returned
 * @returns {any[]} the nodes, in paint order
 */
export function paintOrder(built) {
    /** @type {any[]} */
    const out = [];
    for (let i = 0; i < built.length; i++) {
        const glyph = built[i].glyph;
        if (!glyph) {
            out.push(...built[i].nodes);
            continue;
        }
        // A composite's features are contiguous (Elicit flattens the array it
        // returns in place), so the group is the run sharing this key.
        /** @type {any[]} */
        const group = [];
        let j = i;
        while (j < built.length && built[j].glyph === glyph) {
            group.push(...built[j].nodes);
            j++;
        }
        i = j - 1;
        // Stable, so within one row the parts keep their declared order — the
        // half of the ordering that was already right.
        group.sort((a, b) => {
            const [ha, ra] = glyphKey(a);
            const [hb, rb] = glyphKey(b);
            return ha !== hb ? ha - hb : ra - rb;
        });
        out.push(...group);
    }
    // A hierarchy's nodes carry their DEPTH (stamped by the engine's tagging pass),
    // and a container must paint beneath its contents whichever feature draws either
    // and wherever their rows fall. Reordered among THEMSELVES, in the slots they
    // already hold, so every other mark keeps its place; stable, so one row's glyph
    // still paints whole and in its parts' order.
    if (out.some((n) => n && typeof n.depth === 'number')) {
        /** @type {number[]} */
        const slots = [];
        out.forEach((n, i) => { if (n && typeof n.depth === 'number') slots.push(i); });
        const byDepth = slots.map((i) => out[i]).sort((a, b) => a.depth - b.depth);
        slots.forEach((slot, k) => { out[slot] = byDepth[k]; });
    }
    // A RAISED node (a link's end handle) sits on another mark's edge, so it paints
    // above every mark — and it is a visible handle, shown only while its row is lit,
    // not a hit overlay that could outrank a node really drawn there.
    if (!out.some((n) => n && n.raise)) return out;
    return [...out.filter((n) => !(n && n.raise)), ...out.filter((n) => n && n.raise)];
}

const CLIP_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * The rect the marks are confined to under `spec.clip`, in plot-local pixels
 * (the plot's top-left is 0, 0), or null when the chart does not clip.
 *
 * `clip` is `true` (the plot rect, axis to axis), `false`, or `{ pad }`: the plot
 * rect grown by `pad` pixels on every side (a number) or per side (`{ top, right,
 * bottom, left }`), so a point sitting ON a domain edge draws whole instead of
 * cut in half by its own axis. `auto` is what an unset `clip` resolved to.
 *
 * One function decides the rect, and the renderers' clip paths and the engine's
 * hit filter (`clipVisible`) all read it, so what is drawn and what can be
 * grabbed cannot disagree.
 * @param {boolean | { pad?: number | { top?: number, right?: number, bottom?: number, left?: number } } | null | undefined} clip
 * @param {boolean} auto
 * @param {number} width   inner plot width
 * @param {number} height  inner plot height
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function clipRect(clip, auto, width, height) {
    const on = clip == null ? auto : clip !== false;
    if (!on) return null;
    const pad = clip && typeof clip === 'object' ? clip.pad : 0;
    /** @type {Record<string, number>} */
    const side = {};
    for (const s of CLIP_SIDES) {
        const v = typeof pad === 'number' ? pad : (pad && /** @type {any} */ (pad)[s]);
        side[s] = Number.isFinite(v) ? v : 0;
    }
    return {
        x: 0 - side.left,
        y: 0 - side.top,
        width: Math.max(0, width + side.left + side.right),
        height: Math.max(0, height + side.top + side.bottom),
    };
}

/**
 * The spelling problems `clipRect` would otherwise absorb in silence: an unknown
 * key, or a `pad` that is neither a number nor a map of sides.
 * @param {any} clip
 * @returns {string | null} a message, or null when the spelling is fine
 */
export function clipProblem(clip) {
    if (clip == null || typeof clip === 'boolean') return null;
    if (typeof clip !== 'object' || Array.isArray(clip)) return 'clip is true, false, or { pad }.';
    const extra = Object.keys(clip).filter((k) => k !== 'pad');
    if (extra.length) return `clip has no option ${extra.map((k) => `"${k}"`).join(', ')}; it takes { pad }.`;
    const { pad } = clip;
    if (pad == null || Number.isFinite(pad)) return null;
    if (typeof pad !== 'object' || Array.isArray(pad)) return 'clip.pad is a number of pixels, or { top, right, bottom, left }.';
    const bad = Object.keys(pad).filter((k) => !CLIP_SIDES.includes(k) || !Number.isFinite(pad[k]));
    return bad.length ? `clip.pad sides are top, right, bottom and left, each a number of pixels (got ${bad.map((k) => `"${k}"`).join(', ')}).` : null;
}
