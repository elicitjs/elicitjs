// check-bundle — the built library must still carry its diagnostics, and the
// package must ship it.
//
// Every guard reports through core/dev.js's `warn`, which prefixes `[elicit]`.
// A build that stripped them (which happened once, when they were gated on a
// Vite-only constant that Rollup folded to `false`) is silent in every consumer,
// and `check:warnings` would report that silence as a PASS. grep cannot search
// dist/elicit.js — it is one 350KB line — so count with node.
//
// Run after `npm run build:lib`: npm run check:bundle
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const bundle = readFileSync(new URL('../dist/elicit.js', import.meta.url), 'utf8');
const n = bundle.split('[elicit]').length - 1;
const MIN = 15;
if (n < MIN) {
    console.error(`check-bundle: dist/elicit.js carries ${n} "[elicit]" diagnostics; expected at least ${MIN}. Were the guards stripped?`);
    process.exit(1);
}

const pack = execSync('npm pack --dry-run --json', { encoding: 'utf8' });
const files = JSON.parse(pack)[0].files.map((f) => f.path);
if (!files.includes('dist/elicit.js')) {
    console.error('check-bundle: `npm pack` would not include dist/elicit.js — check package.json#files against .gitignore.');
    process.exit(1);
}
console.log(`check-bundle: OK — ${n} diagnostics in dist/elicit.js; ${files.length} files in the tarball, dist/elicit.js included`);
