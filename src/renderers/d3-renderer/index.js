// @ts-check
import * as d3 from "d3";
import { DEFAULT_EFFECTS, ELEMENT_EFFECT_PROPS } from "../../core/effects.js";
import { markCenter } from "../../edit/shared.js";
import { rectHitBox, MIN_GRAB } from "../../edit/pick.js";
import { resolveCurve, STYLE_FIELDS, partitionScene } from "../shared.js";

// A camelCase effect property -> its CSS property name (strokeWidth ->
// stroke-width). Effects are applied as CSS PROPERTIES rather than SVG
// presentation attributes, so they override the mark's own paint while set and
// vanish cleanly when removed — see core/effects.js.
const cssProp = (/** @type {string} */ k) =>
  k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export class D3Renderer {
  constructor() {
    // The standard paint surface: node field -> [SVG attribute, base default].
    // Every shape draw runs `_applyStyle`, which reads these off the node.
    // The channel list is shared with every other renderer (see STYLE_FIELDS in
    // renderers/shared.js) — ADDING A STYLE CHANNEL IS ONE ROW THERE.
    /** @type {[string, string, any][]} */
    this.STYLE_ATTRS = STYLE_FIELDS.map(({ field, svgAttr, base }) => [
      field,
      svgAttr,
      base,
    ]);
    // Plane gesture state. It lives on the renderer, not the DOM, so it survives
    // the re-render the engine runs on every commit mid-drag.
    /** @type {any} */
    this._planeGesture = null;
    /** @type {{ move: (e: any) => void, end: (e: any) => void } | null} */
    this._planeTracking = null;
    /** @type {((event: any) => [number, number]) | null} */
    this._planePointer = null;
    /** @type {any} */
    this._planeNode = null;
    // Is a direct-pick (d3.drag) stroke open? See _endMarkDrag.
    this._markDragLive = false;
  }

  /** The theme's default text size (fallback for a text node with no fontSize). */
  _themeFontSize() {
    return (this._theme && this._theme.font && this._theme.font.size) || 10;
  }

  /**
   * @param {any} context
   */
  render(context) {
    const {
      container,
      scene,
      width,
      height,
      margins,
      onEvent,
      planeOnTop = false,
      planeCursor = "pointer",
      responsive = "fixed",
      overflow = "hidden",
      focusOutline = false,
    } = context;
    const effects = context.effects || DEFAULT_EFFECTS;

    const innerWidth = width - margins.left - margins.right;
    const innerHeight = height - margins.top - margins.bottom;

    const { g, plane } = this._ensureScene(container, {
      width,
      height,
      margins,
      innerWidth,
      innerHeight,
      responsive,
      overflow,
    });

    // Stashed for the text mark's content-edit overlay (_editText), which is
    // spawned from a node's dblclick handler outside this closure.
    this._sceneG = g;
    this._onEvent = onEvent;
    // The chart's resolved theme (stashed for the draw helpers' font-size fallback).
    // When the theme names a font family, emit it on the root svg so every SVG text
    // inherits it; a null family (the default look) leaves the host page's font.
    this._theme = context.theme || null;
    const themeFont = this._theme && this._theme.font;
    d3.select(container).select("svg")
      .style("font-family", (themeFont && themeFont.family) || null)
      // The chart backdrop (null => transparent). Covers the margin band, so a
      // dark theme's labels sit on the dark background too.
      .style("background", (this._theme && this._theme.background) || null);

    /** @param {any} event */
    const pointer = (event) => d3.pointer(event, g.node());

    this._bindPlaneGestures(plane, pointer, onEvent, planeOnTop);

    const drag = this._makeDrag(onEvent);
    // Hover rides along with drag: the same nodes, so anything you can grab
    // responds before you press it. See _makeHover.
    const hover = this._makeHover(onEvent, effects.hovered);
    // Keyboard access rides along with drag: same nodes, same edits.
    // focusOutline gates only the native ring — tabindex / nudge stay on.
    const keys = this._makeKeyboard(onEvent, focusOutline);
    // A mark-scoped click (routed to the mark's click edits, e.g. cycle /
    // remove). d3.drag suppresses the click after a real drag, so this only
    // fires on a click without movement — drag moves, click edits.
    /** @param {any} event @param {any} d */
    const markClick = (event, d) => {
      const [px, py] = pointer(event);
      onEvent({ type: "click", x: px, y: py, node: d, rawEvent: event });
    };
    // A mark-scoped double click (edit.stack.merge, or any direct edit that takes
    // `gesture: 'dblclick'`). Without this the gesture existed only on the PLANE,
    // so a dblclick edit on a node could never fire — and stopPropagation is what
    // keeps it from also reaching the plane, where a create edit would mint a row
    // on top of it.
    /** @param {any} event @param {any} d */
    const markDblClick = (event, d) => {
      event.preventDefault();
      event.stopPropagation();
      const [px, py] = pointer(event);
      onEvent({ type: "dblclick", x: px, y: py, node: d, rawEvent: event });
    };

    // Role layers are fixed (background → guide regions → marks → guide
    // front → effects). Within the mark layer, features/parts array order is
    // z-order — type joins still bind by shape, then we reorder DOM.
    const { background, guideRegions, marks, guideFront, effects: effectNodes } =
      partitionScene(scene.children);
    /** @param {any[]} list @param {string} t */
    const ofType = (list, t) =>
      list.filter((/** @type {any} */ n) => n.type === t);

    const layers = this._sceneLayers(g);

    this._drawBackground(
      layers.bg,
      ofType(background, "image"),
      ofType(background, "path"),
      ofType(background, "line"),
      ofType(background, "text"),
      ofType(background, "rect"),
      ofType(background, "circle"),
    );

    this._drawGuideRegions(layers.guideBack, guideRegions);

    // Type joins into mark-layer (binding / events); z-order fixed after.
    this._drawPaths(layers.marks, ofType(marks, "path"), {
      drag,
      markClick,
      markDblClick,
      keys,
      hover,
    });
    this._drawMarks(
      layers.marks,
      ofType(marks, "rect"),
      ofType(marks, "circle"),
      { drag, markClick, markDblClick, keys, hover },
    );
    this._drawEllipses(layers.marks, ofType(marks, "ellipse"), {
      drag,
      markClick,
      markDblClick,
      keys,
      hover,
    });
    this._drawLines(layers.marks, ofType(marks, "line"), {
      drag,
      markClick,
      markDblClick,
      keys,
      hover,
    });
    this._drawTextMarks(layers.marks, ofType(marks, "text"), {
      drag,
      markClick,
      markDblClick,
      keys,
      hover,
    });
    this._orderMarkLayer(layers.marks, marks);

    // Rules / constraint ticks / guide labels — in front of marks.
    this._drawGuideFront(layers.guideFront, guideFront);

    // Interaction overlays (proximity ring, select outline) — above everything.
    this._drawEffects(layers.effects, effectNodes);

    // In plane-on-top (proximity) mode the plane must sit above the marks and
    // own all pointer events; the marks become purely visual. Guides/effects
    // already use pointer-events:none, so they remain visible through the plane.
    if (planeOnTop) {
      // Silence the grab overlays too (.mark-hit): in proximity mode the plane owns
      // every gesture, and a leftover hit rect would swallow it just like a mark.
      g.selectAll(".mark, .mark-hit").style("pointer-events", "none");
      // The target order is [..., plane, effects] — the plane above every mark,
      // and the (pointer-transparent) effect overlays above the plane. Skip the
      // DOM move when it already holds, the same rule _orderMarkLayer follows:
      // `raise()` is an unconditional appendChild, and re-inserting a node drops
      // any pointer capture on it and blurs it. The engine re-renders on every
      // drag commit, so this ran continuously mid-gesture.
      const planeNode = plane.node();
      const effectsNode = layers.effects.node();
      const parent = planeNode && planeNode.parentNode;
      const stacked =
        parent &&
        parent.lastElementChild === effectsNode &&
        effectsNode.previousElementSibling === planeNode;
      if (!stacked) {
        plane.raise();
        layers.effects.raise();
      }
      plane.style("cursor", planeCursor || "pointer");
    }
  }

  // -- setup ---------------------------------------------------------------

  /**
   * Once-only scaffolding: the svg, the translated scene group, the transparent
   * interaction plane, and the background layer (behind every mark). Idempotent
   * — on re-render it just returns the existing nodes.
   * @param {any} container
   * @param {{ width: number, height: number, margins: any, innerWidth: number, innerHeight: number, responsive?: string, overflow?: string }} dims
   * @returns {{ svg: any, g: any, plane: any }}
   */
  _ensureScene(
    container,
    {
      width,
      height,
      margins,
      innerWidth,
      innerHeight,
      responsive = "fixed",
      overflow = "hidden",
    },
  ) {
    /** @type {any} */
    let svg = d3.select(container).select("svg");
    if (svg.empty()) {
      svg = d3
        .select(container)
        .append("svg")
        .style("user-select", "none") // prevent text selection during drag
        .style("display", "block"); // no inline-baseline gap under the svg

      const g = svg.append("g").attr("class", "scene-container");

      // Transparent background plane, behind everything, that captures
      // interactions on empty space (used by plane-pick edits, e.g. create).
      g.append("rect")
        .attr("class", "plane")
        .attr("x", 0)
        .attr("y", 0)
        .style("fill", "transparent")
        .style("pointer-events", "all");

      // Background layer, right above the plane and behind every mark. Axes
      // and gridlines (composable marks emitting `background:true` nodes,
      // see plot/axis.js) render here so marks always sit on top of them.
      g.append("g").attr("class", "bg-layer");
      // Guide regions behind marks; mark-layer holds ordinary marks in array
      // z-order; guide-front holds rules / guide labels; effects hold
      // interaction overlays (proximity ring / select outline) on top of all.
      g.append("g").attr("class", "guide-back-layer");
      g.append("g").attr("class", "mark-layer");
      g.append("g").attr("class", "guide-front-layer");
      g.append("g").attr("class", "effects-layer");
    }

    // Sizing runs every render (not just on create) so 'reflow' picks up new
    // pixel dims and 'scale' keeps its viewBox. In 'scale' the SVG carries a
    // viewBox and stretches to 100% of the parent (aspect ratio preserved); the
    // other modes size the SVG in real pixels. `d3.pointer(_, g)` reads through
    // getScreenCTM, so gestures map correctly under a viewBox too.
    if (responsive === "scale") {
      svg
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("width", null)
        .attr("height", null)
        .style("width", "100%")
        .style("height", "auto");
    } else {
      svg
        .attr("viewBox", null)
        .attr("width", width)
        .attr("height", height)
        .style("width", null)
        .style("height", null);
    }

    // Let marks draw into the margin band (radial/gauge labels) when asked; the
    // default keeps the historical clip to the SVG viewport.
    svg.style("overflow", overflow === "visible" ? "visible" : null);

    const g = svg
      .select(".scene-container")
      .attr("transform", `translate(${margins.left},${margins.top})`);
    g.select("rect.plane")
      .attr("width", innerWidth)
      .attr("height", innerHeight);
    // Ensure role layers exist (fresh svg creates them above; a long-lived
    // container from before mark-layer existed still needs the groups).
    this._sceneLayers(g);
    return { svg, g, plane: g.select("rect.plane") };
  }

  /**
   * Role-layer groups under the scene container. Order in the DOM is the
   * paint stack: plane → bg → guide-back → marks → guide-front → effects.
   * Only mutates the layer list when a group is first created — re-appending
   * every frame would move focused mark nodes and break keyboard editing.
   * @param {any} g scene container
   * @returns {{ bg: any, guideBack: any, marks: any, guideFront: any, effects: any }}
   */
  _sceneLayers(g) {
    const hadMarkLayer = !g.select("g.mark-layer").empty();
    /** @type {string[]} */
    const created = [];
    /** @param {string} cls */
    const ensure = (cls) => {
      let layer = g.select(`g.${cls}`);
      if (layer.empty()) {
        layer = g.append("g").attr("class", cls);
        created.push(cls);
      }
      return layer;
    };
    const bg = ensure("bg-layer");
    const guideBack = ensure("guide-back-layer");
    const marks = ensure("mark-layer");
    const guideFront = ensure("guide-front-layer");
    const effects = ensure("effects-layer");
    // Pre-layer renderers joined marks as direct children of `g`. Drop those
    // orphans once when the mark-layer is introduced so they can't ghost.
    if (!hadMarkLayer) {
      g.selectAll(
        ":scope > .mark, :scope > path.mark-line, :scope > .guide-region, :scope > .guide-circle, :scope > .guide-label",
      ).remove();
    }
    if (created.length) {
      // Pin bottom→top order only when the structure changed.
      const root = /** @type {SVGGElement} */ (g.node());
      const plane = g.select("rect.plane").node();
      for (const el of [
        plane,
        bg.node(),
        guideBack.node(),
        marks.node(),
        guideFront.node(),
        effects.node(),
      ]) {
        if (el) root.appendChild(/** @type {Node} */ (el));
      }
    }
    return { bg, guideBack, marks, guideFront, effects };
  }

  /**
   * Reorder mark-layer children so DOM z-order matches `marks` (scene order).
   * Type joins append in path→rect→circle→line→text call order; this undoes
   * that so later features/parts paint on top. Restores focus if sort moved
   * the active element (keyboard editing keeps a mark focused across redraws).
   * @param {any} markLayer
   * @param {any[]} marks
   */
  _orderMarkLayer(markLayer, marks) {
    const order = new Map(
      marks.map((/** @type {any} */ n, /** @type {number} */ i) => [n, i]),
    );
    const sel = markLayer
      .selectAll(".mark, path.mark-line")
      .filter((/** @type {any} */ d) => order.has(d));
    // Skip the DOM move when already sorted — appendChild on a focused node
    // blurs it and breaks arrow-key editing mid-gesture.
    const nodes = /** @type {Element[]} */ (sel.nodes());
    let prev = -1;
    let needsSort = false;
    for (const el of nodes) {
      const i = /** @type {number} */ (
        order.get(d3.select(el).datum())
      );
      if (i < prev) {
        needsSort = true;
        break;
      }
      prev = i;
    }
    if (!needsSort) return;

    const active = typeof document !== "undefined" ? document.activeElement : null;
    const root = /** @type {Element | null} */ (markLayer.node());
    sel.sort(
      (/** @type {any} */ a, /** @type {any} */ b) =>
        /** @type {number} */ (order.get(a)) -
        /** @type {number} */ (order.get(b)),
    );
    if (
      active &&
      root &&
      root.contains(active) &&
      typeof (/** @type {any} */ (active).focus) === "function"
    ) {
      /** @type {HTMLElement} */ (active).focus();
    }
  }

  /**
   * Wire plane gestures. `click`/`dblclick` are always available (create). In
   * plane-on-top mode we additionally drive hover + drag manually (rather than
   * via d3.drag, whose preventDefault suppresses dblclick), distinguishing a
   * click from a drag ourselves and keeping gesture state on the renderer so it
   * survives re-renders mid-drag.
   * @param {any} plane
   * @param {(event: any) => [number, number]} pointer
   * @param {(e: any) => void} onEvent
   * @param {boolean} planeOnTop
   */
  _bindPlaneGestures(plane, pointer, onEvent, planeOnTop) {
    plane
      .on("click", (/** @type {any} */ event) => {
        // A plane drag (below) ends with a native `click` on the same element.
        // Swallow that one so a drag-to-edit doesn't also fire a click-gesture
        // edit (e.g. create/anchor minting a point where the drag released).
        // A click without a preceding drag passes through untouched.
        if (this._suppressClick) {
          this._suppressClick = false;
          return;
        }
        const [px, py] = pointer(event);
        onEvent({ type: "click", x: px, y: py, rawEvent: event });
      })
      .on("dblclick", (/** @type {any} */ event) => {
        const [px, py] = pointer(event);
        onEvent({ type: "dblclick", x: px, y: py, rawEvent: event });
      });

    if (!planeOnTop) {
      // The mode can flip between renders (an edit is added, a stage advances).
      // Leaving the press handlers bound would keep a dead plane drag alive, and
      // an in-flight gesture has no listener left to end it — abandon it here.
      this._abortPlaneGesture();
      plane.on("pointerdown", null).on("pointermove", null).on("pointerleave", null);
      return;
    }

    // Read live from `this` by the window-level handlers below, which outlive any
    // one render (see _trackPlaneGesture).
    this._planePointer = pointer;
    this._planeNode = plane.node();

    plane
      .on("pointerdown", (/** @type {any} */ event) => {
        const [px, py] = pointer(event);
        this._planeGesture = {
          startX: px,
          startY: py,
          down: true,
          dragging: false,
          pointerId: event.pointerId,
        };
        // NO setPointerCapture. It was here to keep move/up flowing once the
        // pointer left the plane, and it did not work: the engine re-renders on
        // every commit, `render()` calls `plane.raise()` in plane-on-top mode, and
        // moving a node in the DOM implicitly releases its capture. The very first
        // drag commit dropped it, so releasing the button anywhere off the plane
        // never delivered `pointerup` here — the gesture stayed `down: true`
        // forever and the next plain pointermove over the chart resumed painting
        // data with no button held. The window listeners below are what d3.drag
        // does, and they survive re-render, a DOM move and the pointer leaving.
        this._trackPlaneGesture();
      })
      .on("pointermove", (/** @type {any} */ event) => {
        // While a gesture is live the window handler owns movement (it sees the
        // pointer off-plane too); this element-level one would double-report.
        if (this._planeGesture) return;
        const [px, py] = pointer(event);
        onEvent({ type: "hover", x: px, y: py, rawEvent: event });
      })
      .on("pointerleave", (/** @type {any} */ event) => {
        if (!this._planeGesture) onEvent({ type: "hoverout", rawEvent: event });
      });
  }

  /**
   * Follow a live plane drag on the WINDOW until the pointer is released or
   * cancelled. Bound once per gesture and torn down on release, so nothing
   * accumulates across the many re-renders a drag causes.
   */
  _trackPlaneGesture() {
    if (this._planeTracking || typeof window === "undefined") return;
    const move = (/** @type {any} */ event) => this._planeMoved(event);
    const end = (/** @type {any} */ event) => this._planeReleased(event);
    this._planeTracking = { move, end };
    // Capture phase: the plane's own listeners are guarded against a live
    // gesture, but this also beats anything else on the page to the release.
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  }

  _releasePlaneTracking() {
    const t = this._planeTracking;
    if (!t || typeof window === "undefined") return;
    window.removeEventListener("pointermove", t.move, true);
    window.removeEventListener("pointerup", t.end, true);
    window.removeEventListener("pointercancel", t.end, true);
    this._planeTracking = null;
  }

  /** Drop an in-flight plane gesture without emitting a dragend (mode change / teardown). */
  _abortPlaneGesture() {
    this._releasePlaneTracking();
    this._planeGesture = null;
  }

  /** @param {any} event */
  _planeMoved(event) {
    const gesture = this._planeGesture;
    if (!gesture || !this._planePointer || !this._onEvent) return;
    if (gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    // No button held: the release was never delivered (let go outside the browser
    // window, or the window lost focus). Close the gesture where it stands rather
    // than resuming a drag the reader is no longer making.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      return this._planeReleased(event);
    }
    const [px, py] = this._planePointer(event);
    if (
      !gesture.dragging &&
      Math.hypot(px - gesture.startX, py - gesture.startY) > 3
    ) {
      gesture.dragging = true;
      this._onEvent({
        type: "dragstart",
        x: gesture.startX,
        y: gesture.startY,
        rawEvent: event,
      });
    }
    if (gesture.dragging) {
      this._onEvent({ type: "drag", x: px, y: py, rawEvent: event });
    }
  }

  /** @param {any} event */
  _planeReleased(event) {
    const gesture = this._planeGesture;
    if (!gesture) return this._releasePlaneTracking();
    if (gesture.pointerId != null && event.pointerId !== gesture.pointerId) return;
    this._releasePlaneTracking();
    this._planeGesture = null;
    if (!this._planePointer || !this._onEvent) return;
    const [px, py] = this._planePointer(event);
    if (gesture.dragging) {
      this._onEvent({ type: "dragend", x: px, y: py, rawEvent: event });
      // Suppress the native click the browser fires next (see 'click').
      this._suppressClick = true;
    }
    // Released off the chart: the plane's own pointerleave was suppressed while
    // the button was down, so nothing else will retire the hover session.
    if (!this._pointerOverPlane(event)) {
      this._onEvent({ type: "hoverout", rawEvent: event });
    }
  }

  /** @param {any} event @returns {boolean} */
  _pointerOverPlane(event) {
    const node = this._planeNode;
    if (!node || typeof node.getBoundingClientRect !== "function") return false;
    const r = node.getBoundingClientRect();
    return (
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    );
  }

  /**
   * Keyboard access to a mark, attached wherever `drag` is. A pointer is not the
   * only way to mean "this value, please": tab to a mark and arrow-key it.
   *
   * The renderer owns the keyboard lifecycle here for the same reason it owns
   * editText's inline input — it keeps the engine ignorant of the mode. It emits a
   * `nudge`, a semantic "one step this way", NOT a pixel delta: how far a step goes
   * is a question only the scale can answer (a fixed pixel nudge is a no-op on a
   * band axis until it happens to cross an edge), and the engine resolves it into
   * the ordinary drag every edit already understands.
   *
   * Only `editable` nodes take focus: a node with no direct-pick edit has nothing
   * a keypress could do, so putting it in the tab order would be a dead stop for
   * anyone tabbing through. `focusOutline` (default false) is the native browser
   * ring — off suppresses it; keyboard nudge still works either way.
   * @param {(e: any) => void} onEvent
   * @param {boolean} [focusOutline]
   * @returns {(sel: any) => void}
   */
  _makeKeyboard(onEvent, focusOutline = false) {
    /** @type {Record<string, [-1 | 0 | 1, -1 | 0 | 1]>} */
    const ARROWS = {
      // [dx, dy] in PIXEL space — ArrowUp is negative y, which is why it reads
      // as "up" on screen and (on a conventional y axis) as "more".
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    return (/** @type {any} */ sel) => {
      sel
        .attr("tabindex", (/** @type {any} */ d) => (d.editable ? 0 : null))
        .attr("role", (/** @type {any} */ d) => (d.editable ? "button" : null))
        // Suppress the browser's default focus ring unless the chart asked for it.
        // Cleared (null) when on so the UA stylesheet paints its usual outline.
        .style("outline", focusOutline ? null : "none")
        .on("keydown", (/** @type {any} */ event, /** @type {any} */ d) => {
          if (!d || !d.editable) return;
          const arrow = ARROWS[event.key];
          if (!arrow) return;
          event.preventDefault(); // don't scroll the page out from under it
          const [dx, dy] = arrow;
          onEvent({
            type: "nudge",
            node: d,
            dx,
            dy,
            coarse: !!event.shiftKey,
            rawEvent: event,
          });
        });
    };
  }

  /**
   * The drag behaviour attached to every interactive mark. clickDistance lets a
   * press that moves < N px still count as a click (d3 otherwise suppresses the
   * click on any movement), so mark-click editors fire reliably alongside drag.
   * @param {(e: any) => void} onEvent
   * @param {any} [grab] the resolved `grab` effect ({ filter } | null-filter to disable)
   * @returns {any}
   */
  /**
   * Hover feedback on a MARK. The counterpart to _makeDrag, attached to exactly the
   * same nodes, so anything grabbable answers the pointer before it is pressed.
   *
   * Before this, hover existed only in plane-on-top mode (a proximity/sweep driver
   * needs pointer tracking over the whole plane), which meant a direct-pick mark —
   * a draggable bar, a trend handle — gave no pre-press signal at all. A cursor
   * change was the entire vocabulary.
   *
   * This REPORTS, it does not paint. `pointerover`/`pointerout` go to the engine,
   * which records ui.hover and decides both halves of the effect in its state pass —
   * the outline overlay AND the mark's own restyle, which arrives back here as
   * `node.effectStyle` for `_applyEffectStyle` to apply. The renderer used to paint
   * the element half itself, straight off these two events; that was a second painter
   * with a different source of truth, so `hovered: { fill }` lit up under a direct
   * pick and stayed dark under a proximity driver's hover of the very same row.
   * @param {(e: any) => void} onEvent
   * @param {any} hovered the resolved `hovered` effect config
   * @returns {(sel: any) => void}
   */
  _makeHover(onEvent, hovered) {
    const enabled = !hovered || hovered.enabled !== false;
    return (sel) => {
      sel
        .on("pointerenter", /** @type {any} */ (/** @type {any} */ _event, /** @type {any} */ d) => {
          if (!enabled || !d || !d.editable) return;
          onEvent({ type: "pointerover", node: d });
        })
        .on("pointerleave", /** @type {any} */ (/** @type {any} */ _event, /** @type {any} */ d) => {
          if (!enabled || !d || !d.editable) return;
          onEvent({ type: "pointerout", node: d });
        });
    };
  }

  /**
   * @param {(e: any) => void} onEvent
   * @returns {any}
   */
  _makeDrag(onEvent) {
    // Grab feedback is NOT painted here. dragstart/dragend tell the engine where the
    // gesture is, it records ui.grab, and the state pass resolves `grabbed` beside
    // `hovered`/`selected` — arriving back as `node.effectStyle` (and, now, an
    // outline, which this path could never draw). Painting it here read only
    // `grabbed.filter` and silently dropped the other five properties of a
    // vocabulary core/effects.js documents as uniform across the three states.
    //
    // dragstart/dragend bracket the stroke. No edit declares them as a `gesture`
    // (they match nothing in dispatch), but they tell the engine where one
    // continuous gesture begins and ends — which is what lets undo step back a
    // whole drag instead of one pointermove at a time. The plane drag already
    // emits the same three; this makes the mark drag's lifecycle match it.
    return d3
      .drag()
      .clickDistance(4)
      // THE POINTER, not the node. d3.drag's default subject is the bound datum,
      // and it then reports `event.x/y` as `subject.x + (pointer - grabPointer)` —
      // so on any node that happens to carry `x`/`y` the gesture arrives shifted by
      // that node's own coordinate. A circle has cx/cy, so `s.x - p[0] || 0` fell
      // to 0 and the whole library looked correct; a rect carries its TOP-LEFT, so
      // every drag on one reported a pointer half a box up and to the left, and
      // `move` wrote that as the centre — a sticker jumped (-w/2, -h/2) the moment
      // you pressed it. It is not only `move`: ctx.pointer is what every edit
      // inverts, what pick.js measures distance with, and what a driver anchors to.
      // The canvas renderer sends the raw scene coordinate (renderers/canvas/
      // events.js), so this was also the two renderers disagreeing about what a
      // drag means. Stating the subject makes dx/dy zero: `event.x/y` is the
      // pointer in scene coordinates, on every node type, in both renderers.
      .subject((/** @type {any} */ event) => ({ x: event.x, y: event.y }))
      .on("start", (/** @type {any} */ event, /** @type {any} */ d) => {
        this._markDragLive = true;
        onEvent({
          type: "dragstart",
          x: event.x,
          y: event.y,
          node: d,
          rawEvent: event.sourceEvent,
        });
      })
      .on("drag", (/** @type {any} */ event, /** @type {any} */ d) => {
        // A move with NO button held means the release was never delivered — the
        // pointer was let go outside the browser window, or the window lost focus
        // mid-drag. d3.drag keeps its window listeners until a mouseup it will
        // never see, so the next time the pointer crosses the page the gesture
        // resumes and the mark tracks a cursor nobody is pressing. Retire it here,
        // once; d3's own `end` is then a no-op (see _endMarkDrag).
        const src = event.sourceEvent;
        if (src && src.type === "mousemove" && src.buttons === 0) {
          this._endMarkDrag(onEvent, event, d);
          return;
        }
        if (!this._markDragLive) return;
        // event.x/event.y are relative to the SVG scene group.
        onEvent({
          type: "drag",
          x: event.x,
          y: event.y,
          node: d,
          rawEvent: event.sourceEvent,
        });
      })
      .on("end", (/** @type {any} */ event, /** @type {any} */ d) => {
        this._endMarkDrag(onEvent, event, d);
      });
  }

  /**
   * Close a mark drag exactly once, whether it ended on a real release or was
   * abandoned (see the `buttons === 0` guard in _makeDrag).
   * @param {(e: any) => void} onEvent
   * @param {any} event
   * @param {any} d
   */
  _endMarkDrag(onEvent, event, d) {
    if (!this._markDragLive) return;
    this._markDragLive = false;
    onEvent({
      type: "dragend",
      x: event.x,
      y: event.y,
      node: d,
      rawEvent: event.sourceEvent,
    });
  }

  // -- style + geometry primitives -----------------------------------------

  /**
   * Apply the standard paint surface (STYLE_ATTRS) to a selection. Per-node
   * value wins; otherwise the caller's `defaults[field]` if given, else the
   * table's base default. This is the single place a style channel is applied.
   * @param {any} sel
   * @param {Record<string, any>} [defaults]
   * @returns {any}
   */
  _applyStyle(sel, defaults = {}) {
    for (const [field, attr, base] of this.STYLE_ATTRS) {
      const def = field in defaults ? defaults[field] : base;
      sel.attr(attr, (/** @type {any} */ d) =>
        d[field] != null ? d[field] : def,
      );
    }
    // Mark a probe ghost-preview node so a test (and a stylesheet) can find it. The
    // single place every mark shape's paint flows through, so one line covers all.
    sel.attr("data-ghost", (/** @type {any} */ d) => (d.ghost ? "" : null));
    // Same idea for a HIT-ONLY node: a composite's box draws an invisible circle
    // over the whole glyph so an edit on the composite's own x/y/size has something
    // to grab. It paints nothing, so without a tag it is indistinguishable in the
    // DOM from a mark that happens to be transparent — and a `circle.mark` selector
    // silently picks it up ahead of the part it sits under.
    sel.attr("data-hit", (/** @type {any} */ d) => (d.hit ? "" : null));
    return sel;
  }

  /**
   * Apply the interaction-effect restyle the engine's state pass stamped on a node
   * (`node.effectStyle` — see core/effects.js). Call it right after `_applyStyle` on
   * every interactive mark join.
   *
   * Two things make this safe to run on every node, every render:
   *   · CSS style PROPERTIES, never attributes. `_applyStyle` writes the mark's real
   *     paint to attributes, so a property beats it while the effect is on and the
   *     data's own paint reappears the instant it comes off.
   *   · every property resolves to `null` when the node is in no state, which is what
   *     REMOVES it. There is no teardown path that can fall out of sync with the
   *     set-up path, because there is only one path.
   * `cursor` is the exception: the joins already set it from the mark's own `cursor`,
   * so the effect layers OVER that rather than nulling it back to nothing.
   * @param {any} sel
   * @param {string} [cursorDefault] the join's own cursor for an editable node
   * @returns {any}
   */
  _applyEffectStyle(sel, cursorDefault = "move") {
    for (const key of ELEMENT_EFFECT_PROPS) {
      if (key === "cursor") continue;
      sel.style(cssProp(key), (/** @type {any} */ d) =>
        d.effectStyle && d.effectStyle[key] != null ? d.effectStyle[key] : null,
      );
    }
    sel.style("cursor", (/** @type {any} */ d) => {
      if (d.effectStyle && d.effectStyle.cursor != null) return d.effectStyle.cursor;
      return d.editable ? d.cursor || cursorDefault : "default";
    });
    return sel;
  }

  /**
   * SVG transform for a node that carries math-degree `angle` (0° = +x, CCW).
   * SVG's rotate() is clockwise in y-down space, so we negate. Pivot is the
   * mark's own centre (rect bbox, line midpoint, text anchor, …).
   * @param {any} d
   * @returns {string | null}
   */
  _angleTransform(d) {
    if (d == null || d.angle == null || d.angle === 0) return null;
    const c = markCenter(d);
    if (!c) return null;
    return `rotate(${-d.angle} ${c.cx} ${c.cy})`;
  }

  /** @param {any} sel */
  _geomRect(sel) {
    sel
      .attr("x", (/** @type {any} */ d) => d.x)
      .attr("y", (/** @type {any} */ d) => d.y)
      .attr("width", (/** @type {any} */ d) => d.width)
      .attr("height", (/** @type {any} */ d) => Math.max(0, d.height)) // no negative height
      // Corner radius. GEOMETRY, not paint — it belongs here rather than in the
      // style sweep, which is colours and stroke only. `ry` follows `rx` unless
      // stated, so one number rounds a corner the way it reads.
      .attr("rx", (/** @type {any} */ d) => (d.rx != null ? d.rx : null))
      .attr("ry", (/** @type {any} */ d) =>
        d.ry != null ? d.ry : d.rx != null ? d.rx : null,
      )
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));
  }

  /** @param {any} sel */
  _geomCircle(sel) {
    sel
      .attr("cx", (/** @type {any} */ d) => d.cx)
      .attr("cy", (/** @type {any} */ d) => d.cy)
      .attr("r", (/** @type {any} */ d) => Math.max(0, d.r != null ? d.r : 5))
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));
  }

  /** @param {any} sel */
  _geomEllipse(sel) {
    sel
      .attr("cx", (/** @type {any} */ d) => d.cx)
      .attr("cy", (/** @type {any} */ d) => d.cy)
      .attr("rx", (/** @type {any} */ d) => Math.max(0, d.rx != null ? d.rx : 5))
      .attr("ry", (/** @type {any} */ d) => Math.max(0, d.ry != null ? d.ry : 5))
      // markCenter reads cx/cy first, so an ellipse rotates about its own centre.
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));
  }

  /** @param {any} sel */
  _geomLine(sel) {
    sel
      .attr("x1", (/** @type {any} */ d) => d.x1)
      .attr("x2", (/** @type {any} */ d) => d.x2)
      .attr("y1", (/** @type {any} */ d) => d.y1)
      .attr("y2", (/** @type {any} */ d) => d.y2)
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));
  }

  /**
   * @param {any} sel
   * @param {string} [anchorDefault]
   */
  _geomText(sel, anchorDefault = "start") {
    sel
      .attr("x", (/** @type {any} */ d) => d.x)
      .attr("y", (/** @type {any} */ d) => d.y)
      .attr(
        "text-anchor",
        (/** @type {any} */ d) => d.textAnchor || anchorDefault,
      )
      // Vertical anchor (text mark's `lineAnchor` → dominant-baseline). Axis
      // tick labels leave this unset and keep the SVG default.
      .attr(
        "dominant-baseline",
        (/** @type {any} */ d) => d.dominantBaseline || null,
      )
      .attr("font-size", (/** @type {any} */ d) =>
        d.fontSize != null ? d.fontSize : this._themeFontSize(),
      )
      // Math degrees on the node; _angleTransform converts to SVG rotate.
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));

    // Content. A WRAPPED label carries its painted lines in `lines` while `text`
    // stays the whole string — so the single-line path below is the common case
    // and the inline editor is still seeded with the paragraph, not one line.
    sel.each(/** @this {SVGTextElement} */ function (/** @type {any} */ d) {
      const node = d3.select(this);
      const lines = Array.isArray(d.lines) ? d.lines : null;
      if (!lines || lines.length <= 1) {
        node.selectAll("tspan").remove();
        node.text(lines ? lines[0] || "" : d.text);
        return;
      }
      const size = d.fontSize != null ? d.fontSize : 12;
      const step = d.lineHeight != null ? d.lineHeight : Math.round(size * 1.35);
      // Centre the block on the node's own y: the anchor means the same thing
      // whether one line or five are painted at it.
      const first = (-(lines.length - 1) * step) / 2;
      node.text(null);
      node
        .selectAll("tspan")
        .data(lines)
        .join("tspan")
        .attr("x", d.x)
        .attr("dy", (/** @type {any} */ _l, /** @type {number} */ i) =>
          i === 0 ? first : step,
        )
        .text((/** @type {any} */ l) => l);
    });
  }

  // -- semantic draws ------------------------------------------------------

  /**
   * Raster tiles, axis spines/ticks, gridlines, axis labels, legend swatches/
   * ramps, and vector basemap paths — into the dedicated layer behind the marks.
   * Non-interactive.
   *
   * Images are joined FIRST (and keyed by {z}/{x}/{y}), so they sit at the back
   * of the layer: a tile basemap is the floor of the chart. The key is what makes
   * panning/zooming cheap — a tile that stays on screen keeps its <image> and
   * never re-fetches. Legend rects/circles (colour chips, size dots, ramp slices)
   * and axis lines/labels follow; background paths (geoBasemap, radial chrome)
   * are last so they sit above grids the way they did when all paths shared the
   * mark path pass.
   *
   * @param {any} bgLayer
   * @param {any[]} bgImages
   * @param {any[]} bgPaths
   * @param {any[]} bgLines
   * @param {any[]} bgTexts
   * @param {any[]} [bgRects]
   * @param {any[]} [bgCircles]
   */
  _drawBackground(bgLayer, bgImages, bgPaths, bgLines, bgTexts, bgRects = [], bgCircles = []) {
    const imgSel = bgLayer
      .selectAll("image")
      .data(bgImages, (/** @type {any} */ d) => d.key)
      .join("image")
      .style("pointer-events", "none")
      .attr("x", (/** @type {any} */ d) => d.x)
      .attr("y", (/** @type {any} */ d) => d.y)
      .attr("width", (/** @type {any} */ d) => d.width)
      .attr("height", (/** @type {any} */ d) => d.height)
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d))
      // Tiles are photographic: let the browser smooth them when a fitted
      // (fractional) zoom scales them off their native 256px.
      .attr("preserveAspectRatio", "none")
      .attr("href", (/** @type {any} */ d) => d.href)
      .attr("opacity", (/** @type {any} */ d) =>
        d.opacity != null ? d.opacity : null,
      );
    imgSel.lower();

    // Legend colour chips / ramp slices / opacity swatches. Painted before axis
    // lines so a side legend's labels (bg texts) sit on top of its chips.
    const rectSel = bgLayer
      .selectAll("rect.bg-rect")
      .data(bgRects)
      .join("rect")
      .attr("class", "bg-rect")
      .style("pointer-events", "none");
    this._geomRect(rectSel);
    this._applyStyle(rectSel, { fill: "none", stroke: "none", strokeWidth: 1, opacity: 1 });

    // Legend size dots (a size channel encodes to a radius, drawn as a circle).
    const circleSel = bgLayer
      .selectAll("circle.bg-circle")
      .data(bgCircles)
      .join("circle")
      .attr("class", "bg-circle")
      .style("pointer-events", "none");
    this._geomCircle(circleSel);
    this._applyStyle(circleSel, { fill: "none", stroke: "none", strokeWidth: 1, opacity: 1 });

    const lineSel = bgLayer
      .selectAll("line")
      .data(bgLines)
      .join("line")
      .style("pointer-events", "none");
    this._geomLine(lineSel);
    this._applyStyle(lineSel, {
      stroke: "#6b7280",
      strokeWidth: 1,
      opacity: 1,
    });

    const textSel = bgLayer
      .selectAll("text")
      .data(bgTexts)
      .join("text")
      .style("pointer-events", "none");
    this._geomText(textSel, "middle");
    this._applyStyle(textSel, { fill: "#374151", opacity: 1 });

    const pathSel = bgLayer
      .selectAll("path.bg-path")
      .data(bgPaths)
      .join("path")
      .attr("class", "bg-path")
      .style("pointer-events", "none")
      .attr("d", (/** @type {any} */ d) => {
        if (d.d) return d.d;
        return d3.line().curve(resolveCurve(d.curve))(d.points || []);
      });
    this._applyStyle(pathSel, {
      fill: "none",
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });
  }

  /**
   * Non-interactive guide regions (shaded bands / outlines), drawn behind marks.
   * @param {any} layer
   * @param {any[]} guideRects
   */
  _drawGuideRegions(layer, guideRects) {
    const rectSel = layer
      .selectAll("rect.guide-region")
      .data(guideRects)
      .join("rect")
      .attr("class", "guide-region")
      .style("pointer-events", "none");
    this._geomRect(rectSel);
    this._applyStyle(rectSel, {
      fill: "none",
      stroke: "none",
      strokeWidth: 1,
      opacity: 1,
    });
  }

  /**
   * Non-interactive guide annotations in front of marks: lines (rules /
   * constraint ticks), paths, and text labels. Drawn in `guideFront` scene
   * order so a rule's line stays with its label. Interaction overlays
   * (proximity ring / select outline) live in the effects layer instead.
   * @param {any} layer
   * @param {any[]} nodes
   */
  _drawGuideFront(layer, nodes) {
    /** @param {string} t */
    const ofType = (t) =>
      nodes.filter((/** @type {any} */ n) => n.type === t);

    const lineSel = layer
      .selectAll("line.guide-line")
      .data(ofType("line"))
      .join("line")
      .attr("class", "guide-line")
      .style("pointer-events", "none");
    this._geomLine(lineSel);
    this._applyStyle(lineSel, {
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });

    const circleSel = layer
      .selectAll("circle.guide-circle")
      .data(ofType("circle"))
      .join("circle")
      .attr("class", "guide-circle")
      .style("pointer-events", "none");
    this._geomCircle(circleSel);
    this._applyStyle(circleSel, {
      fill: "none",
      stroke: "none",
      strokeWidth: 1,
      opacity: 1,
    });

    const pathSel = layer
      .selectAll("path.guide-path")
      .data(ofType("path"))
      .join("path")
      .attr("class", "guide-path")
      .style("pointer-events", "none")
      .attr("d", (/** @type {any} */ d) => {
        if (d.d) return d.d;
        return d3.line().curve(resolveCurve(d.curve))(d.points || []);
      });
    this._applyStyle(pathSel, {
      fill: "none",
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });

    const textSel = layer
      .selectAll("text.guide-label")
      .data(ofType("text"))
      .join("text")
      .attr("class", "guide-label")
      .style("pointer-events", "none");
    this._geomText(textSel, "start");
    this._applyStyle(textSel, { fill: "black", opacity: 1 });

    // Type joins append in call order; restore scene order among guide-front
    // siblings so a rule's stroke isn't covered by an earlier circle.
    const order = new Map(
      nodes.map((/** @type {any} */ n, /** @type {number} */ i) => [n, i]),
    );
    layer
      .selectAll(
        "line.guide-line, circle.guide-circle, path.guide-path, text.guide-label",
      )
      .filter((/** @type {any} */ d) => order.has(d))
      .sort(
        (/** @type {any} */ a, /** @type {any} */ b) =>
          /** @type {number} */ (order.get(a)) -
          /** @type {number} */ (order.get(b)),
      );
  }

  /**
   * Interaction-effect overlays (proximity snap ring, state outlines). Topmost
   * paint layer — above marks and guides; always pointer-transparent.
   *
   * Every shape `outlineNodes` can emit is joined here. Only circle and rect were
   * before, so an outline built for a `path` (an arc slice, a geo polygon, a needle)
   * or an `ellipse` was constructed by the effects layer and then silently dropped on
   * the floor — the mark simply didn't respond to hover or selection, which reads as
   * a broken interaction rather than an unimplemented one.
   *
   * The geometry helpers apply `_angleTransform`, so a rotated mark's outline rotates
   * with it as long as the overlay carries the source's `angle` (it does — see
   * outlineNodes). Paths need no transform: a path node bakes its rotation into `d`.
   * @param {any} layer
   * @param {any[]} nodes
   */
  _drawEffects(layer, nodes) {
    /** @param {string} t */
    const ofType = (t) =>
      nodes.filter((/** @type {any} */ n) => n.type === t);
    const effectPaint = {
      fill: "none",
      stroke: "none",
      strokeWidth: 1,
      opacity: 1,
    };

    const circleSel = layer
      .selectAll("circle.effect")
      .data(ofType("circle"))
      .join("circle")
      .attr("class", "effect")
      .style("pointer-events", "none");
    this._geomCircle(circleSel);
    this._applyStyle(circleSel, effectPaint);

    const rectSel = layer
      .selectAll("rect.effect")
      .data(ofType("rect"))
      .join("rect")
      .attr("class", "effect")
      .style("pointer-events", "none");
    this._geomRect(rectSel);
    this._applyStyle(rectSel, effectPaint);

    const ellipseSel = layer
      .selectAll("ellipse.effect")
      .data(ofType("ellipse"))
      .join("ellipse")
      .attr("class", "effect")
      .style("pointer-events", "none");
    this._geomEllipse(ellipseSel);
    this._applyStyle(ellipseSel, effectPaint);

    const lineSel = layer
      .selectAll("line.effect")
      .data(ofType("line"))
      .join("line")
      .attr("class", "effect")
      .style("pointer-events", "none");
    this._geomLine(lineSel);
    this._applyStyle(lineSel, effectPaint);

    const pathSel = layer
      .selectAll("path.effect")
      .data(ofType("path"))
      .join("path")
      .attr("class", "effect")
      .style("pointer-events", "none")
      .attr("d", (/** @type {any} */ d) =>
        d.d ? d.d : d3.line().curve(resolveCurve(d.curve))(d.points || []),
      );
    this._applyStyle(pathSel, effectPaint);

    // Type joins append in call order; restore scene order (ring under outline).
    const order = new Map(
      nodes.map((/** @type {any} */ n, /** @type {number} */ i) => [n, i]),
    );
    layer
      .selectAll(
        "circle.effect, rect.effect, ellipse.effect, line.effect, path.effect",
      )
      .filter((/** @type {any} */ d) => order.has(d))
      .sort(
        (/** @type {any} */ a, /** @type {any} */ b) =>
          /** @type {number} */ (order.get(a)) -
          /** @type {number} */ (order.get(b)),
      );
  }

  /**
   * The dblclick handler for a mark node: open the inline content editor when the
   * node opted in, else the caller's ordinary handler.
   *
   * Routed by the FLAG, not by the node's shape. `editText` used to be a text-mark
   * affair, so only `<text>` could be typed into — which is wrong for anything whose
   * typable surface is a BOX (a sticker's body, a labelled rect), and forced such a
   * glyph to put the edit on its glyphs, where the pick layer's `fontSize`-radius
   * hit disc sits dead centre and swallows the drag that should move it.
   * @param {((e: any, d: any) => void) | undefined} markDblClick
   * @returns {(e: any, d: any) => void}
   */
  _dblClick(markDblClick) {
    return (/** @type {any} */ event, /** @type {any} */ d) => {
      if (d && d.editText) {
        // Stop the browser's synthetic click/drag noise and keep dblclick from
        // racing a dragstart when drag + editText share one mark.
        event.preventDefault();
        event.stopPropagation();
        this._editText(event, d);
        return;
      }
      if (markDblClick) markDblClick(event, d);
    };
  }

  /**
   * Interactive marks: rects (bars) and circles (dots). Both get the click +
   * drag wiring; only nodes flagged `editable` (their feature has a direct-pick
   * edit) show an interactive cursor — d3.drag/click is inert on the rest.
   * DOM z-order among mark types is fixed later by `_orderMarkLayer`.
   * @param {any} layer
   * @param {any[]} markRects
   * @param {any[]} markCircles
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
   */
  _drawMarks(layer, markRects, markCircles, { drag, markClick, markDblClick, keys, hover }) {
    // A mark may opt OUT of the pointer (pointerEvents: 'none') — a ghost/affordance
    // node, or a glyph part that must not swallow the plane's hover/click. Without
    // this a decorative circle would eat the gesture the plane driver needs, the
    // same way line marks and paths already honour the flag.
    const rectSel = layer
      .selectAll("rect.mark")
      .data(markRects)
      .join("rect")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "auto",
      )
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "ns-resize" : "default",
      )
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomRect(rectSel);
    this._applyStyle(rectSel, { fill: "black" });
    this._applyEffectStyle(rectSel, "ns-resize");

    // Grab overlay for collapsed bars. A rect whose value sits at the baseline is
    // drawn at zero height (or width) and so takes NO pointer events — the browser
    // can't hit a zero-area <rect>, so a bar you just emptied becomes ungrabbable.
    // Lay a transparent, min-sized hit rect (the same floored box the canvas
    // hit-tester uses via rectHitBox) over each editable, degenerate bar, wired to
    // the SAME drag/click. Focus/keys stay on the visible rect (still focusable at
    // zero area), so this adds no duplicate tab stop — it only restores the pointer.
    const hitRects = markRects.filter(
      (/** @type {any} */ d) =>
        d.editable &&
        d.pointerEvents !== "none" &&
        ((d.width || 0) < MIN_GRAB || (d.height || 0) < MIN_GRAB),
    );
    const hitSel = layer
      .selectAll("rect.mark-hit")
      .data(hitRects)
      .join("rect")
      .attr("class", "mark-hit")
      .style("pointer-events", "all")
      .style("fill", "transparent")
      .style("cursor", (/** @type {any} */ d) => d.cursor || "ns-resize")
      .attr("x", (/** @type {any} */ d) => rectHitBox(d).x)
      .attr("y", (/** @type {any} */ d) => rectHitBox(d).y)
      .attr("width", (/** @type {any} */ d) => rectHitBox(d).w)
      .attr("height", (/** @type {any} */ d) => rectHitBox(d).h)
      // Follow the bar's own rotation. rectHitBox is the UNROTATED box (it is the
      // same one the canvas hit-tester unrotates the pointer into), so without this
      // a tilted collapsed bar hands its grab area to the wrong patch of the plane.
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d))
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover);
    // BOTTOM of the mark layer, not the top. A hit rect is a FALLBACK grab target —
    // it exists only where the drawn shape has no area to hit — so it must never
    // outrank a node that really is drawn there. Raised, it did: collapse one segment
    // of a stacked bar and its floored box covered the boundary handles sitting at
    // that same height, which silently swallowed every gesture on them. Nothing else
    // overlaps it (the degenerate rect it stands in for has no area, and sibling bars
    // are in adjacent bands), so lowering costs it nothing.
    hitSel.lower();

    const circleSel = layer
      .selectAll("circle.mark")
      .data(markCircles)
      .join("circle")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "auto",
      )
      // `d.cursor` is honoured here like it is on every other node type. Circles
      // alone hard-coded "move", so a mark that set a cursor to say what its handle
      // does — face's 'grab', an axis end's 'ew-resize' — was ignored on exactly the
      // shape most handles are drawn as.
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "move" : "default",
      )
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomCircle(circleSel);
    this._applyStyle(circleSel, { fill: "black" });
    this._applyEffectStyle(circleSel, "move");
  }

  /**
   * Interactive ellipses. Same wiring as the circle branch of `_drawMarks` — an
   * ellipse is a circle whose two radii are independent channels, so each is its
   * own draggable magnitude (an eye that widens on x and squints on y). Kept a
   * separate join because SVG binds shape to element type.
   * @param {any} layer
   * @param {any[]} ellipses
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
   */
  _drawEllipses(layer, ellipses, { drag, markClick, markDblClick, keys, hover }) {
    const sel = layer
      .selectAll("ellipse.mark")
      .data(ellipses)
      .join("ellipse")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "auto",
      )
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "move" : "default",
      )
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomEllipse(sel);
    this._applyStyle(sel, { fill: "black" });
    this._applyEffectStyle(sel, "move");
  }

  /**
   * Foreground lines. Two roles share one draw:
   *   - reference rules / guide boundaries: non-interactive (often
   *     pointerEvents:'none') — drawn as before.
   *   - interactive line marks (ticks): flagged `editable`, so they get the same
   *     click + drag wiring as rect/circle marks. Only editable nodes show an
   *     interactive cursor; d3.drag is inert on the rest.
   * @param {any} layer
   * @param {any[]} lines
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
   */
  _drawLines(layer, lines, { drag, markClick, markDblClick, keys, hover }) {
    const sel = layer
      .selectAll("line.mark")
      .data(lines)
      .join("line")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "auto",
      )
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "move" : "default",
      )
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomLine(sel);
    this._applyStyle(sel, { stroke: "black", strokeWidth: 1, opacity: 1 });
    this._applyEffectStyle(sel, "move");
  }

  /**
   * Path marks: connecting lines (points + curve) OR authored SVG `d` strings
   * (arcs, needles, pie slices). Non-interactive by default — line connectors
   * are edited through handle dots — but an `editable` path (needle, pie slice)
   * gets the same click + drag wiring as other marks.
   * @param {any} layer
   * @param {any[]} paths
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} [io]
   */
  _drawPaths(layer, paths, io) {
    const sel = layer
      .selectAll("path.mark-line")
      .data(paths)
      .join("path")
      .attr("class", "mark-line")
      .style(
        "pointer-events",
        (/** @type {any} */ d) =>
          d.pointerEvents || (d.editable ? "auto" : "none"),
      )
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "pointer" : "default",
      )
      .attr("d", (/** @type {any} */ d) => {
        if (d.d) return d.d;
        return d3.line().curve(resolveCurve(d.curve))(d.points || []);
      });
    this._applyStyle(sel, {
      fill: "none",
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });
    this._applyEffectStyle(sel, "pointer");
    if (io) {
      sel
        .on("click", io.markClick)
        .on("dblclick", this._dblClick(io.markDblClick))
        .call(io.drag)
        .call(io.hover)
        .call(io.keys);
    }
  }

  /**
   * Text marks (editable or inert). Mirrors _drawMarks: click + drag wiring,
   * cursor only when editable, honoring a mark's pointerEvents opt-out.
   * Double-click opens an inline editor for content editing (see _editText).
   * @param {any} layer
   * @param {any[]} texts
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
   */
  _drawTextMarks(layer, texts, { drag, markClick, markDblClick, keys, hover }) {
    const sel = layer
      .selectAll("text.mark")
      .data(texts)
      .join("text")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "auto",
      )
      .style("cursor", (/** @type {any} */ d) =>
        d.editable ? d.cursor || "move" : "default",
      )
      .on("click", markClick)
      // Opens the inline editor on a node that opted in; a text mark carrying an
      // ordinary dblclick edit now reaches it, which it could not before.
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomText(sel, "middle");
    this._applyStyle(sel, { fill: "black", opacity: 1 });
    this._applyEffectStyle(sel, "move");
  }

  /**
   * Inline content editor for a text mark. On double-click of a node that opted in
   * (`editText: true`, set by the mark when an editText edit is wired) mount a
   * `<foreignObject>` input over the label; Enter/blur emits a `commit` gesture
   * carrying the typed string (the editText edit stores it), Esc cancels. The
   * renderer owns the keyboard lifecycle so the engine stays pointer/mode-agnostic.
   * @param {any} event
   * @param {any} d the text node
   */
  _editText(event, d) {
    if (!d || !d.editText) return;
    const g = this._sceneG;
    const onEvent = this._onEvent;
    if (!g || !onEvent) return;

    // Only one editor at a time.
    g.selectAll("foreignObject.text-editor").remove();

    const size = d.fontSize != null ? d.fontSize : 12;
    // Where the editor sits, in three steps down. A node may state it outright
    // (`editBox`); a RECT already is a box, so it needs no second statement of its
    // own geometry; anything else falls back to the literal that has always been
    // here, which is sized for a label hanging off a dot rather than for a shape.
    const box =
      d.editBox ||
      (d.type === "rect" && d.width != null
        ? { x: d.x, y: d.y, width: d.width, height: Math.max(0, d.height) }
        : null);
    const w = box ? box.width : 140;
    const h = box ? box.height : size + 10;
    const x = box ? box.x : d.x - w / 2;
    const y = box ? box.y : d.y - h + 4;

    const fo = g
      .append("foreignObject")
      .attr("class", "text-editor")
      .attr("x", x)
      .attr("y", y)
      .attr("width", w)
      .attr("height", h);
    // A declared capability, never inferred from the box's height.
    const multiline = !!d.multiline;
    const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
      fo
        .append(multiline ? "xhtml:textarea" : "xhtml:input")
        .attr("type", multiline ? null : "text")
        .style("width", "100%")
        .style("height", multiline ? "100%" : null)
        .style("box-sizing", "border-box")
        .style("font-size", size + "px")
        .style("font-family", "inherit")
        .style("text-align", "center")
        .style("resize", multiline ? "none" : null)
        .node()
    );
    // Open with what is ALREADY there, so typing amends the note rather than
    // replacing it. A node that paints text carries the string; one that only OWNS
    // the edit (a sticker's box, whose label is a sibling mark) carries `editValue`,
    // the engine's read of the column the edit writes. Painted text wins where both
    // exist, so a formatted label still opens showing exactly what it displays.
    input.value =
      d.text != null
        ? String(d.text)
        : d.editValue != null
          ? String(d.editValue)
          : "";
    input.focus();
    // Where the caret lands. A single-line editor holds a NAME you replace (an axis
    // category, a short label), so it opens selected — double-click-to-rename. A
    // multi-line one holds a paragraph you AMEND, where select-all means the first
    // keystroke wipes the note, so the caret goes to the end instead.
    if (multiline) input.setSelectionRange(input.value.length, input.value.length);
    else input.select();

    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      const value = input.value;
      fo.remove();
      onEvent({
        type: "commit",
        node: d,
        value,
        x: d.x,
        y: d.y,
        rawEvent: event,
      });
    };
    const cancel = () => {
      if (done) return;
      done = true;
      fo.remove();
    };
    input.addEventListener("keydown", (/** @type {any} */ e) => {
      if (e.key === "Enter") {
        // In a multi-line box Enter is a newline — the only way to type a second
        // line — so committing takes a modifier, blur, or Escape's sibling. On a
        // single-line editor Enter commits, exactly as it always has.
        if (!multiline || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          commit();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      e.stopPropagation();
    });
    input.addEventListener("blur", commit);
  }

}
