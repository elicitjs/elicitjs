// @ts-check
// text.js — a per-datum label mark (Observable Plot's text). It places a string at
// a positional (x, y) and reads its label, size, anchor and rotation from channels,
// so a label is data like every other mark's encoding:
//
//   elicit.plot.text({
//     channels: {
//       x:    { field: "gdp" },       // linear position
//       y:    { field: "life" },      // linear position
//       text: { field: "country" },   // the string to draw (raw, unscaled)
//     },
//     dy: -8,                         // pixel offset above the point
//     lineAnchor: 'bottom',           // vertical anchor (top·middle·bottom)
//     format: '.1f',                  // d3-format string (or a function)
//   })
//
// x/y resolve positionally through the GLOBAL scales (encodeChannel), exactly like
// point. `text`/`fontSize`/`textAnchor`/`lineAnchor`/`dx`/`dy` are NON-positional
// — there is no scale for them — so the mark reads them raw (a field's value, or
// a `{ value }`/shorthand constant). `angle` is degrees: read through its scale
// when one is declared (so a rotate() edit can map a gesture back through the
// same scale), else raw. `format` is a mark-level option (string | fn), display-
// only — the underlying field stays the raw value.
//
// A text mark is EDITABLE like any other: a direct-pick edit on it makes the label
// interactive (the renderer wires drag + click and, on the content-edit path,
// double-click to retype). `move({ channels:['x','y'] })` repositions it; a value
// channel carrying the same field as `text` turns it into a draggable numeric
// readout; `cycle()` advances a categorical label; `rotate()` on `angle` spins it;
// `editText()` (edit/basic.js) retypes its content.
//
//   text  — position from x AND y
//   textX — value on x, y parked at the vertical centre (a 1-D label along x)
//   textY — value on y, x parked at the horizontal centre (a 1-D label along y)

import { encodeChannel, encodeAngle, resolveStyle, normalizeMarkOptions, callChannelFn, markDefaults, positionalKeys, markCommon} from './mark.js';
import { warn } from '../core/dev.js';
import { resolveFormat } from '../format.js';

/**
 * Map a Plot-style lineAnchor to an SVG dominant-baseline.
 * @param {string} anchor
 * @returns {string}
 */
function dominantBaselineOf(anchor) {
    switch (anchor) {
        case 'top': return 'text-before-edge';
        case 'bottom': return 'text-after-edge';
        case 'middle':
        default: return 'central';
    }
}

/**
 * Read a non-positional channel raw: a field's value, a `{ value }` constant, else
 * the fallback. No scale — these channels (text/fontSize/textAnchor/…) are literals.
 * A derived channel (`{ fn }`, e.g. `text: d => …`) is computed per datum.
 * @param {Record<string, any>} channels
 * @param {string} name
 * @param {any} datum
 * @param {any} fallback
 * @param {number} [index] row index, passed to a derived channel's fn
 * @param {import('../types').Datum[]} [data] the dataset, passed to a derived fn
 * @returns {any}
 */
function rawChannel(channels, name, datum, fallback, index, data) {
    const spec = channels[name];
    if (!spec) return fallback;
    if (spec.field != null) {
        const v = datum[spec.field];
        return v == null ? fallback : v;
    }
    // Derived channel — fn(d, i, data) computed in visual space (no scale here anyway).
    if (typeof spec.fn === 'function') {
        return callChannelFn(spec, name, datum, index, data, fallback);
    }
    if (spec.value !== undefined) return spec.value;
    // `{ datum }` means "a constant in DATA space — put it through the scale". These
    // channels have no scale (a label's string, its font size, its dx nudge are the
    // output already), so `{ datum }` and `{ value }` would be two spellings of one
    // thing. Say so rather than silently accepting either.
    if (spec.datum !== undefined) {
        warn(
            `rawdatum:${name}`,
            `channel "${name}" on a text mark has no scale — its value IS the output — so ` +
            `{ datum: … } has nothing to go through. Use { value: … } for a constant.`
        );
    }
    return fallback;
}

/**
 * Does this mark wire content editing (an editText edit, at mark level or on a
 * channel)? The renderer only opens its inline text editor for nodes that opt in,
 * so a merely-draggable label doesn't pop an input on double-click.
 * @param {any[]} edits
 * @param {Record<string, any>} channels
 * @returns {boolean}
 */
