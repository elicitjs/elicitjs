// @ts-check
import { rawChannel } from '../../plot/mark.js';
import { portRolesOf } from '../../plot/port.js';
import { isDirected } from '../schema.js';
import { treeOf, nestingOf } from '../hierarchy.js';
import { settleHierarchy, DEFAULT_GAP } from '../fit.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * The node table's rules, and the hierarchy's settling.
 *
 * Reads, once, the per-row rules the node marks declare: box (`Mark.nodeBox`),
 * `ports`, `contains` and `dodge` (on by default). Links, ports and network/nest edits all
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
 *   settleTurn: (stroking: boolean) => { space: boolean } | null,
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
    // Which rows keep clear of their siblings, and the gap. Every node does under a
    // hierarchy; once a node mark states `dodge`, those marks decide.
    const dodgers = boxHosts.filter((f) => f.dodge);
    /** @type {((row: any, i: number, rows: any[]) => number | null) | null} */
    const dodgeRule = hierarchyNodes && boxHosts.length
        ? (row, i, rows) => {
            if (!dodgers.length) return DEFAULT_GAP;
            for (const f of dodgers) {
                if (!rawChannel({ dodge: f.dodge }, 'dodge', row, false, i, rows)) continue;
                return typeof f.dodge.gap === 'number' ? Math.max(0, f.dodge.gap) : DEFAULT_GAP;
            }
            return null;
        }
        : null;
    // A composite takes space as a whole: the union of every part's box over the
    // row (its shape and its label), not just the shape that hosts `dodge`.
    /** @type {Map<string, any[]>} */
    const glyphParts = new Map();
    for (const f of features) {
        if (!f || !f.glyph || f.views === 'scale' || f.table !== hierarchyNodes || typeof f.nodeBox !== 'function') continue;
        if (!glyphParts.has(f.glyph)) glyphParts.set(f.glyph, []);
        /** @type {any[]} */ (glyphParts.get(f.glyph)).push(f);
    }
    /** @type {((row: any, i: number, rows: any[]) => any) | null} */
    const extentRule = glyphParts.size
        ? (row, i, rows) => {
            const s = chart.scales, w = chart.innerWidth, h = chart.innerHeight;
            let host = null, own = null;
            for (const f of boxHosts) {
                const b = f.nodeBox(row, i, rows, s, w, h);
                if (finiteBox(b)) { host = f; own = b; break; }
            }
            const parts = host && host.glyph ? glyphParts.get(host.glyph) : null;
            if (!parts || !own) return own;
            let x0 = own.cx - own.hw, x1 = own.cx + own.hw, y0 = own.cy - own.hh, y1 = own.cy + own.hh;
            for (const f of parts) {
                if (f === host) continue;
                const b = f.nodeBox(row, i, rows, s, w, h);
                if (!finiteBox(b)) continue;
                x0 = Math.min(x0, b.cx - b.hw); x1 = Math.max(x1, b.cx + b.hw);
                y0 = Math.min(y0, b.cy - b.hh); y1 = Math.max(y1, b.cy + b.hh);
            }
            const box = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 };
            // Still a circle only when every part sits inside the shape.
            const same = Math.abs(box.hw - own.hw) < 0.01 && Math.abs(box.hh - own.hh) < 0.01;
            return { ...box, round: !!own.round && same };
        }
        : null;
    // The keys of the nodes that held others at the last settle. A container
    // missing from the new tables' holders just lost its last child.
    const nesting = nestingOf(schemaSpec);
    /** @param {Record<string, any[]>} tables @returns {Set<any>} */
    const holdersOf = (tables) => new Set(nesting && tables ? (tables[nesting.table] || []).map((r) => r && r[nesting.parent]) : []);
    /** @type {Set<any>} */
    let holders = holdersOf(chart.tables);
    /** @param {Record<string, any[]>} tables @returns {Set<number> | null} */
    const emptiedIn = (tables) => {
        if (!nesting || !holders.size) return null;
        const now = holdersOf(tables);
        /** @type {Set<number>} */
        const out = new Set();
        (tables[nesting.nodes] || []).forEach((row, i) => {
            if (row && holders.has(row[nesting.key]) && !now.has(row[nesting.key])) out.add(i);
        });
        return out.size ? out : null;
    };
    // Nothing is pushed apart mid-stroke; the release spaces rows once, around
    // what the stroke moved from where it began.
    chart.stroking = false;
    chart.strokeNodes = null;
    chart.strokeRow = null;
    /**
     * Settle the hierarchy's node rows after something changed them: place, carry,
     * space, fit (core/fit.js). A no-op for every other structure.
     * @param {any[] | null} [before] the node rows as last committed (for carry)
     * @param {Set<number> | null} [frozen] rows whose box must hold still
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean, keepSize?: Set<number> | null, yields?: Set<number> | null } | null} [dodge]
     *   push overlapping rows apart, around the rows that changed `since`. `yields`
     *   are the rows the gesture moved: they never push a container aside
     * @returns {void}
     */
    const settleNodes = (before = null, frozen = heldStill(), dodge = null) => {
        if (!hierarchyNodes || !boxHosts.length) return;
        chart.tables[hierarchyNodes] = settledNodes(chart.tables, before, frozen, dodge);
        holders = holdersOf(chart.tables);
    };
    /**
     * Settle outside a commit (a render, or the chart's first settle), only when
     * this chart owns the layout or outside data waits (core/dataset.js `layout`).
     * @returns {boolean} whether the node rows changed
     */
    const settleOwn = () => {
        if (!hierarchyNodes || !boxHosts.length) return false;
        const turn = deps.settleTurn(chart.stroking);
        if (!turn) { holders = holdersOf(chart.tables); return false; }
        const was = chart.tables[hierarchyNodes];
        // Rows are pushed apart only for data that just arrived from outside; a
        // hover or resize never pushes an answer aside.
        settleNodes(null, heldStill(), turn.space ? {} : null);
        return chart.tables[hierarchyNodes] !== was;
    };
    /**
     * The settled node rows for a dataset (committed, or a proposal's overlay).
     * @param {Record<string, any[]>} from
     * @param {any[] | null} before @param {Set<number> | null} frozen
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean, keepSize?: Set<number> | null, yields?: Set<number> | null } | null} [dodge]
     * @returns {any[]}
     */
    const settledNodes = (from, before, frozen, dodge = null) => {
        const spacing = !!dodge && (!chart.stroking || !!dodge.preview);
        return settleHierarchy({
            spec: schemaSpec, tables: from, hosts: boxHosts, scales: chart.scales,
            width: chart.innerWidth, height: chart.innerHeight,
            before, frozen, locked: isLockedIn(/** @type {string} */ (hierarchyNodes)),
            dodges: spacing ? dodgeRule : null,
            spacing,
            emptied: emptiedIn(from),
            since: dodge ? dodge.since : null,
            anchors: dodge ? dodge.anchors : null,
            keepSize: dodge ? dodge.keepSize : null,
            yields: dodge ? dodge.yields : null,
            // A preview is drawn mid-drag: the row in flight passes over containers.
            passing: !!(dodge && dodge.preview),
            holds: containsRule,
            extents: extentRule,
        });
    };
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
        settleNodes, settleOwn, settledNodes, inFlight, heldStill,
    };
}
