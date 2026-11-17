// The JSON grammar tables in src/vocabulary.js name real things. `check:exports`
// holds them to the declarations (an option that takes a function must be listed);
// this is the other direction: a listed option must exist.
import { describe, it, expect } from 'vitest';
import {
    SPEC_SLOTS, SPEC_FUNCTIONS, SPEC_POSITIONAL, baseMark, baseElement,
    MARK_OPTIONS, MARK_SHORTHANDS, MARK_UNIVERSAL_OPTIONS, ELEMENT_OPTIONS, GUIDE_OPTIONS,
    EDIT_OPTIONS, EDIT_UNIVERSAL_OPTIONS, CONSTRAINT_OPTIONS,
} from '../src/vocabulary.js';
import { DATASET_KEYS, CHART_KEYS } from '../src/core/guards.js';
import { keywordTables } from '../src/json/keywords.js';
import { NAMESPACES } from '../src/json/index.js';

const tables = keywordTables(NAMESPACES);

/** The options an owner may list, or null for an owner that is not a real one. */
function optionsOf(owner) {
    const kinds = {
        spec: [...DATASET_KEYS, ...CHART_KEYS],
        scales: ['*'],
        channel: ['fn', 'scale'],
        mark: [...MARK_SHORTHANDS, ...MARK_UNIVERSAL_OPTIONS],
        tip: GUIDE_OPTIONS.tip,
        axis: ELEMENT_OPTIONS.axis,
        grid: ELEMENT_OPTIONS.grid,
        legend: ELEMENT_OPTIONS.legend,
        outline: ['color'],
        widget: ['onChange'],
    };
    if (kinds[owner]) return kinds[owner];
    const [ns, ...rest] = owner.split('.');
    const type = rest.join('.');
    if (!tables[ns] || !tables[ns].has(type)) return null;
    const positional = SPEC_POSITIONAL[owner] || [];
    if (ns === 'plot') return [...positional, ...MARK_OPTIONS[type]];
    if (ns === 'guides') return [...positional, ...GUIDE_OPTIONS[type]];
    if (ns === 'edit') return [...positional, ...EDIT_UNIVERSAL_OPTIONS, ...(EDIT_OPTIONS[type] || [])];
    // `constraints.custom` takes a meta object, not a vocabulary list.
    if (ns === 'constraints') return [...positional, ...CONSTRAINT_OPTIONS[type], ...(type === 'custom' ? ['guide'] : [])];
    return positional;
}

describe('the JSON grammar tables name real options', () => {
    for (const [owner, functions] of Object.entries(SPEC_FUNCTIONS)) {
        it(`SPEC_FUNCTIONS.${owner}`, () => {
            const known = optionsOf(owner);
            expect(known, `"${owner}" is not a kind or an exported factory`).not.toBeNull();
            expect(Object.keys(functions).filter((k) => !known.includes(k))).toEqual([]);
            for (const signature of Object.values(functions)) {
                expect(Array.isArray(signature) || signature === 'ctx' || signature === 'fn').toBe(true);
            }
        });
    }
    it('a mark-specific owner is a bare mark, as `compile` looks it up', () => {
        for (const owner of Object.keys(SPEC_FUNCTIONS).filter((o) => o.startsWith('plot.'))) {
            expect(baseMark(owner.slice(5))).toBe(owner.slice(5));
        }
    });
    it('SPEC_SLOTS names real namespaces', () => {
        for (const [key, def] of Object.entries(SPEC_SLOTS)) {
            for (const ns of def.ns) expect(tables[ns], `${key} -> ${ns}`).toBeDefined();
        }
    });
    it('SPEC_POSITIONAL names real factories', () => {
        for (const key of Object.keys(SPEC_POSITIONAL)) {
            const [ns, ...rest] = key.split('.');
            expect(tables[ns] && tables[ns].has(rest.join('.')), key).toBe(true);
        }
    });
    it('every `when` and `format` member is reachable: a value, or listed as called', () => {
        for (const type of tables.format.keys()) expect(SPEC_POSITIONAL[`format.${type}`], type).toBeDefined();
        for (const [type, member] of tables.when) {
            const made = SPEC_POSITIONAL[`when.${type}`] ? member('x') : member;
            expect(typeof made, type).toBe('function');
        }
    });
    it('every mark and element keyword has a base to read its options from', () => {
        for (const type of tables.plot.keys()) expect(baseMark(type), type).not.toBeNull();
        for (const type of tables.elements.keys()) expect(baseElement(type), type).not.toBeNull();
    });
});
