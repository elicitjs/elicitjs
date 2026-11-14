// @ts-check
// arc.js: pie / donut slices. Each row's `theta` magnitude is stacked into an
// angular span (a stacked bar in polar form) and drawn as an annular sector.
//
//   arc({
//     outerRadius: 100, innerRadius: 40,   // donut
//     channels: {
//       theta: { field: 'share' },         // magnitude → slice width
//       fill:  { field: 'party' },
//     },
//   })
//
// Binding `x` and/or `y` to a field makes one donut per distinct position; the
// rows at that position are its slices. Radius: `outerRadius` (px), else a
// per-donut `size` field, else a fit to the slot.
//
//   donut({
//     channels: {
//       x:     { field: 'state' },         // band axis → one donut per state
//       theta: { field: 'share' },
//       fill:  { field: 'party' },
//       size:  { field: 'voters' },        // optional
//     },
//     edits: [edit.stack.edge()],          // drag a boundary within one donut
//   })
//
// A boundary drag moves share between two adjacent slices of one donut and keeps
// that donut's total fixed. The magnitude is `theta` (a polar position), not
// `angle` (a rotation in place).

import { encodeChannel, resolveStyle, normalizeMarkOptions, markDefaults, resolveHandles, handlePaint, markCommon} from './mark.js';
import { MARK_OPTIONS } from '../vocabulary.js';
import { warn } from '../core/dev.js';
import { arcSpan, arcPath, polarToXY } from './polar.js';
import { isBand, bandwidthOf } from '../core/scales.js';
import { groupByPosition, stackLayout, stackDescriptor } from './stack.js';

