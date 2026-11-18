// @ts-check
// Runs shader looks over a painted canvas. One WebGL context serves every chart
// on the page (a browser allows only a few), created the first time a look runs.
// The result is left on the shared GL canvas for the caller to draw back.
import { warn } from '../../core/dev.js';
import { SHADER_VERTEX, shaderSource } from '../../core/looks.js';

/** @type {HTMLCanvasElement | null} */
let canvas = null;
/** @type {WebGLRenderingContext | null} */
let gl = null;
// No WebGL here at all; asked once.
let unavailable = false;
let lost = false;

// Fragment source -> its program, or null for one that did not compile.
/** @type {Map<string, { program: WebGLProgram, uniforms: Map<string, WebGLUniformLocation | null> } | null>} */
const programs = new Map();
/** @type {WebGLBuffer | null} */
let quad = null;
/** @type {WebGLTexture | null} */
let input = null;
// Two targets to pass the image between looks.
/** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer, width: number, height: number }[]} */
let targets = [];

/** Does this browser have WebGL? What `supports.shaders` reports. */
export function canShade() {
    return typeof WebGLRenderingContext !== 'undefined';
}

/** Forget everything the context held: it is gone with the context. */
function forget() {
    programs.clear();
    quad = null;
    input = null;
    targets = [];
}

/** @returns {WebGLRenderingContext | null} */
function context() {
    if (unavailable) return null;
    if (!canvas) {
        canvas = document.createElement('canvas');
        // The browser may take the context back (GPU reset, too many contexts).
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; forget(); });
        canvas.addEventListener('webglcontextrestored', () => { lost = false; });
        gl = /** @type {WebGLRenderingContext | null} */ (canvas.getContext('webgl', {
            premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
        }));
        if (!gl) {
            unavailable = true;
            warn('looks:webgl', 'looks: this browser gave no WebGL context, so shader looks are skipped and the chart draws without them.');
            return null;
        }
    }
    if (lost || !gl || gl.isContextLost()) {
        warn('looks:webgl:lost', 'looks: the WebGL context was lost, so shader looks are skipped until the browser restores it.');
        return null;
    }
    return gl;
}

/**
 * @param {WebGLRenderingContext} g @param {number} type @param {string} source
 * @returns {{ shader: WebGLShader | null, log: string }}
 */
function compile(g, type, source) {
    const shader = g.createShader(type);
    if (!shader) return { shader: null, log: 'could not create a shader' };
    g.shaderSource(shader, source);
    g.compileShader(shader);
    if (g.getShaderParameter(shader, g.COMPILE_STATUS)) return { shader, log: '' };
    const log = g.getShaderInfoLog(shader) || 'unknown error';
    g.deleteShader(shader);
    return { shader: null, log };
}

/**
 * A look's program, compiled once. A look that does not compile warns once and
 * is skipped from then on.
 * @param {WebGLRenderingContext} g @param {import('../../types').Look} look
 */
function programOf(g, look) {
    if (!look.fragment) return null;
    const source = shaderSource(look);
    const known = programs.get(source);
    if (known !== undefined) return known;

    const vertex = compile(g, g.VERTEX_SHADER, SHADER_VERTEX);
    const fragment = compile(g, g.FRAGMENT_SHADER, source);
    const program = vertex.shader && fragment.shader ? g.createProgram() : null;
    let log = vertex.log || fragment.log;
    if (program && vertex.shader && fragment.shader) {
        g.attachShader(program, vertex.shader);
        g.attachShader(program, fragment.shader);
        g.bindAttribLocation(program, 0, 'a_pos');
        g.linkProgram(program);
        if (!g.getProgramParameter(program, g.LINK_STATUS)) log = g.getProgramInfoLog(program) || 'link failed';
    }
    if (!program || log) {
        warn(
            `looks:compile:${look.type}:${source.length}:${log}`,
            `looks.${look.type}(): the shader did not compile, so the look is skipped. ${log.replace(/\0/g, '').trim()}`,
        );
        programs.set(source, null);
        return null;
    }
    const made = { program, uniforms: new Map() };
    programs.set(source, made);
    return made;
}

