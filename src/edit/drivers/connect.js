// @ts-check
// connect driver — the drag lifecycle for edit.network.connect and .rewire.
// Claimed by type; both are direct-pick, so `ctx.index` names the starting row.
// The session holds where the drag started (row, point, port side); the edit finds
// the landing node (edit/network.js).
//
// At dragstart it stores the reachable drop keys as `session.targets`; a creating
// drag with nowhere to land does nothing. Every tick until dragend previews, and
// dragend commits.

/** @type {import('./index.js').Driver} */
export const connectDriver = {
    name: 'connect',
    sessionKeys: ['fromIndex', 'fromSide', 'fromPoint', 'targets'],
    wants: (e) => e.type === 'network.connect' || e.type === 'network.rewire',
    onEvent({ event, edits, index, session, runEdit, previewEdit, preview, reachable }) {
        if (!edits.length) return false;
        let changed = false;

        if (event.type === 'dragstart') {
            // The source node (connect) or the link (rewire). A port carries its side.
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
            // Preview what a release here would make; clear it if nothing previews.
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
            // Drop the preview whether or not it committed.
            if (preview.clear()) changed = true;
            session.clear();
            changed = true;
        }

        return changed;
    },
};
