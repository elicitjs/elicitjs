// @ts-check
// The `ui` layer's one stylesheet, injected once per document. Colours and sizes
// are CSS variables the layer sets from `theme.ui`, so a page can restyle a class
// or override a variable.

const CSS = `
.elicit-ui{position:absolute;inset:0;pointer-events:none;z-index:1;font-family:system-ui,sans-serif;font-size:var(--elicit-ui-font-size);line-height:1.3;color:var(--elicit-ui-ink)}
.elicit-ui>*{position:absolute;left:0;top:0}
.elicit-ui [hidden]{display:none!important}
.elicit-ui-group{display:flex;gap:calc(var(--elicit-ui-gap)*.5);pointer-events:none}
.elicit-ui-button{pointer-events:auto;box-sizing:border-box;width:var(--elicit-ui-size);height:var(--elicit-ui-size);padding:0;display:grid;place-items:center;flex:none;border:1px solid var(--elicit-ui-border);border-radius:50%;background:var(--elicit-ui-surface);color:var(--elicit-ui-ink);box-shadow:0 1px 3px var(--elicit-ui-shadow);cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none}
.elicit-ui-button:hover,.elicit-ui-button:focus-visible,.elicit-ui-button[data-active]{border-color:var(--elicit-ui-accent);color:var(--elicit-ui-accent);outline:none}
.elicit-ui-button[data-active]{background:var(--elicit-ui-accent);color:var(--elicit-ui-surface)}
.elicit-ui-button[data-tone=danger]:hover,.elicit-ui-button[data-tone=danger]:focus-visible{border-color:var(--elicit-ui-danger);color:var(--elicit-ui-danger)}
.elicit-ui-icon{width:62%;height:62%;display:block;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;pointer-events:none}
.elicit-ui-menu{pointer-events:auto;box-sizing:border-box;min-width:150px;max-width:260px;padding:4px;border:1px solid var(--elicit-ui-border);border-radius:var(--elicit-ui-radius);background:var(--elicit-ui-surface);box-shadow:0 6px 20px var(--elicit-ui-shadow);z-index:2;margin:0;overflow:visible;color:var(--elicit-ui-ink)}
.elicit-ui>.elicit-ui-menu:popover-open{position:fixed;inset:auto;left:0;top:0}
.elicit-ui-item{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:0;border-radius:calc(var(--elicit-ui-radius) - 3px);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.elicit-ui-item:hover,.elicit-ui-item:focus-visible{background:color-mix(in srgb,var(--elicit-ui-accent) 14%,transparent);outline:none}
.elicit-ui-item[data-tone=danger]{color:var(--elicit-ui-danger)}
.elicit-ui-item[aria-disabled=true]{color:var(--elicit-ui-muted);cursor:default;background:none}
.elicit-ui-item .elicit-ui-icon{width:14px;height:14px;flex:none}
.elicit-ui-item .elicit-ui-check{margin-left:auto}
.elicit-ui-heading{padding:4px 8px 2px;color:var(--elicit-ui-muted);font-size:.92em}
.elicit-ui-separator{height:1px;margin:4px 2px;background:var(--elicit-ui-border)}
.elicit-ui-swatch{box-sizing:border-box;width:12px;height:12px;flex:none;border:1px solid var(--elicit-ui-border);border-radius:3px}
.elicit-ui-handle{pointer-events:auto;box-sizing:border-box;width:8px;height:22px;padding:0;border:1px solid var(--elicit-ui-accent);border-radius:4px;background:var(--elicit-ui-surface);box-shadow:0 1px 3px var(--elicit-ui-shadow);cursor:ew-resize;touch-action:none}
.elicit-ui-handle[data-axis=y]{width:22px;height:8px;cursor:ns-resize}
.elicit-ui-handle[data-corner]{width:10px;height:10px;border-radius:50%}
.elicit-ui-handle:hover,.elicit-ui-handle:focus-visible,.elicit-ui-handle[data-active]{background:var(--elicit-ui-accent);outline:none}
`;

const MARK = 'data-elicit-ui';

/**
 * Put the stylesheet in `doc`'s head, once.
 * @param {Document} doc
 */
export function ensureStyles(doc) {
    if (!doc.head || doc.head.querySelector(`style[${MARK}]`)) return;
    const style = doc.createElement('style');
    style.setAttribute(MARK, '');
    style.textContent = CSS;
    doc.head.appendChild(style);
}

/**
 * Hand `theme.ui` to the layer as CSS variables.
 * @param {HTMLElement} layer
 * @param {import('../types').UiTheme} t
 */
export function applyTokens(layer, t) {
    const px = (/** @type {number} */ n) => `${n}px`;
    /** @type {Record<string, string>} */
    const vars = {
        surface: t.surface, ink: t.ink, muted: t.muted, border: t.border, accent: t.accent,
        danger: t.danger, shadow: t.shadow,
        radius: px(t.radius), size: px(t.size), gap: px(t.gap), 'font-size': px(t.fontSize),
    };
    for (const k of Object.keys(vars)) layer.style.setProperty(`--elicit-ui-${k}`, vars[k]);
}
