// @ts-check
// motion.js — eased drawing. Anything the engine draws can ease toward where it
// belongs: a client opens a track, hands it the pixel values a render should
// arrive at, and gets back values part-way there. The engine keeps rendering
// until every track has arrived. Only the drawing is eased: the data,
// `getData()` and `onChange` never see a value in between.
//
// Two clients. The hierarchy's layout eases ROWS before `build()` (`easeRows`,
// engine/render.js `liveTables`): the eased value is a real value of its column.
// A mark with `motion: true` eases its NODES after `build()` (`easeNodes`,
// engine/carry.js): a discrete scale has nothing between two slots.

import { warn } from './dev.js';

/** How long a change takes to settle, in ms. */
const DEFAULT_DURATION = 220;

/** Closer than this to its goal (px), and slower than REST_SPEED (px/s), a value has arrived. */
const REST = 0.25;
const REST_SPEED = 5;

/** The longest step one frame takes, in ms (a background tab comes back late). */
const MAX_STEP = 64;

/** The first step after a rest, in ms: the clock is stale, so it is one frame. */
const FIRST_STEP = 16;

const MOTION_KEYS = ['duration'];

/**
 * `spec.motion` as a duration in ms, or 0 for none. Off when the author says so
 * and when the reader asked the system for reduced motion.
 * @param {any} option
 * @returns {number}
 */
export function resolveMotion(option) {
    if (option === false) return 0;
    let duration = DEFAULT_DURATION;
    if (option && typeof option === 'object') {
        for (const key of Object.keys(option)) {
            if (!MOTION_KEYS.includes(key)) {
                warn(`motion:option:${key}`, `spec.motion has no "${key}" option. It takes: ${MOTION_KEYS.join(', ')}.`);
            }
        }
        if (option.duration !== undefined) {
            if (typeof option.duration === 'number' && option.duration >= 0) duration = option.duration;
            else warn('motion:duration', 'spec.motion.duration must be a number of milliseconds, 0 or more.');
        }
    } else if (option !== undefined && option !== true) {
        warn('motion:type', 'spec.motion is `false` or `{ duration }`.');
    }
    const reduced = typeof matchMedia === 'function'
        && !!matchMedia('(prefers-reduced-motion: reduce)').matches;
    return reduced ? 0 : duration;
}

/**
 * One step of a critically damped ease toward a goal. It keeps its velocity, so
 * a goal that changes mid-flight (every pointer move) bends the motion instead
 * of restarting it.
 * @param {number} x @param {number} v @param {number} goal
 * @param {number} time seconds to settle @param {number} dt seconds
 * @returns {{ x: number, v: number }}
 */
function damp(x, v, goal, time, dt) {
    const omega = 6 / time;
    const k = omega * dt;
    const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
    const change = x - goal;
    const temp = (v + omega * change) * dt;
    return { x: goal + (change + temp) * decay, v: (v - omega * temp) * decay };
}

/**
 * @typedef {object} StepOptions
 * @property {boolean} [snap]  arrive at once (the goals are not comparable with the last ones)
 * @property {(key: any) => boolean} [fixed]  keys that are never eased (what the pointer carries)
 * @property {(key: any) => Record<string, number> | null | undefined} [carried]
 *   values to draw a key at instead of its goal: never eased, and where it eases from once let go
 * @property {(key: any, was: Record<string, number>, goal: Record<string, number>) => number} [slow]
 *   a factor on the duration for one key
 *
 * @typedef {object} Track
 * @property {(goals: Map<any, Record<string, number>>, options?: StepOptions) => Map<any, Record<string, number>>} step
 *   The values to draw this frame for each key, on their way to `goals`.
 *   A key seen for the first time starts at its goal.
 * @property {(key: any) => boolean} arrived  was this key drawn at its goal on the last step?
 *
 * @typedef {object} Motion
 * @property {() => void} begin  start a frame: every track steps by the same time
 * @property {(name: string) => Track} track  a named group of keyed values, kept between frames
 * @property {() => boolean} moving  did any track stop short of its goals this frame?
 */

/**
 * @param {number} duration ms to settle
 * @returns {Motion}
 */
