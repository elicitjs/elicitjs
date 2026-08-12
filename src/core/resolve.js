// @ts-check
// One scale per channel, GLOBAL to the plot, shared by every mark. Each mark is
// a channel producer (it declares field-per-channel via its `channels` map); the
// engine unions each channel's fields across all marks, asks the schema what they
// are, and builds one scale. Marks then read scales by channel name (scales.x,
// scales.fill) and edits invert through the same objects.
//
// ── Who owns what ───────────────────────────────────────────────────────────
// The SCHEMA owns a field's data type and DOMAIN — they are properties of the
// data, not of a mark's view of it. A mark owns only which field lands on which
// channel, and (rarely) how that channel draws it:
//
//   measure (data type):  channel `type` > schema `type` > inference from values
//   scale (how to draw):  spec.scales[ch] > channel `scale` > scaleTypeFor(...)
//   domain:               the UNION of the schema domains of every field on the
//                         axis, else inferred from the union of their values
//
// The domain union is load-bearing: an error bar puts `mean`, `lo` and `hi` on y,
// and the axis must span all three. Reading one field's domain and discarding the
// rest is what forced charts to hand-write a chart-level y domain.

import { createScale, adoptScale } from "./scales.js";
import {
  normalizeChannels,
  inferMeasureType,
  inferDomainFromValues,
  unionDomains,
  scaleTypeFor,
  channelRange,
  schemeRange,
  axisOf,
  frameSpecOf,
} from "./encoding.js";

// Scales re-resolve on every render, so a warning would repeat forever — `warn`
// dedups once per key. See core/dev.js for why this is not gated on a build flag.
import { warn as warnOnce } from "./dev.js";
import { refDomain } from "./schema.js";

/**
 * Bring the three forms a `scale` option can take to one shape.
 *   'log'                          -> { type: 'log' }
 *   { type: 'sqrt', range: [...] } -> itself
 *   d3.scaleBand().padding(0.3)    -> { instance }
 * @param {any} opt
 * @returns {{ type?: import('../types').ScaleType, range?: any[], instance?: any, [k: string]: any }}
 */
function normalizeScaleOption(opt) {
  if (opt == null) return {};
  if (typeof opt === "function") return { instance: opt };
  if (typeof opt === "string")
    return { type: /** @type {import('../types').ScaleType} */ (opt) };
  return opt;
}

/**
 * Resolves global scales across features.
 * @param {any[]} features
 * @param {Record<string, any[]>} tables the chart's dataset, one rows array per
 *   TABLE name. Every mark is a view over exactly one of them (`feature.table`).
 * @param {import('../types').ElicitSpec & { schema: import('../types').Schema, schemaSpec: import('../types').SchemaSpec }} spec
 *   the engine's live spec view. `schema` is the PRIMARY table's field map (kept for
 *   the single-table paths that predate structures); `schemaSpec` is the canonical
 *   schema, which is how a field is looked up in its own table's contract.
 * @param {{ width: number, height: number }} dims
 * @returns {import('../types').ScaleMap}
 */
