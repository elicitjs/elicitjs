// @ts-check
import { rawChannel } from '../../plot/mark.js';
import { portRolesOf } from '../../plot/port.js';
import { isDirected } from '../schema.js';
import { treeOf } from '../hierarchy.js';
import { settleHierarchy, DEFAULT_GAP } from '../fit.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * The node table's RULES, and the hierarchy's settling.
 *
 * A network's or hierarchy's nodes are drawn by ordinary marks; what the engine
 * needs from them is a RULE over rows, not their built geometry — where a node's
 * box is (`Mark.nodeBox`), which edges a link may use (`ports`), which rows may
 * hold others (`contains`) and keep clear of their siblings (`dodge`). The rules
 * are read here, once, and handed to `link`, the port features and the network /
 * nest edits alike, so a link end, a port and a drop target agree by construction.
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
    // The node table's two RULES, stated by the marks that draw the nodes and handed
    // to every reader: the BOX (where a node's edges are — `Mark.nodeBox`) and the
    // PORTS (which edges a link may use). `link` docks to the first, the network
    // edits test drops against both, and the ports sit on the first — so a link end,
    // a port and a drop target agree by construction. The host of the ports wins the
    // box too: its box is the one the ports are drawn on.
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
    // A shape over the node table is the node; a label's box (`labelBox`, a text
    // mark) only when nothing else declares one — so a name beside a dot never wins.
    const boxed = nodesTableName
        ? features.filter((f) => f && f.views !== 'scale' && f.table === nodesTableName
            && typeof f.nodeBox === 'function')
        : [];
    const boxHost = portsFeature ? portsFeature.portHost
        : boxed.find((f) => !f.labelBox) || boxed[0] || null;
    // Every shape over the node table, the chosen host first. A row the host draws
    // nothing for (a missing value) may be drawn by another mark — a rect for the
    // groups beside a point for the items — and its box is then that mark's.
    const boxHosts = boxHost
        ? [boxHost, ...boxed.filter((f) => f !== boxHost && !f.labelBox)]
        : [];
    const finiteBox = (/** @type {any} */ b) => !!b && [b.cx, b.cy, b.hw, b.hh].every(Number.isFinite);
    /** @type {import('../../types').NodeBoxRule | null} */
    let boxRuleMemo = null;
    /** @type {any[]} */
    let boxRuleKey = [];
    /**
     * The box rule against the CURRENT scales and plot size, memoized per render so
     * a reader can cache by its identity.
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

    // Which rows may HOLD others: any node mark's `contains`, read raw per row.
    /** @type {((row: any, i: number, rows: any[]) => boolean) | null} */
    const containsRule = hierarchyNodes && boxHosts.some((f) => f.contains)
        ? (row, i, rows) => boxHosts.some((f) => f.contains
            && !!rawChannel({ contains: f.contains }, 'contains', row, false, i, rows))
        : null;
    // Which rows keep clear of their siblings, and by how much: any node mark's
    // `dodge`, read raw per row like `contains`. A row no mark dodges is left where
    // it is and nothing makes room for it.
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
    // A stroke in progress pushes nothing apart: a node carried across the chart
    // would scatter every row it passed over. The release spaces the rows once,
    // around whatever the stroke moved — so the stroke remembers where they began.
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
     * The settled node rows for a dataset — the committed one, or a proposal's
     * overlay (a preview asks what a drop WOULD make without writing it).
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
     * The node rows a nest drag has IN FLIGHT (`session.nestFrom`, the nest
     * driver's one key), or null. Read for three things that all follow from "this
     * row is being carried": its ancestors hold still, it paints above the rest,
     * and it reads as grabbed along with everything inside it.
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
     * The containers that must not re-fit this tick: every ancestor of a row in
     * flight. A fitted container follows its contents, so without this it would
     * follow the child being dragged out of it and could never be left.
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
