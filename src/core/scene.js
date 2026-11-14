// @ts-check

/** The chart margins when a spec states none. */
export const DEFAULT_MARGINS = Object.freeze({ top: 20, right: 20, bottom: 30, left: 40 });

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
    // A composite's hit box is a fallback grab target: it paints beneath every
    // drawn node, or row 2's box would eat row 1's handles.
    node.hit ? 0 : 1,
    typeof node.index === 'number' ? node.index : -1,
];

/**
 * Paint order for one chart's built features. Array order is z-order. A glyph's
 * features (`Mark.glyph`) are grouped and ordered by row, then part, so each glyph
 * paints whole. Hierarchy nodes order by depth; a `raise`d node goes last.
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
        // Stable, so within one row the parts keep their declared order.
        group.sort((a, b) => {
            const [ha, ra] = glyphKey(a);
            const [hb, rb] = glyphKey(b);
            return ha !== hb ? ha - hb : ra - rb;
        });
        out.push(...group);
    }
    // Hierarchy nodes (stamped `depth`) reorder among their own slots so containers
    // paint beneath their contents; every other node keeps its place.
    if (out.some((n) => n && typeof n.depth === 'number')) {
        /** @type {number[]} */
        const slots = [];
        out.forEach((n, i) => { if (n && typeof n.depth === 'number') slots.push(i); });
        const byDepth = slots.map((i) => out[i]).sort((a, b) => a.depth - b.depth);
        slots.forEach((slot, k) => { out[slot] = byDepth[k]; });
    }
    // A raised node (a link's end handle) paints above every mark. It is a visible
    // handle, not a hit overlay.
    if (!out.some((n) => n && n.raise)) return out;
    return [...out.filter((n) => !(n && n.raise)), ...out.filter((n) => n && n.raise)];
}

const CLIP_SIDES = ['top', 'right', 'bottom', 'left'];

/**
 * The rect marks are confined to under `spec.clip`, in plot-local px, or null when
 * the chart does not clip. `clip` is `true`, `false`, or `{ pad }` (a number or per
 * side). `auto` is what an unset `clip` resolves to. The renderers and the hit
 * filter (`clipVisible`) both read this, so drawn and grabbable agree.
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
