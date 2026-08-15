// @ts-check
// The extension point: a constraint is a pure data invariant. One name — this had
// three (`defineConstraint`, `define`, `custom`), which in a JSON grammar would be
// three keywords for one thing.
export { defineConstraint } from './define.js';
export { clamp } from './clamp.js';
export { maintainSum, normalize } from './maintainSum.js';
export { count } from './count.js';
export { unique } from './unique.js';
export { snap } from './snap.js';
// Shape rules: what an elicited row / curve is allowed to look like.
export { ordering } from './ordering.js';
export { monotonic } from './monotonic.js';
export { spacing } from './spacing.js';