export function createMotion(duration) {
    /** @type {Map<string, Track>} */
    const tracks = new Map();
    let lastTime = 0;
    let dt = 0;
    let moving = false;
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

    const begin = () => {
        const t = now();
        // Nothing was moving: most of the time since the last frame was a wait, not a step.
        dt = Math.min(Math.max(t - lastTime, 0), moving ? MAX_STEP : FIRST_STEP) / 1000;
        lastTime = t;
        moving = false;
    };

    /** @returns {Track} */
    const makeTrack = () => {
        /** @type {Map<any, Record<string, { x: number, v: number }>>} */
        let state = new Map();
        /** Keys drawn short of their goal on the last step. @type {Set<any>} */
        let short = new Set();
        return {
            arrived: (key) => !short.has(key),
            step(goals, { snap = false, fixed, slow, carried } = {}) {
                /** @type {typeof state} */
                const next = new Map();
                /** @type {Map<any, Record<string, number>>} */
                const out = new Map();
                short = new Set();
                for (const [key, goal] of goals) {
                    const was = snap ? undefined : state.get(key);
                    const held = !was || !!(fixed && fixed(key));
                    const hand = carried ? carried(key) : null;
                    /** @type {Record<string, number>} */
                    const from = {};
                    if (was) for (const name of Object.keys(was)) from[name] = was[name].x;
                    const time = (duration * (!held && slow ? slow(key, from, goal) : 1)) / 1000;
                    /** @type {Record<string, { x: number, v: number }>} */
                    const at = {};
                    /** @type {Record<string, number>} */
                    const drawn = {};
                    for (const name of Object.keys(goal)) {
                        const g = goal[name];
                        const p = was && was[name];
                        let s = { x: g, v: 0 };
                        if (hand && hand[name] !== undefined) {
                            // In the hand: drawn where it is held. Not `moving`, since
                            // the pointer's own events redraw it.
                            s = { x: hand[name], v: 0 };
                            if (Math.abs(s.x - g) >= REST) short.add(key);
                        } else if (p && !held) {
                            const d = damp(p.x, p.v, g, time, dt);
                            if (Math.abs(d.x - g) >= REST || Math.abs(d.v) >= REST_SPEED) { s = d; moving = true; short.add(key); }
                        }
                        at[name] = s;
                        drawn[name] = s.x;
                    }
                    next.set(key, at);
                    out.set(key, drawn);
                }
                state = next;
                return out;
            },
        };
    };

    return {
        begin,
        track(name) {
            let t = tracks.get(name);
            if (!t) { t = makeTrack(); tracks.set(name, t); }
            return t;
        },
        moving: () => moving,
    };
}

/**
 * Ease a table's rows: each column in `columns` is drawn part-way to the row's
 * value, in pixels through the column's own scale. Returns `rows` itself once
 * every row has arrived; otherwise only rows still moving are new objects.
 * @param {Track} track
 * @param {any[]} rows the rows a render should arrive at
 * @param {{ field: string, encode: (v: any) => number, invert: (px: number) => any }[]} columns
 * @param {{ keyOf: (row: any, i: number) => any, snap?: boolean, fixed?: (i: number) => boolean,
 *   slow?: (i: number, was: Record<string, number>, goal: Record<string, number>) => number }} options
 * @returns {any[]}
 */
export function easeRows(track, rows, columns, { keyOf, snap, fixed, slow }) {
    /** @type {Map<any, Record<string, number>>} */
    const goals = new Map();
    /** @type {Map<any, number>} */
    const indexOf = new Map();
    rows.forEach((row, i) => {
        if (!row) return;
        /** @type {Record<string, number>} */
        const goal = {};
        for (const c of columns) {
            const px = c.encode(row[c.field]);
            if (Number.isFinite(px)) goal[c.field] = px;
        }
        const key = keyOf(row, i);
        goals.set(key, goal);
        indexOf.set(key, i);
    });
    const at = (/** @type {any} */ key) => /** @type {number} */ (indexOf.get(key));
    const drawn = track.step(goals, {
        snap,
        fixed: fixed ? (key) => fixed(at(key)) : undefined,
        slow: slow ? (key, was, goal) => slow(at(key), was, goal) : undefined,
    });
    let out = rows;
    for (const [key, values] of drawn) {
        const goal = /** @type {Record<string, number>} */ (goals.get(key));
        /** @type {Record<string, any> | null} */
        let patch = null;
        for (const c of columns) {
            if (values[c.field] === undefined || values[c.field] === goal[c.field]) continue;
            (patch || (patch = {}))[c.field] = c.invert(values[c.field]);
        }
        if (!patch) continue;
        if (out === rows) out = rows.slice();
        out[at(key)] = { ...rows[at(key)], ...patch };
    }
    return out;
}

