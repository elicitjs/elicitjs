# Mark & element contracts

Author-facing predictability matrix for every factory. Kind, channels, create fitness,
handles / signifiers, and scale requirements. Prefer `elicit.elements.*` for scale
chrome; `plot.*` still aliases those factories.

Live docs: sibling repo `elicitjs-docs` → `/concepts/contracts`.

## Legend

<table>
<thead>
<tr><th>Kind</th><th>Meaning</th></tr>
</thead>
<tbody>
<tr><td><b>data</b></td><td>Views dataset rows; channels name columns</td></tr>
<tr><td><b>parametric</b></td><td>One-row (or few-row) belief; channels are parameters, not free create targets</td></tr>
<tr><td><b>map chrome</b></td><td>Basemap / tiles; not create targets</td></tr>
<tr><td><b>element</b></td><td>Views a SCALE (<code>views: 'scale'</code>) — an axis for a positional one, a legend for one non-positional ENCODING; domain edits, not row creates</td></tr>
</tbody>
</table>

**create/remove:** natural = `edit.create` / `edit.remove` (or scoped siblings) make sense.
N/A = use a different edit family (documented).

**handles:** `true` / `false` / `'hit'` unless noted.

---

## Data marks

<table>
<thead>
<tr>
<th>Factory</th>
<th>Kind</th>
<th>Channels (notes)</th>
<th>create/remove</th>
<th>Handles / signifiers</th>
<th>requires / capability</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>point</code></td>
<td>data</td>
<td>x, y, size, fill, stroke, symbol, angle</td>
<td>natural</td>
<td>whole mark</td>
<td><code>discreteScale: point</code></td>
</tr>
<tr>
<td><code>bar</code> / <code>barX</code> / <code>barY</code></td>
<td>data</td>
<td>band + value (or x1/x2, y1/y2 span); stack</td>
<td>remove ok; create awkward (aggregates). Stacked: <code>edit.stack.cut</code> / <code>merge</code></td>
<td>whole bar; stacked also boundary dots (<code>node.edge</code>)</td>
<td>band on category; <code>supportsStack</code> when stacked</td>
</tr>
<tr>
<td><code>rect</code> / <code>rectX</code> / <code>rectY</code></td>
<td>data</td>
<td>independent spans / band / value per axis</td>
<td>natural (regions)</td>
<td>whole rect; <code>brushRect</code> zones</td>
<td>band when categorical</td>
</tr>
<tr>
<td><code>tick</code> / <code>tickX</code> / <code>tickY</code></td>
<td>data</td>
<td>value + span: band, <code>length</code>, or an explicit x1/x2 (y1/y2) pair</td>
<td>natural</td>
<td>whole tick</td>
<td>band on category (unless the span is stated)</td>
</tr>
<tr>
<td><code>ellipse</code></td>
<td>data</td>
<td>x, y, <b>rx / ry</b> (independent radii, <code>size</code> fallback), angle</td>
<td>natural</td>
<td>whole mark; each radius its own magnitude edit</td>
<td><code>discreteScale: point</code></td>
</tr>
<tr>
<td><code>curve</code> / <code>curveX</code> / <code>curveY</code></td>
<td>data</td>
<td>chord (x1/x2 or <code>length</code>) + position; <b><code>curvature</code></b> (half-chord fractions), angle</td>
<td>create less natural</td>
<td>visible path inert; fat transparent HIT path (sampled <code>points</code>, <code>cx</code>/<code>cy</code> stamped)</td>
<td><code>discreteScale: point</code></td>
</tr>
<tr>
<td><code>text</code> / <code>textX</code> / <code>textY</code></td>
<td>data</td>
<td>x, y, text, …</td>
<td>create awkward; <code>editText</code> for content</td>
<td>whole label</td>
<td>—</td>
</tr>
<tr>
<td><code>line</code> / <code>lineX</code> / <code>lineY</code> / <code>path</code> / <code>connectedScatter</code></td>
<td>data</td>
<td>x, y; series/order</td>
<td>natural (<code>edit.line.*</code>)</td>
<td>per-datum circles; path for proximity</td>
<td><code>supportsSeries</code></td>
</tr>
<tr>
<td><code>area</code> / <code>areaX</code> / <code>areaY</code></td>
<td>data</td>
<td>baseline or y1/y2 (x1/x2) span</td>
<td>natural (<code>edit.line.*</code>)</td>
<td>edge circles (<code>channel</code> tag); path inert</td>
<td><code>supportsSeries</code></td>
</tr>
<tr>
<td><code>rule</code> / <code>ruleX</code> / <code>ruleY</code></td>
<td>data</td>
<td>value or span endpoints</td>
<td>create less natural</td>
<td>whole segment when edited</td>
<td>optional <code>discreteScale</code></td>
</tr>
<tr>
<td><code>dotStack</code> / <code>dotStackX</code> / <code>dotStackY</code></td>
<td>data</td>
<td>category; stack count geometry</td>
<td>natural (canonical)</td>
<td>tokens</td>
<td>—</td>
</tr>
<tr>
<td><code>waffle</code> / <code>waffleX</code> / <code>waffleY</code></td>
<td>data</td>
<td>band + value; unit grid</td>
<td>N/A → <code>edit.waffle.fill</code></td>
<td>cells (<code>node.grid</code>, <code>node.effectShape</code>)</td>
<td>discrete on x or y; <code>supportsWaffle</code></td>
</tr>
<tr>
<td><code>needle</code></td>
<td>data</td>
<td><code>angle</code> belief; optional x/y pivot</td>
<td>N/A</td>
<td>hub + path; shared <code>handles</code></td>
<td>—</td>
</tr>
<tr>
<td><code>arc</code> / <code>pie</code> / <code>donut</code></td>
<td>data</td>
<td><code>value</code> magnitudes; optional x/y</td>
<td><code>edit.stack.cut</code> / <code>merge</code></td>
<td>rim boundary dots (<code>node.edge</code>)</td>
<td><code>supportsArc</code>, <code>supportsStack</code></td>
</tr>
<tr>
<td><code>composite</code> (alias <code>group</code>)</td>
<td>data</td>
<td>composite channels → parts. BOX MODE (switched on by a part stating <code>frame:</code>): x/y/size define a per-datum box and are withheld from the trickle; a local part with no x/y sits at the ORIGIN</td>
<td>depends on parts; mark-level edits ride the LAST part, or the BOX in box mode</td>
<td>per-part features; in box mode <code>node.frame</code> carries the scales an edit inverts through, and <code>node.dm</code> the positional local channels</td>
<td>stamps <code>discreteScale</code> and a <code>glyph</code> key (the parts PAINT as one object: nodes ordered by ROW, parts in declared order within it, so a later glyph covers an earlier one whole); in box mode emits the BOX first — one <code>hit</code> circle per row, kept at the bottom of the group, so an edit on x/y/size grabs the whole glyph without outranking a part</td>
</tr>
</tbody>
</table>

