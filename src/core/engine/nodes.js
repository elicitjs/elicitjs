// @ts-check
import { rawChannel } from '../../plot/mark.js';
import { portRolesOf } from '../../plot/port.js';
import { isDirected } from '../schema.js';
import { treeOf } from '../hierarchy.js';
import { settleHierarchy, DEFAULT_GAP } from '../fit.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * The node table's rules, and the hierarchy's settling.
 *
 * Reads, once, the per-row rules the node marks declare: box (`Mark.nodeBox`),
 * `ports`, `contains` and `dodge`. Links, ports and network/nest edits all
 * share them, so they agree.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   features: any[],
 *   schemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   nodesTableName: string | null,
 *   hierarchyNodes: string | null,
 *   isLockedIn: (name: string) => ((d: any, i: number) => boolean) | null,
 * }} deps
 */
export function createNodes(chart, deps) {
    const { features, schemaSpec, ui, nodesTableName, hierarchyNodes, isLockedIn } = deps;
    // The mark hosting the ports also decides the box, since the ports sit on it.
    const portFeatures = features.filter((f) => f && f.portHost && f.table === nodesTableName);
    if (portFeatures.length > 1) {
        warn(
            'ports:hosts',
            `${portFeatures.length} marks draw ports over the "${nodesTableName}" table; only the ` +
            `first (${markLabel(portFeatures[0].portHost)}) decides where links may meet a node. ` +
            'Put `ports` on one mark.'
        );
    }
    const portsFeature = portFeatures[0] || null;
    // A label's box (`labelBox`) is used only when no shape declares one.
    const boxed = nodesTableName
        ? features.filter((f) => f && f.views !== 'scale' && f.table === nodesTableName
            && typeof f.nodeBox === 'function')
        : [];
    const boxHost = portsFeature ? portsFeature.portHost
        : boxed.find((f) => !f.labelBox) || boxed[0] || null;
    // Every shape over the node table, host first. A row the host can't box falls
    // back to the next mark's box.
    const boxHosts = boxHost
        ? [boxHost, ...boxed.filter((f) => f !== boxHost && !f.labelBox)]
        : [];
    const finiteBox = (/** @type {any} */ b) => !!b && [b.cx, b.cy, b.hw, b.hh].every(Number.isFinite);
    /** @type {import('../../types').NodeBoxRule | null} */
    let boxRuleMemo = null;
    /** @type {any[]} */
    let boxRuleKey = [];
    /**
     * The box rule for the current scales and plot size, memoized so readers can
     * cache by its identity.
     * @returns {import('../../types').NodeBoxRule | null}
     */
    const nodeBoxRule = () => {
        if (!boxHost) return null;
        const key = [chart.scales, chart.innerWidth, chart.innerHeight];
        if (!boxRuleMemo || key.some((k, i) => k !== boxRuleKey[i])) {
            const s = chart.scales;
            const w = chart.innerWidth;
            const h = chart.innerHeight;
            boxRuleMemo = (row, i, rows) => {
                const first = boxHost.nodeBox(row, i, rows, s, w, h);
                if (finiteBox(first)) return first;
                for (let k = 1; k < boxHosts.length; k++) {
                    const box = boxHosts[k].nodeBox(row, i, rows, s, w, h);
                    if (finiteBox(box)) return box;
                }
                return first;
            };
            boxRuleKey = key;
        }
        return boxRuleMemo;
    };
    /** @type {((row: any, i: number, rows: any[]) => Record<string, string> | null) | null} */
    const nodePortsRule = portsFeature
        ? (row, i, rows) => portRolesOf(
            rawChannel(portsFeature.channels, 'ports', row, false, i, rows), isDirected(schemaSpec)
        )
        : null;

    // Which rows may hold others: any node mark's `contains`, read raw per row.
    /** @type {((row: any, i: number, rows: any[]) => boolean) | null} */
    const containsRule = hierarchyNodes && boxHosts.some((f) => f.contains)
        ? (row, i, rows) => boxHosts.some((f) => f.contains
            && !!rawChannel({ contains: f.contains }, 'contains', row, false, i, rows))
        : null;
    // Which rows keep clear of their siblings, and the gap: any node mark's `dodge`.
    /** @type {((row: any, i: number, rows: any[]) => number | null) | null} */
    const dodgeRule = hierarchyNodes && boxHosts.some((f) => f.dodge)
        ? (row, i, rows) => {
            for (const f of boxHosts) {
                if (!f.dodge || !rawChannel({ dodge: f.dodge }, 'dodge', row, false, i, rows)) continue;
                return typeof f.dodge.gap === 'number' ? Math.max(0, f.dodge.gap) : DEFAULT_GAP;
            }
            return null;
        }
        : null;
    // Nothing is pushed apart mid-stroke; the release spaces rows once, around
    // what the stroke moved from where it began.
    chart.stroking = false;
    chart.strokeNodes = null;
    // Data from outside a gesture (the seed, setData) is spaced on its next settle.
    chart.spaceNext = true;
    /**
     * Settle the hierarchy's node rows after something changed them: place, carry,
     * space, fit (core/fit.js). A no-op for every other structure.
     * @param {any[] | null} [before] the node rows as last committed (for carry)
     * @param {Set<number> | null} [frozen] rows whose box must hold still
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean } | null} [dodge]
     *   push overlapping rows apart, around the rows that changed `since`
     * @returns {void}
     */
    const settleNodes = (before = null, frozen = heldStill(), dodge = null) => {
        if (!hierarchyNodes || !boxHosts.length) return;
        chart.tables[hierarchyNodes] = settledNodes(chart.tables, before, frozen, dodge);
    };
    /**
     * The settled node rows for a dataset (committed, or a proposal's overlay).
     * @param {Record<string, any[]>} from
     * @param {any[] | null} before @param {Set<number> | null} frozen
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean } | null} [dodge]
     * @returns {any[]}
     */
    const settledNodes = (from, before, frozen, dodge = null) => settleHierarchy({
        spec: schemaSpec, tables: from, hosts: boxHosts, scales: chart.scales,
        width: chart.innerWidth, height: chart.innerHeight,
        before, frozen, locked: isLockedIn(/** @type {string} */ (hierarchyNodes)),
        dodges: dodge && (!chart.stroking || dodge.preview) ? dodgeRule : null,
        since: dodge ? dodge.since : null,
        anchors: dodge ? dodge.anchors : null,
    });
    /**
     * The node rows a nest drag is carrying (`session.nestFrom`), or null.
     * @returns {number[] | null}
     */
    const inFlight = () => {
        if (!hierarchyNodes) return null;
        /** @type {number[] | null} */
        let out = null;
        for (const s of Object.values(ui.session || {})) {
            if (s && s.nestFrom != null) (out || (out = [])).push(s.nestFrom);
        }
        return out;
    };
    /**
     * Every ancestor of a row in flight. They must not re-fit, or a container
     * would follow the child being dragged out of it.
     * @returns {Set<number> | null}
     */
    const heldStill = () => {
        const flying = inFlight();
        if (!flying) return null;
        const tree = treeOf(schemaSpec, chart.tables);
        return new Set(flying.flatMap((i) => tree.ancestorsOf(i)));
    };

    return {
        boxHosts, nodeBoxRule, nodePortsRule, containsRule,
        settleNodes, settledNodes, inFlight, heldStill,
    };
}
