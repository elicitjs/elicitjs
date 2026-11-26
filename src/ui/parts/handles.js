// @ts-check
import { warn } from '../../core/dev.js';
import { UI_OPTIONS } from '../../vocabulary.js';
import { rootOf, valueOf } from '../bind.js';
import { anchorPoint, nearestView } from '../place.js';
import { warnUnknownUiOptions } from '../guard.js';

// The smallest a grip may make a box, in chart pixels.
const MIN_SIZE = 12;
// How near a side's middle another handle counts as being there, in pixels.
const TAKEN = 8;

/**
 * Handles on a mark's box. `resize` puts a grip on each side the mark sizes
 * from data: left and right where it binds `width`, top and bottom where it
 * binds `height`. Dragging a grip moves that side and leaves the opposite one
 * where it is, as one undo step.
 * @param {import('../../types').HandlesOptions} [options]
 * @returns {import('../../types').UiPart}
 */
export function handles(options = {}) {
    warnUnknownUiOptions('handles', options, UI_OPTIONS.handles);
    const { on = {}, resize = true } = options;
    return {
        type: 'handles',
        mount(ctx) {
            const { chart } = ctx;
            const doc = ctx.layer.ownerDocument;
            if (!resize) return () => {};

            // The mark to size: the one named, else the first that binds a width or a height.
            const marks = on.mark != null ? [on.mark]
                : [...new Set(chart.scene().filter((v) => v.index != null).map((v) => rootOf(v.mark)))];
            const mark = marks.find((m) => chart.scale('width', { mark: m }) || chart.scale('height', { mark: m }));
            if (mark == null) {
                warn('ui:handles:resize', `ui.handles: ${on.mark != null ? `mark "${on.mark}"` : 'no mark'} binds a field on its "width" or "height" channel, so there is nothing to resize. Bind one: width: { field, scale: { range } }.`);
                return () => {};
            }

            // One axis of resizing: the size channel and the position channel beside it.
            /** @param {'x' | 'y'} axis */
            const axisOf = (axis) => {
                const sizeChannel = axis === 'x' ? 'width' : 'height';
                if (!chart.scale(sizeChannel, { mark })) return null;
                const size = valueOf(chart, 'handles', { mark, channel: sizeChannel });
                if (!size) return null;
                if (!size.scale.invert) {
                    warn(`ui:handles:scale:${sizeChannel}`, `ui.handles: the "${sizeChannel}" channel of mark "${mark}" has no continuous scale to read a size back through, so it can't be resized.`);
                    return null;
                }
                const posScale = chart.scale(axis, { mark });
                const pos = posScale && posScale.invert ? valueOf(chart, 'handles', { mark, channel: axis }) : null;
                if (!pos) warn(`ui:handles:anchor:${axis}`, `ui.handles: mark "${mark}" binds no invertible "${axis}" channel, so a grip resizes it about its centre.`);
                return { axis, sizeChannel, size, pos };
            };
            const axes = /** @type {NonNullable<ReturnType<typeof axisOf>>[]} */ ([axisOf('x'), axisOf('y')].filter(Boolean));
            if (!axes.length) return () => {};

            // The row's box: the largest piece the mark draws for it.
            /** @param {number} index */
            const bodyOf = (index) => chart.scene({ mark, index })
                .filter((v) => v.box && v.channel == null)
                .sort((a, b) => /** @type {any} */ (b.box).width * /** @type {any} */ (b.box).height - /** @type {any} */ (a.box).width * /** @type {any} */ (a.box).height)[0] || null;

            /** @type {number | null} */
            let active = null;
            let dragging = false;
            /** @type {(() => void)[]} */
            const offs = [];

            for (const a of axes) {
                for (const dir of [-1, 1]) {
                    const grip = doc.createElement('button');
                    grip.type = 'button';
                    grip.className = 'elicit-ui-handle';
                    grip.dataset.axis = a.axis;
                    const edge = a.axis === 'x' ? (dir < 0 ? 'left' : 'right') : (dir < 0 ? 'top' : 'bottom');
                    grip.setAttribute('aria-label', `Resize from the ${edge}`);
                    grip.hidden = true;
                    // Centred on the middle of that side of the row's box. Where the
                    // row already has a handle there (a port), the grip goes to the
                    // corner after it instead.
                    const corner = a.axis === 'x' ? `bottom-${edge}` : `${edge}-right`;
                    offs.push(ctx.place(grip, () => {
                        const body = active != null ? bodyOf(active) : null;
                        if (!body || active == null) return null;
                        const mid = anchorPoint(body, edge);
                        const taken = !!mid && chart.scene({ mark, index: active }).some((v) => v.channel != null && v.center
                            && Math.hypot(v.center.x - mid.x, v.center.y - mid.y) < TAKEN);
                        if (taken) grip.dataset.corner = ''; else delete grip.dataset.corner;
                        return taken ? anchorPoint(body, corner) : mid;
                    }));

                    /** @type {{ index: number, size0: number, pos0: number | null, centred: boolean, end: () => void, wrote: boolean } | null} */
                    let stroke = null;
                    const start = () => {
                        if (active == null) return false;
                        const body = bodyOf(active);
                        if (!body || !body.box || !body.center) return false;
                        const size0 = a.axis === 'x' ? body.box.width : body.box.height;
                        const lead = a.axis === 'x' ? body.box.x : body.box.y;
                        const centre = a.axis === 'x' ? body.center.x : body.center.y;
                        // Where the position channel puts the box: its centre, or its leading edge.
                        const at = a.pos && a.pos.scale.encode ? Number(a.pos.scale.encode(a.pos.read(active))) : NaN;
                        const centred = !(Math.abs(at - lead) < 1) || Math.abs(at - centre) < 1;
                        stroke = { index: active, size0, pos0: Number.isFinite(at) ? at : null, centred, end: chart.transaction(), wrote: false };
                        dragging = true;
                        return true;
                    };
                    /** @param {number} delta the pointer's travel along the axis, in chart pixels */
                    const apply = (delta) => {
                        if (!stroke) return;
                        const s = stroke;
                        const [lo, hi] = (a.size.scale.range || [MIN_SIZE, Infinity]).map(Number).sort((p, q) => p - q);
                        // Whole pixels: a pointer's position carries sub-pixel noise.
                        const next = Math.max(Math.max(MIN_SIZE, lo), Math.min(hi, Math.round(s.size0 + dir * delta)));
                        const grew = next - s.size0;
                        a.size.write(s.index, /** @type {any} */ (a.size.scale.invert)(next));
                        // Keep the opposite side still: a centred box moves by half; a box
                        // placed by its leading edge moves only when that edge is dragged.
                        if (a.pos && s.pos0 != null && a.pos.scale.invert) {
                            const shift = s.centred ? dir * grew / 2 : (dir < 0 ? -grew : 0);
                            if (shift) a.pos.write(s.index, a.pos.scale.invert(s.pos0 + shift));
                        }
                        s.wrote = true;
                    };
                    /** @param {boolean} keep */
                    const finish = (keep) => {
                        if (!stroke) return;
                        const s = stroke;
                        stroke = null;
                        dragging = false;
                        s.end();
                        if (!keep && s.wrote) chart.undo();
                    };
                    const travel = (/** @type {{ dx: number, dy: number }} */ m) => (a.axis === 'x' ? m.dx : m.dy) / (chart.metrics().scale || 1);
                    offs.push(ctx.drag(grip, {
                        start: () => { start(); },
                        move: (m) => apply(travel(m)),
                        end: (m) => { apply(travel(m)); finish(true); },
                        cancel: () => finish(false),
                    }));
                    // Arrow keys step the side, Shift for a larger step.
                    const onKey = (/** @type {KeyboardEvent} */ e) => {
                        const along = a.axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
                        const step = /** @type {any} */ (along)[e.key];
                        if (!step) return;
                        e.preventDefault();
                        if (start()) { apply(step * (e.shiftKey ? 16 : 4)); finish(true); }
                    };
                    grip.addEventListener('keydown', onKey);
                    offs.push(() => { grip.removeEventListener('keydown', onKey); grip.remove(); });
                }
            }

            // The grips show on the row the pointer is near.
            /** @param {number | null} index */
            const setActive = (index) => {
                if (index === active) return;
                active = index;
                ctx.refresh();
            };
            offs.push(ctx.onPointer((e) => {
                if (dragging) return;
                const target = /** @type {any} */ (e.event.target);
                if (target && target.closest && target.closest('.elicit-ui-handle')) return;
                if (e.type === 'leave' || !e.point) { setActive(null); return; }
                if (e.type !== 'move') return;
                // A drag elsewhere on the chart: out of its way.
                if (/** @type {any} */ (e.event).buttons) { setActive(null); return; }
                const bodies = chart.scene({ mark }).filter((v) => v.index != null && v.box && v.channel == null && !v.locked);
                const near = nearestView(bodies, e.point, chart.theme.ui.size);
                setActive(near && near.index != null ? near.index : null);
            }));

            return () => { offs.splice(0).forEach((off) => off()); };
        },
    };
}
