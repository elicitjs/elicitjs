// edit.hierarchy.* — edits on a hierarchy's containment. Re-parenting writes the
// nesting table (`table: 'nesting'`) from a gesture on a node mark.

import { makeEdit, mintDatum } from './shared.js';
import { nestingOf, treeOf } from '../core/hierarchy.js';
import { boxAt } from '../plot/nodeBox.js';

/**
 * nest — drop a node into a container, or out of one.
 *
 * Goes on the node mark beside a `move`. The node lands in the deepest container
 * under the pointer (one the `contains` channel allows); over no container it goes
 * to the root. The node and its descendants are never targets.
 *
 * Pair with `move({ mode: 'relative' })` to get a preview while aiming; with an
 * absolute move the release still works, without a preview.
 *
 * `defaults` seeds any further columns of the nesting row (a confidence, a note).
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function nest(options = {}) {
    const { defaults = {}, ...rest } = options;
    return makeEdit({
        type: 'hierarchy.nest',
        gesture: 'drag',
        pick: 'direct',
        table: 'nesting',
        ...rest,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const c = /** @type {any} */ (ctx);
            const nesting = nestingOf(c.schemaSpec);
            if (!nesting || ctx.index == null || !c.nodeBox || !c.contains) return undefined;
            const rows = (c.tables || {})[nesting.nodes] || [];
            const child = rows[ctx.index];
            const childId = child ? child[nesting.key] : null;
            if (childId === undefined || childId === null) return undefined;

            const tree = treeOf(c.schemaSpec, c.tables);
            const off = new Set([ctx.index, ...tree.descendantsOf(ctx.index)]);
            const into = boxAt(ctx.pointer, rows, c.nodeBox, {
                accepts: (/** @type {number} */ i) => !off.has(i) && c.contains(rows[i], i, rows),
                // Innermost first: the deepest container the pointer is inside.
                rank: (/** @type {number} */ i) => tree.depthOf(i),
            });
            const current = tree.parentOf(ctx.index);
            if (into === current) return undefined; // already there

            const others = ctx.data.filter((d) => !d || d[nesting.child] !== childId);
            if (into === null) return others;
            const row = mintDatum(ctx, {
                defaults,
                seed: { [nesting.child]: childId, [nesting.parent]: rows[into][nesting.key] },
            });
            return row ? [...others, row] : undefined;
        },
    });
}
