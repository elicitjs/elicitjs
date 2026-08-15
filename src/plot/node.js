// @ts-check
// node.js — a dot with a label, as one mark.
//
//   plot.node({ channels: { x: {field:'x'}, y: {field:'y'}, text: {field:'label'} } })
//
// A PRESET over `composite`, in the same sense `pie`/`donut` are presets over `arc`
// and `path` is a preset over `line`: it desugars into ordinary
// marks and the engine learns nothing. What it removes is the repetition of writing
// the same `x`/`y` on two marks:
//
//   composite({ channels: { x, y }, parts: [
//     text({ dy: -16, channels: { text } }),
//     point({ channels: { …style } }),
//   ]})
//
// The composite's channels trickle to both parts (plain mode), so `x`/`y` are
// stated once. That is the whole trick — no new mechanism.
//
// ── Not a network mark ─────────────────────────────────────────────────────
// Nothing here knows about networks. It is a dot with a label over whatever table
// it is pointed at, and it reads no schema — a preset runs at factory time, before
// there is a chart to ask. It invents no field names either: `positionalKeys`
// already owns the "column named after the channel" fallback, with its warning.
//
// ── Inert, like every mark ─────────────────────────────────────────────────
// It attaches no edits. Put `move()` on `x`, `editText()` on `text`, and
// `edit.network.connect()` in `edits` — exactly as on any other mark.
//
// ORDER IS LOAD-BEARING: the dot is the LAST part. A composite hands its channel
// edits to its last part only (so one gesture can't fire twice), and it draws the
// parts in order — so putting the dot last is both what makes `x: { edit: move() }`
// grab the dot rather than the label, and what keeps the dot above the label for
// picking.

import { normalizeMarkOptions, markCommon } from './mark.js';
import { composite } from './composite.js';
import { point } from './point.js';
import { text } from './text.js';

/**
 * Channels that belong to the LABEL rather than the dot. Everything else — fill,
 * stroke, size, opacity, angle, symbol — is the dot's, so `node({ fill: 'red' })`
 * colours the dot and leaves the label its own colour.
 * @type {string[]}
 */
const LABEL_CHANNELS = ['text', 'fontSize', 'textAnchor', 'lineAnchor', 'dx'];

/**
 * Channels that must be SHARED — stated once on the composite so both parts get
 * them, which is the repetition this preset exists to remove.
 * @type {string[]}
 */
const SHARED_CHANNELS = ['x', 'y'];

/**
 * node — a dot with a label, over one row each.
 * @param {any} [options]
 * @returns {any} the parts, flattened by Elicit like any composite
 */
export function node(options = {}) {
    // `dy` stays a raw option rather than desugaring into a channel: it is the
    // LABEL's offset, and a channel would trickle it onto the dot as well.
    const opts = normalizeMarkOptions(options, {
        mark: 'node',
        except: ['dy'],
        allow: ['dy', 'shape', 'format', 'handles', 'handleSize', 'handleColor'],
    });
    const { channels = {}, dy = -16, shape, format } = opts;
    const common = markCommon(opts);
    const name = common.id || 'node';

    /** @type {Record<string, any>} */
    const shared = {};
    /** @type {Record<string, any>} */
    const dot = {};
    /** @type {Record<string, any>} */
    const label = {};
    for (const [key, spec] of Object.entries(channels)) {
        if (SHARED_CHANNELS.includes(key)) shared[key] = spec;
        else if (LABEL_CHANNELS.includes(key)) label[key] = spec;
        else dot[key] = spec;
    }

    /** @type {any[]} */
    const parts = [];
    // No `text` channel, no label — the same rule every mark follows about a
    // channel it wasn't given.
    if (channels.text) {
        parts.push(text({
            id: `${name}/label`,
            dy,
            ...(format !== undefined ? { format } : {}),
            channels: { textAnchor: { value: 'middle' }, ...label },
        }));
    }
    // LAST: see the header — it takes the composite's channel edits, and draws on top.
    parts.push(point({
        id: `${name}/dot`,
        ...(shape !== undefined ? { shape } : {}),
        channels: dot,
    }));

    return composite({ ...common, channels: shared, parts });
}
