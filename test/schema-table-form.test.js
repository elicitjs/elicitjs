// A boolean link fact stated in the bare table form is read as the fact, not as
// a column named after it.
import { describe, it, expect } from 'vitest';
import { normalizeSchema, isDirected } from '../src/core/schema.js';
import { setWarnings } from '../src/index.js';

setWarnings(false);

describe('bare links-table form with a link fact', () => {
    it('reads `directed: false` as the table fact and declares no such column', () => {
        const spec = normalizeSchema({
            structure: 'network',
            tables: {
                nodes: { id: { type: 'categorical', key: true } },
                links: { directed: false, source: { type: 'ref' }, target: { type: 'ref' } },
            },
        });
        expect(isDirected(spec)).toBe(false);
        expect(Object.keys(spec.tables.links.fields)).toEqual(['source', 'target']);
        expect(spec.tables.links.directed).toBe(false);
    });
});
