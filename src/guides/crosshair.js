// @ts-check
// guides.crosshair: rules that follow the pointer, with the value under it read
// off each axis at the plot edge.
import { GUIDE_OPTIONS } from '../vocabulary.js';
import { warnUnknownGuideOptions, plainValue } from './shared.js';
import { measureText } from '../core/measure.js';
import { resolveFormat } from '../format.js';

/**
 * @param {{ x?: boolean, y?: boolean, readout?: boolean, stroke?: string, strokeDash?: string,
 *   fontSize?: number, format?: string | ((v: any) => string) }} [options]
 *   x / y     which rules to draw (default both)
 *   readout   label each rule with the axis value under the pointer (default true)
 * @returns {import('../types').Guide}
 */
export function crosshair(options = {}) {
    warnUnknownGuideOptions('crosshair', options, GUIDE_OPTIONS.crosshair);
    const { x: onX = true, y: onY = true, readout = true, stroke, strokeDash = '3 3', fontSize: fontSizeOpt, format } = options;
    const fmt = format != null ? resolveFormat(format) : null;
    /** @param {any} v @returns {string} */
    const show = (v) => (v == null ? '' : fmt ? fmt(v) : plainValue(v, 100));

    return {
        views: 'state',
        type: 'crosshair',
        tracksPointer: true,
        build: (_rows, scales, width, height, ctx) => {
            const p = ctx.ui?.pointer;
            if (!p || p.x < 0 || p.y < 0 || p.x > width || p.y > height) return [];
            const rt = ctx.theme?.guide?.rule || {};
            const ink = stroke ?? rt.stroke ?? '#64748b';
            const fontSize = fontSizeOpt ?? (ctx.theme?.font?.size || 10);
            const labelFill = ctx.theme?.axis?.labelFill || '#374151';
            const bg = ctx.theme?.background || '#ffffff';
            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            /** @param {number} cx @param {number} cy @param {string} text @param {string} anchor */
            const label = (cx, cy, text, anchor) => {
                const w = measureText(text, { fontSize }) + 6;
                const lx = anchor === 'end' ? cx - w : anchor === 'middle' ? cx - w / 2 : cx;
                nodes.push({ type: 'rect', x: lx, y: cy - fontSize, width: w, height: fontSize + 4, fill: bg, opacity: 0.85, pointerEvents: 'none', guide: true, front: true });
                nodes.push({ type: 'text', x: cx, y: cy, text, fill: labelFill, fontSize, textAnchor: anchor, pointerEvents: 'none', guide: true });
            };
            if (onX) {
                nodes.push({ type: 'line', x1: p.x, x2: p.x, y1: 0, y2: height, stroke: ink, strokeDasharray: strokeDash, strokeWidth: 1, pointerEvents: 'none', guide: true });
                const sx = /** @type {any} */ (scales).x;
                if (readout && sx && typeof sx.invertValue === 'function') {
                    const anchor = p.x > width - 40 ? 'end' : p.x < 40 ? 'start' : 'middle';
                    label(p.x, height - 3, show(sx.invertValue(p.x)), anchor);
                }
            }
            if (onY) {
                nodes.push({ type: 'line', x1: 0, x2: width, y1: p.y, y2: p.y, stroke: ink, strokeDasharray: strokeDash, strokeWidth: 1, pointerEvents: 'none', guide: true });
                const sy = /** @type {any} */ (scales).y;
                if (readout && sy && typeof sy.invertValue === 'function') {
                    label(3, Math.max(fontSize, Math.min(height, p.y - 3)), show(sy.invertValue(p.y)), 'start');
                }
            }
            return nodes;
        },
    };
}
