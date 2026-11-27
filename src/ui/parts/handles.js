// @ts-check
import { warn } from '../../core/dev.js';
import { UI_OPTIONS } from '../../vocabulary.js';
import { rootOf, valueOf } from '../bind.js';
import { anchorPoint, nearestView, turnOffset } from '../place.js';
import { warnUnknownUiOptions } from '../guard.js';

// The smallest a grip may make a box, in chart pixels.
const MIN_SIZE = 12;
// How near a side's middle another handle counts as being there, in pixels.
const TAKEN = 8;
// How far a rotate or move grip sits out from its side, past the grip's own radius, in pixels.
const OUT = 14;
// A Shift-drag turns in steps of this many degrees.
const SNAP = 15;

/**
 * Handles on a mark's box. `resize` puts a grip on each side the mark sizes
 * from data: left and right where it binds `width`, top and bottom where it
 * binds `height`. Dragging a grip moves that side and leaves the opposite one
 * where it is. `rotate` puts a grip above the box that turns it, writing the
 * mark's `angle` field. `move` puts a grip below it that moves it, writing its
 * `x` and `y` fields. Each drag is one undo step.
 * @param {import('../../types').HandlesOptions} [options]
 * @returns {import('../../types').UiPart}
 */
export function handles(options = {}) {
    warnUnknownUiOptions('handles', options, UI_OPTIONS.handles);
    const { on = {}, resize = true, rotate = false, move = false } = options;
    return {
        type: 'handles',
        mount(ctx) {
            const { chart } = ctx;
            const doc = ctx.layer.ownerDocument;
            if (!resize && !rotate && !move) return () => {};

            // What each kind of grip needs the mark to bind.
            const fields = (/** @type {string} */ m, /** @type {string} */ ch) => !!chart.scale(ch, { mark: m });
            const can = {
                resize: (/** @type {string} */ m) => fields(m, 'width') || fields(m, 'height'),
                rotate: (/** @type {string} */ m) => fields(m, 'angle'),
                move: (/** @type {string} */ m) => fields(m, 'x') || fields(m, 'y'),
            };
            const asked = /** @type {('resize' | 'rotate' | 'move')[]} */ ([resize && 'resize', rotate && 'rotate', move && 'move'].filter(Boolean));
            // The mark: the one named, else the first that binds what any asked grip needs.
            const marks = on.mark != null ? [on.mark]
                : [...new Set(chart.scene().filter((v) => v.index != null).map((v) => rootOf(v.mark)))];
            const mark = marks.find((m) => asked.some((k) => can[k](m)));
            const where = on.mark != null ? `mark "${on.mark}"` : 'no mark';
            const NEEDS = {
                resize: `a field on its "width" or "height" channel, so there is nothing to resize. Bind one: width: { field, scale: { range } }`,
                rotate: `a field on its "angle" channel, so there is nothing to turn. Bind one: angle: { field }`,
                move: `a field on its "x" or "y" channel, so there is nothing to move`,
            };
            // Resize is on by default: it warns only when asked for, or when it is the only grip.
            const quiet = (/** @type {string} */ k) => k === 'resize' && options.resize === undefined && (rotate || move);
            for (const k of asked) {
                if ((mark == null || !can[k](mark)) && !quiet(k)) warn(`ui:handles:${k}`, `ui.handles: ${mark != null ? `mark "${mark}"` : where} binds ${NEEDS[k]}.`);
            }
            if (mark == null) return () => {};

            // A position channel the grips can write, or null.
            /** @param {'x' | 'y'} axis */
            const posOf = (axis) => {
                const s = chart.scale(axis, { mark });
                return s && s.invert ? valueOf(chart, 'handles', { mark, channel: axis }) : null;
            };
            const positions = { x: posOf('x'), y: posOf('y') };

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

            /**
             * A grip on the active row. `begin` reads the row as the stroke starts, from
             * the point pressed, and returns the stroke's own state (or null to refuse);
             * `apply` writes from that state and the pointer; `key` turns a key into a
             * pointer step for `apply`.
             * Every write of one stroke is one undo step; Escape takes it back.
             * @template S
             * @param {HTMLButtonElement} grip
             * @param {() => import('../../types').Point | null} anchor
             * @param {{ begin: (index: number, body: import('../../types').SceneView, from: import('../../types').Point) => S | null, apply: (state: S, move: { point: import('../../types').Point, dx: number, dy: number, shift: boolean }) => void, key?: (state: S, e: KeyboardEvent) => { point: import('../../types').Point, dx: number, dy: number, shift: boolean } | null }} how
             */
            const addGrip = (grip, anchor, how) => {
                grip.type = 'button';
                grip.hidden = true;
                offs.push(ctx.place(grip, () => (active != null ? anchor() : null)));
                /** @type {{ index: number, state: S, end: () => void, wrote: boolean } | null} */
                let stroke = null;
                const start = (/** @type {import('../../types').Point} */ from) => {
                    if (active == null) return false;
                    const body = bodyOf(active);
                    if (!body || !body.box || !body.center) return false;
                    const state = how.begin(active, body, from);
                    if (state == null) return false;
                    stroke = { index: active, state, end: chart.transaction(), wrote: false };
                    dragging = true;
                    return true;
                };
                /** @param {{ point: import('../../types').Point, dx: number, dy: number, shift: boolean }} m */
                const apply = (m) => {
                    if (!stroke) return;
                    how.apply(stroke.state, m);
                    stroke.wrote = true;
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
                const scale = () => chart.metrics().scale || 1;
                /** @param {{ point: import('../../types').Point, dx: number, dy: number, event: any }} m */
                const read = (m) => ({ point: m.point, dx: m.dx / scale(), dy: m.dy / scale(), shift: !!(m.event && m.event.shiftKey) });
                offs.push(ctx.drag(grip, {
                    start: (m) => { start(m.point); },
                    move: (m) => apply(read(m)),
                    end: (m) => { apply(read(m)); finish(true); },
                    cancel: () => finish(false),
                }));
                const onKey = (/** @type {KeyboardEvent} */ e) => {
                    if (!e.key.startsWith('Arrow')) return;
                    const at = anchor();
                    if (!how.key || !at || !start(at) || !stroke) return;
                    const step = how.key(stroke.state, e);
                    if (step) { e.preventDefault(); apply(step); }
                    finish(true);
                };
                grip.addEventListener('keydown', onKey);
                offs.push(() => { grip.removeEventListener('keydown', onKey); grip.remove(); });
            };

            // ── Resize ──────────────────────────────────────────────────────────
            // One axis of resizing: the size channel beside a position channel.
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
                if (!positions[axis]) warn(`ui:handles:anchor:${axis}`, `ui.handles: mark "${mark}" binds no invertible "${axis}" channel, so a grip resizes it about its centre.`);
                return { axis, sizeChannel, size };
            };
            const axes = resize ? /** @type {NonNullable<ReturnType<typeof axisOf>>[]} */ ([axisOf('x'), axisOf('y')].filter(Boolean)) : [];

            for (const a of axes) {
                for (const dir of [-1, 1]) {
                    const grip = doc.createElement('button');
                    grip.className = 'elicit-ui-handle';
                    grip.dataset.axis = a.axis;
                    const edge = a.axis === 'x' ? (dir < 0 ? 'left' : 'right') : (dir < 0 ? 'top' : 'bottom');
                    grip.setAttribute('aria-label', `Resize from the ${edge}`);
                    // Centred on the middle of that side of the row's box. Where the
                    // row already has a handle there (a port), the grip goes to the
                    // corner after it instead.
                    const corner = a.axis === 'x' ? `bottom-${edge}` : `${edge}-right`;
                    const anchor = () => {
                        const body = active != null ? bodyOf(active) : null;
                        if (!body || active == null) return null;
                        const mid = anchorPoint(body, edge);
                        const taken = !!mid && chart.scene({ mark, index: active }).some((v) => v.channel != null && v.center
                            && Math.hypot(v.center.x - mid.x, v.center.y - mid.y) < TAKEN);
                        if (taken) grip.dataset.corner = ''; else delete grip.dataset.corner;
                        return taken ? anchorPoint(body, corner) : mid;
                    };
                    // The box's own axis on screen, turned with it.
                    const unit = (/** @type {number} */ angle) => turnOffset(a.axis === 'x' ? 1 : 0, a.axis === 'y' ? 1 : 0, angle);
                    /** @typedef {{ at: number, centred: boolean }} Placed */
                    addGrip(grip, anchor, {
                        begin(index, body) {
                            const box = /** @type {import('../../types').Box} */ (body.box);
                            const center = /** @type {import('../../types').Point} */ (body.center);
                            // Where each position channel puts the box: its centre, or its leading edge.
                            /** @param {'x' | 'y'} k @returns {Placed | null} */
                            const placedOn = (k) => {
                                const pos = positions[k];
                                const at = pos && pos.scale.encode ? Number(pos.scale.encode(pos.read(index))) : NaN;
                                if (!Number.isFinite(at)) return null;
                                const lead = k === 'x' ? box.x : box.y;
                                const centre = k === 'x' ? center.x : center.y;
                                return { at, centred: !(Math.abs(at - lead) < 1) || Math.abs(at - centre) < 1 };
                            };
                            // An upright box moves only along the grip's own axis.
                            const angle = body.angle || 0;
                            return {
                                index,
                                size0: a.axis === 'x' ? box.width : box.height,
                                angle,
                                placed: {
                                    x: angle || a.axis === 'x' ? placedOn('x') : null,
                                    y: angle || a.axis === 'y' ? placedOn('y') : null,
                                },
                            };
                        },
                        apply(s, m) {
                            // The pointer's travel along the box's own axis.
                            const u = unit(s.angle);
                            const delta = m.dx * u.x + m.dy * u.y;
                            const [lo, hi] = (a.size.scale.range || [MIN_SIZE, Infinity]).map(Number).sort((p, q) => p - q);
                            // Whole pixels: a pointer's position carries sub-pixel noise.
                            const next = Math.max(Math.max(MIN_SIZE, lo), Math.min(hi, Math.round(s.size0 + dir * delta)));
                            const grew = next - s.size0;
                            a.size.write(s.index, /** @type {any} */ (a.size.scale.invert)(next));
                            // Keep the opposite side still. The centre moves half the growth
                            // along the box's own axis (turned with it); a box placed by its
                            // leading edge also gives back half the growth on that axis.
                            const shift = turnOffset(a.axis === 'x' ? dir * grew / 2 : 0, a.axis === 'y' ? dir * grew / 2 : 0, s.angle);
                            for (const k of /** @type {('x' | 'y')[]} */ (['x', 'y'])) {
                                const pos = positions[k], p = s.placed[k];
                                if (!pos || !p || !pos.scale.invert) continue;
                                const by = shift[k] - (k === a.axis && !p.centred ? grew / 2 : 0);
                                if (Math.abs(by) > 1e-9) pos.write(s.index, pos.scale.invert(p.at + by));
                            }
                        },
                        // Arrow keys step the side, Shift for a larger step.
                        key(s, e) {
                            const along = a.axis === 'x' ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
                            const step = /** @type {any} */ (along)[e.key];
                            if (!step) return null;
                            const u = unit(s.angle);
                            const d = step * (e.shiftKey ? 16 : 4);
                            return { point: { x: 0, y: 0 }, dx: u.x * d, dy: u.y * d, shift: false };
                        },
                    });
                }
            }

            // ── Rotate ──────────────────────────────────────────────────────────
            const turnValue = rotate && can.rotate(mark) ? valueOf(chart, 'handles', { mark, channel: 'angle' }) : null;
            if (turnValue && turnValue.scale.encode && !turnValue.scale.invert) {
                warn('ui:handles:scale:angle', `ui.handles: the "angle" channel of mark "${mark}" has no continuous scale to read an angle back through, so it can't be turned.`);
            } else if (turnValue) {
                const tv = turnValue;
                // The angle drawn, in degrees: through the scale, or the column itself.
                const drawn = (/** @type {number} */ index) => Number(tv.scale.encode ? tv.scale.encode(tv.read(index)) : tv.read(index)) || 0;
                const write = (/** @type {number} */ index, /** @type {number} */ deg) => tv.write(index, tv.scale.invert ? tv.scale.invert(deg) : deg);
                // Out from the middle of the top side, turned with the box.
                const anchor = () => {
                    const body = active != null ? bodyOf(active) : null;
                    const top = body ? anchorPoint(body, 'top') : null;
                    if (!body || !top) return null;
                    const n = turnOffset(0, -1, body.angle || 0);
                    const out = OUT + chart.theme.ui.size / 2;
                    return { x: top.x + n.x * out, y: top.y + n.y * out };
                };
                // The pointer's direction from the centre, in degrees counter-clockwise.
                const bearing = (/** @type {import('../../types').Point} */ c, /** @type {import('../../types').Point} */ p) => Math.atan2(-(p.y - c.y), p.x - c.x) * 180 / Math.PI;
                const grip = doc.createElement('button');
                grip.className = 'elicit-ui-handle';
                grip.dataset.kind = 'rotate';
                grip.setAttribute('aria-label', 'Rotate');
                grip.appendChild(ctx.icon('rotate'));
                addGrip(grip, anchor, {
                    begin(index, body, from) {
                        const c = /** @type {import('../../types').Point} */ (body.center);
                        return { index, c, deg0: drawn(index), b0: bearing(c, from) };
                    },
                    apply(s, m) {
                        // The pointer's turn about the centre since the press, the short way round.
                        const turned = ((bearing(s.c, m.point) - s.b0 + 540) % 360) - 180;
                        let deg = s.deg0 + turned;
                        if (m.shift) deg = Math.round(deg / SNAP) * SNAP;
                        write(s.index, Math.round(deg * 100) / 100);
                    },
                    // Arrow keys turn it: left and up counter-clockwise, Shift for a larger step.
                    key(s, e) {
                        const dir = /** @type {any} */ ({ ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1 })[e.key];
                        if (!dir) return null;
                        const a = (s.b0 + dir * (e.shiftKey ? SNAP : 5)) * Math.PI / 180;
                        return { point: { x: s.c.x + Math.cos(a) * 100, y: s.c.y - Math.sin(a) * 100 }, dx: 0, dy: 0, shift: false };
                    },
                });
            }

            // ── Move ────────────────────────────────────────────────────────────
            if (move && (positions.x || positions.y)) {
                const anchor = () => {
                    const body = active != null ? bodyOf(active) : null;
                    const bottom = body ? anchorPoint(body, 'bottom') : null;
                    if (!body || !bottom) return null;
                    const n = turnOffset(0, 1, body.angle || 0);
                    const out = OUT + chart.theme.ui.size / 2;
                    return { x: bottom.x + n.x * out, y: bottom.y + n.y * out };
                };
                const grip = doc.createElement('button');
                grip.className = 'elicit-ui-handle';
                grip.dataset.kind = 'move';
                grip.setAttribute('aria-label', 'Move');
                grip.appendChild(ctx.icon('move'));
                addGrip(grip, anchor, {
                    begin(index) {
                        /** @param {'x' | 'y'} k */
                        const at = (k) => {
                            const pos = positions[k];
                            const v = pos && pos.scale.encode ? Number(pos.scale.encode(pos.read(index))) : NaN;
                            return Number.isFinite(v) ? v : null;
                        };
                        return { index, x0: at('x'), y0: at('y') };
                    },
                    apply(s, m) {
                        // Whole pixels, like a resize.
                        const dx = Math.round(m.dx), dy = Math.round(m.dy);
                        if (positions.x && s.x0 != null && positions.x.scale.invert) positions.x.write(s.index, positions.x.scale.invert(s.x0 + dx));
                        if (positions.y && s.y0 != null && positions.y.scale.invert) positions.y.write(s.index, positions.y.scale.invert(s.y0 + dy));
                    },
                    // Arrow keys move it, Shift for a larger step.
                    key(s, e) {
                        const d = /** @type {any} */ ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] })[e.key];
                        if (!d) return null;
                        const step = e.shiftKey ? 16 : 4;
                        return { point: { x: 0, y: 0 }, dx: d[0] * step, dy: d[1] * step, shift: false };
                    },
                });
            } else if (move) {
                warn('ui:handles:move:scale', `ui.handles: mark "${mark}" binds no "x" or "y" channel with a continuous scale to read a position back through, so it can't be moved.`);
            }

            // The grips show on the row the pointer is near.
            /** @param {number | null} index */
            const setActive = (index) => {
                if (index === active) return;
                active = index;
                ctx.refresh();
            };
            // How near the pointer must come: past a box's side to reach a grip out from it.
            const reach = chart.theme.ui.size + (rotate || move ? OUT + chart.theme.ui.size : 0);
            offs.push(ctx.onPointer((e) => {
                if (dragging) return;
                const target = /** @type {any} */ (e.event.target);
                if (target && target.closest && target.closest('.elicit-ui-handle')) return;
                if (e.type === 'leave' || !e.point) { setActive(null); return; }
                if (e.type !== 'move') return;
                // A drag elsewhere on the chart: out of its way.
                if (/** @type {any} */ (e.event).buttons) { setActive(null); return; }
                const bodies = chart.scene({ mark }).filter((v) => v.index != null && v.box && v.channel == null && !v.locked);
                const near = nearestView(bodies, e.point, reach);
                setActive(near && near.index != null ? near.index : null);
            }));

            return () => { offs.splice(0).forEach((off) => off()); };
        },
    };
}