/**
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function arc(options = {}) {
    const opts = normalizeMarkOptions(options, {
        mark: 'arc',
        allow: MARK_OPTIONS.arc,
    });
    const {
        channels = {},
        edits,
        outerRadius: outerOpt,
        innerRadius = 0,
        padAngle = 0,
        arc: arcOpt,
        start,
        end,
        // Rim dots between slices (node.edge). Drawn only when a stack edit is wired.
        handles = true,
        handleSize,
        handleColor,
    } = opts;

    const markEdits = edits || [];
    // Boundary handles address a row pair, so only stack edits arm them.
    const editable = markEdits.some((/** @type {any} */ e) => e && e.scope === 'stack');

    const [spanStart, spanEnd] = arcSpan({
        arc: arcOpt || 'full',
        start: start != null ? start : (arcOpt ? undefined : -180),
        end: end != null ? end : (arcOpt ? undefined : 180),
    });
    const thetaField = channels.theta && channels.theta.field;

    return {
        ...markCommon(opts),
        type: 'arc',
        channels,
        // `theta` is raw on arc: the mark normalizes its own magnitudes, so no theta
        // scale (and no radial axis or legend) is built. `needle` scales it instead.
        rawChannels: ['theta'],
        // The `radius` scale's px extent; build() fits the ring by the same rule
        // (core/encoding.js radiusExtent).
        radiusRange: { inner: innerRadius, outer: outerOpt != null ? outerOpt : null },
        edits: markEdits,
        // A categorical x/y holds one donut per band.
        discreteScale: 'band',
        // No category axis, so xKey stays undefined.
        yKey: thetaField,
        // A pie partitions one total, so edit.stack.* works on it.
        supportsStack: true,
        /**
         * @param {any[]} currentData
         * @param {any} scales
         * @param {number} width
         * @param {number} height
         * @returns {import('../types').FeatureNode[]}
         */
        build: (currentData, scales, width, height) => {
            // One donut per distinct x/y position (one bucket when neither is bound).
            // Rows keep their global index and first-seen order.
            const bucketList = groupByPosition(currentData, channels, ['x', 'y']);

            // Default outer radius: fit a band cell, or shrink in a scatter of several.
            const bandX = isBand(scales.x), bandY = isBand(scales.y);
            const cellW = bandX ? bandwidthOf(scales.x, width) : width;
            const cellH = bandY ? bandwidthOf(scales.y, height) : height;
            const fitR = (bandX || bandY)
                ? 0.42 * Math.min(cellW, cellH)
                : (bucketList.length > 1 ? 0.14 : 0.4) * Math.min(width, height);

            const span = spanEnd - spanStart;
            const pad = padAngle;

            /** @type {import('../types').FeatureNode[]} */
            const nodes = [];
            const handleStyle = resolveHandles(scales, { handles, handleSize, handleColor });
            const arcDefaults = markDefaults(scales, 'arc', { fill: '#4f46e5', stroke: '#fff', strokeWidth: 1 });

            bucketList.forEach((bucket) => {
                const rep = bucket.rep;
                const members = bucket.members;
                // A slot's position and radius come from its first row.
                const repIndex = members[0];
                const cx = encodeChannel(scales, channels, 'x', rep, width / 2, repIndex, currentData);
                const cy = encodeChannel(scales, channels, 'y', rep, height / 2, repIndex, currentData);
                // Outer radius: explicit px > per-donut `size` field > fit default.
                // With a `radius` channel each slice takes its own rim (a rose).
                const outer = outerOpt != null
                    ? outerOpt
                    : (channels.size && !channels.radius ? encodeChannel(scales, channels, 'size', rep, fitR, repIndex, currentData) : fitR);
                if (channels.radius && channels.size) {
                    warn('arc:radius:size', 'arc(): both `size` and `radius` are bound; `radius` (per slice) wins and `size` is ignored.');
                }
                if (channels.radius && (bucketList.length > 1 || bandX || bandY)) {
                    warn('arc:radius:slots', 'arc(): a `radius` channel on a gridded arc (x/y bound) uses the single-ring extent for every slot.');
                }
                // innerRadius in (0,1] is a ratio of outer; >1 is px, clamped inside.
                const innerR = innerRadius > 0 && innerRadius <= 1
                    ? innerRadius * outer
                    : Math.min(innerRadius, outer * 0.95);

                // Magnitudes in data units via the shared stack walk (plot/stack.js);
                // a negative or non-finite magnitude occupies no interval.
                const mags = thetaField != null
                    ? stackLayout(members, currentData, thetaField).mags
                    : members.map((/** @type {number} */ gi) => {
                        const enc = encodeChannel(scales, channels, 'theta', currentData[gi], 0, gi, currentData);
                        return Number.isFinite(enc) && enc > 0 ? Number(enc) : 0;
                    });
                const total = mags.reduce((/** @type {number} */ a, /** @type {number} */ b) => a + b, 0);
                const nSlices = members.length;
                // The span is signed (`start: 90, end: -270` runs clockwise), so padding
                // is taken out in the span's own direction.
                const dir = Math.sign(span) || 1;
                const usable = total > 0 ? span - dir * pad * nSlices : 0;
                if (total > 0 && dir * usable <= 0) {
                    warn(
                        'arc:span',
                        `arc(): the angular span from ${spanStart}° to ${spanEnd}° leaves no room ` +
                        `once ${nSlices} slices of padAngle ${pad}° are taken out, so nothing is ` +
                        `drawn. Widen the span or reduce padAngle.`
                    );
                }

                // Pointer -> cumulative value is an angle about this donut's centre.
                // Pure data; edit/stack.js re-derives from live data.
                /** @type {any} */
                const geometry = { kind: 'angular', cx, cy, spanStart, spanEnd, pad };

                // Trailing edge angle of each slice, by local slice position.
                /** @type {Record<number, number>} */
                const edgeAngle = {};
                let cursor = spanStart + dir * pad / 2;

                members.forEach((/** @type {number} */ gi, /** @type {number} */ local) => {
                    const d = currentData[gi];
                    const share = total > 0 ? mags[local] / total : 0;
                    const sweep = usable * share;
                    const a0 = cursor;
                    const a1 = cursor + sweep;
                    cursor = a1 + dir * pad;
                    edgeAngle[local] = a1;

                    if (dir * sweep <= 0) return;

                    const style = resolveStyle(scales, channels, d, arcDefaults, gi, currentData);
                    // The slice's own rim: through the radius scale when bound.
                    const sliceOuter = channels.radius
                        ? Math.max(innerR, Number(encodeChannel(scales, channels, 'radius', d, outer, gi, currentData)))
                        : outer;
                    const pathD = arcPath(cx, cy, sliceOuter, a0, a1, { innerRadius: innerR });
                    if (!pathD) return;

                    nodes.push({
                        type: 'path',
                        d: pathD,
                        ...style,
                        cx, cy,
                        index: gi,
                        // Not `angle`: that is a rotation the renderer applies to the node.
                        midAngle: (a0 + a1) / 2,
                        a0, a1,
                        // What edit.stack.* inverts through.
                        stack: stackDescriptor({ members, local, field: thetaField, geometry }),
                        // Filled-region hit area for edit/pick.js (a bare `d` has none on canvas).
                        sector: { cx, cy, r0: innerR, r1: sliceOuter, a0, a1 },
                    });
                });

                // Boundary handles: n-1 per donut of n slices. The seam at spanStart is
                // the fixed anchor, so it gets no handle.
                if (editable && handleStyle.grabbable && total > 0 && nSlices > 1) {
                    for (let local = 0; local < nSlices - 1; local++) {
                        const angle = edgeAngle[local] + pad / 2;
                        const p = polarToXY(cx, cy, outer, angle);
                        nodes.push({
                            type: 'circle',
                            cx: p.x, cy: p.y,
                            // On the outer rim, centred in the pad gap.
                            r: handleStyle.size,
                            ...handlePaint(handleStyle),
                            cursor: 'grab',
                            index: members[local],
                            // The pair it separates.
                            edge: true,
                            loIndex: members[local],
                            hiIndex: members[local + 1],
                            stack: stackDescriptor({ members, local, field: thetaField, geometry }),
                        });
                    }
                }
            });

            return nodes;
        },
    };
}

/**
 * An arc with a default inner radius: 0.55 × outerRadius when pinned, else the
 * ratio 0.55.
 * @param {any} [options]
 * @returns {import('../types').Mark}
 */
export function donut(/** @type {any} */ options = {}) {
    const inner = options.innerRadius != null
        ? options.innerRadius
        : (options.outerRadius != null ? options.outerRadius * 0.55 : 0.55);
    return arc({ ...options, arc: options.arc || 'full', innerRadius: inner });
}
