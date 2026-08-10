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
// ── A PRESET, not a mark ────────────────────────────────────────────────────
// `face()` returns a `composite` in box mode (plot/composite.js): a head
// `point`, two `ellipse` eyes, two `tickY` brows and a `curveY` mouth, each a
// real feature placed in the glyph's local box. It draws nothing a spec author
// couldn't assemble
// themselves — assembling it is the point, and the parts are the documentation
// of how a frame-scaled glyph is put together.
//
// The old face was one feature carrying seven handles over one datum, arbitrated
// through a private `dm` descriptor and a private `edit.face.*` namespace, for
// parameters that are all plain fields. That is precisely the case the glyph rule
// says to build as a group of marks (see CLAUDE.md), and it cost the face
// everything the ordinary path gives for free: per-part direct-pick isolation,
// the standard edits, hover/effects per feature, and an author's ability to
// replace one part.
//
// So there is no `edit.face.*` any more. Each parameter is a channel on a
// concrete part, edited with the universal edits:
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
// The last two are the COMPOSITE's own channels — the box the parts live in. It
// is a real grab target covering the whole glyph, so a `move()` there picks the
// face up bodily (including by the gaps between its features) while a drag on an
// eye still edits only the eye.
//
// (`mouthOpen` is gone. Its filled cavity was a second derived path over the
// same curve, not a mark, and it was the one parameter that could not be
// expressed as a channel on a simple shape.)
//
// The face is INERT until an edit names a column, like every other mark: bind a
// param to a field and attach the edit you want.
//
//   face({ channels: {
//     mouthCurve: { field: 'valence', edit: slide({ axis: 'y', increase: 'up' }) },
//     browTilt:   { field: 'anger',   edit: rotate({ pivot: 'mark', pick: 'direct' }) },
//   } })
//
// ── Parameters are still CHANNELS ───────────────────────────────────────────
// Bind a field with `{ field }` to elicit it; pin a fixed expression with
// `{ value: 0..1 }` (a fraction of the parameter's visual travel — 0.5 is
// neutral); leave it out for neutral. Zero-config `face()` applies the emotion
// preset (mouthCurve ← valence, eyeScale ← arousal); binding ANY param replaces
// the preset outright, so an unbound default never names a field the schema lacks.
//
// ── Geometry ────────────────────────────────────────────────────────────────
// Every constant below is in the group's LOCAL frame: x and y in [-1, 1] from
// the face's centre with y UP, magnitudes as a fraction of its radius. They are
// the same proportions the hand-built face drew at, now stated as data rather
// than as arithmetic on R — which is what lets each one be a scale a gesture
// inverts through.

import { composite } from './composite.js';
import { point } from './point.js';
import { ellipse } from './ellipse.js';
import { tickY } from './tick.js';
import { curveY } from './curve.js';
import { normalizeMarkOptions } from './mark.js';

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
    // rx: pinprick → wide. ry runs the other way: squint FLATTENS the eye. Its top
    // is the NEUTRAL rx, not the widest one, so an unsquinted eye is round at
    // neutral aperture and a widened one reads as wide-eyed rather than merely big.
    eyeRx: [0.055, 0.185],
    eyeRy: [0.12, 0.03],
    eyeNeutral: 0.12,
    // Brows: inner and outer ends, and the height they travel through.
    browInner: 0.14,
    browOuter: 0.50,
    browY: [0.23, 0.57],
    // Tilt in degrees about the brow's own midpoint, mirrored left/right so a
    // rising value tilts both brows into the same EXPRESSION rather than the same
    // direction. Two private frame scales, so the mirroring is in the mapping.
    browTiltRight: [-45, 45],
    browTiltLeft: [45, -45],
    // Mouth: the chord, and how far it bows. Positive curvature bows to the left
    // of travel (up, for a rightward chord), so a smile is NEGATIVE — hence the
    // descending range: a rising valence deepens the ∪.
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
    const opts = normalizeMarkOptions(options, { mark: 'face', allow: ['ink'] });
    const { id, edits, constraints, table, ink = G.ink } = opts;

    /** @type {Record<string, any>} */
    const channels = { ...opts.channels };
    if (!FACE_PARAMS.some((p) => channels[p])) {
        channels.mouthCurve = { field: 'valence' };
        channels.eyeScale = { field: 'arousal' };
    }

    // A parameter as a part's channel. A field goes through a PRIVATE frame scale
    // mapping the field's declared domain onto this feature's travel — private so
    // the two brows can mirror each other, and so a face's `angle` can't collide
    // with a needle's. A `{ value }` is a fraction of that same travel (0.5 is
    // neutral), which is what an unbound param falls back to.
    /**
     * @param {string} name @param {number[]} range @param {number} [neutral]
     * @returns {any}
     */
    const param = (name, range, neutral = 0.5) => {
        const spec = channels[name];
        if (spec && spec.field != null) {
            // An author-declared range wins — that is how a preset is overridden.
            return spec.scale !== undefined || spec.frame !== undefined
                ? spec
                : { ...spec, frame: range };
        }
        const t = spec && spec.value !== undefined ? clamp01(+spec.value) : neutral;
        // A LOCAL constant, not a `{ value }`: the number is a position in the
        // glyph's own box, and `{ value }` would put a brow at pixel 0.4 instead of
        // 40% of the way up the face.
        return { frame: range[0] + t * (range[1] - range[0]) };
    };

    /** A pinned position in the local frame. @param {number} u */
    const at = (u) => ({ frame: u });
    /** A magnitude as a fraction of the face's radius. @param {number} u */
    const of = (u) => ({ frame: u });

    const eyeRx = param('eyeScale', G.eyeRx, (G.eyeNeutral - G.eyeRx[0]) / (G.eyeRx[1] - G.eyeRx[0]));
    // An unbound squint leaves a ROUND eye, so ry follows rx rather than sitting at
    // its own neutral — otherwise widening the eyes would also un-round them. Its
    // EDIT is stripped, though: rx already carries it, and the same edit on both
    // radii would fire twice per drag and make the field doubly addressable.
    /** @param {any} spec */
    const noEdit = (spec) => {
        if (!spec) return spec;
        const { edit: _edit, ...rest } = spec;
        return rest;
    };
    const eyeRy = channels.eyeSquint
        ? param('eyeSquint', G.eyeRy)
        : noEdit(eyeRx);

    const browHeight = param('browHeight', G.browY);
    const lineWidth = of(G.lineWidth);

    // Every part is named, so a dev warning and the DOM both say which feature of
    // the face they mean rather than `face/3`.
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
        constraints,
        edits,
        table,
        // The author's placement channels define the face's box — verbatim, edits
        // included: the box is a real grab target, so a `move()` / `resize()` here
        // takes hold of the whole glyph and every part follows.
        channels: {
            x: channels.x,
            y: channels.y,
            size: channels.size,
        },
        parts: [
            // Head. Exactly the box's half-size, at its origin — it states no
            // position because "here, at the glyph" is what saying nothing means.
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
