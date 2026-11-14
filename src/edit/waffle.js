// @ts-check
// waffle.js (edit) — fill a waffle up to the cell under the pointer, using the
// grid geometry each cell stamps (`node.grid`): value = dlo + count * unit.

import { makeEdit } from './shared.js';

/**
 * Which 1-based cell the pointer is over → the number of cells to fill.
 * @param {{ x: number, y: number }} pointer
 * @param {any} grid
 * @returns {number}
 */
function countAt(pointer, grid) {
    const p = grid.axis === 'y' ? pointer.y : pointer.x; // value-axis coord
    const q = grid.axis === 'y' ? pointer.x : pointer.y; // band-axis coord
    const alongValue = grid.sign * (p - grid.baseline);  // pixels into the block
    if (alongValue <= 0) return 0;                       // before the baseline → empty
    const row = Math.floor(alongValue / grid.cellSize);
    if (row >= grid.rows) return grid.totalCells;        // past the top → full
    let col = Math.floor((q - (grid.bandStart + grid.bandInset)) / grid.cellSize);
    col = Math.max(0, Math.min(grid.multiple - 1, col));
    const count = row * grid.multiple + col + 1;
    return Math.max(0, Math.min(grid.totalCells, count));
}

/**
 * edit.waffle.fill — fill a waffle up to (and including) the cell under the
 * pointer. Works with `gesture: 'drag'` (default) or `'click'`.
 * @param {import('../types').EditOptions} [options]
 * @returns {import('../types').Edit}
 */
export function fill(options = {}) {
    return makeEdit({
        type: 'waffle.fill',
        gesture: 'drag',
        scope: 'waffle',
        ...options,
        apply: (/** @type {import('../types').EditContext} */ ctx) => {
            const grid = ctx.node && ctx.node.grid;
            const ch = ctx.channels && ctx.channels[0];
            if (!grid || !ch || !ch.field) return undefined;
            const count = countAt(ctx.pointer, grid);
            const value = Math.max(grid.dlo, Math.min(grid.dhi, grid.dlo + count * grid.unit));
            return { ...ctx.datum, [ch.field]: value };
        }
    });
}
