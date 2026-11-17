// @ts-check
// ranking.js: drag cards to reorder them.
// Plain-chart twin: a composite card per row (rect + text + shape) on a band y
// scale, edit.rank() on the card's body, and `motion: true` on the glyph.

import { rank } from '../edit/index.js';
import { measureBlock } from '../core/measure.js';
import { prompt, rankSlots } from './theme.js';
import { widgetLook, tileLayout } from './shared.js';
import { card } from './parts.js';

/**
 * @param {import('../types').WidgetOptions & { items?: string[] }} [opts]
 * @returns {import('../types').ElicitSpec}
 */
export function ranking(opts = {}) {
    const {
        question = 'Rank these items',
        items = ['A', 'B', 'C', 'D'],
        onChange,
        width = 420,
        height,
        stage,
        theme
    } = opts;
    const look = widgetLook(theme);
    const { t, design } = look;

    const ranks = items.map((_, i) => i + 1);
    const data = items.map((item, i) => ({ item, rank: i + 1 }));

    // A card is as tall as its tallest label needs, and never shorter than a row.
    const wrap = width - 32 - 44;
    const tallest = items.reduce((h, item) => Math.max(h,
        measureBlock(String(item), { maxWidth: wrap - 46, fontSize: t.itemSize }).height), 0);
    const tiled = tileLayout({
        count: items.length, layout: 'list', t, width, height,
        size: Math.max(t.rowHeight, tallest + 16),
    });
    const cards = card({
        id: 'rank', t, design,
        width: tiled.cell.width, height: tiled.cell.height,
        slot: 'rank', label: 'item', wrap,
        edit: rank({ stage, cursor: 'grab' }),
    });

    return {
        width,
        height: tiled.height,
        theme: look.theme,
        margins: tiled.margins,
        schema: {
            item: { type: 'categorical', domain: items },
            rank: { type: 'ordinal', domain: ranks }
        },
        // Rank 1 is at the top: the band runs down the plot.
        scales: { y: tiled.scale },
        data,
        onChange,
        axes: false,
        effects: cards.effects,
        guides: [prompt(question, { y: tiled.promptY }), rankSlots()],
        marks: [cards.marks]
    };
}
