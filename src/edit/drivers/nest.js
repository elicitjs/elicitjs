// nest driver — the lifecycle of dropping a node into (or out of) a container.
//
// `edit.hierarchy.nest` is a direct edit: the press lands on the node being moved,
// so there is no target search and the plane stays down. What it needs is a
// LIFECYCLE, because the write happens at the release and the feedback happens
// before it:
//
//   dragstart  remember which row is in flight. The engine reads `nestFrom` to hold
//              that row's ancestors still for the stroke (a fitted container follows
//              the child you are dragging, so it could never be left) and to lift the
//              row and its contents above the rest.
//   drag       preview where a release HERE would put it. The engine turns that
//              nesting proposal into the node rows it implies, so the container
//              under the pointer is drawn at the size it would take.
//   dragend    commit. `nestFrom` is dropped FIRST: the commit's settle must fit
//              every container, the ones held still included.
//
// It shares the mark with a `move`, which commits each tick. Drivers run in registry
// order and this one is registered after `move`, so its preview is parked after the
// move's commit cleared the last one. It owns `nestFrom` and nothing else, so its
// `clear()` cannot take the move's anchors with it.

/** @type {import('./index.js').Driver} */
export const nestDriver = {
    name: 'nest',
    sessionKeys: ['nestFrom'],
    wants: (e) => e.type === 'hierarchy.nest',
    onEvent({ event, edits, index, session, runEdit, previewEdit, preview }) {
        if (!edits.length) return false;

        if (event.type === 'dragstart') {
            if (index == null) return false;
            session.set({ nestFrom: index });
            return true;
        }

        const info = session.get();
        if (!info || info.nestFrom == null) return false;
        const from = info.nestFrom;

        if (event.type === 'drag') {
            let previewed = false;
            for (const edit of edits) {
                if (previewEdit(edit, from)) previewed = true;
            }
            // Back inside the container it started in: nothing would change, so
            // nothing is proposed and the last proposal goes.
            if (!previewed) preview.clear();
            return true;
        }
        if (event.type === 'dragend') {
            session.clear();
            for (const edit of edits) runEdit(edit, from);
            preview.clear();
            return true;
        }
        return false;
    },
};
