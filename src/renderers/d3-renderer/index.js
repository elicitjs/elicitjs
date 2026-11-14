// @ts-check
import * as d3 from "d3";
import { DEFAULT_EFFECTS, ELEMENT_EFFECT_PROPS } from "../../core/effects.js";
import { markCenter } from "../../edit/shared.js";
import { rectHitBox, MIN_GRAB } from "../../edit/pick.js";
import { lineGenerator, STYLE_FIELDS, partitionScene, frameThrottle, MODIFIER_KEYS } from "../shared.js";

// camelCase effect property -> CSS property name. Effects are CSS properties,
// not SVG attributes, so removing one restores the mark's own paint.
const cssProp = (/** @type {string} */ k) =>
  k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

export class D3Renderer {
  constructor() {
    // node field -> [SVG attribute, base default], read by `_applyStyle`.
    // From STYLE_FIELDS in renderers/shared.js.
    /** @type {[string, string, any][]} */
    this.STYLE_ATTRS = STYLE_FIELDS.map(({ field, svgAttr, base }) => [
      field,
      svgAttr,
      base,
    ]);
    // Plane gesture state lives on the renderer so it survives mid-drag re-renders.
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
      clip: context.clip || null,
    });

    // Stashed for _editText, which runs outside this closure.
    this._sceneG = g;
    this._onEvent = onEvent;
    // The theme's font family goes on the root svg; null keeps the host page's font.
    this._theme = context.theme || null;
    const themeFont = this._theme && this._theme.font;
    d3.select(container).select("svg")
      .style("font-family", (themeFont && themeFont.family) || null)
      // The chart backdrop, margins included (null => transparent).
      .style("background", (this._theme && this._theme.background) || null);

    /** @param {any} event */
    const pointer = (event) => d3.pointer(event, g.node());

    this._bindPlaneGestures(plane, pointer, onEvent, planeOnTop);
    this._bindPointerTracking(d3.select(container).select("svg"), pointer, onEvent, !!context.tracksPointer);
    this._bindWheel(d3.select(container).select("svg"), pointer, onEvent, !!context.hasWheel);

    const drag = this._makeDrag(onEvent);
    // Hover and keyboard bind to the same nodes as drag.
    const hover = this._makeHover(onEvent, effects.hovered);
    // focusOutline gates only the native focus ring.
    const keys = this._makeKeyboard(onEvent, focusOutline);
    // A click on a mark. d3.drag suppresses the click after a real drag.
    /** @param {any} event @param {any} d */
    const markClick = (event, d) => {
      const [px, py] = pointer(event);
      onEvent({ type: "click", x: px, y: py, node: d, rawEvent: event });
    };
    // A double click on a mark. stopPropagation keeps it off the plane, where a
    // create edit would add a row.
    /** @param {any} event @param {any} d */
    const markDblClick = (event, d) => {
      event.preventDefault();
      event.stopPropagation();
      const [px, py] = pointer(event);
      onEvent({ type: "dblclick", x: px, y: py, node: d, rawEvent: event });
    };

    // Role layers are fixed; within the mark layer, scene order is z-order.
    const { background, guideRegions, marks, chrome, guideFront, effects: effectNodes, effectsChrome } =
      partitionScene(scene.children, { clip: !!context.clip });
    /** @param {any[]} list @param {string} t */
    const ofType = (list, t) =>
      list.filter((/** @type {any} */ n) => n.type === t);

    const layers = this._sceneLayers(g);

    this._drawBackground(layers.bg, background);

    this._drawGuideRegions(layers.guideBack, guideRegions);

    // Join by shape type, then reorder to scene order.
    const io = { drag, markClick, markDblClick, keys, hover };
    this._drawPaths(layers.marks, ofType(marks, "path"), io);
    this._drawMarks(layers.marks, ofType(marks, "rect"), ofType(marks, "circle"), io);
    this._drawEllipses(layers.marks, ofType(marks, "ellipse"), io);
    this._drawLines(layers.marks, ofType(marks, "line"), io);
    this._drawTextMarks(layers.marks, ofType(marks, "text"), io);
    this._orderMarkLayer(layers.marks, marks);

    // Unclipped chrome (axis handles, interactive legends); empty without `clip`.
    this._drawPaths(layers.chrome, ofType(chrome, "path"), io);
    this._drawMarks(layers.chrome, ofType(chrome, "rect"), ofType(chrome, "circle"), io);
    this._drawEllipses(layers.chrome, ofType(chrome, "ellipse"), io);
    this._drawLines(layers.chrome, ofType(chrome, "line"), io);
    this._drawTextMarks(layers.chrome, ofType(chrome, "text"), io);
    this._orderMarkLayer(layers.chrome, chrome);

    // Rules / constraint ticks / guide labels — in front of marks.
    this._drawGuideFront(layers.guideFront, guideFront);

    // Effect overlays: clipped data effects and unclipped chrome effects, as two
    // groups in the one topmost effects layer.
    this._drawEffects(this._subLayer(layers.effects, "effects-data"), effectNodes);
    this._drawEffects(this._subLayer(layers.effects, "effects-chrome"), effectsChrome);

    // Plane-on-top (proximity) mode: the plane sits above the marks and owns
    // every pointer event.
    if (planeOnTop) {
      g.selectAll(".mark, .mark-hit").style("pointer-events", "none");
      // Target order [..., plane, effects]. Skip the DOM move when it already
      // holds: re-insertion drops pointer capture and blurs.
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
    } else {
      // Lower the plane again when the mode flips back, or it blocks direct edits.
      // Skip the DOM move when it already holds.
      const planeNode = plane.node();
      const parent = planeNode && planeNode.parentNode;
      if (parent && parent.firstElementChild !== planeNode) plane.lower();
      plane.style("cursor", null);
    }
  }

  /**
   * The id of the <linearGradient> for a gradient spec, created in <defs> on
   * first use. Keyed by the spec's JSON; prefixed per renderer instance.
   * @param {{ stops: [number, string][], direction?: 'vertical' | 'horizontal' }} spec
   * @returns {string}
   */
  _gradientId(spec) {
    if (!this._gradients) {
      this._gradients = new Map();
      this._gradPrefix = `eg${Math.random().toString(36).slice(2, 8)}`;
    }
    const key = JSON.stringify(spec);
    const hit = this._gradients.get(key);
    if (hit) return hit;
    const id = `${this._gradPrefix}-${this._gradients.size}`;
    this._gradients.set(key, id);
    const svg = this._sceneG ? d3.select(this._sceneG.node().ownerSVGElement) : null;
    if (svg) {
      /** @type {any} */
      let defs = svg.select("defs");
      if (defs.empty()) defs = /** @type {any} */ (svg).insert("defs", ":first-child");
      const horizontal = spec.direction === "horizontal";
      const g = defs.append("linearGradient")
        .attr("id", id)
        .attr("gradientUnits", "objectBoundingBox")
        .attr("x1", 0).attr("y1", horizontal ? 0 : 1)
        .attr("x2", horizontal ? 1 : 0).attr("y2", 0);
      for (const [offset, color] of spec.stops || []) {
        g.append("stop").attr("offset", `${Math.round(offset * 100)}%`).attr("stop-color", color);
      }
    }
    return id;
  }

  // -- setup ---------------------------------------------------------------

  /**
   * Create (once) and size the svg, scene group and interaction plane.
   * @param {any} container
   * @param {{ width: number, height: number, margins: any, innerWidth: number, innerHeight: number, responsive?: string, overflow?: string, clip?: { x: number, y: number, width: number, height: number } | null }} dims
   * @returns {{ g: any, plane: any }}
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
      clip = null,
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

      // Transparent plane that catches gestures on empty space (plane-pick edits).
      g.append("rect")
        .attr("class", "plane")
        .attr("x", 0)
        .attr("y", 0)
        .style("fill", "transparent")
        .style("pointer-events", "all");
    }

    // 'scale' uses a viewBox at 100% width; other modes size in pixels.
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

    svg.style("overflow", overflow === "visible" ? "visible" : null);
    // `clip` confines the marks (not chrome or guides) to its rect.
    if (clip) {
      let defs = svg.select("defs");
      if (defs.empty()) defs = /** @type {any} */ (svg).insert("defs", ":first-child");
      if (!this._clipId) this._clipId = `ec${Math.random().toString(36).slice(2, 8)}`;
      let cp = defs.select(`#${this._clipId}`);
      if (cp.empty()) cp = defs.append("clipPath").attr("id", this._clipId);
      let r = cp.select("rect");
      if (r.empty()) r = cp.append("rect");
      r.attr("x", clip.x).attr("y", clip.y).attr("width", clip.width).attr("height", clip.height);
    }
    // Applied to the mark layer and data effects; chrome stays unclipped.
    this._clipUrl = clip ? `url(#${this._clipId})` : null;

    const g = svg
      .select(".scene-container")
      .attr("transform", `translate(${margins.left},${margins.top})`);
    g.select("rect.plane")
      .attr("width", innerWidth)
      .attr("height", innerHeight);
    const layers = this._sceneLayers(g);
    layers.marks.attr("clip-path", this._clipUrl);
    this._subLayer(layers.effects, "effects-data").attr("clip-path", this._clipUrl);
    return { g, plane: g.select("rect.plane") };
  }

  /**
   * Role-layer groups, in paint order:
   * plane → bg → guide-back → marks → chrome → guide-front → effects.
   * Reorders only when a group is created; re-appending would blur a focused mark.
   * @param {any} g scene container
   * @returns {{ bg: any, guideBack: any, marks: any, chrome: any, guideFront: any, effects: any }}
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
    const chrome = ensure("chrome-layer");
    const guideFront = ensure("guide-front-layer");
    const effects = ensure("effects-layer");
    // Drop marks joined directly under `g` before the mark layer existed.
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
        chrome.node(),
        guideFront.node(),
        effects.node(),
      ]) {
        if (el) root.appendChild(/** @type {Node} */ (el));
      }
    }
    return { bg, guideBack, marks, chrome, guideFront, effects };
  }

  /**
   * A named child group of a layer, created once (in call order) and reused.
   * @param {any} layer @param {string} cls @returns {any}
   */
  _subLayer(layer, cls) {
    let sub = layer.select(`:scope > g.${cls}`);
    if (sub.empty()) sub = layer.append("g").attr("class", cls);
    return sub;
  }

  /**
   * Sort a layer's joined elements into the order their nodes have in `nodes`.
   * @param {any} sel the elements of every type join in the layer
   * @param {any[]} nodes the layer's nodes, in scene order
   */
  _sceneOrder(sel, nodes) {
    const order = new Map(
      nodes.map((/** @type {any} */ n, /** @type {number} */ i) => [n, i]),
    );
    sel
      .filter((/** @type {any} */ d) => order.has(d))
      .sort(
        (/** @type {any} */ a, /** @type {any} */ b) =>
          /** @type {number} */ (order.get(a)) -
          /** @type {number} */ (order.get(b)),
      );
  }

  /**
   * Reorder mark-layer children to scene order. Restores focus if the sort
   * moved the active element.
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
    // Skip the DOM move when already sorted: re-insertion blurs a focused node.
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
   * Wire plane gestures. `click`/`dblclick` are always bound. In plane-on-top
   * mode hover and drag are tracked by hand, not d3.drag (whose preventDefault
   * suppresses dblclick).
   * @param {any} plane
   * @param {(event: any) => [number, number]} pointer
   * @param {(e: any) => void} onEvent
   * @param {boolean} planeOnTop
   */
  _bindPlaneGestures(plane, pointer, onEvent, planeOnTop) {
    plane
      .on("click", (/** @type {any} */ event) => {
        // Swallow the native click that follows a plane drag.
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
      // The mode can flip between renders: abandon any in-flight plane gesture.
      this._abortPlaneGesture();
      this._unwatchModifiers();
      plane.on("pointerdown", null).on("pointermove", null).on("pointerleave", null);
      return;
    }

    // Read by the window handlers, which outlive one render.
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
        // No setPointerCapture: `plane.raise()` on re-render releases it. Window
        // listeners track the gesture instead.
        this._trackPlaneGesture();
      })
      .on("pointermove", (/** @type {any} */ event) => {
        // During a gesture the window handler owns movement.
        if (this._planeGesture) return;
        const [px, py] = pointer(event);
        this._watchModifiers(px, py, onEvent);
        onEvent({ type: "hover", x: px, y: py, rawEvent: event });
      })
      .on("pointerleave", (/** @type {any} */ event) => {
        this._unwatchModifiers();
        if (!this._planeGesture) onEvent({ type: "hoverout", rawEvent: event });
      });
  }

  /**
   * Re-report the plane hover when a modifier key changes under a still pointer,
   * so `when`-gated edits re-arbitrate. Bound only while over the plane.
   * @param {number} px @param {number} py
   * @param {(e: any) => void} onEvent
   */
  _watchModifiers(px, py, onEvent) {
    this._modifierHover = { px, py, onEvent };
    if (this._modifierKey || typeof window === "undefined") return;
    this._modifierKey = (/** @type {KeyboardEvent} */ event) => {
      if (!MODIFIER_KEYS.has(event.key) || this._planeGesture || !this._modifierHover) return;
      const at = this._modifierHover;
      at.onEvent({ type: "hover", x: at.px, y: at.py, rawEvent: event });
    };
    window.addEventListener("keydown", this._modifierKey);
    window.addEventListener("keyup", this._modifierKey);
  }

  _unwatchModifiers() {
    this._modifierHover = null;
    if (!this._modifierKey || typeof window === "undefined") return;
    window.removeEventListener("keydown", this._modifierKey);
    window.removeEventListener("keyup", this._modifierKey);
    this._modifierKey = null;
  }

  /**
   * Report the pointer position from the svg root, once per frame, for guides
   * that follow it. Bound only when `tracksPointer`; not a gesture.
   * @param {any} svg
   * @param {(event: any) => [number, number]} pointer
   * @param {(e: any) => void} onEvent
   * @param {boolean} tracks
   */
  _bindPointerTracking(svg, pointer, onEvent, tracks) {
    if (!tracks) {
      svg.on("pointermove.track", null).on("pointerleave.track", null);
      return;
    }
    const report = frameThrottle((/** @type {any} */ event) => {
      const [px, py] = pointer(event);
      onEvent({ type: "pointermove", x: px, y: py, rawEvent: event });
    });
    svg
      .on("pointermove.track", (/** @type {any} */ event) => report(event))
      .on("pointerleave.track", (/** @type {any} */ event) => onEvent({ type: "pointerleave", rawEvent: event }));
  }

  /**
   * Report the wheel as a `wheel` gesture, deltas in pixels. Bound (and page
   * scroll prevented) only when an active edit listens.
   * @param {any} svg
   * @param {(event: any) => [number, number]} pointer
   * @param {(e: any) => void} onEvent
   * @param {boolean} wants
   */
  _bindWheel(svg, pointer, onEvent, wants) {
    const node = svg.node();
    if (!node) return;
    if (this._wheelHandler) {
      node.removeEventListener("wheel", this._wheelHandler);
      this._wheelHandler = null;
    }
    if (!wants) return;
    this._wheelHandler = (/** @type {any} */ event) => {
      event.preventDefault();
      const [px, py] = pointer(event);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      onEvent({
        type: "wheel", x: px, y: py,
        deltaX: (event.deltaX || 0) * unit, deltaY: (event.deltaY || 0) * unit,
        rawEvent: event,
      });
    };
    node.addEventListener("wheel", this._wheelHandler, { passive: false });
  }

  /**
   * Follow a live plane drag on the window until release or cancel. Bound once
   * per gesture, removed on release.
   */
  _trackPlaneGesture() {
    if (this._planeTracking || typeof window === "undefined") return;
    const move = (/** @type {any} */ event) => this._planeMoved(event);
    const end = (/** @type {any} */ event) => this._planeReleased(event);
    this._planeTracking = { move, end };
    // Capture phase, so this sees the release before anything else on the page.
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
    // No button held: the release was missed. Close the gesture here.
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
    // Released off the chart: pointerleave was suppressed during the drag, so end hover here.
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
   * Keyboard access to a mark, attached wherever `drag` is. Arrow keys emit a
   * `nudge` (one step, not a pixel delta); the engine sizes the step from the scale.
   * Only `editable` nodes take focus. `focusOutline` shows the native focus ring.
   * @param {(e: any) => void} onEvent
   * @param {boolean} [focusOutline]
   * @returns {(sel: any) => void}
   */
  _makeKeyboard(onEvent, focusOutline = false) {
    /** @type {Record<string, [-1 | 0 | 1, -1 | 0 | 1]>} */
    const ARROWS = {
      // [dx, dy] in pixel space: ArrowUp is negative y.
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    return (/** @type {any} */ sel) => {
      sel
        .attr("tabindex", (/** @type {any} */ d) => (d.editable ? 0 : null))
        .attr("role", (/** @type {any} */ d) => (d.editable ? "button" : null))
        // Hide the browser focus ring unless `focusOutline`.
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
   * Report hover on a mark (same nodes as _makeDrag). It does not paint: the
   * engine resolves the `hovered` effect and returns it as `node.effectStyle`.
   * @param {(e: any) => void} onEvent
   * @param {any} hovered the resolved `hovered` effect config
   * @returns {(sel: any) => void}
   */
  _makeHover(onEvent, hovered) {
    const enabled = !hovered || hovered.enabled !== false;
    return (sel) => {
      sel
        .on("pointerenter", /** @type {any} */ (/** @type {any} */ _event, /** @type {any} */ d) => {
          if (!enabled || !d || !(d.editable || d.hoverable)) return;
          onEvent({ type: "pointerover", node: d });
        })
        .on("pointerleave", /** @type {any} */ (/** @type {any} */ _event, /** @type {any} */ d) => {
          if (!enabled || !d || !(d.editable || d.hoverable)) return;
          onEvent({ type: "pointerout", node: d });
        });
    };
  }

  /**
   * The drag behaviour for every interactive mark. dragstart/dragend bracket the
   * stroke so undo steps back a whole drag. Grab feedback is the engine's
   * `grabbed` effect, not painted here. clickDistance lets a small move still click.
   * @param {(e: any) => void} onEvent
   * @returns {any}
   */
  _makeDrag(onEvent) {
    return d3
      .drag()
      .clickDistance(4)
      // Subject is the pointer, not the datum: the default subject offsets a rect
      // drag by its top-left. `event.x/y` is the pointer in scene coordinates.
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
        // No button held: the release was missed (let go outside the window).
        // End the stroke here; d3's own `end` is then a no-op.
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
   * Close a mark drag exactly once (real release or missed release).
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
   * Apply STYLE_ATTRS to a selection: node value, else `defaults[field]`, else base.
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
    // Gradient fill via url(); an effect restyle still wins.
    sel.filter((/** @type {any} */ d) => !!(d && d.fillGradient))
      .attr("fill", (/** @type {any} */ d) => `url(#${this._gradientId(d.fillGradient)})`);
    // DOM tags for tests and stylesheets: ghost preview, hit-only node, handle channel.
    sel.attr("data-ghost", (/** @type {any} */ d) => (d.ghost ? "" : null));
    sel.attr("data-hit", (/** @type {any} */ d) => (d.hit ? "" : null));
    sel.attr("data-channel", (/** @type {any} */ d) => (d.channel != null ? d.channel : null));
    return sel;
  }

  /**
   * Apply `node.effectStyle` as CSS properties, after `_applyStyle`. Properties
   * override the paint attributes; a null value removes the property. `cursor`
   * falls back to the mark's own.
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
   * SVG rotate for a node's math-degree `angle` (CCW), negated for SVG's
   * clockwise rotate. Pivots on markCenter.
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
      // Corner radius; `ry` defaults to `rx`.
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
    // A stroke on text is a halo behind the glyphs.
    sel.style("paint-order", "stroke");
    sel
      .attr("x", (/** @type {any} */ d) => d.x)
      .attr("y", (/** @type {any} */ d) => d.y)
      .attr(
        "text-anchor",
        (/** @type {any} */ d) => d.textAnchor || anchorDefault,
      )
      // Vertical anchor (`lineAnchor` → dominant-baseline).
      .attr(
        "dominant-baseline",
        (/** @type {any} */ d) => d.dominantBaseline || null,
      )
      .attr("font-size", (/** @type {any} */ d) =>
        d.fontSize != null ? d.fontSize : this._themeFontSize(),
      )
      .attr("font-weight", (/** @type {any} */ d) => (d.fontWeight != null ? d.fontWeight : null))
      // Unset inherits the root svg's theme family.
      .attr("font-family", (/** @type {any} */ d) => (d.fontFamily != null ? d.fontFamily : null))
      .attr("font-style", (/** @type {any} */ d) => (d.fontStyle != null ? d.fontStyle : null))
      // Math degrees on the node; _angleTransform converts to SVG rotate.
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d));

    // A wrapped label paints `lines` as tspans; `text` stays the whole string.
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
      // Block placement follows `lineAnchor` (top / bottom / centred); matches
      // nodeBox in plot/text.js.
      const first = d.lineAnchor === "top" ? 0
        : d.lineAnchor === "bottom" ? -(lines.length - 1) * step
        : (-(lines.length - 1) * step) / 2;
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
   * Non-interactive background nodes (tiles, axes, grids, legends, basemaps)
   * behind the marks. Image tiles are keyed and lowered to the back; the rest
   * are sorted to scene order.
   * @param {any} bgLayer
   * @param {any[]} nodes the background nodes, in scene order
   */
  _drawBackground(bgLayer, nodes) {
    /** @param {string} t */
    const ofType = (t) =>
      nodes.filter((/** @type {any} */ n) => n.type === t);

    const imgSel = bgLayer
      .selectAll("image")
      .data(ofType("image"), (/** @type {any} */ d) => d.key)
      .join("image")
      .style("pointer-events", "none")
      .attr("x", (/** @type {any} */ d) => d.x)
      .attr("y", (/** @type {any} */ d) => d.y)
      .attr("width", (/** @type {any} */ d) => d.width)
      .attr("height", (/** @type {any} */ d) => d.height)
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d))
      .attr("preserveAspectRatio", "none")
      .attr("href", (/** @type {any} */ d) => d.href)
      .attr("opacity", (/** @type {any} */ d) =>
        d.opacity != null ? d.opacity : null,
      );
    imgSel.lower();

    // Legend chips / ramp slices.
    const rectSel = bgLayer
      .selectAll("rect.bg-rect")
      .data(ofType("rect"))
      .join("rect")
      .attr("class", "bg-rect")
      .style("pointer-events", "none");
    this._geomRect(rectSel);
    this._applyStyle(rectSel, { fill: "none", stroke: "none", strokeWidth: 1, opacity: 1 });

    // Legend size dots.
    const circleSel = bgLayer
      .selectAll("circle.bg-circle")
      .data(ofType("circle"))
      .join("circle")
      .attr("class", "bg-circle")
      .style("pointer-events", "none");
    this._geomCircle(circleSel);
    this._applyStyle(circleSel, { fill: "none", stroke: "none", strokeWidth: 1, opacity: 1 });

    const lineSel = bgLayer
      .selectAll("line")
      .data(ofType("line"))
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
      .data(ofType("text"))
      .join("text")
      .style("pointer-events", "none");
    this._geomText(textSel, "middle");
    this._applyStyle(textSel, { fill: "#374151", opacity: 1 });

    const pathSel = bgLayer
      .selectAll("path.bg-path")
      .data(ofType("path"))
      .join("path")
      .attr("class", "bg-path")
      .style("pointer-events", "none")
      .attr("d", (/** @type {any} */ d) => {
        if (d.d) return d.d;
        return lineGenerator(d.curve)(d.points || []);
      });
    this._applyStyle(pathSel, {
      fill: "none",
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });

    // Joins append by type; restore scene order (images stay at the back).
    this._sceneOrder(bgLayer.selectAll("rect.bg-rect, circle.bg-circle, line, text, path.bg-path"), nodes);
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
   * Non-interactive guide nodes in front of marks, in scene order.
   * @param {any} layer
   * @param {any[]} nodes
   */
  _drawGuideFront(layer, nodes) {
    /** @param {string} t */
    const ofType = (t) =>
      nodes.filter((/** @type {any} */ n) => n.type === t);

    // Boxes above the marks (a tip's background).
    const rectSel = layer
      .selectAll("rect.guide-rect")
      .data(ofType("rect"))
      .join("rect")
      .attr("class", "guide-rect")
      .style("pointer-events", "none");
    this._geomRect(rectSel);
    this._applyStyle(rectSel, { fill: "none", stroke: "none", strokeWidth: 1, opacity: 1 });

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
        return lineGenerator(d.curve)(d.points || []);
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

    // Joins append by type; restore scene order.
    this._sceneOrder(
      layer.selectAll("rect.guide-rect, line.guide-line, circle.guide-circle, path.guide-path, text.guide-label"),
      nodes,
    );
  }

  /**
   * Effect overlays (proximity ring, state outlines), topmost and pointer-transparent.
   * Joins every shape `outlineNodes` can emit; rotation follows the overlay's `angle`.
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
        d.d ? d.d : lineGenerator(d.curve)(d.points || []),
      );
    this._applyStyle(pathSel, effectPaint);

    // Joins append by type; restore scene order.
    this._sceneOrder(
      layer.selectAll("circle.effect, rect.effect, ellipse.effect, line.effect, path.effect"),
      nodes,
    );
  }

  /**
   * The dblclick handler for a mark: the inline editor when the node has
   * `editText` (any shape), else the caller's handler.
   * @param {((e: any, d: any) => void) | undefined} markDblClick
   * @returns {(e: any, d: any) => void}
   */
  _dblClick(markDblClick) {
    return (/** @type {any} */ event, /** @type {any} */ d) => {
      if (d && d.editText) {
        // Keep dblclick from racing a dragstart on the same mark.
        event.preventDefault();
        event.stopPropagation();
        this._editText(event, d);
        return;
      }
      if (markDblClick) markDblClick(event, d);
    };
  }

  /**
   * Interactive rects and circles. Only `editable` nodes show a drag cursor;
   * z-order is fixed later by `_orderMarkLayer`.
   * @param {any} layer
   * @param {any[]} markRects
   * @param {any[]} markCircles
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
   */
  _drawMarks(layer, markRects, markCircles, { drag, markClick, markDblClick, keys, hover }) {
    // Honour `pointerEvents: 'none'` so inert nodes don't swallow plane gestures.
    const rectSel = layer
      .selectAll("rect.mark")
      .data(markRects)
      .join("rect")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "visible",
      )
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomRect(rectSel);
    this._applyStyle(rectSel, { fill: "black" });
    this._applyEffectStyle(rectSel, "ns-resize");

    // A zero-area rect can't be hit, so an editable collapsed bar gets a transparent
    // min-sized hit rect (rectHitBox) with the same drag/click. Keys stay on the bar.
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
      // rectHitBox is unrotated; follow the bar's rotation.
      .attr("transform", (/** @type {any} */ d) => this._angleTransform(d))
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover);
    // Keep the hit rect at the bottom: it is a fallback and must not cover real
    // nodes (e.g. stack boundary handles). Never raise() it.
    hitSel.lower();

    const circleSel = layer
      .selectAll("circle.mark")
      .data(markCircles)
      .join("circle")
      .attr("class", "mark")
      .style(
        "pointer-events",
        (/** @type {any} */ d) => d.pointerEvents || "visible",
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
   * Interactive ellipses. Same wiring as the circles in `_drawMarks`.
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
   * Line marks, interactive or not. Only `editable` nodes show a drag cursor.
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
   * Path marks: points + curve, or an SVG `d` string. Inert unless `editable`.
   * @param {any} layer
   * @param {any[]} paths
   * @param {{ drag: any, markClick: (e: any, d: any) => void, markDblClick?: (e: any, d: any) => void, keys: (sel: any) => void, hover: (sel: any) => void }} io
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
      .attr("d", (/** @type {any} */ d) => {
        if (d.d) return d.d;
        return lineGenerator(d.curve)(d.points || []);
      });
    this._applyStyle(sel, {
      fill: "none",
      stroke: "black",
      strokeWidth: 1,
      opacity: 1,
    });
    this._applyEffectStyle(sel, "pointer");
    sel
      .on("click", io.markClick)
      .on("dblclick", this._dblClick(io.markDblClick))
      .call(io.drag)
      .call(io.hover)
      .call(io.keys);
  }

  /**
   * Text marks. Same wiring as _drawMarks; dblclick may open _editText.
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
      .on("click", markClick)
      .on("dblclick", this._dblClick(markDblClick))
      .call(drag)
      .call(hover)
      .call(keys);
    this._geomText(sel, "middle");
    this._applyStyle(sel, { fill: "black", opacity: 1 });
    this._applyEffectStyle(sel, "move");
  }

  /**
   * Inline content editor for a node with `editText`: a `<foreignObject>` input.
   * Enter/blur emits a `commit` gesture with the typed string; Esc cancels.
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
    // Editor box: `editBox`, else a rect's own box, else a default label-sized box.
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
    // Seed with the painted text, else `editValue` (the column the edit writes).
    input.value =
      d.text != null
        ? String(d.text)
        : d.editValue != null
          ? String(d.editValue)
          : "";
    input.focus();
    // Single-line opens selected (rename); multi-line puts the caret at the end (amend).
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
        // Multi-line: Enter is a newline; Cmd/Ctrl+Enter commits.
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
