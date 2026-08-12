// @ts-check
// sticker.js — a note you can type into: a rounded box whose SIZE follows the text.
//
//   plot.sticker({
//     channels: {
//       x:    { field: 'x', edit: move({ channels: ['x', 'y'] }) },
//       y:    { field: 'y' },
//       text: { field: 'note' },
//     },
//     edits: [editText()],          // double-click the BODY to type
//   })
//
// A PRESET over `composite` in plain mode, in exactly the sense `node()` is: it
// desugars into a `rect` and a `text` over the same rows and the engine learns
// nothing. It is not a new mark, because one row is still one box with a string —
// the same data model `rect` and `text` already have. What it adds is MEASUREMENT,
// which is the one thing neither could do.
//
// ── The box follows the text ────────────────────────────────────────────────
// One `layout(d)` closure measures and wraps each row's string (core/measure.js)
// and BOTH parts read it: the rect takes its width/height from it, the text takes
// its lines. That sharing is the whole construction — the alternative, having the
// text mark ask the rect what size it drew, would be a mark reading another
// FEATURE's built nodes, which nothing here is allowed to do.
//
// `width`/`height` channels override the measurement per axis, so a fixed-size
// sticker (or one sized by a drag) is still expressible; state one and auto-sizing
// stops for that axis only.
//
// A pinned `width` is also the width the text WRAPS at — that is what makes it a
// resize rather than a crop. Pin the width, leave the height to the measurement,
// and a note dragged narrower re-flows onto more lines and grows taller, which is
// what every sticky note in every tool does. (Wrapping at `maxWidth` while the box
// was drawn at `width` would overflow one way and leave dead paper the other.)
//
// ── Why the RECT is the typable part, and the text is inert ──────────────────
// The obvious arrangement — `editText` on the label — is wrong, and quietly so.
// An edit makes its feature's nodes pointer-active, and `edit/pick.js` gives a
// text node a hit area of `fontSize + 4` about its ANCHOR: a disc sitting dead
// centre of the sticker. Canvas hit-tests in reverse scene order, so that disc
// wins over the body beneath it and dragging a sticker by its middle does nothing
// at all; under SVG you get dead zones wherever a glyph is.
//
// Putting the edit on the rect makes the engine's pointer-transparency pass work
// FOR us: the label carries no edit, so its nodes are silenced automatically and
// can never swallow a gesture. It is also the right semantics — in every tool that
// has stickers you double-click the note, not a letter of it.
//
// ORDER IS LOAD-BEARING, and it is the opposite of node()'s. The rect is FIRST so
// it paints behind the text. That works only because this preset hands `composite`
// no channels and no edits of its own: a composite gives its channel edits and its
// mark-level edits to its LAST part, which here is the label. Splitting fully and
// attaching each edit to the part that should own it is what keeps the two rules
// from fighting.
//
// That order is PER NOTE, not per part — a glyph paints as one object (see
// `paintOrder` in core/scene.js), so drag one note over another and it covers the
// paper AND the text underneath. Ordered part by part instead, every note's label
// would paint above every note's paper, and the note underneath would show its
// text through the one on top.

import { normalizeMarkOptions, markCommon } from './mark.js';
import { composite } from './composite.js';
import { rect } from './rect.js';
import { text, rawChannel } from './text.js';
import { noteBox } from '../core/measure.js';

/**
 * Channels that belong to the LABEL rather than the box. Everything else — fill,
 * stroke, strokeWidth, opacity, angle — is the box's, so `sticker({ fill: 'gold' })`
 * colours the note and leaves its text readable.
 * @type {string[]}
 */
const LABEL_CHANNELS = ['text', 'fontSize', 'textAnchor', 'lineAnchor', 'dx', 'dy'];

/** Channels stated once and given to BOTH parts, so they stay concentric. */
const SHARED_CHANNELS = ['x', 'y'];

/** Channels that SIZE the box, and therefore turn its auto-sizing off. */
const SIZE_CHANNELS = ['width', 'height'];

/** A channel spec with its edit removed — for the copy that must not be a handle. */
const strip = (/** @type {any} */ spec) => {
    if (!spec) return spec;
    const { edit: _edit, ...rest } = spec;
    return rest;
};

/**
 * sticker — a rounded box with text in it, sized by the text.
 * @param {any} [options]
 * @returns {any} the parts, flattened by Elicit like any composite
 */
