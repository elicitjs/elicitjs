// @ts-check
// resolve.js — one global scale per channel, shared by every mark. The engine
// unions each channel's fields across marks, asks the schema what they are, and
// builds one scale; edits invert through the same objects.
//
//   measure (data type):  channel `type` > schema `type` > inference from values
//   scale (how to draw):  spec.scales[ch] > channel `scale` > scaleTypeFor(...)
//   domain:               the union of the schema domains of every field on the
//                         axis (an error bar's mean/lo/hi), else inferred from values

import { createScale, adoptScale, scaleKey, bandwidthOf, slotWidthOf, nestOffsetScale, offsetScaleOf } from "./scales.js";
import {
  normalizeChannels,
  inferMeasureType,
  inferDomainFromValues,
  unionDomains,
  scaleTypeFor,
  channelRange,
  schemeRange,
  axisOf,
  offsetParentOf,
  frameSpecOf,
} from "./encoding.js";

// Scales re-resolve every render; `warn` dedups once per key.
import { warn as warnOnce } from "./dev.js";
import { refDomain, fieldsOf } from "./schema.js";

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
 * @param {Record<string, any[]>} tables the chart's dataset, one rows array per table name
 * @param {import('../types').ElicitSpec & { schema: import('../types').Schema, schemaSpec: import('../types').SchemaSpec }} spec
 *   the engine's live spec view: `schema` is the primary table's field map,
 *   `schemaSpec` the canonical schema.
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

  // A feature's rows and its own table's field map: each field is looked up in the
  // table it came from.
  /** @param {any} feature @returns {any[]} */
  const rowsOf = (feature) =>
    (tables && (tables[feature.table] || tables[spec.schemaSpec ? spec.schemaSpec.primary : ''])) || [];
  /** @param {any} feature @returns {Record<string, import('../types').FieldSchema>} */
  const fieldsFor = (feature) => (schemaSpec ? fieldsOf(schemaSpec, feature.table) : schema);

  // Per bucket: fields (first-seen order), their FieldSchemas (same order), any
  // explicit type or scale option, the marks' hints, and all values (for inference).
  /** @type {Record<string, { fields: string[], fieldRefs: { table: string, field: string }[], schemas: any[], undeclared: string[], measure?: any, scaleOpt?: any, discretePref?: any, countAxis?: any, radiusRange?: any, values: any[] }>} */
  const acc = {};

  /** @param {string} ch */
  const ensure = (ch) => acc[ch] || (acc[ch] = { fields: [], fieldRefs: [], schemas: [], undeclared: [], values: [] });

  // Which scale a channel feeds. Positional channels bucket by axis (x1/x2 into x),
  // so span endpoints share one scale. Non-positional channels bucket by
  // (channel, field): one scale per encoding, shared by marks stating the same
  // encoding. A non-positional channel with no field keeps the bare channel name.
  // `bucketMembers` records the channel names that fed each bucket (for aliasing);
  // `bucketChannel` the channel a bucket belongs to.
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

  // Several marks may push one field's values more than once; inference dedupes.
  for (const feature of features) {
    const channels = normalizeChannels(feature);
    // When marks disagree on a shared axis, 'band' wins: a dot renders fine on a band.
    const pref = feature.discreteScale || "band";
    const rawChannels = new Set(feature.rawChannels || []);
    for (const [ch, chSpec] of Object.entries(channels)) {
      if (!chSpec) continue;
      // `scale: null` reads the field raw: no scale, no schema entry needed.
      if (chSpec.scale === null) continue;

      // `scale: 'frame'` is a composite's local box, built per datum. Skipped before
      // bucketOf so glyph geometry never widens the chart's axes.
      if (frameSpecOf(chSpec)) continue;

      // A raw channel (`Mark.rawChannels`) resolves no scale. It may name another
      // table's column, which this pass cannot see.
      if (rawChannels.has(ch)) continue;

      // A derived channel (`{ fn }`) is visual space, so it feeds no scale. Skipped
      // explicitly so a stray `scale`/`type` can't contaminate a shared bucket.
      if (typeof chSpec.fn === "function" && chSpec.field == null) {
        if (chSpec.scale !== undefined || chSpec.type !== undefined) {
          // Key is `fnopt:`; plot/mark.js owns `fn:<channel>`.
          warnOnce(
            `fnopt:${ch}`,
            `channel "${ch}" is derived ({ fn }) — its result is used ` +
              `as-is in visual space, so its "${chSpec.scale !== undefined ? "scale" : "type"}" ` +
              `is ignored. Drop it, or use a field channel if you want a scale.`,
          );
        }
        continue;
      }

      // `domain` and `range` are not channel options (the schema owns the domain,
      // the scale the range). A leftover silently takes the default range, so warn.
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
      // Which way a count axis runs: a per-mark hint, accumulated like `discretePref`.
      if (a.countAxis == null && feature.countAxis) a.countAxis = feature.countAxis;
      // The px extent of a radius axis, declared by the polar mark.
      if (a.radiusRange == null && feature.radiusRange) a.radiusRange = feature.radiusRange;

      if (chSpec.field != null) {
        if (!a.fields.includes(chSpec.field)) a.fields.push(chSpec.field);
        // Field names are not unique across tables; `fieldRefs` qualifies each by
        // its table so a domain edit writes the right schema.
        const owner = feature.table;
        if (owner != null && !a.fieldRefs.some((r) => r.table === owner && r.field === chSpec.field)) {
          a.fieldRefs.push({ table: owner, field: chSpec.field });
        }
        // The declaration comes from the field's own table, known only here.
        const declared = fieldsFor(feature)[chSpec.field];
        // A `ref` is a category whose domain is derived from the column it points
        // at. Substituted here so the rest of resolution never sees refs.
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

  // Which encoding this is among those sharing a channel (first-seen order). The
  // automatic colour path rotates scheme families by it; index 0 defers to the theme.
  /** @type {Record<string, number>} */
  const bucketIndex = {};
  /** @type {Record<string, number>} */
  const seenPerChannel = {};
  // Offset buckets, fitted to their parent's slot once every scale exists (below).
  /** @type {{ bucket: string, channel: string, parent: 'x' | 'y', opt: any }[]} */
  const offsets = [];
  for (const [bucket, a] of Object.entries(acc)) {
    // The channel this bucket belongs to. A non-positional key is `channel\0field`,
    // so anything that wants a channel name reads this, not the key.
    const channel = bucketChannel[bucket] || bucket;
    const hasData = a.values.some((v) => v != null);
    // A constant-only channel has nothing to scale; leave it unresolved.
    if (!a.fields.length && !hasData) continue;
    // Counted after the skip, so a constant-only channel takes no palette slot.
    bucketIndex[bucket] = seenPerChannel[channel] || 0;
    seenPerChannel[channel] = bucketIndex[bucket] + 1;

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

    // 2. How this channel draws it.
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
    const fromScheme = schemeRange(opt.scheme, type, domain.length);
    if (opt.scheme && !fromScheme) {
      warnOnce(
        `scheme:${opt.scheme}`,
        `channel "${channel}" names colour scheme "${opt.scheme}", which is not one this ` +
          `library knows, so the channel's default range is used instead. Scheme names ` +
          `are d3's, lower-case: blues, viridis, turbo, rdbu, tableau10, …`,
      );
    }
    let range =
      opt.range ||
      fromScheme ||
      channelRange(channel, type, dims, spec.theme, {
        // Colour reads the measure, the encoding index and the category count.
        measure,
        index: bucketIndex[bucket] || 0,
        count: domain.length,
        // Which way a count axis runs — declared by the mark, accumulated above.
        countAxis: a.countAxis,
        radiusRange: a.radiusRange,
      });
    if (opt.reverse && Array.isArray(range)) range = [...range].reverse();

    // An author's scale is adopted as a copy, so their instance is never mutated.
    const scale = opt.instance
      ? adoptScale(typeof opt.instance.copy === "function" ? opt.instance.copy() : opt.instance, {
          range: opt.range ? undefined : range,
          positional,
          domain,
          declared: declaredDomains.length > 0,
        })
      : createScale({
          ...opt,
          type,
          domain,
          // The theme's band spacing, when the channel names no padding.
          bandPadding: spec.theme && /** @type {any} */ (spec.theme).bandPadding,
          // Nested sub-bands abut by default; the gap between groups is the parent's padding.
          ...(offsetParentOf(channel) && opt.padding == null ? { padding: 0 } : {}),
        }, range);

    if (scale) {
      // The schema fields that fed this scale, first-seen; an editable axis writes
      // a domain edit back to them. `fieldRefs` is the same list qualified by table.
      scale.fields = a.fields;
      scale.fieldRefs = a.fieldRefs;
      // Always publish under the bucket key ('x', or 'fill\0group'): axis-keyed
      // lookups expect scales.x whenever any x-axis channel is in play.
      scales[bucket] = scale;
      // Alias onto every channel name that fed the bucket (scales.x1 === scales.x).
      // First wins, deliberately: with two encodings on one channel the bare name
      // points at the first. Readers that know their field use the composite key.
      // Never make it last-wins.
      for (const name of bucketMembers[bucket] || []) {
        if (scales[name] === undefined) scales[name] = scale;
      }
      const parent = offsetParentOf(channel);
      if (parent) offsets.push({ bucket, channel, parent, opt });
    }
  }

  // ── Offset scales: a category nested inside x or y ─────────────────────────
  // Fitted once the parent exists: the range is one parent slot in px. `yOffset`
  // runs [width, 0] so domain[0] sits at the bottom, like a band y axis. An
  // author's `range` is slot-local px, kept as given.
  for (const { bucket, channel, parent, opt } of offsets) {
    const scale = /** @type {any} */ (scales)[bucket];
    const parentScale = /** @type {any} */ (scales)[parent];
    const width = slotWidthOf(parentScale);
    if (width === undefined) {
      warnOnce(
        `offset:${channel}:parent`,
        parentScale
          ? `channel "${channel}" nests a second category inside each "${parent}" category, ` +
            `but "${parent}" is continuous here, so there is no slot to divide and the offset ` +
            `is ignored. Declare the "${parent}" field categorical or ordinal.`
          : `channel "${channel}" nests a second category inside each "${parent}" category, ` +
            `but no mark encodes "${parent}", so the offset is ignored. Bind "${parent}" to a ` +
            `categorical field.`,
      );
      continue;
    }
    let range = opt.range || (channel === "yOffset" ? [width, 0] : [0, width]);
    if (opt.reverse && !opt.range) range = [...range].reverse();
    nestOffsetScale(scale, parentScale, range);
  }

  // ── A derived count scale ──────────────────────────────────────────────────
  // A `waffle` encodes a count column (built above). A `dotStack` derives it: one
  // row is one token, so the scale comes from the mark's pitch (`2r + gap`), with
  // a domain of however many whole tokens fit the plot.
  if (scales.count === undefined) {
    const counter = features.find(
      (f) => f && f.countAxis && f.countPitch > 0,
    );
    if (counter) {
      const along = counter.countAxis === "x" ? dims.width : dims.height;
      const capacity = Math.max(1, Math.floor(along / counter.countPitch));
      const span = capacity * counter.countPitch;
      const derived = createScale(
        { type: "linear", domain: [0, capacity] },
        counter.countAxis === "x" ? [0, span] : [dims.height, dims.height - span],
      );
      if (derived) scales.count = derived;
    }
  }

  // A width-limited counting mark (square cells fitting its band) draws a block
  // shorter than the count range. It declares `countLayout`, and the count range
  // is fitted to it once the band scale is known.
  const laid = features.find((f) => f && f.countAxis && typeof f.countLayout === "function");
  const count = /** @type {any} */ (scales).count;
  if (laid && count && typeof count.range === "function") {
    const bandAxis = laid.countAxis === "x" ? "y" : "x";
    // The block's thickness is its slot: the sub-band when the mark nests an
    // offset in its category, else the category's band.
    const nested = offsetScaleOf(scales, laid.channels, bandAxis);
    const thickness = bandwidthOf(nested || scales[bandAxis], 20);
    const r = count.range();
    const blockLen = Math.abs(r[1] - r[0]);
    const dom = count.domain();
    const domainSpan = Math.abs(Number(dom[dom.length - 1]) - Number(dom[0])) || 1;
    const span = laid.countLayout({ thickness, blockLen, domainSpan });
    if (Number.isFinite(span) && span > 0 && Math.abs(span - blockLen) > 0.5) {
      count.range(laid.countAxis === "x" ? [0, span] : [dims.height, dims.height - span]);
    }
  }

  return scales;
}
