// @ts-check
// designs.js — how the survey widgets are drawn.
//
// A design is a set of small drawers, each for one part: an option, the answer
// inside it, a slider's track, a ranking card, a bar. Every widget asks the
// design named by `theme.widget.design` for its parts and composes them, so a
// new design restyles all of them at once and a widget never branches on a
// design's name.
//
//   authoring.registerDesign('pill', {
//     extends: 'box',                                  // take the rest from `box`
//     option: (o, t) => [...],                         // nodes for one option
//     theme: { widget: { accent: '#0f766e', corner: 20 } },   // `theme: 'pill'`
//   });
//
// A drawer takes the box to draw in and the widget tokens, and returns scene
// nodes in plot pixels. Colours and sizes come from the tokens, never literals,
// so a theme can change them.

import { warn } from '../core/dev.js';
import { measureBlock } from '../core/measure.js';
import { themes } from '../core/themes.js';
import { DEFAULT_THEME } from '../core/theme.js';

/** What a design may state. @type {string[]} */
const DESIGN_KEYS = ['extends', 'list', 'tiles', 'option', 'answer', 'grid', 'track', 'thumb', 'card', 'slots', 'bar', 'theme'];

/** The two grips a card part may name: six dots in two columns, and three bars. */
const dot = (/** @type {number} */ x, /** @type {number} */ y) =>
    `M${x - 1.6},${y}a1.6,1.6 0 1,0 3.2,0a1.6,1.6 0 1,0 -3.2,0Z`;
/** @type {Record<string, string>} */
export const GRIPS = {
    dots: [0, 6].map((x) => [0, 6, 12].map((y) => dot(x, y)).join('')).join(''),
    bars: [0, 5, 10].map((y) => `M0,${y}h18v1.6h-18Z`).join(''),
};

// ── node helpers, for design authors ──────────────────────────────────────────

/**
 * A label centred on (x, y), wrapped to `width` when given.
 * @param {any} text @param {number} x @param {number} y
 * @param {import('../types').WidgetTokens} t
 * @param {{ width?: number, anchor?: 'start' | 'middle' | 'end', fill?: string,
 *   fontSize?: number, fontWeight?: number | string }} [o]
 * @returns {import('../types').FeatureNode}
 */
export function labelNode(text, x, y, t, o = {}) {
    const fontSize = o.fontSize != null ? o.fontSize : t.labelSize;
    /** @type {any} */
    const node = {
        type: 'text', x, y, text: String(text),
        textAnchor: o.anchor || 'middle', lineAnchor: 'middle', dominantBaseline: 'central',
        fontSize, fill: o.fill != null ? o.fill : t.label,
    };
    if (o.fontWeight != null) node.fontWeight = o.fontWeight;
    if (o.width && o.width > 0) {
        const block = measureBlock(String(text), { maxWidth: o.width, fontSize, fontWeight: o.fontWeight });
        if (block.lines.length > 1) { node.lines = block.lines; node.lineHeight = block.lineHeight; }
    }
    return node;
}

/**
 * A tick, centred on (cx, cy), drawn on the accent.
 * @param {number} cx @param {number} cy @param {import('../types').WidgetTokens} t
 * @returns {import('../types').FeatureNode}
 */
export function checkNode(cx, cy, t) {
    return /** @type {any} */ ({
        type: 'path', d: `M${cx - 4.5},${cy}l3.2,3.2l5.8,-6.6`,
        fill: 'none', stroke: t.onAccent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    });
}

/**
 * An empty control: a radio's ring or a checkbox's square, centred on (cx, cy).
 * The answer's ink is a mark drawn over it (`answer`).
 * @param {number} cx @param {number} cy @param {'radio' | 'check'} control
 * @param {boolean} selected @param {import('../types').WidgetTokens} t
 * @returns {import('../types').FeatureNode[]}
 */
