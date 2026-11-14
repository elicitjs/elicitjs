// @ts-check
// define.js: the constraint descriptor, option checking, and `applyConstraint`,
// the one place a constraint runs.
//
// A constraint is a data invariant over one table's rows, checked on every commit:
//   { type, field?, options, table?, guide?, apply(ctx) }
// `apply` returns a number (the active datum's `field`), an object (merged into
// the active datum), an array (replacement rows), `false` (reject) or
// `true` / `undefined` (accept). `field` omitted is the column the dispatching
// edit writes. A bare function `(newData, oldData, ctx) => rows | boolean` also works.

import { scaleFor } from '../core/scales.js';
import { warn, warningsEnabled } from '../core/dev.js';
import { CONSTRAINT_OPTIONS } from '../vocabulary.js';

/**
 * The declared data range of a field, from the scale of the channel that encodes it.
 * @param {string | undefined} field
 * @param {any} scales
 * @param {any} markChannels
 * @returns {number[] | undefined}
 */
function domainOfField(field, scales, markChannels) {
  if (!field || !scales || !markChannels) return undefined;
  for (const key of Object.keys(markChannels)) {
    const spec = markChannels[key];
    if (!spec || spec.field !== field) continue;
    const s = scaleFor(scales, key, field);
    if (!s) continue;
    if (s.domainConfig) return s.domainConfig;
    if (typeof s.domain === "function") return s.domain();
  }
  return undefined;
}

/**
 * Mistaken option keys, with the correction to show.
 * @type {Record<string, string>}
 */
const MISTAKEN_CONSTRAINT_OPTIONS = {
  targetSum: 'the total is `total` — maintainSum({ total: 100 }) — the same word guides.remaining uses.',
  fields: 'the columns a rule is about are `field`, singular, which takes one name or an ordered list: ordering({ field: ["lo", "mean", "hi"] }).',
  lower: 'ordering takes its columns as one ordered list: ordering({ field: ["lo", "hi"] }).',
  upper: 'ordering takes its columns as one ordered list: ordering({ field: ["lo", "hi"] }).',
  mode: 'what a constraint does when its rule is broken is `strategy` (cap | normalize | redistribute | push | block | reject | replace).',
};

/**
 * Warn on options a constraint factory does not read, and return them unchanged.
 * @template T
 * @param {string} type the factory name
 * @param {T} options
 * @returns {T}
 */
export function constraintOptions(type, options) {
  if (!options || !warningsEnabled()) return options;
  const allow = CONSTRAINT_OPTIONS[type] || [];
  for (const key of Object.keys(options)) {
    if (allow.includes(key)) continue;
    const fix = MISTAKEN_CONSTRAINT_OPTIONS[key];
    warn(
      `constraintopt:${type}:${key}`,
      fix
        ? `${type}({ ${key}: … }): ${fix}`
        : `${type}({ ${key}: … }) is not an option this constraint reads, so it is ignored. ` +
          `${type} options are: ${allow.slice().sort().join(', ')}.`,
    );
  }
  return options;
}

/**
 * Are two cell values the same? Dates compare by time, so a re-wrapped Date is
 * not a change.
 * @param {any} a @param {any} b @returns {boolean}
 */
function sameCell(a, b) {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  return Object.is(a, b);
}

/**
 * Every `(row, field)` in `ctx.fields` that differs from `oldData` (all fields of
 * an appended row), plus the active datum's `field`. A rule repairs every one of
 * these, not just `ctx.value`, since pushes and stacks move other cells too.
 * @param {import('../types').ConstraintContext} ctx
 * @returns {{ i: number, field: string }[]}
 */
