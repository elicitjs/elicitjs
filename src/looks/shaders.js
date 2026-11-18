// @ts-check
// The shader looks: a fragment shader over the painted chart. Each fragment
// defines `vec4 look(vec2 uv)` (see core/looks.js for what it can read). The
// built-ins keep any pixel within 4 chart px of where it was drawn, the hit
// tolerance, so what is drawn and what the pointer hits still agree.
import { color as d3color } from 'd3';
import { LOOK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { makeLook, warnUnknownLookOptions, numberOption, cleanUniforms } from '../core/looks.js';

// Wobbly, doubled lines and a pencil grain.
const SKETCH = `
vec2 wobble(vec2 p, float k) {
  return vec2(noise(p / 22.0 + k), noise(p / 22.0 + k + 31.7)) - 0.5
    + (vec2(noise(p / 6.0 + k + 7.3), noise(p / 6.0 + k + 51.9)) - 0.5) * 0.35;
}
vec4 look(vec2 uv) {
  vec2 p = chartPx(uv);
  vec4 a = texture2D(u_frame, toUv(p + wobble(p, u_seed) * amount * 2.0));
  // A second, fainter pass drawn a little off the first.
  vec4 b = texture2D(u_frame, toUv(p + wobble(p, u_seed + 113.0) * amount * 2.0));
  vec4 c = max(a, b * 0.4);
  float tooth = mix(noise(p * 1.3 + u_seed), hash(floor(p * 2.0) + u_seed), 0.5);
  return c * (1.0 - grain * tooth);
}`;

// Flat, saturated colour with an ink line where colour or coverage changes.
const CARTOON = `
float weight(vec2 p) {
  vec4 c = texture2D(u_frame, toUv(p));
  return dot(c.rgb, vec3(0.299, 0.587, 0.114)) + c.a;
}
vec4 look(vec2 uv) {
  vec2 p = chartPx(uv);
  vec4 c = texture2D(u_frame, uv);
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = clamp(mix(vec3(l), rgb, 1.25), 0.0, 1.0);
  rgb = floor(rgb * levels + 0.5) / levels;
  float tl = weight(p + vec2(-1.0, -1.0)); float tm = weight(p + vec2(0.0, -1.0)); float tr = weight(p + vec2(1.0, -1.0));
  float ml = weight(p + vec2(-1.0, 0.0)); float mr = weight(p + vec2(1.0, 0.0));
  float bl = weight(p + vec2(-1.0, 1.0)); float bm = weight(p + vec2(0.0, 1.0)); float br = weight(p + vec2(1.0, 1.0));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tm - tr + bl + 2.0 * bm + br;
  float edge = smoothstep(0.25, 0.9, length(vec2(gx, gy))) * outline;
  return mix(vec4(rgb * c.a, c.a), vec4(ink, 1.0), edge);
}`;

// A screen of dots: each cell takes the colour at its centre, sized by how dark it is.
const HALFTONE = `
vec4 look(vec2 uv) {
  vec2 p = chartPx(uv);
  float a = radians(angle);
  float s = sin(a); float k = cos(a);
  vec2 q = vec2(k * p.x - s * p.y, s * p.x + k * p.y);
  vec2 cell = (floor(q / size) + 0.5) * size;
  vec4 c = texture2D(u_frame, toUv(vec2(k * cell.x + s * cell.y, -s * cell.x + k * cell.y)));
  if (c.a <= 0.0) return vec4(0.0);
  vec3 rgb = c.rgb / c.a;
  float l = dot(rgb, vec3(0.299, 0.587, 0.114));
  float radius = sqrt(c.a * (1.0 - 0.55 * l)) * size * 0.7;
  float soft = 0.75 / u_pixelRatio;
  return vec4(rgb, 1.0) * (1.0 - smoothstep(radius - soft, radius + soft, length(q - cell)));
}`;

/**
 * A hand-drawn look in pixels: lines wobble and double, fills take a pencil grain.
 * @param {import('../types').SketchLookOptions} [options]
 * @returns {import('../types').Look}
 */
export function sketch(options = {}) {
    warnUnknownLookOptions('sketch', options, LOOK_OPTIONS.sketch);
    return makeLook('sketch', 'shader', options, {
        fragment: SKETCH,
        seed: numberOption('sketch', 'seed', options.seed, 1, -1e6, 1e6),
        uniforms: {
            // 2 keeps the furthest pixel inside the 4px hit tolerance.
            amount: numberOption('sketch', 'amount', options.amount, 1.2, 0, 2),
            grain: numberOption('sketch', 'grain', options.grain, 0.25, 0, 1),
        },
    });
}

/**
 * A cartoon look: flat colour in a few `levels`, and an ink `outline`.
 * @param {import('../types').CartoonLookOptions} [options]
 * @returns {import('../types').Look}
 */
export function cartoon(options = {}) {
    warnUnknownLookOptions('cartoon', options, LOOK_OPTIONS.cartoon);
    const parsed = options.ink != null ? d3color(options.ink) : null;
    if (options.ink != null && !parsed) {
        warn('lookopt:cartoon:ink', `looks.cartoon({ ink: ${JSON.stringify(options.ink)} }): not a colour; using the default ink.`);
    }
    const rgb = parsed ? parsed.rgb() : { r: 22, g: 22, b: 28 };
    return makeLook('cartoon', 'shader', options, {
        fragment: CARTOON,
        uniforms: {
            levels: numberOption('cartoon', 'levels', options.levels, 4, 2, 16),
            outline: numberOption('cartoon', 'outline', options.outline, 1, 0, 1),
            ink: [rgb.r / 255, rgb.g / 255, rgb.b / 255],
        },
    });
}

/**
 * A halftone look: the chart as a screen of dots `size` px apart, turned by `angle`.
 * @param {import('../types').HalftoneLookOptions} [options]
 * @returns {import('../types').Look}
 */
export function halftone(options = {}) {
    warnUnknownLookOptions('halftone', options, LOOK_OPTIONS.halftone);
    return makeLook('halftone', 'shader', options, {
        fragment: HALFTONE,
        uniforms: {
            size: numberOption('halftone', 'size', options.size, 5, 2, 40),
            angle: numberOption('halftone', 'angle', options.angle, 30, -360, 360),
        },
    });
}

/**
 * Your own shader look. `fragment` is GLSL ES 1.00 that defines
 * `vec4 look(vec2 uv)`: the pixel at `uv`, read from `u_frame`.
 * @param {string} fragment
 * @param {import('../types').CustomLookOptions} [options]
 * @returns {import('../types').Look}
 */
export function custom(fragment, options = {}) {
    warnUnknownLookOptions('custom', options, LOOK_OPTIONS.custom);
    const valid = typeof fragment === 'string' && /\blook\s*\(/.test(fragment);
    if (!valid) {
        warn(
            'look:custom:fragment',
            'looks.custom(fragment): the fragment is GLSL source that defines `vec4 look(vec2 uv)`, ' +
            'for example "vec4 look(vec2 uv) { return texture2D(u_frame, uv); }". The look is skipped.',
        );
    }
    return makeLook('custom', 'shader', options, {
        fragment: valid ? fragment : null,
        seed: numberOption('custom', 'seed', options.seed, 1, -1e6, 1e6),
        uniforms: cleanUniforms('custom', options.uniforms),
    });
}
