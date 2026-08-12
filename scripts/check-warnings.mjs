// check-warnings.mjs — assert the documentation provokes ZERO `[elicit]` warnings.
//
//   node scripts/check-warnings.mjs        (or: npm run check:warnings)
//
// The second regression gate, and the counterpart to verify-browser.mjs. That one
// asserts behaviour ("drag this, the data must say that"); this one asserts the
// library stays QUIET on correct input.
//
// Why it earns its keep:
//
//   1. Every docs example is a spec that is supposed to be right. A warning here is
//      therefore either a genuinely broken example or a false positive in a guard —
//      both worth failing on. Its first run found two broken examples that had been
//      rendering wrong for a long time: `ruleY({ y: 50 })` and `ruleX({ x: 0 })`
//      pass `y`/`x` as top-level options, which `rule` does not read (it reads
//      `channels.y`), so the reference lines were drawn at a fallback position, not
//      at the value the prose claimed. Nothing threw; the charts just quietly lied.
//      verify-browser.mjs cannot catch that class — the page renders fine.
//
//   2. It runs under NEXT.JS, i.e. webpack, not Vite. The diagnostics were once
//      gated on `import.meta.env.DEV`, which only Vite injects, so all of them were
//      dead in every other bundler AND stripped from the built library.
//
// ONE LIMITATION, stated plainly: a pass here means "nothing complained". It does
// NOT by itself prove the guards are live — a library that had been silenced again
// would also report zero. The liveness proof is the grep in `npm run build:lib`'s
// output (the warning strings must survive the production Rollup build, see
// core/dev.js), plus the fact that this gate's first run reported four warnings.
// Run both; neither alone is sufficient.
//
// Exits non-zero on any warning.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../elicitjs-docs');

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

const routes = [
    '/', '/overview', '/concepts', '/concepts/contracts', '/sizing', '/renderers', '/authoring',
    '/marks/bar', '/marks/rect', '/marks/area', '/marks/tick', '/marks/point',
    '/marks/ellipse', '/marks/curve',
    '/marks/symbol', '/marks/face', '/marks/text', '/marks/line', '/marks/composite',
    '/marks/dotstack', '/marks/waffle', '/marks/needle',
    '/marks/axis-radial', '/marks/arc', '/marks/geo', '/marks/network', '/marks/trend', '/marks/axes',
    '/marks/legend', '/marks/sticker',
    '/editing', '/editing/gestures', '/editing/sweep', '/editing/lock',
    '/editing/existence', '/editing/probe', '/editing/stages', '/editing/axis',
    '/editing/external-controls',
    '/editing/history', '/widgets', '/scales', '/schema', '/constraints',
    '/effects', '/guides', '/theming', '/playground',
];

async function waitForServer(url, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`server never became ready at ${url}`);
}

async function main() {
    const next = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
        cwd: docsRoot, stdio: 'ignore', detached: true
    });
    const stopNext = () => { try { process.kill(-next.pid); } catch { /* already gone */ } };

    const browser = await chromium.launch();
    /** @type {Map<string, Set<string>>} message -> routes it appeared on */
    const seen = new Map();
    try {
        await waitForServer(`${BASE}/overview`);
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        let route = '';
        page.on('console', (m) => {
            const t = m.text();
            if (!t.includes('[elicit]')) return;
            if (!seen.has(t)) seen.set(t, new Set());
            seen.get(t).add(route);
        });

        for (route of routes) {
            await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(400);
            console.log(`  visited ${route}`);
        }
    } finally {
        await browser.close();
        stopNext();
    }

    console.log('');
    if (seen.size === 0) {
        console.log(`✓ PASS — no [elicit] warnings across ${routes.length} documented routes`);
        process.exit(0);
    }

    console.log(`✗ FAIL — ${seen.size} distinct [elicit] warning(s) from the documentation.`);
    console.log('  Each is either a broken example or a false positive in a guard.\n');
    for (const [msg, where] of seen) {
        console.log(`  • ${msg}`);
        console.log(`      on: ${[...where].join(', ')}\n`);
    }
    process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