export function resolveScales(features, tables, spec, dims) {
  /** @type {Record<string, import('../types').FieldSchema>} */
  const schema = spec.schema || {};
  /** @type {import('../types').SchemaSpec | null} */
  const schemaSpec = spec.schemaSpec || null;
  /** @type {Record<string, import('../types').ScaleSpec>} */
  const chartScales = spec.scales || {};

  // A feature's rows and its own table's field map. A scale is GLOBAL per channel,
  // so several tables can feed one axis — but each field must be looked up in the
  // contract of the table it came from, or a node's `weight` would be validated
  // against a link's.
  /** @param {any} feature @returns {any[]} */
  const rowsOf = (feature) =>
    (tables && (tables[feature.table] || tables[spec.schemaSpec ? spec.schemaSpec.primary : ''])) || [];
  /** @param {any} feature @returns {Record<string, import('../types').FieldSchema>} */
  const fieldsOf = (feature) => {
    const t = schemaSpec && schemaSpec.tables[feature.table];
    return (t && t.fields) || schema;
  };

  // Accumulate, per channel: the fields feeding it (in first-seen order), the
  // FieldSchema each one resolved to (in the same order — a field name alone can't
  // find its declaration once two tables share an axis), any explicit data type or
  // scale option, the mark's preferred discrete scale, and the flat list of values
  // across all marks (for inference).
  /** @type {Record<string, { fields: string[], schemas: any[], undeclared: string[], measure?: any, scaleOpt?: any, discretePref?: any, values: any[] }>} */
  const acc = {};

  /** @param {string} ch */
  const ensure = (ch) => acc[ch] || (acc[ch] = { fields: [], schemas: [], undeclared: [], values: [] });

  // A channel's scale is keyed by the AXIS it shares, not its own literal name —
  // x1/x2 (span endpoints) union into the same bucket as x, y1/y2 into y, so they
  // share one domain/range/scale instead of getting their own. Track which raw
  // channel names fed each bucket, so the built scale can be aliased back onto
  // every one of them below.
  /** @type {Record<string, Set<string>>} */
  const bucketMembers = {};
  /** @param {string} ch @returns {string} */
  const bucketOf = (ch) => {
    const bucket = axisOf(ch) || ch;
    (bucketMembers[bucket] || (bucketMembers[bucket] = new Set())).add(ch);
    return bucket;
  };

  // Every mark reads the SAME dataset, so several marks encoding one field push
  // its values into that channel's bucket more than once. Harmless:
  // inferDomainFromValues takes min/max for continuous and dedupes discrete.
  for (const feature of features) {
    const channels = normalizeChannels(feature);
    // Which concrete scale this mark wants for discrete data. When marks
    // disagree on a shared axis, 'band' wins — a bar needs the interval, and a
    // dot renders fine on a band (it just uses the centre).
    const pref = feature.discreteScale || "band";
    const rawChannels = new Set(feature.rawChannels || []);
    for (const [ch, chSpec] of Object.entries(channels)) {
      if (!chSpec) continue;
      // `scale: null` reads the field raw (the datum holds a literal colour /
      // pixel). No scale to build, so it contributes nothing — and needs no
      // schema entry.
      if (chSpec.scale === null) continue;

      // `scale: 'frame'` is a composite's LOCAL coordinate box (plot/composite.js): the
      // scale is built per datum from the composite's own position and size, so
      // there is no global one to resolve. Skipping BEFORE bucketOf is what
      // keeps a glyph's internal geometry out of the chart's axes — a face's eye
      // at local x -0.4 must not widen the x domain, demand a band, or conjure
      // an axis for a box that isn't in the data's units at all.
      if (frameSpecOf(chSpec)) continue;

      // A channel the mark reads RAW (`Mark.rawChannels`) resolves no scale by
      // construction, so there is nothing here to build. `link`'s `nodeWidth` is
      // the case that forced this: it names a column of the NODE table, and this
      // pass can only see the mark's own table — so a perfectly well-declared
      // field looked undeclared and the chart opened with a warning telling the
      // author to declare what they already had.
      if (rawChannels.has(ch)) continue;

      // A derived channel (`{ fn }`) is computed per datum in VISUAL space —
      // its result is used as-is, never scaled — so it declares no field and
      // feeds no scale. Skip it explicitly (rather than relying on the empty-
      // bucket drop below) so a stray `scale`/`type` on it can't contaminate a
      // shared axis bucket's scaleOpt/measure.
      if (typeof chSpec.fn === "function" && chSpec.field == null) {
        if (chSpec.scale !== undefined || chSpec.type !== undefined) {
          // Key is `fnopt:`, not `fn:` — plot/mark.js already owns `fn:<channel>`
          // for "this derived channel's fn threw". Sharing the namespace meant
          // whichever fired first silenced the other for the rest of the page.
          warnOnce(
            `fnopt:${ch}`,
            `channel "${ch}" is derived ({ fn }) — its result is used ` +
              `as-is in visual space, so its "${chSpec.scale !== undefined ? "scale" : "type"}" ` +
              `is ignored. Drop it, or use a field channel if you want a scale.`,
          );
        }
        continue;
      }

      // `domain` and `range` are not channel options: the schema owns the
      // domain, the scale owns the range. Both used to live here, and a
      // leftover is invisible — the channel silently takes its default range
      // (a needle's degrees collapse to [0, 1]) and the chart draws, wrong.
      for (const [key, where] of [
        ["domain", "the spec's schema"],
        ["range", "this channel's `scale`"],
      ]) {
        if (chSpec[key] === undefined) continue;
        warnOnce(
          `stray:${key}:${ch}`,
          `channel "${ch}" declares "${key}", which is ignored. Move it to ` +
            `${where}: ${key === "range" ? `scale: { range: [...] }` : `schema: { <field>: { domain: [...] } }`}.`,
        );
      }

      const a = ensure(bucketOf(ch));
      if (a.measure == null && chSpec.type != null) a.measure = chSpec.type;
      if (a.scaleOpt == null && chSpec.scale != null) a.scaleOpt = chSpec.scale;
      if (a.discretePref !== "band") a.discretePref = pref;

      if (chSpec.field != null) {
        if (!a.fields.includes(chSpec.field)) a.fields.push(chSpec.field);
        // The declaration is taken from the field's OWN table, here, while we still
        // know which feature it came from — the bucket only keeps names.
        const declared = fieldsOf(feature)[chSpec.field];
        // A `ref` IS a category (its values are identities), but its domain belongs
        // to the column it points at, so it is derived rather than declared — that is
        // what keeps a link's source in step with the nodes that exist. Substituted
        // here so the rest of resolution never learns that refs exist.
        if (declared && declared.type === 'ref' && schemaSpec) {
          a.schemas.push({
            type: 'categorical',
            domain: refDomain(schemaSpec, declared, tables),
            open: true,
          });
        } else if (declared) a.schemas.push(declared);
        else if (!a.undeclared.includes(chSpec.field)) a.undeclared.push(chSpec.field);
        for (const d of rowsOf(feature)) a.values.push(d[chSpec.field]);
      } else if (chSpec.datum !== undefined) {
        // A data-space constant still needs the axis to exist and to span it.
        a.values.push(chSpec.datum);
      }
    }
  }

  // Build one scale per bucket that is actually used, then alias it onto every
  // raw channel name that fed the bucket (so scales.x1 === scales.x2 === scales.x).
  /** @type {import('../types').ScaleMap} */
  const scales = {};
  for (const [bucket, a] of Object.entries(acc)) {
    const hasData = a.values.some((v) => v != null);
    // A constant-only channel (`fill: { value: 'red' }`, `size: 9`) declares no
    // field and no datum — there is nothing to scale. Leave it unresolved; a
    // 1D plot with a dropped axis relies on this too (marks fall back to centre).
    if (!a.fields.length && !hasData) continue;

    const entries = a.schemas;
    for (const f of a.undeclared) {
      warnOnce(
        `schema:${f}:${bucket}`,
        `field "${f}" is encoded on channel "${bucket}" but not declared in ` +
          `schema; inferring its type and domain from data. Declare it in the Elicit ` +
          `spec's schema — the schema is the contract of the elicited dataset.`,
      );
    }
    if (!entries.length && !hasData) {
      throw new Error(
        `[elicit] cannot resolve a scale for channel "${bucket}": field(s) ` +
          `${a.fields.map((f) => `"${f}"`).join(", ")} have no schema entry and there is no data ` +
          `to infer from. Declare them in the Elicit spec's schema.`,
      );
    }

    const opt = {
      ...normalizeScaleOption(a.scaleOpt),
      ...normalizeScaleOption(chartScales[bucket]),
    };

    // 1. What the data IS. An explicit channel type overrides the schema, which
    //    overrides inference. Fields sharing an axis must agree.
    const declared = entries.map((e) => e.type).filter(Boolean);
    if (new Set(declared).size > 1) {
      warnOnce(
        `measure:${bucket}`,
        `fields ${a.fields.map((f) => `"${f}"`).join(", ")} share channel "${bucket}" ` +
          `but declare different schema types (${[...new Set(declared)].join(", ")}). ` +
          `Using "${declared[0]}".`,
      );
    }
    /** @type {import('../types').MeasureType} */
    const measure = a.measure || declared[0] || inferMeasureType(a.values);

    // 2. How this channel DRAWS it.
    /** @type {import('../types').ScaleType} */
    const type =
      opt.type || scaleTypeFor(bucket, measure, a.discretePref || "band");

    // 3. The domain, unioned across every field on the axis (the schema owns it).
    /** @type {any[][]} */
    const declaredDomains = [];
    for (const e of entries) if (e.domain) declaredDomains.push(e.domain);
    const domain =
      unionDomains(measure, declaredDomains) ||
      inferDomainFromValues(type, a.values);

    const positional = !!axisOf(bucket);
    // Range precedence: an explicit `range` array wins; then a named `scheme`
    // (colour channels only — resolves to a palette / sampled ramp); then the
    // channel's built-in default. `reverse` flips whichever of those landed.
    let range =
      opt.range ||
      schemeRange(opt.scheme, type, domain.length) ||
      channelRange(bucket, type, dims, spec.theme);
    if (opt.reverse && Array.isArray(range)) range = [...range].reverse();

    // A scale the author built themselves is adopted as-is: we only sniff its
    // capabilities and hand it the pixel range if it's positional and named none.
    const scale = opt.instance
      ? adoptScale(opt.instance, {
          range: opt.range ? undefined : range,
          positional,
          domain,
        })
      : createScale({ ...opt, type, domain }, range);

    if (scale) {
      // The schema fields that fed this axis, in first-seen order. Metadata
      // only (NOT a domain/range on the channel) — an editable axis reads it
      // to know which schema field domains a domain edit should write back to
      // (a single-field axis -> one field; an error bar's y -> mean/lo/hi).
      scale.fields = a.fields;
      // Always alias onto the bucket key itself (e.g. 'x'), even when only
      // x1/x2 were declared and 'x' was never literally used as a channel —
      // baselineOf/bandwidthOf and other axis-keyed lookups expect scales.x
      // to exist whenever any x-axis channel is in play.
      scales[bucket] = scale;
      for (const name of bucketMembers[bucket] || []) scales[name] = scale;
    }
  }

  return scales;
}
