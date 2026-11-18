// @ts-check
// looks.js — a look restyles how the finished chart is drawn. It changes no data,
// no scale and no hit geometry. Experimental: names and options may change.
//
// Two kinds, one list (`spec.looks`):
//   'geometry'  redraws scene nodes before they reach the renderer; any renderer.
//   'shader'    runs a fragment shader over the painted pixels; needs a renderer
//               that supports `shaders` (canvas).
// `scope` says what a look covers: 'marks' (the default; axes, labels and guides
// stay as drawn) or 'frame' (the whole chart).
import { warn, warningsEnabled } from './dev.js';
import { LOOK_UNIVERSAL_OPTIONS } from '../vocabulary.js';

export const LOOK_SCOPES = ['marks', 'frame'];

/**
 * Stamp a look descriptor with its keyword, kind and resolved scope.
 * @param {string} type the factory name
 * @param {'shader' | 'geometry'} kind
 * @param {any} options the author's options
 * @param {Record<string, any>} body what the kind needs: `fragment` + `uniforms`, or `transform`
 * @returns {import('../types').Look}
 */
export function makeLook(type, kind, options, body) {
    const scope = options && options.scope != null ? options.scope : 'marks';
    if (!LOOK_SCOPES.includes(scope)) {
        warn(`look:scope:${type}:${scope}`, `looks.${type}({ scope: ${JSON.stringify(scope)} }): scope is "marks" or "frame"; using "marks".`);
    }
    return /** @type {any} */ ({ type, kind, scope: LOOK_SCOPES.includes(scope) ? scope : 'marks', ...body });
}

/**
 * Warn on look options outside `allow`.
 * @param {string} look the factory name
 * @param {any} options
 * @param {string[]} allow the look's own option vocabulary
 * @returns {void}
 */
export function warnUnknownLookOptions(look, options, allow) {
    if (!options || !warningsEnabled()) return;
    const known = new Set([...LOOK_UNIVERSAL_OPTIONS, ...allow]);
    for (const key of Object.keys(options)) {
        if (known.has(key)) continue;
        warn(
            `lookopt:${look}:${key}`,
            `looks.${look}({ ${key}: … }) is not an option this look reads, so it is ` +
            `ignored. ${look} options are: ${[...known].sort().join(', ')}.`,
        );
    }
}

/**
 * A number option within its range, or the default. Out of range warns and clamps.
 * @param {string} look @param {string} name @param {any} value
 * @param {number} fallback @param {number} min @param {number} max
 * @returns {number}
 */
export function numberOption(look, name, value, fallback, min, max) {
    if (value == null) return fallback;
    const n = +value;
    if (!Number.isFinite(n)) {
        warn(`lookopt:${look}:${name}:nan`, `looks.${look}({ ${name}: ${JSON.stringify(value)} }): expected a number; using ${fallback}.`);
        return fallback;
    }
    if (n < min || n > max) {
        warn(`lookopt:${look}:${name}:range`, `looks.${look}({ ${name}: ${n} }): ${name} runs from ${min} to ${max}; using ${Math.min(max, Math.max(min, n))}.`);
    }
    return Math.min(max, Math.max(min, n));
}

/**
 * The chart's looks, in order. Anything that is not a look is reported and dropped.
 * @param {any} looks `spec.looks`
 * @returns {import('../types').Look[]}
 */
export function resolveLooks(looks) {
    if (looks == null) return [];
    const list = Array.isArray(looks) ? looks : [looks];
    return list.filter((look, i) => {
        const ok = look && typeof look === 'object' && (look.kind === 'shader' || look.kind === 'geometry');
        if (!ok) warn(`looks:notalook:${i}`, `looks[${i}] is not a look. A look comes from looks.* (looks.rough(), looks.sketch(), …).`);
        return ok;
    });
}

