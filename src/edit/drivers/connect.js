// @ts-check
// connect driver — the drag lifecycle behind edit.network.connect and .rewire.
//
// Both are DIRECT-pick edits: a connect drag starts on the node you grabbed, a
// rewire drag on the endpoint handle you grabbed. So the driver is claimed by
// CAPABILITY (`type`), not by a pick name — the slide precedent. Because the edit
// stays `pick: 'direct'`, `needsPlaneOnTop` stays false and `ctx.index` already
// names the row, so `connect` can sit on a node mark beside an ordinary `move`
// without either stealing the other's gesture.
//
// The driver owns only the lifecycle; it resolves no target. Finding the node under
// the pointer needs the schema (which table holds nodes, which column is its key)
// and belongs to the edit, which has all of that on its ctx — see edit/network.js.
// All the session carries is where the drag STARTED.
//
// Each drag tick previews rather than commits, so the link being drawn is visible
// before the mouse comes up. The proposal is a LINK row while the gesture is on a
// NODE mark, which is exactly why a preview carries the table it is about: the ghost
// pass hands it to the marks that view THAT table, so the rubber band is drawn by
// the link mark. Releasing over empty space commits nothing — apply returns
// undefined with no node under the pointer — so an aborted drag leaves no row.

/** @type {import('./index.js').Driver} */
export const connectDriver = {
    name: 'connect',
    wants: (e) => e.type === 'connect' || e.type === 'rewire',
    onEvent({ event, edits, index, session, runEdit, previewEdit, preview }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick already names the row the drag began on: the source NODE
            // for a connect, the link being rewired for a rewire.
            if (index == null) return false;
            session.set({ fromIndex: index });
            return false;
        }

        const info = session.get();
        if (!info || info.fromIndex == null) return false;

        if (event.type === 'drag') {
            // Show what a release here would make. No target under the pointer means
            // apply returns undefined, so nothing is parked and no band is drawn —
            // which reads as "this drag will not connect anything".
            let previewed = false;
            for (const edit of edits) {
                if (previewEdit(edit, info.fromIndex)) previewed = true;
            }
            if (!previewed && preview.clear()) changed = true;
            else if (previewed) changed = true;
        } else if (event.type === 'dragend') {
            for (const edit of edits) {
                if (runEdit(edit, info.fromIndex)) changed = true;
            }
            // Whether or not it committed, the gesture is over: drop the parked
            // proposal so an aborted drag doesn't leave a ghost link on screen.
            if (preview.clear()) changed = true;
            session.clear();
            changed = true;
        }

        return changed;
    },
};
