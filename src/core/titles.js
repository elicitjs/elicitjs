// @ts-check
// titles.js — a chart's TITLE, SUBTITLE and CAPTION: chrome that reserves layout
// space exactly as a legend does (core/legends.js reserveLegends), so a titled
// chart keeps its declared width and height and the plot shrinks to make room.
// The bands are the OUTERMOST: plot, then the author's margin (where an axis
// draws), then any legend, then the title block at the top edge; the caption
// mirrors that at the bottom edge.
//
// Drawn as background text nodes (pointer-transparent) in the theme's title
// tokens; left-aligned with the plot, the Observable Plot convention, and wrapped
// to the chart's width.
import { wrapText } from './measure.js';

/**
 * The resolved tokens of one title part, with the axis label ink as the fallback
 * fill so a dark theme's titles stay legible without a token of their own.
 * @param {any} theme
 * @param {'title' | 'subtitle' | 'caption'} part
 * @returns {{ fill: string, fontSize: number, fontWeight: string | number, fontFamily: string | null, fontStyle: string | null }}
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
        fontFamily: t.fontFamily || null,
        fontStyle: t.fontStyle || null,
    };
}

/**
 * The bands a chart's titles need: the title block's height at the top, the
 * caption's at the bottom. Zero when nothing is declared, so an untitled chart's
 * layout is untouched.
 * @param {{ title?: string, subtitle?: string, caption?: string }} spec
 * @param {any} theme
 * @param {number} [maxWidth] the width the text may use; 0 for one line
 * @returns {{ top: number, bottom: number }}
 */
export function reserveTitles(spec, theme, maxWidth = 0) {
    /** @param {'title' | 'subtitle' | 'caption'} part */
    const lineCount = (part) => linesOf(spec[part], tokens(theme, part), maxWidth).length;
    let top = 0;
    if (spec.title) top += tokens(theme, 'title').fontSize * 1.3 * lineCount('title');
    if (spec.subtitle) top += tokens(theme, 'subtitle').fontSize * 1.4 * lineCount('subtitle');
    if (top) top += 6; // breathing room above the plot (or its top legend)
    let bottom = 0;
    if (spec.caption) bottom = tokens(theme, 'caption').fontSize * 1.4 * lineCount('caption') + 6;
    return { top, bottom };
}

/**
 * A title part's lines, wrapped to the width it may use (the chart's width
 * from the plot's left edge); one line when no width is known.
 * @param {any} text @param {{ fontSize: number, fontWeight: any, fontFamily?: string | null }} t @param {number} maxWidth
 * @returns {string[]}
 */
function linesOf(text, t, maxWidth) {
    if (text == null || text === '') return [];
    return wrapText(String(text), { maxWidth: maxWidth > 0 ? maxWidth : 0, fontSize: t.fontSize, fontWeight: t.fontWeight, fontFamily: t.fontFamily || undefined });
}

/**
 * The text nodes, in the plot's coordinate frame (the scene is translated by the
 * effective margins). The title block hangs from the chart's top edge; the
 * caption sits at its bottom edge.
 * @param {{ title?: string, subtitle?: string, caption?: string }} spec
 * @param {any} theme
 * @param {{ innerWidth: number, outerHeight: number, effectiveMargins: { top: number, bottom: number, left: number, right: number }, authorMargins: { top: number, bottom: number }, maxWidth?: number }} layout
 * @returns {import('../types').FeatureNode[]}
 */
export function titleNodes(spec, theme, { innerWidth, outerHeight, effectiveMargins, authorMargins, maxWidth = 0 }) {
    /** @type {import('../types').FeatureNode[]} */
    const nodes = [];
    const chrome = { background: true, pointerEvents: 'none', textAnchor: 'start', lineAnchor: 'top' };
    void authorMargins; void innerWidth;
    let y = 2 - effectiveMargins.top; // the chart's top edge, in scene y
    /** @param {'title' | 'subtitle' | 'caption'} part @param {number} top @param {number} step */
    const block = (part, top, step) => {
        const t = tokens(theme, part);
        const lines = linesOf(spec[part], t, maxWidth);
        nodes.push({
            type: 'text', x: 0, y: top + t.fontSize * 0.8, text: String(spec[part]),
            ...(lines.length > 1 ? { lines, lineHeight: Math.round(t.fontSize * step) } : {}),
            fill: t.fill, fontSize: t.fontSize, fontWeight: t.fontWeight,
            ...(t.fontFamily ? { fontFamily: t.fontFamily } : {}),
            ...(t.fontStyle ? { fontStyle: t.fontStyle } : {}),
            ...chrome,
        });
        return lines.length * t.fontSize * step;
    };
    if (spec.title) y += block('title', y, 1.3);
    if (spec.subtitle) y += block('subtitle', y, 1.4);
    if (spec.caption) {
        const t = tokens(theme, 'caption');
        const h = linesOf(spec.caption, t, maxWidth).length * t.fontSize * 1.4;
        block('caption', outerHeight - effectiveMargins.top - h - 2, 1.4);
    }
    return nodes;
}
