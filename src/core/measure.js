// @ts-check
// measure.js — text width and wrapping, available at build time.
//
//   measureText('hello', { fontSize: 14, fontFamily: 'Inter' })   // -> 31.2
//   wrapText('a longer sentence', { maxWidth: 90, fontSize: 14 }) // -> ['a longer', 'sentence']
//
// Uses a 2D canvas context created lazily behind `typeof document`, never at module
// scope: the docs site server-renders, and a top-level `document.createElement`
// would crash in Node where `check:warnings` cannot see it. With no DOM, widths
// fall back to an average-advance estimate.

// Mean glyph advance as a fraction of font size, for the no-DOM fallback.
const AVERAGE_ADVANCE = 0.52;

// The cache key includes the font, so a theme change never returns stale widths.
const CACHE_LIMIT = 4096;

/** @type {Map<string, number>} */
const cache = new Map();

/** @type {CanvasRenderingContext2D | null | undefined} */
let ctx2d;

/**
 * The measuring context, created on first use. `undefined` means "not tried yet";
 * `null` means "tried, and there is no DOM" — so a server render doesn't attempt
 * it once per string.
 * @returns {CanvasRenderingContext2D | null}
 */
function context() {
    if (ctx2d !== undefined) return ctx2d;
    ctx2d = null;
    if (typeof document !== 'undefined') {
        try {
            ctx2d = document.createElement('canvas').getContext('2d');
        } catch {
            ctx2d = null;
        }
    }
    return ctx2d;
}

/**
 * A CSS font shorthand from the parts a theme supplies.
 * @param {{ fontSize?: number, fontFamily?: string, fontWeight?: string | number }} font
 * @returns {string}
 */
function fontString({ fontSize = 12, fontFamily = 'sans-serif', fontWeight = 'normal' }) {
    return `${fontWeight} ${fontSize}px ${fontFamily}`;
}

/**
 * The rendered width of a string, in px.
 * @param {string} text
 * @param {{ fontSize?: number, fontFamily?: string, fontWeight?: string | number }} [font]
 * @returns {number}
 */
export function measureText(text, font = {}) {
    const str = text == null ? '' : String(text);
    if (!str) return 0;

    const spec = fontString(font);
    const key = `${spec}\u0000${str}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;

    const ctx = context();
    let width;
    if (ctx) {
        ctx.font = spec;
        width = ctx.measureText(str).width;
    } else {
        width = str.length * (font.fontSize || 12) * AVERAGE_ADVANCE;
    }

    // A chart the user types into is an unbounded key space, so the cache is
    // bounded. Oldest-first eviction: Map preserves insertion order.
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, width);
    return width;
}

/**
 * Break a string into lines that fit `maxWidth`: greedy word wrap, honouring typed
 * newlines, hard-breaking a word too long for the box. With no `maxWidth` it only
 * splits on newlines.
 *
 * @param {string} text
 * @param {{ maxWidth?: number, fontSize?: number, fontFamily?: string, fontWeight?: string | number }} [opts]
 * @returns {string[]} at least one line (possibly empty), never null
 */
export function wrapText(text, opts = {}) {
    const { maxWidth, ...font } = opts;
    const str = text == null ? '' : String(text);
    const paragraphs = str.split('\n');
    if (!maxWidth || maxWidth <= 0) return paragraphs;

    /** @type {string[]} */
    const out = [];
    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter((w) => w.length);
        if (!words.length) { out.push(''); continue; }

        let line = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (measureText(candidate, font) <= maxWidth) { line = candidate; continue; }
            if (line) out.push(line);
            // The word alone still overflows — break it across lines by character.
            if (measureText(word, font) > maxWidth) {
                let chunk = '';
                for (const ch of word) {
                    if (chunk && measureText(chunk + ch, font) > maxWidth) {
                        out.push(chunk);
                        chunk = ch;
                    } else {
                        chunk += ch;
                    }
                }
                line = chunk;
            } else {
                line = word;
            }
        }
        out.push(line);
    }
    return out;
}

/**
 * The box a wrapped string occupies: its lines, the widest of them, and the total
 * height at a given line step. The one call a mark needs — measuring and wrapping
 * separately would mean measuring every line twice.
 * @param {string} text
 * @param {{ maxWidth?: number, fontSize?: number, fontFamily?: string, fontWeight?: string | number, lineHeight?: number }} [opts]
 * @returns {{ lines: string[], width: number, height: number, lineHeight: number }}
 */
export function measureBlock(text, opts = {}) {
    const { lineHeight, ...rest } = opts;
    const fontSize = rest.fontSize || 12;
    const step = lineHeight || Math.round(fontSize * 1.35);
    const lines = wrapText(text, rest);
    let width = 0;
    for (const line of lines) width = Math.max(width, measureText(line, rest));
    return { lines, width, height: lines.length * step, lineHeight: step };
}

/**
 * The box a padded note of text occupies: `measureBlock` plus padding and minimums.
 * This is `sticker`'s sizing rule, shared so a link can dock to a note's edge
 * without reading another mark's geometry:
 *
 *   link({ channels: { nodeWidth: { fn: d => noteBox(d.label).width } } })
 *
 * Defaults match `sticker`'s; change both together.
 *
 * @param {string} text
 * @param {{ padding?: number, maxWidth?: number, minWidth?: number, minHeight?: number,
 *   fontSize?: number, fontFamily?: string, lineHeight?: number }} [opts]
 * @returns {{ block: { lines: string[], width: number, height: number, lineHeight: number }, width: number, height: number }}
 */
export function noteBox(text, opts = {}) {
    const {
        padding = 10, maxWidth = 160, minWidth = 60, minHeight = 0,
        fontSize = 13, fontFamily, lineHeight,
    } = opts;
    const block = measureBlock(text == null ? '' : String(text), {
        maxWidth: maxWidth - padding * 2,
        fontSize: +fontSize || 13,
        fontFamily,
        lineHeight,
    });
    return {
        block,
        width: Math.max(minWidth, Math.min(maxWidth, block.width + padding * 2)),
        height: Math.max(minHeight, block.height + padding * 2),
    };
}

/**
 * Drop every memoized width. Exported for a theme change and for tests; nothing in
 * the render path calls it, since the cache key already carries the font.
 * @returns {void}
 */
export function clearMeasureCache() {
    cache.clear();
}
