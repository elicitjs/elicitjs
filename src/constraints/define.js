// @ts-check
// defineConstraint: the abstract base every constraint is built on, and the
// extension point for user-authored constraints.
//
// A constraint is a DATA-LAYER INVARIANT: a pure rule over the feature's dataset.
// By the time it runs, every gesture has already been inverted through the scales
// (in the edit's apply), so the proposed dataset is entirely in data space. The
// invariant never sees pixels, scales-as-geometry, pointers or node geometry — it
// only judges the data:
//
//   gesture -> inverse scale -> data-space proposal -> invariant(data)? -> commit
//
// This is why the same invariant holds no matter which edit produced the change
// (drag / resize / create / remove / paste): it is a property of the dataset, not
// of the gesture. Attaching "sum = 100" to one edit would let another edit bypass
// it; a data invariant runs on every commit and cannot be bypassed.
//
// The core runs constraints as `(newData, oldData, context) => false | true |
// newData`. `defineConstraint` factors out the plumbing so an author writes only
// the rule against a clean, data-only context and returns whatever shape is
// natural:
//
//   number  -> the constrained value for the active datum's `field`
//   object  -> fields merged into the active datum
//   array   -> a full replacement dataset (cross-datum rules: sum, unique, count)
//   false   -> reject the whole interaction
//   true /
//   undefined -> accept unchanged
//
// The reducer receives a pure-data context:
//   { data, oldData, activeIndex, active, field, value, domain }
// where `active` is the datum the gesture touched/created (by index), `value` is
// its `field`, and `domain` is that field's declared data range (for bound
// defaults). No scales, no pointer — just data.

import { scaleKey } from '../core/scales.js';

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
 * Creates a constraint.
 * @param {(ctx: import('../types').ConstraintContext) => any} reducer
 * @param {any} [meta]
 * @returns {import('../types').Constraint}
 */
export function defineConstraint(reducer, meta = {}) {
  /** @type {import('../types').Constraint} */
  const constraint = (newData, oldData, context) => {
    context = context || {};
    // The field this invariant governs, named in DATA terms: the constraint's
    // own `meta.field`, defaulting to 'y' for a value constraint that didn't
    // name one. Cross-dataset rules (count) ignore `field` entirely.
    const field = meta.field || "y";

    // The datum the gesture touched or created, passed by the edit dispatch as
    // `activeIndex` (create -> the appended datum; remove -> null; else the
    // edited index).
    const activeIndex =
      context.activeIndex != null ? context.activeIndex : null;
    const hasActive =
      activeIndex != null && activeIndex >= 0 && activeIndex < newData.length;
    const active = hasActive ? newData[activeIndex] : undefined;

    const domain = domainOfField(field, context.scales, context.markChannels);

    const ctx = {
      data: newData,
      oldData,
      activeIndex,
      active,
      field,
      value: active ? active[field] : undefined,
      domain,
    };

    const result = reducer(ctx);

    // Pass-through control values.
    if (result === false || result === true || result === undefined)
      return result;
    // A full replacement dataset (cross-datum rules).
    if (Array.isArray(result)) return result;

    // A constrained scalar for the active datum's field.
    if (typeof result === "number") {
      if (!hasActive) return newData;
      return newData.map((d, i) =>
        i === activeIndex ? { ...d, [field]: result } : d,
      );
    }
    // A partial datum merged into the active datum.
    if (result && typeof result === "object") {
      if (!hasActive) return newData;
      return newData.map((d, i) =>
        i === activeIndex ? { ...d, ...result } : d,
      );
    }

    return newData;
  };

  // Metadata for guides (an edit with `guide: true` draws its channel's bounds).
  constraint.constraintType = meta.type;
  constraint.options = meta.options;
  constraint.field = meta.field;
  if (typeof meta.guide === "function") constraint.guide = meta.guide;

  return constraint;
}
