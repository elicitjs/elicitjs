// @ts-check
import { UI_OPTIONS } from '../../vocabulary.js';
import { findEdit } from '../bind.js';
import { nearestView } from '../place.js';
import { driveStroke } from '../stroke.js';
import { hoverGroup } from '../hover.js';
import { warnUnknownUiOptions } from '../guard.js';

/** Do two views name the same drawn piece? @param {any} a @param {any} b */
export const samePiece = (a, b) => !!a && !!b && a.mark === b.mark && a.index === b.index
    && a.channel === b.channel && a.side === b.side && a.type === b.type;

/**
 * Icon buttons beside the drawn piece the pointer is near. Each item is an edit
 * to drive (`{ edit, icon, label }`) or a button of your own (`{ onClick }`). A
 * click-gesture edit fires on the row; a drag edit is dragged from its button,
 * or clicked and then aimed with a second click.
 *
 * The buttons stay while the pointer travels to them, and the piece they belong
 * to is lit as the chart lights a hovered mark.
 * @param {import('../../types').ActionsOptions} [options]
 * @returns {import('../../types').UiPart}
 */
export function actions(options = {}) {
    warnUnknownUiOptions('actions', options, UI_OPTIONS.actions);
    const { on = {}, items = [], reach = 24, placement = 'top-right' } = options;
    return {
        type: 'actions',
        mount(ctx) {
            const { chart } = ctx;
            const gap = chart.theme.ui.gap;

            // The edits behind the items, found once: the marks never change.
            const bound = items.map((item) => ({
                item,
                info: item.edit != null ? findEdit(chart, 'actions', { name: item.edit }) : null,
            })).filter((b) => b.item.edit == null || b.info);
            // The edit that lights a row: any the items name.
            const lighter = bound.map((b) => b.info).find((i) => i && i.name != null) || null;

            /** @typedef {{ view: import('../../types').SceneView, at: import('../../types').Point }} Target */
            // A line has no corner to sit on: its buttons go where the pointer met it.
            const onLine = (/** @type {import('../../types').SceneView} */ v) => v.type === 'path' || v.type === 'line';
            /** @param {Target} t */
            const viewNow = (t) => chart.scene({ mark: t.view.mark, ...(t.view.index != null ? { index: t.view.index } : {}) })
                .find((v) => samePiece(v, t.view)) || null;

            const group = hoverGroup(ctx, {
                /** @returns {Target | null} */
                find(point) {
                    const pieces = chart.scene(on).filter((v) => v.index != null && v.center && (v.visible || on.channel != null));
                    // The piece under the pointer wins; else the nearest box within reach.
                    const under = chart.hit(point, { reach: Math.min(reach, 10) });
                    let near = under ? pieces.find((v) => samePiece(v, under))
                        || pieces.find((v) => v.table === under.table && v.index === under.index && v.channel == null) : null;
                    if (!near) near = nearestView(pieces.filter((v) => !onLine(v) || on.channel != null), point, reach);
                    return near ? { view: near, at: point } : null;
                },
                same: (a, b) => samePiece(a.view, b.view),
                anchor: (t) => (onLine(t.view) ? t.at : viewNow(t)),
                placement: (t) => (onLine(t.view) ? { at: 'top', offset: gap + 4 } : { at: placement, offset: gap }),
                light(t, lit) {
                    if (!lighter || lighter.name == null || t.view.index == null || t.view.table !== lighter.table) return;
                    chart.control(lighter.name, t.view.index).emit({ type: lit ? 'pointerover' : 'pointerout' });
                },
                build(t, add, onClear) {
                    const view = t.view;
                    for (const { item, info } of bound) {
                        if (typeof item.show === 'function' && !item.show(view)) continue;
                        if (info) {
                            if (view.table !== info.table || view.index == null) continue;
                            const here = chart.edits({ mark: info.mark, index: view.index }).find((e) => e.name === info.name);
                            if (!here || !here.available) continue;
                        }
                        const btn = ctx.button({ icon: item.icon, label: item.label, tone: item.tone });
                        // Name the handle only on the edit's own mark; elsewhere the row is enough.
                        const ref = () => (view.index != null ? {
                            index: view.index,
                            ...(info && view.mark === info.mark && view.channel != null ? { channel: view.channel } : {}),
                            ...(info && view.mark === info.mark && view.side != null ? { side: view.side } : {}),
                        } : null);
                        if (info && info.name != null && info.gesture === 'drag') {
                            onClear(driveStroke(ctx, btn, info.name, ref, {
                                onStart: () => group.busy(true),
                                onDone: () => { group.busy(false); group.show(null); },
                            }));
                        } else {
                            btn.addEventListener('click', () => {
                                group.show(null);
                                if (info && info.name != null && view.index != null) chart.control(info.name, /** @type {any} */ (ref() || view.index)).fire();
                                else if (typeof item.onClick === 'function') item.onClick(view);
                            });
                        }
                        add(btn);
                    }
                },
            });

            return () => group.dispose();
        },
    };
}
