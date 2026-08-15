// @ts-check
// guides.remaining — how much of a budget is still unallocated, and where the
// running total currently stands against its target.
//
//   guides.remaining({ field: 'y', total: 100 })
//   guides.remaining({ field: 'tokens', total: 20, unit: 'token' })
//
// ── Why this is a GUIDE and not a mark ──────────────────────────────────────
// It is the clearest case of the third feature kind. What it draws is not a row —
// no row holds "the remainder" — and it is not a scale. It is a statement about
// the chart's STATE under a RULE: given these rows and a target sum, how much is
// left to place. Its arity is per-CHART (one statement, however many rows there
// are), and it can never be edited: you change the remainder by moving a bar, not
// by dragging the remainder.
//
// That is the whole discriminator. A mark channel can already be DERIVED
// (`{ fn }`), so "computed from the data" is not what separates the kinds — arity
// and writability are. A `{ fn }` channel is per-row and its mark may still carry
// an `edit`; a guide's expressions are per-chart and it carries none.
//
// ── Where the total comes from ──────────────────────────────────────────────
// Usually a `maintainSum` constraint is already enforcing it, and repeating the
// number in two places is how the two drift. So `total` is optional: with none,
// the guide asks the chart's own constraints what the target is. The rule the
// reader is being held to and the rule they are shown are then the same object.

import { resolveGuideOptions, warnUnknownGuideOptions } from './shared.js';

/**
 * `remaining`'s option vocabulary. Exported so one list drives the diagnostics,
 * the docs table, and (later) the JSON grammar.
 * @type {string[]}
 */
export const REMAINING_OPTIONS = ['field', 'total', 'unit', 'format', 'anchor', 'label', 'fill', 'fontSize'];

/**
 * The target sum this chart is already enforcing, read off its constraints, or
 * null when nothing does. `maintainSum` (and its `normalize` preset) stamp their
 * configuration on the constraint so a guide can read it without the author
 * declaring the number twice.
 * @param {any[]} constraints
 * @param {string} field
 * @returns {number | null}
 */
function targetFromConstraints(constraints, field) {
    for (const c of constraints || []) {
        // `defineConstraint` stamps its metadata on the constraint function:
        // `constraintType` names the rule, `options` carries its configuration,
        // `field` the column it governs. That is the same metadata an edit's
        // `guide: true` already reads to draw a channel's bounds.
        const spec = /** @type {any} */ (c);
        if (!spec || spec.constraintType !== 'maintainSum') continue;
        if (spec.field != null && field != null && spec.field !== field) continue;
        const target = spec.options && spec.options.targetSum;
        if (typeof target === 'number') return target;
    }
    return null;
}

/**
 * remaining — a read-only statement of what is left to allocate.
 *
 * Options (each may be a literal or a function of the chart context, like every
 * guide option — see guides/shared.js):
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
    warnUnknownGuideOptions('remaining', options, REMAINING_OPTIONS);
    return {
        views: 'state',
        build: (rows, _scales, width, height, ctx) => {
            const t = (ctx && ctx.theme && ctx.theme.guide && ctx.theme.guide.rule) || {};
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
                : targetFromConstraints((ctx && ctx.constraints) || [], field);
            // Nothing to be remaining OF. Silent rather than warned: a guide draws a
            // statement, and "there is no target" makes the statement meaningless
            // rather than wrong.
            if (target == null) return [];

            const used = data.reduce((sum, d) => {
                const v = d && d[field];
                return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
            }, 0);
            const left = target - used;

            const fmt = typeof format === 'function'
                ? format
                : (/** @type {number} */ v) => {
                    const rounded = Math.round(v * 100) / 100;
                    return String(rounded);
                };

            let text;
            if (typeof label === 'function') {
                text = String(label(left, used, target));
            } else if (unit) {
                const n = Math.round(left);
                text = `${fmt(left)} ${unit}${n === 1 ? '' : 's'} left`;
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
                // A guide never takes the pointer. The engine tags every guide node,
                // but stating it here keeps the node correct in isolation too.
                pointerEvents: 'none',
                guide: true,
            }];
        },
    };
}
