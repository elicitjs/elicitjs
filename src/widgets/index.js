// @ts-check
// widgets/: named survey instruments. Each is a recipe of marks, edits,
// constraints and guides that returns an ElicitSpec: Elicit(widgets.likert({ … })).

export { likert } from './likert.js';
export { multipleChoice } from './choice.js';
export { slider } from './slider.js';
export { matrix } from './matrix.js';
export { lineCone } from './lineCone.js';
export { ranking } from './ranking.js';
export { allocation } from './allocation.js';
export { probabilityTokens } from './probabilityTokens.js';
export { interval } from './interval.js';
export { histogram } from './histogram.js';
export { region } from './region.js';
export { thermometer } from './thermometer.js';
export { labeledValue } from './labeledValue.js';

// The widget guides (option rings, cell grid, slider track, prompt, quadrants) are
// `guides.*`; `THEME` and `widgetTheme` are `authoring.*`.
