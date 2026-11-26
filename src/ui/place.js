// @ts-check
// Where an overlay element sits: an anchor (a drawn piece or a point, in inner
// chart pixels) and a placement around it, turned into the layer's own pixels.

/** Unit direction and the CSS translate that puts the element outside that side. */
const SIDES = /** @type {Record<string, { dx: number, dy: number, tx: string, ty: string }>} */ ({
    center: { dx: 0, dy: 0, tx: '-50%', ty: '-50%' },
    top: { dx: 0, dy: -1, tx: '-50%', ty: '-100%' },
    right: { dx: 1, dy: 0, tx: '0', ty: '-50%' },
    bottom: { dx: 0, dy: 1, tx: '-50%', ty: '0' },
    left: { dx: -1, dy: 0, tx: '-100%', ty: '-50%' },
    'top-left': { dx: -1, dy: -1, tx: '-100%', ty: '-100%' },
    'top-right': { dx: 1, dy: -1, tx: '0', ty: '-100%' },
    'bottom-left': { dx: -1, dy: 1, tx: '-100%', ty: '0' },
    'bottom-right': { dx: 1, dy: 1, tx: '0', ty: '0' },
});

export const PLACEMENTS = Object.keys(SIDES);

/** @param {any} a @returns {a is import('../types').SceneView} */
const isView = (a) => !!a && typeof a === 'object' && 'mark' in a && 'type' in a;

/**
 * The point of an anchor a placement names, in inner pixels: a side or corner of
 * a view's box (turned with the view), or the point itself.
 * @param {import('../types').SceneView | import('../types').Point} anchor
 * @param {string} at
 * @returns {import('../types').Point | null}
 */
export function anchorPoint(anchor, at) {
    const side = SIDES[at] || SIDES.center;
    if (!isView(anchor)) return anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y) ? { x: anchor.x, y: anchor.y } : null;
    const c = anchor.center;
    const b = anchor.box;
    if (!c) return null;
    if (!b || (side.dx === 0 && side.dy === 0)) return { x: c.x, y: c.y };
    // The point on the box, measured from the box's own centre, then turned.
    const bx = b.x + b.width / 2, by = b.y + b.height / 2;
    let x = bx + side.dx * b.width / 2 - c.x;
    let y = by + side.dy * b.height / 2 - c.y;
    if (anchor.angle) {
        const a = anchor.angle * Math.PI / 180;
        [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    }
    return { x: c.x + x, y: c.y + y };
}

/**
 * Position `el` in the layer. Returns whether it has somewhere to be.
 * @param {import('../types').Chart} chart
 * @param {HTMLElement} el
 * @param {import('../types').SceneView | import('../types').Point | null} anchor
 * @param {import('../types').Placement} [placement]
 * @returns {boolean}
 */
export function position(chart, el, anchor, placement = {}) {
    const at = placement.at || 'center';
    const side = SIDES[at] || SIDES.center;
    const p = anchor ? anchorPoint(anchor, at) : null;
    if (!p) { el.hidden = true; return false; }
    // Inner pixels -> the page -> the layer (which fills the chart's container).
    const page = chart.toClient(p);
    const host = chart.dom().getBoundingClientRect();
    const offset = placement.offset || 0;
    // To a hundredth of a pixel: a scale's arithmetic leaves noise past that.
    const round = (/** @type {number} */ v) => Math.round(v * 100) / 100;
    const x = round(page.x - host.left + side.dx * offset + (placement.dx || 0));
    const y = round(page.y - host.top + side.dy * offset + (placement.dy || 0));
    el.hidden = false;
    el.style.transform = `translate(${x}px, ${y}px) translate(${side.tx}, ${side.ty})`;
    return true;
}

/**
 * How far a point is from a view's box, 0 inside it. With no box, from its centre.
 * @param {import('../types').SceneView} view
 * @param {import('../types').Point} point
 * @returns {number}
 */
export function distanceToView(view, point) {
    const b = view.box;
    if (!b) return view.center ? Math.hypot(point.x - view.center.x, point.y - view.center.y) : Infinity;
    const dx = Math.max(b.x - point.x, 0, point.x - (b.x + b.width));
    const dy = Math.max(b.y - point.y, 0, point.y - (b.y + b.height));
    return Math.hypot(dx, dy);
}

/**
 * The view nearest a point, within `reach`.
 * @param {import('../types').SceneView[]} views
 * @param {import('../types').Point} point
 * @param {number} reach
 * @returns {import('../types').SceneView | null}
 */
export function nearestView(views, point, reach) {
    /** @type {import('../types').SceneView | null} */
    let best = null;
    let bestD = Infinity;
    for (const v of views) {
        const d = distanceToView(v, point);
        if (d <= reach && d < bestD) { best = v; bestD = d; }
    }
    return best;
}
