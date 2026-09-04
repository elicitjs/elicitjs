// @ts-check
// The extension point: a constraint is a pure data invariant. ONE name for it —
// this had three spellings once (`defineConstraint`, `define`, `custom`), which in
// a JSON grammar would be three keywords for one thing.
//
// The surviving keyword is `custom`, matching `edit.custom` and `guides.custom`:
// "author your own X inline" is one act, so it is one word in every grammar
// namespace. (`authoring.defineConstraint` is the same function under the name a
// mark or widget author reaches for while building vocabulary.)
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

