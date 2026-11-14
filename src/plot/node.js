// @ts-check
// node.js — a dot with a label, as one mark.
//
//   plot.node({ channels: { x: {field:'x'}, y: {field:'y'}, text: {field:'label'} } })
//
// A preset over plain-mode `composite`: a `text` label and a `point` dot, with x/y
// stated once on the composite so both parts inherit them. It knows nothing about
// networks, reads no schema, and attaches no edits.
//
// The dot is the last part on purpose: a composite gives channel edits to its last
// part, and later parts draw on top, so `x: { edit: move() }` grabs the dot.

import { normalizeMarkOptions, markCommon } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { composite } from './composite.js';
import { point } from './point.js';
import { text } from './text.js';

/**
 * Channels that belong to the label. Everything else (fill, size, …) is the dot's.
 * @type {string[]}
 */
const LABEL_CHANNELS = ['text', 'fontSize', 'fontWeight', 'fontStyle', 'fontFamily', 'textAnchor', 'lineAnchor', 'dx'];

/**
 * Channels stated once on the composite so both parts get them.
 * @type {string[]}
 */
const SHARED_CHANNELS = ['x', 'y'];

/**
 * node — a dot with a label, over one row each.
 * @param {any} [options]
 * @returns {any} the parts, flattened by Elicit like any composite
 */
export function node(options = {}) {
    // `dy` stays a raw option: it is the label's offset and must not reach the dot.
    const opts = normalizeMarkOptions(options, {
        mark: 'node',
        except: ['dy'],
        allow: MARK_OPTIONS.node,
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
    // No `text` channel, no label.
    if (channels.text) {
        parts.push(text({
            id: `${name}/label`,
            dy,
            ...(format !== undefined ? { format } : {}),
            channels: { textAnchor: { value: 'middle' }, ...label },
        }));
    }
    // Last: takes the composite's channel edits and draws on top.
    parts.push(point({
        id: `${name}/dot`,
        ...(shape !== undefined ? { shape } : {}),
        channels: dot,
    }));

    return composite({ ...common, channels: shared, parts });
}