## Network

<table>
<thead>
<tr>
<th>Factory</th>
<th>Kind</th>
<th>Channels (notes)</th>
<th>create/remove</th>
<th>Handles / signifiers</th>
<th>requires / capability</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>link</code></td>
<td>data (a <b>JOIN</b> — the only mark whose geometry comes from another table)</td>
<td>source/target name the <code>ref</code> columns (default: the link table's two, in declaration order); x/y override the NODE placement channels; <b><code>curve</code></b>, <b><code>arrow</code></b> and <b><code>sourceSide</code>/<code>targetSide</code></b> read raw, so any of them can be a column — but each is a mark option first, which is what keeps a drawing preference out of the elicited data unless the spec asks for it. <b><code>nodeWidth</code>/<code>nodeHeight</code></b> resolve against the NODE row (like x/y) and are what <code>curve: "orthogonal"</code> docks to; for an auto-sized sticker, <code>{ fn: d =&gt; noteBox(d.label).width }</code>. TWO SURFACES, one channel map: <code>stroke</code>/<code>strokeWidth</code> are the LINE (and an arrowhead's fill), <code>fill</code> is the LABEL — the stroke family never reaches the text, or a 2px connector outlines every glyph of its own label</td>
<td><code>edit.network.connect</code> (on the NODE mark) / plain <code>remove</code></td>
<td>fat transparent HIT path first (sampled <code>points</code>) so the BODY is grabbable; endpoint circles only where <code>source</code>/<code>target</code> carries an edit, <code>channel</code>-tagged for <code>claimEdge</code>; every node states <code>editBox</code> (a path has no x/y, so the inline editor had nowhere to mount); <code>labelBackground</code> adds a plate under the label, emitted before it</td>
<td><code>tableRole: 'links'</code>, <code>supportsNetwork</code>; reads <code>directed</code> off the links table for arrows and separation</td>
</tr>
<tr>
<td><code>node</code></td>
<td><b>preset</b> → <code>composite</code> (plain)</td>
<td>x/y shared; text/font/anchor/dx → the label; everything else → the dot</td>
<td>natural (the dot is LAST, so it takes the composite's channel edits)</td>
<td>the dot</td>
<td>none — it reads no schema and knows nothing about networks</td>
</tr>
<tr>
<td><code>sticker</code></td>
<td><b>preset</b> → <code>composite</code> (plain)</td>
<td>x/y shared; text/font/anchor → the label; everything else → the box. <b><code>width</code>/<code>height</code> auto-size from the MEASURED text</b> (core/measure.js) unless stated; a stated <code>width</code> is the WRAP width too, so a resize re-flows the note instead of cropping it</td>
<td>natural via the BOX</td>
<td>the RECT owns every edit and is drawn first; the label is inert and drawn on top — putting <code>editText</code> on the label would give it a <code>fontSize</code>-radius hit disc dead centre of the note</td>
<td>none; pair with <code>editText({ multiline: true })</code> for a typable paragraph, and drag it with <code>move({ mode: 'relative' })</code> — a box has AREA, so an absolute move snaps its centre to the pointer on press</td>
</tr>
</tbody>
</table>

## Parametric glyphs

<table>
<thead>
<tr>
<th>Factory</th>
<th>Kind</th>
<th>Channels (notes)</th>
<th>create/remove</th>
<th>Handles / signifiers</th>
<th>requires / capability</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>trend</code></td>
<td>parametric</td>
<td>x/y = <b>axes</b>; intercept/slope params (defaults field names)</td>
<td>N/A</td>
<td>circles at <code>anchor</code> / <code>probe</code> (<code>channel</code> tags); line inert</td>
<td>continuous x+y; <code>supportsTrend</code></td>
</tr>
<tr>
<td><code>trendBand</code></td>
<td>parametric</td>
<td>same + spreads; <b>handles default false</b></td>
<td>N/A</td>
<td>opt-in spread handles</td>
<td>continuous x+y; <code>supportsTrend</code></td>
</tr>
<tr>
<td><code>face</code></td>
<td><b>preset</b> → <code>composite</code> (box mode)</td>
<td>six params forwarded to a part's channel (mouthCurve→curvature, eyeScale/eyeSquint→rx/ry, browHeight→y, browTilt/mouthAsym→angle); emotion preset binds valence/arousal if unbound</td>
<td>natural via the BOX (x/y/size and mark-level edits ride there)</td>
<td><b>shape is the control</b> — each feature is its own mark, so no arbitration and no <code>handles</code> option</td>
<td>none (it is a desugaring; there is no <code>edit.face.*</code>)</td>
</tr>
</tbody>
</table>

## Geographic

<table>
<thead>
<tr>
<th>Factory</th>
<th>Kind</th>
<th>Channels (notes)</th>
<th>create/remove</th>
<th>Handles / signifiers</th>
<th>requires / capability</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>geoPoint</code></td>
<td>data</td>
<td>lon/lat</td>
<td>natural (<code>edit.geo.*</code>)</td>
<td>whole point</td>
<td><code>supportsGeo</code> + projection</td>
</tr>
<tr>
<td><code>geoLine</code></td>
<td>data</td>
<td>lon/lat rows or coordinates</td>
<td>natural</td>
<td>vertices when <code>showVertices</code></td>
<td><code>supportsGeo</code> (+ series in row mode)</td>
</tr>
<tr>
<td><code>geoPolygon</code></td>
<td>data</td>
<td>geometry</td>
<td><code>edit.geo.draw</code></td>
<td>vertices</td>
<td><code>supportsGeo</code></td>
</tr>
<tr>
<td><code>geoRect</code></td>
<td>data</td>
<td>W/S/E/N</td>
<td><code>edit.geo.brush</code> / <code>createRect</code></td>
<td>edges/body via driver</td>
<td><code>supportsGeo</code></td>
</tr>
<tr>
<td><code>geoText</code></td>
<td>data</td>
<td>lon/lat + text</td>
<td>content via <code>editText</code></td>
<td>label</td>
<td><code>supportsGeo</code></td>
</tr>
<tr>
<td><code>geoBasemap</code></td>
<td>map chrome</td>
<td>GeoJSON option, not dataset</td>
<td>N/A</td>
<td>pointer-transparent</td>
<td><code>supportsGeo</code></td>
</tr>
<tr>
<td><code>geoTile</code></td>
<td>map chrome</td>
<td>tile URL; mercator only</td>
<td>N/A</td>
<td>pointer-transparent</td>
<td><code>supportsGeo</code></td>
</tr>
</tbody>
</table>

## Chart elements (`elicit.elements.*`)

<table>
<thead>
<tr>
<th>Factory</th>
<th>Kind</th>
<th>Notes</th>
<th>create/remove</th>
<th>Handles</th>
<th>Edits</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>axis</code> / <code>axisX</code> / <code>axisY</code></td>
<td>element</td>
<td>singular <code>channel</code>; chrome options</td>
<td>N/A</td>
<td>domain end grips / category labels</td>
<td><code>edit.axis.scale</code> / <code>edit.scale.categories</code></td>
</tr>
<tr>
<td><code>grid</code> / <code>gridX</code> / <code>gridY</code></td>
<td>element</td>
<td>non-interactive chrome</td>
<td>N/A</td>
<td>—</td>
<td>none</td>
</tr>
<tr>
<td><code>legend</code> / <code>legendColor</code> / <code>legendSize</code> / <code>legendSymbol</code><br/><small>usually built from a channel's <code>legend:</code> or <code>legends: true</code></small></td>
<td>element</td>
<td>may reserve layout space</td>
<td>N/A</td>
<td>ramp grip / swatches</td>
<td><code>edit.legend.category</code> / <code>edit.legend.value</code> / <code>edit.scale.categories</code></td>
</tr>
<tr>
<td><code>axisRadial</code></td>
<td>element</td>
<td>angle scale chrome; optional x/y/fill <b>placement</b> channels for per-row rings</td>
<td>N/A</td>
<td>inert</td>
<td>domain editing out of scope</td>
</tr>
</tbody>
</table>

---

## Shared rules (quick)

1. Marks are **inert** until an edit names the column(s) it writes.
2. Edits write **fields** — `resolveChannels` drops constant `{ value }` channels.
3. Schema owns type + domain; data must not invent undeclared columns.
4. Guide = rules; Effect = state; never paint state as presentation attributes.
5. Encoding path: `encodeChannel` / `categoryOf` / `encodeValue` — not raw `scale.encode` in mark `build`.
6. A mark that partitions a total among a group of rows stamps `node.stack` (`plot/stack.js`) and
   sets `supportsStack`, so `edit.stack.*` inverts through the layout that drew it.
7. A mark that draws ONE row as MANY nodes states the row's whole shape as
   `node.effectShape` (a plain geometry node), or a hover/selection outline rings whichever
   node the effects pass finds first — a waffle's cell 0 rather than its block.
