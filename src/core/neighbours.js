// @ts-check
import { refTargetOf } from './schema.js';
import { nestingOf, treeOf } from './hierarchy.js';

/**
 * Does this schema link rows to one another (a `ref` column, or nesting)?
 * @param {import('../types').SchemaSpec} spec
 * @returns {boolean}
 */
export function hasNeighbours(spec) {
    return refsOf(spec).length > 0;
}

/** Every `ref` column and the key column it names.
 * @param {import('../types').SchemaSpec} spec
 * @returns {{ table: string, field: string, target: { table: string, field: string } }[]}
 */
function refsOf(spec) {
    const out = [];
    for (const [name, table] of Object.entries(spec.tables)) {
        for (const [field, fieldSpec] of Object.entries(table.fields)) {
            if (!fieldSpec || fieldSpec.type !== 'ref') continue;
            const target = refTargetOf(spec, fieldSpec);
            if (target) out.push({ table: name, field, target });
        }
    }
    return out;
}

/**
 * The rows one hop from a row: the rows it references, the rows that reference
 * it (a node's links, a link's two nodes), and in a hierarchy everything nested
 * inside it.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, any[]>} tables
 * @param {string} table
 * @param {number} index
 * @returns {{ table: string, index: number }[]}
 */
export function neighboursOf(spec, tables, table, index) {
    const row = (tables[table] || [])[index];
    if (!row) return [];
    /** @type {{ table: string, index: number }[]} */
    const out = [];
    for (const ref of refsOf(spec)) {
        // This row names another: add the row it names.
        if (ref.table === table && row[ref.field] != null) {
            (tables[ref.target.table] || []).forEach((d, i) => {
                if (d && d[ref.target.field] === row[ref.field]) out.push({ table: ref.target.table, index: i });
            });
        }
        // Other rows name this one: add them.
        if (ref.target.table === table && row[ref.target.field] != null) {
            (tables[ref.table] || []).forEach((d, i) => {
                if (d && d[ref.field] === row[ref.target.field]) out.push({ table: ref.table, index: i });
            });
        }
    }
    const nesting = nestingOf(spec);
    if (nesting && nesting.nodes === table) {
        for (const i of treeOf(spec, tables).descendantsOf(index)) out.push({ table, index: i });
    }
    return out;
}
