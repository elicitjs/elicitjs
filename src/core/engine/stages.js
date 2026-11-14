// @ts-check
import { collectEdits } from '../../edit/route.js';

/**
 * Multi-stage elicitation: an edit with a numeric `stage` is active only in that
 * stage (null = always). `activeEdits` is the one gate every edit path uses.
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

    // Move the stage without rendering: drop every transient so a half-finished
    // gesture can't resume, then notify. The caller renders.
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

    // Change the stage and re-render.
    /** @param {number} stage */
    const setStage = (stage) => {
        applyStage(stage);
        deps.update();
    };

    return {
        getStage, activeEdits, applyStage,
        api: {
            getStage,
            getStageLabel: () => stageLabelOf(currentStage),
            setStage,
            nextStage: () => setStage(currentStage + 1),
        },
    };
}
