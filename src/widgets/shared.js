// @ts-check
// shared.js: the look and the layout every widget shares.
//
// A widget resolves `opts.theme` once with `widgetLook`, asks the design it names
// for its parts, and pins the resolved tokens on `spec.theme`, so its marks and
// its guides are drawn from one look:
//
//   Elicit(likert({ question, options, theme: 'survey' }))

import { resolveTheme } from '../core/theme.js';
import { designOf } from './designs.js';

/**
 * Resolve a widget's theme the way the engine resolves `spec.theme`: DEFAULT_THEME,
 * then the setTheme() base, then the widget's `theme` option.
 * @param {import('../types').ThemeSpec | undefined} [theme]
 * @returns {import('../types').Theme}
 */
export function widgetTheme(theme) {
    return resolveTheme(theme);
}

/**
 * A widget's look: its tokens, the design they name, and the theme to put on the
 * spec. The spec's theme carries the resolved widget tokens, so a guide (which
 * reads the theme each frame) and a mark (which took its paint when the widget
 * was built) cannot disagree.
 * @param {import('../types').ThemeSpec | undefined} [theme]
 * @returns {{ t: import('../types').WidgetTokens, design: import('../types').ResolvedWidgetDesign, theme: import('../types').ThemeSpec }}
 */
export function widgetLook(theme) {
    const t = { ...resolveTheme(theme).widget };
    const own = typeof theme === 'string' ? { extends: theme } : (theme || {});
    return {
        t,
        design: designOf(t.design),
        theme: /** @type {any} */ ({ ...own, widget: t }),
    };
}

/** Room for the prompt over the plot, and at its other edges, in px. */
const PROMPT = 34;
const EDGE = 16;

/**
 * Size a plot to `count` options that tile it: a row of boxes or a stacked list.
 * The band scale's padding is the gap, so the marks and the guides read one
 * geometry and both follow a resize.
 * @param {{ count: number, layout: 'row' | 'list', t: import('../types').WidgetTokens,
 *   width: number, height?: number, size?: number }} o `size`: one option's
 *   height, when the widget has measured it
 * @returns {{ margins: { top: number, right: number, bottom: number, left: number },
 *   height: number, scale: { type: 'band', padding: number, range?: [number, number] },
 *   cell: { width: number, height: number }, promptY: number }}
 *   `promptY`: where the prompt sits, for `guides.prompt(text, { y })`
 */
export function tileLayout({ count, layout, t, width, height, size }) {
    const n = Math.max(1, count);
    const gap = Math.max(0, t.gap);
    if (layout === 'row') {
        // The band's outer padding is one gap, so the margin gives the rest of the edge.
        const side = Math.max(0, EDGE - gap);
        const inner = width - 2 * side;
        const cell = Math.max(1, (inner - (n + 1) * gap) / n);
        const optionHeight = size != null ? size : t.optionHeight;
        const total = height != null ? height : PROMPT + optionHeight + EDGE - 4;
        return {
            margins: { top: PROMPT, right: side, bottom: Math.max(0, total - PROMPT - optionHeight), left: side },
            height: total,
            scale: { type: 'band', padding: gap / (cell + gap) },
            cell: { width: cell, height: optionHeight },
            promptY: -18,
        };
    }
    // The band's outer padding is one gap, above the first row and under the last.
    const top = PROMPT;
    const bottom = Math.max(0, EDGE - 4 - gap);
    // A given height sets the row; otherwise the row sets the height.
    const row = height != null
        ? Math.max(1, (height - top - bottom - (n + 1) * gap) / n)
        : (size != null ? size : t.rowHeight);
    const inner = n * row + (n + 1) * gap;
    return {
        margins: { top, right: EDGE, bottom, left: EDGE },
        height: height != null ? height : top + inner + bottom,
        scale: { type: 'band', padding: gap / (row + gap), range: [0, inner] },
        cell: { width: width - 2 * EDGE, height: row },
        // The first row starts one gap into the plot, so the prompt comes down with it.
        promptY: gap - 18,
    };
}
