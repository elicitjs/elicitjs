// @ts-check
// motion.js — eased drawing. Anything the engine draws can ease toward where it
// belongs: a client opens a track, hands it the pixel values a render should
// arrive at, and gets back values part-way there. The engine keeps rendering
// until every track has arrived. Only the drawing is eased: the data,
// `getData()` and `onChange` never see a value in between.
//
// The first client is the hierarchy's layout (engine/render.js, `liveTables`).

import { warn } from './dev.js';

/** How long a change takes to settle, in ms. */
const DEFAULT_DURATION = 220;

/** Closer than this to its goal (px), and slower than REST_SPEED (px/s), a value has arrived. */
const REST = 0.25;
const REST_SPEED = 5;

/** The longest step one frame takes, in ms (a background tab comes back late). */
const MAX_STEP = 64;

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
 * @property {(key: any, was: Record<string, number>, goal: Record<string, number>) => number} [slow]
 *   a factor on the duration for one key
 *
 * @typedef {object} Track
 * @property {(goals: Map<any, Record<string, number>>, options?: StepOptions) => Map<any, Record<string, number>>} step
 *   The values to draw this frame for each key, on their way to `goals`.
 *   A key seen for the first time starts at its goal.
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
        dt = Math.min(Math.max(t - lastTime, 0), MAX_STEP) / 1000;
        lastTime = t;
        moving = false;
    };

    /** @returns {Track} */
    const makeTrack = () => {
        /** @type {Map<any, Record<string, { x: number, v: number }>>} */
        let state = new Map();
        return {
            step(goals, { snap = false, fixed, slow } = {}) {
                /** @type {typeof state} */
                const next = new Map();
                /** @type {Map<any, Record<string, number>>} */
                const out = new Map();
                for (const [key, goal] of goals) {
                    const was = snap ? undefined : state.get(key);
                    const held = !was || !!(fixed && fixed(key));
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
                        if (p && !held) {
                            const d = damp(p.x, p.v, g, time, dt);
                            if (Math.abs(d.x - g) >= REST || Math.abs(d.v) >= REST_SPEED) { s = d; moving = true; }
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
