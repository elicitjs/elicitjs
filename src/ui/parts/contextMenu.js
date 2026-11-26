// @ts-check
import { warn } from '../../core/dev.js';
import { UI_OPTIONS } from '../../vocabulary.js';
import { findEdit, rootOf, rowsIn, valueOf } from '../bind.js';
import { warnUnknownUiOptions } from '../guard.js';

// What an edit-backed item says when the author gives no label.
/** @param {import('../../types').EditInfo} e */
const defaultsFor = (e) => /** @type {{ label: string, icon?: string, tone?: 'danger' }} */ (
    e.cardinality === 'delete' ? { label: 'Remove', icon: 'trash', tone: 'danger' }
        : e.cardinality === 'append' ? { label: 'Add', icon: 'plus' }
            : { label: e.name || e.type });

/**
 * Turn the author's entries into menu rows for one right-click.
 * @param {import('../../types').UiContext} ctx
 * @param {import('../../types').MenuEntry[]} entries
 * @param {import('../../types').MenuTarget} target
 * @returns {import('../../types').MenuItem[]}
 */
export function resolveEntries(ctx, entries, target) {
    const { chart } = ctx;
    const { view, point } = target;
    const onRow = !!view && view.index != null && view.table != null;
    /** @type {import('../../types').MenuItem[]} */
    const out = [];
    for (const entry of entries || []) {
        if (!entry) continue;
        if (entry.separator) { out.push({ separator: true }); continue; }
        if (entry.heading != null && entry.edit == null && entry.channel == null) { out.push({ heading: entry.heading }); continue; }

        // Where the entry shows: empty space, or pieces of one mark.
        if (entry.on === 'plane' && onRow) continue;
        if (entry.on != null && entry.on !== 'plane' && !(view && (view.mark === entry.on || rootOf(view.mark) === entry.on))) continue;

        const info = entry.edit != null ? findEdit(chart, 'contextMenu', { name: entry.edit }) : null;
        if (entry.edit != null && !info) continue;
        const creates = !!info && info.cardinality === 'append' && info.pick !== 'direct';

        // A value: one row per choice. With a creating edit, "add one of each".
        if (entry.channel != null) {
            const mark = entry.mark != null ? entry.mark : (creates && info ? rootOf(info.mark) : view ? rootOf(view.mark) : undefined);
            if (!creates && !(onRow && view && mark != null && rootOf(view.mark) === rootOf(mark))) continue;
            if (creates && onRow) continue;
            // No mark named: the entry is for marks under the pointer that bind the channel.
            if (entry.mark == null && !creates) {
                const bound = chart.scale(entry.channel, { mark });
                if (!bound || bound.field == null) continue;
            }
            const value = valueOf(chart, 'contextMenu', { mark, channel: entry.channel });
            if (!value) continue;
            const values = entry.values || value.values;
            if (!values || !values.length) {
                warn(`ui:menu:values:${entry.channel}`, `ui.contextMenu: the "${entry.channel}" channel has no list of values to choose from (its scale is continuous or unset). Pass \`values\`.`);
                continue;
            }
            const index = view && view.index != null ? view.index : -1;
            const current = creates ? undefined : value.read(index);
            if (entry.label !== false) out.push({ heading: typeof entry.label === 'string' ? entry.label : (creates ? 'Add' : value.field) });
            for (const v of values) {
                out.push({
                    label: String(v),
                    ...(value.swatch(v) ? { swatch: /** @type {string} */ (value.swatch(v)) } : {}),
                    ...(creates ? {} : { checked: Object.is(current, v) }),
                    onSelect: () => {
                        if (!creates || !info || info.name == null) { value.write(index, v); return; }
                        // The new row and its value are one undo step.
                        const end = chart.transaction();
                        try {
                            const before = rowsIn(chart, value.table).length;
                            chart.control(info.name).emit({ type: info.gesture, x: point.x, y: point.y });
                            if (rowsIn(chart, value.table).length === before + 1) value.write(before, v);
                        } finally { end(); }
                    },
                });
            }
            continue;
        }

        // An edit: fire it on the row, or at the point for one that creates.
        if (info && info.name != null) {
            const name = info.name;
            const d = defaultsFor(info);
            if (creates) {
                if (onRow) continue;
                out.push({
                    label: typeof entry.label === 'string' ? entry.label : d.label,
                    icon: entry.icon != null ? entry.icon : d.icon,
                    onSelect: () => chart.control(name).emit({ type: info.gesture, x: point.x, y: point.y }),
                });
                continue;
            }
            if (!onRow || !view || view.table !== info.table) continue;
            const here = chart.edits({ mark: info.mark, index: /** @type {number} */ (view.index) }).find((e) => e.name === name);
            if (!here) continue;
            const index = /** @type {number} */ (view.index);
            out.push({
                label: typeof entry.label === 'string' ? entry.label : d.label,
                icon: entry.icon != null ? entry.icon : d.icon,
                ...(entry.tone || d.tone ? { tone: entry.tone || d.tone } : {}),
                disabled: !here.available,
                onSelect: () => chart.control(name, index).fire(),
            });
            continue;
        }

        // The author's own row.
        if (typeof entry.label === 'string') {
            const onSelect = entry.onSelect;
            out.push({
                label: entry.label,
                ...(entry.icon != null ? { icon: entry.icon } : {}),
                ...(entry.tone ? { tone: entry.tone } : {}),
                ...(entry.disabled ? { disabled: true } : {}),
                onSelect: () => { if (typeof onSelect === 'function') onSelect(target); },
            });
        }
    }
    // No separator first, last or doubled, and no heading with nothing under it.
    return out.filter((item, i) => {
        const next = out[i + 1];
        if (item.separator) return i > 0 && !!next && !next.separator && !out[i - 1].separator;
        if (item.heading != null) return !!next && !next.separator && next.heading == null;
        return true;
    });
}

