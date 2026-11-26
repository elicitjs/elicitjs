// @ts-check
// The layer's building blocks: an icon button and a menu. Plain DOM, styled by
// the classes in styles.js.
import { iconElement } from './icons.js';

/**
 * An icon button. Not attached: `place` it, or append it to a group.
 * @param {Document} doc
 * @param {import('../types').ButtonOptions} options
 * @returns {HTMLButtonElement}
 */
export function button(doc, options) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'elicit-ui-button';
    if (options.label) { el.setAttribute('aria-label', options.label); el.title = options.label; }
    if (options.tone) el.dataset.tone = options.tone;
    if (options.icon != null) el.appendChild(iconElement(doc, options.icon));
    if (typeof options.onClick === 'function') {
        const onClick = options.onClick;
        el.addEventListener('click', (e) => onClick(e));
    }
    return el;
}

/**
 * Open a menu in the layer at a point in the layer's own pixels. One item per
 * row; arrow keys move, Enter or Space chooses, Escape or a press outside closes
 * and hands focus back.
 * @param {HTMLElement} layer
 * @param {import('../types').MenuItem[]} items
 * @param {{ x: number, y: number }} at
 * @param {{ onClose?: () => void }} [options]
 * @returns {{ element: HTMLElement, close: () => void }}
 */
export function menu(layer, items, at, options = {}) {
    const doc = layer.ownerDocument;
    const before = /** @type {HTMLElement | null} */ (doc.activeElement);
    const el = doc.createElement('div');
    el.className = 'elicit-ui-menu';
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;

    let open = true;
    const close = () => {
        if (!open) return;
        open = false;
        doc.removeEventListener('pointerdown', outside, true);
        doc.removeEventListener('keydown', onKey, true);
        const view = doc.defaultView;
        if (view) {
            view.removeEventListener('scroll', close, true);
            view.removeEventListener('resize', close);
        }
        el.remove();
        if (before && typeof before.focus === 'function' && doc.contains(before)) before.focus();
        if (options.onClose) options.onClose();
    };

    /** @type {HTMLElement[]} */
    const rows = [];
    for (const item of items) {
        if (!item) continue;
        if (item.separator) {
            const sep = doc.createElement('div');
            sep.className = 'elicit-ui-separator';
            sep.setAttribute('role', 'separator');
            el.appendChild(sep);
            continue;
        }
        if (item.heading != null) {
            const h = doc.createElement('div');
            h.className = 'elicit-ui-heading';
            h.textContent = item.heading;
            el.appendChild(h);
            continue;
        }
        const row = doc.createElement('button');
        row.type = 'button';
        row.className = 'elicit-ui-item';
        const checkable = item.checked != null;
        row.setAttribute('role', checkable ? 'menuitemradio' : 'menuitem');
        if (checkable) row.setAttribute('aria-checked', String(!!item.checked));
        row.tabIndex = -1;
        if (item.tone) row.dataset.tone = item.tone;
        if (item.disabled) row.setAttribute('aria-disabled', 'true');
        if (item.swatch != null) {
            const sw = doc.createElement('span');
            sw.className = 'elicit-ui-swatch';
            sw.style.background = item.swatch;
            row.appendChild(sw);
        } else if (item.icon != null) {
            row.appendChild(iconElement(doc, item.icon));
        }
        const label = doc.createElement('span');
        label.textContent = item.label != null ? String(item.label) : '';
        row.appendChild(label);
        if (item.checked) {
            const check = iconElement(doc, 'check');
            check.classList.add('elicit-ui-check');
            row.appendChild(check);
        }
        row.addEventListener('click', () => {
            if (item.disabled) return;
            close();
            if (typeof item.onSelect === 'function') item.onSelect();
        });
        el.appendChild(row);
        rows.push(row);
    }

    /** @param {number} step */
    const move = (step) => {
        if (!rows.length) return;
        const i = rows.indexOf(/** @type {any} */ (doc.activeElement));
        const next = i < 0 ? (step > 0 ? 0 : rows.length - 1) : (i + step + rows.length) % rows.length;
        rows[next].focus();
    };
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowDown') move(1);
        else if (e.key === 'ArrowUp') move(-1);
        else if (e.key === 'Home') rows[0] && rows[0].focus();
        else if (e.key === 'End') rows.length && rows[rows.length - 1].focus();
        else if (e.key === 'Tab') close();
        else return;
        e.preventDefault();
        e.stopPropagation();
    };
    /** @param {Event} e */
    const outside = (e) => { if (!el.contains(/** @type {Node} */ (e.target))) close(); };

    layer.appendChild(el);
    // Keep it on the page: flip to the other side of the point where it would spill.
    const view = doc.defaultView;
    const host = layer.getBoundingClientRect();
    const size = el.getBoundingClientRect();
    // In the top layer when the browser has one: no box around the chart clips
    // the menu or scrolls to fit it. It stays in the layer, so it keeps the theme.
    const top = typeof el.showPopover === 'function';
    // On top it may pass the chart's edge, as far as the window's.
    const minX = top ? -host.left : 0, minY = top ? -host.top : 0;
    let { x, y } = at;
    if (view && size.width && host.left + x + size.width > view.innerWidth) x = Math.max(minX, x - size.width);
    if (view && size.height && host.top + y + size.height > view.innerHeight) y = Math.max(minY, y - size.height);
    if (top) {
        el.setAttribute('popover', 'manual');
        el.showPopover();
        el.style.transform = `translate(${host.left + x}px, ${host.top + y}px)`;
        // Fixed to the window, so it would drift from the chart: close instead.
        view && view.addEventListener('scroll', close, true);
        view && view.addEventListener('resize', close);
    } else {
        el.style.transform = `translate(${x}px, ${y}px)`;
    }

    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', onKey, true);
    const first = rows.find((r) => r.getAttribute('aria-checked') === 'true') || rows.find((r) => !r.hasAttribute('aria-disabled'));
    if (first) first.focus({ preventScroll: true }); else el.focus({ preventScroll: true });
    return { element: el, close };
}
