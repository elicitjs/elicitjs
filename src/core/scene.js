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
 * one completely.
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
    return out;
}
