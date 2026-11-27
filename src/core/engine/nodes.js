// @ts-check
import { rawChannel } from '../../plot/mark.js';
import { portRolesOf } from '../../plot/port.js';
import { boxBounds } from '../../plot/linkRouter.js';
import { isDirected } from '../schema.js';
import { treeOf, nestingOf } from '../hierarchy.js';
import { settleLayout, paddingOf, fitAxesOf, DEFAULT_GAP } from '../fit.js';
import { SLOTTED } from '../arrange.js';
import { warn } from '../dev.js';
import { markLabel } from '../guards.js';

/**
 * The node table's rules (`nodeBox`, `ports`, `contains`) and spatial layout
 * settling (`spec.layout` + `mark.contains`) across tables, networks and
 * hierarchies. Links, ports and network/nest edits all share these rules.
 *
 * @param {import('./state.js').ChartState} chart
 * @param {{
 *   features: any[],
 *   schemaSpec: import('../../types').SchemaSpec,
 *   ui: any,
 *   specLayout: import('../../types').LayoutSpec[],
 *   markContains: { feature: any, where: ((row: any, i: number, rows: any[]) => boolean) | null, padding: any, fit: boolean | 'x' | 'y' }[],
 *   constraintsIn: (table: string) => import('../../types').Constraint[],
 *   nodesTableName: string | null,
 *   hierarchyNodes: string | null,
 *   isLockedIn: (name: string) => ((d: any, i: number) => boolean) | null,
 *   settleTurn: (stroking: boolean) => { space: boolean } | null,
 * }} deps
 */