/**
 * @param {WebGLRenderingContext} g
 * @returns {WebGLTexture | null} a texture that samples smoothly and never repeats
 */
function texture(g) {
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    return t;
}

/**
 * The target a pass draws into, sized to the frame.
 * @param {WebGLRenderingContext} g @param {number} i @param {number} width @param {number} height
 */
function target(g, i, width, height) {
    let t = targets[i];
    if (!t) {
        const tex = texture(g);
        const framebuffer = g.createFramebuffer();
        if (!tex || !framebuffer) return null;
        t = targets[i] = { texture: tex, framebuffer, width: 0, height: 0 };
        g.bindFramebuffer(g.FRAMEBUFFER, framebuffer);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, tex, 0);
    }
    if (t.width !== width || t.height !== height) {
        g.bindTexture(g.TEXTURE_2D, t.texture);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
        t.width = width;
        t.height = height;
    }
    return t;
}

/**
 * Run shader looks over `source`, in order. Returns the shared GL canvas holding
 * the result, to be drawn before the next call, or null when nothing ran (the
 * reason has been warned).
 * @param {HTMLCanvasElement} source the painted frame
 * @param {import('../../types').Look[]} looks shader looks
 * @param {{ pixelRatio: number }} frame device px per chart px
 * @returns {HTMLCanvasElement | null}
 */
export function shade(source, looks, frame) {
    const g = context();
    if (!g || !canvas) return null;
    const passes = looks.map((look) => ({ look, made: programOf(g, look) })).filter((p) => p.made);
    if (!passes.length) return null;

    const { width, height } = source;
    const limit = g.getParameter(g.MAX_TEXTURE_SIZE);
    if (width > limit || height > limit) {
        warn('looks:size', `looks: the chart is ${width}x${height} device px, past this GPU's ${limit}px texture limit, so shader looks are skipped.`);
        return null;
    }
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }

    // The painted frame as a texture, y up like everything else in GL.
    if (!input) input = texture(g);
    g.bindTexture(g.TEXTURE_2D, input);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, source);
    } catch {
        // A canvas that drew a cross-origin image cannot be read back.
        warn('looks:tainted', 'looks: the chart drew an image from another origin without CORS (a map tile, say), so its pixels cannot be read and shader looks are skipped.');
        return null;
    }

    if (!quad) {
        quad = g.createBuffer();
        g.bindBuffer(g.ARRAY_BUFFER, quad);
        g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    }
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.disable(g.BLEND);
    g.viewport(0, 0, width, height);
    g.activeTexture(g.TEXTURE0);

    let from = input;
    for (let i = 0; i < passes.length; i++) {
        const { look, made } = passes[i];
        if (!made) continue;
        const last = i === passes.length - 1;
        const into = last ? null : target(g, i % 2, width, height);
        if (!last && !into) return null;
        g.bindFramebuffer(g.FRAMEBUFFER, into ? into.framebuffer : null);
        g.clearColor(0, 0, 0, 0);
        g.clear(g.COLOR_BUFFER_BIT);
        g.useProgram(made.program);
        g.bindTexture(g.TEXTURE_2D, from);

        /** @param {string} name */
        const at = (name) => {
            if (!made.uniforms.has(name)) made.uniforms.set(name, g.getUniformLocation(made.program, name));
            return made.uniforms.get(name) || null;
        };
        g.uniform1i(at('u_frame'), 0);
        g.uniform2f(at('u_resolution'), width, height);
        g.uniform1f(at('u_pixelRatio'), frame.pixelRatio);
        g.uniform1f(at('u_seed'), look.seed != null ? look.seed : 0);
        for (const [name, value] of Object.entries(look.uniforms || {})) {
            const v = Array.isArray(value) ? value : [value];
            if (v.length === 1) g.uniform1f(at(name), v[0]);
            else if (v.length === 2) g.uniform2f(at(name), v[0], v[1]);
            else if (v.length === 3) g.uniform3f(at(name), v[0], v[1], v[2]);
            else g.uniform4f(at(name), v[0], v[1], v[2], v[3]);
        }
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
        if (into) from = into.texture;
    }
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return canvas;
}