// With no `items`: what the spec's named edits offer. Add on empty space, the
// value edits and Remove on a row.
/** @param {import('../../types').Chart} chart @returns {import('../../types').MenuEntry[]} */
function autoEntries(chart) {
    /** @type {import('../../types').MenuEntry[]} */
    const out = [];
    const named = chart.edits().filter((e) => e.name != null);
    for (const e of named) if (e.cardinality === 'append' && e.pick !== 'direct') out.push({ edit: /** @type {string} */ (e.name) });
    for (const e of named) {
        if (e.gesture !== 'commit' || e.cardinality) continue;
        for (const channel of e.channels) {
            const s = chart.scale(channel, { mark: e.mark });
            if (s && s.kind && s.kind !== 'continuous' && s.domain && s.domain.length) out.push({ channel, mark: e.mark });
        }
    }
    out.push({ separator: true });
    for (const e of named) if (e.cardinality === 'delete' && e.pick === 'direct') out.push({ edit: /** @type {string} */ (e.name) });
    return out;
}

/**
 * A menu on right-click, over a mark or over empty space. Each entry is an
 * edit to fire (`{ edit }`), a channel whose value to choose (`{ channel }`),
 * both (add a row with that value), or a row of your own (`{ label, onSelect }`).
 * With no `items`, the menu offers what the spec's named edits allow.
 * @param {import('../../types').ContextMenuOptions} [options]
 * @returns {import('../../types').UiPart}
 */
export function contextMenu(options = {}) {
    warnUnknownUiOptions('contextMenu', options, UI_OPTIONS.contextMenu);
    return {
        type: 'contextMenu',
        mount(ctx) {
            const { chart } = ctx;
            return ctx.onPointer((e) => {
                if (e.type !== 'menu' || !e.point) return;
                const view = chart.hit(e.point, { reach: 4 });
                /** @type {import('../../types').MenuTarget} */
                const target = { view, point: e.point };
                const entries = typeof options.items === 'function' ? options.items(target)
                    : options.items || autoEntries(chart);
                const items = resolveEntries(ctx, entries, target);
                if (!items.length) return;
                // Ours: the browser's menu stays shut.
                e.event.preventDefault();
                ctx.menu(items, e.point);
            });
        },
    };
}
