// @ts-check
// pan driver — the drag lifecycle for edit.axis.pan. A pan moves the whole view,
// so it resolves no target; what it needs from a lifecycle is where the pointer
// was on the PREVIOUS tick. At dragstart it freezes the press point, each drag
// tick runs the edit (which shifts the domain by the travel since that point,
// through the live scale) and then moves the point up to the pointer, and
// dragend drops it. The domain math lives in the edit, exactly as axisDrag leaves
// it to edit.axis.scale — the driver owns only the lifecycle.
//
// Stepping from the last tick rather than from the press is what lets a pan
// compose with a zoom: the wheel can rescale the axis mid-drag, and the next tick
// pans the zoomed window by the pointer's pixels, with no frozen domain to fight.
// At a limit the window stops and the pointer runs on; dragging back moves the
// window again straight away.
//
// It sets a `grab` / `grabbing` cursor on the plane, which the engine shows
// while the plane is raised.

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