export function createNodes(chart, deps) {
    const {
        features, schemaSpec, ui, specLayout, markContains, constraintsIn,
        nodesTableName, hierarchyNodes, isLockedIn,
    } = deps;

    const finiteBox = (/** @type {any} */ b) => !!b && [b.cx, b.cy, b.hw, b.hh].every(Number.isFinite);

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

    /**
     * Every shape mark over `table` declaring `nodeBox`, host first. A label's box
     * (`labelBox`) is used only when no shape declares one.
     * @param {string | null} table
     * @returns {any[]}
     */
    const hostsFor = (table) => {
        if (!table) return [];
        const boxed = features.filter((f) => f && f.views !== 'scale' && !f.portHost
            && f.table === table && typeof f.nodeBox === 'function');
        if (!boxed.length) return [];
        const first = (table === nodesTableName && portsFeature)
            ? portsFeature.portHost
            : boxed.find((f) => !f.labelBox) || boxed[0];
        return [first, ...boxed.filter((f) => f !== first && !f.labelBox)];
    };

    const boxHosts = hostsFor(nodesTableName);
    const boxHost = boxHosts[0] || null;

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

    // ── Bucket `spec.layout` descriptors by target table ────────────────────
    const defaultLayoutTable = hierarchyNodes || schemaSpec.primary;
    /** @type {Map<string, import('../../types').LayoutSpec[]>} */
    const layoutsByTable = new Map();
    /** @param {string} t @param {import('../../types').LayoutSpec} l */
    const addLayout = (t, l) => {
        const list = layoutsByTable.get(t) || [];
        list.push(l);
        layoutsByTable.set(t, list);
    };
    for (const l of specLayout || []) {
        if (!l || typeof l !== 'object' || typeof l.type !== 'string') continue;
        let target = defaultLayoutTable;
        if (l.table != null) {
            const resolved = schemaSpec.byRole[l.table] || (schemaSpec.tables[l.table] && l.table);
            if (!resolved) {
                warn(
                    `layout:table:${l.table}`,
                    `layout.${l.type}({ table: "${l.table}" }): schema declares no table or role "${l.table}". ` +
                    `Declared tables: ${Object.keys(schemaSpec.tables).map((n) => `"${n}"`).join(', ')}. ` +
                    `Falling back to "${defaultLayoutTable}".`
                );
            } else {
                target = resolved;
            }
        }
        if (l.type === 'contain' && (!hierarchyNodes || target !== hierarchyNodes)) {
            warn(
                'layout:contain:structure',
                'layout.contain() requires a hierarchy structure (`schema: { structure: "hierarchy", tables: { nodes, nesting } }`). Ignoring.'
            );
            continue;
        }
        addLayout(target, l);
    }

    // ── Container eligibility (hierarchy only) ──────────────────────────────
    const nesting = nestingOf(schemaSpec);
    const nestingConstraints = nesting ? constraintsIn(nesting.table) : [];
    const constraintParents = nestingConstraints
        .filter((c) => c && typeof c === 'object' && c.type === 'contain' && c.options && typeof c.options.parent === 'function')
        .map((c) => /** @type {(row: any, i: number, rows: any[]) => boolean} */ (/** @type {any} */ (c).options.parent));

    const hierarchyLayouts = hierarchyNodes ? (layoutsByTable.get(hierarchyNodes) || []) : [];
    const layoutContainWheres = hierarchyLayouts
        .filter((l) => l.type === 'contain' && l.options && typeof l.options.where === 'function')
        .map((l) => /** @type {(row: any, i: number, rows: any[]) => boolean} */ ((l.options || {}).where));

    /** Does `mark.contains` entry `m` accept row `i` (it must box the row and pass `where`)? */
    const markContainsMatches = (/** @type {typeof markContains[0]} */ m, /** @type {any} */ row, /** @type {number} */ i, /** @type {any[]} */ rows) => {
        if (!row) return false;
        const box = m.feature.nodeBox(row, i, rows, chart.scales, chart.innerWidth, chart.innerHeight);
        if (!finiteBox(box) || box.hw <= 0 || box.hh <= 0) return false;
        return !m.where || !!m.where(row, i, rows);
    };

    /**
     * Which rows may hold others: respects `constraints.contain({ parent })`,
     * `mark.contains`, and (when neither restricts) `layout.contain({ where })`.
     * Null when nothing restricts which nodes may be containers (any node may).
     * @type {((row: any, i: number, rows: any[]) => boolean) | null}
     */
    const containsRule = hierarchyNodes && (constraintParents.length || markContains.length || layoutContainWheres.length)
        ? (row, i, rows) => {
            if (constraintParents.length && !constraintParents.every((fn) => !!fn(row, i, rows))) return false;
            if (markContains.length && !markContains.some((m) => markContainsMatches(m, row, i, rows))) return false;
            if (!constraintParents.length && !markContains.length && layoutContainWheres.length) {
                return layoutContainWheres.some((fn) => !!fn(row, i, rows));
            }
            return true;
        }
        : null;

    /**
     * Chart-side nesting gate for `mark.contains` sugar (mirrors `constraints.contain`
     * for marks that declared `contains`, without mutating a shared dataset).
     * @type {((nestRows: any[], nodeRows: any[]) => boolean) | null}
     */
    const markContainsGate = hierarchyNodes && markContains.length && nesting
        ? (nestRows, nodeRows) => {
            const index = new Map();
            nodeRows.forEach((row, i) => {
                const k = row ? row[nesting.key] : undefined;
                if (k !== undefined && k !== null && !index.has(k)) index.set(k, i);
            });
            for (const r of nestRows) {
                if (!r) continue;
                const pIdx = index.has(r[nesting.parent]) ? index.get(r[nesting.parent]) : -1;
                if (pIdx < 0) continue;
                if (!markContains.some((m) => markContainsMatches(m, nodeRows[pIdx], pIdx, nodeRows))) return false;
            }
            return true;
        }
        : null;

    // ── Per-table layout config (hosts, extents, containOf, arrangeOf, dodges, custom) ──
    /** @type {Map<string, any>} */
    const tableConfigs = new Map();
    const tableSet = new Set([...layoutsByTable.keys()]);
    if (hierarchyNodes) tableSet.add(hierarchyNodes);

    for (const table of tableSet) {
        const hosts = hostsFor(table);
        if (!hosts.length) continue;
        const isHierarchy = table === hierarchyNodes;
        const list = layoutsByTable.get(table) || [];

        // A composite takes space as a whole: the union of every part's box over the
        // row (its shape and its label), not just the shape that hosts `nodeBox`.
        /** @type {Map<string, any[]>} */
        const glyphParts = new Map();
        for (const f of features) {
            if (!f || !f.glyph || f.views === 'scale' || f.table !== table || typeof f.nodeBox !== 'function') continue;
            if (!glyphParts.has(f.glyph)) glyphParts.set(f.glyph, []);
            /** @type {any[]} */ (glyphParts.get(f.glyph)).push(f);
        }
        /** @type {((row: any, i: number, rows: any[]) => any) | null} */
        const extentRule = glyphParts.size
            ? (row, i, rows) => {
                const s = chart.scales, w = chart.innerWidth, h = chart.innerHeight;
                let host = null, own = null;
                // A turned box takes the upright space around it.
                for (const f of hosts) {
                    const b = f.nodeBox(row, i, rows, s, w, h);
                    if (finiteBox(b)) { host = f; own = boxBounds(b); break; }
                }
                const parts = host && host.glyph ? glyphParts.get(host.glyph) : null;
                if (!parts || !own) return own;
                let x0 = own.cx - own.hw, x1 = own.cx + own.hw, y0 = own.cy - own.hh, y1 = own.cy + own.hh;
                for (const f of parts) {
                    if (f === host) continue;
                    const b = boxBounds(f.nodeBox(row, i, rows, s, w, h));
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

        const containLayouts = list.filter((l) => l.type === 'contain');
        const arrangeLayouts = list.filter((l) => SLOTTED.includes(l.type));
        const dodgeLayouts = list.filter((l) => l.type === 'dodge');
        const customLayouts = list.filter((l) => l.type === 'custom' && typeof l.apply === 'function').map((l) => /** @type {any} */ (l.apply));

        // Warn once if a non-hierarchy table scopes an arrangement to `'containers'`.
        if (!isHierarchy) {
            for (const l of [...arrangeLayouts, ...dodgeLayouts]) {
                if (l.options && l.options.in === 'containers') {
                    warn(
                        `layout:${l.type}:containers:${table}`,
                        `layout.${l.type}({ in: "containers" }) applies to table "${table}", which is not a hierarchy, so there are no containers.`
                    );
                }
            }
        }

        /**
         * Container geometry (`padding`, `fit`) for row `i` of a hierarchy: merges
         * matching `mark.contains` sugar first, then explicit `layout.contain(...)`
         * rules (later wins). Returns default walls when a hierarchy container has
         * no explicit `contain` geometry.
         * @type {((row: any, i: number, rows: any[]) => { padding: import('../fit.js').Sides, fit: import('../fit.js').FitAxes } | null) | null}
         */
        const containOf = isHierarchy
            ? (row, i, rows) => {
                let matched = false;
                let padding;
                /** @type {boolean | 'x' | 'y'} */
                let fit = false;
                for (const m of markContains) {
                    if (!markContainsMatches(m, row, i, rows)) continue;
                    matched = true;
                    if (m.padding !== undefined) padding = m.padding;
                    if (m.fit !== undefined) fit = m.fit;
                }
                for (const l of containLayouts) {
                    const opt = l.options || {};
                    if (typeof opt.where === 'function' && !opt.where(row, i, rows)) continue;
                    matched = true;
                    if (opt.padding !== undefined) padding = opt.padding;
                    if (opt.fit !== undefined) fit = opt.fit;
                }
                // A hierarchy container with no explicit geometry still keeps default
                // walls (10px padding, unfitted) so children stay inside it.
                if (!matched && containsRule && !containsRule(row, i, rows)) return null;
                return { padding: paddingOf(padding), fit: fitAxesOf(fit) };
            }
            : null;

        /**
         * Slot arrangement matching `parentIndex` (`null` for top-level roots / flat
         * table rows, `>= 0` for a container's children). Last matching rule wins.
         * @type {((parentIndex: number | null, rows: any[]) => { arrange: string, gap: number, columns: number | null, keep: 'angle' | 'distance' } | null) | null}
         */
        const arrangeOf = arrangeLayouts.length
            ? (parentIndex, rows) => {
                let hit = null;
                for (const l of arrangeLayouts) {
                    const opt = l.options || {};
                    const scope = opt.in;
                    if (!isHierarchy) {
                        if (scope === 'containers' || typeof scope === 'function') continue;
                    } else {
                        if (scope === undefined || scope === 'containers') {
                            if (parentIndex === null) continue;
                        } else if (scope === 'roots') {
                            if (parentIndex !== null) continue;
                        } else if (typeof scope === 'function') {
                            if (parentIndex === null || !scope(rows[parentIndex], parentIndex, rows)) continue;
                        }
                    }
                    hit = {
                        arrange: l.type,
                        gap: typeof opt.gap === 'number' && Number.isFinite(opt.gap) ? Math.max(0, opt.gap) : DEFAULT_GAP,
                        columns: typeof opt.columns === 'number' && opt.columns >= 1 ? Math.floor(opt.columns) : null,
                        keep: /** @type {'angle' | 'distance'} */ (opt.keep === 'angle' ? 'angle' : 'distance'),
                    };
                }
                return hit;
            }
            : null;

        /**
         * Opt-in dodge gap for row `i` in group `parentIndex`. Last matching rule wins;
         * returns null when no `layout.dodge()` matches.
         * @type {((row: any, i: number, rows: any[], parentIndex: number | null) => number | null) | null}
         */
        const dodgeRule = dodgeLayouts.length
            ? (row, i, rows, parentIndex) => {
                /** @type {number | null} */
                let gap = null;
                for (const l of dodgeLayouts) {
                    const opt = l.options || {};
                    const scope = opt.in;
                    if (!isHierarchy) {
                        if (scope === 'containers' || typeof scope === 'function') continue;
                    } else {
                        if (scope === 'roots' && parentIndex !== null) continue;
                        if (scope === 'containers' && parentIndex === null) continue;
                        if (typeof scope === 'function' && (parentIndex === null || !scope(rows[parentIndex], parentIndex, rows))) continue;
                    }
                    if (typeof opt.where === 'function' && !opt.where(row, i, rows)) continue;
                    gap = typeof opt.gap === 'number' && Number.isFinite(opt.gap) ? Math.max(0, opt.gap) : DEFAULT_GAP;
                }
                return gap;
            }
            : null;

        tableConfigs.set(table, { hosts, extentRule, containOf, arrangeOf, dodgeRule, customLayouts, isHierarchy });
    }

    const layoutTables = [...tableConfigs.keys()];
    const hasLayout = layoutTables.length > 0;

    // The keys of the nodes that held others at the last settle. A container
    // missing from the new tables' holders just lost its last child.
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
    chart.strokeTable = null;
    chart.strokeNodes = null;
    chart.strokeRow = null;

    /**
     * The settled rows for one table (committed, or a proposal's overlay).
     * @param {Record<string, any[]>} from
     * @param {any[] | null} before @param {Set<number> | null} frozen
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean, keepSize?: Set<number> | null, yields?: Set<number> | null } | null} [dodge]
     * @param {string | null} [table]
     * @returns {any[]}
     */
    const settledNodes = (from, before, frozen, dodge = null, table = hierarchyNodes || layoutTables[0] || null) => {
        if (!table) return [];
        const cfg = tableConfigs.get(table);
        if (!cfg) return (from && from[table]) || [];
        const spacing = !!dodge && (!chart.stroking || !!dodge.preview);
        return settleLayout({
            spec: schemaSpec,
            table,
            tables: from,
            hosts: cfg.hosts,
            scales: chart.scales,
            width: chart.innerWidth,
            height: chart.innerHeight,
            before,
            frozen,
            locked: isLockedIn(table),
            containOf: cfg.containOf,
            arrangeOf: cfg.arrangeOf,
            dodges: spacing ? cfg.dodgeRule : null,
            custom: cfg.customLayouts.length ? cfg.customLayouts : null,
            spacing,
            emptied: cfg.isHierarchy ? emptiedIn(from) : null,
            since: dodge ? dodge.since : null,
            anchors: dodge ? dodge.anchors : null,
            keepSize: dodge ? dodge.keepSize : null,
            yields: dodge ? dodge.yields : null,
            // A preview is drawn mid-drag: the row in flight passes over containers.
            passing: !!(dodge && dodge.preview),
            holds: cfg.isHierarchy ? containsRule : null,
            extents: cfg.extentRule,
        });
    };

    /**
     * Settle one layout table (or every layout table when `table` is omitted) after
     * something changed it. A no-op when no layout applies.
     * @param {any[] | null} [before]
     * @param {Set<number> | null} [frozen]
     * @param {{ since?: any[] | null, anchors?: number[] | null, preview?: boolean, keepSize?: Set<number> | null, yields?: Set<number> | null } | null} [dodge]
     * @param {string | null} [table]
     * @returns {void}
     */
    const settleNodes = (before = null, frozen = heldStill(), dodge = null, table = null) => {
        if (!hasLayout) return;
        const targets = table ? (tableConfigs.has(table) ? [table] : []) : layoutTables;
        for (const t of targets) {
            chart.tables[t] = settledNodes(chart.tables, before, frozen, dodge, t);
        }
        holders = holdersOf(chart.tables);
    };

    /**
     * Settle outside a commit (a render, or the chart's first settle), only when
     * this chart owns the layout or outside data waits (core/dataset.js `layout`).
     * @returns {boolean} whether any table's rows changed
     */
    const settleOwn = () => {
        if (!hasLayout) return false;
        const turn = deps.settleTurn(chart.stroking);
        if (!turn) { holders = holdersOf(chart.tables); return false; }
        let moved = false;
        for (const t of layoutTables) {
            const was = chart.tables[t];
            chart.tables[t] = settledNodes(chart.tables, null, heldStill(), turn.space ? {} : null, t);
            if (chart.tables[t] !== was) moved = true;
        }
        holders = holdersOf(chart.tables);
        return moved;
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

    /** @param {string} table @returns {any[]} */
    const boxHostsOf = (table) => (tableConfigs.get(table) ? tableConfigs.get(table).hosts : []);

    /**
     * Which axes are fitted for `row` in `table` (used by compute.js for the size lock).
     * @param {string} table @param {any} row @param {number} i @param {any[]} rows
     * @returns {import('../fit.js').FitAxes}
     */
    const fitAxesAt = (table, row, i, rows) => {
        const cfg = tableConfigs.get(table);
        const cSpec = cfg && cfg.containOf ? cfg.containOf(row, i, rows) : null;
        return cSpec ? cSpec.fit : { x: false, y: false };
    };

    return {
        hasLayout, layoutTables, boxHosts, boxHostsOf, fitAxesAt,
        nodeBoxRule, nodePortsRule, containsRule, markContainsGate,
        settleNodes, settleOwn, settledNodes, inFlight, heldStill,
    };
}
