// nest driver — the lifecycle for `edit.hierarchy.nest` (direct-pick):
//   dragstart  store the row in flight as `nestFrom`; the engine holds its
//              ancestors still and lifts it above the rest.
//   drag       preview where a release here would put it.
//   dragend    clear `nestFrom` first (so every container is fitted), then commit.
// Registered after `move`, so its preview survives the move's per-tick commit.

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
            // Nothing would change: drop the last proposal.
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
