// @ts-check
// shared.js: the theming every widget shares.
//
// A widget resolves `opts.theme` with `widgetTheme` for its marks' ink, and puts
// the same partial on `spec.theme` so the engine resolves it for the guides:
//
//   Elicit(likert({ question, options, theme: themes.survey }))

import { resolveTheme } from '../core/theme.js';

/**
 * Resolve a widget's theme for its answer mark's ink and size: DEFAULT_THEME, then
 * the setTheme() base, then the widget's `theme` option, the same precedence the
 * engine applies to `spec.theme`.
 * @param {import('../types').ThemeSpec | undefined} [theme]
 * @returns {import('../types').Theme}
 */
export function widgetTheme(theme) {
    return resolveTheme(theme);
}
