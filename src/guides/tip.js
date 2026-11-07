// @ts-check
// guides.tip — a tooltip, as a GUIDE: the row under the pointer, drawn as a box
// of its values. It views STATE (`ui.hit`, the engine's own hit test of
// `ui.pointer`) and writes nothing, which is exactly what a guide is, and it is
// why a tip can never block elicitation: no mark becomes pointer-active to show
// one, the box itself is pointer-transparent, and dispatch does not change.
//
// Every mark takes `tip: true | string[] | fn` as a shorthand; the engine
// desugars it into one of these bound to that mark (`mark: feature.id`).
import { GUIDE_OPTIONS } from '../vocabulary.js';
import { warnUnknownGuideOptions } from './shared.js';
import { measureText } from '../core/measure.js';
import { markCenter } from '../edit/shared.js';
import { resolveFormat } from '../format.js';

export const TIP_OPTIONS = GUIDE_OPTIONS.tip;

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
    warnUnknownGuideOptions('tip', options, TIP_OPTIONS);
    const { mark, text, anchor = 'pointer', dx = 12, dy = 12, fill, stroke, fontSize: fontSizeOpt, format } = options;
    const fmt = resolveFormat(format);
    /** @param {any} v @returns {string} */
    const show = (v) => {
        if (v == null) return '';
        if (v instanceof Date) return v.toLocaleDateString();
        if (typeof v === 'number') return format ? fmt(v) : String(Math.round(v * 1000) / 1000);
        if (typeof v === 'object') return Array.isArray(v) ? `[${v.length}]` : '{…}';
        return String(v);
    };

    return {
        views: 'state',
        type: 'tip',
        tracksPointer: true,
        build: (_rows, _scales, _w, _h, ctx) => {
            const pointer = ctx.ui && ctx.ui.pointer;
            const hits = (ctx.ui && ctx.ui.hits) || (ctx.ui && ctx.ui.hit ? [ctx.ui.hit] : []);
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

            const fontSize = fontSizeOpt ?? ((ctx.theme && ctx.theme.font && ctx.theme.font.size) || 10) + 1;
            const lineHeight = Math.round(fontSize * 1.35);
            const pad = 6;
            // A small allowance: the page's own font is often a little wider than
            // the measuring context's fallback family.
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

            const inkFill = fill ?? ((ctx.theme && ctx.theme.background) || '#ffffff');
            const inkStroke = stroke ?? ((ctx.theme && ctx.theme.axis && ctx.theme.axis.stroke) || '#9ca3af');
            const labelFill = (ctx.theme && ctx.theme.axis && ctx.theme.axis.labelFill) || '#374151';
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
