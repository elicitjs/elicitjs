// @ts-check
// themes.js — the built-in themes, exposed publicly as `elicit.themes`. Each is a
// PARTIAL theme (deep-merged over DEFAULT_THEME by resolveTheme), so a theme only
// names the tokens it changes and inherits the rest.
//
//   Elicit({ ...spec, theme: themes.survey })
//   setTheme(themes.survey)   // make it the app-wide default
//
// `default` is the identity theme (the library's built-in look). `survey` is the
// showcase for the style layer: a clean, professional survey-instrument look
// (neutral chrome, indigo accent, larger question type) that restyles the whole
// widget family from one object.

/** @type {Record<string, import('../types').DeepPartial<import('../types').Theme>>} */
export const themes = {
    // The identity theme — resolves to DEFAULT_THEME unchanged.
    default: {},

    // A professional, Qualtrics-flavoured survey look. Neutral greys for chrome,
    // an indigo accent for committed answers and handles, and slightly larger,
    // softer type. The widget affordances (rings, cells, tracks) restyle with it.
    survey: {
        ink: '#4f46e5',
        accent: '#4f46e5',
        muted: '#94a3b8',
        font: {
            family: '"Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            size: 11,
            labelSize: 13,
            titleSize: 15
        },
        axis: { stroke: '#cbd5e1', labelFill: '#475569', fontSize: 11, handle: '#4f46e5' },
        grid: { stroke: '#f1f5f9', strokeWidth: 1 },
        constraint: { color: '#e11d48' },
        widget: {
            accent: '#4f46e5',
            ring: '#cbd5e1',
            track: '#e2e8f0',
            cellFill: '#f8fafc',
            cellStroke: '#e2e8f0',
            label: '#475569',
            question: '#1e293b',
            labelSize: 13,
            questionSize: 15,
            radius: 12
        }
    },

    // A dark-mode look: a slate backdrop with light ink and chrome. `background` is
    // the piece that makes it self-contained — the chart paints its own dark surface,
    // so it reads on a dark page without any host CSS. Every token is chosen for
    // contrast on the backdrop.
    dark: {
        background: '#0f172a',
        ink: '#38bdf8',
        accent: '#38bdf8',
        muted: '#64748b',
        axis: { stroke: '#475569', labelFill: '#cbd5e1', fontSize: 10, handle: '#38bdf8' },
        grid: { stroke: '#1e293b' },
        guide: {
            rule: { stroke: '#94a3b8', strokeDash: '5 4' },
            region: { fill: '#94a3b8', opacity: 0.14 },
            legend: { stroke: '#cbd5e1', labelFill: '#cbd5e1', fontSize: 11 }
        },
        constraint: { color: '#fb7185' },
        widget: {
            accent: '#38bdf8',
            ring: '#334155',
            track: '#1e293b',
            cellFill: '#1e293b',
            cellStroke: '#334155',
            label: '#cbd5e1',
            question: '#f1f5f9',
            labelSize: 12,
            questionSize: 13,
            radius: 11
        }
    }
};