export function sticker(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'sticker',
        // `padding`/`radius`/`maxWidth`/`minWidth`/`lineHeight` are raw options, not
        // channels: they describe the BOX around the text, and a channel would
        // trickle onto the label as well.
        except: ['padding', 'radius', 'maxWidth', 'minWidth', 'lineHeight'],
        allow: [
            'padding', 'radius', 'maxWidth', 'minWidth', 'minHeight',
            'lineHeight', 'fontSize', 'fontFamily', 'format',
        ],
    });
    const {
        channels = {},
        padding = 10,
        radius = 6,
        maxWidth = 160,
        minWidth = 60,
        minHeight = 0,
        lineHeight,
        fontFamily,
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

    // A constant fontSize is needed for measurement, so it is read here rather than
    // only per datum. A `{ field }` fontSize still reaches the label; the box is
    // just measured at the default, which is the honest limit of measuring at
    // factory time rather than a silent wrong answer.
    const fontSize = (label.fontSize && (label.fontSize.value ?? label.fontSize)) || 13;
    const textField = channels.text && channels.text.field;
    const textFn = channels.text && channels.text.fn;
    const textConst = channels.text && channels.text.value;

    /**
     * The width this row's text WRAPS at, and the ceiling its box may grow to.
     * `maxWidth` normally — but when the spec pins the box's own width, the box IS
     * the ceiling: a note being resized has to re-wrap inside the paper it now has,
     * or it overflows on the way in and leaves a margin of empty box on the way out.
     * That is what makes `width` a resize handle rather than a crop.
     *
     * A `width` channel is in PIXELS (rect's SIZE branch), so it is read raw — the
     * same value the box is drawn at, for every form that means pixels: a constant,
     * a derived `{ fn }`, a raw column (`scale: null`), or a field on an identity
     * scale (the form that makes a pixel extent editable).
     * @param {any} d @param {number} i @param {any[]} data
     * @returns {number}
     */
    const boxWidth = (d, i, data) => {
        const pinned = channels.width ? +rawChannel(channels, 'width', d, NaN, i, data) : NaN;
        return Number.isFinite(pinned) ? pinned : maxWidth;
    };

    /**
     * One row's measured block. The single source both parts read — the rect for
     * its extent, the label for its lines.
     * @param {any} d @param {number} i @param {any[]} data
     */
    const layout = (d, i, data) => {
        const raw = textField != null ? d[textField]
            : typeof textFn === 'function' ? textFn(d, i, data)
                : textConst;
        // `noteBox` (core/measure.js) is the rule itself — padding, the ceiling, the
        // floors. It lives there rather than here so a `link` docking to this box can
        // reach the same answer without asking this mark what it drew.
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
    // The body carries `text` too, without drawing it. An edit WRITES TO A COLUMN,
    // and `resolveChannels` drops any channel its mark doesn't encode as a field —
    // so an `editText` on the body with no `text` channel here resolves to nothing
    // and the typed string is silently discarded. Naming the column is what makes
    // the write land; only the label actually paints it.
    if (channels.text) bodyChannels.text = strip(channels.text);
    // Auto-size only where the spec didn't say. Stated as `{ fn }` because a
    // derived channel is computed per datum in visual space and skipped by scale
    // resolution — a `{ field }` here would build a bucket scale whose default
    // range is [0, 1] and draw a one-pixel box.
    for (const ch of SIZE_CHANNELS) {
        if (bodyChannels[ch]) continue;
        const pick = ch === 'width'
            ? (/** @type {any} */ b) => b.width
            : (/** @type {any} */ b) => b.height;
        bodyChannels[ch] = { fn: (/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ data) => pick(layout(d, i, data)) };
    }

    /** @type {any[]} */
    const parts = [
        // FIRST: the body paints behind the label, and owns every edit — the
        // positional ones (so a drag grabs the note, not its glyphs) and the
        // mark-level ones (so `editText` opens the editor on the box).
        rect({
            id: `${name}/body`,
            ...(common.edits ? { edits: common.edits } : {}),
            ...(common.constraints ? { constraints: common.constraints } : {}),
            ...(common.table ? { table: common.table } : {}),
            channels: bodyChannels,
        }),
        // LAST: drawn on top, and deliberately INERT. It carries no edit, so the
        // engine silences its nodes and they cannot swallow a gesture aimed at the
        // body underneath.
        text({
            id: `${name}/label`,
            // Per ROW, not a constant: the label wraps at whatever width its own box
            // ended up, so a pinned or dragged width re-flows the note instead of
            // spilling out of it. Both parts read the one `boxWidth`, so the box a
            // rect draws and the width a label wraps at cannot drift.
            wrap: (/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ data) =>
                boxWidth(d, i, data) - padding * 2,
            ...(lineHeight !== undefined ? { lineHeight } : {}),
            ...(format !== undefined ? { format } : {}),
            channels: {
                textAnchor: { value: 'middle' },
                lineAnchor: { value: 'middle' },
                fontSize: { value: fontSize },
                ...label,
                // The label sits at the box's centre, without the handle: two
                // copies of one position, only one of which is grabbable.
                ...(shared.x ? { x: strip(shared.x) } : {}),
                ...(shared.y ? { y: strip(shared.y) } : {}),
            },
        }),
    ];

    // The composite gets NOTHING editable: no channels to trickle, no edits to hand
    // its last part. Its last-part rules then have nothing to act on, instead of
    // quietly routing the sticker's drag to its own label.
    return composite({ id: common.id, channels: {}, parts });
}
