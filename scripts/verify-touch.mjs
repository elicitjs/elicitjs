// verify-touch.mjs — the gestures of verify-browser, driven by a finger.
// A phone-sized page with touch input. Drags are raw touch events sent through
// the DevTools protocol (Playwright's `touchscreen` can only tap), so the browser
// decides, as on a phone, whether a press is a gesture or a page scroll.
//
//   node scripts/verify-touch.mjs                       (starts the docs dev server)
//   node scripts/verify-touch.mjs --url http://localhost:3000   (uses a running one)
//
// Exits non-zero on any failed assertion.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../elicitjs-docs');
const urlArg = process.argv.indexOf('--url');
const PORT = 3112;
const BASE = urlArg > 0 ? process.argv[urlArg + 1] : `http://localhost:${PORT}`;

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function waitForServer(url, timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`server never became ready at ${url}`);
}

async function main() {
    const next = urlArg > 0 ? null : spawn('npx', ['next', 'dev', '-p', String(PORT)], {
        cwd: docsRoot, stdio: 'ignore', detached: true
    });
    const stopNext = () => { if (next) try { process.kill(-next.pid); } catch { /* gone */ } };

    const browser = await chromium.launch();
    try {
        await waitForServer(`${BASE}/start`);
        const context = await browser.newContext({
            viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        const open = async (route, waitFor) => {
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    await page.goto(BASE + route, { waitUntil: 'load', timeout: 60000 });
                    if (waitFor) await page.waitForSelector(waitFor, { timeout: 60000, state: 'attached' });
                    await page.waitForTimeout(400);
                    return;
                } catch (e) {
                    if (attempt === 2) throw e;
                    await page.waitForTimeout(1500);
                }
            }
        };

        const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
            type, touchPoints: pts.map(({ x, y }) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 0 }))
        });
        // A finger drag: press, move in steps, lift.
        const touchDrag = async (from, to, steps = 12) => {
            await touch('touchStart', [from]);
            for (let k = 1; k <= steps; k++) {
                await touch('touchMove', [{ x: from.x + (to.x - from.x) * k / steps, y: from.y + (to.y - from.y) * k / steps }]);
                await page.waitForTimeout(16);
            }
            await touch('touchEnd', []);
            await page.waitForTimeout(200);
        };
        const tap = async (at) => {
            await touch('touchStart', [at]);
            await page.waitForTimeout(40);
            await touch('touchEnd', []);
            await page.waitForTimeout(400); // past the double-tap window
        };
        // How far the page and every scroll box in it have scrolled.
        const scrollY = () => page.evaluate(() => window.scrollY
            + [...document.querySelectorAll('*')].reduce((s, e) => s + e.scrollLeft + e.scrollTop, 0));
        const centre = async (loc) => {
            const b = await loc.boundingBox();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
        };
        const bring = async (sel) => {
            await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await page.waitForTimeout(200);
        };

        // ---- Direct drag on a mark (d3.drag) -------------------------------
        console.log('\nDirect mark drag (/guides #tips)');
        await open('/guides', '#tips svg rect.mark');
        await bring('#tips svg');
        {
            const el = '#tips .chart > div';
            const bar = await centre(page.locator('#tips svg rect.mark').nth(1));
            const before = (await page.$eval(el, (e) => e.__chart.getData()))[1].rain;
            const y0 = await scrollY();
            await touchDrag({ x: bar.x, y: bar.b.y + 2 }, { x: bar.x, y: bar.b.y + 40 });
            const after = (await page.$eval(el, (e) => e.__chart.getData()))[1].rain;
            check('touch: dragging a bar edits it', after < before, `${before} -> ${after}`);
            check('touch: dragging a bar does not scroll the page', (await scrollY()) === y0, `${y0} -> ${await scrollY()}`);
        }

        // ---- A finger shows the tip while it is down --------------------------
        console.log('\nTip under a finger (/guides #tips)');
        {
            const bar = await centre(page.locator('#tips svg rect.mark').nth(2));
            const tipLines = () => page.locator('#tips .chart').first().locator('svg .guide-front-layer text').count();
            await touch('touchStart', [{ x: bar.x, y: bar.y }]);
            await page.waitForTimeout(150);
            check('touch: pressing a bar shows its tip', (await tipLines()) > 0, `lines=${await tipLines()}`);
            await touch('touchEnd', []);
            await page.waitForTimeout(250);
            check('touch: lifting the finger hides the tip', (await tipLines()) === 0, `lines=${await tipLines()}`);
        }

        // ---- Plane gesture: probe ------------------------------------------
        console.log('\nProbe on the plane (/editing/probe #preview)');
        await open('/editing/probe', '#preview .chart svg circle');
        await bring('#preview .chart svg');
        {
            const el = '#preview .chart > div';
            const v = () => page.$eval(el, (e) => e.__chart.getData()[0].v);
            const svg = await page.locator('#preview .chart svg').first().boundingBox();
            const knob = await centre(page.locator('#preview .chart svg circle').first());
            const before = await v();
            const y0 = await scrollY();
            await touchDrag({ x: svg.x + svg.width * 0.3, y: knob.y }, { x: svg.x + svg.width * 0.75, y: knob.y + 12 });
            const after = await v();
            check('touch: a scrub on the plane commits on lift', after > before + 5, `${before} -> ${after}`);
            check('touch: the scrub does not scroll the page', (await scrollY()) === y0, `${y0} -> ${await scrollY()}`);
            const ghosts = await page.locator('#preview .chart').first().locator('svg [data-ghost]').count();
            check('touch: no ghost remains after lift', ghosts === 0, `ghosts=${ghosts}`);

            const atTap = await v();
            await tap({ x: svg.x + svg.width * 0.2, y: knob.y });
            check('touch: a tap on the plane commits', (await v()) < atTap - 5, `${atTap} -> ${await v()}`);
        }

        // ---- Plane gesture: sweep ------------------------------------------
        console.log('\nBand sweep (/editing/sweep #band)');
        await open('/editing/sweep', '#band svg path.mark-line');
        await bring('#band svg');
        {
            const el = '#band .chart > div';
            const before = await page.$eval(el, (e) => e.__chart.getData());
            const tops = page.locator('#band svg circle[data-channel="y2"]');
            const a = await centre(tops.nth(1));
            const b = await centre(tops.nth(4));
            const y0 = await scrollY();
            await touchDrag({ x: a.x, y: a.y }, { x: b.x, y: a.y - 30 }, 16);
            const after = await page.$eval(el, (e) => e.__chart.getData());
            const moved = after.filter((d, i) => Math.abs(d.hi - before[i].hi) > 0.5).length;
            check('touch: sweeping the top edge repaints several highs', moved >= 2, `${moved} highs moved`);
            check('touch: the sweep does not scroll the page', (await scrollY()) === y0, `${y0} -> ${await scrollY()}`);
        }

        // ---- A finger takes a small mark it lands beside ---------------------
        console.log('\nTouch targets (/marks/point #editing)');
        await open('/marks/point', '#editing .chart svg circle.mark');
        await bring('#editing .chart svg');
        {
            const el = '#editing .chart > div';
            const data = () => page.$eval(el, (e) => e.__chart.getData());
            const dot = await centre(page.locator('#editing .chart svg circle.mark').nth(1));
            const r = dot.b.width / 2;
            const before = await data();
            // 9px outside the dot's edge: a miss for a mouse, inside a finger's reach.
            const from = { x: dot.x + r + 9, y: dot.y };
            await touchDrag(from, { x: from.x + 40, y: from.y + 30 });
            const after = await data();
            check('touch: a press just beside a small point grabs it',
                after[1].x > before[1].x + 3 && after[1].y < before[1].y - 3, `${JSON.stringify(before[1])} -> ${JSON.stringify(after[1])}`);
            check('touch: only that point moves',
                after[0].x === before[0].x && after[2].x === before[2].x);
            const hits = await page.locator('#editing .chart svg circle.mark-hit').count();
            check('touch: each point has a touch target', hits === 3, `targets=${hits}`);
        }

        // ---- Empty space still scrolls --------------------------------------
        // A chart must not trap the page: a swipe over a chart with no plane edit scrolls.
        console.log('\nScrolling past a chart (/guides #tips)');
        await open('/guides', '#tips svg rect.mark');
        await bring('#tips svg');
        {
            const svg = await page.locator('#tips svg').first().boundingBox();
            const y0 = await scrollY();
            // Above the bars, where nothing is editable.
            await touchDrag({ x: svg.x + svg.width / 2, y: svg.y + 8 }, { x: svg.x + svg.width / 2, y: svg.y - 150 }, 10);
            await page.waitForTimeout(400);
            check('touch: a swipe over empty chart space scrolls the page', (await scrollY()) > y0 + 20, `${y0} -> ${await scrollY()}`);
        }

        check('no page errors', errors.length === 0, errors.join(' | '));
    } finally {
        await browser.close();
        stopNext();
    }
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
        for (const f of failures) console.log(`  ✗ ${f}`);
        process.exit(1);
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
