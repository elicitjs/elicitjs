// @ts-check
// panel.js — the plot area's own surface (`theme.panel`), distinct from the chart
// `background`, which covers the margins too. Emitted first, so everything paints over it.

/**
 * The panel node for a plot of `width × height`, or none when the theme sets
 * neither a fill nor a stroke — so an unthemed chart's scene is unchanged.
 * @param {any} theme the resolved theme
 * @param {number} width
 * @param {number} height
 * @returns {import('../types').FeatureNode[]}
 */
export function panelNodes(theme, width, height) {
    const p = (theme && theme.panel) || {};
    if (!p.fill && !p.stroke) return [];
    return [{
        type: 'rect', x: 0, y: 0, width, height,
        fill: p.fill || 'none',
        stroke: p.stroke || 'none',
        strokeWidth: p.strokeWidth ?? 1,
        background: true, pointerEvents: 'none', panel: true,
    }];
}
