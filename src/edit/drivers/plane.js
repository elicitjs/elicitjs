// @ts-check
// plane driver — the simplest plane-pick lifecycle: a discrete gesture (click /
// dblclick) that mints or seeds data with no existing target (create, anchor,
// newSeries). It just runs each matching edit with a null index on its trigger
// gesture; the edit's apply() appends to the dataset.

/** @type {import('./index.js').Driver} */
export const planeDriver = {
    name: 'plane',
    sessionKeys: [],
    onEvent({ event, edits, runEdit }) {
        let changed = false;
        edits
            .filter((e) => e.gesture === event.type)
            .forEach((edit) => { if (runEdit(edit, null)) changed = true; });
        return changed;
    }
};