/**
 * The numbers that place each scene primitive. A path has no entry: its position
 * is baked into `d`. One that says how it was placed (`node.placed`, a `shape`)
 * eases by its centre and is redrawn there; any other path is drawn at once.
 * @type {Record<string, string[]>}
 */
export const NODE_GEOMETRY = {
    rect: ['x', 'y', 'width', 'height'],
    image: ['x', 'y', 'width', 'height'],
    circle: ['cx', 'cy', 'r'],
    ellipse: ['cx', 'cy', 'rx', 'ry'],
    line: ['x1', 'y1', 'x2', 'y2'],
    text: ['x', 'y'],
};

/** A placed path moves by its centre. */
const PLACED = ['cx', 'cy'];

/**
 * The fields that place this node, or undefined when it cannot be eased.
 * @param {any} node @returns {string[] | undefined}
 */
export function geometryOf(node) {
    if (!node) return undefined;
    return NODE_GEOMETRY[node.type] || (node.placed ? PLACED : undefined);
}

/** Which axis a geometry field runs along; sizes have none. @type {Record<string, 'x' | 'y'>} */
const FIELD_AXIS = { x: 'x', cx: 'x', x1: 'x', x2: 'x', y: 'y', cy: 'y', y1: 'y', y2: 'y' };

/** Move whatever is drawn about a node (its edit box, its outline shape) with it. */
const SATELLITES = ['editBox', 'effectShape'];

/**
 * Ease built nodes: each is drawn part-way from where it was last drawn to where
 * `build()` just put it. Mutates the nodes, so hit-testing, effects and both
 * renderers see the eased geometry. Only nodes `geometryOf` can place move.
 * @param {Track} track
 * @param {any[]} nodes the nodes one feature built this frame
 * @param {{ keyOf: (node: any, n: number) => any, snap?: boolean,
 *   fixed?: (node: any) => boolean,
 *   shift?: (node: any) => { x?: number, y?: number } | null | undefined,
 *   redraw?: (node: any) => void }} options
 *   `shift`: draw this node that far from its goal (the pointer carries it).
 *   `redraw`: a moved node whose shape is baked from its position (`node.placed`)
 * @returns {Set<any>} the nodes drawn short of their goal this frame
 */
export function easeNodes(track, nodes, { keyOf, snap, fixed, shift, redraw }) {
    /** @type {Map<any, Record<string, number>>} */
    const goals = new Map();
    /** @type {Map<any, any>} */
    const nodeOf = new Map();
    /** @type {Map<any, Record<string, number>>} */
    const held = new Map();
    nodes.forEach((node, n) => {
        const fields = geometryOf(node);
        if (!fields) return;
        /** @type {Record<string, number>} */
        const goal = {};
        for (const f of fields) if (Number.isFinite(node[f])) goal[f] = node[f];
        const key = keyOf(node, n);
        goals.set(key, goal);
        nodeOf.set(key, node);
        const by = shift ? shift(node) : null;
        if (by) {
            /** @type {Record<string, number>} */
            const at = {};
            for (const f of Object.keys(goal)) {
                const axis = FIELD_AXIS[f];
                at[f] = goal[f] + ((axis && by[axis]) || 0);
            }
            held.set(key, at);
        }
    });
    const drawn = track.step(goals, {
        snap,
        fixed: fixed ? (key) => fixed(nodeOf.get(key)) : undefined,
        carried: held.size ? (key) => held.get(key) : undefined,
    });
    /** @type {Set<any>} */
    const short = new Set();
    for (const [key, values] of drawn) {
        const node = nodeOf.get(key);
        const goal = /** @type {Record<string, number>} */ (goals.get(key));
        let dx = 0, dy = 0;
        for (const f of Object.keys(values)) {
            if (values[f] === goal[f]) continue;
            // The first position field on each axis says how far the node moved.
            if (FIELD_AXIS[f] === 'x' && !dx) dx = values[f] - goal[f];
            if (FIELD_AXIS[f] === 'y' && !dy) dy = values[f] - goal[f];
            node[f] = values[f];
        }
        if ((dx || dy) && node.placed && redraw) redraw(node);
        if (dx || dy) {
            for (const name of SATELLITES) {
                const part = node[name];
                if (!part || typeof part !== 'object') continue;
                const moved = { ...part };
                for (const f of Object.keys(FIELD_AXIS)) {
                    if (Number.isFinite(moved[f])) moved[f] += FIELD_AXIS[f] === 'x' ? dx : dy;
                }
                node[name] = moved;
            }
        }
        if (!track.arrived(key)) short.add(node);
    }
    return short;
}
