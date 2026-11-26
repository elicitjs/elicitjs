// The `ui` namespace touches no DOM until a part is mounted: importing the
// library and building parts works where there is no `document`.
import { describe, it, expect } from 'vitest';
import { ui, authoring } from '../src/index.js';

describe('ui without a document', () => {
    it('imports and builds parts', () => {
        expect(typeof document).toBe('undefined');
        const parts = [ui.contextMenu(), ui.actions({ items: [] }), ui.handles(), ui.network(), ui.custom(() => {})];
        expect(parts.map((p) => p.type)).toEqual(['contextMenu', 'actions', 'handles', 'network', 'custom']);
        expect(parts.every((p) => typeof p.mount === 'function')).toBe(true);
        authoring.registerIcon('dot', 'M8 8h.01');
    });
});
