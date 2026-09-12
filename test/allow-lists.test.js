// Every mark factory's option vocabulary (src/vocabulary.js) is exactly the set of
// options its body READS. Both directions: an option the body reads that the list
// lacks warns falsely at run time; one the list names that the body never reads
// is a silent no-op that validates clean (needle's arc/orient/start/end were).
// Static: the reads are the keys destructured from `opts`/`options` and any
// `opts.key` / `options.key` member access in the factory's file.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MARK_OPTIONS, MARK_UNIVERSAL_OPTIONS, MARK_SHORTHANDS } from '../src/vocabulary.js';

const FILE = {
    arc: 'arc', area: 'area', bar: 'bar', composite: 'composite', curve: 'curve', dotStack: 'dotStack',
    ellipse: 'ellipse', face: 'face', geoBasemap: 'geo', geoTile: 'geo', geoPoint: 'geo', geoPolygon: 'geo',
    geoLine: 'geo', geoText: 'geo', geoRect: 'geo', line: 'line', link: 'link', needle: 'needle', node: 'node',
    point: 'point', rect: 'rect', rule: 'rule', sticker: 'sticker', text: 'text', tick: 'tick', trend: 'trend',
    trendBand: 'trendBand', waffle: 'waffle',
};

/** The factory's source: from `mark: '<name>'` to the next factory's `mark:` (or EOF). */
function factorySource(name) {
    const src = readFileSync(new URL(`../src/plot/${FILE[name]}.js`, import.meta.url), 'utf8');
    const start = src.indexOf(`mark: '${name}'`);
    if (start < 0) throw new Error(`no normalizeMarkOptions for ${name}`);
    const next = src.slice(start + 1).search(/mark: '\w+'/);
    return src.slice(start, next < 0 ? undefined : start + 1 + next);
}

/** Option names the source reads off the normalized options object. */
function readsOf(src) {
    const keys = new Set();
    // const { a, b: alias, c = 1 } = opts;
    for (const m of src.matchAll(/const \{([\s\S]*?)\} = (?:opts|options);/g)) {
        // Strip line comments — but not the `//` inside a URL default ('https://…').
        for (const part of m[1].replace(/(^|\s)\/\/[^\n]*/g, '$1').split(',')) {
            const k = part.trim().split(/[:=\s]/)[0];
            if (k) keys.add(k);
        }
    }
    // opts.key / options.key (a rejected option read only to warn about it —
    // needle's options[dead] — is deliberately not a read)
    for (const m of src.matchAll(/\b(?:opts|options)\.(\w+)/g)) keys.add(m[1]);
    // resolveHandles(scales, opts) reads the handle trio off the options directly.
    if (/resolveHandles\(\s*scales,\s*(?:opts|options)\s*[,)]/.test(src)) {
        for (const k of ['handles', 'handleSize', 'handleColor']) keys.add(k);
    }
    return keys;
}

const universal = new Set([...MARK_UNIVERSAL_OPTIONS, ...MARK_SHORTHANDS]);

describe('mark option vocabularies match the factory bodies', () => {
    for (const [name, allow] of Object.entries(MARK_OPTIONS)) {
        it(`${name}`, () => {
            const reads = readsOf(factorySource(name));
            const undeclared = [...reads].filter((k) => !universal.has(k) && !allow.includes(k) && k !== 'channels');
            const unread = allow.filter((k) => !reads.has(k));
            expect({ undeclared, unread }).toEqual({ undeclared: [], unread: [] });
        });
    }
});
