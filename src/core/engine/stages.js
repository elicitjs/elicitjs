// @ts-check
import { collectEdits } from '../../edit/route.js';

/**
 * Multi-stage elicitation: edits carrying a numeric `stage` are active only in
 * that stage (null = always). This is a uniform descriptor filter applied to
 * EVERY edit — the same shape as `gesture` matching — not a per-mode engine
 * branch, so the one-interaction-model invariant holds. `activeEdits` is the
 * single gate the dispatch/editable/plane-on-top paths run their edits through.
 *
 * @param {{
 *   spec: import('../../types').ElicitSpec,
 *   ui: any,
 *   listeners: { stage: Set<Function> },
 *   update: () => void,
 * }} deps
 */
export function createStages(deps) {
    const { spec, ui, listeners } = deps;
    let currentStage = spec.stage != null ? spec.stage : 0;
    /** @type {(string | null)[]} */
    const stageLabels = Array.isArray(spec.stageLabels) ? spec.stageLabels : [];
    /** @param {number} n @returns {string | null} */
    const stageLabelOf = (n) => (stageLabels[n] != null ? stageLabels[n] : null);
    /** The stage the chart is in now. */
    const getStage = () => currentStage;
    /**
     * @param {any} feature
     * @returns {import('../../types').Edit[]}
     */
    const activeEdits = (feature) =>
        collectEdits(feature).filter(e => e.stage == null || e.stage === currentStage);

    // Move the stage cursor WITHOUT re-rendering: drop every transient (an in-flight
    // driver lock, a hover preview) so a stage switch can't resume a half-finished
    // gesture, then notify. Callers render — `setStage` on the container does it
    // directly; a driver's `stage.next()` rides the dispatch's own re-render.
    /** @param {number} n */
    const applyStage = (n) => {
        currentStage = n;
        ui.session = {};
        ui.preview = null;
        ui.hover = null;
        ui.grab = null;
        ui.selection.clear(); // selection is per-stage transient, like the session
        for (const cb of listeners.stage) cb(currentStage, stageLabelOf(currentStage));
    };

    // Multi-stage controls on the container. Advancing the stage re-renders (the
    // active edit set, plane-on-top, and cursors all follow the stage) and drops
    // every transient.
    /** @param {number} stage */
    const setStage = (stage) => {
        applyStage(stage);
        deps.update();
    };

    return {
        getStage, stageLabelOf, activeEdits, applyStage,
        api: {
            getStage,
            getStageLabel: () => stageLabelOf(currentStage),
            setStage,
            nextStage: () => setStage(currentStage + 1),
        },
    };
}
