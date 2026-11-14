// @ts-check
// guides.tip: a tooltip box with the values of the row under the pointer
// (`ui.hit`). The box is pointer-transparent. A mark's `tip: true | string[] | fn`
// desugars into a tip bound to that mark.
import { GUIDE_OPTIONS } from '../vocabulary.js';
import { warnUnknownGuideOptions, plainValue } from './shared.js';
import { measureText } from '../core/measure.js';
import { markCenter } from '../edit/shared.js';
import { resolveFormat } from '../format.js';

/**
 * @param {{ mark?: string, text?: string[] | ((row: any, ctx: any) => string | string[]),
 *   anchor?: 'pointer' | 'mark', dx?: number, dy?: number, fill?: string, stroke?: string,
 *   fontSize?: number, format?: string | ((v: any) => string) }} [options]
 *   mark    the id of the mark the tip reads (default: whichever mark is under the pointer)
 *   text    the columns to show, or a function of the row returning a string or lines
 *   anchor  where the box sits: beside the pointer (default) or at the mark's centre
 *   format  how a numeric value prints (a d3 format specifier or a function)
 * @returns {import('../types').Guide}
 */
export function tip(options = {}) {
    warnUnknownGuideOptions('tip', options, GUIDE_OPTIONS.tip);
    const { mark, text, anchor = 'pointer', dx = 12, dy = 12, fill, stroke, fontSize: fontSizeOpt, format } = options;
    const fmt = resolveFormat(format);
    /** @param {any} v @returns {string} */
    const show = (v) => {
        if (v == null) return '';
        if (typeof v === 'number' && format) return fmt(v);
        if (typeof v === 'object' && !(v instanceof Date)) return Array.isArray(v) ? `[${v.length}]` : '{…}';
        return plainValue(v, 1000);
    };

    return {
        views: 'state',
        type: 'tip',
        tracksPointer: true,
        build: (_rows, _scales, _w, _h, ctx) => {
            const pointer = ctx.ui?.pointer;
            const hits = ctx.ui?.hits || (ctx.ui?.hit ? [ctx.ui.hit] : []);
            // A tip bound to a mark reads that mark's own row under the pointer,
            // even when an inert label or another mark is drawn over it.
            const hit = mark != null ? hits.find((/** @type {any} */ h) => h.featureId === mark) : hits[0];
            if (!hit || !pointer) return [];
            const feature = (ctx.features || []).find((/** @type {any} */ f) => f.id === hit.featureId);
            const row = feature && hit.index != null ? (ctx.tableOf(feature) || [])[hit.index]
                : (hit.node.data != null ? hit.node.data : null);
            if (!row) return [];

            /** @type {string[]} */
            let lines;
            if (typeof text === 'function') {
                const out = text(row, ctx);
                lines = Array.isArray(out) ? out.map(String) : String(out).split('\n');
            } else {
                const fields = Array.isArray(text) ? text : Object.keys(row).filter((k) => typeof row[k] !== 'object' || row[k] instanceof Date);
                lines = fields.map((f) => `${f}: ${show(row[f])}`);
            }
            lines = lines.filter((l) => l !== '');
            if (!lines.length) return [];

            const fontSize = fontSizeOpt ?? (ctx.theme?.font?.size || 10) + 1;
            const lineHeight = Math.round(fontSize * 1.35);
            const pad = 6;
            // Allowance for the page font being wider than the measuring font.
            const textW = Math.max(...lines.map((l) => measureText(l, { fontSize }))) * 1.08 + 2;
            const boxW = textW + pad * 2;
            const boxH = lines.length * lineHeight + pad * 2 - (lineHeight - fontSize);

            // Beside the pointer (or the mark), flipped to stay inside the plot.
            const at = anchor === 'mark' ? (markCenter(hit.node) || pointer) : pointer;
            const ax = anchor === 'mark' ? at.cx : at.x;
            const ay = anchor === 'mark' ? at.cy : at.y;
            let x = ax + dx;
            let y = ay + dy;
            if (x + boxW > ctx.width) x = ax - dx - boxW;
            if (y + boxH > ctx.height) y = ay - dy - boxH;
            if (x < 0) x = 0;
            if (y < 0) y = 0;

            const inkFill = fill ?? (ctx.theme?.background || '#ffffff');
            const inkStroke = stroke ?? (ctx.theme?.axis?.stroke || '#9ca3af');
            const labelFill = ctx.theme?.axis?.labelFill || '#374151';
            return [
                {
                    type: 'rect', x, y, width: boxW, height: boxH, rx: 3,
                    fill: inkFill, stroke: inkStroke, strokeWidth: 1, opacity: 0.96,
                    pointerEvents: 'none', guide: true, front: true,
                },
                {
                    type: 'text', x: x + pad, y: y + pad + fontSize * 0.85,
                    text: lines.join('\n'), lines, lineHeight, lineAnchor: 'top',
                    fill: labelFill, fontSize, textAnchor: 'start',
                    pointerEvents: 'none', guide: true,
                },
            ];
        },
    };
}
