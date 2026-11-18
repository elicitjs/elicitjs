// @ts-check
// looks/: the look vocabulary (`spec.looks`). A look restyles how the finished
// chart is drawn and changes nothing else. Experimental.

// Geometry: redraws shapes by hand; any renderer.
export { rough } from './rough.js';
// Shaders: run over the painted pixels; canvas only.
export { sketch, cartoon, halftone, custom } from './shaders.js';
