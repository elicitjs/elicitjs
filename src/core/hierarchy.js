// Hierarchy — the one reader of a `hierarchy` structure's nesting table.
// A hierarchy is `nodes`, `nesting` (one row = child inside parent, two `ref`
// columns) and optional `links`. Everything that asks "who is inside whom" goes
// through `treeOf`. Pure data: no scales, no pixels, no scene.

/**
 * @typedef {object} NestingSpec
 * @property {string} table   the nesting table's name
 * @property {string} child   the column naming the contained node
 * @property {string} parent  the column naming the container
 * @property {string} nodes   the nodes table's name
 * @property {string} key     the nodes table's key column
 */

/**
 * Where containment lives in this schema, or null when it declares none. The two
 * ends are the nesting table's first two `ref` fields (child, then parent),
 * resolved by role.
 * @param {import('../types').SchemaSpec} spec
 * @returns {NestingSpec | null}
 */
export function nestingOf(spec) {
    const table = spec && spec.byRole && spec.byRole.nesting;
    const nodes = spec && spec.byRole && spec.byRole.nodes;
    if (!table || !nodes) return null;
    const fields = spec.tables[table].fields;
    const refs = Object.keys(fields).filter((f) => fields[f] && fields[f].type === 'ref');
    const key = spec.tables[nodes].key;
    if (refs.length < 2 || !key) return null;
    return { table, child: refs[0], parent: refs[1], nodes, key };
}

/**
 * @typedef {object} Tree
 * @property {(key: any) => number} indexOf  node row index for a key, -1 if none
 * @property {(i: number) => number | null} parentOf
 * @property {(i: number) => number[]} childrenOf  in nesting-row order
 * @property {(i: number) => boolean} hasChildren
 * @property {(i: number) => number} depthOf  0 for a root
 * @property {(i: number) => number[]} ancestorsOf  nearest first
 * @property {(i: number) => number[]} descendantsOf  every level, parents before children
 * @property {number[]} bottomUp  every node index, children before their parent
 */

/** @type {Tree} */
const FLAT = {
    indexOf: () => -1,
    parentOf: () => null,
    childrenOf: () => [],
    hasChildren: () => false,
    depthOf: () => 0,
    ancestorsOf: () => [],
    descendantsOf: () => [],
    bottomUp: [],
};

/** nesting rows array -> (node rows array -> Tree). Row arrays are replaced, never
 *  mutated, on every commit, so identity is a sound cache key. */
const cache = new WeakMap();

/**
 * The containment tree of a dataset, addressed by node row index. Tolerant of
 * broken data (a seed, a proposal about to be rejected): a child's first nesting
 * row wins, a row naming a missing node is skipped, and a cycle is cut.
 * `treeProblems` reports those; this never throws.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @returns {Tree}
 */
export function treeOf(spec, tables) {
    const nesting = nestingOf(spec);
    if (!nesting) return FLAT;
    const nodeRows = (tables && tables[nesting.nodes]) || [];
    const nestRows = (tables && tables[nesting.table]) || [];

    let byNodes = cache.get(nestRows);
    if (!byNodes) cache.set(nestRows, (byNodes = new WeakMap()));
    const hit = byNodes.get(nodeRows);
    if (hit) return hit;

    const index = new Map();
    nodeRows.forEach((row, i) => {
        const k = row ? row[nesting.key] : undefined;
        if (k !== undefined && k !== null && !index.has(k)) index.set(k, i);
    });
    const indexOf = (/** @type {any} */ key) => (index.has(key) ? index.get(key) : -1);

    /** @type {(number | null)[]} */
    const parent = nodeRows.map(() => null);
    /** @type {number[][]} */
    const children = nodeRows.map(() => []);
    for (const row of nestRows) {
        if (!row) continue;
        const c = indexOf(row[nesting.child]);
        const p = indexOf(row[nesting.parent]);
        if (c < 0 || p < 0 || c === p || parent[c] !== null) continue;
        // Would this close a loop? Walk up from the proposed parent.
        let up = /** @type {number | null} */ (p);
        let loops = false;
        while (up !== null) {
            if (up === c) { loops = true; break; }
            up = parent[up];
        }
        if (loops) continue;
        parent[c] = p;
        children[p].push(c);
    }

    const ancestorsOf = (/** @type {number} */ i) => {
        const out = [];
        for (let up = parent[i]; up !== null && up !== undefined; up = parent[up]) out.push(up);
        return out;
    };
    const descendantsOf = (/** @type {number} */ i) => {
        const out = [];
        const queue = [...(children[i] || [])];
        while (queue.length) {
            const n = /** @type {number} */ (queue.shift());
            out.push(n);
            queue.push(...children[n]);
        }
        return out;
    };
    const depth = nodeRows.map((_, i) => ancestorsOf(i).length);
    const bottomUp = nodeRows.map((_, i) => i).sort((a, b) => depth[b] - depth[a]);

    /** @type {Tree} */
    const tree = {
        indexOf,
        parentOf: (i) => (parent[i] === undefined ? null : parent[i]),
        childrenOf: (i) => children[i] || [],
        hasChildren: (i) => !!(children[i] && children[i].length),
        depthOf: (i) => depth[i] || 0,
        ancestorsOf,
        descendantsOf,
        bottomUp,
    };
    byNodes.set(nodeRows, tree);
    return tree;
}

/**
 * @typedef {object} TreeProblem
 * @property {'second-parent' | 'self' | 'cycle'} kind
 * @property {number} row   index of the offending nesting row
 * @property {any} child
 * @property {any} parent
 */

/**
 * The nesting rows that contradict a tree: a second parent, a node inside itself,
 * or a row that closes a loop. The earlier row stands, matching `treeOf`.
 * Half-built rows and rows naming a missing node (`enforceRefs`'s job) are skipped.
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables
 * @returns {TreeProblem[]}
 */
export function treeProblems(spec, tables) {
    const nesting = nestingOf(spec);
    if (!nesting) return [];
    /** @type {TreeProblem[]} */
    const problems = [];
    const parentOfKey = new Map();
    const rows = (tables && tables[nesting.table]) || [];
    rows.forEach((row, i) => {
        if (!row) return;
        const child = row[nesting.child];
        const parent = row[nesting.parent];
        if (child === undefined || child === null || parent === undefined || parent === null) return;
        if (child === parent) { problems.push({ kind: 'self', row: i, child, parent }); return; }
        if (parentOfKey.has(child)) { problems.push({ kind: 'second-parent', row: i, child, parent }); return; }
        const seen = new Set([child]);
        for (let up = parent; up !== undefined; up = parentOfKey.get(up)) {
            if (seen.has(up)) { problems.push({ kind: 'cycle', row: i, child, parent }); return; }
            seen.add(up);
        }
        parentOfKey.set(child, parent);
    });
    return problems;
}

/**
 * Drop the nesting rows `treeProblems` reports, for data from outside a gesture
 * (the seed, `setData`). A gesture's proposal is refused instead (computeEdit).
 * @param {import('../types').SchemaSpec} spec
 * @param {Record<string, import('../types').Datum[]>} tables mutated in place
 * @returns {TreeProblem[]} what was dropped
 */
export function enforceTree(spec, tables) {
    const problems = treeProblems(spec, tables);
    if (!problems.length) return problems;
    const nesting = /** @type {NestingSpec} */ (nestingOf(spec));
    const bad = new Set(problems.map((p) => p.row));
    tables[nesting.table] = tables[nesting.table].filter((_, i) => !bad.has(i));
    return problems;
}