export function changedCells(ctx) {
  const { data, oldData, activeIndex, field, fields } = ctx;
  /** @type {{ i: number, field: string }[]} */
  const cells = [];
  const seen = new Set();
  /** @param {number} i @param {string} f */
  const push = (i, f) => {
    const key = `${i}\u0000${f}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ i, field: f });
  };
  if (activeIndex != null && activeIndex >= 0 && activeIndex < data.length && field != null) {
    push(activeIndex, field);
  }
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const before = oldData ? oldData[i] : undefined;
    if (!row) continue;
    for (const f of fields) {
      if (!before || !sameCell(row[f], before[f])) push(i, f);
    }
  }
  return cells;
}

/**
 * Normalize a constraint spec into the descriptor (the counterpart of `makeEdit`).
 * @param {{ type: string, field?: string | string[], options?: Record<string, any>,
 *   table?: string, guide?: (ctx: any) => any[], apply: (ctx: import('../types').ConstraintContext) => any }} spec
 * @returns {import('../types').ConstraintSpec}
 */
export function makeConstraint(spec) {
  return {
    type: spec.type,
    field: spec.field,
    options: spec.options || {},
    ...(spec.table != null ? { table: spec.table } : {}),
    ...(typeof spec.guide === 'function' ? { guide: spec.guide } : {}),
    apply: spec.apply,
  };
}

/**
 * Author a constraint from a rule over the data-only context (`constraints.custom`).
 * The rule returns a value, an object, replacement rows, or `false` to reject;
 * the active datum, field, domain and result handling are done for you.
 * @param {(ctx: import('../types').ConstraintContext) => any} reducer
 * @param {{ type?: string, field?: string | string[], options?: Record<string, any>,
 *   table?: string, guide?: (ctx: any) => any[] }} [meta]
 * @returns {import('../types').ConstraintSpec}
 */
export function defineConstraint(reducer, meta = {}) {
  return makeConstraint({ ...meta, type: meta.type || 'custom', apply: reducer });
}

/**
 * Run one constraint over a proposal. A bare function is called directly; a
 * descriptor gets the data-only context and its result normalized. `field` is
 * the constraint's own, else the column the dispatching edit writes.
 * @param {import('../types').Constraint} constraint
 * @param {any[]} newData
 * @param {any[]} oldData
 * @param {any} context the engine's { activeIndex, scales, markChannels, tables, table, field }
 * @returns {any[] | boolean | undefined}
 */
export function applyConstraint(constraint, newData, oldData, context) {
  if (typeof constraint === 'function') return constraint(newData, oldData, context || {});
  const c = constraint;
  context = context || {};
  const own = Array.isArray(c.field) ? c.field[0] : c.field;
  const field = own != null ? own : context.field;

  const activeIndex = context.activeIndex != null ? context.activeIndex : null;
  const hasActive = activeIndex != null && activeIndex >= 0 && activeIndex < newData.length;
  const active = hasActive ? newData[activeIndex] : undefined;

  const fields = Array.isArray(c.field) ? c.field : (field != null ? [field] : []);
  /** @type {Record<string, number[] | undefined>} */
  const domains = {};
  // A column's range: the scale's when the dispatching mark encodes it, else the
  // schema's, so a field only another mark draws is still bounded.
  for (const f of fields) {
    domains[f] = domainOfField(f, context.scales, context.markChannels)
      || (context.schema && context.schema[f] && Array.isArray(context.schema[f].domain) ? context.schema[f].domain : undefined);
  }
  /** @type {import('../types').ConstraintContext} */
  const ctx = {
    data: newData,
    oldData,
    activeIndex,
    active,
    field,
    fields,
    value: active && field != null ? active[field] : undefined,
    domain: field != null ? domains[field] : undefined,
    domains,
    table: context.table,
    tables: context.tables,
    schema: context.schema,
    locked: context.locked || null,
  };

  const result = c.apply(ctx);

  if (result === false || result === true || result === undefined) return result;
  if (Array.isArray(result)) return result;
  if (typeof result === 'number') {
    if (!hasActive || field == null) return newData;
    return newData.map((d, i) => (i === activeIndex ? { ...d, [field]: result } : d));
  }
  if (result && typeof result === 'object') {
    if (!hasActive) return newData;
    return newData.map((d, i) => (i === activeIndex ? { ...d, ...result } : d));
  }
  return newData;
}