export function hasEditText(edits, channels) {
    if ((edits || []).some((e) => e && e.type === 'editText')) return true;
    return Object.values(channels).some((c) => c && c.edit && c.edit.type === 'editText');
}

/**
 * A text FeatureNode at an ALREADY-RESOLVED pixel position. Everything about a
 * label except where it sits — the string, font, anchors, rotation, dx/dy nudge,
 * the editText opt-in, the style sweep — is positional-system agnostic, so it is
 * defined once here. `text` resolves (px, py) through the global x/y scales;
 * `geoText` projects lon/lat through the chart projection and hands the pixels in.
 *
 * dx/dy are visual-only offsets applied AFTER positioning (a drag still inverts
 * the raw pointer, so a nudged label doesn't poison its own edit).
 *
 * @param {import('../types').ScaleMap} scales
 * @param {Record<string, any>} channels
 * @param {any} d the datum
 * @param {number} i its index in the dataset
 * @param {number} px @param {number} py resolved position, before dx/dy
 * @param {{ format?: (v: any) => any, canEditText?: boolean, data?: import('../types').Datum[] }} [opts]
 * @returns {import('../types').FeatureNode}
 */
export function textNodeAt(scales, channels, d, i, px, py, opts = {}) {
    const { format = (/** @type {any} */ v) => v, canEditText = false, data } = opts;
    const style = resolveStyle(scales, channels, d, markDefaults(scales, 'text', { fill: '#111' }), i, data);

    const dx = +rawChannel(channels, 'dx', d, 0, i, data) || 0;
    const dy = +rawChannel(channels, 'dy', d, 0, i, data) || 0;

    // Angle: math degrees via the shared encodeAngle path (scaled when a scale
    // exists so rotate() is an exact inverse; else raw). The renderer converts
    // to SVG with rotate(-deg) about the label's anchor.
    const angle = encodeAngle(scales, channels, d, 0, i, data);

    const lineAnchor = rawChannel(channels, 'lineAnchor', d, 'middle', i, data);

    return {
        type: 'text',
        x: px + dx,
        y: py + dy,
        text: format(rawChannel(channels, 'text', d, '', i, data)),
        fontSize: rawChannel(channels, 'fontSize', d, 12, i, data),
        textAnchor: rawChannel(channels, 'textAnchor', d, 'middle', i, data),
        lineAnchor,
        dominantBaseline: dominantBaselineOf(lineAnchor),
        ...(angle ? { angle } : {}),
        ...(canEditText ? { editText: true } : {}),
        ...style,
        data: d,
        index: i,
    };
}

/**
 * @param {any} options
 * @param {'x' | 'y' | null} forcedAxis the single positional axis (textX/textY)
 * @returns {import('../types').Mark}
 */
function buildText(options, forcedAxis) {
    const opts = normalizeMarkOptions(options, { mark: 'text', allow: ['format'] });
    const { channels = {}, id, edits, constraints, format: formatOpt } = opts;
    const canEditText = hasEditText(edits, channels);
    const format = resolveFormat(formatOpt);

    return {
        ...markCommon(opts),
        markName: 'text',
        channels,
        // A label sits AT a category (a tick, no interval) when an axis is discrete.
        discreteScale: 'point',
        ...positionalKeys(channels),

        /**
         * @param {any[]} currentData
         * @param {import('../types').ScaleMap} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            return currentData.map((d, i) => {
                // Position: each axis through its global scale, parked at the centre
                // when the axis isn't used (textX/textY force the counter-axis centre).
                const x = forcedAxis === 'y'
                    ? width / 2
                    : encodeChannel(scales, channels, 'x', d, width / 2, i, currentData);
                const y = forcedAxis === 'x'
                    ? height / 2
                    : encodeChannel(scales, channels, 'y', d, height / 2, i, currentData);
                return textNodeAt(scales, channels, d, i, x, y, { format, canEditText, data: currentData });
            });
        }
    };
}

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function text(options = {}) {
    return buildText(options, null);
}

/**
 * A 1-D label along x: value on x, parked at the vertical centre.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function textX(options = {}) {
    return buildText(options, 'x');
}

/**
 * A 1-D label along y: value on y, parked at the horizontal centre.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function textY(options = {}) {
    return buildText(options, 'y');
}
