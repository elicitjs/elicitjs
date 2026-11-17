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
// It visits every route twice: as written, and with `?spec=json`, where every
// example is recorded as a JSON spec and compiled back (src/json). The second
// pass is what holds the JSON grammar to the JavaScript API: an example that
// cannot be written as JSON must be listed, with its reason, in
// ../elicitjs-docs/lib/json-exceptions.json, and one that compiles to a chart
// that warns or throws fails here.
//
// Exits non-zero on any warning.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { routes, asJson } from './docs-routes.mjs';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../elicitjs-docs');

const PORT = 3123;
const BASE = `http://localhost:${PORT}`;

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
    /** Examples the JSON grammar should cover and does not. @type {string[]} */
    const jsonProblems = [];
    /** @type {Record<string, Record<string, string>>} route -> example title -> why it has no JSON form */
    const exceptions = JSON.parse(readFileSync(path.join(docsRoot, 'lib/json-exceptions.json'), 'utf8'));
    let compiled = 0;
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

        // The same routes, each example built from its JSON spec.
        for (const plain of routes) {
            route = asJson(plain);
            await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
            await page.waitForTimeout(400);
            const cards = await page.evaluate(() => [...document.querySelectorAll('.card[data-spec="json"]')].map((card) => ({
                title: card.querySelector('h3')?.textContent || '',
                json: card.getAttribute('data-json'),
                error: card.querySelector('.live-error')?.textContent || '',
            })));
            compiled += cards.filter((c) => c.json === 'compiled').length;
            for (const c of cards) if (c.error) jsonProblems.push(`${route} "${c.title}" throws when built from its JSON: ${c.error}`);
            const without = cards.filter((c) => c.json === 'none').map((c) => c.title).sort();
            const expected = Object.keys(exceptions[plain] || {}).sort();
            for (const title of without.filter((t) => !expected.includes(t))) {
                jsonProblems.push(`${route} "${title}" has no JSON form. Either the JSON grammar lost something the ` +
                    `JavaScript API can say, or the example belongs in elicitjs-docs/lib/json-exceptions.json.`);
            }
            for (const title of expected.filter((t) => !without.includes(t))) {
                jsonProblems.push(`${route} "${title}" is listed in json-exceptions.json but now has a JSON form (or is gone). Remove it.`);
            }
            console.log(`  visited ${route}`);
        }
        if (compiled === 0) jsonProblems.push('no example was built from JSON: `?spec=json` did nothing.');
    } finally {
        await browser.close();
        stopNext();
    }

    console.log('');
    if (seen.size === 0 && jsonProblems.length === 0) {
        console.log(`✓ PASS — no [elicit] warnings across ${routes.length} documented routes, ` +
            `and ${compiled} examples build from their JSON spec`);
        process.exit(0);
    }

    if (seen.size) {
        console.log(`✗ FAIL — ${seen.size} distinct [elicit] warning(s) from the documentation.`);
        console.log('  Each is either a broken example or a false positive in a guard.\n');
        for (const [msg, where] of seen) {
            console.log(`  • ${msg}`);
            console.log(`      on: ${[...where].join(', ')}\n`);
        }
    }
    if (jsonProblems.length) {
        console.log(`✗ FAIL — ${jsonProblems.length} example(s) the JSON spec does not cover.\n`);
        for (const problem of jsonProblems) console.log(`  • ${problem}\n`);
    }
    process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
