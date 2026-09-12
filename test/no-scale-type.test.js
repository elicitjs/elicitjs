// A scale's `type` is a label, never control flow: every branch reads the
// capability flags `kind` / `temporal` / `invertible` that core/scales.js stamps.
// Adding a scale type means adding a case in core/scales.js and nowhere else
// (CLAUDE.md, "Never branch on scale.type"). This pins it: zero `scale.type ===`
// comparisons outside that file. Read with fs rather than grep — core/scales.js
// carries a non-UTF-8 byte that makes grep treat it as binary.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) yield* walk(full);
        else if (name.endsWith('.js')) yield full;
    }
}

// Strip line and block comments so a comment that explains the rule does not
// trip it. Good enough for this tree: no `//` inside a string on any offending line.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// `scale.type === 'x'`, `s.type !== 'x'`, `.type === 'sequential'`, also
// `['sequential', 'diverging'].includes(scale.type)`.
const BRANCH = /\b\w+\.type\s*[!=]==?\s*['"](linear|log|symlog|pow|sqrt|time|band|point|ordinal|sequential|diverging)['"]|['"](linear|log|symlog|pow|sqrt|time|band|point|ordinal|sequential|diverging)['"]\s*[!=]==?\s*\w+\.type\b|\.includes\(\s*\w*[sS]cale\w*\.type\s*\)/;

describe('scale.type is never control flow outside core/scales.js', () => {
    it('finds no scale-type branch in the mark, edit, or engine layers', () => {
        const offenders = [];
        for (const file of walk(ROOT)) {
            const rel = relative(ROOT, file);
            if (rel === 'core/scales.js') continue;
            const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
            lines.forEach((line, i) => {
                if (BRANCH.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});
