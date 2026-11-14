// @ts-check
// sticker.js — a note you can type into: a rounded box whose size follows the text.
//
//   plot.sticker({
//     channels: {
//       x:    { field: 'x', edit: move({ channels: ['x', 'y'] }) },
//       y:    { field: 'y' },
//       text: { field: 'note' },
//     },
//     edits: [editText()],          // double-click the body to type
//   })
//
// A preset over `composite` in plain mode: a `rect` body and a `text` label that
// both read one per-row `layout(d)` measurement. `width`/`height` channels pin the
// size per axis; a pinned width is also the width the text wraps at.
//
// Part order matters: the rect is first (painted behind) and owns every edit, so a
// drag or double-click lands on the box. The label is last and inert, so the
// engine makes it pointer-transparent. The composite itself gets no channels or
// edits, since it would hand them to its last part, the label.

import { normalizeMarkOptions, markCommon, rawChannel, withoutEdit } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { composite } from './composite.js';
import { rect } from './rect.js';
import { text } from './text.js';
import { noteBox } from '../core/measure.js';

/**
 * Channels that belong to the label. Everything else (fill, stroke, …) is the box's.
 * @type {string[]}
 */
const LABEL_CHANNELS = ['text', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'textAnchor', 'lineAnchor', 'dx', 'dy'];

/** Channels given to both parts, so they stay concentric. */
const SHARED_CHANNELS = ['x', 'y'];

/** Channels that size the box and turn its auto-sizing off. */
const SIZE_CHANNELS = ['width', 'height'];

/**
 * sticker — a rounded box with text in it, sized by the text.
 * @param {any} [options]
 * @returns {any} the parts, flattened by Elicit like any composite
 */
export function sticker(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'sticker',
        // Raw options, not channels: they describe the box and must not reach the label.
        except: ['padding', 'radius', 'maxWidth', 'minWidth', 'lineHeight'],
        allow: MARK_OPTIONS.sticker,
    });
    const {
        channels = {},
        padding = 10,
        radius = 6,
        maxWidth = 160,
        minWidth = 60,
        minHeight = 0,
        lineHeight,
        format,
    } = opts;
    const common = markCommon(opts);
    const name = common.id || 'sticker';

    /** @type {Record<string, any>} */
    const shared = {};
    /** @type {Record<string, any>} */
    const body = {};
    /** @type {Record<string, any>} */
    const label = {};
    for (const [key, spec] of Object.entries(channels)) {
        if (SHARED_CHANNELS.includes(key)) shared[key] = spec;
        else if (LABEL_CHANNELS.includes(key)) label[key] = spec;
        else body[key] = spec;
    }

    // Measurement needs a constant fontSize; a `{ field }` fontSize is measured at the default.
    const fontSize = (label.fontSize && (label.fontSize.value ?? label.fontSize)) || 13;
    // The label's constant font, so the box is measured in the font it draws in.
    const fontFamily = label.fontFamily && label.fontFamily.value;
    const textField = channels.text && channels.text.field;
    const textFn = channels.text && channels.text.fn;
    const textConst = channels.text && channels.text.value;

    /**
     * The width this row's text wraps at and the ceiling its box may grow to: the
     * pinned `width` (read raw, in pixels) if any, else `maxWidth`.
     * @param {any} d @param {number} i @param {any[]} data
     * @returns {number}
     */
    const boxWidth = (d, i, data) => {
        const pinned = channels.width ? +rawChannel(channels, 'width', d, NaN, i, data) : NaN;
        return Number.isFinite(pinned) ? pinned : maxWidth;
    };

    /**
     * One row's measured block, read by both parts.
     * @param {any} d @param {number} i @param {any[]} data
     */
    const layout = (d, i, data) => {
        const raw = textField != null ? d[textField]
            : typeof textFn === 'function' ? textFn(d, i, data)
                : textConst;
        // `noteBox` lives in core/measure.js so a `link` docking here gets the same box.
        return noteBox(raw, {
            padding,
            maxWidth: boxWidth(d, i, data),
            minWidth,
            minHeight,
            fontSize: +fontSize || 13,
            fontFamily,
            lineHeight,
        });
    };

    /** @type {Record<string, any>} */
    const bodyChannels = { ...body, ...shared, rx: { value: radius } };
    // The body carries `text` without drawing it, so `editText` on the body has a
    // column to write; without it the typed string would be dropped.
    if (channels.text) bodyChannels.text = withoutEdit(channels.text);
    // Auto-size unpinned axes. `{ fn }` (pixels, no scale), not `{ field }`, which
    // would build a [0, 1] scale and draw a one-pixel box.
    for (const ch of SIZE_CHANNELS) {
        if (bodyChannels[ch]) continue;
        const pick = ch === 'width'
            ? (/** @type {any} */ b) => b.width
            : (/** @type {any} */ b) => b.height;
        bodyChannels[ch] = { fn: (/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ data) => pick(layout(d, i, data)) };
    }

    /** @type {any[]} */
    const parts = [
        // First: the body paints behind the label and owns every edit.
        rect({
            id: `${name}/body`,
            ...(common.edits ? { edits: common.edits } : {}),
            ...(common.table ? { table: common.table } : {}),
            channels: bodyChannels,
        }),
        // Last: drawn on top and inert, so it can't swallow a gesture aimed at the body.
        text({
            id: `${name}/label`,
            // Per row: wraps at the same `boxWidth` the rect draws at.
            wrap: (/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ data) =>
                boxWidth(d, i, data) - padding * 2,
            ...(lineHeight !== undefined ? { lineHeight } : {}),
            ...(format !== undefined ? { format } : {}),
            channels: {
                textAnchor: { value: 'middle' },
                lineAnchor: { value: 'middle' },
                fontSize: { value: fontSize },
                ...label,
                // Same position as the box, without the edit.
                ...(shared.x ? { x: withoutEdit(shared.x) } : {}),
                ...(shared.y ? { y: withoutEdit(shared.y) } : {}),
            },
        }),
    ];

    // The composite gets nothing editable, so it can't route edits to the label.
    return composite({ id: common.id, table: common.table, clip: common.clip, channels: {}, parts });
}
