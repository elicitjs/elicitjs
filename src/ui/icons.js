// @ts-check
import { warn } from '../core/dev.js';

// The built-in icons: stroked paths on a 16 x 16 grid.
/** @type {Map<string, string>} */
const registry = new Map(Object.entries({
    plus: 'M8 3v10M3 8h10',
    link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1',
    unlink: 'M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1M2.5 6.5l1.5.5M6.5 2.5l.5 1.5M13.5 9.5l-1.5-.5M9.5 13.5l-.5-1.5',
    trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5M6.8 7v3.5M9.2 7v3.5',
    swap: 'M3 6h9.5l-2.5-2.5M13 10H3.5l2.5 2.5',
    palette: 'M8 2.5c2.5 3 4 4.8 4 6.7a4 4 0 0 1-8 0c0-1.9 1.5-3.7 4-6.7z',
    grip: 'M6 3.5v9M10 3.5v9',
    check: 'M3.5 8.5l3 3 6-7',
}));

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Register an icon under `name`, so a `ui` part takes `icon: name`. `path` is
 * SVG path data on a 16 x 16 grid, drawn as a stroke in the current colour.
 * @param {string} name
 * @param {string} path
 * @returns {void}
 */
export function registerIcon(name, path) {
    if (typeof name !== 'string' || !name || typeof path !== 'string' || !path) {
        warn('ui:icon:register', 'registerIcon(name, path): both must be non-empty strings; `path` is SVG path data on a 16 x 16 grid.');
        return;
    }
    registry.set(name, path);
}

/** The registered icon names. @returns {string[]} */
export const iconNames = () => [...registry.keys()];

/**
 * An icon element: a registered name, SVG markup, or an element used as it is.
 * @param {Document} doc
 * @param {string | Element} icon
 * @returns {Element}
 */
export function iconElement(doc, icon) {
    if (icon && typeof icon === 'object') return icon;
    const text = String(icon);
    if (text.trim().startsWith('<')) {
        const holder = doc.createElement('div');
        holder.innerHTML = text.trim();
        const el = holder.firstElementChild;
        if (el) { el.classList.add('elicit-ui-icon'); return el; }
    }
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'elicit-ui-icon');
    const d = registry.get(text);
    if (!d) {
        warn(`ui:icon:${text}`, `ui: no icon is named "${text}". Built in: ${iconNames().join(', ')}. Add one with authoring.registerIcon(name, path), or pass SVG markup or an element.`);
        return svg;
    }
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
}
