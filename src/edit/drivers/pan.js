// @ts-check
// pan driver — the drag lifecycle for edit.axis.pan. Stores the previous tick's
// pointer as `panFrom`, runs the edit, then advances it. Stepping per tick (not
// from the press) lets a mid-drag zoom compose. Sets a `grab` / `grabbing` cursor.

/** @type {import('./index.js').Driver} */
export const panDriver = {
    name: 'pan',
    sessionKeys: ['panFrom', 'cursor'],
    onEvent({ event, edits, session, runEdit }) {
        if (!edits.length) return false;
        const s = session.get();
        if (event.type === 'hover') {
            if (s && s.cursor === 'grab') return false;
            session.set({ cursor: 'grab' });
            return true;
        }
        if (event.type === 'hoverout') {
            if (!s || !s.cursor) return false;
            session.set({ cursor: null });
            return true;
        }
        if (event.type === 'dragstart') {
            session.set({ panFrom: { x: event.x, y: event.y }, cursor: 'grabbing' });
            return true;
        }
        if (event.type === 'drag') {
            if (!s || !s.panFrom) return false;
            let changed = false;
            for (const edit of edits) if (runEdit(edit, null)) changed = true;
            session.set({ panFrom: { x: event.x, y: event.y } });
            return changed;
        }
        if (event.type === 'dragend') {
            if (!s || !s.panFrom) return false;
            session.set({ panFrom: null, cursor: 'grab' });
            return true;
        }
        return false;
    }
};