/**
 * Is this node one a look of this scope covers? 'marks' is what draws data:
 * everything but the background (axes, grids, legends, titles), guides and
 * effect overlays.
 * @param {any} node @param {'marks' | 'frame'} scope
 * @returns {boolean}
 */
export function inScope(node, scope) {
    if (scope === 'frame') return true;
    return !node.background && !node.guide && !node.effect;
}

// ---- Shader looks ----------------------------------------------------------
// A shader look's `fragment` is GLSL ES 1.00 that defines `vec4 look(vec2 uv)`.
// It reads the painted chart from `u_frame` and returns the pixel at `uv`. Colour
// is premultiplied by alpha, in and out. Every renderer that runs shaders compiles
// the same source, built by `shaderSource`.

/** The vertex shader of the full-frame pass. `v_uv` runs 0..1, y up. */
export const SHADER_VERTEX = [
    'attribute vec2 a_pos;',
    'varying vec2 v_uv;',
    'void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }',
].join('\n');

// What every fragment can use, besides its own uniforms.
const SHADER_PRELUDE = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'varying vec2 v_uv;',
    // The painted chart, premultiplied alpha.
    'uniform sampler2D u_frame;',
    // The frame's size in device px, and device px per chart px.
    'uniform vec2 u_resolution;',
    'uniform float u_pixelRatio;',
    // The look's `seed`.
    'uniform float u_seed;',
    // uv <-> chart px (origin top-left, y down: the space marks are drawn in).
    'vec2 chartPx(vec2 uv) { return vec2(uv.x, 1.0 - uv.y) * u_resolution / u_pixelRatio; }',
    'vec2 toUv(vec2 px) { vec2 n = px * u_pixelRatio / u_resolution; return vec2(n.x, 1.0 - n.y); }',
    // Noise in 0..1: `hash` per point, `noise` smooth between whole numbers.
    'float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}',
].join('\n');

/** The names a look's own uniform may not take. */
const RESERVED_UNIFORM = /^(u_|gl_|webgl_|_webgl_)/;

/**
 * A look's uniforms, kept to what GLSL can declare: a number (float) or 2 to 4
 * numbers (vec2 / vec3 / vec4) under a plain identifier. Anything else warns.
 * @param {string} look the factory name, for the message
 * @param {any} uniforms
 * @returns {Record<string, number | number[]>}
 */
export function cleanUniforms(look, uniforms) {
    /** @type {Record<string, number | number[]>} */
    const out = {};
    for (const [name, value] of Object.entries(uniforms || {})) {
        const named = /^[A-Za-z][A-Za-z0-9_]*$/.test(name) && !RESERVED_UNIFORM.test(name);
        const numbers = Array.isArray(value) ? value : [value];
        const valued = numbers.length >= 1 && numbers.length <= 4 && numbers.every((n) => typeof n === 'number' && Number.isFinite(n));
        if (!named || !valued) {
            warn(
                `look:uniform:${look}:${name}`,
                `looks.${look}({ uniforms: { ${name}: … } }): a uniform is a number or 2 to 4 numbers, ` +
                'under a name of letters, digits and "_" that does not start with "u_" or "gl_"; ignored.',
            );
            continue;
        }
        out[name] = Array.isArray(value) ? value.slice() : value;
    }
    return out;
}

/**
 * The full fragment source for a shader look: the prelude, its uniforms, its
 * `look`, and `main`. Error line numbers count from the look's own first line.
 * @param {import('../types').Look} look
 * @returns {string}
 */
export function shaderSource(look) {
    const uniforms = Object.entries(look.uniforms || {}).map(([name, value]) =>
        `uniform ${Array.isArray(value) ? (value.length === 1 ? 'float' : `vec${value.length}`) : 'float'} ${name};`);
    return [
        SHADER_PRELUDE,
        ...uniforms,
        '#line 0',
        look.fragment || '',
        'void main() { gl_FragColor = look(v_uv); }',
    ].join('\n');
}
