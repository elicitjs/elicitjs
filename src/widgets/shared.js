// @ts-check
// shared.js — the common contract every survey instrument shares, so the whole
// family reads and behaves consistently. A widget is a pure recipe returning an
// ElicitSpec; this module gives them ONE options vocabulary and ONE way to theme.
//
// Every widget accepts WidgetOptions (see types.d.ts): `question`, `value`/`values`,
// `onChange`, `width`/`height`, `stage`, and `theme`. `theme` is the showcase for the
// style layer — pass `themes.survey` (or any partial) and the instrument's answer
// ink, chrome, and affordances all restyle:
//
//   Elicit(likert({ question, options, theme: themes.survey }))
//
// Two consumers of the ONE theme, kept in agreement by resolving it the same way:
//   1. the widget bakes the resolved tokens into its marks at factory time (the
//      answer dot's fill/size) via `widgetTheme(opts.theme)`, and
//   2. it puts the caller's partial on `spec.theme`, so the engine re-resolves it for
//      the affordance guides (rings, cells, tracks — which read ctx.theme.widget
//      live) and the chart chrome.

import { resolveTheme } from '../core/theme.js';

/**
 * The resolved theme a widget factory reads its answer-mark ink/size from:
 * DEFAULT_THEME < setTheme() base < the widget's own `theme` option — the same
 * precedence the engine applies to `spec.theme`, so the baked-in mark colour and the
 * live affordance colours always agree.
 * @param {import('../types').ThemeSpec | undefined} [theme]
 * @returns {import('../types').Theme}
 */
export function widgetTheme(theme) {
    return resolveTheme(theme);
}
