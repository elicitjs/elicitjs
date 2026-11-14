// @ts-check
// guides/: the guide vocabulary. A guide views chart state (`views: 'state'`),
// has no table, channel map or row, and writes nothing. Every option may be a
// literal or a function of the chart context.

// Reference geometry: a line or a band, positioned in data space.
export { rule } from './rule.js';
export { region } from './region.js';
// What is left to do under a rule: the unallocated remainder of a budget.
export { remaining } from './remaining.js';
// The catchment of a proximity pick.
export { proximity } from './proximity.js';
// Arbitrary read-only nodes from the render context.
export { custom } from './custom.js';

// Widget chrome: a prompt, Likert option rings, a matrix's cell grid, a slider
// track, a quadrant frame.
export { optionRings, cellGrid, sliderTrack, prompt, quadrants } from '../widgets/theme.js';

// Pointer-following guides, reading `ui.pointer` / `ui.hit`. A mark's `tip: true`
// desugars into `tip({ mark })`.
export { tip } from './tip.js';
export { crosshair } from './crosshair.js';
