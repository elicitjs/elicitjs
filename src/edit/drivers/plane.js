// @ts-check
// plane driver — runs each edit whose gesture matches the event, with a null
// index (create, anchor, newSeries, axis zoom).

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
