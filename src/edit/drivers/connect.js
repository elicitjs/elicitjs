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
// All the session carries is where the drag STARTED: the row, the press point (a
// release back on the starting node makes a loop only once the pointer has moved
// off it — see `connect`), and — when it began on a port (plot/port.js) — the SIDE
// that port sits on, which the new link keeps.
//
// ── Only drops that work ──────────────────────────────────────────────────
// At dragstart the driver asks the engine which ports a release could land on
// (`reachable`: each place the edit declares in `Edit.targets`, tried as a commit
// with every constraint) and keeps them as `session.targets`. The engine shows
// exactly those ports while the drag lasts. A creating drag with nowhere to land
// draws nothing at all — no band, no ports — so a node that cannot start a link
// says so by not responding. A rewire still drags: dropping its end in empty space
// is how a link is removed.
//
// Every tick, dragstart included, previews rather than commits, so the link being
// drawn is visible from the moment you press. With no node under the pointer the
// edit proposes a half-made row whose free end is the pointer (a preview-only row;
// see `ctx.preview`), so the band follows the pointer the whole way. The proposal
// is a LINK row while the gesture is on a node or port mark, which is exactly why a
// preview carries the table it is about: the ghost pass hands it to the marks that
// view THAT table, so the rubber band is drawn by the link mark. Releasing over
// empty space commits nothing — apply returns undefined on a commit with no node
// under the pointer — so an aborted drag leaves no row.

/** @type {import('./index.js').Driver} */
export const connectDriver = {
    name: 'connect',
    sessionKeys: ['fromIndex', 'fromSide', 'fromPoint', 'targets'],
    wants: (e) => e.type === 'network.connect' || e.type === 'network.rewire',
    onEvent({ event, edits, index, session, runEdit, previewEdit, preview, reachable }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // Direct pick already names the row the drag began on: the source NODE
            // for a connect, the link being rewired for a rewire. A port node carries
            // its edge; a body carries none, and the link slides.
            if (index == null) return false;
            const node = event.node;
            session.set({
                fromIndex: index,
                fromSide: node && node.side ? node.side : null,
                fromPoint: { x: event.x, y: event.y },
            });
            /** @type {string[] | null} */
            let targets = null;
            for (const edit of edits) {
                const keys = reachable ? reachable(edit, index) : null;
                if (keys) targets = [...(targets || []), ...keys];
            }
            // A creating drag with nowhere to land: no band, no ports.
            const creates = edits.some((e) => e.cardinality === 'append');
            if (targets && !targets.length && creates) {
                session.clear();
                return true;
            }
            if (targets) session.set({ targets });
            // The band appears on the press, not on the first move.
            for (const edit of edits) {
                if (previewEdit(edit, index)) changed = true;
            }
            return true;
        }

        const info = session.get();
        if (!info || info.fromIndex == null) return false;

        if (event.type === 'drag') {
            // Show what a release here would make: the finished link when a node is
            // under the pointer, the band to the pointer when none is. Only an edit
            // whose `when` fails previews nothing, and then the band goes too.
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
