// @ts-check
import { GUIDE_OPTIONS } from '../vocabulary.js';
// guides.remaining: how much of a budget is still unallocated.
//
//   guides.remaining({ field: 'y', total: 100 })
//   guides.remaining({ field: 'tokens', total: 20, unit: 'token' })
//
// With no `total`, the target is read from the chart's `maintainSum` constraint.

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';
import { resolveFormat } from '../format.js';

/**
 * The `total` of a `maintainSum` constraint on `field`, or null when there is none.
 * @param {any[]} constraints
 * @param {string} field
 * @returns {number | null}
 */
function targetFromConstraints(constraints, field) {
    for (const c of constraints || []) {
        // A constraint descriptor carries `type`, `options` and `field`.
        const spec = /** @type {any} */ (c);
        if (!spec || spec.type !== 'maintainSum') continue;
        if (spec.field != null && field != null && spec.field !== field) continue;
        const target = spec.options && spec.options.total;
        if (typeof target === 'number') return target;
    }
    return null;
}

/**
 * A read-only statement of what is left to allocate. Each option may be a
 * literal or a function of the chart context.
 *   field    the column being allocated (default 'y')
 *   total    the target sum; omitted, it is read from a `maintainSum` constraint
 *   unit     singular noun for the countable phrasing ('token' -> "3 tokens left")
 *   format   a d3 specifier or a formatter for the number
 *   anchor   'top-right' (default) | 'top-left' | 'bottom-right' | 'bottom-left'
 *   label    override the whole string: (remaining, used, total) => string
 * @param {{ field?: any, total?: any, unit?: any, format?: any, anchor?: any,
 *   label?: any, fill?: any, fontSize?: any }} [options]
 * @returns {import('../types').Guide}
 */
export function remaining(options = {}) {
    warnUnknownGuideOptions('remaining', options, GUIDE_OPTIONS.remaining);
    return {
        views: 'state',
        type: 'remaining',
        build: (rows, _scales, width, height, ctx) => {
            const t = ctx?.theme?.guide?.rule || {};
            const {
                field = 'y',
                total,
                unit,
                format,
                anchor = 'top-right',
                label,
                fill = t.stroke || '#64748b',
                fontSize = 11,
            } = resolveGuideOptions(options, ctx);

            const data = rows || [];
            const target = typeof total === 'number'
                ? total
                : targetFromConstraints(ctx?.constraints || [], field);
            // No target: draw nothing, silently.
            if (target == null) return [];

            const used = data.reduce((sum, d) => {
                const v = d && d[field];
                return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
            }, 0);
            const left = target - used;

            // `format` is a function or a d3-format specifier; the default rounds
            // to two decimals.
            const fmt = format != null
                ? resolveFormat(format)
                : (/** @type {number} */ v) => {
                    const rounded = Math.round(v * 100) / 100;
                    return String(rounded);
                };

            let text;
            if (typeof label === 'function') {
                text = String(label(left, used, target));
            } else if (unit) {
                // `unit` is a noun, or a [singular, plural] pair for an irregular plural.
                const shown = fmt(left);
                const one = shown === '1' || shown === '1.0' || Math.abs(left - 1) < 1e-9;
                const [singular, plural] = Array.isArray(unit)
                    ? [unit[0], unit[1] != null ? unit[1] : unit[0]]
                    : [unit, /^[%°]|^[^a-zA-Z]+$/.test(String(unit)) ? unit : `${unit}s`];
                text = `${shown} ${one ? singular : plural} left`;
            } else {
                text = `${fmt(left)} of ${fmt(target)} left`;
            }

            const right = anchor.endsWith('right');
            const top = anchor.startsWith('top');
            return [{
                type: 'text',
                x: right ? width - 4 : 4,
                y: top ? 12 : height - 6,
                text,
                fill,
                fontSize,
                textAnchor: right ? 'end' : 'start',
                // The engine also tags guide nodes pointer-transparent; this keeps
                // the node correct on its own.
                pointerEvents: 'none',
                guide: true,
            }];
        },
    };
}
