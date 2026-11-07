// @ts-check
// titles.js — a chart's TITLE, SUBTITLE and CAPTION: chrome that reserves layout
// space exactly as a legend does (core/legends.js reserveLegends), so a titled
// chart keeps its declared width and height and the plot shrinks to make room.
// The bands sit OUTSIDE the legend bands: author margin, then the title block,
// then any top legend, then the plot; the caption mirrors that at the bottom.
//
// Drawn as background text nodes (pointer-transparent) in the theme's title
// tokens; left-aligned with the plot, the Observable Plot convention.

/**
 * The resolved tokens of one title part, with the axis label ink as the fallback
 * fill so a dark theme's titles stay legible without a token of their own.
 * @param {any} theme
 * @param {'title' | 'subtitle' | 'caption'} part
 * @returns {{ fill: string, fontSize: number, fontWeight: string | number }}
 */
function tokens(theme, part) {
    const t = (theme && theme[part]) || {};
    const labelFill = (theme && theme.axis && theme.axis.labelFill) || '#374151';
    const defaults = part === 'title'
        ? { fontSize: 16, fontWeight: 600 }
        : part === 'subtitle' ? { fontSize: 12, fontWeight: 'normal' } : { fontSize: 11, fontWeight: 'normal' };
    return {
        fill: t.fill || (part === 'title' ? labelFill : labelFill),
        fontSize: t.fontSize != null ? t.fontSize : defaults.fontSize,
        fontWeight: t.fontWeight != null ? t.fontWeight : defaults.fontWeight,
    };
}

/**
 * The bands a chart's titles need: the title block's height at the top, the
 * caption's at the bottom. Zero when nothing is declared, so an untitled chart's
 * layout is untouched.
 * @param {{ title?: string, subtitle?: string, caption?: string }} spec
 * @param {any} theme
 * @returns {{ top: number, bottom: number }}
 */
export function reserveTitles(spec, theme) {
    let top = 0;
    if (spec.title) top += tokens(theme, 'title').fontSize * 1.3;
    if (spec.subtitle) top += tokens(theme, 'subtitle').fontSize * 1.4;
    if (top) top += 6; // breathing room above the plot (or its top legend)
    let bottom = 0;
    if (spec.caption) bottom = tokens(theme, 'caption').fontSize * 1.4 + 6;
    return { top, bottom };
}

/**
 * The text nodes, in the plot's coordinate frame (the scene is translated by the
 * effective margins). The title block sits just below the author's top margin;
 * the caption just above the author's bottom margin.
 * @param {{ title?: string, subtitle?: string, caption?: string }} spec
 * @param {any} theme
 * @param {{ innerWidth: number, outerHeight: number, effectiveMargins: { top: number, bottom: number, left: number, right: number }, authorMargins: { top: number, bottom: number } }} layout
 * @returns {import('../types').FeatureNode[]}
 */
export function titleNodes(spec, theme, { innerWidth, outerHeight, effectiveMargins, authorMargins }) {
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];
    const chrome = { background: true, pointerEvents: 'none', textAnchor: 'start' };
    let y = authorMargins.top - effectiveMargins.top; // the title block's top, in scene y
    if (spec.title) {
        const t = tokens(theme, 'title');
        y += t.fontSize;
        nodes.push({ type: 'text', x: 0, y, text: String(spec.title), fill: t.fill, fontSize: t.fontSize, fontWeight: t.fontWeight, ...chrome });
        y += t.fontSize * 0.3;
    }
    if (spec.subtitle) {
        const t = tokens(theme, 'subtitle');
        y += t.fontSize;
        nodes.push({ type: 'text', x: 0, y, text: String(spec.subtitle), fill: t.fill, fontSize: t.fontSize, fontWeight: t.fontWeight, ...chrome });
    }
    if (spec.caption) {
        const t = tokens(theme, 'caption');
        const cy = outerHeight - authorMargins.bottom - effectiveMargins.top - t.fontSize * 0.4;
        nodes.push({ type: 'text', x: 0, y: cy, text: String(spec.caption), fill: t.fill, fontSize: t.fontSize, fontWeight: t.fontWeight, ...chrome });
    }
    void innerWidth;
    return nodes;
}
