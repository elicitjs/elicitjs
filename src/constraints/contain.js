// @ts-check
import { defineConstraint, constraintOptions } from './define.js';
import { nestingOf, treeOf } from '../core/hierarchy.js';

// contain: pure-data invariant over a hierarchy's `nesting` table.
//
//   constraints.contain({ parent: d => d.kind === 'lane', maxDepth: 1, maxChildren: 5 })
//
// Gates which nodes may hold others (`parent`), which may be nested (`child`),
// how deep nesting may go (`maxDepth`), and how many children a container may
// hold (`maxChildren`). Runs on every nesting commit (`edit.hierarchy.nest` and
// `ds.set`). Pure data: never reads pixels or scales.

/**
 * @param {import('../types').ContainConstraintOptions} [options]
 * @returns {import('../types').Constraint}
 */
export function contain(options = {}) {
    const { parent, child, maxDepth, maxChildren } = constraintOptions('contain', options);

    return defineConstraint(
        (ctx) => {
            const nesting = ctx.schemaSpec ? nestingOf(ctx.schemaSpec) : null;
            if (!nesting) return undefined;
            const nodeRows = (ctx.tables && ctx.tables[nesting.nodes]) || [];
            const nestRows = ctx.data || [];
            if (!nestRows.length) return undefined;

            const index = new Map();
            nodeRows.forEach((row, i) => {
                const k = row ? row[nesting.key] : undefined;
                if (k !== undefined && k !== null && !index.has(k)) index.set(k, i);
            });

            /** @type {Map<number, number>} */
            const counts = new Map();
            for (const row of nestRows) {
                if (!row) continue;
                const cIdx = index.has(row[nesting.child]) ? index.get(row[nesting.child]) : -1;
                const pIdx = index.has(row[nesting.parent]) ? index.get(row[nesting.parent]) : -1;
                if (cIdx < 0 || pIdx < 0) continue;
                if (typeof parent === 'function' && !parent(nodeRows[pIdx], pIdx, nodeRows)) return false;
                if (typeof child === 'function' && !child(nodeRows[cIdx], cIdx, nodeRows)) return false;
                if (typeof maxChildren === 'number') {
                    const n = (counts.get(pIdx) || 0) + 1;
                    if (n > maxChildren) return false;
                    counts.set(pIdx, n);
                }
            }

            if (typeof maxDepth === 'number') {
                const proposedTables = { ...ctx.tables, [nesting.table]: nestRows };
                const tree = treeOf(/** @type {import('../types').SchemaSpec} */ (ctx.schemaSpec), proposedTables);
                for (let i = 0; i < nodeRows.length; i++) {
                    if (tree.depthOf(i) > maxDepth) return false;
                }
            }

            return undefined;
        },
        {
            type: 'contain',
            table: 'nesting',
            options: { parent, child, maxDepth, maxChildren },
        }
    );
}
