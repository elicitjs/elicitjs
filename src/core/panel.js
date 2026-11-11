// @ts-check
// panel.js — the PLOT AREA's own surface (`theme.panel`), as distinct from the
// chart's `background`, which covers the margins too. A filled panel is the ggplot2
// grey; a stroked one is a frame (Observable Plot's `frame`, Flint's
// `structure.frame`). The engine emits it FIRST, so it is the floor every gridline,
// axis and mark paints over.

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
