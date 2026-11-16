// @ts-check
import { isBareForm } from '../schema.js';

/**
 * The dataset's hover: the one row under the pointer in a chart whose hover is
 * linked (`effects.hovered.link`), shown by every linked chart. Like the
 * selection it is not belief data: it fires `hover`, never `change`, and
 * bypasses undo.
 *
 * @param {import('../dataset.js').DataState} state
 * @param {{
 *   schemaSpec: import('../../types').SchemaSpec,
 *   listeners: { hover: Set<Function> },
 *   reportedRows: (name: string) => any[],
 *   rowIndexOf: (name: string, i: number) => number,
 *   reportedIndexOf: (name: string, j: number) => number | null,
 *   update: () => void,
 * }} deps
 */
export function createHover(state, deps) {
    const { schemaSpec, listeners, reportedRows, rowIndexOf, reportedIndexOf } = deps;

    /** @type {{ table: string, index: number } | null} */
    let hovered = null;

    // The hovered row, or null. A stale index (row since removed) reads as none.
    const hoverRow = () => (hovered && hovered.index >= 0
        && hovered.index < (state.tables[hovered.table] || []).length ? hovered : null);

    // The hovered row as the public API reports it: a reported index in a
    // single-table dataset, `{ table, index }` otherwise. A context row is left out.
    const getHover = () => {
        const h = hoverRow();
        const i = h ? reportedIndexOf(h.table, h.index) : null;
        if (!h || i == null) return null;
        return isBareForm(schemaSpec) ? i : { table: h.table, index: i };
    };

    // Set or clear the hovered row. Returns whether it moved; it does not render.
    /** @param {{ table: string, index: number } | null} next */
    const commitHover = (next) => {
        const same = (!hovered && !next)
            || !!(hovered && next && hovered.table === next.table && hovered.index === next.index);
        if (same) return false;
        hovered = next ? { table: next.table, index: next.index } : null;
        const reported = getHover();
        for (const cb of listeners.hover) cb(reported);
        return true;
    };

    // Hover a row of the primary table from outside a chart, and render.
    // `null` or an out-of-range index clears it.
    /** @param {number | null} index */
    const hover = (index) => {
        const rows = reportedRows(schemaSpec.primary);
        const ok = typeof index === 'number' && index >= 0 && index < rows.length;
        const moved = commitHover(ok
            ? { table: schemaSpec.primary, index: rowIndexOf(schemaSpec.primary, /** @type {number} */ (index)) }
            : null);
        if (moved) deps.update();
        return moved;
    };

    return { hoverRow, commitHover, api: { hover, getHover } };
}