export function controlNodes(cx, cy, control, selected, t) {
    const r = t.radius;
    if (control === 'check') {
        return /** @type {any[]} */ ([
            { type: 'rect', x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, rx: r / 2,
                fill: t.surface, stroke: selected ? t.accent : t.ring, strokeWidth: 1.5 },
            ...(selected ? [checkNode(cx, cy + 0.5, t)] : []),
        ]);
    }
    return /** @type {any[]} */ ([{
        type: 'circle', cx, cy, r, fill: 'none',
        stroke: selected ? t.accent : t.ring, strokeWidth: selected ? 2 : 1.5,
    }]);
}

/** The control's centre inside an option box. @param {any} o @param {any} t */
const controlAt = (o, t) => (o.layout === 'list'
    ? { x: o.x + 14 + t.radius, y: o.cy }
    : o.layout === 'cell' ? { x: o.cx, y: o.cy } : { x: o.cx, y: o.y + 14 + t.radius });

/** A text label for an option whose control sits at `controlAt`. @param {any} o @param {any} t @param {any} [style] */
const optionLabel = (o, t, style = {}) => {
    if (o.layout === 'cell') return [];
    if (o.layout === 'list') {
        return [labelNode(o.label, o.x + 26 + 2 * t.radius, o.cy, t, {
            anchor: 'start', fontSize: t.itemSize, width: o.width - 40 - 2 * t.radius, ...style,
        })];
    }
    const top = o.y + 14 + 2 * t.radius;
    return [labelNode(o.label, o.cx, (top + o.y + o.height) / 2, t, { width: o.width - 8, ...style })];
};

// ── the four built-in designs ─────────────────────────────────────────────────

/**
 * `ring`: rings on a track; the answer is a filled dot. The look the widgets
 * have always had, and the base every other design starts from.
 * @type {import('../types').WidgetDesign}
 */
const ring = {
    list: false,
    tiles: false,
    option: (o, t) => {
        /** @type {any[]} */
        const nodes = [];
        if (o.layout === 'cell') {
            nodes.push({ type: 'rect', x: o.x, y: o.y, width: o.width, height: o.height,
                fill: t.cellFill, stroke: t.cellStroke, strokeWidth: 1 });
            return nodes;
        }
        if (o.layout === 'list') {
            const at = controlAt(o, t);
            nodes.push({ type: 'circle', cx: at.x, cy: at.y, r: t.radius, fill: 'none', stroke: t.ring, strokeWidth: 1.5 });
            nodes.push(...optionLabel(o, t));
            return nodes;
        }
        // Track segments between rings, so no line crosses an unfilled ring.
        if (o.next) {
            nodes.push({ type: 'line', x1: o.cx + t.radius, y1: o.cy, x2: o.next.cx - t.radius, y2: o.cy,
                stroke: t.track, strokeWidth: 3, background: true });
        }
        nodes.push({ type: 'circle', cx: o.cx, cy: o.cy, r: t.radius, fill: 'none', stroke: t.ring, strokeWidth: 1.5 });
        nodes.push({ type: 'text', x: o.cx, y: o.cy + o.labelOffset, text: String(o.label),
            textAnchor: 'middle', fontSize: t.labelSize, fill: t.label });
        return nodes;
    },
    answer: (o, t) => (o.layout === 'list'
        ? { shape: 'dot', size: t.radius - 3, left: 14 + t.radius }
        : { shape: 'dot', size: t.radius - 3 }),
    grid: () => [],
    track: (s, t) => /** @type {any[]} */ ([
        { type: 'line', x1: s.x1, y1: s.y, x2: s.x2, y2: s.y, stroke: t.track, strokeWidth: 4, background: true },
        { type: 'line', x1: s.x1, y1: s.y - 7, x2: s.x1, y2: s.y + 7, stroke: t.ring, strokeWidth: 2 },
        { type: 'line', x1: s.x2, y1: s.y - 7, x2: s.x2, y2: s.y + 7, stroke: t.ring, strokeWidth: 2 },
    ]),
    thumb: (t) => ({ size: t.radius - 2, fill: t.accent }),
    card: (c, t) => [
        { part: 'body', fill: t.surface, stroke: t.stroke, strokeWidth: 1, size: t.corner,
            hovered: { stroke: t.grip },
            grabbed: { stroke: t.accent, strokeWidth: 1.5, filter: `drop-shadow(0 6px 9px ${t.shadow})` } },
        { part: 'badge', left: 24, size: 11, fill: t.accent },
        { part: 'rank', left: 24, textAnchor: 'middle', fill: t.onAccent, fontSize: 11.5, fontWeight: 600 },
        { part: 'label', left: 46, fill: t.question, fontSize: t.itemSize, fontWeight: 500 },
        { part: 'grip', right: 21, size: 7.6, fill: t.grip, path: 'dots' },
    ],
    slots: () => [],
    bar: () => ({}),
};

