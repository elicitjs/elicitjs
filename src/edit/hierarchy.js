// edit.hierarchy.* — the gestures that build a hierarchy's CONTAINMENT.
//
// A hierarchy keeps "who is inside whom" in its nesting table (core/hierarchy.js), so
// re-parenting is a write to THAT table, made from a gesture on a node — the
// `edit.network.connect` shape: the edit sits on a node mark and names the table it
// writes by ROLE (`table: 'nesting'`).
//
// Creating and deleting a node are plain `create`/`remove`, and MOVING a container is
// the plain `move`: the engine carries its contents along (core/fit.js). The one
// thing only a hierarchy has is putting a node in, or taking it out.

import { makeEdit, mintDatum } from './shared.js';
import { nestingOf, treeOf } from '../core/hierarchy.js';
import { boxAt } from '../plot/nodeBox.js';

/**
 * nest — drop a node into a container, or out of one.
 *
 * Goes on the mark you DRAG (any mark drawing the hierarchy's nodes), beside a
 * `move`: move carries the node under the pointer, and at release nest reads where
 * it was let go. The row lands in the DEEPEST container under the pointer — a row
 * the node mark's `contains` channel allows to hold others — and a release over no
 * container takes it out to the root. The node itself and everything inside it are
 * never targets, and the engine refuses any drop that would break the tree, so a
 * container cannot be dropped into its own contents.
 *
 * Use it beside `move({ mode: 'relative' })`. A relative move is a driver and runs
 * before this one each tick, so the proposal drawn while you aim (the container
 * growing to take the node) survives the move's commit; an absolute move commits
 * after it and the release still works, with no preview.
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
        // The proposal is a NESTING row even though the gesture is on a node.
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
            if ((into === null ? null : into) === current) return undefined; // already there

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
