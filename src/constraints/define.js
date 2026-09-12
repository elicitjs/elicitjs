// @ts-check
// define.js — the CONSTRAINT descriptor, its normalizer, and the one place a
// constraint is applied.
//
// A constraint is a DATA-LAYER INVARIANT: a pure rule over one table's rows. By
// the time it runs, every gesture has already been inverted through the scales
// (in the edit's apply), so the proposed rows are entirely in data space. The
// invariant never sees pixels, scales-as-geometry, pointers or node geometry — it
// only judges the data:
//
//   gesture -> inverse scale -> data-space proposal -> invariant(data)? -> commit
//
// This is why the same invariant holds no matter which edit produced the change
// (move / resize / create / remove / paste): it is a property of the dataset, not
// of the gesture. Attaching "sum = 100" to one edit would let another edit bypass
// it; a data invariant runs on every commit and cannot be bypassed.
//
// ── The descriptor ──────────────────────────────────────────────────────────
// A constraint is a plain descriptor, the parallel of an Edit's:
//
//   { type, field?, options, table?, guide?, apply(ctx) }
//
//   type     which keyword built it (`'clamp'`) — the one identity key every feature
//            kind carries; edit/guide.js draws a rule's bounds by it
//   field    the column(s) the rule is ABOUT. OMITTED, it is the column the
//            dispatching EDIT writes — so `clamp({ min: 0 })` on a one-column widget
//            names nothing twice. (It used to default to the literal 'y', a column
//            name baked into the library, which silently governed the wrong column
//            on any chart whose value field was called anything else.)
//   options  the rule's own configuration, kept so a guide can read it
//   table    the table the rule is about, by role or name (default: the primary)
//   guide    an optional DRAWER of the rule's boundary (see edit/guide.js)
//   apply    the RULE, against a clean data-only context, returning whatever shape
//            is natural:
//              number    -> the constrained value for the active datum's `field`
//              object    -> fields merged into the active datum
//              array     -> a full replacement dataset (cross-datum rules)
//              false     -> reject the whole interaction
//              true / undefined -> accept unchanged
//
// The context `apply` receives:
//   { data, oldData, activeIndex, active, field, value, domain, table, tables }
// where `active` is the datum the gesture touched/created (by index), `value` is
// its `field`, `domain` is that field's declared data range, and `table`/`tables`
// let a rule look across the dataset. No scales, no pointer — just data.
//
// A BARE FUNCTION `(newData, oldData, ctx) => rows | boolean | undefined` is still
// accepted in `spec.constraints` as the low-level form; `applyConstraint` runs
// either shape. `constraints.custom(apply, meta)` (= `defineConstraint`) is how a
// spec author writes one; `makeConstraint` is what the built-ins are made with.

import { scaleKey } from '../core/scales.js';
import { warn, warningsEnabled } from '../core/dev.js';
import { CONSTRAINT_OPTIONS } from '../vocabulary.js';

/**
 * Resolve the declared data range of a field, for constraints that default a
 * bound to it (e.g. clamp with an omitted max). Purely a convenience lookup — the
 * value is in DATA space (the channel's domain), not pixels.
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
    // A scale is one ENCODING, so it is found by (channel, field); the bare name
    // is the positional path and the fallback. The field is already in hand here.
    const s = scales[scaleKey(key, field)] || scales[key];
    if (!s) continue;
    if (s.domainConfig) return s.domainConfig;
    if (typeof s.domain === "function") return s.domain();
  }
  return undefined;
}

/**
 * Option keys that are WRONG in a specific way, with the correction — the
 * constraint layer's `MISTAKEN_OPTIONS`. Each was a real spelling once.
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
 * Validate a constraint factory's options against its vocabulary, and hand them
 * back. Constraints were the one grammar namespace with no option checking: a
 * `clamp({ maximum: 5 })` accepted every edit in silence.
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
 * Normalize a constraint spec into the canonical descriptor. The mirror of
 * `makeEdit` (edit/shared.js).
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
 * Author a constraint from a RULE against the data-only context. The extension
 * point (`constraints.custom` is this function): write the rule, return the
 * natural shape, and the plumbing — active datum, field, domain, result
 * normalization — is done for you.
 * @param {(ctx: import('../types').ConstraintContext) => any} reducer
 * @param {{ type?: string, field?: string | string[], options?: Record<string, any>,
 *   table?: string, guide?: (ctx: any) => any[] }} [meta]
 * @returns {import('../types').ConstraintSpec}
 */
export function defineConstraint(reducer, meta = {}) {
  return makeConstraint({ ...meta, type: meta.type || 'custom', apply: reducer });
}

/**
 * Run ONE constraint over a proposal — the single place either shape is applied.
 * A bare function is the low-level form and is called as it always was; a
 * descriptor gets the data-only context built for it and its result normalized.
 *
 * `field` resolves in two steps: the constraint's own, else the column the
 * dispatching edit writes (`cctx.field`, threaded by the engine). A rule that is
 * about one column (clamp, snap) applies to the column being edited when it names
 * none, which is what a one-column widget's `clamp({ min: 0 })` means.
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

  /** @type {import('../types').ConstraintContext} */
  const ctx = {
    data: newData,
    oldData,
    activeIndex,
    active,
    field,
    fields: Array.isArray(c.field) ? c.field : (field != null ? [field] : []),
    value: active && field != null ? active[field] : undefined,
    domain: domainOfField(field, context.scales, context.markChannels),
    table: context.table,
    tables: context.tables,
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
