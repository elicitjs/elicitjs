// @ts-check
// parts.js: the marks a widget is built from, drawn the way the design says.
//
// A design describes a part (`answer`, `card`, `thumb`, `bar` in designs.js);
// these turn the description into ordinary marks. Internal: a widget's own
// building blocks, not spec keywords.

import { composite, point, rect, text, shape } from '../plot/index.js';
import { GRIPS } from './designs.js';

/**
 * The answer's ink inside an option: a dot or a square on the control, or a
 * block that fills the option. `channels` places it along the options' axis;
 * across it, the design says how far from the option's edge it sits.
 * @param {{ id: string, t: import('../types').WidgetTokens, design: any,
 *   layout: 'row' | 'list' | 'cell', control: 'radio' | 'check',
 *   cell: { width: number, height: number }, channels: Record<string, any>,
 *   edits?: import('../types').Edit[] }} o
 * @returns {import('../types').Mark}
 */
export function answerMark({ id, t, design, layout, control, cell, channels, edits }) {
    const a = design.answer({ layout, control, width: cell.width, height: cell.height }, t);
    /** @type {Record<string, any>} */
    const paint = { fill: a.fill != null ? a.fill : t.accent };
    if (a.stroke != null) {
        paint.stroke = a.stroke;
        paint.strokeWidth = a.strokeWidth != null ? a.strokeWidth : 1;
    }
    if (a.shape === 'block') {
        return rect({ id, ...paint, rx: a.corner || 0, channels, ...(edits ? { edits } : {}) });
    }
    // Across the options, the ink sits where the design drew the control.
    const at = { ...channels };
    if (a.left != null && !at.x) at.x = { value: a.left };
    if (a.top != null && !at.y) at.y = { value: a.top };
    const size = a.size != null ? a.size : t.radius - 3;
    if (a.shape === 'square') {
        return rect({
            id, ...paint, width: 2 * size, height: 2 * size, rx: a.corner || 0,
            channels: at, ...(edits ? { edits } : {}),
        });
    }
    return point({ id, ...paint, size, channels: at, ...(edits ? { edits } : {}) });
}

/**
 * A ranking card: one glyph per row, built from the parts the design lists. The
 * body spans the plot's width and takes the drag; the other parts are inert, so
 * a press anywhere on the card reaches the body. `motion: true` on the glyph
 * eases the cards and carries the grabbed one.
 * @param {{ id: string, t: import('../types').WidgetTokens, design: any,
 *   width: number, height: number, slot: string, label: string,
 *   edit: import('../types').Edit, wrap?: number }} o `slot`: the column that
 *   places a card; `label`: the column it names
 * @returns {{ marks: any[], effects: Record<string, any> }}
 */
export function card({ id, t, design, width, height, slot, label, edit, wrap }) {
    /** @type {import('../types').DesignCardPart[]} */
    const described = design.card({ width, height }, t);
    /** A part's x: from the card's left edge, or its right. @param {import('../types').DesignCardPart} p */
    const xOf = (p) => (p.right != null ? width - p.right : (p.left != null ? p.left : width / 2));
    /** @type {Record<string, any>} */
    const effects = {};

    const parts = described.map((p, i) => {
        const at = { x: { value: xOf(p) }, y: { field: slot } };
        switch (p.part) {
            case 'body': {
                if (p.hovered) effects.hovered = { outline: false, ...p.hovered };
                if (p.grabbed) effects.grabbed = { cursor: 'grabbing', ...p.grabbed };
                return rect({
                    id: `${id}/body`, height, rx: p.size || 0,
                    fill: p.fill != null ? p.fill : t.surface,
                    stroke: p.stroke != null ? p.stroke : t.stroke,
                    strokeWidth: p.strokeWidth != null ? p.strokeWidth : 1,
                    // No x: the body spans the plot. It alone carries the edit.
                    channels: { y: { field: slot, edit } },
                });
            }
            case 'badge':
                return point({ id: `${id}/badge`, size: p.size != null ? p.size : t.radius, fill: p.fill != null ? p.fill : t.accent, channels: at });
            case 'grip':
                return shape({ id: `${id}/grip`, path: GRIPS[p.path || 'dots'] || p.path, size: p.size != null ? p.size : 7, fill: p.fill != null ? p.fill : t.grip, channels: at });
            case 'rank':
            case 'label':
                return text({
                    id: `${id}/${p.part}`,
                    fill: p.fill != null ? p.fill : t.question,
                    fontSize: p.fontSize != null ? p.fontSize : t.itemSize,
                    ...(p.fontWeight != null ? { fontWeight: p.fontWeight } : {}),
                    ...(p.part === 'label' && wrap ? { wrap: Math.max(20, wrap - xOf(p)) } : {}),
                    channels: {
                        ...at,
                        text: { field: p.part === 'rank' ? slot : label },
                        textAnchor: { value: p.textAnchor || 'start' },
                    },
                });
            default:
                throw new Error(`[elicit] a card has no "${/** @type {any} */ (p).part}" part (design part ${i}). Parts are: body, badge, rank, label, grip.`);
        }
    });

    // The glyph gets no channels or edits of its own: it would hand them to its last part.
    return { marks: composite({ id, motion: true, channels: {}, parts }), effects };
}

/**
 * A bar's paint in the widgets that sit on chart axes.
 * @param {import('../types').WidgetTokens} t @param {any} design
 * @param {number} legacyOpacity the widget's own fill opacity in the `ring` look
 * @returns {Record<string, any>}
 */
export function barPaint(t, design, legacyOpacity) {
    const bar = design.bar(t);
    return {
        fill: t.accent,
        fillOpacity: bar.fillOpacity != null ? bar.fillOpacity : legacyOpacity,
        ...(bar.corner ? { rx: bar.corner } : {}),
    };
}
