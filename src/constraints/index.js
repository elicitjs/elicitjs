// @ts-check
// `custom` authors a constraint inline (`authoring.defineConstraint` is the same function).
export { defineConstraint as custom } from './define.js';
export { clamp } from './clamp.js';
export { maintainSum } from './maintainSum.js';
export { count } from './count.js';
export { unique } from './unique.js';
export { snap } from './snap.js';
// Shape rules: what an elicited row / curve is allowed to look like.
export { ordering } from './ordering.js';
export { monotonic } from './monotonic.js';
export { spacing } from './spacing.js';
// Coupling rules: columns of one row that move together.
export { follow } from './follow.js';
export { symmetric } from './symmetric.js';

