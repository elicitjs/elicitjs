// @ts-check
// The JSON spec layer: `compile(json)` returns the spec `Elicit()` takes.
//
//   Elicit(compile(json, { functions }))
//
// See compile.js for the form, expr.js for expressions, functions.js for the
// function registry, and the SPEC_* tables in src/vocabulary.js for the grammar.

import * as plot from '../plot/index.js';
import * as elements from '../elements/index.js';
import * as edit from '../edit/index.js';
import * as constraints from '../constraints/index.js';
import * as guides from '../guides/index.js';
import * as looks from '../looks/index.js';
import * as layout from '../layout/index.js';
import * as widgets from '../widgets/index.js';
import * as format from '../format.js';
import { D3Renderer } from '../renderers/d3-renderer/index.js';
import { CanvasRenderer } from '../renderers/canvas/index.js';
import { createCompiler } from './compile.js';
import { createRecorder } from './record.js';

export { registerFunction } from './functions.js';

/** The library's own namespaces, which `compile` resolves keywords in. */
export const NAMESPACES = {
    plot, elements, edit, constraints, guides, looks, layout, widgets, format,
    renderers: { svg: D3Renderer, canvas: CanvasRenderer },
};

/**
 * Compile a JSON spec into the spec `Elicit()`, `Elicit.dataset()` or
 * `dataset.chart()` takes. A compiled spec builds one chart: compile again for another.
 * @type {(json: any, options?: { functions?: Record<string, Function> }) => any}
 */
export const compile = createCompiler(NAMESPACES);

/**
 * Record a spec written in JavaScript as its JSON spec. The recorder's namespaces
 * (`plot`, `elements`, `edit`, `constraints`, `guides`, `looks`, `widgets`, `format`) look
 * like the library's, and `toJSON(spec)` returns the JSON and the functions it names.
 */
export const recorder = createRecorder(NAMESPACES);
