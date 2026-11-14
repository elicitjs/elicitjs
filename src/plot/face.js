// @ts-check
// face.js — an expressive emotion face (a Chernoff-style glyph), built out of
// ordinary marks.
//
//   Elicit({
//     schema: { valence: { type: 'quantitative', domain: [-1, 1] },
//               arousal: { type: 'quantitative', domain: [-1, 1] } },
//     data: [{ valence: 0, arousal: 0 }],
//     marks: [ face() ],                // preset: mouth = valence, eyes = arousal
//   })
//
// A preset: a box-mode `composite` (plot/composite.js) of a head `point`, two
// `ellipse` eyes, two `tickY` brows and a `curveY` mouth. Each parameter is a
// channel on one part, edited with the ordinary edits:
//
//   PARAM        PART / CHANNEL              MEANING                  natural edit
//   mouthCurve   mouth  curvature   deep frown ∩ ↔ deep smile ∪   slide({ axis:'y', increase:'up' })
//   mouthAsym    mouth  angle       centred ↔ smirk               rotate({ pivot:'mark', pick:'direct' })
//   eyeScale     eyes   rx          pinpricks ↔ wide              slide({ axis:'x', increase:'right' })
//   eyeSquint    eyes   ry          round ↔ flat/squished         slide({ axis:'y', increase:'down' })
//   browHeight   brows  y           slammed down ↔ high arch      slide({ axis:'y', increase:'up' })
//   browTilt     brows  angle       outer-down (sad) ↔ inner-down rotate({ pivot:'mark', pick:'direct' })
//   x / y        box    x / y       where the face sits           move()
//   size         box    size        how big it is                 resize()
//
// x / y / size are the composite's own channels: the box is a grab target over the
// whole glyph, so `move()` there moves the face while a drag on an eye edits the eye.
//
// The face is inert until an edit names a column:
//
//   face({ channels: {
//     mouthCurve: { field: 'valence', edit: slide({ axis: 'y', increase: 'up' }) },
//     browTilt:   { field: 'anger',   edit: rotate({ pivot: 'mark', pick: 'direct' }) },
//   } })
//
// A param takes `{ field }` to elicit it, or `{ value: 0..1 }` (a fraction of its
// travel, 0.5 neutral); left out, it is neutral. Zero-config `face()` binds
// mouthCurve ← valence and eyeScale ← arousal; binding any param drops that preset.
//
// Geometry constants are in the local frame: x and y in [-1, 1] from the centre
// with y up, magnitudes as a fraction of the radius.

import { composite } from './composite.js';
import { point } from './point.js';
import { ellipse } from './ellipse.js';
import { tickY } from './tick.js';
import { curveY } from './curve.js';
import { normalizeMarkOptions, withoutEdit } from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';

/** @param {number} x @returns {number} */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// The face's parameters. Binding none of them applies the emotion preset.
/** @type {string[]} */
const FACE_PARAMS = ['mouthCurve', 'mouthAsym', 'eyeScale', 'eyeSquint', 'browHeight', 'browTilt'];

// Local-frame geometry. x/y in frame units (y up), radii as a fraction of R.
const G = {
    ink: '#1f2937',
    headFill: '#FFD666',
    headStroke: '#B7791F',
    headStrokeWidth: 0.03,
    lineWidth: 0.055,
    // Eyes
    eyeX: 0.40,
    eyeY: 0.16,
    // rx: pinprick → wide. ry runs the other way (squint flattens); its top is the
    // neutral rx, so an unsquinted eye is round at neutral aperture.
    eyeRx: [0.055, 0.185],
    eyeRy: [0.12, 0.03],
    eyeNeutral: 0.12,
    // Brows: inner and outer ends, and the height they travel through.
    browInner: 0.14,
    browOuter: 0.50,
    browY: [0.23, 0.57],
    // Tilt in degrees about the brow's midpoint, mirrored left/right so both brows
    // make the same expression.
    browTiltRight: [-45, 45],
    browTiltLeft: [45, -45],
    // Mouth: the chord and how far it bows. Positive curvature bows up, so a smile
    // is negative; the descending range makes a rising value deepen the ∪.
    mouthY: -0.34,
    mouthX: 0.36,
    mouthCurve: [0.67, -0.67],
    mouthAsym: [-20, 20],
};

