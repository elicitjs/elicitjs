// docs-routes.mjs — the documented routes the browser gates visit.
// One list for `check:warnings` and `verify:browser`, so a new page is added once.

export const routes = [
    '/', '/start', '/api', '/concepts', '/concepts/contracts', '/sizing', '/renderers', '/authoring',
    '/json',
    '/marks/bar', '/marks/rect', '/marks/area', '/marks/tick', '/marks/point',
    '/marks/ellipse', '/marks/curve',
    '/marks/symbol', '/marks/face', '/marks/text', '/marks/line', '/marks/composite',
    '/marks/dotstack', '/marks/waffle', '/marks/needle',
    '/marks/axis-radial', '/marks/arc', '/marks/geo', '/marks/network', '/marks/hierarchy',
    '/marks/trend', '/marks/axes', '/marks/legend', '/marks/sticker', '/marks/shape', '/marks/image',
    '/editing', '/editing/gestures', '/editing/sweep', '/editing/selection',
    '/editing/handles', '/editing/legend',
    '/editing/existence', '/editing/probe', '/editing/axis',
    '/editing/external-controls',
    '/editing/history', '/widgets', '/scales', '/schema', '/dataset', '/constraints', '/layout',
    '/effects', '/guides', '/theming', '/theming/themes', '/looks', '/playground',
    '/case-studies/glyphs',
    '/case-studies/du-bois',
];

/**
 * The same route with every example built from its JSON spec: the docs' examples
 * are written in JavaScript, recorded as JSON and compiled back (see
 * ../elicitjs-docs/components/ExampleLive.tsx).
 * @param {string} route
 */
export const asJson = (route) => `${route}?spec=json`;
