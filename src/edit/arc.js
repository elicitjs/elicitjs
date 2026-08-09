// @ts-check
// arc.js — `edit.arc.edge`, kept as a DEPRECATED alias of `edit.stack.edge`.
//
// A pie's boundary drag turned out to be the general case, not an arc feature. A
// stacked bar and a pie are the same structure — a group of rows partitioning one
// total along a 1-D parameter, data units up an axis or degrees around a ring — so
// the pair-shift this edit performed, and the angular inversion it hard-coded to do
// it, moved to where each belongs: the redistribution to `edit/stack.js`, which is
// mark-agnostic, and the angular math to `plot/arc.js`'s layout, which is where the
// span and padding it needs already live.
//
// This wrapper stays so a spec pinned to `edit.arc.edge()` keeps working. It is the
// shared edit with `scope: 'arc'` restored, which still matches (an arc mark sets
// both `supportsArc` and `supportsStack`). Prefer `edit.stack.edge()`, which is the
// same behaviour under the name that says what it operates on — and sits beside the
// `cut` and `merge` an arc now also accepts.

import { edge as stackEdge } from './stack.js';
import { warn } from '../core/dev.js';

/**
 * @deprecated Use `edit.stack.edge()`.
 * @param {any} [options]
 * @returns {import('../types').Edit}
 */
export function edge(options = {}) {
    warn(
        'deprecated:arc.edge',
        'edit.arc.edge() is deprecated — use edit.stack.edge(). A slice boundary and a ' +
        'stacked bar\'s boundary are the same edit, so it moved to the edit.stack.* family, ' +
        'where edit.stack.cut() and edit.stack.merge() now also work on a pie.'
    );
    return stackEdge({ scope: 'arc', ...options });
}
