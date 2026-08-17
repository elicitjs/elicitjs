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

import { createScale, adoptScale, scaleKey } from "./scales.js";
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
  /** @type {Record<string, { fields: string[], fieldRefs: { table: string, field: string }[], schemas: any[], undeclared: string[], measure?: any, scaleOpt?: any, discretePref?: any, values: any[] }>} */
  const acc = {};

  /** @param {string} ch */
  const ensure = (ch) => acc[ch] || (acc[ch] = { fields: [], fieldRefs: [], schemas: [], undeclared: [], values: [] });

  // WHICH SCALE a channel feeds. Two different rules, because positional and
  // non-positional channels want opposite things from a shared name:
  //
  //   POSITIONAL — by AXIS. x1/x2 union into x, y1/y2 into y, so span endpoints
  //     share one domain/range/scale. An error bar's mean/lo/hi must span ONE y
  //     axis; that union is the intent.
  //   NON-POSITIONAL — by (channel, FIELD): one scale per ENCODING. Keyed by
  //     channel alone, every mark binding `fill` shared a scale whose domain was
  //     the union of every field on it — one mapping over values that mean two
  //     different things, and `scale.fields[0]` (declaration order) as the
  //     disambiguator for every edit. Two marks stating the SAME encoding still
  //     land in one bucket, which is what makes a shared colour mean a shared value.
  //
  // A non-positional channel with no field (`fill: { datum: 'rain' }`) has no
  // encoding to key on and keeps the bare channel name.
  //
  // `bucketMembers` tracks the raw channel names that fed each bucket so the built
  // scale can be aliased back onto every one of them; `bucketChannel` remembers
  // which CHANNEL a bucket belongs to, since the bucket key is no longer the
  // channel name and the build loop needs the channel for scale type, range and
  // `spec.scales` config.
  /** @type {Record<string, Set<string>>} */
  const bucketMembers = {};
  /** @type {Record<string, string>} */
  const bucketChannel = {};
  /** @param {string} ch @param {any} chSpec @returns {string} */
  const bucketOf = (ch, chSpec) => {
    const axis = axisOf(ch);
    const bucket = axis || scaleKey(ch, chSpec && chSpec.field != null ? chSpec.field : undefined);
    (bucketMembers[bucket] || (bucketMembers[bucket] = new Set())).add(ch);
    bucketChannel[bucket] = axis || ch;
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

      const a = ensure(bucketOf(ch, chSpec));
      if (a.measure == null && chSpec.type != null) a.measure = chSpec.type;
      if (a.scaleOpt == null && chSpec.scale != null) a.scaleOpt = chSpec.scale;
      if (a.discretePref !== "band") a.discretePref = pref;

      if (chSpec.field != null) {
        if (!a.fields.includes(chSpec.field)) a.fields.push(chSpec.field);
        // A field NAME is not unique across tables — a network chart can put `kind`
        // on both nodes and links, and one `fill` scale over both. `fields` is the
        // flat name list every reader has always taken; `fieldRefs` qualifies each
        // one by the table it came from, which is the only place that is still
        // known. A domain edit needs the qualified form to write the right schema.
        const owner = feature.table;
        if (owner != null && !a.fieldRefs.some((r) => r.table === owner && r.field === chSpec.field)) {
          a.fieldRefs.push({ table: owner, field: chSpec.field });
        }
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

  // WHICH encoding this is among those sharing a channel, in first-seen order. The
  // automatic colour path rotates scheme families by it, so two encodings on `fill`
  // are perceptually different things rather than the same two hues twice — the
  // separation the union used to provide by accident. Index 0 defers to the theme,
  // so a chart with one encoding per channel is exactly as it was.
  /** @type {Record<string, number>} */
  const bucketIndex = {};
  /** @type {Record<string, number>} */
  const seenPerChannel = {};
  for (const bucket of Object.keys(acc)) {
    const ch = bucketChannel[bucket] || bucket;
    bucketIndex[bucket] = seenPerChannel[ch] || 0;
    seenPerChannel[ch] = bucketIndex[bucket] + 1;
  }
  for (const [bucket, a] of Object.entries(acc)) {
    // The CHANNEL this bucket belongs to. For a non-positional bucket the key is
    // `channel\0field`, so everything that wants a channel NAME — the scale type,
    // the default range, `spec.scales` config, and every message an author reads —
    // must go through this rather than the key.
    const channel = bucketChannel[bucket] || bucket;
    const hasData = a.values.some((v) => v != null);
    // A constant-only channel (`fill: { value: 'red' }`, `size: 9`) declares no
    // field and no datum — there is nothing to scale. Leave it unresolved; a
    // 1D plot with a dropped axis relies on this too (marks fall back to centre).
    if (!a.fields.length && !hasData) continue;

    const entries = a.schemas;
    for (const f of a.undeclared) {
      warnOnce(
        `schema:${f}:${channel}`,
        `field "${f}" is encoded on channel "${channel}" but not declared in ` +
          `schema; inferring its type and domain from data. Declare it in the Elicit ` +
          `spec's schema — the schema is the contract of the elicited dataset.`,
      );
    }
    if (!entries.length && !hasData) {
      throw new Error(
        `[elicit] cannot resolve a scale for channel "${channel}": field(s) ` +
          `${a.fields.map((f) => `"${f}"`).join(", ")} have no schema entry and there is no data ` +
          `to infer from. Declare them in the Elicit spec's schema.`,
      );
    }

    const opt = {
      ...normalizeScaleOption(a.scaleOpt),
      ...normalizeScaleOption(chartScales[channel]),
    };

    // 1. What the data IS. An explicit channel type overrides the schema, which
    //    overrides inference. Fields sharing an axis must agree.
    const declared = entries.map((e) => e.type).filter(Boolean);
    if (new Set(declared).size > 1) {
      warnOnce(
        `measure:${channel}`,
        `fields ${a.fields.map((f) => `"${f}"`).join(", ")} share channel "${channel}" ` +
          `but declare different schema types (${[...new Set(declared)].join(", ")}). ` +
          `Using "${declared[0]}".`,
      );
    }
    /** @type {import('../types').MeasureType} */
    const measure = a.measure || declared[0] || inferMeasureType(a.values);

    // 2. How this channel DRAWS it.
    /** @type {import('../types').ScaleType} */
    const type =
      opt.type || scaleTypeFor(channel, measure, a.discretePref || "band");

    // 3. The domain, unioned across every field on the axis (the schema owns it).
    /** @type {any[][]} */
    const declaredDomains = [];
    for (const e of entries) if (e.domain) declaredDomains.push(e.domain);
    const domain =
      unionDomains(measure, declaredDomains) ||
      inferDomainFromValues(type, a.values);

    const positional = !!axisOf(channel);
    // Range precedence: an explicit `range` array wins; then a named `scheme`
    // (colour channels only — resolves to a palette / sampled ramp); then the
    // channel's built-in default. `reverse` flips whichever of those landed.
    let range =
      opt.range ||
      schemeRange(opt.scheme, type, domain.length) ||
      channelRange(channel, type, dims, spec.theme, {
        // Colour is chosen by what the data IS (ordered vs unordered), by which
        // encoding this is on the channel, and by how many categories it has.
        measure,
        index: bucketIndex[bucket] || 0,
        count: domain.length,
      });
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
      // `fieldRefs` is the same list QUALIFIED BY TABLE, because a name alone
      // cannot say whose schema to write when one scale spans two tables.
      scale.fields = a.fields;
      scale.fieldRefs = a.fieldRefs;
      // Always publish under the bucket key itself (e.g. 'x', or 'fill\0group'),
      // even when only x1/x2 were declared and 'x' was never literally used as a
      // channel — baselineOf/bandwidthOf and other axis-keyed lookups expect
      // scales.x to exist whenever any x-axis channel is in play.
      scales[bucket] = scale;
      // Alias onto every raw channel name that fed the bucket, so scales.x1 ===
      // scales.x2 === scales.x, and `scales.fill` still resolves SOMETHING for a
      // reader that has no field to key on.
      //
      // FIRST WINS, deliberately. With two encodings on one channel there are two
      // scales and the bare name can only point at one; taking the first makes it
      // the same scale a channel-keyed reader got before this change, so a lookup
      // that was never updated degrades to the old behaviour instead of to
      // `undefined`. Every reader that CAN name its field uses the composite key
      // and never sees this alias. (`||=` rather than `=` is the whole mechanism —
      // last-writer-wins would hand the alias to whichever mark was declared last,
      // which is the arbitrariness this change exists to remove.)
      for (const name of bucketMembers[bucket] || []) {
        if (scales[name] === undefined) scales[name] = scale;
      }
    }
  }

  return scales;
}