/**
 * @param {any} [options]
 * @returns {any[]} the group's features, for Elicit's flattened list
 */
export function face(options = {}) {
    const opts = normalizeMarkOptions(options, { mark: 'face', allow: MARK_OPTIONS.face });
    const { id, edits, table, clip, ink = G.ink } = opts;

    /** @type {Record<string, any>} */
    const channels = { ...opts.channels };
    if (!FACE_PARAMS.some((p) => channels[p])) {
        channels.mouthCurve = { field: 'valence' };
        channels.eyeScale = { field: 'arousal' };
    }

    // A parameter as a part's channel: a field maps onto `range` through a frame
    // scale; a `{ value }` (or the neutral default) is a fraction of that range.
    /**
     * @param {string} name @param {number[]} range @param {number} [neutral]
     * @returns {any}
     */
    const param = (name, range, neutral = 0.5) => {
        const spec = channels[name];
        if (spec && spec.field != null) {
            // An author-declared scale or frame wins.
            return spec.scale !== undefined || spec.frame !== undefined
                ? spec
                : { ...spec, frame: range };
        }
        const t = spec && spec.value !== undefined ? clamp01(+spec.value) : neutral;
        // A local constant; `{ value }` would mean pixels.
        return { frame: range[0] + t * (range[1] - range[0]) };
    };

    /** A pinned position in the local frame. @param {number} u */
    const at = (u) => ({ frame: u });
    /** A magnitude as a fraction of the face's radius. @param {number} u */
    const of = (u) => ({ frame: u });

    const eyeRx = param('eyeScale', G.eyeRx, (G.eyeNeutral - G.eyeRx[0]) / (G.eyeRx[1] - G.eyeRx[0]));
    // An unbound squint keeps the eye round: ry follows rx, without rx's edit so
    // it doesn't fire twice per drag.
    const eyeRy = channels.eyeSquint
        ? param('eyeSquint', G.eyeRy)
        : withoutEdit(eyeRx);

    const browHeight = param('browHeight', G.browY);
    const lineWidth = of(G.lineWidth);

    // Named parts, so warnings and the DOM say `face/eye-left`, not `face/3`.
    const glyph = id || 'face';
    /** @param {string} part */
    const partId = (part) => `${glyph}/${part}`;
    /** @param {number} sign */
    const side = (sign) => (sign < 0 ? 'left' : 'right');

    /** @param {number} sign @param {number[]} tilt */
    const brow = (sign, tilt) => tickY({
        id: partId(`brow-${side(sign)}`),
        channels: {
            x1: at(sign * G.browInner),
            x2: at(sign * G.browOuter),
            y: browHeight,
            angle: param('browTilt', tilt),
            stroke: { value: ink },
            strokeWidth: lineWidth,
        }
    });

    /** @param {number} sign */
    const eye = (sign) => ellipse({
        id: partId(`eye-${side(sign)}`),
        channels: {
            x: at(sign * G.eyeX),
            y: at(G.eyeY),
            rx: eyeRx,
            ry: eyeRy,
            fill: { value: ink },
            stroke: { value: 'none' },
        }
    });

    return composite({
        id: glyph,
        edits,
        table,
        clip,
        // The placement channels define the box, edits included.
        channels: {
            x: channels.x,
            y: channels.y,
            size: channels.size,
            // On a network's node table, where links meet the face: its head.
            ...(channels.ports ? { ports: channels.ports } : {}),
        },
        parts: [
            // Head: the box's half-size, at its origin.
            point({
                id: partId('head'),
                channels: {
                    size: of(1),
                    fill: channels.fill || { value: G.headFill },
                    stroke: channels.stroke || { value: G.headStroke },
                    strokeWidth: channels.strokeWidth || of(G.headStrokeWidth),
                }
            }),
            eye(-1),
            eye(1),
            brow(-1, G.browTiltLeft),
            brow(1, G.browTiltRight),
            // Mouth last, so its stroke reads over the head's fill.
            curveY({
                id: partId('mouth'),
                channels: {
                    x1: at(-G.mouthX),
                    x2: at(G.mouthX),
                    y: at(G.mouthY),
                    curvature: param('mouthCurve', G.mouthCurve),
                    angle: param('mouthAsym', G.mouthAsym),
                    stroke: { value: ink },
                    strokeWidth: lineWidth,
                }
            }),
        ],
    });
}