/**
 * `box`: each option is an outlined box holding a radio or a checkbox.
 * @type {import('../types').WidgetDesign}
 */
const box = {
    list: true,
    tiles: true,
    option: (o, t) => {
        if (o.layout === 'cell') return controlNodes(o.cx, o.cy, o.control, o.selected, t);
        const at = controlAt(o, t);
        return /** @type {any[]} */ ([
            { type: 'rect', x: o.x, y: o.y, width: o.width, height: o.height, rx: t.corner,
                fill: o.selected ? t.tint : t.surface,
                stroke: o.selected ? t.accent : t.stroke, strokeWidth: o.selected ? 2 : 1 },
            ...controlNodes(at.x, at.y, o.control, o.selected, t),
            ...optionLabel(o, t, o.selected ? { fill: t.question, fontWeight: 600 } : {}),
        ]);
    },
    answer: (o, t) => {
        const ink = o.control === 'check'
            ? { shape: /** @type {const} */ ('square'), size: t.radius, corner: t.radius / 2 }
            : { shape: /** @type {const} */ ('dot'), size: t.radius / 2 };
        if (o.layout === 'list') return { ...ink, left: 14 + t.radius };
        if (o.layout === 'row') return { ...ink, top: 14 + t.radius };
        return ink;
    },
    grid: (g, t) => /** @type {any[]} */ ([
        { type: 'rect', x: g.x, y: g.y, width: g.width, height: g.height, rx: t.corner,
            fill: t.surface, stroke: t.stroke, strokeWidth: 1 },
        ...g.rows.slice(1, -1).map((y) => ({ type: 'line', x1: g.x, y1: y, x2: g.x + g.width, y2: y,
            stroke: t.track, strokeWidth: 1 })),
    ]),
    track: (s, t) => /** @type {any[]} */ ([
        { type: 'rect', x: s.x1, y: s.y - 3, width: s.x2 - s.x1, height: 6, rx: 3, fill: t.track },
        ...(s.at != null ? [{ type: 'rect', x: s.x1, y: s.y - 3, width: Math.max(0, s.at - s.x1), height: 6, rx: 3, fill: t.accent }] : []),
    ]),
    thumb: (t) => ({ size: 10, fill: t.surface, stroke: t.accent, strokeWidth: 2.5 }),
    card: (c, t) => [
        { part: 'body', fill: t.surface, stroke: t.stroke, strokeWidth: 1, size: t.corner,
            hovered: { stroke: t.grip },
            grabbed: { stroke: t.accent, strokeWidth: 1.5, filter: `drop-shadow(0 6px 9px ${t.shadow})` } },
        { part: 'grip', left: 17, size: 7.6, fill: t.grip, path: 'dots' },
        { part: 'rank', left: 34, fill: t.accent, fontSize: 12.5, fontWeight: 600 },
        { part: 'label', left: 54, fill: t.question, fontSize: t.itemSize, fontWeight: 500 },
    ],
    bar: (t) => ({ corner: Math.min(5, t.corner), fillOpacity: 1 }),
};

/**
 * `block`: options are soft blocks, and the chosen one turns solid.
 * @type {import('../types').WidgetDesign}
 */
