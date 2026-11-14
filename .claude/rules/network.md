---
paths:
  - "src/plot/link.js"
  - "src/plot/linkGeometry.js"
  - "src/plot/linkRouter.js"
  - "src/plot/port.js"
  - "src/plot/nodeBox.js"
  - "src/plot/node.js"
  - "src/plot/sticker.js"
  - "src/plot/hitpath.js"
  - "src/edit/network.js"
  - "src/edit/drivers/connect.js"
  - "test/link*.test.js"
  - "test/ports.test.js"
  - "test/multigraph.test.js"
---

# Networks: links, routing, ports

See also the data rule for `directed`, `multi`, `selfLoops` and referential integrity.

## Connector shapes

- A shape is a row in `LINK_SHAPES` (`plot/linkGeometry.js`), never a branch in `link.build()`. Each entry is `{ anchors, build }`; `build` returns `{ d? | points?+curve?, hit?, start, end, mid, tangentIn, tangentOut }`.
- `anchors: 'chord'` = segment already inset; `'box'` = node centres plus half-extents (an orthogonal route insets along the edge normal).
- Arrowheads and endpoint handles go at the shape's own `start`/`end`; labels at `mid`; arrows point down the tangents.
- Prefer `points` over `d`: only polylines are pickable (`edit/pick.js`) and canvas-drawable. A `d` shape must return a sampled `hit` polyline via `plot/hitpath.js` (rounded corners go through `sampleQuadratic`). `link` emits the hit path first, beneath the paint.
- Curvature is signed and dimensionless (apex fraction of the chord), so `separationBows` fans pairs apart arithmetically.

## Node boxes

- The node mark declares `Mark.nodeBox(row, …)` — a pure function of the row. The engine hands that rule to `link` (`context.nodeBox`), ports, and network edits (`ctx.nodeBox`). Boxes come from `plot/nodeBox.js` only.
- A link never reads another feature's built nodes (a frame behind, absent in a ghost build) and never restates the box (no `nodeWidth`/`nodeHeight`).
- Where a box is chosen, a mark without `labelBox` wins over `text`, so links meet a node's dot, not its name. Round boxes (`NodeBox.round`) are met on the circle.

## Routing (`plot/linkRouter.js`)

- Each end is a port `{ side, offset }`. `side: null` slides: it docks where the centre-to-centre ray leaves the box (`perimeterPort`), so it moves continuously. A side pins it at that edge (`anchorOn`; offset is a clockwise fraction, which is what lets `±bow` separate a reciprocal pair).
- Nothing chooses a side for a portless node. Earlier choosers flipped edges as nodes crossed a decision boundary. Two facing sliding ends close a jog via `alignFacing`.
- The grid search (`routingGrid` + `searchGrid`) is a repair, run only when the plain Z/C/L route crosses a box, falling back to the plain route if no path exists. `link.build` builds boxes and grid once per build.
- Chord kinds dock at the box perimeter; a `bezier` leaving a pinned edge takes its normal as the tangent (arm capped when facing away).
- Loops dock on their node's box (`loopSides`). A loop never lands on the port the drag started from, and on the starting body only once the pointer moved (`session.fromPoint`).
- `inset` is a buffer off the node's shape; an end at a port takes none.

## Ports

- `ports: { value | fn | field, edit: edit.network.connect() }` is a channel on the node mark (point/rect/sticker/node/composite). Values: `true`, sides, or `{ out, in }` on a directed table (`portRolesOf`, `plot/port.js`).
- The engine desugars it once into a sibling port feature placed on the host's `nodeBox`, painted after the host, so a port drag reaches `connect` and never the host's `move`. No standalone port mark.
- On a node with ports, an unpinned end takes the usable port facing the other end (`facingSide`) — a deliberate choice, like a board tool's magnets.
- Visibility is state, decided by the engine's state pass: at rest, the ports a link can leave by (only if it could land somewhere); while dragging, exactly the drop targets. "Could land" is a trial commit: an edit declares `Edit.targets`, `reachableKeys` runs each through `computeEdit` without committing, the connect driver parks them as `session.targets`, and the state pass lights those `portKey`s across features. Hidden = opacity 0 and no pointer events.
- Link end handles are `onHover` + `raise`. Dragging one re-points that end; dropping it on nothing removes the link (a link can't dangle). Body drops write `null`, never a chosen side.

## Sides as data

- `sourceSide`/`targetSide` are read raw like `curve`/`arrow`: a mark option or `{ fn }`, and a column only when the link's channel names a `field`. That channel is what `connect` and `rewire` write (`ctx.targetChannels`). Never invent columns from a schema key, and never name a column in an edit option.

## Edits

- `connect` goes on a node mark's `ports` channel (or node mark `edits`) with no `scope`. `rewire`/`reverse` go on `link` with `scope: 'network'`.
- `connect` beside a plain `move` on the same node fights (`warnConnectConflict`); fix with `when.shift` / `when.noShift`, or better, put `connect` on `ports`.
