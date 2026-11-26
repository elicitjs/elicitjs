// @ts-check
// The `ui` namespace: interactive UI laid over a chart after it is made, driving
// it through external control. Not a grammar namespace: nothing here is a spec
// keyword, and none of it has a JSON form.
//
//   attach(chart, parts)   lay parts over a chart
//   custom(mount)          a part of your own
//   contextMenu, actions, handles   the general parts
//   network                the preset for a node-link chart
export { attach, custom } from './attach.js';
export { contextMenu } from './parts/contextMenu.js';
export { actions } from './parts/actions.js';
export { handles } from './parts/handles.js';
export { network } from './network.js';