const block = {
    extends: 'box',
    option: (o, t) => {
        /** @type {any[]} */
        const nodes = [{ type: 'rect', x: o.x, y: o.y, width: o.width, height: o.height, rx: t.corner, fill: t.soft }];
        if (o.layout === 'cell') {
            if (o.selected) nodes.push(checkNode(o.cx, o.cy + 0.5, t));
            return nodes;
        }
        const style = o.selected ? { fill: t.onAccent, fontWeight: 600 } : {};
        if (o.layout === 'list') {
            nodes.push(labelNode(o.label, o.x + 14, o.cy, t, { anchor: 'start', fontSize: t.itemSize, width: o.width - 52, ...style }));
            if (o.selected && o.control === 'check') nodes.push(checkNode(o.x + o.width - 20, o.cy + 0.5, t));
        } else {
            nodes.push(labelNode(o.label, o.cx, o.cy, t, { width: o.width - 8, ...style }));
        }
        return nodes;
    },
    answer: (o, t) => ({ shape: 'block', corner: t.corner }),
    grid: () => [],
    track: (s, t) => /** @type {any[]} */ ([
        { type: 'rect', x: s.x1, y: s.y - 7, width: s.x2 - s.x1, height: 14, rx: 7, fill: t.soft },
        ...(s.at != null ? [{ type: 'rect', x: s.x1, y: s.y - 7, width: Math.max(0, s.at - s.x1), height: 14, rx: 7, fill: t.accent }] : []),
    ]),
    thumb: (t) => ({ size: 11, fill: t.accent, stroke: t.surface, strokeWidth: 3 }),
    card: (c, t) => [
        { part: 'body', fill: t.soft, stroke: 'none', strokeWidth: 0, size: t.corner,
            hovered: { fill: t.track },
            grabbed: { fill: t.tint, stroke: t.accent, strokeWidth: 1.5, filter: `drop-shadow(0 6px 9px ${t.shadow})` } },
        { part: 'rank', left: 16, fill: t.label, fontSize: 12.5, fontWeight: 600 },
        { part: 'label', left: 38, fill: t.question, fontSize: t.itemSize, fontWeight: 500 },
        { part: 'grip', right: 21, size: 7.6, fill: t.grip, path: 'dots' },
    ],
    bar: (t) => ({ corner: Math.min(7, t.corner), fillOpacity: 1, track: true }),
};

/**
 * `line`: controls and hairlines; nothing is boxed.
 * @type {import('../types').WidgetDesign}
 */
const line = {
    extends: 'box',
    option: (o, t) => {
        if (o.layout === 'cell') return controlNodes(o.cx, o.cy, o.control, o.selected, t);
        const at = controlAt(o, t);
        /** @type {any[]} */
        const nodes = [
            ...controlNodes(at.x, at.y, o.control, o.selected, t),
            ...optionLabel(o, t, o.selected ? { fill: t.question, fontWeight: 600 } : {}),
        ];
        const rule = (/** @type {number} */ y) => ({ type: 'line', x1: o.x, y1: y, x2: o.x + o.width, y2: y,
            stroke: t.track, strokeWidth: 1, background: true });
        if (o.layout === 'list') {
            // A hairline under each row, and one over the first.
            if (o.index === 0) nodes.push(rule(o.y));
            nodes.push(rule(o.y + o.height));
        } else {
            nodes.push(rule(o.y), rule(o.y + o.height));
        }
        return nodes;
    },
    grid: (g, t) => g.rows.map((y) => /** @type {any} */ ({ type: 'line', x1: g.x, y1: y, x2: g.x + g.width, y2: y,
        stroke: t.track, strokeWidth: 1, background: true })),
    track: (s, t) => /** @type {any[]} */ ([
        { type: 'line', x1: s.x1, y1: s.y, x2: s.x2, y2: s.y, stroke: t.ring, strokeWidth: 1.5, background: true },
        ...[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const x = s.x1 + (s.x2 - s.x1) * f;
            return { type: 'line', x1: x, y1: s.y - 4, x2: x, y2: s.y + 4, stroke: t.ring, strokeWidth: 1.5, background: true };
        }),
    ]),
    thumb: (t) => ({ size: 6.5, fill: t.accent }),
    card: (c, t) => [
        { part: 'body', fill: 'transparent', stroke: 'none', strokeWidth: 0, size: t.corner,
            hovered: { fill: t.soft },
            grabbed: { fill: t.surface, stroke: t.ring, strokeWidth: 1, filter: `drop-shadow(0 6px 9px ${t.shadow})` } },
        { part: 'rank', left: 10, fill: t.label, fontSize: 12.5, fontWeight: 600 },
        { part: 'label', left: 32, fill: t.question, fontSize: t.itemSize, fontWeight: 500 },
        { part: 'grip', right: 19, size: 9, fill: t.grip, path: 'bars' },
    ],
    slots: (l, t) => l.rows.map((y) => /** @type {any} */ ({ type: 'line', x1: l.x, y1: y, x2: l.x + l.width, y2: y,
        stroke: t.track, strokeWidth: 1, background: true })),
    bar: () => ({ fillOpacity: 1 }),
};

