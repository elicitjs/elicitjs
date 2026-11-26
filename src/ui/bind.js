// @ts-check
// How a part finds what it drives: a named edit the spec declares, or for a
// value in an existing cell, the column behind a mark's channel.
import { warn } from '../core/dev.js';

/**
 * A glyph's id from one of its parts' ("note/body" -> "note").
 * @param {string} mark
 * @returns {string}
 */
export const rootOf = (mark) => String(mark).split('/')[0];

/**
 * The declared edit a part should drive. By `name` when the author gives one
 * (a missing one warns); otherwise the first edit `where` accepts. An edit found
 * that way with no name warns too: only a named edit can be driven.
 * @param {import('../types').Chart} chart
 * @param {string} part the part asking, for the message
 * @param {{ name?: string | null, where?: (e: import('../types').EditInfo) => boolean }} want
 * @returns {import('../types').EditInfo | null}
 */
export function findEdit(chart, part, want) {
    const all = chart.edits();
    if (want.name != null) {
        const named = all.find((e) => e.name === want.name);
        if (!named) {
            const names = all.map((e) => e.name).filter(Boolean);
            warn(`ui:edit:none:${want.name}`, `ui.${part}: no edit is named "${want.name}", so nothing drives this action. Named edits: ${names.length ? names.map((n) => `"${n}"`).join(', ') : 'none'}.`);
        }
        return named || null;
    }
    const found = want.where ? all.find(want.where) : null;
    if (!found) return null;
    if (found.name == null) {
        warn(`ui:edit:unnamed:${found.type}:${found.mark}`, `ui.${part}: the ${found.type} edit on mark "${found.mark}" has no name, so the UI can't drive it. Name it in the spec, e.g. { name: "${found.type.split('.').pop()}" }.`);
        return null;
    }
    return found;
}

/**
 * A table's rows as `getData()` reports them.
 * @param {import('../types').Chart} chart
 * @param {string | null} table
 * @returns {any[]}
 */
export function rowsIn(chart, table) {
    const data = /** @type {any} */ (chart.getData());
    if (Array.isArray(data)) return data;
    return (table != null && data && data[table]) || [];
}

/**
 * The value behind a mark's channel, for a menu or a handle: its column, the
 * values it takes, and a `write` that uses a declared value edit on that channel
 * when the spec has one and `chart.set` when it has none. Either way the
 * dataset's constraints, lock and undo run.
 * @param {import('../types').Chart} chart
 * @param {string} part
 * @param {{ mark?: string, channel: string }} where
 * @returns {import('../types').UiValue | null}
 */
export function valueOf(chart, part, where) {
    const { mark, channel } = where;
    const scale = chart.scale(channel, mark != null ? { mark } : {});
    if (!scale || scale.field == null) {
        warn(`ui:channel:${mark || ''}:${channel}`, `ui.${part}: ${mark != null ? `mark "${mark}"` : 'no mark'} binds no field on its "${channel}" channel, so there is no value to write.`);
        return null;
    }
    const field = scale.field;
    const table = scale.table;
    // A declared value edit on the channel: a named commit that neither adds nor removes rows.
    const declared = chart.edits(mark != null ? { mark } : {}).find((e) => e.name != null && e.gesture === 'commit'
        && !e.cardinality && e.channels.includes(channel)) || null;
    const paints = channel === 'fill' || channel === 'stroke';
    return {
        channel, field, table, scale,
        edit: declared ? declared.name : null,
        values: scale.kind && scale.kind !== 'continuous' ? scale.domain : null,
        swatch: (value) => (paints && scale.encode ? String(scale.encode(value)) : null),
        read: (index) => { const row = rowsIn(chart, table)[index]; return row ? row[field] : undefined; },
        write(index, value) {
            if (declared && declared.name != null) chart.control(declared.name, index).set(value);
            else chart.set(field, value, { index, ...(table != null ? { table } : {}) });
        },
    };
}