// ── the registry ─────────────────────────────────────────────────────────────

/** @type {Map<string, import('../types').WidgetDesign>} */
const registry = new Map([['ring', ring], ['box', box], ['block', block], ['line', line]]);
/** The built-in theme names, which a design's own theme may not replace. */
const BUILT_IN_THEMES = new Set(Object.keys(themes));

/**
 * Register a widget design under `name`, so `theme.widget.design: name` draws
 * the widgets with it. State only the parts that differ: the rest come from
 * `extends` (default `'ring'`). With `theme`, the design also registers a named
 * theme, so `theme: name` selects the design and its tokens in one word.
 * @param {string} name
 * @param {import('../types').WidgetDesign} design
 * @returns {void}
 */
export function registerDesign(name, design) {
    if (typeof name !== 'string' || !name) {
        warn('design:name', 'registerDesign(name, design): `name` must be a non-empty string.');
        return;
    }
    if (!design || typeof design !== 'object') {
        warn(`design:shape:${name}`, `registerDesign("${name}", design): \`design\` must be an object of drawers.`);
        return;
    }
    for (const key of Object.keys(design)) {
        if (!DESIGN_KEYS.includes(key)) {
            warn(`design:key:${name}:${key}`,
                `registerDesign("${name}"): "${key}" is not a part a design draws, so it is ignored. `
                + `A design may state: ${DESIGN_KEYS.join(', ')}.`);
        }
    }
    registry.set(name, design);
    if (design.theme) {
        if (BUILT_IN_THEMES.has(name)) {
            warn(`design:theme:${name}`,
                `registerDesign("${name}"): "${name}" is a built-in theme, so the design's theme is not registered. `
                + `Name the design in a theme of your own: { extends: "${name}", widget: { design: "${name}" } }.`);
        } else {
            const widget = { ...(/** @type {any} */ (design.theme).widget || {}), design: name };
            /** @type {any} */ (themes)[name] = { ...design.theme, widget };
        }
    }
}

/**
 * A registered design with its `extends` chain folded in, so every part is there.
 * An unknown name warns and gives `ring`.
 * @param {string} name
 * @returns {import('../types').ResolvedWidgetDesign}
 */
export function designOf(name) {
    const key = name || 'ring';
    if (!registry.has(key)) {
        warn(`design:unknown:${key}`,
            `theme.widget.design "${key}" is not a registered design (${[...registry.keys()].join(', ')}); `
            + 'drawing with "ring". Register one with authoring.registerDesign(name, design).');
        return designOf('ring');
    }
    /** @type {any[]} */
    const chain = [];
    /** @type {string | undefined} */
    let at = key;
    while (at && registry.has(at) && chain.length < 8) {
        const d = /** @type {any} */ (registry.get(at));
        chain.unshift(d);
        if (at === 'ring') break;
        at = d.extends || 'ring';
    }
    if (chain[0] !== ring) chain.unshift(ring);
    const { extends: _from, theme: _theme, ...parts } = Object.assign({}, ...chain);
    return /** @type {any} */ (parts);
}

/** The names of the registered designs. @returns {string[]} */
export function designNames() {
    return [...registry.keys()];
}

/**
 * The widget tokens and their design for a guide's frame.
 * @param {any} ctx render context (carries `theme`)
 * @returns {{ t: import('../types').WidgetTokens, design: import('../types').ResolvedWidgetDesign }}
 */
export function lookOf(ctx) {
    const t = { .../** @type {any} */ (DEFAULT_THEME).widget, ...((ctx && ctx.theme && ctx.theme.widget) || {}) };
    return { t, design: designOf(t.design) };
}
