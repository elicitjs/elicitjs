// verify-browser.mjs — real-browser checks for behaviour the typechecker can't see.
// Starts a throwaway Next dev server over the sibling elicitjs-docs site, drives
// Chromium via Playwright, asserts, tears down.
//
//   node scripts/verify-browser.mjs        (or: npm run verify:browser)
//
// This is the repo's only regression gate: there is no unit-test suite, and the
// docs are the regression surface. It drives ../elicitjs-docs, which is the documentation
// — an example that mounts but no longer does what its prose claims is exactly the
// drift worth catching, so these assert BEHAVIOUR (drag this, and the data must say
// that), not that a page rendered.
//
// Two classes of bug live here and nowhere else:
//   - Pointer/keyboard state machines. A nudge anchored to the wrong pixel, a lock
//     that repairs the data but still grabs the pointer, an undo that steps once per
//     pointermove — all typecheck perfectly.
//   - Example rot. Every example is eval'd in the page, so a syntax error or a scope
//     collision fails loudly (an example's `const bar` shadows the bar MARK, because
//     each scope name is a `new Function` parameter).
//
// Exits non-zero on any failed assertion so it can gate a commit.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../elicitjs-docs');

const PORT = 3111;
const BASE = `http://localhost:${PORT}`;

// The head of the default categorical palette (encoding.js's DEFAULT_PALETTE, and
// theme.palette). Used only to tell one KIND of circle from another — a node dot
// takes the first palette colour, a link's endpoint handle is themed differently —
// so it is a proxy for "this circle is a node", not an assertion about colour.
// Named once so a palette change is one edit here rather than a scavenger hunt;
// assertions that are genuinely ABOUT colour compare swatches to marks instead.
const PALETTE_HEAD = '#4e79a7';

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// Next compiles each route on first request, so the first hit is slow.
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
    try {
        await waitForServer(`${BASE}/overview`);
        const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('console', (m) => {
            if (m.type() !== 'error') return;
            // "Failed to load resource" carries no URL on the console message, so it
            // cannot be told apart from a real missing asset here. The `response`
            // listener below judges those precisely instead.
            if (m.text().startsWith('Failed to load resource')) return;
            errors.push(`[${page.url().replace(BASE, '')}] ${m.text()}`);
        });
        // A failed REQUEST, with its URL. Next's own dev chunks race during on-demand
        // route compilation — a 404 for a chunk that is about to be rebuilt says
        // nothing about the docs — so they are excluded and everything else (an
        // example's missing image or data file) still fails the gate.
        page.on('response', (r) => {
            if (r.status() < 400) return;
            const url = r.url();
            if (url.includes('/_next/')) return;
            errors.push(`[${page.url().replace(BASE, '')}] ${r.status()} ${url}`);
        });

        // Open a route and wait for its charts. Next dev compiles on demand and the
        // examples mount after hydration, so a cold route can be slow — and a gate
        // that fails intermittently is worse than no gate, because it teaches you to
        // ignore it. Hence the generous budget and one retry: the only thing a
        // timeout here should ever mean is "the page is genuinely broken".
        const open = async (route, waitFor) => {
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    // 'load' rather than 'networkidle': Next's HMR websocket keeps
                    // the connection open, so networkidle can hang after a long
                    // route tour even when the page is ready.
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

        // A route's examples are eval'd client-side; `.live-error` is how ExampleLive
        // reports a throw. Visiting every documented route is the cheapest broad net
        // we have over the examples.
        const visit = async (route) => {
            await open(route);
            const errs = await page.locator('.live-error').allTextContents();
            check(`${route}: every example evaluates`, errs.length === 0, errs.join(' | '));
        };

        // ---- Every documented route mounts -------------------------------
        console.log('\nAll routes (elicitjs-docs)');
        const routes = [
            '/', '/start', '/api', '/overview', '/concepts', '/concepts/contracts', '/sizing', '/renderers', '/authoring',
            '/marks/bar', '/marks/rect', '/marks/area', '/marks/tick', '/marks/point',
            '/marks/ellipse', '/marks/curve',
            '/marks/symbol', '/marks/face', '/marks/text', '/marks/line', '/marks/composite',
            '/marks/dotstack', '/marks/waffle', '/marks/needle',
            '/marks/axis-radial', '/marks/arc', '/marks/geo', '/marks/network', '/marks/trend', '/marks/axes',
            '/marks/legend', '/marks/sticker', '/marks/shape',
            '/editing', '/editing/gestures', '/editing/sweep', '/editing/selection', '/editing/lock',
            '/editing/existence', '/editing/probe', '/editing/stages', '/editing/axis',
            '/editing/external-controls', '/editing/zoom',
            '/editing/history', '/widgets', '/scales', '/schema', '/constraints',
            '/effects', '/guides', '/theming', '/theming/themes', '/playground',
            '/case-studies/glyphs',
        ];
        for (const r of routes) await visit(r);

        // ---- Playground: Build dashboard (reactive) -------------------------
        // The builder serialises form state to a spec on every change (every
        // other route just evaluates a hand-written .example.txt), so this is
        // the one new code path that can emit broken JS. Add a constraint
        // through the Invariants tab and confirm the chart re-renders itself
        // — no Generate step — then read the generated source back.
        //
        // These selectors track components/builder/*. They went stale once when
        // the playground was rebuilt (the old `.area-viz` / `.area-secondary` /
        // `.mark-card` rail no longer exists), and because a selector that
        // matches nothing just TIMES OUT, the whole gate read as broken rather
        // than as out of date. If this section fails to find an element, check
        // CanvasPreview / ConstraintsEditor / MarkLayers before assuming a bug.
        console.log('\nPlayground Build dashboard (/playground)');
        await open('/playground', '.canvas-device-frame svg');

        // The constraints editor lives behind the "Invariants" config tab.
        await page.getByRole('button', { name: /^Invariants/ }).click();
        await page.locator('.constraints-panel .add-inline-select').first().selectOption('clamp');
        await page.waitForTimeout(600); // debounce (250ms) + re-eval + redraw
        const builderErrs = await page.locator('.canvas-device-frame .live-error').allTextContents();
        check('playground: adding a constraint re-renders with no error', builderErrs.length === 0, builderErrs.join(' | '));
        const builderChartCount = await page.locator('.canvas-device-frame svg').count();
        check('playground: the live spec mounts a chart', builderChartCount === 1, `svg=${builderChartCount}`);

        await page.getByRole('button', { name: /View Code/ }).click();
        await page.waitForTimeout(150);
        const generatedCode = await page.locator('.drawer-code').textContent();
        check('playground: generated code includes the added constraint', (generatedCode || '').includes('clamp('), (generatedCode || '').slice(0, 120));
        await page.getByRole('button', { name: /Hide Code/ }).click();

        // Adding a line mark through the catalog keeps the chart rendering: the
        // serialiser has to emit a second, differently-shaped mark call.
        await page.locator('.add-layer-btn').first().click();
        await page.waitForTimeout(200);
        // The catalog opens on its first category tab, so select the one that
        // actually holds the line mark before reaching for it.
        await page.locator('.catalog-tab', { hasText: 'Lines & areas' }).first().click();
        await page.waitForTimeout(150);
        await page.locator('.catalog-item', { hasText: 'Line / Path' }).first().click();
        await page.waitForTimeout(600);
        const lineErrs = await page.locator('.canvas-device-frame .live-error').allTextContents();
        check('playground: adding a line mark keeps the chart rendering', lineErrs.length === 0, lineErrs.join(' | '));
        const withLine = await page.locator('.drawer-code, .canvas-device-frame svg').count();
        check('playground: the chart survives a second mark', withLine >= 1, `nodes=${withLine}`);

        // ---- Responsive sizing --------------------------------------------
        console.log('\nResponsive sizing (/sizing)');
        await open('/sizing', '#scale svg');

        const svgInfo = (sel) => page.$eval(sel, (svg) => ({
            viewBox: svg.getAttribute('viewBox'),
            widthAttr: svg.getAttribute('width'),
            heightAttr: svg.getAttribute('height'),
            renderedW: Math.round(svg.getBoundingClientRect().width)
        }));

        const scale = await svgInfo('#scale svg');
        check('scale: has a viewBox', scale.viewBox === '0 0 480 300', `got ${scale.viewBox}`);
        check('scale: no fixed width attr', scale.widthAttr == null, `got ${scale.widthAttr}`);

        const fixed = await svgInfo('#fixed svg');
        check('fixed: pixel width attr', fixed.widthAttr === '320', `got ${fixed.widthAttr}`);
        check('fixed: no viewBox', fixed.viewBox == null, `got ${fixed.viewBox}`);
        check('fixed: rendered ~320px', Math.abs(fixed.renderedW - 320) <= 2, `got ${fixed.renderedW}`);

        // Resize the viewport and confirm reflow tracks it while fixed does not.
        const reflowWide = await svgInfo('#reflow svg');
        const fixedWide = await svgInfo('#fixed svg');
        await page.setViewportSize({ width: 700, height: 900 });
        await page.waitForTimeout(400); // ResizeObserver + rAF + redraw
        const reflowNarrow = await svgInfo('#reflow svg');
        const fixedNarrow = await svgInfo('#fixed svg');

        check('reflow: svg width attr changes with viewport',
            Number(reflowNarrow.widthAttr) > 0 && reflowNarrow.widthAttr !== reflowWide.widthAttr,
            `${reflowWide.widthAttr} -> ${reflowNarrow.widthAttr}`);
        check('reflow: redraws at native pixels (attr === rendered)',
            Math.abs(Number(reflowNarrow.widthAttr) - reflowNarrow.renderedW) <= 2,
            `attr ${reflowNarrow.widthAttr} vs rendered ${reflowNarrow.renderedW}`);
        check('fixed: width attr unchanged by viewport',
            fixedNarrow.widthAttr === fixedWide.widthAttr, `${fixedWide.widthAttr} -> ${fixedNarrow.widthAttr}`);

        // Layout: a responsive chart must scale to its own column and not eat the
        // page (the docs' own regression, but the chart is what does the eating).
        await page.setViewportSize({ width: 1280, height: 1000 });
        await page.waitForTimeout(300);
        for (const id of ['scale', 'reflow']) {
            const colW = await page.$eval(`#${id} .result`, (e) => Math.round(e.getBoundingClientRect().width));
            const svgW = await page.$eval(`#${id} svg`, (e) => Math.round(e.getBoundingClientRect().width));
            check(`${id}: chart scales to its column`, Math.abs(svgW - colW) <= 2, `svg ${svgW} vs col ${colW}`);
        }

        // ---- Canvas renderer ----------------------------------------------
        // A second renderer (CanvasRenderer) drawing to <canvas> instead of SVG.
        // The point of these checks is the interaction contract: with no DOM
        // elements to hit, direct-pick must resolve the touched mark geometrically
        // and plane gestures must route by coordinates — both invisible to
        // typecheck, both broken silently if the seam leaks. We assert BEHAVIOUR
        // (drag → data moved), and that the chart is genuinely canvas (no svg).
        console.log('\nCanvas renderer (/renderers)');
        await open('/renderers', '#direct .chart canvas');

        // The chart must be canvas, not SVG — proves the renderer actually swapped.
        const directCanvasCount = await page.locator('#direct .chart canvas').count();
        const directSvgCount = await page.locator('#direct .chart svg').count();
        check('canvas: direct example renders a <canvas>', directCanvasCount === 1, `canvas=${directCanvasCount}`);
        check('canvas: direct example has no <svg>', directSvgCount === 0, `svg=${directSvgCount}`);

        // Read the y-values out of the getData panel (bars: [20,45,30,60]).
        const ysOf = (sel) => page.$eval(`${sel} .data-body`, (el) => {
            const out = [];
            const re = /y:\s*(-?\d+(?:\.\d+)?)/g; let m;
            while ((m = re.exec(el.textContent)) !== null) out.push(Number(m[1]));
            return out;
        });

        const barsBefore = await ysOf('#direct');
        // Bar D (4th of 4) is the tallest, so its rect is the biggest hit target.
        // Its band centre is margins.left + step*3.5 = 30 + (336/4)*3.5 = 324 css px,
        // and value 60 puts its top around inner-y 88 — a press at y≈150 lands inside.
        // Scroll into view first: mouse.move uses viewport coords, and a section below
        // the fold would put the drag off-screen (a no-op).
        await page.locator('#direct .chart canvas').scrollIntoViewIfNeeded();
        const dcBox = await page.locator('#direct .chart canvas').boundingBox();
        const colX = dcBox.x + 324;
        await page.mouse.move(colX, dcBox.y + 150);
        await page.mouse.down();
        for (let k = 1; k <= 10; k++) await page.mouse.move(colX, dcBox.y + 150 - k * 9);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const barsAfter = await ysOf('#direct');
        check('canvas: direct-pick drag rewrites the value (hit-tested, no DOM node)',
            barsBefore.length === 4 && barsAfter.length === 4 && barsAfter[3] > barsBefore[3] + 5,
            `D: ${barsBefore[3]} -> ${barsAfter[3]}`);
        check('canvas: drag moved ONLY the grabbed bar',
            barsAfter[0] === barsBefore[0] && barsAfter[1] === barsBefore[1] && barsAfter[2] === barsBefore[2],
            `${barsBefore} -> ${barsAfter}`);

        // Plane gesture: a you-draw-it sweep (planeOnTop). No node identity — the
        // driver picks each target from the pointer coordinates the canvas reports.
        const demandOf = () => page.$eval('#plane .data-body', (el) => {
            const out = [];
            const re = /demand:\s*(-?\d+(?:\.\d+)?)/g; let m;
            while ((m = re.exec(el.textContent)) !== null) out.push(Number(m[1]));
            return out;
        });
        const demandBefore = await demandOf(); // all 50
        await page.locator('#plane .chart canvas').scrollIntoViewIfNeeded();
        const swBox = await page.locator('#plane .chart canvas').boundingBox();
        // Sweep left→right along the top of the plot (low y = high value).
        await page.mouse.move(swBox.x + 44, swBox.y + 40);
        await page.mouse.down();
        for (let k = 1; k <= 18; k++) await page.mouse.move(swBox.x + 44 + k * 20, swBox.y + 40);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const demandAfter = await demandOf();
        check('canvas: plane sweep raises the swept values (coordinate-routed)',
            Math.max(...demandAfter) > 70 && Math.max(...demandBefore) <= 51,
            `max ${Math.max(...demandBefore)} -> ${Math.max(...demandAfter)}`);

        // A plane click on empty space must not throw (no node under the pointer).
        const errsBeforeClick = errors.length;
        await page.mouse.click(swBox.x + 10, swBox.y + 10);
        await page.waitForTimeout(100);
        check('canvas: click on empty space does not error', errors.length === errsBeforeClick,
            errors.slice(errsBeforeClick).join(' | '));

        // ---- Waffle cell-fill consistency ---------------------------------
        console.log('\nWaffle fill consistency (/marks/waffle)');
        const sec = '#shapes-and-click'; // circle cells, unit = 5, edit.waffle.fill
        await open('/marks/waffle', `${sec} svg circle`);

        const readValue = () => page.$eval(`${sec} .data-body`, (el) => {
            const m = el.textContent.match(/value:\s*(-?\d+(?:\.\d+)?)/);
            return m ? Number(m[1]) : null;
        });
        const filledCount = () => page.$$eval(`${sec} svg circle`,
            (cs) => cs.filter((c) => (c.getAttribute('fill') || '').toLowerCase() === '#16a34a').length);

        // Click specific cells (DOM order === cell ordinal) and assert the count is
        // exactly that cell, and the rendered fill matches value / unit. `locator`
        // auto-scrolls the cell into view and clicks its CENTRE — the waffle is far
        // down the page, so a raw viewport-coordinate click would miss it.
        const cells = page.locator(`${sec} svg circle`);
        for (const k of [3, 11, 6]) {
            await cells.nth(k).click();
            await page.waitForTimeout(100);
            const value = await readValue();
            const filled = await filledCount();
            check(`click cell #${k}: value === (k+1)*unit`, value === (k + 1) * 5, `value ${value}, expected ${(k + 1) * 5}`);
            check(`click cell #${k}: filled === value/unit`, filled === value / 5, `filled ${filled}, value/unit ${value / 5}`);
        }

        // A waffle draws one row as a GRID, so the hover outline must ring the whole
        // BLOCK — the effects layer outlines the first node it finds for the datum,
        // which is cell 0, unless the mark states the block (`node.effectShape`).
        await cells.nth(6).hover();
        await page.waitForTimeout(120);
        const hoverOutline = await page.$$eval(`${sec} svg rect.effect`, (rs) => rs.map((r) => ({
            w: +r.getAttribute('width'), h: +r.getAttribute('height'),
        })));
        const cellBox = await page.$eval(`${sec} svg circle`, (c) => +c.getAttribute('r') * 2);
        check('waffle hover: exactly one outline for the hovered block',
            hoverOutline.length === 1, `got ${hoverOutline.length}`);
        check('waffle hover: the outline is the BLOCK, not one cell',
            !!hoverOutline[0] && hoverOutline[0].w > cellBox * 1.5 && hoverOutline[0].h > cellBox * 1.5,
            `outline ${hoverOutline[0] && `${hoverOutline[0].w}×${hoverOutline[0].h}`}, cell ${cellBox}`);

        // ---- The COUNT axis (/marks/waffle #count-axis) --------------------
        // A waffle's magnitude is `count`, on an axis of its own. The axis is
        // opt-in, so this section asks for it: assert it DRAWS, that its ticks read
        // in DATA units (not cell ordinals — the two differ whenever unit != 1),
        // and that it is absent where nobody asked.
        await open('/marks/waffle', '#count-axis svg');
        const countTicks = await page.$$eval('#count-axis svg text',
            (ts) => ts.map((t) => t.textContent.trim()).filter((t) => /^\d+$/.test(t)).map(Number));
        check('count axis: it draws when asked for', countTicks.length > 0, `${countTicks.length} numeric ticks`);
        check('count axis: ticks are in DATA units, not cell ordinals',
            Math.max(...countTicks, 0) > 32, `max tick ${Math.max(...countTicks, 0)} (unit=10, domain 0..320)`);
        const noAxisTicks = await page.$$eval('#counts svg text',
            (ts) => ts.map((t) => t.textContent.trim()).filter((t) => /^\d+$/.test(t)).map(Number));
        check('count axis: absent where nobody asked for it',
            Math.max(...noAxisTicks, 0) <= 0, `found ticks ${JSON.stringify(noAxisTicks)}`);

        // ---- Orientation: a HORIZONTAL waffle (/marks/waffle #orientation) --
        // Orientation is resolved from the CHANNEL MAP, not from the scales, because
        // the count scale's RANGE is needed before build() runs. When the two
        // disagreed the count scale ran vertically while the block drew
        // horizontally, and every cell landed off the side of the frame — the page
        // still rendered, so only geometry read back from the DOM catches it.
        console.log('\nHorizontal waffle + dotStack (#orientation)');
        await open('/marks/waffle', '#orientation svg rect.mark');
        const hCells = await page.$$eval('#orientation svg rect.mark', (rs) => rs.map((r) => ({
            x: +r.getAttribute('x'), y: +r.getAttribute('y'),
            w: +r.getAttribute('width'), h: +r.getAttribute('height'),
            fill: (r.getAttribute('fill') || r.style.fill || '').toLowerCase(),
        })));
        const hRows = new Map();
        for (const c of hCells) {
            const k = Math.round(c.y / 5) * 5;
            if (!hRows.has(k)) hRows.set(k, []);
            hRows.get(k).push(c);
        }
        // Cells cluster into `multiple` rows ACROSS the band per block — the square-cell
        // rule picks that, so it is not 1 and must not be assumed. Every block has the
        // same number of rows (same totalCells, same multiple), so chunking the sorted
        // rows into four equal groups recovers the blocks without a gap threshold.
        const subRows = [...hRows.entries()].sort((a, b) => a[0] - b[0]); // top → bottom
        check('horizontal waffle: 4 blocks of 32 cells, in equal rows across the band',
            hCells.length === 128 && subRows.length % 4 === 0,
            `${hCells.length} cells in ${subRows.length} rows`);
        // Every cell must be inside the frame. The bug drew them from the frame's
        // BOTTOM rightwards, i.e. past the right edge and below the plot.
        const frameBox = await page.$eval('#orientation svg', (svg) => ({
            w: +svg.getAttribute('width') || svg.getBoundingClientRect().width,
            h: +svg.getAttribute('height') || svg.getBoundingClientRect().height,
        }));
        check('horizontal waffle: every cell is inside the frame',
            hCells.every((c) => c.x >= -1 && c.y >= -1 && c.x + c.w <= frameBox.w + 1 && c.y + c.h <= frameBox.h + 1),
            `frame ${frameBox.w}x${frameBox.h}, worst cell ${JSON.stringify(hCells.reduce((a, c) => (c.x + c.w > a.x + a.w ? c : a), hCells[0]))}`);
        const perBlock = subRows.length / 4;
        const hBlocks = [0, 1, 2, 3].map((k) =>
            subRows.slice(k * perBlock, (k + 1) * perBlock).flatMap(([, cs]) => cs));
        // A block runs ALONG x: it spans far more distinct x than y.
        const b0 = hBlocks[0] || [];
        check('horizontal waffle: a block runs along x, not up y',
            new Set(b0.map((c) => Math.round(c.x))).size
            > new Set(b0.map((c) => Math.round(c.y))).size * 3,
            `${new Set(b0.map((c) => Math.round(c.x))).size} x's, ${new Set(b0.map((c) => Math.round(c.y))).size} y's`);
        // unit 10 over a 0..320 domain: values 210/200/310/40 fill 21/20/31/4 cells.
        // The y range runs [height, 0], so the first category sits at the BOTTOM —
        // read the blocks bottom-up to get them in declared domain order.
        const hFilled = hBlocks
            .map((cs) => cs.filter((c) => c.fill === '#4f46e5').length)
            .reverse();
        check('horizontal waffle: filled counts are value/unit per category',
            JSON.stringify(hFilled) === JSON.stringify([21, 20, 31, 4]),
            `got ${JSON.stringify(hFilled)}`);
        // The count axis follows the mark: it is anchored at the BOTTOM here, so its
        // ticks spread across x rather than down y.
        const hAxisTicks = await page.$$eval('#orientation svg text',
            (ts) => ts.filter((t) => /^\d+$/.test(t.textContent.trim()))
                .map((t) => ({ x: +t.getAttribute('x'), y: +t.getAttribute('y') })));
        check('horizontal waffle: the count axis runs along the bottom',
            hAxisTicks.length > 2
            && new Set(hAxisTicks.map((t) => Math.round(t.x))).size > 2
            && new Set(hAxisTicks.map((t) => Math.round(t.y))).size === 1,
            `${hAxisTicks.length} ticks, ${new Set(hAxisTicks.map((t) => Math.round(t.y))).size} distinct y`);

        // A horizontal dotStack: tokens stack RIGHTWARD from the left edge, so a
        // slot's tokens share a y and step in x by the token pitch.
        await open('/marks/dotstack', '#orientation svg circle');
        const tokens = await page.$$eval('#orientation svg circle', (cs) => cs.map((c) => ({
            cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'), r: +c.getAttribute('r'),
            fill: (c.getAttribute('fill') || c.style.fill || '').toLowerCase(),
        })).filter((c) => c.fill !== 'none'));
        const tokenRows = new Map();
        for (const t of tokens) {
            const k = Math.round(t.cy);
            if (!tokenRows.has(k)) tokenRows.set(k, []);
            tokenRows.get(k).push(t);
        }
        check('horizontal dotStack: 6 tokens over 3 occupied slots',
            tokens.length === 6 && tokenRows.size === 3,
            `${tokens.length} tokens, ${tokenRows.size} rows`);
        const tallest = [...tokenRows.values()].sort((a, b) => b.length - a.length)[0] || [];
        const tallestX = tallest.map((t) => t.cx).sort((a, b) => a - b);
        check('horizontal dotStack: a slot stacks along x at one y',
            tallest.length === 3
            && tallestX[1] - tallestX[0] > tallest[0].r
            && Math.abs((tallestX[2] - tallestX[1]) - (tallestX[1] - tallestX[0])) < 1,
            `x ${tallestX.map((v) => v.toFixed(1)).join(',')}`);

        // ---- Rect heatmap + fixed-size boxes (/marks/rect) ----------------
        // A category on both axes must tile the plane (band cells), and padding 0
        // must leave NO gap between cells — the whole point of a heatmap. The
        // width/height mode must draw a fixed-size box, not a band interval or a
        // full-range span. Both are pure geometry, so read the rendered rects.
        console.log('\nRect heatmap + fixed-size boxes (/marks/rect)');
        await open('/marks/rect', '#heatmap .chart svg rect.mark');

        const rectGeom = (sel) => page.$$eval(sel, (rs) => rs.map((r) => ({
            x: +r.getAttribute('x'), y: +r.getAttribute('y'),
            w: +r.getAttribute('width'), h: +r.getAttribute('height'),
            fill: (r.getAttribute('fill') || r.style.fill || '').toLowerCase(),
        })));

        const heatCells = await rectGeom('#heatmap .chart svg rect.mark');
        check('rect heatmap: one cell per (day, slot) — 4×3 = 12',
            heatCells.length === 12, `got ${heatCells.length}`);

        // padding 0 ⇒ columns touch: the sorted unique left edges step by exactly a
        // cell width, so there is no gap between adjacent cells.
        const w0 = heatCells[0]?.w ?? 0;
        const uniqX = [...new Set(heatCells.map((c) => Math.round(c.x * 10) / 10))].sort((a, b) => a - b);
        const colGaps = uniqX.slice(1).map((x, i) => x - uniqX[i]);
        check('rect heatmap: cells touch (padding 0, no column gap)',
            uniqX.length === 4 && colGaps.every((g) => Math.abs(g - w0) < 0.75),
            `w ${w0.toFixed(1)}, gaps ${colGaps.map((g) => g.toFixed(1)).join(',')}`);

        // A sequential fill ⇒ the cells span a range of colours, not one flat fill.
        check('rect heatmap: fill varies with the value field',
            new Set(heatCells.map((c) => c.fill)).size >= 6,
            `${new Set(heatCells.map((c) => c.fill)).size} distinct fills`);

        const boxes = await rectGeom('#fixed-size .chart svg rect.mark');
        check('rect width/height: fixed 28×28 boxes (not band/span)',
            boxes.length === 4 && boxes.every((b) => Math.abs(b.w - 28) < 0.5 && Math.abs(b.h - 28) < 0.5),
            boxes.map((b) => `${b.w}×${b.h}`).join(' '));

        // Editing — drive the real gestures and assert the data moved. A local drag
        // (this block predates the lock section's dragPath helper).
        const mouseDrag = async (fromX, fromY, toX, toY, steps = 20) => {
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            for (let i = 1; i <= steps; i++) {
                await page.mouse.move(fromX + (toX - fromX) * i / steps, fromY + (toY - fromY) * i / steps);
                await page.waitForTimeout(6);
            }
            await page.mouse.up();
            await page.waitForTimeout(100);
        };
        const centreOf = async (loc) => {
            await loc.scrollIntoViewIfNeeded();
            const b = await loc.boundingBox();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        };

        // move() on x & y moves the whole box: a rightward drag raises the x field.
        const boxData = () => page.$eval('#fixed-size .chart > div', (el) => el.getData());
        const boxBefore = await boxData();
        const bc = await centreOf(page.locator('#fixed-size .chart svg rect.mark').first());
        await mouseDrag(bc.x, bc.y, bc.x + 60, bc.y);
        const boxAfter = await boxData();
        check('rect width/height: move() moves the box (x rises on a rightward drag)',
            boxAfter[0].x > boxBefore[0].x + 0.3, `x ${boxBefore[0].x} -> ${boxAfter[0].x}`);

        // select() + legendValue(): click a cell to select it, then drag the ramp
        // handle to set THAT cell's value (colour isn't invertible, so the ramp does
        // it by hand). Proves selection targeting and the by-hand invert on a heatmap.
        const cellData = () => page.$eval('#heatmap .chart > div', (el) => el.getData());
        const cellSel = () => page.$eval('#heatmap .chart > div', (el) => el.getSelection());
        const cell5 = await centreOf(page.locator('#heatmap .chart svg rect.mark').nth(5));
        await page.mouse.click(cell5.x, cell5.y);
        await page.waitForTimeout(100);
        check('rect heatmap: clicking a cell selects it (select())',
            (await cellSel()) === 5, `sel ${await cellSel()}`);
        // The ramp handle is the only circle.mark in this chart; it appears once a
        // row is selected. Drag it down (vertical ramp) to lower the selected value.
        const rampHandle = await page.$$eval('#heatmap .chart svg circle.mark', (cs) => {
            let best = null;
            for (const c of cs) { const r = c.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; if (!best || cx > best.cx) best = { cx, cy }; }
            return best;
        });
        check('rect heatmap: a selection renders the ramp handle', rampHandle != null,
            `handle ${JSON.stringify(rampHandle)}`);
        if (rampHandle) {
            const loadBefore = (await cellData())[5].load;
            await mouseDrag(rampHandle.cx, rampHandle.cy, rampHandle.cx, rampHandle.cy + 55);
            const loadAfter = (await cellData())[5].load;
            check('rect heatmap: dragging the ramp sets the SELECTED cell (legendValue)',
                loadAfter < loadBefore - 2 && loadAfter >= 0, `load ${loadBefore} -> ${loadAfter}`);
        }

        // point heatmap: resize() on the size channel — drag a dot outward from its
        // centre to raise its value (the size scale is invertible).
        console.log('\nPoint heatmap resize (/marks/point)');
        await open('/marks/point', '#heatmap .chart svg circle.mark');
        const dotData = () => page.$eval('#heatmap .chart > div', (el) => el.getData());
        const dotBefore = await dotData();
        const dc = await centreOf(page.locator('#heatmap .chart svg circle.mark').first());
        await mouseDrag(dc.x, dc.y, dc.x + 16, dc.y);
        const dotAfter = await dotData();
        check('point heatmap: resize() raises the dragged dot’s value',
            dotAfter[0].load > dotBefore[0].load + 1, `load ${dotBefore[0].load} -> ${dotAfter[0].load}`);

        // ---- slide() — linear-along-axis magnitude (/editing/gestures) -----
        // slide({ axis:'x', increase:'left' }) on the size channel: dragging LEFT
        // (toward smaller x) grows the value, unlike resize()'s radial distance.
        // The face's eye interaction, generalized onto a plain circle.
        console.log('\nSlide edit (/editing/gestures)');
        await open('/editing/gestures', '#slide .chart svg circle.mark');
        const slideData = () => page.$eval('#slide .chart > div', (el) => el.getData());
        const slBefore = await slideData();
        const slc = await centreOf(page.locator('#slide .chart svg circle.mark').first());
        await mouseDrag(slc.x, slc.y, slc.x - 60, slc.y);
        const slAfter = await slideData();
        check('slide: dragging LEFT raises the value (increase:"left")',
            slAfter[0].mag > slBefore[0].mag + 1, `mag ${slBefore[0].mag} -> ${slAfter[0].mag}`);
        // And the opposite direction lowers it — the mapping is signed, not radial.
        const slc2 = await centreOf(page.locator('#slide .chart svg circle.mark').first());
        await mouseDrag(slc2.x, slc2.y, slc2.x + 90, slc2.y);
        const slAfter2 = await slideData();
        check('slide: dragging RIGHT lowers the value',
            slAfter2[0].mag < slAfter[0].mag - 1, `mag ${slAfter[0].mag} -> ${slAfter2[0].mag}`);

        // ---- hovered effect on a DIRECT-PICK mark (/editing/gestures) -------
        // Hover used to exist only in plane-on-top mode, so a direct-pick mark gave
        // no pre-press signal at all — the cursor was the whole vocabulary. Nothing
        // but a real pointer can prove this: the effect is a CSS property plus an
        // overlay node the engine adds on a pointerenter it only now emits, and both
        // typecheck and check:warnings are blind to it.
        console.log('\nHovered effect on a direct-pick mark (/editing/gestures)');
        await open('/editing/gestures', '#slide .chart svg circle.mark');
        const fxCount = () => page.$eval('#slide .chart svg .effects-layer',
            (el) => el.querySelectorAll('.effect').length).catch(() => 0);
        const fxIdle = await fxCount();
        check('hover: no effect overlay while the pointer is away', fxIdle === 0, `${fxIdle} nodes`);
        const hoverTarget = await centreOf(page.locator('#slide .chart svg circle.mark').first());
        await page.mouse.move(hoverTarget.x, hoverTarget.y);
        await page.waitForTimeout(120);
        const fxOver = await fxCount();
        check('hover: pointing at a draggable mark outlines it', fxOver > 0, `${fxOver} nodes`);
        // And it must go away again — a hover effect that leaks is worse than none.
        await page.mouse.move(hoverTarget.x + 260, hoverTarget.y + 160);
        await page.waitForTimeout(120);
        const fxOut = await fxCount();
        check('hover: leaving the mark clears the outline', fxOut === 0, `${fxOut} nodes`);
        // The mark's own paint is untouched throughout — the whole reason an effect
        // is a CSS property / overlay rather than a style attribute.
        const strokeAfterHover = await page.$eval('#slide .chart svg circle.mark',
            (el) => el.getAttribute('stroke'));
        check('hover: the mark\'s own stroke attribute is untouched',
            strokeAfterHover != null, `stroke=${strokeAfterHover}`);

        // ---- effects follow a ROTATED mark (/marks/point #angle) -------------
        // An effect overlay is a NEW node built beside the mark, so it only lands on
        // the mark if it copies the mark's transform. It didn't: every outline stayed
        // axis-aligned at the mark's unrotated position, and the more you spun a mark
        // the further its own highlight sat from it. Neither typecheck nor
        // check:warnings can see this — the page renders perfectly, just wrong.
        console.log('\nEffects on a rotated mark (/marks/point #angle)');
        await open('/marks/point', '#angle .chart svg rect.mark');
        const sqChart = page.locator('#angle .chart').first();
        const sqMark = sqChart.locator('svg rect.mark').first();
        await sqMark.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        // Spin it well away from its seeded -20°, so an unrotated outline can't pass
        // by accident.
        const sqC = await centreOf(sqMark);
        await mouseDrag(sqC.x, sqC.y - 40, sqC.x + 46, sqC.y + 24);
        const sqTransform = await sqMark.getAttribute('transform');
        check('rotate: dragging a square spins it (mark carries a rotate transform)',
            !!sqTransform && /rotate\(/.test(sqTransform), `transform=${sqTransform}`);
        await page.mouse.move(sqC.x, sqC.y);
        await page.waitForTimeout(150);
        const sqFx = sqChart.locator('svg .effects-layer rect.effect').first();
        const sqFxCount = await sqChart.locator('svg .effects-layer rect.effect').count();
        check('rotate: hovering the rotated square draws an outline', sqFxCount > 0, `${sqFxCount} nodes`);
        const sqFxTransform = sqFxCount ? await sqFx.getAttribute('transform') : null;
        // Same pivot, same angle — the outline is concentric with the mark, so the two
        // transforms must be string-identical, not merely both present.
        check('rotate: the outline carries the SAME rotation as the mark it outlines',
            sqFxTransform === sqTransform, `mark=${sqTransform} outline=${sqFxTransform}`);

        // ---- proximity picking follows a rotated mark ------------------------
        // Direct pick rides the DOM, which honours the transform for free; PROXIMITY
        // pick measures node geometry itself, and that geometry is the mark's upright
        // one. Without bringing the pointer into the mark's frame first, a tick spun
        // onto the horizontal was picked along the vertical it no longer occupies.
        // The example's threshold (12px) is deliberately tighter than the tick's
        // half-length (18px), so a press out along the drawn arm is INSIDE the
        // catchment of the rotated segment and OUTSIDE the catchment of the upright
        // one — the two answers can't be confused for each other.
        const nearChart = page.locator('#angle .chart').nth(2);
        await nearChart.locator('svg line.mark').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const nearData = () => nearChart.locator(':scope > div').first().evaluate((e) => e.getData());
        // Row 0 is seeded at 90° — drawn horizontal. Its own bbox gives the drawn arm.
        const nearBox = await nearChart.locator('svg line.mark').first().boundingBox();
        check('nearest: the 90° tick is drawn HORIZONTAL (wide, not tall)',
            nearBox.width > nearBox.height, `${Math.round(nearBox.width)}x${Math.round(nearBox.height)}`);
        const armX = nearBox.x + nearBox.width - 3;   // just inside the drawn arm's end
        const armY = nearBox.y + nearBox.height / 2;
        const nearBefore = await nearData();
        await mouseDrag(armX, armY, armX, armY - 30);
        const nearAfter = await nearData();
        check('nearest: a spun tick is picked along the arm it is DRAWN on',
            nearAfter[0].y > nearBefore[0].y + 1,
            `y ${nearBefore[0].y} -> ${nearAfter[0].y}`);
        check('nearest: the press did not grab the OTHER tick instead',
            nearAfter[1].y === nearBefore[1].y,
            `other y ${nearBefore[1].y} -> ${nearAfter[1].y}`);

        // ---- a `grabbed` effect exists at all (/marks/point #angle) ----------
        // grabbed used to be painted by the renderer straight off d3.drag, reading
        // `filter` and ignoring the rest of the vocabulary — an outline for it was
        // simply undrawable. It is a state in the engine's pass now, so the default
        // (a filter) must appear mid-drag on the mark's own node and clear on release.
        const sqEl = sqChart.locator('svg rect.mark').first();
        const filterOf = () => sqEl.evaluate((el) => el.style.filter || '');
        check('grab: no filter on the mark at rest', (await filterOf()) === '', `filter=${await filterOf()}`);
        const gC = await centreOf(sqEl);
        await page.mouse.move(gC.x, gC.y);
        await page.mouse.down();
        await page.mouse.move(gC.x + 12, gC.y + 8);
        await page.waitForTimeout(120);
        const filterDuring = await filterOf();
        check('grab: the dragged mark carries the grabbed effect', filterDuring !== '', `filter=${filterDuring}`);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const filterAfter = await filterOf();
        check('grab: the effect clears on release', filterAfter === '', `filter=${filterAfter}`);

        // ---- The mouth is a `curve` mark (/marks/face) -----------------------
        // A stroked curve is a few pixels wide, so the mark lays a fat TRANSPARENT
        // hit path over it and leaves `pointerEvents` unset — which means the engine
        // silences it when the mark is inert and hands the pointer back when it
        // isn't. Whether a transparent stroke is actually hittable is a browser
        // question no amount of typechecking answers; drag it and see.
        console.log('\nFace mouth: a draggable curve (/marks/face)');
        await open('/marks/face', '#emotion .chart svg path.mark-line');
        const mouthChart = page.locator('#emotion .chart').first();
        await mouthChart.locator('svg path.mark-line').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const mouthData = () => mouthChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const mouthPaths = await mouthChart.locator('svg path.mark-line').count();
        check('face mouth: the curve draws a visual path plus a hit path',
            mouthPaths === 2, `${mouthPaths} paths`);
        const mouthBefore = await mouthData();
        const mouthBox = await mouthChart.locator('svg path.mark-line').last().boundingBox();
        const mx = mouthBox.x + mouthBox.width / 2;
        const my = mouthBox.y + mouthBox.height / 2;
        await mouseDrag(mx, my, mx, my - 100);
        const mouthAfter = await mouthData();
        check('face mouth: dragging the mouth up raises valence (slide on curvature)',
            mouthAfter[0].valence > mouthBefore[0].valence + 0.2,
            `valence ${mouthBefore[0].valence} -> ${mouthAfter[0].valence}`);
        // And back down — the mapping is signed, not a one-way pull. Re-measure
        // first: the mouth just bowed, so its box is not where it was.
        const mouthBox2 = await mouthChart.locator('svg path.mark-line').last().boundingBox();
        const mx2 = mouthBox2.x + mouthBox2.width / 2;
        const my2 = mouthBox2.y + mouthBox2.height / 2;
        await mouseDrag(mx2, my2, mx2, my2 + 100);
        const mouthDown = await mouthData();
        check('face mouth: dragging it back down lowers valence',
            mouthDown[0].valence < mouthAfter[0].valence - 0.2,
            `valence ${mouthAfter[0].valence} -> ${mouthDown[0].valence}`);

        // ---- Face as a GROUP of marks (/marks/face) -------------------------
        // The face is a `group`: a `point` head, `ellipse` eyes, `tickY` brows and a
        // `curveY` mouth, each placed through a per-datum FRAME scale. Three things
        // only a real gesture proves, and all three were impossible in the old
        // one-feature face: the head takes an ordinary move(); a drag on a facial
        // feature edits ONLY its own field (per-part direct-pick isolation); and a
        // resize of the head rescales the features with it, because their positions
        // are fractions of the frame rather than pixels.
        console.log('\nFace: head move + per-part isolation (/marks/face)');
        await open('/marks/face', '#head .chart svg circle.mark');
        const headChart = page.locator('#head .chart').first();
        const headData = () => headChart.locator(':scope > div').first().evaluate((e) => e.getData());
        // Scroll the chart into view first — mouseDrag uses viewport coords, and this
        // section sits far down the page (a bbox read while off-screen would miss).
        await headChart.locator('svg circle.mark').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        // The head is the only circle.mark; its bbox gives the centre and radius.
        const head = await headChart.locator('svg circle.mark').first().evaluate((c) => {
            const r = c.getBoundingClientRect();
            return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: Math.min(r.width, r.height) / 2 };
        });
        const headBefore = await headData();
        // Grab the chin — head fill, below the mouth and clear of every feature.
        const chinX = head.cx, chinY = head.cy + head.r * 0.72;
        await mouseDrag(chinX, chinY, chinX + 55, chinY);
        const headMoved = await headData();
        check('face head: dragging the head moves it (px rises on a rightward drag)',
            headMoved[0].px > headBefore[0].px + 0.05, `px ${headBefore[0].px} -> ${headMoved[0].px}`);
        check('face head: moving the head leaves the expression alone',
            headMoved[0].valence === headBefore[0].valence
            && headMoved[0].arousal === headBefore[0].arousal,
            `valence ${headBefore[0].valence} -> ${headMoved[0].valence}`);
        // An eye is an <ellipse> — a node type that did not exist before this glyph
        // was a composition. Dragging one writes arousal and NOTHING else: with the
        // parts as separate features, direct-pick can't fan a gesture across them.
        const eyes = await headChart.locator('svg ellipse.mark').count();
        check('face: the eyes render as ellipse nodes', eyes === 2, `${eyes} ellipses`);
        const eyeBefore = await headData();
        const eyeBox = await headChart.locator('svg ellipse.mark').last().boundingBox();
        await mouseDrag(eyeBox.x + eyeBox.width / 2, eyeBox.y + eyeBox.height / 2,
            eyeBox.x + eyeBox.width / 2 + 60, eyeBox.y + eyeBox.height / 2);
        const eyeAfter = await headData();
        check('face eye: dragging an eye right widens it (arousal rises)',
            eyeAfter[0].arousal > eyeBefore[0].arousal + 0.05,
            `arousal ${eyeBefore[0].arousal} -> ${eyeAfter[0].arousal}`);
        check('face eye: the drag does not move the head (per-part direct pick)',
            eyeAfter[0].px === eyeBefore[0].px && eyeAfter[0].py === eyeBefore[0].py,
            `px ${eyeBefore[0].px} -> ${eyeAfter[0].px}`);

        // ---- A drag on a glyph part is proportional and orthogonal -----------
        // Two properties that only a real gesture can show, and both were broken
        // when the parts first went live:
        //   1. NO GRAB JUMP. `slide` defaults to relative, so a small drag makes a
        //      small change. Absolute mode reads the value off the pointer's
        //      POSITION on a track centred on the mark, so merely PRESSING a part
        //      whose centre isn't at its value's place on that track teleported the
        //      value (a brow jumped a third of its domain on a 12px nudge).
        //   2. ORTHOGONALITY. Two params share a part (a brow's height and tilt),
        //      so they must read different COMPONENTS of one drag. An angular edit
        //      cannot: you grab a brow at its own pivot, so a few pixels of vertical
        //      travel swung the pointer ~90° and pinned the tilt to its extreme.
        console.log('\nFace params: proportional and orthogonal drags (/marks/face)');
        await open('/marks/face', '#expressive .chart svg line.mark');
        const exChart = page.locator('#expressive .chart').first();
        await exChart.locator('svg line.mark').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const exData = () => exChart.locator(':scope > div').first().evaluate((e) => e.getData());
        // A brow: `browH` on the y component (move), `browT` on the x (slide).
        const browAt = () => exChart.locator('svg line.mark').first().evaluate((l) => {
            const r = l.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const exBefore = (await exData())[0];
        const brow1 = await browAt();
        await mouseDrag(brow1.x, brow1.y, brow1.x, brow1.y - 12);
        const browNudged = (await exData())[0];
        check('face brow: a 12px nudge moves browH a little, not a lot (no grab jump)',
            browNudged.browH > exBefore.browH && browNudged.browH < exBefore.browH + 0.45,
            `browH ${exBefore.browH} -> ${browNudged.browH}`);
        check('face brow: a VERTICAL drag leaves the tilt alone (orthogonal params)',
            Math.abs(browNudged.browT - exBefore.browT) < 0.05,
            `browT ${exBefore.browT} -> ${browNudged.browT}`);
        // And the mouth, whose two params share one curve the same way.
        const mouthAt = () => exChart.locator('svg path.mark-line').last().evaluate((p) => {
            const r = p.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const mouth1 = await mouthAt();
        const beforeMouth = (await exData())[0];
        await mouseDrag(mouth1.x, mouth1.y, mouth1.x + 14, mouth1.y);
        const mouthNudged = (await exData())[0];
        check('face mouth: a HORIZONTAL drag smirks it without bending it',
            mouthNudged.smirk > beforeMouth.smirk
            && Math.abs(mouthNudged.curve - beforeMouth.curve) < 0.05,
            `smirk ${beforeMouth.smirk} -> ${mouthNudged.smirk}, curve ${beforeMouth.curve} -> ${mouthNudged.curve}`);

        // ---- Three new glyphs (/case-studies/glyphs) -------------------------
        // Built from existing marks only, so these assert the claims the page makes:
        // a slide writes a COLOUR field (and the head repaints), two parts on one
        // field stay gAligned, and a relative move keeps an area's edge under the
        // pointer while a constraint snaps the value.
        console.log('\nThree new glyphs (/case-studies/glyphs)');
        await open('/case-studies/glyphs', '#hourglass .chart svg rect');
        const gGlyphChart = (id) => page.locator(`#${id} .chart`).first();
        const gGlyphData = async (id) => (await gGlyphChart(id).locator(':scope > div').first().evaluate((e) => e.getData()))[0];
        const gToView = async (id) => {
            await gGlyphChart(id).locator('svg').first().scrollIntoViewIfNeeded();
            await page.waitForTimeout(150);
        };

        await gToView('face');
        // The head is the largest circle; grab it left of the eyes, below the brows.
        const gHeadAt = await gGlyphChart('face').locator('svg circle.mark').evaluateAll((cs) => {
            const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
            return { x: r.x + r.width * 0.25, y: r.y + r.height * 0.55 };
        });
        // The box's hit circle is the head's size too, so skip it (it paints nothing).
        const gHeadFill = () => gGlyphChart('face').locator('svg circle.mark').evaluateAll((cs) =>
            cs.filter((c) => !c.hasAttribute('data-hit') && c.getAttribute('fill') !== 'none')
                .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
                .getAttribute('fill'));
        const gFaceBefore = await gGlyphData('face');
        const gFillBefore = await gHeadFill();
        await mouseDrag(gHeadAt.x, gHeadAt.y, gHeadAt.x + 80, gHeadAt.y);
        const gFaceAfter = await gGlyphData('face');
        check('glyphs face: sliding the head right writes the colour field (toward disgust)',
            gFaceAfter.feeling > gFaceBefore.feeling + 0.4, `feeling ${gFaceBefore.feeling} -> ${gFaceAfter.feeling}`);
        check('glyphs face: the head repaints from the field', (await gHeadFill()) !== gFillBefore);
        check('glyphs face: the colour slide leaves valence alone', gFaceAfter.valence === gFaceBefore.valence);

        await gToView('plant');
        const gFlowerAt = () => gGlyphChart('plant').locator('svg circle.mark').evaluateAll((cs) => {
            const c = cs.find((n) => n.getAttribute('fill') === '#db2777');
            const r = c.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const gPlantBefore = await gGlyphData('plant');
        const gF0 = await gFlowerAt();
        await mouseDrag(gF0.x, gF0.y, gF0.x, gF0.y - 30);
        const gPlantGrown = await gGlyphData('plant');
        check('glyphs plant: dragging the flower up raises energy',
            gPlantGrown.energy > gPlantBefore.energy + 0.1, `energy ${gPlantBefore.energy} -> ${gPlantGrown.energy}`);
        const gAligned = await gGlyphChart('plant').locator('svg').first().evaluate((s) => {
            const stem = s.querySelector('line.mark');
            const flower = [...s.querySelectorAll('circle.mark')].find((n) => n.getAttribute('fill') === '#db2777');
            const ys = [+stem.getAttribute('y1'), +stem.getAttribute('y2')];
            return Math.abs(Math.min(...ys) - +flower.getAttribute('cy'));
        });
        check('glyphs plant: the stem top and the flower read one field, so they meet', gAligned < 0.5, `gap ${gAligned}`);
        const gF1 = await gFlowerAt();
        await mouseDrag(gF1.x, gF1.y, gF1.x + 40, gF1.y);
        const gPlantBloomed = await gGlyphData('plant');
        check('glyphs plant: a sideways drag on the flower writes joy, not energy',
            gPlantBloomed.joy > gPlantGrown.joy + 0.1 && Math.abs(gPlantBloomed.energy - gPlantGrown.energy) < 0.02,
            `joy ${gPlantGrown.joy} -> ${gPlantBloomed.joy}, energy ${gPlantGrown.energy} -> ${gPlantBloomed.energy}`);

        await gToView('hourglass');
        // Two piles share one field over mirrored ranges: the top pile is the
        // higher of the two sand rects.
        const gSand = () => gGlyphChart('hourglass').locator('svg rect').evaluateAll((rs) => {
            const piles = rs.filter((n) => n.getAttribute('fill') === '#eab308')
                .map((n) => n.getBoundingClientRect()).sort((a, b) => a.y - b.y);
            const box = (r) => ({ x: r.x + r.width / 2, top: r.y, bottom: r.y + r.height, height: r.height });
            return { top: box(piles[0]), bottom: box(piles[1]) };
        });
        const gSand0 = await gSand();
        const gWeeks0 = (await gGlyphData('hourglass')).weeks;
        // Grab near the bottom of the top pile, far from its surface: a relative
        // move must shift the surface by the drag distance, not jump to the pointer.
        await mouseDrag(gSand0.top.x, gSand0.top.bottom - 4, gSand0.top.x, gSand0.top.bottom - 4 - 28);
        const gWeeks1 = (await gGlyphData('hourglass')).weeks;
        const gSand1 = await gSand();
        check('glyphs hourglass: dragging the top sand up adds whole weeks',
            gWeeks1 > gWeeks0 && Number.isInteger(gWeeks1), `weeks ${gWeeks0} -> ${gWeeks1}`);
        check('glyphs hourglass: the top surface moves with the pointer (relative move, snapped)',
            Math.abs((gSand0.top.top - gSand1.top.top) - 28) < 9,
            `surface moved ${gSand0.top.top - gSand1.top.top}px for a 28px drag`);
        check('glyphs hourglass: the bottom pile shrinks as the top grows (one field, mirrored ranges)',
            gSand1.bottom.height < gSand0.bottom.height - 10,
            `bottom ${gSand0.bottom.height}px -> ${gSand1.bottom.height}px`);
        await mouseDrag(gSand1.bottom.x, gSand1.bottom.bottom - 4, gSand1.bottom.x, gSand1.bottom.bottom - 4 - 28);
        const gWeeks2 = (await gGlyphData('hourglass')).weeks;
        check('glyphs hourglass: dragging the bottom pile up takes the weeks back',
            gWeeks2 < gWeeks1, `weeks ${gWeeks1} -> ${gWeeks2}`);

        // Positioned glyphs: one per row, placed by the composite's x / y. A gesture
        // on one glyph must write that row alone.
        const gPos = (n) => page.locator('#positions .chart').nth(n);
        const gPosData = (n) => gPos(n).locator(':scope > div').first().evaluate((e) => e.getData());
        await gPos(0).locator('svg').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const gHeads = await gPos(0).locator('svg circle.mark').evaluateAll((cs) => cs
            .filter((c) => !c.hasAttribute('data-hit') && c.getAttribute('fill') !== 'none')
            .map((c) => c.getBoundingClientRect())
            .filter((r) => r.width > 40)
            // The forehead: clear of the mouth, whose hit path covers the lower face.
            .map((r) => ({ x: r.x + r.width * 0.42, y: r.y + r.height * 0.22 })));
        check('glyphs positions: one face per row', gHeads.length === 5, `${gHeads.length} heads`);
        const gFaces0 = await gPosData(0);
        await mouseDrag(gHeads[0].x, gHeads[0].y, gHeads[0].x + 40, gHeads[0].y);
        const gFaces1 = await gPosData(0);
        const gChanged = gFaces1.map((d, i) => d.feeling !== gFaces0[i].feeling);
        check('glyphs positions: sliding one head colours that face alone',
            gChanged.filter(Boolean).length === 1, `changed rows: ${gChanged}`);
        check('glyphs positions: a plain drag keeps every face where it is',
            gFaces1.every((d, i) => d.slept === gFaces0[i].slept && d.worked === gFaces0[i].worked));
        // Shift flips the arbitration: every part's edit declines (when.noShift),
        // and the composite's nearest-pick move (when.shift) takes the drag.
        await page.keyboard.down('Shift');
        await mouseDrag(gHeads[0].x, gHeads[0].y, gHeads[0].x + 50, gHeads[0].y - 40);
        await page.keyboard.up('Shift');
        const gFaces2 = await gPosData(0);
        const gMoved = gFaces2.map((d, i) => d.slept !== gFaces1[i].slept || d.worked !== gFaces1[i].worked);
        check('glyphs positions: Shift-drag moves one face (when.shift on the composite\'s move)',
            gMoved.filter(Boolean).length === 1, `moved rows: ${gMoved}`);
        check('glyphs positions: moving a face leaves its answers alone',
            gFaces2.every((d, i) => d.feeling === gFaces1[i].feeling && d.valence === gFaces1[i].valence));
        // Releasing Shift under a still pointer retires the Shift-only hover ring.
        // Pressing or releasing a key moves nothing, so the renderer re-reports the
        // hover, and the engine tells the move's driver (which no longer accepts it)
        // that the pointer left. Over a pot — a part with no edit — nothing is lit.
        await gPos(1).locator('svg').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const gPot = await gPos(1).locator('svg rect.mark').evaluateAll((rs) => {
            const r = rs.filter((n) => n.getAttribute('fill') === '#b45309')[0].getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        const gRings = () => gPos(1).locator('svg .effect').count();
        await page.mouse.move(gPot.x + 2, gPot.y);
        await page.mouse.move(gPot.x, gPot.y);
        await page.waitForTimeout(150);
        await page.keyboard.down('Shift');
        await page.mouse.move(gPot.x + 1, gPot.y);
        await page.waitForTimeout(150);
        const gRingsHeld = await gRings();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(200);
        const gRingsReleased = await gRings();
        check('glyphs positions: holding Shift lights the move\'s hover ring', gRingsHeld > 0, `${gRingsHeld} rings`);
        check('glyphs positions: releasing Shift without moving clears it', gRingsReleased === 0, `${gRingsReleased} rings`);
        await page.mouse.move(5, 5);

        await gPos(2).locator('svg').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const gGlass0 = await gPosData(2);
        const gTopPile = await gPos(2).locator('svg rect').evaluateAll((rs) => {
            const piles = rs.filter((n) => n.getAttribute('fill') === '#eab308')
                .map((n) => n.getBoundingClientRect()).sort((a, b) => a.x - b.x || a.y - b.y);
            const r = piles[0];   // the first task's top pile
            return { x: r.x + r.width / 2, y: r.y + r.height - 2 };
        });
        await mouseDrag(gTopPile.x, gTopPile.y, gTopPile.x, gTopPile.y - 12);
        const gGlass1 = await gPosData(2);
        check('glyphs positions: dragging one hourglass changes that task\'s estimate alone',
            gGlass1[0].weeks > gGlass0[0].weeks && gGlass1.slice(1).every((d, i) => d.weeks === gGlass0[i + 1].weeks),
            `weeks ${gGlass0.map((d) => d.weeks)} -> ${gGlass1.map((d) => d.weeks)}`);
        // ---- Resize scales the whole glyph (/marks/face) ---------------------
        // `size` is the head's radius AND the frame's half-size, so growing it must
        // grow the eyes with it. That is the frame doing its job: the eye's rx is a
        // FRACTION of the half-size, not a pixel count.
        console.log('\nFace resize rescales the features (/marks/face)');
        await open('/marks/face', '#head .chart svg');
        const rzChart = page.locator('#head .chart').nth(1);
        await rzChart.locator('svg circle.mark').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const rzData = () => rzChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const eyeWidth = () => rzChart.locator('svg ellipse.mark').first()
            .evaluate((e) => +e.getAttribute('rx'));
        const rzHead = await rzChart.locator('svg circle.mark').first().evaluate((c) => {
            const r = c.getBoundingClientRect();
            return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: Math.min(r.width, r.height) / 2 };
        });
        const magBefore = (await rzData())[0].mag;
        const rxBefore = await eyeWidth();
        // Drag outward from the centre: resize() reads the pointer's RADIUS.
        await mouseDrag(rzHead.cx, rzHead.cy + rzHead.r * 0.72, rzHead.cx, rzHead.cy + rzHead.r * 1.4);
        const magAfter = (await rzData())[0].mag;
        const rxAfter = await eyeWidth();
        check('face resize: dragging outward grows the head (resize on size)',
            magAfter > magBefore + 1, `mag ${magBefore} -> ${magAfter}`);
        check('face resize: the eyes grow with it (frame-relative geometry)',
            rxAfter > rxBefore + 0.5, `eye rx ${rxBefore} -> ${rxAfter}`);

        // ---- Locked rows (spec.lock) --------------------------------------
        // The lock is half data-invariant, half pointer policy, and only the second
        // half proves out under real pointer events: a locked mark must be
        // ungrabbable AND invisible to proximity picking, so a drag beside a locked
        // line draws instead of grabbing it. Drive the actual gestures.
        console.log('\nLocked rows (/editing/lock)');
        await open('/editing/lock', '#seed .chart svg');

        const rowsOf = (id) => page.$eval(`#${id} .chart > div`, (el) => el.getData());
        // Aim in DATA space: scroll the plot in, then map a value pair to page px.
        const frameOf = async (id, { m, w, h, xd, yd }) => {
            await page.locator(`#${id} .chart svg`).scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
            const box = await page.$eval(`#${id} .chart svg`, (svg) => {
                const r = svg.getBoundingClientRect();
                return { left: r.left, top: r.top };
            });
            const iw = w - m.left - m.right, ih = h - m.top - m.bottom;
            return (xv, yv) => ({
                x: box.left + m.left + (xv - xd[0]) / (xd[1] - xd[0]) * iw,
                y: box.top + m.top + (1 - (yv - yd[0]) / (yd[1] - yd[0])) * ih
            });
        };
        const dragPath = async (from, to, steps = 24) => {
            await page.mouse.move(from.x, from.y);
            await page.mouse.down();
            for (let i = 1; i <= steps; i++) {
                await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
                await page.waitForTimeout(8);
            }
            await page.mouse.up();
            await page.waitForTimeout(80);
        };

        // Scatter: the 5 seeded points are read-only; created points are not.
        const at = await frameOf('seed', {
            m: { top: 16, right: 16, bottom: 32, left: 40 }, w: 400, h: 300, xd: [0, 10], yd: [0, 10]
        });
        const seed = await rowsOf('seed');
        const lockedPE = await page.$$eval('#seed .chart svg circle',
            (cs) => cs.slice(0, 5).every((c) => (c.style.pointerEvents || c.getAttribute('pointer-events')) === 'none'));
        check('lock: seeded marks are pointer-transparent', lockedPE);

        await page.mouse.click(at(8, 8).x, at(8, 8).y);       // plane click -> create
        await page.waitForTimeout(100);
        let rows = await rowsOf('seed');
        check('lock: a click still creates a free row', rows.length === 6, `${rows.length} rows`);
        check('lock: the created row takes the schema default', rows[5].source === 'yours');

        await dragPath(at(rows[5].x, rows[5].y), at(3, 8));    // your point moves
        rows = await rowsOf('seed');
        check('lock: a free row drags', Math.abs(rows[5].x - 3) < 0.5 && Math.abs(rows[5].y - 8) < 0.5);

        await dragPath(at(seed[0].x, seed[0].y), at(9, 1));    // a locked point does not
        rows = await rowsOf('seed');
        check('lock: a drag on a locked row leaves it unchanged',
            JSON.stringify(rows.slice(0, 5)) === JSON.stringify(seed), JSON.stringify(rows.slice(0, 5)));

        // You-draw-it: draw the free years, then sweep back over the locked record.
        const ny = await frameOf('you-draw-it', {
            m: { top: 20, right: 24, bottom: 32, left: 56 }, w: 560, h: 340, xd: [1968, 2016], yd: [0, 60000]
        });
        const record = await rowsOf('you-draw-it');
        check('lock: the record seeds 1968-1990', record.length === 23 && record[22].year === 1990);

        await dragPath(ny(1991, 20000), ny(2016, 20000), 40);
        let drawn = await rowsOf('you-draw-it');
        const mine = drawn.filter((d) => d.year > 1990);
        check('lock: a drag beside a locked line DRAWS (it never grabs it)', mine.length >= 20, `${mine.length} drawn`);
        check('lock: the drawn years took the swept value',
            mine.every((d) => Math.abs(d.deaths - 20000) < 3000));
        check('lock: the record survived the draw',
            JSON.stringify(drawn.slice(0, 23)) === JSON.stringify(record));

        // A stroke back across the record: the locked rows repair, the free rows
        // the SAME stroke crossed still take the paint (a lock repairs, not rejects).
        await dragPath(ny(2010, 55000), ny(1970, 55000), 40);
        drawn = await rowsOf('you-draw-it');
        check('lock: sweeping back over the record leaves it intact',
            JSON.stringify(drawn.slice(0, 23)) === JSON.stringify(record));
        const repainted = drawn.filter((d) => d.year >= 1991 && d.year <= 2010);
        check('lock: the free years in that same stroke were repainted',
            repainted.length > 0 && repainted.every((d) => Math.abs(d.deaths - 55000) < 3000));

        // ---- A gesture ends where it ends (/editing/lock, reusing both charts) ---
        // The stuck-gesture class of bug: a stroke that is never retired stays live,
        // and the next pointermove over the chart resumes editing with no button
        // held. Two ways in, one per pick mode — both invisible to typecheck and to
        // check:warnings, because the page renders perfectly either way.
        console.log('\nA gesture ends where it ends (/editing/lock)');

        // PLANE (sweep): release outside the chart. The plane's pointer capture was
        // dropped by the first commit's re-render — `plane.raise()` is an
        // appendChild, and moving a node releases its capture — so the off-chart
        // `pointerup` never reached it. Now the whole drag is tracked on the window.
        const ydiBox = await page.locator('#you-draw-it .chart svg').boundingBox();
        await page.mouse.move(ny(2000, 30000).x, ny(2000, 30000).y);
        await page.mouse.down();
        await page.mouse.move(ny(2010, 30000).x, ny(2010, 30000).y);
        await page.mouse.move(ydiBox.x + ydiBox.width / 2, ydiBox.y + ydiBox.height + 120);
        await page.mouse.up();
        await page.waitForTimeout(80);
        const offChartRelease = await rowsOf('you-draw-it');
        await page.mouse.move(ny(1995, 10000).x, ny(1995, 10000).y);
        await page.mouse.move(ny(2015, 50000).x, ny(2015, 50000).y);
        await page.waitForTimeout(80);
        check('gesture: released off-chart, a re-entering pointer paints nothing',
            JSON.stringify(await rowsOf('you-draw-it')) === JSON.stringify(offChartRelease));

        // DIRECT (d3.drag): no release at all — the pointer left the browser window
        // and was let go there, so `mouseup` never arrives. d3 keeps its window
        // listeners, so the next mousemove over the page resumes the drag. A move
        // reporting `buttons === 0` is the tell; dispatch one by hand, since
        // Playwright's mouse cannot leave the viewport.
        /** @param {{x: number, y: number}} pt */
        const phantomMove = (pt) => page.evaluate(([x, y]) => window.dispatchEvent(
            new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 0, bubbles: true, view: window })
        ), [pt.x, pt.y]);
        // Back to the scatter above — frameOf captures the box as it scrolls, so the
        // mapper has to be re-derived rather than reusing `at`.
        const at2 = await frameOf('seed', {
            m: { top: 16, right: 16, bottom: 32, left: 40 }, w: 400, h: 300, xd: [0, 10], yd: [0, 10]
        });
        const free = (await rowsOf('seed'))[5];                   // the free row created above
        await page.mouse.move(at2(free.x, free.y).x, at2(free.x, free.y).y);
        await page.mouse.down();
        await page.mouse.move(at2(5, 5).x, at2(5, 5).y);
        await phantomMove(at2(2, 2));                             // the missed release
        const strandedRows = await rowsOf('seed');
        await phantomMove(at2(9, 2));
        await phantomMove(at2(2, 9));
        await page.waitForTimeout(80);
        check('gesture: a move with no button held retires the stranded drag',
            JSON.stringify(await rowsOf('seed')) === JSON.stringify(strandedRows));
        await page.mouse.up();
        // …and the next real drag still works, so retiring it did not wedge d3.
        await dragPath(at2(strandedRows[5].x, strandedRows[5].y), at2(7, 3));
        const resumed = (await rowsOf('seed'))[5];
        check('gesture: the next drag after a stranded one still edits',
            Math.abs(resumed.x - 7) < 0.5 && Math.abs(resumed.y - 3) < 0.5, JSON.stringify(resumed));

        // ---- Line authoring: anchor + newSeries (/marks/line) ----------------
        // The series-aware creators, driven by real gestures (mount-only checks
        // never fired these). anchor = click one point onto the nearest line;
        // newSeries = dblclick a whole seeded line. Both mint via the shared core.
        console.log('\nLine authoring: anchor + newSeries (/marks/line)');
        await open('/marks/line', '#connected-scatter .chart svg');

        const csAt = await frameOf('connected-scatter', {
            m: { top: 14, right: 14, bottom: 26, left: 30 }, w: 420, h: 300, xd: [0, 100], yd: [0, 100]
        });
        const csBefore = await rowsOf('connected-scatter');
        check('line.anchor: the path seeds 4 points', csBefore.length === 4, `${csBefore.length} rows`);
        await page.mouse.click(csAt(60, 55).x, csAt(60, 55).y);   // click near the line -> anchor
        await page.waitForTimeout(120);
        const csAfter = await rowsOf('connected-scatter');
        check('line.anchor: a click appends one anchor', csAfter.length === 5, `${csAfter.length} rows`);
        check('line.anchor: the anchor joins the nearest series (s=0)', csAfter[4].s === 0,
            JSON.stringify(csAfter[4]));
        check('line.anchor: the anchor lands at the pointer (inverse of encode)',
            Math.abs(csAfter[4].x - 60) < 3 && Math.abs(csAfter[4].y - 55) < 3,
            `${csAfter[4].x}, ${csAfter[4].y}`);

        const nsAt = await frameOf('samples', {
            m: { top: 14, right: 14, bottom: 26, left: 30 }, w: 420, h: 300, xd: [0, 10], yd: [0, 100]
        });
        const nsBefore = await rowsOf('samples');
        check('line.newSeries: starts empty', nsBefore.length === 0, `${nsBefore.length} rows`);
        await page.mouse.dblclick(nsAt(5, 50).x, nsAt(5, 50).y);  // dblclick -> seed a whole line
        await page.waitForTimeout(140);
        const nsAfter = await rowsOf('samples');
        check('line.newSeries: a dblclick seeds 6 samples', nsAfter.length === 6, `${nsAfter.length} rows`);
        check('line.newSeries: the seeded line is flat at the clicked value',
            nsAfter.length === 6 && nsAfter.every((d) => Math.abs(d.y - 50) < 5),
            JSON.stringify(nsAfter.map((d) => d.y)));

        // ---- Composite create (/marks/composite) -----------------------------
        // Creation is mark-agnostic: create on ONE part of a glyph appends ONE row,
        // and every part re-derives it — a whole lollipop appears from a dblclick.
        // The "one row, not one per part" assertion proves the whole-dataset-edit-on-
        // -exactly-one-mark invariant end to end.
        console.log('\nComposite create (/marks/composite)');
        await open('/marks/composite', '#creating .chart svg');
        const glyphAt = await frameOf('creating', {
            m: { top: 14, right: 14, bottom: 26, left: 30 }, w: 380, h: 260, xd: [0, 100], yd: [0, 100]
        });
        const glyphBefore = await rowsOf('creating');
        check('composite.create: three glyphs to start', glyphBefore.length === 3, `${glyphBefore.length} rows`);
        await page.mouse.dblclick(glyphAt(40, 50).x, glyphAt(40, 50).y);   // dblclick -> one lollipop
        await page.waitForTimeout(140);
        const glyphAfter = await rowsOf('creating');
        check('composite.create: a dblclick appends ONE row (not one per part)',
            glyphAfter.length === 4, `${glyphAfter.length} rows`);
        check('composite.create: the new glyph lands at the pointer',
            glyphAfter.length === 4 && Math.abs(glyphAfter[3].x - 40) < 3 && Math.abs(glyphAfter[3].value - 50) < 3,
            JSON.stringify(glyphAfter[3]));

        // ---- Composite BOX mode (/marks/composite) ---------------------------
        // A part stating a `frame:` channel turns the composite into a per-datum
        // box, and the box is a real feature drawing an INVISIBLE hit circle under
        // every part. Two things only a real gesture proves:
        //   1. An edit on the composite's own `size` is grabbable THROUGH a part
        //      that carries no edit of its own. The outer disc is pointer-transparent
        //      (the engine's rule for a mark with no direct-pick edit), so the drag
        //      falls through to the box beneath it. Before the box drew nodes, that
        //      edit had nothing to grab and was silently stripped.
        //   2. A part that DOES carry an edit is drawn above the box and still wins
        //      the pick, so the inner disc writes `share` and leaves `weight` alone.
        //      Losing that would make every glyph part un-grabbable at once.
        console.log('\nComposite box mode: grab the glyph vs. grab a part (/marks/composite)');
        await open('/marks/composite', '#scaling .chart svg circle.mark:not([data-hit])');
        const pipChart = page.locator('#scaling .chart').first();
        await pipChart.locator('svg circle.mark:not([data-hit])').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const pipData = () => pipChart.locator(':scope > div').first().evaluate((e) => e.getData());
        // The renderer joins by SHAPE, so all three outer discs precede all three
        // inner ones — index tells you nothing about which pip a circle belongs to.
        // Take the FIRST pip's pair by concentricity instead, and re-read it after
        // each gesture (a resize moves the geometry).
        const pipPair = async () => {
            const cs = await pipChart.locator('svg circle.mark:not([data-hit])').evaluateAll((els) =>
                els.map((c) => {
                    const r = c.getBoundingClientRect();
                    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, r: Math.min(r.width, r.height) / 2 };
                }));
            const same = cs.filter((c) => Math.abs(c.cx - cs[0].cx) < 2);
            return {
                outer: same.reduce((a, b) => (a.r >= b.r ? a : b)),
                inner: same.reduce((a, b) => (a.r <= b.r ? a : b)),
            };
        };
        const { outer, inner } = await pipPair();
        check('composite box: the outer disc is the box, the inner one a fraction of it',
            outer.r > inner.r, `outer r ${outer.r}, inner r ${inner.r}`);
        // Grab the RING — outer disc, clear of the inner one — and drag outward.
        const ringY = outer.cy + (inner.r + outer.r) / 2;
        const pipBefore = (await pipData())[0];
        await mouseDrag(outer.cx, ringY, outer.cx, outer.cy + outer.r * 1.6);
        const pipGrown = (await pipData())[0];
        check('composite box: dragging an inert part resizes the GLYPH (falls through to the box)',
            pipGrown.weight > pipBefore.weight + 1, `weight ${pipBefore.weight} -> ${pipGrown.weight}`);
        check('composite box: resizing the glyph leaves the inner part’s field alone',
            Math.abs(pipGrown.share - pipBefore.share) < 0.02,
            `share ${pipBefore.share} -> ${pipGrown.share}`);
        // Now the inner disc, which has its own edit: it must win the pick.
        const inner2 = (await pipPair()).inner;
        const shareBefore = (await pipData())[0];
        await mouseDrag(inner2.cx, inner2.cy, inner2.cx, inner2.cy - 40);
        const shareAfter = (await pipData())[0];
        check('composite box: a part with its own edit still wins the pick (share rises)',
            shareAfter.share > shareBefore.share + 0.02,
            `share ${shareBefore.share} -> ${shareAfter.share}`);
        check('composite box: that drag does not resize the glyph',
            Math.abs(shareAfter.weight - shareBefore.weight) < 0.5,
            `weight ${shareBefore.weight} -> ${shareAfter.weight}`);

        // ---- guides.remaining (/guides) --------------------------------------
        // A GUIDE views chart STATE: it is derived from the rows, re-derives every
        // render, and writes nothing. This is the one check that proves all three —
        // the count has to MOVE when a bar does (derived, live), while the dataset
        // shows the drag landed on the bar and nowhere else (read-only).
        //
        // It also pins the "read the target from the constraint" behaviour: the
        // example passes no `total`, so a wrong reading would render no guide at all.
        console.log('\nguides.remaining (/guides)');
        await open('/guides', '#remaining .chart svg rect.mark');
        const remText = () => page.$$eval('#remaining .chart svg text',
            (ts) => ts.map((t) => t.textContent || '').find((t) => /left$/.test(t)) || '');
        const remData = () => page.$eval('#remaining .chart > div', (el) => el.getData());

        const remBefore = await remText();
        check('remaining: the guide draws, so the target came off the maintainSum constraint',
            /^\d+(\.\d+)? points? left$/.test(remBefore), `text ${JSON.stringify(remBefore)}`);

        const remSumBefore = (await remData()).reduce((t, d) => t + d.y, 0);
        const remBar0 = await centreOf(page.locator('#remaining .chart svg rect.mark').first());
        // Drag the first bar DOWN — its value falls, so more of the budget is free.
        await mouseDrag(remBar0.x, remBar0.y, remBar0.x, remBar0.y + 50);
        const remAfter = await remText();
        const remRowsAfter = await remData();
        const remSumAfter = remRowsAfter.reduce((t, d) => t + d.y, 0);

        const remNumOf = (/** @type {string} */ t) => parseFloat(t);
        check('remaining: dragging a bar down raises the count left',
            remNumOf(remAfter) > remNumOf(remBefore) + 0.5,
            `${JSON.stringify(remBefore)} -> ${JSON.stringify(remAfter)}`);
        check('remaining: the count equals the budget minus what is placed',
            Math.abs(remNumOf(remAfter) - (100 - remSumAfter)) < 0.51,
            `left ${remNumOf(remAfter)}, placed ${remSumAfter.toFixed(2)}`);
        check('remaining: the guide wrote nothing — only the dragged bar changed',
            remSumAfter < remSumBefore - 0.5 && remRowsAfter.every((d) => !('remaining' in d)),
            `sum ${remSumBefore.toFixed(2)} -> ${remSumAfter.toFixed(2)}`);

        // ---- the `legends` spec key (/marks/legend) --------------------------
        // The counterpart to `axes`: an IMPLICIT layer that desugars into legend
        // marks. It has to both draw AND reserve space, and reserving space is the
        // one thing in this library that changes the plot's size — so the check is
        // that the swatches exist and the bars were actually squeezed for them.
        console.log('\nThe legends spec key (/marks/legend)');
        await open('/marks/legend', '#legends-key .chart svg');
        const lkChart = page.locator('#legends-key .chart').first();
        const lkSwatches = await lkChart.locator('svg rect').count();
        const lkTexts = await lkChart.locator('svg text').count();
        check('legends: true injects a legend with no legend mark composed',
            lkSwatches > 3 && lkTexts > 3, `${lkSwatches} rects, ${lkTexts} texts`);
        // The reserved band must actually shrink the plot: the rightmost bar's right
        // edge has to stop short of the chart's own width.
        const lkFit = await lkChart.locator('svg').evaluate((svg) => {
            const w = +svg.getAttribute('width');
            let right = 0;
            for (const r of svg.querySelectorAll('rect.mark')) {
                right = Math.max(right, +r.getAttribute('x') + +r.getAttribute('width'));
            }
            return { w, right };
        });
        check('legends: the injected legend reserves space (bars stop short of the edge)',
            lkFit.right > 0 && lkFit.right < lkFit.w - 40, `bars end at ${lkFit.right} of ${lkFit.w}`);

        // ---- guide: { track } — a handle's declared travel range (/marks/face) --
        // The track is the SAME descriptor the edit inverts the pointer through
        // (node.dm), drawn. So the check is not "a dashed line exists" but "the
        // handle actually moves along it": drag to each end of the drawn segment and
        // the value must hit the domain's ends.
        console.log('\nHandle track guide (/marks/face)');
        await open('/marks/face', '#track .chart svg');
        const trackChart = page.locator('#track .chart').first();
        const trackRows = () => trackChart.locator(':scope > div').first().evaluate((e) => e.getData());
        // Guide nodes are pointer-transparent lines carrying the guide dash. Both
        // brows carry the same declared travel, so both draw one.
        const trackLines = await trackChart.locator('svg line[stroke-dasharray="3 3"]').count();
        check('track: guide draws a segment per bound handle', trackLines >= 2, `${trackLines} tracks`);
        // The track's own on-screen box, rather than re-deriving the plot translate.
        // Scroll first: boundingBox() is viewport-relative, and this section sits far
        // down the page, so an unscrolled measurement aims the pointer off-screen.
        const trackLine = trackChart.locator('svg line[stroke-dasharray="3 3"]').first();
        await trackLine.scrollIntoViewIfNeeded();
        const trackBox = await trackLine.boundingBox();
        const tBefore = await trackRows();
        // Grab the brow itself (it sits at its current value on the track, seeded
        // mid-range) and drag PAST the track's top end. The whole claim of the guide
        // is that the drawn segment IS the mapping — so overshooting it must land on
        // the domain's end exactly, not somewhere beyond it.
        const brow = await trackChart.locator('svg line.mark').first().boundingBox();
        await mouseDrag(
            brow.x + brow.width / 2, brow.y + brow.height / 2,
            trackBox.x + trackBox.width / 2, trackBox.y - 40);
        const tEnd = await trackRows();
        check('track: dragging past the drawn end clamps to the domain end',
            Math.abs(tEnd[0].brow - 1) < 1e-6,
            `brow ${tBefore[0].brow} -> ${tEnd[0].brow}`);

        // ---- Face create + unique per day (/marks/face) ----------------------
        // Create on an ordinal (band) x × numeric y: click an empty day to add a
        // face; unique({ field:'day' }) rejects a create in an occupied day. The x
        // axis is a BAND, so band centres are computed directly (frameOf is linear).
        console.log('\nFace create + unique per day (/marks/face)');
        await open('/marks/face', '#creating .chart svg');
        await page.locator('#creating .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const faceBox = await page.$eval('#creating .chart svg', (svg) => {
            const r = svg.getBoundingClientRect();
            return { left: r.left, top: r.top };
        });
        const fm = { top: 16, right: 20, bottom: 32, left: 34 };
        const fw = 560, fh = 300, days = 7;
        const fiw = fw - fm.left - fm.right, fih = fh - fm.top - fm.bottom;
        // Band centre for day index i (padding-agnostic); mood is linear on y in [0,1].
        const dayAt = (i, mood) => ({
            x: faceBox.left + fm.left + (i + 0.5) / days * fiw,
            y: faceBox.top + fm.top + (1 - mood) * fih,
        });
        const faceRows = () => page.$eval('#creating .chart > div', (el) => el.getData());
        const fBefore = await faceRows();
        check('face.create: three days filled to start', fBefore.length === 3, `${fBefore.length} rows`);

        const sun = dayAt(6, 0.6);   // Sun (index 6) is empty
        await page.mouse.click(sun.x, sun.y);
        await page.waitForTimeout(140);
        let fAfter = await faceRows();
        check('face.create: clicking an empty day adds one face', fAfter.length === 4, `${fAfter.length} rows`);
        check('face.create: the new face lands on the clicked day (band invert)',
            !!fAfter[3] && fAfter[3].day === 'Sun', JSON.stringify(fAfter[3]));

        const mon = dayAt(0, 0.3);   // Mon (index 0) is already filled (mood 0.7); click its empty lower area
        await page.mouse.click(mon.x, mon.y);
        await page.waitForTimeout(140);
        fAfter = await faceRows();
        check('face.unique: a create in an occupied day is rejected', fAfter.length === 4, `${fAfter.length} rows`);
        const monRows = fAfter.filter((d) => d.day === 'Mon');
        check('face.unique: Monday still holds exactly one face at its original mood',
            monRows.length === 1 && Math.abs(monRows[0].mood - 0.7) < 0.01, JSON.stringify(monRows));

        // ---- Derived fn channel (/concepts) ----------------------------------
        // A derived channel ({ fn }) is computed per datum in visual space and is
        // read-only: the edit lives on the source field (x), and the fill must
        // re-derive on the committed rows every render. Only a real drag across the
        // threshold proves the recompute path — a static render can't.
        console.log('\nDerived fn channel (/concepts)');
        await open('/concepts', '#derived .chart svg circle');
        const fnAt = await frameOf('derived', {
            m: { top: 16, right: 16, bottom: 32, left: 40 }, w: 420, h: 260, xd: [0, 100], yd: [0, 100]
        });
        const fnRows = () => page.$eval('#derived .chart > div', (el) => el.getData());
        const fnFill = () => page.$eval('#derived .chart svg circle',
            (c) => (c.getAttribute('fill') || c.style.fill || '').toLowerCase());
        check('fn: row 0 starts below the threshold and derives the blue fill', (await fnFill()) === '#2563eb');
        let fr = await fnRows();
        await dragPath(fnAt(fr[0].x, fr[0].y), fnAt(85, fr[0].y));
        fr = await fnRows();
        check('fn: the drag wrote the source field across the threshold', fr[0].x > 50, `x=${fr[0].x}`);
        check('fn: the fill re-derived to the above-threshold red', (await fnFill()) === '#dc2626');
        await dragPath(fnAt(fr[0].x, fr[0].y), fnAt(20, fr[0].y));
        check('fn: dragging back below re-derives the original blue', (await fnFill()) === '#2563eb');

        // ---- Arc: the `value` magnitude channel + boundary drag --------------
        // The magnitude channel is `value` (not `angle` — that means rotation
        // everywhere else), and the mark takes `edits: [...]` like every other mark.
        // Both are load-bearing renames: if either failed to land, the pie draws
        // with no slices or the handles never appear, so assert the geometry.
        console.log('\nArc: theta channel + edge drag (/marks/arc)');
        await open('/marks/arc', '#edit svg path');

        const arcSvg = page.locator('#edit svg').first();
        const sliceCount = await arcSvg.locator('path').count();
        check('arc: theta channel drives slices', sliceCount >= 3, `${sliceCount} slice paths`);
        const handleCount = await arcSvg.locator('circle').count();
        check('arc: edits:[edit.stack.edge()] emits boundary handles', handleCount >= 2, `${handleCount} handles`);

        const sharesOf = (s) => page.$eval(`${s} .data-body`, (el) =>
            [...el.textContent.matchAll(/share:\s*(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])));
        const before = await sharesOf('#edit');
        const sumBefore = before.reduce((a, b) => a + b, 0);

        // Drag the first boundary handle AROUND the ring. Two things this has to get
        // right: scroll the chart into view first (the arc sits far down the page, and
        // raw viewport coordinates would land on nothing), and move along the ring
        // rather than straight — the edit reads the pointer's ANGLE about the pivot,
        // so a radial drag is a no-op by design.
        const handle = arcSvg.locator('circle').first();
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        const svgBox = await arcSvg.boundingBox();
        const pivot = { x: svgBox.x + svgBox.width / 2, y: svgBox.y + svgBox.height / 2 };
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const spin = (deg) => {
            const a = (deg * Math.PI) / 180;
            const dx = start.x - pivot.x, dy = start.y - pivot.y;
            return {
                x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
                y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a)
            };
        };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) {
            const p = spin((18 * i) / 12);
            await page.mouse.move(p.x, p.y);
        }
        await page.mouse.up();
        await page.waitForTimeout(150);
        const after = await sharesOf('#edit');
        const sumAfter = after.reduce((a, b) => a + b, 0);
        check('arc: dragging a boundary changes the shares',
            JSON.stringify(before) !== JSON.stringify(after), `${before} -> ${after}`);
        check('arc: the pair-shift holds the total fixed',
            Math.abs(sumAfter - sumBefore) < 0.01, `${sumBefore} -> ${sumAfter}`);

        // ---- A GRID of donuts: one per band category, scoped edge -----------
        // Binding x to a categorical field partitions the dataset into one donut per
        // slot (state) — the face model, one level up. The two things that only prove
        // out under real gestures: the grouping actually splits the rows into separate
        // donuts (not one merged pie), and an edge drag stays SCOPED to the donut it
        // grabbed — dragging IL's boundary must leave NC's shares byte-for-byte alone.
        console.log('\nArc grid: one donut per band category, scoped edge (/marks/arc #grid)');
        await open('/marks/arc', '#grid svg path');
        const gridSvg = page.locator('#grid svg').first();
        const gridSlices = await gridSvg.locator('path').count();
        check('arc grid: a donut per state (>= 9 slices for 3x3)', gridSlices >= 9, `${gridSlices} slice paths`);
        const gridHandles = await gridSvg.locator('circle').count();
        check('arc grid: each donut carries its own boundary handles', gridHandles >= 6, `${gridHandles} handles`);

        const gridEl = '#grid .chart > div';
        const gridRows = () => page.$eval(gridEl, (e) => e.getData());
        const sharesFor = (rows, st) => rows.filter((r) => r.state === st).map((r) => Number(r.share));
        const gBefore = await gridRows();

        // The first circle is an IL boundary (IL is drawn first, leftmost). Spin it
        // about IL's centre — approximated as the left third of the SVG, y-centred
        // (y is unbound, so every donut sits on the vertical midline). The pivot only
        // needs to be close enough to make the drag ANGULAR; NC being untouched is
        // guaranteed by the edit reading the handle's stamped `members`, not the pivot.
        const gHandle = gridSvg.locator('circle').first();
        await gHandle.scrollIntoViewIfNeeded();
        const gHandleBox = await gHandle.boundingBox();
        const gsvgBox = await gridSvg.boundingBox();
        const gPivot = { x: gsvgBox.x + gsvgBox.width / 6, y: gsvgBox.y + gsvgBox.height / 2 };
        const gStart = { x: gHandleBox.x + gHandleBox.width / 2, y: gHandleBox.y + gHandleBox.height / 2 };
        const gSpin = (deg) => {
            const a = (deg * Math.PI) / 180;
            const dx = gStart.x - gPivot.x, dy = gStart.y - gPivot.y;
            return { x: gPivot.x + dx * Math.cos(a) - dy * Math.sin(a), y: gPivot.y + dx * Math.sin(a) + dy * Math.cos(a) };
        };
        await page.mouse.move(gStart.x, gStart.y);
        await page.mouse.down();
        for (let i = 1; i <= 12; i++) { const p = gSpin((28 * i) / 12); await page.mouse.move(p.x, p.y); }
        await page.mouse.up();
        await page.waitForTimeout(150);
        const gAfter = await gridRows();

        const ilBefore = sharesFor(gBefore, 'IL'), ilAfter = sharesFor(gAfter, 'IL');
        const ncBefore = sharesFor(gBefore, 'NC'), ncAfter = sharesFor(gAfter, 'NC');
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        check('arc grid: dragging IL rebalances IL', JSON.stringify(ilBefore) !== JSON.stringify(ilAfter), `${ilBefore} -> ${ilAfter}`);
        check('arc grid: IL total held fixed by the pair-shift', Math.abs(sum(ilBefore) - sum(ilAfter)) < 0.01, `${sum(ilBefore)} -> ${sum(ilAfter)}`);
        check('arc grid: NC untouched — edge is scoped per donut', JSON.stringify(ncBefore) === JSON.stringify(ncAfter), `${ncBefore} -> ${ncAfter}`);

        // ---- Slicing a stack: cut / edge / merge ----------------------------
        // The three edit.stack.* gestures, on both marks they serve. What only proves
        // out under real pointer events: a click has to land INSIDE a segment and
        // divide it there, the row it mints has to arrive next to its sibling (a
        // splice, not an append — an appended row would jump to the top of the stack),
        // and each gesture has to hold its group's total to the last decimal. A closed
        // domain also has to run out and REFUSE, which is a no-op — the failure mode
        // being guarded against is a chart that looks fine while minting null rows.
        console.log('\nStack slicing: bar (/marks/bar #slice)');
        await open('/marks/bar', '#slice svg rect.mark');

        const sliceEl = '#slice .chart > div';
        const barStack = () => page.$eval(sliceEl, (e) => e.getData());
        const bandOf = (rows, y) => rows.filter((r) => r.year === y);
        const bandSum = (rows, y) => bandOf(rows, y).reduce((a, r) => a + Number(r.pct), 0);
        const sliceSvg = page.locator('#slice svg').first();

        await page.locator('#slice svg rect.mark').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const stackSeed = await barStack();
        check('stack: seeds one full-height segment per band', stackSeed.length === 2, JSON.stringify(stackSeed.map((r) => r.pct)));
        check('stack: no boundary handles until there is a boundary',
            (await sliceSvg.locator('circle').count()) === 0, 'n=1 -> 0 handles');

        // Cut the first band's segment in half.
        const cutIn = async (nth, frac) => {
            const b = await page.locator('#slice svg rect.mark').nth(nth).boundingBox();
            await page.mouse.click(b.x + b.width / 2, b.y + b.height * frac);
            await page.waitForTimeout(200);
        };
        await cutIn(0, 0.5);
        const cut1 = await barStack();
        check('stack cut: a click inside a segment mints exactly one row',
            cut1.length === stackSeed.length + 1, `${stackSeed.length} -> ${cut1.length}`);
        check('stack cut: the new row lands beside its sibling, not at the end',
            cut1[0].year === '2023' && cut1[1].year === '2023' && cut1[2].year === '2024',
            JSON.stringify(cut1.map((r) => r.year)));
        check('stack cut: the band total is unchanged',
            Math.abs(bandSum(cut1, '2023') - bandSum(stackSeed, '2023')) < 1e-6,
            `${bandSum(stackSeed, '2023')} -> ${bandSum(cut1, '2023')}`);
        check('stack cut: the other band is untouched',
            JSON.stringify(bandOf(cut1, '2024')) === JSON.stringify(bandOf(stackSeed, '2024')), '2024 held');
        check('stack cut: the new row takes a category from the schema domain (not null)',
            cut1[1].asset != null && ['stocks', 'bonds', 'cash', 'gold'].includes(cut1[1].asset),
            `asset=${JSON.stringify(cut1[1].asset)}`);
        check('stack cut: a boundary handle appears for the new division',
            (await sliceSvg.locator('circle').count()) === 1, 'n=2 -> 1 handle');

        // Exhaust the 4-value domain, then confirm the 5th cut is refused.
        for (let k = 0; k < 3; k++) await cutIn(0, 0.5);
        const full = await barStack();
        check('stack cut: each cut takes a distinct category',
            new Set(bandOf(full, '2023').map((r) => r.asset)).size === bandOf(full, '2023').length,
            JSON.stringify(bandOf(full, '2023').map((r) => r.asset)));
        await cutIn(0, 0.5);
        const refused = await barStack();
        check('stack cut: a closed domain refuses once its categories run out',
            refused.length === full.length, `${full.length} rows, still ${refused.length}`);
        check('stack cut: the refusal is a no-op, not a null row',
            refused.every((r) => r.asset != null), 'no null categories');
        check('stack cut: total still exact after four cuts',
            Math.abs(bandSum(refused, '2023') - 100) < 1e-6, `${bandSum(refused, '2023')}`);

        // Drag a boundary: exactly two rows move, the total does not.
        const preDrag = await barStack();
        const bHandle = sliceSvg.locator('circle').first();
        await bHandle.scrollIntoViewIfNeeded();
        const bBox = await bHandle.boundingBox();
        await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2 - i * 4);
        await page.mouse.up();
        await page.waitForTimeout(200);
        const postDrag = await barStack();
        const moved = postDrag.filter((r, i) => Number(r.pct) !== Number(preDrag[i].pct));
        check('stack edge: dragging a boundary moves value', moved.length > 0, `${moved.length} rows changed`);
        check('stack edge: exactly two rows change — the pair it separates',
            moved.length === 2, `${moved.length} rows changed`);
        check('stack edge: the band total is held fixed',
            Math.abs(bandSum(postDrag, '2023') - bandSum(preDrag, '2023')) < 1e-6,
            `${bandSum(preDrag, '2023')} -> ${bandSum(postDrag, '2023')}`);
        check('stack edge: the other band is untouched',
            JSON.stringify(bandOf(postDrag, '2024')) === JSON.stringify(bandOf(preDrag, '2024')), '2024 held');

        // Merge: the inverse of a cut, and the only node-level dblclick in the library.
        const preMerge = await barStack();
        const stk_mBox = await sliceSvg.locator('circle').first().boundingBox();
        await page.mouse.dblclick(stk_mBox.x + stk_mBox.width / 2, stk_mBox.y + stk_mBox.height / 2);
        await page.waitForTimeout(250);
        const postMerge = await barStack();
        check('stack merge: a dblclick on a boundary drops exactly one row',
            postMerge.length === preMerge.length - 1, `${preMerge.length} -> ${postMerge.length}`);
        check('stack merge: the band total is held fixed',
            Math.abs(bandSum(postMerge, '2023') - bandSum(preMerge, '2023')) < 1e-6,
            `${bandSum(preMerge, '2023')} -> ${bandSum(postMerge, '2023')}`);

        // Undo has to round-trip a cut, which writes the schema AND the rows.
        await page.$eval(sliceEl, (e) => e.undo());
        await page.waitForTimeout(150);
        const stk_undone = await barStack();
        check('stack: undo round-trips a merge',
            stk_undone.length === preMerge.length, `${postMerge.length} -> ${stk_undone.length}`);

        // ---- An OPEN domain grows instead of running out --------------------
        console.log('\nStack slicing: open domain (/marks/bar #slice)');
        // The open-domain chart is the section's SECOND chart (the closed one above it
        // is what the block before this drove).
        const openRows = () => page.$$eval('#slice .chart > div', (els) => els[1].getData());
        const openSvg = page.locator('#slice svg').nth(1);
        await openSvg.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const oSeed = await openRows();
        for (let k = 0; k < 3; k++) {
            const b = await openSvg.locator('rect.mark').first().boundingBox();
            await page.mouse.click(b.x + b.width / 2, b.y + b.height * 0.5);
            await page.waitForTimeout(200);
        }
        const oAfter = await openRows();
        check('stack cut (open): every cut mints a row — the domain never runs out',
            oAfter.length === oSeed.length + 3, `${oSeed.length} -> ${oAfter.length}`);
        check('stack cut (open): each new row gets a distinct minted category',
            new Set(oAfter.map((r) => r.holding)).size === oAfter.length,
            JSON.stringify(oAfter.map((r) => r.holding)));
        check('stack cut (open): the minted names use the `label` option',
            oAfter.filter((r) => String(r.holding).startsWith('Holding ')).length === 3,
            JSON.stringify(oAfter.map((r) => r.holding)));
        check('stack cut (open): the total is held across every cut',
            Math.abs(oAfter.reduce((a, r) => a + Number(r.pct), 0) - 100) < 1e-6,
            `${oAfter.reduce((a, r) => a + Number(r.pct), 0)}`);

        // ---- The same three gestures on a PIE -------------------------------
        // The point of the whole exercise: one edit family, two marks. A pie inverts
        // the pointer through an ANGLE rather than an axis, so a cut has to land by
        // direction from the centre and a merge has to work on a rim handle.
        console.log('\nStack slicing: pie (/marks/arc #slice)');
        await open('/marks/arc', '#slice svg path');
        const pieEl = '#slice .chart > div';
        const pieRows = () => page.$eval(pieEl, (e) => e.getData());
        const pieTotal = (rows) => rows.reduce((a, r) => a + Number(r.share), 0);
        const pieSvg = page.locator('#slice svg').first();
        await pieSvg.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const pBox = await pieSvg.boundingBox();
        const pc = { x: pBox.x + pBox.width / 2, y: pBox.y + pBox.height / 2 };

        const pSeed = await pieRows();
        check('pie stack: seeds one full circle', pSeed.length === 1, `${pSeed.length} slice`);
        for (let k = 0; k < 4; k++) {
            const ang = ((-60 - k * 25) * Math.PI) / 180;
            await page.mouse.click(pc.x + Math.cos(ang) * 55, pc.y + Math.sin(ang) * 55);
            await page.waitForTimeout(220);
        }
        const pCut = await pieRows();
        check('pie stack cut: a click inside a slice divides it',
            pCut.length === 5, `${pSeed.length} -> ${pCut.length}`);
        check('pie stack cut: categories come from the declared domain',
            new Set(pCut.map((r) => r.category)).size === 5,
            JSON.stringify(pCut.map((r) => r.category)));
        check('pie stack cut: the pie total is held across every cut',
            Math.abs(pieTotal(pCut) - pieTotal(pSeed)) < 1e-6, `${pieTotal(pSeed)} -> ${pieTotal(pCut)}`);
        check('pie stack: n slices give n-1 handles',
            (await pieSvg.locator('circle').count()) === 4, `${await pieSvg.locator('circle').count()} handles`);

        // Merge a pie boundary — the dblclick has to reach a rim handle.
        const preP = await pieRows();
        const pHandle = await pieSvg.locator('circle').first().boundingBox();
        await page.mouse.dblclick(pHandle.x + pHandle.width / 2, pHandle.y + pHandle.height / 2);
        await page.waitForTimeout(250);
        const postP = await pieRows();
        check('pie stack merge: a dblclick on a rim handle drops one slice',
            postP.length === preP.length - 1, `${preP.length} -> ${postP.length}`);
        check('pie stack merge: the total is held fixed',
            Math.abs(pieTotal(postP) - pieTotal(preP)) < 1e-6, `${pieTotal(preP)} -> ${pieTotal(postP)}`);

        // ---- Grouped bars and waffles (xOffset) ---------------------------
        // A nested category splits each band into sub-bands. The geometry is the
        // whole feature, and a drag has to land on the sub-band the pointer is over:
        // only real pointer events prove a press on the third bar of a group writes
        // that row and no other.
        console.log('\nGrouped bars + waffles (xOffset)');
        await open('/marks/bar', '#grouped svg rect.mark');
        // The section holds two examples; drive the first chart.
        const groupedEl = '#grouped .chart > div';
        const groupedBars = await page.$eval(groupedEl, (e) => [...e.querySelectorAll('svg rect.mark')].map((r) => ({
            x: +r.getAttribute('x'), w: +r.getAttribute('width'),
        })).sort((a, b) => a.x - b.x));
        check('grouped bars: 3 regions × 3 years = 9 bars', groupedBars.length === 9, `got ${groupedBars.length}`);
        check('grouped bars: sub-bands of one region abut',
            groupedBars.length === 9
            && Math.abs(groupedBars[0].x + groupedBars[0].w - groupedBars[1].x) < 0.5
            && Math.abs(groupedBars[1].x + groupedBars[1].w - groupedBars[2].x) < 0.5
            && groupedBars[3].x - (groupedBars[2].x + groupedBars[2].w) > 1,
            JSON.stringify(groupedBars.slice(0, 4)));
        const groupedRows = () => page.$eval(groupedEl, (e) => e.getData());
        const beforeGrouped = await groupedRows();
        await page.locator(groupedEl).first().scrollIntoViewIfNeeded();
        const gBoxes = await page.$eval(groupedEl, (e) => [...e.querySelectorAll('svg rect.mark')].map((r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, row: r.__data__ && r.__data__.data };
        }));
        const north24 = gBoxes.find((b) => b.row && b.row.region === 'North' && b.row.year === '2024');
        await page.mouse.move(north24.x + north24.w / 2, north24.y + 4);
        await page.mouse.down();
        for (let k = 1; k <= 8; k++) await page.mouse.move(north24.x + north24.w / 2, north24.y + 4 + k * 5);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const afterGrouped = await groupedRows();
        const changed = afterGrouped.filter((d, i) => d.sales !== beforeGrouped[i].sales);
        check('grouped bars: a drag on one sub-band writes that row only',
            changed.length === 1 && changed[0].region === 'North' && changed[0].year === '2024',
            JSON.stringify(changed));

        await open('/marks/waffle', '#grouped svg rect.mark');
        const groupedCells = await page.$$eval('#grouped svg rect.mark', (rs) => rs
            .map((r) => r.__data__ && r.__data__.data && r.__data__.grid)
            .filter(Boolean)
            .map((g) => g.bandStart));
        check('grouped waffle: 3 sports × 2 sexes = 6 blocks side by side',
            new Set(groupedCells.map((v) => Math.round(v))).size === 6,
            `${new Set(groupedCells.map((v) => Math.round(v))).size} distinct block starts`);

        // ---- Keyboard editing + undo/redo ---------------------------------
        // Both are gesture-shaped and only prove out under real input: the nudge has
        // to step from where the datum's VALUE is (a bar's node centre is halfway up
        // the bar, so anchoring there teleports it), and undo has to treat a whole
        // drag as one entry however many commits it made along the way.
        console.log('\nKeyboard editing + undo (/marks/bar)');
        await open('/marks/bar', '#editing svg rect.mark');

        // The section holds several examples; drive the first chart.
        const barEl = '#editing .chart > div';
        const barRows = () => page.$eval(barEl, (e) => e.getData());
        const barY = async (i) => (await barRows())[i].y;
        const history = () => page.$eval(barEl, (e) => ({ undo: e.canUndo(), redo: e.canRedo() }));

        const bar0 = page.locator('#editing svg rect.mark').first();
        await bar0.scrollIntoViewIfNeeded();
        check('keyboard: an editable mark is focusable',
            (await bar0.getAttribute('tabindex')) === '0');
        check('keyboard: history starts empty', (await history()).undo === false);

        const y0 = await barY(0);
        await bar0.focus();
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        const y1 = await barY(0);
        // Domain [0,100], so a 1% step is one unit per press — and it goes UP.
        check('keyboard: ArrowUp steps the value up from its current value',
            Math.abs(y1 - (y0 + 3)) < 0.01, `${y0} -> ${y1}`);

        await page.keyboard.down('Shift');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(100);
        check('keyboard: Shift takes a coarse step',
            Math.abs((await barY(0)) - (y1 - 10)) < 0.01, `${y1} -> ${await barY(0)}`);

        // Each press is its own undo entry; the others are untouched.
        await page.$eval(barEl, (e) => e.undo());
        check('undo: steps back one keypress', Math.abs((await barY(0)) - y1) < 0.01);
        for (let i = 0; i < 3; i++) await page.$eval(barEl, (e) => e.undo());
        check('undo: unwinds to the seeded value', Math.abs((await barY(0)) - y0) < 0.01,
            `${await barY(0)} vs ${y0}`);
        check('undo: bottoms out', (await history()).undo === false);
        check('redo: available after undo', (await history()).redo === true);
        await page.$eval(barEl, (e) => e.redo());
        check('redo: replays the keypress', Math.abs((await barY(0)) - (y0 + 1)) < 0.01);

        // A DRAG is one entry, however many commits it made.
        const dragBox = await bar0.boundingBox();
        const beforeDrag = await barRows();
        await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 6);
        await page.mouse.down();
        for (let k = 1; k <= 12; k++) await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + 6 + k * 5);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const afterDrag = await barRows();
        check('drag: moved the value', afterDrag[0].y !== beforeDrag[0].y,
            `${beforeDrag[0].y} -> ${afterDrag[0].y}`);
        await page.$eval(barEl, (e) => e.undo());
        const undone = await barRows();
        check('undo: a whole drag is ONE entry (not one per pointermove)',
            Math.abs(undone[0].y - beforeDrag[0].y) < 0.01,
            `${afterDrag[0].y} -> ${undone[0].y}, expected ${beforeDrag[0].y}`);

        // ---- A bar emptied to the baseline stays grabbable (SVG overlay) ----
        // A zero-height <rect> takes no pointer events, so dragging a bar to 0 used
        // to strand it: you could never drag it back up. The renderer now lays a
        // transparent min-height hit rect over a collapsed editable bar. Drive it:
        // empty bar A to the baseline, then re-grab AT the baseline and drag up.
        const eBox = await bar0.boundingBox();
        const eColX = eBox.x + eBox.width / 2;
        const eBaseY = eBox.y + eBox.height; // bars grow up from the baseline
        await page.mouse.move(eColX, eBox.y + 6);
        await page.mouse.down();
        for (let k = 1; k <= 12; k++) await page.mouse.move(eColX, eBox.y + 6 + k * ((eBaseY - eBox.y) / 12));
        await page.mouse.move(eColX, eBaseY + 20); // overshoot to pin it at 0
        await page.mouse.up();
        await page.waitForTimeout(150);
        const emptied = (await barRows())[0].y;
        check('empty: bar drags down to (near) zero', emptied <= 1, `y=${emptied}`);
        // The visible rect is now zero-height; only the hit overlay can catch this.
        const hitCount = await page.locator('#editing svg rect.mark-hit').count();
        check('empty: a hit overlay exists over the collapsed bar', hitCount >= 1, `overlays=${hitCount}`);
        await page.mouse.move(eColX, eBaseY - 2); // inside the overlay band, not the 0-area rect
        await page.mouse.down();
        for (let k = 1; k <= 12; k++) await page.mouse.move(eColX, eBaseY - 2 - k * 12);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const regrabbed = (await barRows())[0].y;
        check('empty: the collapsed bar is still grabbable (drags back up)',
            regrabbed > emptied + 5, `${emptied} -> ${regrabbed}`);

        // ---- brushSpan honours a custom edgeInset (/marks/bar #span) -------
        // edgeInset used to be silently dropped by makeEdit (only canonical keys
        // survived), so the brush driver always fell back to its 8px default. The
        // Gantt example passes edgeInset: 10 — a grab 9px inside an edge is an
        // EDGE grab only if the custom inset reached the driver; with the dropped
        // option it classified as body and translated BOTH fields.
        console.log('\nbrushSpan edgeInset (/marks/bar)');
        const spanRows = () => page.$$eval('#span .chart > div', (els) => els[1].getData());
        const ganttBar = page.locator('#span .chart').nth(1).locator('svg rect.mark').first();
        await ganttBar.scrollIntoViewIfNeeded();
        const gBox = await ganttBar.boundingBox();
        const sBefore = await spanRows();
        const gx = gBox.x + gBox.width - 9; // 9px inside the right edge
        const gy = gBox.y + gBox.height / 2;
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        for (let k = 1; k <= 6; k++) await page.mouse.move(gx + k * 5, gy);
        await page.mouse.up();
        await page.waitForTimeout(150);
        const sAfter = await spanRows();
        check('brushSpan: custom edgeInset makes it an edge grab (start untouched)',
            Math.abs(sAfter[0].start - sBefore[0].start) < 0.01,
            `start ${sBefore[0].start} -> ${sAfter[0].start}`);
        check('brushSpan: the grabbed edge resized outward',
            sAfter[0].end > sBefore[0].end + 5,
            `end ${sBefore[0].end} -> ${sAfter[0].end}`);

        // ---- Undo/redo, driven the way a caller would ----------------------
        // The docs page wires real buttons off canUndo()/canRedo(); that wiring is
        // the part an app copies, so drive the buttons rather than the methods.
        console.log('\nUndo / redo buttons (/editing/history)');
        await open('/editing/history', '#undo .chart svg');

        const undoBtn = page.getByRole('button', { name: /Undo/ }).first();
        const redoBtn = page.getByRole('button', { name: /Redo/ }).first();
        await undoBtn.scrollIntoViewIfNeeded();
        check('undo button: starts disabled (nothing to undo)', await undoBtn.isDisabled());

        const histBar = page.locator('#undo svg rect.mark').first();
        const hBox = await histBar.boundingBox();
        const hBefore = await page.$eval('#undo .chart > div', (e) => e.getData());
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + 5);
        await page.mouse.down();
        for (const dy of [20, 40, 60, 80]) await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + 5 + dy);
        await page.mouse.up();
        await page.waitForTimeout(200);
        const hAfter = await page.$eval('#undo .chart > div', (e) => e.getData());
        check('undo button: enabled once there is a gesture to undo', await undoBtn.isEnabled());
        check('undo button: the drag changed the data', hAfter[0].n !== hBefore[0].n,
            `${hBefore[0].n} -> ${hAfter[0].n}`);

        await undoBtn.click();
        await page.waitForTimeout(200);
        const hUndone = await page.$eval('#undo .chart > div', (e) => e.getData());
        check('undo button: one click restores the whole gesture',
            Math.abs(hUndone[0].n - hBefore[0].n) < 0.01, `${hUndone[0].n} vs ${hBefore[0].n}`);
        check('undo button: Redo lights up', await redoBtn.isEnabled());
        await redoBtn.click();
        await page.waitForTimeout(200);
        const hRedone = await page.$eval('#undo .chart > div', (e) => e.getData());
        check('redo button: replays the gesture',
            Math.abs(hRedone[0].n - hAfter[0].n) < 0.01, `${hRedone[0].n} vs ${hAfter[0].n}`);

        // Keyboard on a point: x AND y take arrows, because both carry a drag.
        // `#keyboard` lives on /editing/gestures, not on the history route the
        // undo/redo block above left us on — navigate before reaching for it.
        console.log('\nKeyboard nudging (/editing/gestures)');
        await open('/editing/gestures', '#keyboard svg circle');
        const kbDot = page.locator('#keyboard svg circle').first();
        await kbDot.scrollIntoViewIfNeeded();
        await kbDot.focus();
        const kbFocused = await page.evaluate(() => document.activeElement?.tagName);
        check('keyboard: a point mark takes focus', kbFocused === 'circle', `activeElement=${kbFocused}`);
        const kbRows = () => page.$eval('#keyboard .chart > div', (e) => e.getData());
        const kb0 = (await kbRows())[0].value;
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(150);
        const kb1 = (await kbRows())[0].value;
        check('keyboard: ArrowUp steps y by 1% of the domain',
            Math.abs(kb1 - (kb0 + 1)) < 0.01, `${kb0} -> ${kb1}`);
        const kbx0 = (await kbRows())[0].effort;
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(150);
        const kbx1 = (await kbRows())[0].effort;
        check('keyboard: ArrowRight steps x too (both axes carry a drag)',
            Math.abs(kbx1 - (kbx0 + 1)) < 0.01, `${kbx0} -> ${kbx1}`);

        // ---- Uncertainty band: area span mode + the ordering invariant ------
        // The whole stack composing: a y1/y2 pair fills between the fields, both
        // edges are grabbable, and a dataset invariant holds the edge you grabbed
        // while pushing the other — which only a real drag can show.
        console.log('\nUncertainty band (/marks/area)');
        await open('/marks/area', '#band svg path.mark-line');

        const bandEl = '#band .chart > div';
        const bandRows = () => page.$eval(bandEl, (e) => e.getData());
        const bandHandles = await page.locator('#band svg circle').count();
        check('band: both edges get handles', bandHandles === 8, `${bandHandles} handles for 4 rows x lo/hi`);

        const bandBefore = await bandRows();
        check('band: seeded lo <= hi', bandBefore.every((d) => d.lo <= d.hi));

        // Drag one row's LOW edge up past its high edge.
        const lowEdge = page.locator('#band svg circle').first();
        await lowEdge.scrollIntoViewIfNeeded();
        const lb = await lowEdge.boundingBox();
        await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
        await page.mouse.down();
        await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2 - 150, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const bandAfter = await bandRows();
        check('band: the dragged edge moved', bandAfter[0].lo !== bandBefore[0].lo,
            `${bandBefore[0].lo} -> ${bandAfter[0].lo}`);
        check('band: ordering held (lo <= hi) by carrying the other edge',
            bandAfter[0].lo <= bandAfter[0].hi,
            `lo ${bandAfter[0].lo}, hi ${bandAfter[0].hi}`);
        check('band: ordering left the other rows alone',
            bandAfter[1].lo === bandBefore[1].lo && bandAfter[1].hi === bandBefore[1].hi);

        // One handle is one edge. Both edges live on ONE feature over ONE datum, so
        // an unguarded drag fans to the sibling edge's edit too and snaps the far
        // handle onto the pointer — a small drag that never trips ordering is what
        // tells the two apart.
        const edgeSolo = page.locator('#band svg circle').nth(2); // row 1's low edge
        const eb = await edgeSolo.boundingBox();
        await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
        await page.mouse.down();
        await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2 - 20, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const bandSolo = await bandRows();
        check('band: dragging the low edge moved it', bandSolo[1].lo > bandAfter[1].lo,
            `${bandAfter[1].lo} -> ${bandSolo[1].lo}`);
        check('band: dragging one edge left the OTHER edge of the same row alone',
            bandSolo[1].hi === bandAfter[1].hi,
            `hi ${bandAfter[1].hi} -> ${bandSolo[1].hi}`);

        // handles: 'hit' — invisible but still grabbable (area used to treat false
        // as inert and ignore 'hit'). Opacity 0 circles must still drag.
        console.log('\nArea hit handles (/marks/area #hit)');
        await open('/marks/area', '#hit .chart svg');
        const hitEl = '#hit .chart > div';
        const hitRows = () => page.$eval(hitEl, (e) => e.getData());
        const hitBefore = await hitRows();
        const hitOpacities = await page.$$eval('#hit svg circle', (cs) =>
            cs.map((c) => ({
                opacity: getComputedStyle(c).opacity || c.getAttribute('opacity') || '1',
                fill: c.getAttribute('fill') || getComputedStyle(c).fill,
            })));
        check('hit: handles are present', hitOpacities.length >= 5, `${hitOpacities.length} circles`);
        check('hit: handles are invisible (transparent fill, not opacity:0)',
            hitOpacities.every((o) => o.fill === 'transparent' || o.fill === 'none' || Number(o.opacity) === 0),
            JSON.stringify(hitOpacities));
        const hitHandle = page.locator('#hit svg circle').nth(2);
        await hitHandle.scrollIntoViewIfNeeded();
        const hb = await hitHandle.boundingBox();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 60, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const hitAfter = await hitRows();
        check('hit: invisible handle still writes on drag',
            hitAfter.some((d, i) => d.n !== hitBefore[i].n),
            JSON.stringify({ before: hitBefore.map((d) => d.n), after: hitAfter.map((d) => d.n) }));

        // Chart elements via elicit.elements + ElicitSpec.elements
        console.log('\nChart elements namespace (/marks/axes #elements-ns)');
        await open('/marks/axes', '#elements-ns .chart svg');
        const elErrs = await page.locator('#elements-ns .live-error').allTextContents();
        check('elements: example evaluates', elErrs.length === 0, elErrs.join(' | '));
        const elBars = await page.locator('#elements-ns svg rect:not(.plane)').count();
        check('elements: bar marks render beside element chrome', elBars >= 3, `${elBars} bars`);
        const elNsRows = () => page.$eval('#elements-ns .chart > div', (e) => e.getData());
        const elBefore = await elNsRows();
        const elBar = page.locator('#elements-ns svg rect:not(.plane)').nth(1);
        await elBar.scrollIntoViewIfNeeded();
        const ebb = await elBar.boundingBox();
        // Grab the bar body (mid-height), drag upward to raise n.
        await page.mouse.move(ebb.x + ebb.width / 2, ebb.y + ebb.height / 2);
        await page.mouse.down();
        await page.mouse.move(ebb.x + ebb.width / 2, ebb.y + ebb.height / 2 - 80, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const elAfter = await elNsRows();
        check('elements: dragging a bar still writes data',
            elAfter[1].n !== elBefore[1].n, `${elBefore[1].n} -> ${elAfter[1].n}`);

        // ---- Trend + band: a parametric line and its envelope ---------------
        // A trend is edited through its PARAMETERS, not its position, so nothing
        // here is visible to typecheck: each drag has to solve back to intercept /
        // slope, and both handles live on ONE feature over ONE datum (the
        // arbitration that keeps a drag on one from moving the other).
        // A mark is INERT until an edit names the column a gesture writes. trend and
        // face used to violate that — both attached their own edits unconditionally,
        // so `trend({ edits: [] })` was still fully draggable and nothing in the spec
        // said which columns a drag would set. Only a real pointer can prove the
        // removal: the handles are still DRAWN, so the chart looks identical either
        // way, and typecheck/check:warnings both stay green on the broken version.
        console.log('\nA mark with no edit is inert (/marks/trend)');
        await open('/marks/trend', '#inert .chart svg line');
        const inertChart = page.locator('#inert .chart').first();
        const inertRows = () => inertChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const inertBefore = await inertRows();
        // A ROW HANDLE draws only where a live edit can reach its row (the engine
        // drops `node.rowHandle` otherwise), so a trend with no edit draws its line
        // and no grips: a dot a drag cannot move is an affordance that lies.
        const inertHandles = await inertChart.locator('svg circle').count();
        check('trend (no edit): no handles are drawn', inertHandles === 0, `${inertHandles} circles`);
        // Drag across the line where the intercept handle used to sit: still nothing.
        const inertBox = await inertChart.locator('svg').first().boundingBox();
        if (inertBox) {
            const cx = inertBox.x + inertBox.width / 2, cy = inertBox.y + inertBox.height / 2;
            await page.mouse.move(cx, cy);
            await page.mouse.down();
            await page.mouse.move(cx, cy - 45, { steps: 6 });
            await page.mouse.up();
        }
        await page.waitForTimeout(150);
        const inertAfter = await inertRows();
        check('trend (no edit): dragging the line writes NOTHING',
            JSON.stringify(inertAfter) === JSON.stringify(inertBefore),
            `${JSON.stringify(inertBefore)} -> ${JSON.stringify(inertAfter)}`);

        console.log('\nTrend + band (/marks/trend)');
        await open('/marks/trend', '#twostep .chart svg circle');

        // The staged chart: at stage 0 only the intercept handle is live, so this
        // is also the stage gate under a real pointer.
        const stagedChart = page.locator('#twostep .chart').first();
        const stagedRows = () => stagedChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const trendBefore = await stagedRows();

        // The intercept handle: translate. Slope is HELD.
        const iHandle = stagedChart.locator('svg circle').first();
        await iHandle.scrollIntoViewIfNeeded();
        const ib = await iHandle.boundingBox();
        await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
        await page.mouse.down();
        await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2 - 40, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const afterIntercept = await stagedRows();
        check('trend: dragging the intercept handle moved the intercept',
            afterIntercept[0].intercept !== trendBefore[0].intercept,
            `${trendBefore[0].intercept} -> ${afterIntercept[0].intercept}`);
        check('trend: it HELD the slope',
            Math.abs(afterIntercept[0].slope - trendBefore[0].slope) < 1e-9,
            `slope ${trendBefore[0].slope} -> ${afterIntercept[0].slope}`);

        // The slope handle rotates about the anchor, holding its VALUE — which is
        // the whole point of the pivot, and what the slope edit firing on the
        // intercept handle (an unclaimed `when`) would break. Read it off the
        // unstaged chart, where both handles are live at once.
        const anchorValue = (d) => d.intercept + d.slope * 0;
        const freeChart = page.locator('#twostep .chart').nth(1);
        const freeRows = () => freeChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const freeBefore = await freeRows();
        const sHandle = freeChart.locator('svg circle').nth(1);
        await sHandle.scrollIntoViewIfNeeded();
        const sb = await sHandle.boundingBox();
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2 + 50, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const afterSlope = await freeRows();
        check('trend: dragging the slope handle moved the slope',
            afterSlope[0].slope !== freeBefore[0].slope,
            `${freeBefore[0].slope} -> ${afterSlope[0].slope}`);
        check('trend: it HELD the anchor point',
            Math.abs(anchorValue(afterSlope[0]) - anchorValue(freeBefore[0])) < 1e-9,
            `value at anchor ${anchorValue(freeBefore[0])} -> ${anchorValue(afterSlope[0])}`);

        // A slope grip mounted on the line's END reads the pointer's whole position,
        // so the line rotates instead of sliding one column. Both halves are
        // invisible to typecheck and to check:warnings — the old pinned handle drew
        // and dragged perfectly well, it just couldn't reach past
        // `ySpan / (probe - anchor)`, which on this chart is a slope of 1.
        console.log('\nTrend: the end grips swing the line right round (/marks/trend)');
        await open('/marks/trend', '#grip .chart svg circle');
        const gripChart = page.locator('#grip .chart').first();
        const gripRows = () => gripChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const gripHandles = await gripChart.locator('svg circle').count();
        check('trend: the default grip draws the intercept handle plus TWO end grips',
            gripHandles === 3, `${gripHandles} circles`);

        // The intercept handle sits AT the anchor, so it reports the pivot's column
        // without this test having to re-derive the plot rect from the margins.
        const pivotHandle = gripChart.locator('svg circle').first();
        await pivotHandle.scrollIntoViewIfNeeded();
        const pivotBox = await pivotHandle.boundingBox();
        const pivotX = pivotBox.x + pivotBox.width / 2;
        const gripSvg = await gripChart.locator('svg').boundingBox();
        const highY = gripSvg.y + gripSvg.height * 0.12;

        const endGrip = gripChart.locator('svg circle').nth(1);
        const egb = await endGrip.boundingBox();
        await page.mouse.move(egb.x + egb.width / 2, egb.y + egb.height / 2);
        await page.mouse.down();
        // Up and just to the RIGHT of the pivot: steeply positive.
        await page.mouse.move(pivotX + 12, highY, { steps: 10 });
        await page.waitForTimeout(80);
        const steep = (await gripRows())[0].slope;
        // Straight across the pivot's column: the line passes vertical and comes
        // down the far side, which is the whole point — the slope flips sign.
        await page.mouse.move(pivotX - 12, highY, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const flipped = (await gripRows())[0].slope;
        check('trend: dragging an end grip reaches a slope the pinned handle could not',
            steep > 2, `slope ${steep}`);
        check('trend: dragging across the pivot flips the slope through vertical',
            flipped < -2, `slope ${steep} -> ${flipped}`);
        // The clamp in the example is what keeps that unbounded growth honest.
        check('trend: the slope clamp still holds at the extreme',
            Math.abs(flipped) <= 20 + 1e-9, `slope ${flipped}`);

        // The three renders are three readings of ONE family, so each has to emit
        // its own shape count — a render name silently falling through to the
        // default would still draw a plausible chart. All three charts come from
        // one example, so they share a `.chart` and differ only in the band.
        await open('/marks/trend', '#render .chart svg');
        const renderCharts = page.locator('#render .chart > div');
        const regionPaths = await renderCharts.nth(0).locator('svg path').count();
        const gradientPaths = await renderCharts.nth(1).locator('svg path').count();
        // Axis/tick lines land in the same layer, so measure the fan against the
        // region chart — identical but for the band — rather than a magic total.
        const axisLines = await renderCharts.nth(0).locator('svg line').count();
        const sampleLines = await renderCharts.nth(2).locator('svg line').count();
        check('band: region draws ONE envelope polygon', regionPaths === 1, `${regionPaths} paths`);
        check('band: gradient draws one polygon per level', gradientPaths === 6, `${gradientPaths} paths for levels: 6`);
        check('band: samples draws one line per sample', sampleLines - axisLines === 80,
            `${sampleLines} - ${axisLines} axis lines, for samples: 80`);

        // The band's own handles write the SPREADS, and each claims its own.
        await open('/marks/trend', '#band .chart svg circle');
        const editBand = page.locator('#band .chart').nth(1);
        const editBandRows = () => editBand.locator(':scope > div').first().evaluate((e) => e.getData());
        const spreadBefore = await editBandRows();
        const spreadHandle = editBand.locator('svg circle').first();
        await spreadHandle.scrollIntoViewIfNeeded();
        const pb = await spreadHandle.boundingBox();
        await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
        await page.mouse.down();
        await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2 - 30, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const spreadAfter = await editBandRows();
        check('band: dragging a spread handle widened that spread',
            spreadAfter[0].aSd !== spreadBefore[0].aSd,
            `aSd ${spreadBefore[0].aSd} -> ${spreadAfter[0].aSd}`);
        check('band: it left the line itself alone',
            spreadAfter[0].intercept === spreadBefore[0].intercept
            && spreadAfter[0].slope === spreadBefore[0].slope);

        // ---- Line + Cone: the correlation preset ----------------------------
        // Two probe clicks, no handles at all: with no node to read a channel tag
        // off, an edit that insisted on one could never fire. The pinned intercept
        // must also survive — a stray write would add an `intercept` column to the
        // elicited data.
        console.log('\nLine + Cone as a preset (/widgets)');
        await open('/widgets', '#linecone .chart svg');
        const coneChart = page.locator('#linecone .chart').first().locator(':scope > div').first();
        const coneRows = () => coneChart.evaluate((e) => e.getData());
        const coneStage = () => coneChart.evaluate((e) => e.getStage());
        await coneChart.scrollIntoViewIfNeeded();
        check('lineCone: starts at stage 0', (await coneStage()) === 0);

        const coneSvg = await coneChart.locator('svg').boundingBox();
        const aimX = coneSvg.x + coneSvg.width * 0.72;
        const aimY = coneSvg.y + coneSvg.height * 0.32;
        await page.mouse.move(aimX, aimY);
        await page.waitForTimeout(80);
        await page.mouse.click(aimX, aimY);
        await page.waitForTimeout(150);
        const afterAim = await coneRows();
        check('lineCone: the first click committed r', afterAim[0].r !== 0, `r = ${afterAim[0].r}`);
        check('lineCone: and advanced the stage', (await coneStage()) === 1);

        // Stage 1 opens the cone. The gesture is declared on the LINE, but the band
        // is what shows it, so hovering has to ghost a sibling feature's nodes —
        // otherwise half the glyph sits frozen until the click and the reader is
        // aiming blind. The committed spread is still 0 here, so every band node on
        // screen is a ghost.
        await page.mouse.move(aimX, aimY + 40, { steps: 4 });
        await page.waitForTimeout(120);
        const ghostFan = await coneChart.locator('svg line[data-ghost]').count();
        const stillZero = (await coneRows())[0].spread;
        check('lineCone: hovering ghosts the BAND, not just the line',
            ghostFan > 1, `${ghostFan} ghost band lines`);
        check('lineCone: the ghost committed nothing', stillZero === 0, `spread = ${stillZero}`);

        await page.mouse.click(aimX, aimY + 40);
        await page.waitForTimeout(150);
        const afterOpen = await coneRows();
        check('lineCone: the second click committed spread', afterOpen[0].spread > 0,
            `spread = ${afterOpen[0].spread}`);
        check('lineCone: it FROZE r (stage 0 is gated off)', afterOpen[0].r === afterAim[0].r,
            `r ${afterAim[0].r} -> ${afterOpen[0].r}`);
        check('lineCone: the pinned intercept wrote no column',
            !('intercept' in afterOpen[0]), Object.keys(afterOpen[0]).join(','));
        check('lineCone: and advanced past the last stage', (await coneStage()) === 2);

        // ---- Shape constraints --------------------------------------------
        // All three repair by pushing the rows/fields the gesture would have
        // violated, holding the one you actually grabbed. That choice is invisible
        // to types and obvious under a pointer.
        console.log('\nShape constraints (/constraints)');
        await open('/constraints', '#ordering .chart svg');

        // ordering: drag the low cap of an interval up past the mean and the high cap.
        const ordEl = '#ordering .chart > div';
        const ordBefore = await page.$eval(ordEl, (e) => e.getData());
        // The caps are the two grabbable ticks; the axis ticks are lines too, and
        // sit lower — they're pointer-events:none, so grabbing one is a silent no-op.
        const caps = await page.locator('#ordering svg line[stroke="#6F8294" i]').all();
        await page.locator('#ordering .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        let lowCap = null, maxY = -1;
        for (const c of caps) {
            const b = await c.boundingBox();
            if (b && b.y > maxY) { maxY = b.y; lowCap = b; }
        }
        await page.mouse.move(lowCap.x + lowCap.width / 2, lowCap.y + lowCap.height / 2);
        await page.mouse.down();
        await page.mouse.move(lowCap.x + lowCap.width / 2, lowCap.y - 120, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const ordAfter = await page.$eval(ordEl, (e) => e.getData());
        check('ordering: the grabbed cap moved', ordAfter[0].lo !== ordBefore[0].lo,
            `lo ${ordBefore[0].lo} -> ${ordAfter[0].lo}`);
        check('ordering: lo <= mean <= hi still holds',
            ordAfter[0].lo <= ordAfter[0].mean && ordAfter[0].mean <= ordAfter[0].hi,
            JSON.stringify(ordAfter[0]));
        check('ordering: it repaired by CARRYING the others, not blocking the drag',
            ordAfter[0].mean > ordBefore[0].mean, `mean ${ordBefore[0].mean} -> ${ordAfter[0].mean}`);

        // monotonic: drag a mid point of a CDF up; later points rise to meet it.
        const monoEl = '#monotonic .chart > div';
        const monoBefore = await page.$eval(monoEl, (e) => e.getData());
        const monoDots = await page.locator('#monotonic svg circle').all();
        await monoDots[0].scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const mBox = await monoDots[2].boundingBox();
        await page.mouse.move(mBox.x + mBox.width / 2, mBox.y + mBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(mBox.x + mBox.width / 2, mBox.y - 90, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const monoAfter = await page.$eval(monoEl, (e) => e.getData());
        check('monotonic: the dragged point rose', monoAfter[2].p > monoBefore[2].p,
            `${monoBefore[2].p} -> ${monoAfter[2].p}`);
        check('monotonic: it carried the neighbours it would have crossed',
            monoAfter[3].p > monoBefore[3].p, `p[3] ${monoBefore[3].p} -> ${monoAfter[3].p}`);
        check('monotonic: the curve never dips',
            monoAfter.every((d, i) => i === 0 || d.p >= monoAfter[i - 1].p - 1e-9),
            monoAfter.map((d) => d.p).join(', '));

        // spacing: shove a threshold into its neighbours; they keep min apart.
        const spEl = '#spacing .chart > div';
        const spTicks = await page.locator('#spacing svg line[stroke="#50AEB7" i]').all();
        await spTicks[0].scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const sBox = await spTicks[0].boundingBox();
        await page.mouse.move(sBox.x + sBox.width / 2, sBox.y + sBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(sBox.x + sBox.width / 2 + 160, sBox.y + sBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const spAfter = await page.$eval(spEl, (e) => e.getData());
        const sorted = spAfter.map((d) => d.at).sort((a, b) => a - b);
        const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
        check('spacing: no two thresholds are closer than min',
            gaps.every((g) => g >= 8 - 1e-9), `gaps ${gaps.map((g) => g.toFixed(2)).join(', ')}`);

        // ---- symlog & diverging -------------------------------------------
        // symlog is continuous and invertible, so it must drag like any other
        // positional scale; diverging is a colour scale that turns at its pivot.
        console.log('\nsymlog & diverging (/scales)');
        await open('/scales', '#zero-crossing .chart svg');

        const zcEl = '#zero-crossing .chart > div';
        const zcDot = page.locator('#zero-crossing svg circle').first();
        await zcDot.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const zcBefore = await page.$eval(zcEl, (e) => e.getData());
        const zcFill0 = await zcDot.getAttribute('fill');
        const zBox = await zcDot.boundingBox();
        await page.mouse.move(zBox.x + zBox.width / 2, zBox.y + zBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(zBox.x + zBox.width / 2 - 150, zBox.y + zBox.height / 2, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        const zcAfter = await page.$eval(zcEl, (e) => e.getData());
        const zcFill1 = await zcDot.getAttribute('fill');
        check('symlog: an invertible scale drags', zcAfter[0].delta !== zcBefore[0].delta,
            `${zcBefore[0].delta} -> ${zcAfter[0].delta}`);
        check('diverging: the ramp re-colours as the value crosses the pivot',
            zcFill1 !== zcFill0, `${zcFill0} -> ${zcFill1}`);

        // ---- External controls: drive an edit from outside the chart ---------
        // The whole point is reaching the edit pipeline WITHOUT a pointer event, so
        // these call the public control API directly (a slider/picker/icon is just a
        // handler that does the same). The proof is that everything the pointer path
        // gives — the scale round-trip, constraints, undo — still holds.
        console.log('\nExternal controls (/editing/external-controls)');
        await open('/editing/external-controls', '#scatter .chart svg circle');

        const scEl = '#scatter .chart > div';
        const scData = () => page.$eval(scEl, (e) => e.getData());

        // accepts() surfaces what the channel allows, from its scale.
        const cats = await page.$eval(scEl, (e) => e.control('category', 0).accepts().values);
        check('external: accepts() lists the categorical domain',
            JSON.stringify(cats) === JSON.stringify(['A', 'B', 'C']), JSON.stringify(cats));

        // A value write (the picker's commit path).
        await page.$eval(scEl, (e) => e.control('category', 0).set('C'));
        check('external: set() writes a category value', (await scData())[0].group === 'C');

        // Forward-encode a 2-D data value to a drag; the clamp on y must still gate it.
        await page.$eval(scEl, (e) => e.control('move', 0).set({ x: 3, y: 999 }));
        let sd = await scData();
        check('external: set({x,y}) forward-encodes through the scale',
            Math.abs(sd[0].x - 3) < 0.8, `x=${sd[0].x}`);
        check('external: a dataset constraint gates the external edit too',
            sd[0].y === 80, `y=${sd[0].y} (clamp max 80)`);

        // Undo reverts the external edit and flips redo — it is an ordinary commit.
        const canBefore = await page.$eval(scEl, (e) => ({ u: e.canUndo(), r: e.canRedo() }));
        await page.$eval(scEl, (e) => e.undo());
        sd = await scData();
        check('external: undo reverts the external edit', sd[0].y !== 80, `y=${sd[0].y}`);
        const canAfter = await page.$eval(scEl, (e) => ({ u: e.canUndo(), r: e.canRedo() }));
        check('external: undo flips canRedo', canBefore.r === false && canAfter.r === true);

        // A live drag (begin … set … set … end) collapses into ONE undo entry.
        const pre = (await scData())[0];
        await page.$eval(scEl, (e) => {
            const h = e.control('move', 0);
            h.begin(); h.set({ x: 10, y: 10 }); h.set({ x: 22, y: 15 }); h.end();
        });
        const mid = (await scData())[0];
        check('external: a live drag moves the point', Math.abs(mid.x - 22) < 0.8, `x=${mid.x}`);
        await page.$eval(scEl, (e) => e.undo());
        const post = (await scData())[0];
        check('external: one undo restores the whole live drag',
            Math.abs(post.x - pre.x) < 0.8 && Math.abs(post.y - pre.y) < 0.8,
            `(${post.x},${post.y}) vs (${pre.x},${pre.y})`);

        // Pick vs cycle on ONE field: set() jumps to a value, fire() steps a click edit.
        await open('/editing/external-controls', '#pick .chart svg circle');
        const pkEl = '#pick .chart > div';
        const pkKind = () => page.$eval(pkEl, (e) => e.getData()[0].kind);
        await page.$eval(pkEl, (e) => e.control('pick', 0).set('high'));
        check('external: set() jumps straight to a category', (await pkKind()) === 'high', await pkKind());
        await page.$eval(pkEl, (e) => e.control('step', 0).fire());
        check('external: fire() steps a click edit (cycle wraps high -> low)',
            (await pkKind()) === 'low', await pkKind());
        await page.$eval(pkEl, (e) => e.control('step', 0).fire());
        check('external: fire() advances again (low -> med)', (await pkKind()) === 'med', await pkKind());

        // Rotate by a DATA angle: forward-encode degrees -> pointer -> the rotate edit.
        await open('/editing/external-controls', '#rotate .chart svg');
        const rotEl = '#rotate .chart > div';
        await page.$eval(rotEl, (e) => e.control('spin', 0).set(90));
        const theta = (await page.$eval(rotEl, (e) => e.getData()))[0].theta;
        check('external: rotate driven by an angle value lands on it',
            Math.abs(theta - 90) < 1.5, `theta=${theta}`);

        // A sweep edit driven by a ROW: the control names the row, so the sweep's
        // target search is skipped and year i is written, through the real <input>.
        await open('/editing/external-controls', '#plane .chart svg path');
        const plEl = '#plane .chart > div';
        const plData = () => page.$eval(plEl, (e) => e.getData());
        const plBefore = await plData();
        await page.fill('#plane input[type=number] >> nth=3', '82');
        await page.press('#plane input[type=number] >> nth=3', 'Enter');
        await page.locator('#plane input[type=number] >> nth=0').focus();
        let pl = await plData();
        check('external: an input drives a sweep edit on its own row',
            Math.abs(pl[3].v - 82) < 0.5 && pl.every((d, i) => i === 3 || d.v === plBefore[i].v),
            JSON.stringify(pl.map((d) => Math.round(d.v))));
        await page.$eval(plEl, (e) => e.undo());
        pl = await plData();
        check('external: one undo reverts the controlled sweep write', pl[3].v === plBefore[3].v, `v=${pl[3].v}`);

        // Face params: accepts() reports the schema range; set() writes the field.
        await open('/editing/external-controls', '#face .chart svg');
        const faceEl = '#face .chart > div';
        const faceDomain = await page.$eval(faceEl, (e) => e.control('smile').accepts().domain);
        check('external: accepts() reports a continuous range',
            JSON.stringify(faceDomain) === JSON.stringify([0, 1]), JSON.stringify(faceDomain));
        const faceBefore = await page.$eval(faceEl, (e) => e.getData());
        await page.$eval(faceEl, (e) => e.control('eyes').set(0.9));
        const faceAfter = await page.$eval(faceEl, (e) => e.getData());
        check('external: a slider set() writes its facial field',
            Math.abs(faceAfter[0].eyes - 0.9) < 1e-9, `eyes=${faceAfter[0].eyes}`);
        // The regression: three set()s on one feature must stay INDEPENDENT — driving
        // one must not move the others (editName addresses just the named edit).
        check('external: driving one face slider leaves the others untouched',
            faceAfter[0].smile === faceBefore[0].smile && faceAfter[0].brow === faceBefore[0].brow,
            `smile ${faceBefore[0].smile}->${faceAfter[0].smile}, brow ${faceBefore[0].brow}->${faceAfter[0].brow}`);

        // ---- Probe: ghost preview + drag-commit ---------------------------
        // The interaction the redesign targets. A hover/drag must PREVIEW as an inert
        // ghost (the committed mark stays put — no flicker/jump), getData must not move
        // until a commit, and BOTH a click and a drag-release must settle. Before this,
        // a dragged probe committed NOTHING: the driver ignored drag and the renderer
        // swallowed the trailing click. None of that is visible to the typechecker.
        console.log('\nProbe ghost-preview + drag-commit (/editing/probe)');
        await open('/editing/probe', '#preview .chart svg circle');
        // The preview section has two examples; target the FIRST (probe-a-single-value).
        const pvChart = page.locator('#preview .chart').first();
        const pvEl = '#preview .chart > div';   // $eval => first match, same chart
        const pvV = () => page.$eval(pvEl, (e) => e.getData()[0].v);
        const pvGhosts = () => pvChart.locator('svg [data-ghost]').count();
        await pvChart.locator('svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const pvSvg = await pvChart.locator('svg').boundingBox();
        const pvKnob0 = await pvChart.locator('svg circle').first().boundingBox();
        const pvCy = pvKnob0.y + pvKnob0.height / 2;
        const pvHoverX = pvSvg.x + pvSvg.width * 0.7;   // well right of the seeded knob

        const vBefore = await pvV();
        // HOVER — preview only, no button.
        await page.mouse.move(pvHoverX, pvCy);
        await page.waitForTimeout(120);
        const vHover = await pvV();
        const ghostsHover = await pvGhosts();
        check('probe: hover does NOT commit (getData unchanged)', vHover === vBefore, `v ${vBefore} -> ${vHover}`);
        check('probe: hover shows a ghost preview node', ghostsHover > 0, `ghosts=${ghostsHover}`);

        // CLICK — settle at the hovered spot.
        await page.mouse.click(pvHoverX, pvCy);
        await page.waitForTimeout(120);
        const vClicked = await pvV();
        const ghostsClicked = await pvGhosts();
        check('probe: click commits the previewed value', vClicked > vBefore + 10, `v ${vBefore} -> ${vClicked}`);
        check('probe: no ghost remains after a click commit', ghostsClicked === 0, `ghosts=${ghostsClicked}`);

        // DRAG-RELEASE — grab the knob, drag left, release. THE slider fix.
        const pvKnob1 = await pvChart.locator('svg circle').first().boundingBox();
        const pvFromX = pvKnob1.x + pvKnob1.width / 2;
        const pvToX = pvSvg.x + pvSvg.width * 0.3;
        await page.mouse.move(pvFromX, pvCy);
        await page.mouse.down();
        for (let k = 1; k <= 8; k++) await page.mouse.move(pvFromX + (pvToX - pvFromX) * k / 8, pvCy);
        await page.mouse.up();
        await page.waitForTimeout(120);
        const vDragged = await pvV();
        const ghostsDragged = await pvGhosts();
        check('probe: a drag-release commits (was a total no-op before)', vDragged < vClicked - 5,
            `v ${vClicked} -> ${vDragged}`);
        check('probe: no ghost remains after a drag commit', ghostsDragged === 0, `ghosts=${ghostsDragged}`);

        // The whole drag collapses to ONE undo entry (a lazy per-gesture transaction).
        await page.$eval(pvEl, (e) => e.undo());
        await page.waitForTimeout(100);
        const vUndone = await pvV();
        check('probe: one undo restores the pre-drag value', Math.abs(vUndone - vClicked) < 1.5,
            `after undo v=${vUndone} vs ${vClicked}`);

        // ---- Probe on a matrix: no flicker, no stale preview --------------
        // The matrix was the worst case: substituting the whole dataset for a hover
        // rebuilt every committed cell, so they jumped. Now a hover only ADDS a ghost
        // of the touched cell; committed cells never move, and leaving clears it.
        console.log('\nProbe on a matrix — no flicker (/widgets)');
        await open('/widgets', '#matrix .chart svg');
        // The matrix section shows the widget; .first() is defensive if that changes.
        const mxChart = page.locator('#matrix .chart').first();
        const mxEl = '#matrix .chart > div';
        const mxLen = () => page.$eval(mxEl, (e) => e.getData().length);
        await mxChart.locator('svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const mxBox = await mxChart.locator('svg').boundingBox();
        const lenBefore = await mxLen();
        await page.mouse.move(mxBox.x + mxBox.width * 0.5, mxBox.y + mxBox.height * 0.5);
        await page.waitForTimeout(150);
        const lenHover = await mxLen();
        const mxGhosts = await mxChart.locator('svg [data-ghost]').count();
        check('matrix: hovering a cell does NOT commit', lenHover === lenBefore, `len ${lenBefore} -> ${lenHover}`);
        check('matrix: hovering a cell shows a ghost preview', mxGhosts > 0, `ghosts=${mxGhosts}`);
        await page.mouse.move(mxBox.x - 30, mxBox.y - 30);   // leave the plane
        await page.waitForTimeout(150);
        const mxGone = await mxChart.locator('svg [data-ghost]').count();
        check('matrix: leaving clears the ghost (no stale preview)', mxGone === 0, `ghosts=${mxGone}`);

        // ---- Legend: reserves space + pickers write back ------------------
        // A legend is the first chrome that RESERVES space (shrinks the plot), and
        // its pickers write to the dataset through the normal edit pipeline. Both
        // are invisible to typecheck: reservation is a layout negotiation, and the
        // pickers are direct-pick on nodes out in the reserved margin band, where
        // the interaction plane doesn't reach.
        console.log('\nLegend (/marks/legend)');
        await open('/marks/legend', '#discrete .chart svg rect.plane');

        // Reservation: the plot's interaction plane (== inner width) must be smaller
        // than the no-legend inner width (svg width - author margins 40+16 = 324),
        // proving the right legend band shrank the plot instead of overlapping it.
        const disc = await page.$eval('#discrete .chart svg', (svg) => ({
            svgW: Number(svg.getAttribute('width')),
            planeW: Number(svg.querySelector('rect.plane')?.getAttribute('width')),
        }));
        check('legend: reserves space (plane narrower than no-legend inner)',
            disc.planeW > 150 && disc.planeW < 300, `plane ${disc.planeW}, svg ${disc.svgW}`);

        // Colours: inert legend chips live in the background layer (bg-rect). Their
        // fills must be the fill-scale palette — the same colours the bars encode —
        // otherwise a missing bg-rect paint path would leave labels with no chips.
        const colours = await page.$eval('#discrete .chart svg', (svg) => {
            const swatches = [...svg.querySelectorAll('rect.bg-rect')]
                .filter((r) => r.getAttribute('fill') && r.getAttribute('fill') !== 'none')
                .map((r) => r.getAttribute('fill'));
            const bars = [...svg.querySelectorAll('rect.mark')]
                .map((r) => r.getAttribute('fill'));
            return { swatches, bars };
        });
        check('legend: draws one coloured swatch per category',
            colours.swatches.length === 4, `swatches=${JSON.stringify(colours.swatches)}`);
        check('legend: swatch colours match the fill channel (bars)',
            colours.swatches.length === colours.bars.length
            && colours.swatches.every((c, i) => c === colours.bars[i]),
            `swatches=${JSON.stringify(colours.swatches)} bars=${JSON.stringify(colours.bars)}`);

        // ---- colour follows the MEASURE, and one scale per encoding -------
        // A scale is one ENCODING — (channel, field) — not one channel. Two marks
        // colouring by different fields get two scales with their own domains, so
        // the key stops being a union. Colour then follows what the data IS: an
        // `ordinal` field is ORDERED and gets a ramp sampled per category, a
        // `categorical` one gets distinct hues. Asserted as PROPERTIES (monotonic
        // lightness, hue spread, disjointness) rather than hex literals, so colour
        // stays free to improve without rewriting the suite each time.
        console.log('\nColour by measure (/scales)');
        await open('/scales', '#ordered-colour .chart svg');
        await page.locator('#ordered-colour .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const swatchSets = await page.$eval('#ordered-colour .chart svg', (svg) => {
            const lum = (c) => {
                const m = c.match(/\d+/g);
                if (!m) return null;
                const [r, g, b] = m.map(Number);
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const toRgb = (el) => getComputedStyle(el).fill;
            // The plot dots: 4 for the ordinal encoding, 4 for the categorical one,
            // in mark order (ordinal mark declared first).
            const dots = [...svg.querySelectorAll('circle.mark')].map(toRgb);
            return { ordinal: dots.slice(0, 4).map(lum), categorical: dots.slice(4, 8).map(lum) };
        });
        const ord = swatchSets.ordinal;
        const cat = swatchSets.categorical;
        // Ordered data must read as ordered: lightness moves one way across the
        // domain. (Q1..Q4 carry disagree..strongly agree, so the dots are in
        // domain order.)
        const monotonic = ord.every((v, i) => i === 0 || v <= ord[i - 1] + 1)
            || ord.every((v, i) => i === 0 || v >= ord[i - 1] - 1);
        check('colour: an ordinal field ramps monotonically in lightness',
            ord.length === 4 && monotonic, JSON.stringify(ord.map(Math.round)));
        // Unordered data must NOT: distinct hues have no lightness order, and the
        // spread of a categorical palette is not a ramp.
        check('colour: a categorical field does not ramp',
            cat.length === 4 && !(cat.every((v, i) => i === 0 || v <= cat[i - 1] + 1)
                || cat.every((v, i) => i === 0 || v >= cat[i - 1] - 1)),
            JSON.stringify(cat.map(Math.round)));
        // Two encodings on one channel are two scales, so their colour sets are
        // disjoint — the separation the union used to give by accident.
        const disjoint = await page.$eval('#ordered-colour .chart svg', (svg) => {
            const f = [...svg.querySelectorAll('circle.mark')].map((c) => getComputedStyle(c).fill);
            const a = new Set(f.slice(0, 4)), b = new Set(f.slice(4, 8));
            return [...b].every((c) => !a.has(c));
        });
        check('colour: two encodings on one channel use disjoint colours', disjoint);
        // …and two scales means two keys, not one union key.
        const keyCount = await page.$eval('#ordered-colour .chart svg', (svg) =>
            [...svg.querySelectorAll('rect.bg-rect')]
                .filter((r) => r.getAttribute('fill') && r.getAttribute('fill') !== 'none').length);
        check('colour: legends: true draws one key per encoding, not one union key',
            keyCount === 7, `swatches=${keyCount}`);

        // ---- graduated size legend (#size) --------------------------------
        // A quantitative `size` scale is continuous, so the old ramp branch caught it
        // and painted a flat grey bar with numbers beside it — a size legend showing
        // no sizes. It draws nested circles at tick values instead, and their radii
        // come from `scale.encode`, so the key reports whichever scale the channel
        // resolved rather than assuming one.
        await open('/marks/legend', '#size .chart svg');
        await page.locator('#size .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const sizeLegend = await page.$eval('#size .chart svg', (svg) => {
            const circles = [...svg.querySelectorAll('circle')].map((c) => Number(c.getAttribute('r')));
            const slices = [...svg.querySelectorAll('rect')].filter(
                (r) => r.getAttribute('fill') === '#94a3b8'
            ).length;
            return { circles, slices };
        });
        // The dots in the plot plus the legend's own stack; the legend's must ASCEND
        // and span a real range, not all collapse to one clamped radius.
        const legendCircles = sizeLegend.circles.slice().sort((a, b) => a - b);
        check('legend: a quantitative size legend draws no grey ramp slices',
            sizeLegend.slices === 0, `slices=${sizeLegend.slices}`);
        check('legend: it draws graduated circles spanning the size range',
            legendCircles.length >= 6
            && legendCircles[legendCircles.length - 1] > legendCircles[0] + 6,
            JSON.stringify(legendCircles));

        // ---- angle + strokeWidth forms (#angle-width) ---------------------
        // Both resolve real scales but had no legend SHAPE, so they rendered the
        // colour ramp's grey bar — a key that reports the domain and nothing about
        // the channel. `angle` draws spokes at their encoded bearings, `strokeWidth`
        // segments at their encoded thicknesses, both read off `scale.encode`.
        await open('/marks/legend', '#angle-width .chart svg');
        await page.locator('#angle-width .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const forms = await page.$eval('#angle-width .chart svg', (svg) => {
            const lines = [...svg.querySelectorAll('line')].map((l) => ({
                dx: Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')),
                dy: Number(l.getAttribute('y2')) - Number(l.getAttribute('y1')),
                w: Number(l.getAttribute('stroke-width')),
            }));
            // Weights: horizontal segments, so dy ~ 0 and the widths differ.
            const flat = lines.filter((l) => Math.abs(l.dy) < 0.5 && Math.abs(l.dx) > 20);
            // Spokes: same length from one hub, at different bearings.
            const angled = lines.filter((l) => Math.abs(l.dy) > 0.5 || (Math.abs(l.dx) > 0 && Math.abs(l.dx) < 25));
            return {
                weights: [...new Set(flat.map((l) => l.w))].sort((a, b) => a - b),
                bearings: [...new Set(angled.map((l) => Math.round(Math.atan2(-l.dy, l.dx) * 180 / Math.PI)))]
                    .sort((a, b) => a - b),
            };
        });
        check('legend: a strokeWidth key draws segments of differing weight',
            forms.weights.length >= 4 && forms.weights[forms.weights.length - 1] > forms.weights[0],
            JSON.stringify(forms.weights));
        check('legend: an angle key draws spokes at differing bearings',
            forms.bearings.length >= 3
            && forms.bearings[forms.bearings.length - 1] - forms.bearings[0] > 60,
            JSON.stringify(forms.bearings));

        // Title falls back to the column the scale was built from, so a legend is
        // never an unlabelled row of colours.
        const discTexts = await page.$eval('#discrete .chart svg', (svg) =>
            [...svg.querySelectorAll('text')].map((t) => t.textContent));
        check('legend: the title defaults to the field name',
            discTexts.includes('group'), JSON.stringify(discTexts));

        await open('/marks/legend', '#picker .chart svg');
        // Category picker: clicking a swatch sets the field to that category. Swatch
        // DOM order === domain order [A,B,C,D]; nth(2) is "C".
        const groupOf = () => page.$eval('#picker .data-body', (el) => {
            const m = el.textContent.match(/group:\s*"([^"]+)"/);
            return m ? m[1] : null;
        });
        await page.locator('#picker .chart svg').scrollIntoViewIfNeeded();
        const groupBefore = await groupOf();
        const swatches = page.locator('#picker .chart svg rect.mark');
        const swatchCount = await swatches.count();
        check('legend: draws one interactive swatch per category', swatchCount === 4, `swatches=${swatchCount}`);
        await swatches.nth(2).click();
        await page.waitForTimeout(120);
        const groupAfter = await groupOf();
        check('legend: clicking a swatch sets the category',
            groupBefore === 'A' && groupAfter === 'C', `${groupBefore} -> ${groupAfter}`);

        // ---- two encodings on one channel (#two-encodings) ----------------
        // Two marks bind `fill` to different columns. That is TWO encodings, so it is
        // two scales, two keys, and two pickers that each write their own column —
        // where it used to be one union scale whose picker took `scale.fields[0]`,
        // i.e. whichever mark was declared first. Only a real click proves the write
        // lands in the right column; the page renders either way.
        const pinned = () => page.$eval('#two-encodings .data-body', (el) => {
            const t = el.textContent;
            const now = t.match(/now:\s*"([^"]+)"/);
            const goal = t.match(/goal:\s*"([^"]+)"/);
            return { now: now ? now[1] : null, goal: goal ? goal[1] : null };
        });
        await page.locator('#two-encodings .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const pinBefore = await pinned();
        check('legend: two pinned legends start at their seeded values',
            pinBefore.now === 'low' && pinBefore.goal === 'mid', JSON.stringify(pinBefore));

        // Swatches are the interactive (mark-layer) rects: 3 per legend, in domain
        // order [low, mid, high], first legend ("now") then second ("goal").
        const pinSwatches = page.locator('#two-encodings .chart svg rect.mark');
        check('legend: each pinned legend draws its own swatch column',
            (await pinSwatches.count()) === 6, `swatches=${await pinSwatches.count()}`);

        // Click "high" in the FIRST legend -> only `now` moves.
        await pinSwatches.nth(2).click();
        await page.waitForTimeout(120);
        const afterNow = await pinned();
        check('legend: a pinned swatch writes its own column',
            afterNow.now === 'high' && afterNow.goal === 'mid', JSON.stringify(afterNow));

        // Click "low" in the SECOND legend -> only `goal` moves. This is the
        // discriminating half: `fields[0]` is `now`, so before the pin was read this
        // wrote `now` and left `goal` untouched — both halves of the assertion flip.
        await pinSwatches.nth(3).click();
        await page.waitForTimeout(120);
        const afterGoal = await pinned();
        check('legend: the second legend writes the OTHER column, not fields[0]',
            afterGoal.goal === 'low' && afterGoal.now === 'high', JSON.stringify(afterGoal));

        // ---- the edit declared on the MARK (#declare-on-the-mark) ---------
        // The spec composes no legendColor() at all: the picker sits on the bar's
        // `fill` channel and the legend is minted from it, carrying the mark's field
        // and table. Two things have to hold, and only a real gesture shows either —
        // the legend must EXIST and work, and the edit must have been STRIPPED off
        // the bar, or a click on a bar would dispatch it with no node.category and
        // silently eat the selection gesture.
        await open('/marks/legend', '#declare-on-the-mark .chart svg');
        await page.locator('#declare-on-the-mark .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const dmData = () => page.$eval('#declare-on-the-mark .chart > div', (el) => el.getData());
        const dmSel = () => page.$eval('#declare-on-the-mark .chart > div', (el) => el.getSelection());

        // The legend is minted even though the spec composes none. With nothing
        // selected yet its swatches are inert chrome (`bg-rect`), so count them
        // there — they only become mark-layer rects once a row is the target.
        const dmRects = page.locator('#declare-on-the-mark .chart svg rect.mark');
        const dmSwatchesInert = await page.locator(
            '#declare-on-the-mark .chart svg rect.bg-rect[fill]:not([fill="none"])'
        ).count();
        check('legend: a mark-declared edit mints a legend',
            dmSwatchesInert === 4 && (await dmRects.count()) === 4,
            `swatches=${dmSwatchesInert} bars=${await dmRects.count()}`);

        // Clicking a BAR must still only select — the legend edit is no longer on it.
        await dmRects.nth(1).click();
        await page.waitForTimeout(120);
        check('legend: the minted swatches arm once a row is selected',
            (await dmRects.count()) === 8, `rects=${await dmRects.count()}`);
        const dmAfterBar = await dmData();
        check('legend: clicking a bar selects it', (await dmSel()) === 1, `selection=${await dmSel()}`);
        check('legend: the relocated edit no longer fires on the mark',
            dmAfterBar[1].group === 'South', `row1=${JSON.stringify(dmAfterBar[1])}`);

        // Clicking a minted swatch edits the selected row. Swatches are rects 4..7 in
        // domain order [North, South, East, West]; nth(6) is "East".
        await dmRects.nth(6).click();
        await page.waitForTimeout(120);
        const dmAfterSwatch = await dmData();
        check('legend: a minted swatch writes the mark\'s column on the selected row',
            dmAfterSwatch[1].group === 'East' && dmAfterSwatch[0].group === 'North',
            JSON.stringify(dmAfterSwatch.map((d) => d.group)));

        // ---- unarmed state + current-value ring (#multi-select) -----------
        // The ring marks the value(s) the target rows hold, so the legend says what
        // a click would REPLACE and not merely what it can set — and by its absence,
        // that there is nothing to write to. A legend is a KEY first, so it must
        // stay fully legible while unarmed: its swatch fills are the encoding, and
        // fading them would report colours the marks do not have. Drawn by the
        // legend, not the engine's effects pass (which is row-indexed and skips
        // scale-viewing features), so only a render proves any of it.
        await open('/marks/legend', '#multi-select .chart svg');
        await page.locator('#multi-select .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const msEl = '#multi-select .chart > div';
        const msData = () => page.$eval(msEl, (el) => el.getData());
        const msSelAll = () => page.$eval(msEl, (el) => el.getSelectionAll());
        const ringCount = () => page.locator(
            '#multi-select .chart svg rect[stroke-width="2"][fill="none"]'
        ).count();

        // The swatch fills must equal the bar fills, armed or not — same assertion
        // the inert #discrete legend makes, here in the state where it was tempting
        // to fade them.
        const msKey = await page.$eval('#multi-select .chart svg', (svg) => ({
            swatches: [...svg.querySelectorAll('rect.bg-rect')]
                .filter((r) => r.getAttribute('fill') && r.getAttribute('fill') !== 'none')
                .map((r) => ({ fill: r.getAttribute('fill'), opacity: r.getAttribute('opacity') })),
            bars: [...svg.querySelectorAll('rect.mark')].map((r) => r.getAttribute('fill')),
        }));
        check('legend: an unarmed picker stays a legible key (no dimming)',
            msKey.swatches.length === 4
            && msKey.swatches.every((s) => s.opacity == null || Number(s.opacity) === 1)
            && msKey.swatches.every((s, i) => s.fill === msKey.bars[i]),
            JSON.stringify(msKey));
        check('legend: an unarmed picker draws no current-value ring',
            (await ringCount()) === 0, `rings=${await ringCount()}`);

        // Select bar A, then shift-click bar C -> both selected.
        const msBars = page.locator('#multi-select .chart svg rect.mark');
        await msBars.nth(0).click();
        await page.waitForTimeout(100);
        await msBars.nth(2).click({ modifiers: ['Shift'] });
        await page.waitForTimeout(150);
        check('legend: shift-click builds a multi-row selection',
            JSON.stringify(await msSelAll()) === '[0,2]', JSON.stringify(await msSelAll()));

        // A and C hold North and East -> two swatches ringed.
        check('legend: a swatch is ringed per value the selection holds',
            (await ringCount()) === 2, `rings=${await ringCount()}`);

        // One swatch click writes EVERY selected row. Swatches are the 4 mark rects
        // after the bars; nth(7) is "West" (domain [North, South, East, West]).
        await page.locator('#multi-select .chart svg rect.mark').nth(7).click();
        await page.waitForTimeout(150);
        const msAfter = await msData();
        check('legend: one swatch click writes every selected row',
            msAfter[0].group === 'West' && msAfter[2].group === 'West'
            && msAfter[1].group === 'South' && msAfter[3].group === 'West',
            JSON.stringify(msAfter.map((d) => d.group)));

        // Both selected rows now hold the same value -> one ring, not two.
        check('legend: the ring collapses when the selection agrees',
            (await ringCount()) === 1, `rings=${await ringCount()}`);

        // Shift-clicking a selected row REMOVES it. `has && size === 1` is false for
        // a member of a multi-row selection, so this used to re-add it instead.
        await page.locator('#multi-select .chart svg rect.mark').nth(2).click({ modifiers: ['Shift'] });
        await page.waitForTimeout(150);
        check('legend: shift-click removes a row from the selection',
            JSON.stringify(await msSelAll()) === '[0]', JSON.stringify(await msSelAll()));

        // ---- domain edits from a legend (#categories) ---------------------
        // edit.scale.categories writes the DOMAIN, which is a property of the scale
        // the element draws — so it needs no target row, and the swatches must be
        // live on a chart with nothing selected. That is a different arming rule
        // from the picker's, and reading one flag for both left it inert.
        // Two charts live in this section; the single-table one is first.
        await open('/marks/legend', '#categories .chart svg');
        const catSvg = page.locator('#categories .chart svg').first();
        const catRoot = page.locator('#categories .chart > div').first();
        await catSvg.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const catGroups = async () =>
            (await catRoot.evaluate((el) => el.getData())).map((d) => d.group);
        const catTexts = () => catSvg.evaluate((svg) =>
            [...svg.querySelectorAll('text')].map((t) => t.textContent));

        const texts0 = await catTexts();
        check('legend: a domain-editable legend draws × per category and a ＋',
            texts0.filter((t) => t === '×').length === 2 && texts0.includes('＋'),
            JSON.stringify(texts0));

        // The swatches are live with NOTHING selected — a domain edit needs no row.
        const catSwatches = catSvg.locator('rect.mark');
        check('legend: domain-edit swatches are live with no selection',
            (await catSwatches.count()) === 4 + 2, `rects=${await catSwatches.count()}`);

        // Rename: double-click the "North" swatch -> the editor opens SEEDED with the
        // category (the chip paints no text, so this only works via editValue), type,
        // Enter. Domain and rows must move together.
        await catSwatches.nth(4).dblclick();
        await page.waitForTimeout(200);
        const seeded = await page.$eval('#categories .chart input, #categories .chart textarea',
            (i) => i.value).catch(() => null);
        check('legend: the rename editor opens seeded with the category',
            seeded === 'North', `seeded=${JSON.stringify(seeded)}`);
        // A single-line editor opens SELECTED (double-click-to-rename), so typing
        // replaces rather than appends — no select-all needed.
        await page.keyboard.type('Up');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(200);
        check('legend: renaming a category relabels every row carrying it',
            JSON.stringify(await catGroups()) === '["Up","South","Up","South"]',
            JSON.stringify(await catGroups()));
        check('legend: the renamed category shows in the legend',
            (await catTexts()).includes('Up'), JSON.stringify(await catTexts()));

        // Remove: click the × beside "South" -> its rows go too.
        const xs = catSvg.locator('text', { hasText: '×' });
        await xs.nth(1).click();
        await page.waitForTimeout(200);
        check('legend: removing a category deletes its rows',
            JSON.stringify(await catGroups()) === '["Up","Up"]', JSON.stringify(await catGroups()));

        // ---- one vocabulary across two TABLES (#categories) ---------------
        // `team` is declared on both `people` and `ties`, and one `stroke` scale
        // spans them. A field NAME alone cannot say whose schema to write, so the
        // rename resolves through scale.fieldRefs (table-qualified) and commits
        // BOTH tables' schemas and BOTH row sets. Renaming one and not the other
        // splits one vocabulary in two, and the chart still draws.
        // The cross-table example is the SECOND chart in the categories section.
        const xtRoot = page.locator('#categories .chart > div').nth(1);
        const xtSvg = page.locator('#categories .chart svg').nth(1);
        await xtRoot.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const xtBefore = await xtRoot.evaluate((el) => el.getData());
        check('legend: the cross-table chart seeds both tables with `team`',
            xtBefore.people.map((d) => d.team).join(',') === 'red,blue,red'
            && xtBefore.ties.map((d) => d.team).join(',') === 'red,blue',
            JSON.stringify(xtBefore));

        // Rename "red" -> "crimson" from the legend.
        const xtSwatches = xtSvg.locator('rect.mark');
        await xtSwatches.first().dblclick();
        await page.waitForTimeout(200);
        await page.keyboard.type('crimson');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(250);
        const xtAfter = await xtRoot.evaluate((el) => el.getData());
        check('legend: a cross-table rename writes the NODE table\'s rows',
            xtAfter.people.map((d) => d.team).join(',') === 'crimson,blue,crimson',
            JSON.stringify(xtAfter.people.map((d) => d.team)));
        check('legend: a cross-table rename writes the LINK table\'s rows too',
            xtAfter.ties.map((d) => d.team).join(',') === 'crimson,blue',
            JSON.stringify(xtAfter.ties.map((d) => d.team)));

        // Continuous value picker: dragging the ramp handle DOWN (toward the low end
        // of a vertical ramp) lowers the value, clamped into [0,30]. The handle is
        // the rightmost circle mark (the point sits in the plot, the handle in the
        // band).
        const tempOf = () => page.$eval('#value .data-body', (el) => {
            const m = el.textContent.match(/temp:\s*(-?\d+(?:\.\d+)?)/);
            return m ? Number(m[1]) : null;
        });
        await page.locator('#value .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const handleBox = await page.$$eval('#value .chart svg circle.mark', (cs) => {
            const svg = cs[0].ownerSVGElement.getBoundingClientRect();
            let best = null;
            for (const c of cs) {
                const r = c.getBoundingClientRect();
                const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
                if (!best || cx > best.cx) best = { cx, cy };
            }
            return best ? { cx: best.cx, cy: best.cy, svgTop: svg.top } : null;
        });
        const tempBefore = await tempOf();
        check('legend: ramp renders a draggable handle', handleBox != null, `handle=${JSON.stringify(handleBox)}`);
        if (handleBox) {
            await page.mouse.move(handleBox.cx, handleBox.cy);
            await page.mouse.down();
            for (let k = 1; k <= 12; k++) await page.mouse.move(handleBox.cx, handleBox.cy + k * 5);
            await page.mouse.up();
            await page.waitForTimeout(120);
            const tempAfter = await tempOf();
            check('legend: dragging the ramp handle lowers the value (by-hand invert)',
                tempBefore != null && tempAfter != null && tempAfter < tempBefore - 3 && tempAfter >= 0,
                `temp ${tempBefore} -> ${tempAfter}`);
        }

        // ---- Selection as pipeline state (pick-and-edit) ------------------
        // Clicking a bar SELECTS it (edit.select) — selection is transient engine
        // state, never a `selected` data column — and the legend then edits the
        // SELECTED row. Only real pointer events prove the select/toggle/exclusive
        // state machine, and that the legend targets the selection (not row 0).
        console.log('\nSelection: pick-and-edit (/marks/legend #dynamic-target)');
        const selEl = '#dynamic-target .chart > div';
        const selData = () => page.$eval(selEl, (el) => el.getData());
        const selIndex = () => page.$eval(selEl, (el) => el.getSelection());
        await page.locator('#dynamic-target .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);

        // Bars are always rect.mark (the tall rects in the plot). Legend swatches
        // become interactive rect.mark ONLY once a row is selected (before that the
        // legend has no target row, so its swatches stay inert bg-rects) — which is
        // itself the point, so query them after a selection exists.
        const markCentres = (filter) => page.$$eval('#dynamic-target .chart svg rect.mark',
            (rs, hi) => rs.filter((r) => { const h = Number(r.getAttribute('height')); return hi ? h > 20 : Math.abs(h - 14) < 1; })
                .map((r) => { const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }),
            filter === 'bar');
        const bars = await markCentres('bar');
        check('select: four bars to pick from', bars.length === 4, `bars=${bars.length}`);

        const beforeSel = await selData();
        check('select: the dataset carries no `selected` column',
            beforeSel.every((d) => !('selected' in d)), JSON.stringify(beforeSel[0]));

        // Click bar A → selected index 0.
        await page.mouse.click(bars[0].x, bars[0].y);
        await page.waitForTimeout(100);
        check('select: clicking a bar selects it', (await selIndex()) === 0, `sel=${await selIndex()}`);

        // Click bar B → the exclusive selection MOVES.
        await page.mouse.click(bars[1].x, bars[1].y);
        await page.waitForTimeout(100);
        check('select: exclusive — selecting another moves the selection', (await selIndex()) === 1, `sel=${await selIndex()}`);

        // Click bar B again → toggles OFF.
        await page.mouse.click(bars[1].x, bars[1].y);
        await page.waitForTimeout(100);
        check('select: clicking the selected bar deselects it', (await selIndex()) === null, `sel=${await selIndex()}`);

        // Select bar C (index 2, group "East"), then click the "South" swatch
        // (domain order North/South/East/West → index 1). The legend must edit ROW 2
        // (the selection), leaving row 0 untouched — proving it targets the selection
        // rather than the old default row 0.
        await page.mouse.click(bars[2].x, bars[2].y);
        await page.waitForTimeout(100);
        check('select: bar C is now selected', (await selIndex()) === 2, `sel=${await selIndex()}`);
        // With a row selected, the legend's swatches turn interactive.
        const swatchBoxes = await markCentres('swatch');
        check('select: a selection makes the legend swatches interactive', swatchBoxes.length === 4, `swatches=${swatchBoxes.length}`);
        const g0Before = (await selData())[0].group, g2Before = (await selData())[2].group;
        await page.mouse.click(swatchBoxes[1].x, swatchBoxes[1].y);
        await page.waitForTimeout(120);
        const selAfter = await selData();
        check('select: the legend edits the SELECTED row (row 2), not row 0',
            g2Before === 'East' && selAfter[2].group === 'South' && selAfter[0].group === g0Before,
            `row2 ${g2Before}->${selAfter[2].group}, row0 ${g0Before}->${selAfter[0].group}`);
        check('select: editing through the legend still writes no `selected` column',
            selAfter.every((d) => !('selected' in d)), JSON.stringify(selAfter[2]));

        // ---- Selection: external API (item + category) --------------------
        // el.select(index) picks a SPECIFIC item; el.selectWhere(field, value) picks
        // a CATEGORY (first match). Both go through the same commit a click does.
        console.log('\nSelection: external API (/editing/external-controls #selection)');
        await open('/editing/external-controls', '#selection .chart svg');
        const xsel = '#selection .chart > div';
        await page.locator('#selection .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        const xIndex = () => page.$eval(xsel, (el) => el.getSelection());
        const xData = () => page.$eval(xsel, (el) => el.getData());

        const s1 = await page.$eval(xsel, (el) => el.select(2));
        check('el.select: selects a specific item by index', s1 === true && (await xIndex()) === 2, `sel=${await xIndex()}`);

        await page.$eval(xsel, (el) => el.selectWhere('group', 'South'));
        check('el.selectWhere: selects the first row of a category (index 1)',
            (await xIndex()) === 1, `sel=${await xIndex()}`);

        await page.$eval(xsel, (el) => el.clearSelection());
        check('el.clearSelection: deselects', (await xIndex()) === null, `sel=${await xIndex()}`);

        check('selection: never writes the dataset (no `selected` column)',
            (await xData()).every((d) => !('selected' in d)), JSON.stringify((await xData())[0]));

        // ---- Theming: tokens reach the pixels ------------------------------
        // The theme's `ink` recolours unstyled marks, and theme.marks[name]
        // overrides one mark — resolved on the node, so it lands as an SVG attr.
        console.log('\nTheming (/theming)');
        await open('/theming', '#tokens .chart svg rect');
        const inkFill = await page.$eval('#tokens .chart svg rect:not(.plane)', (r) => r.getAttribute('fill'));
        check('theme: ink recolours the bars', inkFill === '#e11d48', `fill=${inkFill}`);
        // Per-mark override: bars read `ink`, dots read theme.marks.point.
        const barFill = await page.$eval('#precedence .chart svg rect:not(.plane)', (r) => r.getAttribute('fill'));
        const dotFill = await page.$eval('#precedence .chart svg circle', (c) => c.getAttribute('fill'));
        check('theme: ink colours the bars', barFill === '#0ea5e9', `fill=${barFill}`);
        check('theme: marks.point overrides just the dots', dotFill === '#f59e0b', `fill=${dotFill}`);
        // Dark mode: the `background` token paints the svg, and light ink recolours marks.
        const darkBg = await page.$eval('#dark .chart svg', (s) => s.style.background || getComputedStyle(s).backgroundColor);
        const darkBar = await page.$eval('#dark .chart svg rect:not(.plane)', (r) => r.getAttribute('fill'));
        check('theme: dark background paints the chart', /rgb\(15,\s*23,\s*42\)|#0f172a/i.test(darkBg), `bg=${darkBg}`);
        check('theme: dark ink recolours the bars', darkBar === '#38bdf8', `fill=${darkBar}`);

        // ---- Network: two tables, one dataset ------------------------------
        // Nothing here is provable by typecheck: the join, the cross-table
        // proposal (a drag on a NODE mark that appends a LINK row), and the
        // delete cascade are all pointer/state-machine behaviour.
        console.log('\nNetwork: nodes + links (/marks/network)');
        await open('/marks/network', '#draw .chart svg circle');
        // Off-screen elements still report a bounding box, but page.mouse works in
        // VIEWPORT coordinates — so a gesture computed from one lands nowhere.
        await page.locator('#draw .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const netEl = '#draw .chart > div';
        const netData = () => page.$eval(netEl, (el) => el.getData());
        // The connection buffer: a link stops `inset` (3px) off the dot's own edge —
        // radius 11 + 3 from its centre — not `inset` px from the centre, and not
        // the dot's radius PLUS a centre-era inset.
        const bufferGaps = await page.evaluate(() => {
            const svg = document.querySelector('#draw .chart svg');
            const dots = [...svg.querySelectorAll('circle')].filter((c) => +c.getAttribute('r') === 11)
                .map((c) => [+c.getAttribute('cx'), +c.getAttribute('cy')]);
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const st = p.getAttribute('stroke');
                return st && st !== 'none' && st !== 'transparent';
            });
            return bodies.map((p) => {
                const a = p.getPointAtLength(0);
                return +Math.min(...dots.map(([x, y]) => Math.hypot(x - a.x, y - a.y))).toFixed(1);
            });
        });
        check('network: `inset` is a buffer off the node\'s shape (radius 11 + 3)',
            bufferGaps.length > 0 && bufferGaps.every((d) => Math.abs(d - 14) < 0.6), JSON.stringify(bufferGaps));
        // Node circles carry the point mark's fill; a link's endpoint handle is a
        // circle too, so index alone would not tell them apart.
        const nodeAt = (i) => page.$$eval('#draw .chart svg circle', (cs, [k, head]) => {
            const c = cs.filter((n) => (n.getAttribute('fill') || '').toLowerCase() === head)[k];
            if (!c) return null;
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, [i, PALETTE_HEAD]);
        const linkPaths = () => page.$$eval('#draw .chart svg path', (ps) => ps.map((p) => p.getAttribute('d')));

        const net0 = await netData();
        check('network: getData is keyed by the schema\'s table names',
            !!(net0 && net0.claims && net0.supports), Object.keys(net0 || {}).join(','));
        check('network: both tables seed', net0.claims.length === 3 && net0.supports.length === 2,
            `claims=${net0.claims.length} supports=${net0.supports.length}`);

        // A link's geometry lives in the OTHER table, so moving a node must move it.
        const pathsBefore = await linkPaths();
        const n0 = await nodeAt(0);
        await page.mouse.move(n0.x, n0.y);
        await page.mouse.down();
        await page.mouse.move(n0.x + 40, n0.y - 30, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const movedData = await netData();
        check('network: dragging a node writes only the node table',
            movedData.claims[0].x !== net0.claims[0].x
            && JSON.stringify(movedData.supports) === JSON.stringify(net0.supports),
            JSON.stringify(movedData.claims[0]));
        check('network: its links follow on the same frame',
            JSON.stringify(await linkPaths()) !== JSON.stringify(pathsBefore));

        // connect: a drag on the NODE mark appends to the LINK table.
        const a = await nodeAt(1);
        const b2 = await nodeAt(2);
        await page.keyboard.down('Shift');
        await page.mouse.move(a.x, a.y);
        await page.mouse.down();
        await page.mouse.move(b2.x, b2.y, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(250);
        const linked = await netData();
        check('network: connect appends exactly one link',
            linked.supports.length === movedData.supports.length + 1, JSON.stringify(linked.supports));
        check('network: connect leaves the node table untouched',
            linked.claims.length === movedData.claims.length, `claims=${linked.claims.length}`);

        // Shift-drag into empty space must commit nothing.
        const plotBox = await page.$eval('#draw .chart svg', (svg) => {
            const r = svg.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        const n1 = await nodeAt(0);
        await page.keyboard.down('Shift');
        await page.mouse.move(n1.x, n1.y);
        await page.mouse.down();
        await page.mouse.move(plotBox.x + plotBox.w - 8, plotBox.y + plotBox.h - 8, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(250);
        check('network: a drag released on empty space appends no link',
            (await netData()).supports.length === linked.supports.length);

        // Plain `create()` mints the identity, because the node table declares a
        // `key` — there is no addNode, and this is the check that says so.
        await page.mouse.click(plotBox.x + plotBox.w * 0.12, plotBox.y + plotBox.h * 0.88);
        await page.waitForTimeout(250);
        const added = await netData();
        const fresh = added.claims[added.claims.length - 1];
        check('network: create() appends a node', added.claims.length === linked.claims.length + 1,
            `claims=${added.claims.length}`);
        check('network: create() mints an identity from the key column, with no keyboard',
            !!fresh && fresh.id != null, JSON.stringify(fresh));
        check('network: create() still applies its own defaults',
            !!fresh && fresh.text === 'New claim', JSON.stringify(fresh));

        // node(): ONE mark, a dot and a label per row. The dot is the composite's
        // last part, which is what makes an x/y edit grab the dot and not the label.
        const dotCount = await page.$$eval('#draw .chart svg circle',
            (cs, head) => cs.filter((c) => (c.getAttribute('fill') || '').toLowerCase() === head).length,
            PALETTE_HEAD);
        const labelCount = await page.$$eval('#draw .chart svg text', (t) => t.length);
        check('node(): a dot per row', dotCount === added.claims.length, `dots=${dotCount}`);
        check('node(): a label per row', labelCount >= added.claims.length, `labels=${labelCount}`);

        // Deleting a node must take its links with it — the schema's `ref` says so,
        // and a dangling link is a dataset defect, not just a drawing one.
        const preDelete = await netData();
        const doomed = preDelete.claims[0].id;
        const stranded = preDelete.supports.filter((l) => l.source === doomed || l.target === doomed).length;
        check('network: the node being deleted has links to strand', stranded > 0, `n=${stranded}`);
        const victim = await nodeAt(0);
        await page.keyboard.down('Alt');
        await page.mouse.click(victim.x, victim.y);
        await page.keyboard.up('Alt');
        await page.waitForTimeout(250);
        const afterDelete = await netData();
        check('network: remove deletes the node',
            afterDelete.claims.length === preDelete.claims.length - 1, `claims=${afterDelete.claims.length}`);
        check('network: remove cascades to its links',
            afterDelete.supports.length === preDelete.supports.length - stranded,
            JSON.stringify(afterDelete.supports));
        check('network: no dangling reference survives',
            afterDelete.supports.every((l) =>
                afterDelete.claims.some((c) => c.id === l.source)
                && afterDelete.claims.some((c) => c.id === l.target)),
            JSON.stringify(afterDelete.supports));

        // rewire: drag a link endpoint handle onto another node (second example).
        await open('/marks/network', '#gestures .chart svg circle');
        await page.locator('#gestures .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const wireEl = '#gestures .chart > div';
        const wireData = () => page.$eval(wireEl, (el) => el.getData());
        const handleAt = (i) => page.$$eval('#gestures .chart svg circle', (cs, k) => {
            const c = cs.filter((n) => (n.getAttribute('fill') || '').toLowerCase() !== '#1f2937')[k];
            if (!c) return null;
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, i);
        const personAt = (i) => page.$$eval('#gestures .chart svg circle', (cs, k) => {
            const c = cs.filter((n) => (n.getAttribute('fill') || '').toLowerCase() === '#1f2937')[k];
            if (!c) return null;
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, i);
        const wireBefore = await wireData();
        const h0 = await handleAt(0);
        const p3 = await personAt(2);
        if (h0 && p3) {
            // The handle shows while its link is hovered; the handle sits on the link.
            await page.mouse.move(h0.x, h0.y);
            await page.waitForTimeout(200);
            await page.mouse.down();
            await page.mouse.move(p3.x, p3.y, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(250);
            const wireAfter = await wireData();
            check('network: rewire re-points the endpoint',
                wireAfter.links[0].source !== wireBefore.links[0].source,
                JSON.stringify(wireAfter.links[0]));
            check('network: rewire adds no row',
                wireAfter.links.length === wireBefore.links.length, `links=${wireAfter.links.length}`);
            check('network: rewire touches no node rows',
                JSON.stringify(wireAfter.nodes) === JSON.stringify(wireBefore.nodes));
        }

        // `table` on an ORDINARY mark. This is what makes `table` a universal option
        // rather than a link() private: a plain barY drawing, and editing, the OTHER
        // table. It only works if every factory passes `table` through (markCommon).
        console.log('\n`table` on an ordinary mark (/schema #table)');
        await open('/schema', '#table .chart svg');
        await page.locator('#table .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const tblEl = '#table .chart > div';
        const tblData = () => page.$eval(tblEl, (el) => el.getData());
        const tbl0 = await tblData();
        const barCount = await page.$$eval('#table .chart svg rect.mark', (rs) => rs.length);
        check('table: barY({ table }) drew one bar per LINK row',
            barCount === tbl0.links.length, `bars=${barCount} links=${tbl0.links.length}`);
        const linkBar = await page.$eval('#table .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + 6 };
        });
        await page.mouse.move(linkBar.x, linkBar.y);
        await page.mouse.down();
        await page.mouse.move(linkBar.x, linkBar.y + 40, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const tbl1 = await tblData();
        check('table: dragging it writes the LINK table',
            tbl1.links[0].strength !== tbl0.links[0].strength, JSON.stringify(tbl1.links[0]));
        check('table: the node table is untouched',
            JSON.stringify(tbl1.nodes) === JSON.stringify(tbl0.nodes));

        // A `key` is a SCHEMA feature, not a network one: a flat single-table chart
        // gets minted identities from plain create() too.
        console.log('\nA keyed flat table (/schema #ref)');
        await page.locator('#ref .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const keyEl = '#ref .chart > div';
        const keyRows = () => page.$eval(keyEl, (el) => el.getData());
        const keyBefore = await keyRows();
        const keyBox = await page.$eval('#ref .chart svg', (svg) => {
            const r = svg.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        await page.mouse.click(keyBox.x + keyBox.w * 0.5, keyBox.y + keyBox.h * 0.5);
        await page.waitForTimeout(250);
        const keyAfter = await keyRows();
        check('key: create() appends to a flat table', keyAfter.length === keyBefore.length + 1,
            `rows=${keyAfter.length}`);
        check('key: the new row carries an identity, on a chart with no network',
            keyAfter[keyAfter.length - 1] && keyAfter[keyAfter.length - 1].id != null,
            JSON.stringify(keyAfter[keyAfter.length - 1]));
        check('key: the minted identity is unique',
            new Set(keyAfter.map((/** @type {any} */ d) => d.id)).size === keyAfter.length,
            JSON.stringify(keyAfter.map((/** @type {any} */ d) => d.id)));

        // ---- Sticker: a box sized by its text, typed into ------------------
        // Every check here is invisible to typecheck and check:warnings — the page
        // renders either way. The drag one in particular: with `editText` on the
        // LABEL rather than the box, the pick layer's text hit disc sits dead
        // centre of the note and eats the gesture, so a sticker you cannot pick up
        // by its middle is exactly what this catches.
        console.log('\nSticker (/marks/sticker)');
        await open('/marks/sticker', '#editing .chart svg rect.mark');
        await page.locator('#editing .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const stEl = '#editing .chart > div';
        const stData = () => page.$eval(stEl, (el) => el.getData());
        const stickerBoxes = () => page.$$eval('#editing .chart svg rect.mark',
            (rs) => rs.map((r) => ({
                w: +r.getAttribute('width'), h: +r.getAttribute('height'),
                rx: r.getAttribute('rx'),
            })));

        const boxes0 = await stickerBoxes();
        check('sticker: one box per row', boxes0.length === 3, `${boxes0.length} boxes`);
        check('sticker: corners are rounded', boxes0.every((b) => b.rx && +b.rx > 0),
            JSON.stringify(boxes0.map((b) => b.rx)));
        check('sticker: a long note wraps and makes a taller box',
            Math.max(...boxes0.map((b) => b.h)) > Math.min(...boxes0.map((b) => b.h)),
            JSON.stringify(boxes0.map((b) => b.h)));
        check('sticker: the label is ONE node per row, not one per line',
            (await page.$$('#editing .chart svg text.mark')).length === 3);
        check('sticker: a wrapped label paints as tspans',
            (await page.$$('#editing .chart svg text.mark tspan')).length > 1);
        const labelPE = await page.$$eval('#editing .chart svg text.mark',
            (ts) => ts.map((t) => getComputedStyle(t).pointerEvents));
        check('sticker: labels are pointer-transparent, so the box keeps the gesture',
            labelPE.every((v) => v === 'none'), labelPE.join(','));

        // Paint order. A glyph is one OBJECT, so its parts group per ROW: box,
        // label, box, label. Painting feature by feature — every box, then every
        // label — reads fine until two notes overlap, and then the lower note's
        // text sits on top of the upper note's paper. Only the DOM order sees it.
        const stOrder = await page.$$eval('#editing .chart svg g.mark-layer > *',
            (ns) => ns.map((n) => n.tagName.toLowerCase()).join(','));
        check('sticker: each note paints whole (box,label per row), not all boxes then all labels',
            stOrder === 'rect,text,rect,text,rect,text', stOrder);

        // WHERE it lands, not just that it moved. Two bugs live in this gap and
        // both shipped. (1) d3.drag's default subject is the bound datum, so on a
        // node carrying x/y — a rect carries its TOP-LEFT — every drag reported a
        // pointer displaced by that corner, and the note jumped (-w/2, -h/2) the
        // moment you pressed it. (2) An absolute `move` puts the box's CENTRE at
        // the pointer, so grabbing a note near its corner teleports it; the example
        // uses mode:'relative', where the grabbed point stays under the pointer.
        // Both draw a perfectly good chart, so only a measured drag sees them.
        const stBox = () => page.$eval('#editing .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height };
        });
        const st0 = await stData();
        const stFrom = await stBox();
        // Grab well off centre, so an absolute move would be visibly wrong.
        const stGrab = { x: stFrom.cx - stFrom.w / 2 + 8, y: stFrom.cy - stFrom.h / 2 + 6 };
        await page.mouse.move(stGrab.x, stGrab.y);
        await page.mouse.down();
        await page.mouse.move(stGrab.x + 45, stGrab.y - 35, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const stMoved = await stData();
        const stTo = await stBox();
        check('sticker: dragging by the box centre moves the note',
            stMoved[0].x !== st0[0].x || stMoved[0].y !== st0[0].y,
            `${st0[0].x},${st0[0].y} -> ${stMoved[0].x},${stMoved[0].y}`);
        check('sticker: a relative move keeps the grabbed point under the pointer',
            Math.abs(stTo.cx - (stFrom.cx + 45)) < 3 && Math.abs(stTo.cy - (stFrom.cy - 35)) < 3,
            `expected ${(stFrom.cx + 45).toFixed(1)},${(stFrom.cy - 35).toFixed(1)} ` +
            `— got ${stTo.cx.toFixed(1)},${stTo.cy.toFixed(1)}`);

        // Double-click the BODY (not a glyph) and type a second line.
        const stCentre2 = await page.$eval('#editing .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
        await page.mouse.dblclick(stCentre2.x, stCentre2.y);
        await page.waitForTimeout(250);
        check('sticker: double-clicking the body opens the editor',
            !!(await page.$('#editing .chart svg foreignObject.text-editor')));
        const editorTag = await page.$eval('#editing .chart svg foreignObject.text-editor *',
            (n) => n.tagName.toLowerCase()).catch(() => 'none');
        check('sticker: multiline gives a textarea', editorTag === 'textarea', editorTag);
        const editorW = await page.$eval('#editing .chart svg foreignObject.text-editor',
            (n) => +n.getAttribute('width')).catch(() => -1);
        check('sticker: the editor is sized to the box, not the 140px default',
            editorW > 0 && editorW !== 140, `width=${editorW}`);

        // The seed. A sticker's typable surface is its BOX, and a rect paints no
        // text — its string is drawn by a sibling mark — so an editor seeded only
        // from `node.text` opened EMPTY and every double-click silently became
        // "retype the note from scratch". The page looks identical either way.
        const editorSeed = await page.$eval(
            '#editing .chart svg foreignObject.text-editor textarea',
            (n) => /** @type {HTMLTextAreaElement} */ (n).value).catch(() => null);
        check('sticker: the editor opens with the note already in it',
            editorSeed === stMoved[0].note,
            `${JSON.stringify(editorSeed)} vs ${JSON.stringify(stMoved[0].note)}`);
        const editorCaret = await page.$eval(
            '#editing .chart svg foreignObject.text-editor textarea',
            (n) => /** @type {HTMLTextAreaElement} */ (n).selectionStart).catch(() => -1);
        check('sticker: a multiline editor puts the caret at the end, not over everything',
            editorCaret === (editorSeed || '').length, `caret=${editorCaret}`);

        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('one');
        await page.keyboard.press('Enter');
        check('sticker: Enter inserts a newline instead of committing',
            !!(await page.$('#editing .chart svg foreignObject.text-editor')));
        await page.keyboard.type('two');
        await page.keyboard.press('ControlOrMeta+Enter');
        await page.waitForTimeout(300);
        const stTyped = await stData();
        check('sticker: Cmd/Ctrl+Enter commits the typed text',
            stTyped[0].note === 'one\ntwo', JSON.stringify(stTyped[0].note));
        const boxesTyped = await stickerBoxes();
        check('sticker: the box re-sizes to what was typed',
            boxesTyped[0].h !== boxes0[0].h || boxesTyped[0].w !== boxes0[0].w,
            `${boxes0[0].w}x${boxes0[0].h} -> ${boxesTyped[0].w}x${boxesTyped[0].h}`);

        // Clicking the note cycles its colour. `tone` is a `scale: null` column (the
        // datum holds the literal colour), so it resolves NO scale — a cycle that
        // steps only `ch.scale.domain()` finds nothing, returns undefined, and the
        // click does nothing at all with no warning. The domain is the SCHEMA's.
        const stFillOf = () => page.$eval('#editing .chart svg rect.mark',
            (r) => r.getAttribute('fill'));
        const stCentre3 = await page.$eval('#editing .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        });
        const stFill0 = await stFillOf();
        const stTone0 = (await stData())[0].tone;
        await page.mouse.click(stCentre3.x, stCentre3.y);
        await page.waitForTimeout(250);
        const stCycled = await stData();
        check('sticker: clicking a note cycles its colour through the schema domain',
            stCycled[0].tone !== stTone0, `${stTone0} -> ${stCycled[0].tone}`);
        check('sticker: the painted fill follows the cycled column',
            (await stFillOf()) !== stFill0, `${stFill0} -> ${await stFillOf()}`);

        // ---- Sticker: resizing a note re-wraps it -------------------------
        // A pinned `width` is the wrap width too. Wrapping at `maxWidth` while the
        // box is drawn at `width` renders fine and is wrong both ways — the text
        // spills out of a narrowed note, and leaves dead paper in a widened one —
        // so the assertion is on the LINE COUNT, not just the box.
        await page.locator('#resizing .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const stRzEl = '#resizing .chart > div';
        const stRzBox = () => page.$eval('#resizing .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height };
        });
        const stRzLines = () => page.$$eval('#resizing .chart svg text.mark tspan', (t) => t.length);
        const stRz0 = await stRzBox();
        const stRzLines0 = await stRzLines();
        // Shift-drag the right edge inward. `extent` is half the domain span, so the
        // edge tracks the pointer even though the box grows about its centre.
        const stRzEdge = { x: stRz0.cx + stRz0.w / 2 - 4, y: stRz0.cy };
        await page.keyboard.down('Shift');
        await page.mouse.move(stRzEdge.x, stRzEdge.y);
        await page.mouse.down();
        await page.mouse.move(stRzEdge.x - 40, stRzEdge.y, { steps: 10 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(250);
        const stRz1 = await stRzBox();
        const stRzData = await page.$eval(stRzEl, (el) => el.getData());
        // The box grows about its centre, so the WIDTH moves twice as fast as the
        // pointer — which is exactly why the example halves `extent`. Assert the
        // edge, since that is the thing the reader has hold of.
        check('sticker: the dragged edge tracks the pointer',
            Math.abs((stRz1.cx + stRz1.w / 2) - (stRzEdge.x - 40)) < 5,
            `edge ${(stRz1.cx + stRz1.w / 2).toFixed(1)}, pointer ${(stRzEdge.x - 40).toFixed(1)} ` +
            `(w ${stRz0.w} -> ${stRz1.w})`);
        check('sticker: the width lands in the column, not a pixel of chrome',
            Math.abs(stRzData[0].w - stRz1.w) < 1.5, `w=${stRzData[0].w}, box=${stRz1.w}`);
        check('sticker: the box keeps its centre while it resizes',
            Math.abs(stRz1.cx - stRz0.cx) < 2, `${stRz0.cx.toFixed(1)} -> ${stRz1.cx.toFixed(1)}`);
        check('sticker: a narrowed note re-wraps onto more lines and grows taller',
            (await stRzLines()) > stRzLines0 && stRz1.h > stRz0.h,
            `lines ${stRzLines0} -> ${await stRzLines()}, h ${stRz0.h} -> ${stRz1.h}`);

        // ---- Sticker: a band scale re-files a card -------------------------
        await page.locator('#lanes .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const lnEl = '#lanes .chart > div';
        const ln0 = await page.$eval(lnEl, (el) => el.getData());
        const lnBox = await page.$eval('#lanes .chart svg rect.mark', (r) => {
            const b = r.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        });
        await page.mouse.move(lnBox.cx, lnBox.cy);
        await page.mouse.down();
        await page.mouse.move(lnBox.cx + 150, lnBox.cy, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(250);
        const ln1 = await page.$eval(lnEl, (el) => el.getData());
        check('sticker: dragging a card across writes the new category',
            ln1[0].lane !== ln0[0].lane && ln1[0].lane === 'Next',
            `${ln0[0].lane} -> ${ln1[0].lane}`);
        check('sticker: the other cards stay where they were',
            ln1.slice(1).every((/** @type {any} */ d, /** @type {number} */ i) => d.lane === ln0[i + 1].lane),
            JSON.stringify(ln1.map((/** @type {any} */ d) => d.lane)));

        // ---- Diagram board: directed, curved, reversible -------------------
        console.log('\nDiagram board (/marks/sticker#diagram)');
        await open('/marks/sticker', '#diagram .chart svg rect.mark');
        await page.locator('#diagram .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const dgEl = '#diagram .chart > div';
        const dgData = () => page.$eval(dgEl, (el) => el.getData());
        // A link emits a transparent HIT path plus its visible body; the arrowheads
        // are closed sub-paths with no stroke.
        const dgPaths = () => page.$$eval('#diagram .chart svg path',
            (ps) => ps.map((p) => ({ d: p.getAttribute('d'), stroke: p.getAttribute('stroke') })));

        const paths0 = await dgPaths();
        const hitPaths = paths0.filter((p) => p.stroke === 'transparent');
        check('diagram: every link gets a hit path, so its BODY is clickable',
            hitPaths.length === 3, `${hitPaths.length} hit paths`);
        const heads = paths0.filter((p) => p.stroke === 'none' && (p.d || '').endsWith('Z'));
        check('diagram: directed: true draws arrowheads with no `arrow` option set',
            heads.length === 3, `${heads.length} heads`);
        const bodies = paths0.filter((p) => p.stroke && p.stroke !== 'transparent' && p.stroke !== 'none');
        check('diagram: reciprocal links draw two distinct paths, not one on top of another',
            new Set(bodies.map((p) => p.d)).size === bodies.length,
            `${bodies.length} bodies, ${new Set(bodies.map((p) => p.d)).size} distinct`);

        // Alt-click a link BODY to reverse it — the point of the hit path.
        const dg0 = await dgData();
        const linkPt = await page.$$eval('#diagram .chart svg path', (ps) => {
            const p = ps.filter((n) => n.getAttribute('stroke') === 'transparent')[2];
            if (!p) return null;
            const at = p.getPointAtLength(p.getTotalLength() / 2);
            const sp = p.ownerSVGElement.createSVGPoint();
            sp.x = at.x; sp.y = at.y;
            const s = sp.matrixTransform(p.getScreenCTM());
            return { x: s.x, y: s.y };
        });
        await page.keyboard.down('Alt');
        await page.mouse.click(linkPt.x, linkPt.y);
        await page.keyboard.up('Alt');
        await page.waitForTimeout(300);
        const dgRev = await dgData();
        check('diagram: alt-clicking a link body reverses it',
            dgRev.flows[2].source === dg0.flows[2].target
            && dgRev.flows[2].target === dg0.flows[2].source,
            `${dg0.flows[2].source}->${dg0.flows[2].target} became ${dgRev.flows[2].source}->${dgRev.flows[2].target}`);

        // Click the same body without Alt: the other click edit on the mark steps
        // `kind`, which is what makes a connector switch between elbow and curve.
        const dgCycled = await (async () => {
            const pt = await page.$$eval('#diagram .chart svg path', (ps) => {
                const p = ps.filter((n) => n.getAttribute('stroke') === 'transparent')[2];
                if (!p) return null;
                const at = p.getPointAtLength(p.getTotalLength() / 2);
                const s = new DOMPoint(at.x, at.y).matrixTransform(p.getScreenCTM());
                return { x: s.x, y: s.y };
            });
            await page.mouse.click(pt.x, pt.y);
            await page.waitForTimeout(300);
            return dgData();
        })();
        check('diagram: clicking a link body cycles its curve column',
            dgCycled.flows[2].kind !== dgRev.flows[2].kind,
            `${dgRev.flows[2].kind} -> ${dgCycled.flows[2].kind}`);

        // Ports: the dots on a box's edges, hidden until the box is hovered, and the
        // grab targets for `connect`. A drag from a dot writes its side on the new
        // link; a drop on a dot writes the target's; a drop on a body writes null.
        // Each is a geometry-and-data fact the page renders either way.
        const dgBoxes = () => page.$$eval('#diagram .chart svg rect.mark', (rs) => rs.map((r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        }));
        // Every port circle: screen position, opacity, and which box edge it sits on.
        const dgPorts = () => page.evaluate(() => {
            const boxes = [...document.querySelectorAll('#diagram .chart svg rect.mark')]
                .map((r) => r.getBoundingClientRect());
            return [...document.querySelectorAll('#diagram .chart svg circle[data-channel="port"]')].map((c) => {
                const b = c.getBoundingClientRect();
                const cx = b.x + b.width / 2;
                const cy = b.y + b.height / 2;
                let box = -1;
                let side = null;
                boxes.forEach((r, i) => {
                    const mid = { top: [r.x + r.width / 2, r.y], bottom: [r.x + r.width / 2, r.y + r.height],
                        left: [r.x, r.y + r.height / 2], right: [r.x + r.width, r.y + r.height / 2] };
                    for (const [name, [mx, my]] of Object.entries(mid)) {
                        if (Math.hypot(mx - cx, my - cy) < 3) { box = i; side = name; }
                    }
                });
                return { cx, cy, box, side, opacity: +getComputedStyle(c).opacity };
            }).filter((p) => p.box >= 0);
        });
        const ports0 = await dgPorts();
        check('diagram: `ports: true` puts four dots per box, each on an edge midpoint',
            ports0.length === 12 && ports0.every((p) => p.box >= 0 && p.side),
            JSON.stringify(ports0.map((p) => [p.box, p.side])));
        check('diagram: the dots are hidden until a box is hovered',
            ports0.every((p) => p.opacity === 0), JSON.stringify(ports0.map((p) => p.opacity)));
        const bx = await dgBoxes();
        await page.mouse.move(bx[0].cx, bx[0].cy);
        await page.waitForTimeout(150);
        const ports1 = await dgPorts();
        check('diagram: hovering a box shows its four dots and no others',
            ports1.filter((p) => p.box === 0).every((p) => p.opacity === 1)
            && ports1.filter((p) => p.box !== 0).every((p) => p.opacity === 0),
            JSON.stringify(ports1.map((p) => [p.box, p.opacity])));

        // Hovering a dot rings THAT dot. The hovered outline used to land on the
        // first node of the row — the top dot, whichever one the pointer was on —
        // which read as "only the top port is live".
        const rightDot = ports1.find((p) => p.box === 0 && p.side === 'right');
        await page.mouse.move(rightDot.cx, rightDot.cy);
        await page.waitForTimeout(150);
        const ring = await page.evaluate(([rx, ry]) => {
            const rings = [...document.querySelectorAll('#diagram .chart svg circle')]
                .filter((c) => c.getAttribute('fill') === 'none' || getComputedStyle(c).fill === 'none')
                .map((c) => { const b = c.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
            return rings.map((r) => +Math.hypot(r.x - rx, r.y - ry).toFixed(1));
        }, [rightDot.cx, rightDot.cy]);
        check('diagram: hovering the right dot rings the right dot, not the top one',
            ring.some((d) => d < 2), JSON.stringify(ring));

        // Drag from box 0's right dot, out into empty space (a dashed band must
        // already be there), then onto box 2's left dot.
        const portOf = (ports, box, side) => ports.find((p) => p.box === box && p.side === side);
        const from = portOf(ports1, 0, 'right');
        const dgBefore = await dgData();
        await page.mouse.move(from.cx, from.cy);
        await page.waitForTimeout(100);
        await page.mouse.down();
        const midX = (bx[0].cx + bx[2].cx) / 2;
        const midY = Math.min(bx[0].y, bx[2].y) - 40; // above both boxes: nothing to land on
        await page.mouse.move(midX, midY, { steps: 8 });
        await page.waitForTimeout(100);
        const band = await page.$$eval('#diagram .chart svg path', (ps) => ps
            .filter((p) => getComputedStyle(p).pointerEvents === 'none' && p.getAttribute('stroke-dasharray'))
            .map((p) => ({ len: +p.getTotalLength().toFixed(0) })));
        check('diagram: a dashed band follows the pointer before any target is near',
            band.length === 1 && band[0].len > 40, JSON.stringify(band));
        const ports2 = await dgPorts();
        const to = portOf(ports2, 2, 'left');
        await page.mouse.move(to.cx, to.cy, { steps: 8 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(350);
        const dgLinked = await dgData();
        const made = dgLinked.flows[dgLinked.flows.length - 1] || {};
        check('diagram: dragging dot to dot appends exactly one connector',
            dgLinked.flows.length === dgBefore.flows.length + 1,
            `${dgBefore.flows.length} -> ${dgLinked.flows.length}`);
        check('diagram: the new connector joins the two boxes it was dragged between',
            made.source === dgBefore.steps[0].id && made.target === dgBefore.steps[2].id,
            JSON.stringify(made));
        check('diagram: a dot-to-dot link records both sides',
            made.fromSide === 'right' && made.toSide === 'left', JSON.stringify(made));
        check('diagram: connect defaults fill the new row\'s own columns',
            made.kind === 'orthogonal', JSON.stringify(made));
        check('diagram: no ghost survives the drag that made the connector',
            (await page.$$eval('#diagram .chart svg path',
                (ps) => ps.filter((p) => getComputedStyle(p).pointerEvents === 'none').length)) === 0,
            'a parked proposal was left on screen');
        // The pinned link leaves the edge it recorded.
        const pinnedEnds = await page.evaluate(() => {
            const boxes = [...document.querySelectorAll('#diagram .chart svg rect.mark')].map((r) => r.getBBox());
            const bodies = [...document.querySelectorAll('#diagram .chart svg path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            const p = bodies[bodies.length - 1];
            const a = p.getPointAtLength(0);
            const z = p.getPointAtLength(p.getTotalLength());
            const r0 = boxes[0];
            const r2 = boxes[2];
            // Each end stops `inset` + the arrowhead (10px) off its edge.
            return {
                leavesRight: Math.abs(a.x - (r0.x + r0.width)) < 16,
                entersLeft: Math.abs(z.x - r2.x) < 16,
                end: { x: +z.x.toFixed(1), y: +z.y.toFixed(1) }, left: +r2.x.toFixed(1),
            };
        });
        check('diagram: the pinned link leaves the right edge and enters the left one',
            pinnedEnds.leavesRight && pinnedEnds.entersLeft, JSON.stringify(pinnedEnds));

        // A drop on a BODY leaves that end sliding: from box 2's bottom dot to box
        // 0's centre. (Not box 1: the reverse check above turned s2→s3 into s3→s2,
        // and connect refuses a link that already exists.)
        await page.mouse.move(bx[2].cx, bx[2].cy);
        await page.waitForTimeout(150);
        const ports3 = await dgPorts();
        const from2 = portOf(ports3, 2, 'bottom');
        await page.mouse.move(from2.cx, from2.cy);
        await page.waitForTimeout(100);
        await page.mouse.down();
        await page.mouse.move(bx[0].cx, bx[0].cy, { steps: 12 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(350);
        const dgLinked2 = await dgData();
        const made2 = dgLinked2.flows[dgLinked2.flows.length - 1] || {};
        check('diagram: a drop on a box body records a null side for that end',
            dgLinked2.flows.length === dgLinked.flows.length + 1
            && made2.fromSide === 'bottom' && made2.toSide === null,
            JSON.stringify(made2));

        // A sliding end moves with the node, continuously: nudge box 1 and the
        // sliding end's anchor moves by about as much.
        const slidingEnd = () => page.evaluate(() => {
            const bodies = [...document.querySelectorAll('#diagram .chart svg path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            const p = bodies[bodies.length - 1];
            const z = p.getPointAtLength(p.getTotalLength());
            return { x: z.x, y: z.y };
        });
        const end0 = await slidingEnd();
        await page.mouse.move(bx[0].cx, bx[0].cy);
        await page.mouse.down();
        await page.mouse.move(bx[0].cx + 3, bx[0].cy, { steps: 3 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const end1 = await slidingEnd();
        check('diagram: a sliding end follows a small nudge without jumping',
            Math.hypot(end1.x - end0.x, end1.y - end0.y) < 8,
            `${JSON.stringify(end0)} -> ${JSON.stringify(end1)}`);

        // ---- Orthogonal routing: docked to the BOX, not to the chord ---------
        // The whole point of the kind. A `step` turns on the straight line between
        // two node POSITIONS, so it meets a sticker wherever that line crosses it —
        // usually along an edge and often inside the paper. These assert the three
        // things that stop being true the moment the router regresses to the chord.
        //
        // `#diagram`'s links dock to the box the sticker itself declares, so this also
        // proves the box rule reaches `link` — without it a link docks to a 24px
        // square at the node's centre, well inside the paper.
        const orthoEnds = () => page.evaluate(() => {
            const svg = document.querySelector('#diagram .chart svg');
            const boxes = [...svg.querySelectorAll('rect.mark')].map((r) => {
                const b = r.getBBox();
                return { x: b.x, y: b.y, w: b.width, h: b.height };
            });
            // The visible connector bodies: stroked, not the transparent hit path.
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            return bodies.map((p) => {
                const len = p.getTotalLength();
                const a = p.getPointAtLength(0);
                const b = p.getPointAtLength(1);
                const z = p.getPointAtLength(len);
                // Distance from each endpoint to the nearest box's EDGE, and to the
                // nearest box's centre. On the chord the first is large; docked, small.
                const edge = Math.min(...boxes.map((r) => {
                    const dx = Math.max(r.x - a.x, 0, a.x - (r.x + r.w));
                    const dy = Math.max(r.y - a.y, 0, a.y - (r.y + r.h));
                    return Math.hypot(dx, dy);
                }));
                const centre = Math.min(...boxes.map(
                    (r) => Math.hypot(a.x - (r.x + r.w / 2), a.y - (r.y + r.h / 2))));
                // Is the first millimetre of travel axis-aligned? A perpendicular
                // exit leaves along x or y, never on a diagonal.
                const square = Math.abs(b.x - a.x) < 0.5 || Math.abs(b.y - a.y) < 0.5;
                return { edge, centre, square, start: { x: a.x, y: a.y }, end: { x: z.x, y: z.y } };
            });
        });
        const ends0 = await orthoEnds();
        check('orthogonal: a connector starts ON a box edge, not at the node centre',
            ends0.length > 0 && ends0.every((e) => e.edge < 12 && e.centre > 12),
            JSON.stringify(ends0.map((e) => ({ edge: +e.edge.toFixed(1), centre: +e.centre.toFixed(1) }))));
        check('orthogonal: it leaves that edge square-on, not along the chord',
            ends0.every((e) => e.square),
            JSON.stringify(ends0.map((e) => e.square)));

        // Relative position chooses the sides, so moving a box far enough to change
        // which axis separates the two must re-route the connector onto new edges.
        const dgBoxes2 = await dgBoxes();
        const routeBefore = await orthoEnds();
        await page.mouse.move(dgBoxes2[0].cx, dgBoxes2[0].cy);
        await page.mouse.down();
        await page.mouse.move(dgBoxes2[1].cx, dgBoxes2[1].cy - 150, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const routeAfter = await orthoEnds();
        check('orthogonal: moving a node re-routes onto the edges now facing',
            JSON.stringify(routeBefore.map((e) => e.start))
            !== JSON.stringify(routeAfter.map((e) => e.start)),
            'the anchors did not move with the node');
        check('orthogonal: the re-routed ends are still on an edge, still square-on',
            routeAfter.every((e) => e.edge < 12 && e.square),
            JSON.stringify(routeAfter.map((e) => ({ edge: +e.edge.toFixed(1), square: e.square }))));

        // ---- Network: the sections that were prose-only ---------------------
        console.log('\nNetwork examples (/marks/network)');
        await open('/marks/network', '#schema .chart svg');
        const nwData = (id) => page.$eval(`#${id} .chart > div`, (el) => el.getData());
        // Midpoint of every link body that is drawn and grabbable.
        const nwBodies = (id) => page.evaluate((sec) => {
            const ps = [...document.querySelectorAll(`#${sec} .chart svg path`)].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent'
                    && getComputedStyle(p).pointerEvents !== 'none';
            });
            return ps.map((p) => {
                const at = p.getPointAtLength(p.getTotalLength() / 2);
                const q = new DOMPoint(at.x, at.y).matrixTransform(p.getScreenCTM());
                return { x: q.x, y: q.y };
            });
        }, id);

        // A links table seeded `[]` — the "build it entirely by gesture" claim.
        await page.locator('#schema .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const emptyDots = await page.$$eval('#schema .chart svg circle.mark', (cs) => cs.map((c) => {
            const b = c.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        }));
        check('network: an empty links table starts with no connectors',
            (await nwData('schema')).links.length === 0);
        await page.keyboard.down('Shift');
        await page.mouse.move(emptyDots[0].cx, emptyDots[0].cy);
        await page.mouse.down();
        await page.mouse.move((emptyDots[0].cx + emptyDots[1].cx) / 2, (emptyDots[0].cy + emptyDots[1].cy) / 2, { steps: 8 });
        await page.mouse.move(emptyDots[1].cx, emptyDots[1].cy, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Shift');
        await page.waitForTimeout(350);
        const emptyAfter = await nwData('schema');
        check('network: shift-drag builds the first link on a chart seeded with none',
            emptyAfter.links.length === 1, JSON.stringify(emptyAfter.links));
        check('network: the drawn connector appears with it',
            (await page.$$eval('#schema .chart svg path', (ps) => ps.length)) >= 2,
            'no path drawn for the new link');

        // directed: true — arrowheads, and reverse on the links table.
        await page.locator('#directed .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const dirHeads = await page.$$eval('#directed .chart svg path',
            (ps) => ps.filter((p) => (p.getAttribute('d') || '').endsWith('Z')
                && p.getAttribute('stroke') === 'none').length);
        check('network: directed: true draws an arrowhead per link',
            dirHeads === 3, `${dirHeads} heads`);
        const dirBefore = await nwData('directed');
        const dirPts = await nwBodies('directed');
        await page.keyboard.down('Alt');
        await page.mouse.click(dirPts[0].x, dirPts[0].y);
        await page.keyboard.up('Alt');
        await page.waitForTimeout(300);
        const dirAfter = await nwData('directed');
        check('network: alt-click reverses a directed link',
            dirAfter.links.some((/** @type {any} */ l, /** @type {number} */ i) =>
                l.source === dirBefore.links[i].target && l.target === dirBefore.links[i].source),
            JSON.stringify(dirAfter.links));

        // A `kind` column driving `curve`, cycled by a click.
        await page.locator('#curves .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const curveLabels = await page.$$eval('#curves .chart svg text.mark', (ts) => ts.map((t) => t.textContent));
        check('network: each connector is labelled with its own curve kind',
            curveLabels.join(',') === 'step,stepBefore,stepAfter,arc,bezier', curveLabels.join(','));
        // The GEOMETRY, not the labels. A shape gallery whose rows all render as the
        // same straight line labels itself perfectly and reads as broken — which is
        // what a level chord (every step is degenerate on one) plus `curvature: "auto"`
        // (a lone arc has no bow) produced. Measure each body's departure from its own
        // chord, and that no two bodies trace the same path.
        const curveGeom = await page.evaluate(() => {
            const ps = [...document.querySelectorAll('#curves .chart svg path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            return ps.map((p) => {
                const L = p.getTotalLength();
                const a = p.getPointAtLength(0);
                const b = p.getPointAtLength(L);
                const vx = b.x - a.x, vy = b.y - a.y;
                const len = Math.hypot(vx, vy) || 1;
                let bow = 0;
                for (let i = 1; i < 20; i++) {
                    const q = p.getPointAtLength((L * i) / 20);
                    const dist = Math.abs((q.x - a.x) * vy - (q.y - a.y) * vx) / len;
                    if (dist > bow) bow = dist;
                }
                return { d: p.getAttribute('d'), bow };
            });
        });
        check('network: the gallery draws five connectors',
            curveGeom.length === 5, `${curveGeom.length} bodies`);
        check('network: no two connector kinds trace the same path',
            new Set(curveGeom.map((g) => g.d)).size === curveGeom.length,
            `${new Set(curveGeom.map((g) => g.d)).size} distinct of ${curveGeom.length}`);
        check('network: every kind departs from its own chord, so none reads as a straight line',
            curveGeom.every((g) => g.bow > 2),
            JSON.stringify(curveGeom.map((g) => +g.bow.toFixed(1))));
        const curvePts = await nwBodies('curves');
        const curves0 = await nwData('curves');
        await page.mouse.click(curvePts[0].x, curvePts[0].y);
        await page.waitForTimeout(300);
        const curves1 = await nwData('curves');
        check('network: clicking a connector steps it to the next curve kind',
            curves1.links[0].kind !== curves0.links[0].kind,
            `${curves0.links[0].kind} -> ${curves1.links[0].kind}`);

        // Ports on the network page. Three charts: a sticker board whose links leave
        // by the right and arrive by the left; a dot network you reconnect by the
        // ends; and a board whose ports a constraint and a per-row value limit.
        // What is checked is what only a browser shows: which dots are VISIBLE at
        // each moment, where they sit, and the rows a drag writes.
        await page.locator('#ports .chart svg').first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const portsData = (k = 0) => page.evaluate((i) => document.querySelectorAll('#ports .chart > div')[i].getData(), k);
        // Every port (`data-channel="port"`), and which note edge it sits on. A link's
        // end handle sits on the same spot, so geometry alone cannot tell them apart.
        const portDots = (k = 0, sec = '#ports') => page.evaluate(([i, sel]) => {
            const svg = document.querySelectorAll(`${sel} .chart svg`)[i];
            const boxes = [...svg.querySelectorAll('rect.mark')].map((r) => r.getBoundingClientRect());
            return [...svg.querySelectorAll('circle[data-channel="port"]')].map((c) => {
                const b = c.getBoundingClientRect();
                const cx = b.x + b.width / 2;
                const cy = b.y + b.height / 2;
                let box = -1;
                let side = null;
                boxes.forEach((r, j) => {
                    const mid = { top: [r.x + r.width / 2, r.y], bottom: [r.x + r.width / 2, r.y + r.height],
                        left: [r.x, r.y + r.height / 2], right: [r.x + r.width, r.y + r.height / 2] };
                    for (const [name, [mx, my]] of Object.entries(mid)) {
                        if (Math.hypot(mx - cx, my - cy) < 3) { box = j; side = name; }
                    }
                });
                return { cx, cy, box, side, shown: +getComputedStyle(c).opacity > 0.5 };
            }).filter((p) => p.box >= 0);
        }, [k, sec]);
        const noteCentres = (k = 0, sec = '#ports') => page.evaluate(([i, sel]) => [...document.querySelectorAll(`${sel} .chart svg`)[i]
            .querySelectorAll('rect.mark')].map((r) => {
            const b = r.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }), [k, sec]);
        const shownOf = (dots) => dots.filter((p) => p.shown).map((p) => `${p.box}:${p.side}`).sort();

        const pd0 = await portDots();
        check('ports: `{ out: right, in: left }` puts a dot on the right and left of every note',
            pd0.length === 8 && pd0.every((p) => p.side === 'right' || p.side === 'left'),
            JSON.stringify(pd0.map((p) => [p.box, p.side])));
        check('ports: every dot is hidden at rest', pd0.every((p) => !p.shown), JSON.stringify(shownOf(pd0)));
        const nc = await noteCentres();
        await page.mouse.move(nc[0].x, nc[0].y);
        await page.waitForTimeout(200);
        const pd1 = await portDots();
        check('ports: hovering a note shows only the dot a link can LEAVE by',
            JSON.stringify(shownOf(pd1)) === JSON.stringify(['0:right']), JSON.stringify(shownOf(pd1)));

        // The pinned link idea→draft leaves exactly at idea's right dot (less inset).
        const pinGap = await page.evaluate(([dx, dy]) => {
            const svg = document.querySelectorAll('#ports .chart svg')[0];
            const p = [...svg.querySelectorAll('path')].filter((n) => {
                const s = n.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            })[0];
            const a = p.getPointAtLength(0);
            const s = new DOMPoint(a.x, a.y).matrixTransform(p.getScreenCTM());
            return Math.hypot(s.x - dx, s.y - dy);
        }, [pd1.find((p) => p.box === 0 && p.side === 'right').cx, pd1.find((p) => p.box === 0 && p.side === 'right').cy]);
        check('ports: a link pinned to an edge leaves from that edge\'s dot',
            pinGap < 6, `${pinGap.toFixed(1)}px from the dot (inset 4)`);

        // Drag from idea's right dot. idea→draft exists, so only review's and ship's
        // left dots may light — and the hidden end handle of idea→draft, sitting on
        // that same dot, must not take the press.
        const pRows0 = await portsData();
        const pFrom = pd1.find((p) => p.box === 0 && p.side === 'right');
        await page.mouse.move(pFrom.cx, pFrom.cy);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(pFrom.cx + 30, pFrom.cy - 40, { steps: 6 });
        await page.waitForTimeout(150);
        const pdDrag = await portDots();
        check('ports: during a drag only the dots a release would accept show',
            JSON.stringify(shownOf(pdDrag).filter((k) => k !== '0:right')) === JSON.stringify(['2:left', '3:left']),
            JSON.stringify(shownOf(pdDrag)));
        const pTo = pdDrag.find((p) => p.box === 3 && p.side === 'left');
        await page.mouse.move(pTo.cx, pTo.cy, { steps: 8 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(350);
        const pRows1 = await portsData();
        const pMade = pRows1.flows[pRows1.flows.length - 1] || {};
        check('ports: a dot-to-dot drag appends one link, writing the columns the link names',
            pRows1.flows.length === pRows0.flows.length + 1
            && pMade.source === 'idea' && pMade.target === 'ship'
            && pMade.fromSide === 'right' && pMade.toSide === 'left',
            JSON.stringify(pMade));
        check('ports: a press on a dot under a hidden end handle connects, not rewires',
            JSON.stringify(pRows1.flows.slice(0, pRows0.flows.length)) === JSON.stringify(pRows0.flows),
            JSON.stringify(pRows1.flows));

        // Rewire. The end handles show only while the connector is hovered; drag the
        // new link's target end onto review's left dot, then drag it into space.
        const handles = () => page.evaluate(() => {
            const svg = document.querySelectorAll('#ports .chart svg')[0];
            return [...svg.querySelectorAll('circle[data-channel="source"], circle[data-channel="target"]')].map((c) => {
                const b = c.getBoundingClientRect();
                return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, shown: +getComputedStyle(c).opacity > 0.5 };
            });
        });
        const hidden0 = await handles();
        check('ports: a connector\'s end handles are hidden until it is hovered',
            hidden0.length >= 2 && hidden0.every((h) => !h.shown), JSON.stringify(hidden0.map((h) => h.shown)));
        const newBody = await page.evaluate(() => {
            const svg = document.querySelectorAll('#ports .chart svg')[0];
            const ps = [...svg.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === 'transparent');
            const p = ps[ps.length - 1];
            const at = p.getPointAtLength(p.getTotalLength() / 2);
            const s = new DOMPoint(at.x, at.y).matrixTransform(p.getScreenCTM());
            return { x: s.x, y: s.y };
        });
        await page.mouse.move(newBody.x, newBody.y);
        await page.waitForTimeout(200);
        const shownHandles = (await handles()).filter((h) => h.shown);
        check('ports: hovering a connector shows a handle at each end',
            shownHandles.length === 2, JSON.stringify(shownHandles));
        // The target end is the one nearer ship.
        const shipLeft = pTo;
        const newEnd = shownHandles.sort((a, b) => Math.hypot(a.cx - shipLeft.cx, a.cy - shipLeft.cy)
            - Math.hypot(b.cx - shipLeft.cx, b.cy - shipLeft.cy))[0];
        await page.mouse.move(newEnd.cx, newEnd.cy, { steps: 4 });
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(newEnd.cx - 20, newEnd.cy - 60, { steps: 6 });
        await page.waitForTimeout(150);
        const pdRewire = await portDots();
        const reviewLeft = pdRewire.find((p) => p.box === 2 && p.side === 'left');
        check('ports: dragging a link\'s end lights the dots it could land on',
            shownOf(pdRewire).includes('2:left') && !shownOf(pdRewire).some((k) => k.endsWith('right')),
            JSON.stringify(shownOf(pdRewire)));
        await page.mouse.move(reviewLeft.cx, reviewLeft.cy, { steps: 8 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        await page.waitForTimeout(350);
        const pRows2 = await portsData();
        const pRe = pRows2.flows[pRows2.flows.length - 1] || {};
        check('ports: dropping a link\'s end on another note\'s dot re-points it',
            pRows2.flows.length === pRows1.flows.length && pRe.source === 'idea' && pRe.target === 'review'
            && pRe.toSide === 'left', JSON.stringify(pRe));

        // Disconnect: the same end, dropped on nothing.
        const reBody = await page.evaluate(() => {
            const svg = document.querySelectorAll('#ports .chart svg')[0];
            const ps = [...svg.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === 'transparent');
            const p = ps[ps.length - 1];
            const at = p.getPointAtLength(p.getTotalLength() * 0.5);
            const s = new DOMPoint(at.x, at.y).matrixTransform(p.getScreenCTM());
            return { x: s.x, y: s.y };
        });
        await page.mouse.move(reBody.x, reBody.y);
        await page.waitForTimeout(200);
        const reHandles = (await handles()).filter((h) => h.shown)
            .sort((a, b) => Math.hypot(a.cx - reviewLeft.cx, a.cy - reviewLeft.cy)
                - Math.hypot(b.cx - reviewLeft.cx, b.cy - reviewLeft.cy));
        if (reHandles[0]) {
            await page.mouse.move(reHandles[0].cx, reHandles[0].cy, { steps: 4 });
            await page.waitForTimeout(150);
            await page.mouse.down();
            const svgBox = await page.locator('#ports .chart svg').first().boundingBox();
            await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height - 6, { steps: 10 });
            await page.waitForTimeout(100);
            await page.mouse.up();
            await page.waitForTimeout(350);
        }
        const pRows3 = await portsData();
        check('ports: dropping a link\'s end on empty space removes the link',
            pRows3.flows.length === pRows2.flows.length - 1
            && !pRows3.flows.some((f) => f.source === 'idea' && f.target === 'review'),
            JSON.stringify(pRows3.flows));

        // Any side to any side: the unpinned ties meet their notes AT a port — an
        // edge midpoint — with no buffer, not wherever the chord leaves the box.
        await page.locator('#ports .chart svg').nth(1).scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const anyEnds = await page.evaluate(() => {
            const svg = document.querySelectorAll('#ports .chart svg')[1];
            const mids = [...svg.querySelectorAll('rect.mark')].flatMap((r) => {
                const b = r.getBBox();
                return [[b.x + b.width / 2, b.y], [b.x + b.width, b.y + b.height / 2],
                    [b.x + b.width / 2, b.y + b.height], [b.x, b.y + b.height / 2]];
            });
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const st = p.getAttribute('stroke');
                return st && st !== 'none' && st !== 'transparent';
            });
            return bodies.flatMap((p) => [p.getPointAtLength(0), p.getPointAtLength(p.getTotalLength())])
                .map((pt) => +Math.min(...mids.map(([x, y]) => Math.hypot(x - pt.x, y - pt.y))).toFixed(1));
        });
        check('ports: with ports on every side, every end meets its note at a port',
            anyEnds.length === 8 && anyEnds.every((d) => d < 1), JSON.stringify(anyEnds));

        // The dot network: ports sit on each dot's own radius (size 10), not on a
        // box the spec restated.
        await page.locator('#recording .chart svg').nth(0).scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const dotGeo = await page.evaluate(() => {
            const svg = document.querySelectorAll('#recording .chart svg')[0];
            const cs = [...svg.querySelectorAll('circle')].map((c) => ({
                x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r'),
            }));
            const dots = cs.filter((c) => c.r === 10);
            const small = cs.filter((c) => c.r === 5);
            const onEdge = small.filter((p) => dots.some((d) => Math.abs(p.y - d.y) < 0.5
                && Math.abs(Math.abs(p.x - d.x) - 10) < 0.5));
            return { dots: dots.length, onEdge: onEdge.length };
        });
        check('ports: on a dot network each port sits on its dot\'s edge',
            dotGeo.dots === 3 && dotGeo.onEdge >= 6, JSON.stringify(dotGeo));

        // Limits: a node already at its constraint's limit, and an end step whose
        // value has no `out`, show no dot at all.
        await page.locator('#recording .chart svg').nth(1).scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        const lc = await noteCentres(1, '#recording');
        await page.mouse.move(lc[0].x, lc[0].y);
        await page.waitForTimeout(200);
        const askDots = shownOf(await portDots(1, '#recording'));
        check('ports: a node at its constraint\'s limit shows no dot', askDots.length === 0, JSON.stringify(askDots));
        await page.mouse.move(lc[3].x, lc[3].y);
        await page.waitForTimeout(200);
        const doneDots = shownOf(await portDots(1, '#recording'));
        check('ports: an end step with no `out` side shows no dot', doneDots.length === 0, JSON.stringify(doneDots));
        await page.mouse.move(lc[1].x, lc[1].y);
        await page.waitForTimeout(200);
        const checkDots = shownOf(await portDots(1, '#recording'));
        check('ports: a step with a link still to make shows its out dot',
            JSON.stringify(checkDots) === JSON.stringify(['1:right']), JSON.stringify(checkDots));

        // Parallel links and loops: a links table declaring `multi` and `selfLoops`
        // lets connect make a second link between one pair and a link from a state
        // to itself; a loop is drawn docked on its node, not from its centre.
        await page.locator('#multi .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const smData = () => page.$eval('#multi .chart > div', (el) => el.getData());
        // The state stickers (label plates are rects too, but short).
        const smBoxes = () => page.$$eval('#multi .chart svg rect.mark', (rs) => rs
            .map((r) => r.getBoundingClientRect())
            .filter((b) => b.height > 30)
            .map((b) => ({ x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 })));
        const smStarts = await page.evaluate(() => {
            const svg = document.querySelector('#multi .chart svg');
            const boxes = [...svg.querySelectorAll('rect.mark')].map((r) => r.getBBox()).filter((b) => b.height > 30);
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const st = p.getAttribute('stroke');
                return st && st !== 'none' && st !== 'transparent' && p.getTotalLength() > 20;
            });
            // How far each body's START is from the nearest sticker outline; negative inside.
            return bodies.map((p) => {
                const pt = p.getPointAtLength(0);
                return +Math.min(...boxes.map((b) => {
                    const dx = Math.max(b.x - pt.x, 0, pt.x - (b.x + b.width));
                    const dy = Math.max(b.y - pt.y, 0, pt.y - (b.y + b.height));
                    const inside = pt.x > b.x + 1 && pt.x < b.x + b.width - 1 && pt.y > b.y + 1 && pt.y < b.y + b.height - 1;
                    return inside ? -1 : Math.hypot(dx, dy);
                })).toFixed(1);
            });
        });
        check('multi: every transition, loops included, leaves from its state\'s outline',
            smStarts.length === 7 && smStarts.every((d) => d >= 0 && d < 1), JSON.stringify(smStarts));

        const smB = await smBoxes();
        const smDrag = async (from, to, via) => {
            await page.mouse.move(from.x - 30, from.y - 30);
            await page.mouse.move(from.hoverX, from.hoverY);
            await page.waitForTimeout(150);
            await page.mouse.move(from.x, from.y);
            await page.waitForTimeout(150);
            await page.mouse.down();
            if (via) await page.mouse.move(via.x, via.y, { steps: 6 });
            await page.mouse.move(to.x, to.y, { steps: 10 });
            await page.waitForTimeout(150);
            await page.mouse.up();
            await page.waitForTimeout(300);
        };
        const [, smClosed, smOpen] = smB;
        // Closed's right port to Open: a second Closed → Open.
        await smDrag(
            { hoverX: smClosed.cx, hoverY: smClosed.cy, x: smClosed.x + smClosed.w, y: smClosed.cy },
            { x: smOpen.cx, y: smOpen.cy + 4 }
        );
        const smAfter1 = await smData();
        check('multi: connect adds a second link between a pair that already has one',
            smAfter1.transitions.length === 8
                && smAfter1.transitions[7].source === 'closed' && smAfter1.transitions[7].target === 'open',
            JSON.stringify(smAfter1.transitions.at(-1)));
        // Open's top port round to its own left port: a loop.
        await smDrag(
            { hoverX: smOpen.cx, hoverY: smOpen.cy, x: smOpen.cx, y: smOpen.y },
            { x: smOpen.x, y: smOpen.cy },
            { x: smOpen.x - 30, y: smOpen.y - 30 }
        );
        const smAfter2 = await smData();
        check('multi: connect from one port of a state to another makes a loop',
            smAfter2.transitions.length === 9
                && smAfter2.transitions[8].source === 'open' && smAfter2.transitions[8].target === 'open',
            JSON.stringify(smAfter2.transitions.at(-1)));
        // A click on a port is not a loop.
        await page.mouse.move(smClosed.cx, smClosed.cy);
        await page.waitForTimeout(150);
        await page.mouse.move(smClosed.cx, smClosed.y + smClosed.h);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(smClosed.cx + 1, smClosed.y + smClosed.h + 1);
        await page.mouse.up();
        await page.waitForTimeout(300);
        check('multi: a click on a port makes no loop', (await smData()).transitions.length === 9);

        // ---- Emoji as nodes (/marks/network#node-marks) ----------------------
        // A plain text mark declares the box of its measured text, so it can draw
        // a network's nodes: four ports per emoji, and a drag between two links them.
        console.log('\nEmoji as nodes (/marks/network#node-marks)');
        await open('/marks/network', '#node-marks .chart svg');
        await page.locator('#node-marks .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const emData = () => page.$eval('#node-marks .chart > div', (el) => el.getData());
        const emGlyphs = await page.$$eval('#node-marks .chart svg text.mark', (ts) => ts.map((t) => {
            const b = t.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        }));
        const emPorts = await page.$$eval('#node-marks .chart svg circle[data-channel="port"]', (cs) => cs.map((c) => {
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }));
        check('emoji nodes: four ports around each emoji', emGlyphs.length === 5 && emPorts.length === 20,
            `${emGlyphs.length} emoji, ${emPorts.length} ports`);
        // happy's left port to angry: a new happy → angry.
        const [, , emAngry, , emHappy] = emGlyphs;
        const emHappyLeft = emPorts.filter((p) => Math.abs(p.y - emHappy.cy) < 6 && p.x < emHappy.cx)
            .sort((p, q) => q.x - p.x)[0];
        await page.mouse.move(emHappy.cx, emHappy.cy);
        await page.waitForTimeout(200);
        await page.mouse.move(emHappyLeft.x, emHappyLeft.y);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(emAngry.cx + 20, emAngry.cy - 20, { steps: 8 });
        await page.mouse.move(emAngry.cx, emAngry.cy, { steps: 6 });
        await page.waitForTimeout(150);
        await page.mouse.up();
        await page.waitForTimeout(300);
        const emLinks = (await emData()).leadsTo;
        check('emoji nodes: dragging from one emoji\'s port to another adds a link',
            emLinks.length === 5 && emLinks[4].source === 'happy' && emLinks[4].target === 'angry',
            JSON.stringify(emLinks.at(-1)));

        // ---- Faces as network nodes (/marks/network#faces) --------------------
        // A box-mode glyph declares its box as the node's shape, so `ports` on a
        // face sits on the head, once per face, and a connect from one face's out
        // port to another face writes a link — beside the face's own move.
        console.log('\nFaces as network nodes (/marks/network#faces)');
        await open('/marks/network', '#faces .chart svg');
        await page.locator('#faces .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const fnData = () => page.$eval('#faces .chart > div', (el) => el.getData());
        const fnHeads = await page.$$eval('#faces .chart svg circle[data-hit]', (cs) => cs.map((c) => {
            const b = c.getBoundingClientRect();
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, r: b.width / 2 };
        }));
        const fnPorts = await page.$$eval('#faces .chart svg circle[data-channel="port"]', (cs) => cs.map((c) => {
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }));
        const fnOnHead = fnPorts.filter((p) => fnHeads.some((h) => Math.abs(Math.hypot(p.x - h.cx, p.y - h.cy) - h.r) < 1.5));
        check('face network: four ports per face, each on its head\'s edge',
            fnHeads.length === 3 && fnPorts.length === 12 && fnOnHead.length === 12,
            `${fnHeads.length} heads, ${fnPorts.length} ports, ${fnOnHead.length} on a head`);
        // Cy's bottom (out) port to Ana: a new cy → ana.
        const [fnAna, , fnCy] = fnHeads;
        await page.mouse.move(fnCy.cx - 8, fnCy.cy - 8);
        await page.waitForTimeout(200);
        await page.mouse.move(fnCy.cx, fnCy.cy + fnCy.r);
        await page.waitForTimeout(150);
        await page.mouse.down();
        await page.mouse.move(fnAna.cx + 30, fnAna.cy + 10, { steps: 8 });
        await page.mouse.move(fnAna.cx, fnAna.cy, { steps: 6 });
        await page.waitForTimeout(150);
        await page.mouse.up();
        await page.waitForTimeout(300);
        const fnLinks = (await fnData()).sways;
        check('face network: dragging from a face\'s port to another face adds a link',
            fnLinks.length === 3 && fnLinks[2].source === 'cy' && fnLinks[2].target === 'ana',
            JSON.stringify(fnLinks));
        const fnBefore = (await fnData()).people[0];
        await mouseDrag(fnAna.cx - fnAna.r * 0.6, fnAna.cy, fnAna.cx - fnAna.r * 0.6 + 30, fnAna.cy);
        const fnAfter = (await fnData()).people[0];
        check('face network: a face still moves by its head', fnAfter.x > fnBefore.x + 3,
            `x ${fnBefore.x} -> ${fnAfter.x}`);

        // Pinned sides. `sourceSide`/`targetSide` are PRESENTATION: read per row like
        // `curve`, held across a move, and — the half worth guarding — never written
        // back. A side that became a column would quietly add a drawing preference to
        // an elicited dataset, and the picture would look identical either way.
        await page.locator('#sides .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const sideEnds = () => page.evaluate(() => {
            const svg = document.querySelector('#sides .chart svg');
            const boxes = [...svg.querySelectorAll('rect.mark')].map((r) => {
                const b = r.getBBox();
                return { x: b.x, y: b.y, w: b.width, h: b.height };
            });
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            // Which edge of the nearest box each endpoint sits on.
            const sideOf = (pt) => {
                let best = null;
                let bestD = Infinity;
                for (const r of boxes) {
                    for (const [name, d] of [
                        ['left', Math.abs(pt.x - r.x)], ['right', Math.abs(pt.x - (r.x + r.w))],
                        ['top', Math.abs(pt.y - r.y)], ['bottom', Math.abs(pt.y - (r.y + r.h))],
                    ]) {
                        const inSpan = name === 'left' || name === 'right'
                            ? pt.y > r.y - 4 && pt.y < r.y + r.h + 4
                            : pt.x > r.x - 4 && pt.x < r.x + r.w + 4;
                        if (inSpan && d < bestD) { bestD = d; best = name; }
                    }
                }
                return best;
            };
            return bodies.map((p) => ({
                from: sideOf(p.getPointAtLength(0)),
                to: sideOf(p.getPointAtLength(p.getTotalLength())),
            }));
        });
        const sidesData = () => page.evaluate(() => {
            return document.querySelector('#sides .chart > div').getData();
        });
        const sides0 = await sideEnds();
        const sidesRows0 = await sidesData();
        check('network: a pinned sourceSide leaves the edge it names',
            sides0.length > 0 && sides0.every((s) => s.from === 'right' && s.to === 'left'),
            JSON.stringify(sides0));
        // Drag a stage well past its neighbour. `auto` would swap the sides; pinned
        // must not.
        const sideBoxes = await page.evaluate(() => {
            const svg = document.querySelector('#sides .chart svg');
            return [...svg.querySelectorAll('rect.mark')].map((r) => {
                const b = r.getBoundingClientRect();
                return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
            });
        });
        await page.mouse.move(sideBoxes[0].cx, sideBoxes[0].cy);
        await page.mouse.down();
        await page.mouse.move(sideBoxes[1].cx + 120, sideBoxes[1].cy, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const sides1 = await sideEnds();
        const sidesRows1 = await sidesData();
        check('network: a pinned side holds when the nodes swap places',
            sides1.every((s) => s.from === 'right' && s.to === 'left'), JSON.stringify(sides1));
        check('network: pinning a side writes nothing to the dataset',
            JSON.stringify(sidesRows1.flows) === JSON.stringify(sidesRows0.flows),
            `${JSON.stringify(sidesRows0.flows)} -> ${JSON.stringify(sidesRows1.flows)}`);

        // Routing. An orthogonal connector chooses its edges by score and routes
        // around other nodes; a near-aligned pair joins straight. These are geometry
        // facts the page renders either way, so each is measured off the real paths.
        await page.locator('#routing .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const routingShapes = () => page.evaluate(() => {
            const svg = document.querySelector('#routing .chart svg');
            const boxes = [...svg.querySelectorAll('rect.mark')].map((r) => {
                const b = r.getBBox();
                return { x: b.x, y: b.y, w: b.width, h: b.height };
            });
            const bodies = [...svg.querySelectorAll('path')].filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            });
            return bodies.map((p) => {
                const len = p.getTotalLength();
                // Every 2px along the body: is any sample INSIDE a box? The ends
                // stop `inset` px off an edge, so a clean route has none.
                let inside = 0;
                for (let t = 0; t <= len; t += 2) {
                    const q = p.getPointAtLength(t);
                    if (boxes.some((r) => q.x > r.x + 1 && q.x < r.x + r.w - 1
                        && q.y > r.y + 1 && q.y < r.y + r.h - 1)) inside++;
                }
                const a = p.getPointAtLength(0);
                const b = p.getPointAtLength(1);
                const y = p.getPointAtLength(len - 1);
                const z = p.getPointAtLength(len);
                const square = (Math.abs(b.x - a.x) < 0.5 || Math.abs(b.y - a.y) < 0.5)
                    && (Math.abs(z.x - y.x) < 0.5 || Math.abs(z.y - y.y) < 0.5);
                // One leg: the path has a single L after its M.
                const straight = (p.getAttribute('d') || '').split('L').length === 2;
                return { len: +len.toFixed(1), inside, square, straight };
            });
        });
        const routing0 = await routingShapes();
        check('routing: three connectors drawn',
            routing0.length === 3, JSON.stringify(routing0));
        check('routing: no connector runs through a box',
            routing0.every((r) => r.inside === 0), JSON.stringify(routing0));
        check('routing: every connector leaves and arrives square-on',
            routing0.every((r) => r.square), JSON.stringify(routing0));
        check('routing: the near-aligned pair joins with one straight leg',
            routing0.some((r) => r.straight), JSON.stringify(routing0));
        // Drag the node out of the corridor: the long connector takes a shorter
        // route and still crosses nothing.
        const reviewBox = await page.evaluate(() => {
            const svg = document.querySelector('#routing .chart svg');
            const rects = [...svg.querySelectorAll('rect.mark')]
                .map((r) => r.getBoundingClientRect())
                .sort((a, b) => b.height - a.height);
            const b = rects[0];
            return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
        });
        await page.mouse.move(reviewBox.cx, reviewBox.cy);
        await page.mouse.down();
        await page.mouse.move(reviewBox.cx + 230, reviewBox.cy - 50, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        const routing1 = await routingShapes();
        const longest = (rs) => Math.max(...rs.map((r) => r.len));
        check('routing: moving the obstacle away shortens the detour',
            longest(routing1) < longest(routing0),
            `${longest(routing0)} -> ${longest(routing1)}`);
        check('routing: the re-routed connectors still cross nothing, still square-on',
            routing1.every((r) => r.inside === 0 && r.square), JSON.stringify(routing1));

        // A link's own columns: width, colour, and a label you can retype.
        await page.locator('#attributes .chart svg').scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const tieWidths = await page.$$eval('#attributes .chart svg path',
            (ps) => ps.filter((p) => {
                const s = p.getAttribute('stroke');
                return s && s !== 'none' && s !== 'transparent';
            }).map((p) => +p.getAttribute('stroke-width')));
        check('network: a link column drives stroke width',
            new Set(tieWidths).size > 1, JSON.stringify(tieWidths));
        // The label is not the line. resolveStyle sweeps the style channels onto
        // EVERY node a mark emits, so a connector's `stroke`/`strokeWidth` used to
        // outline each glyph of its own label — legible enough to pass a text check,
        // and visibly wrong. Only `fill` reaches the label now.
        const tieLabels = await page.$$eval('#attributes .chart svg text.mark',
            (ts) => ts.map((t) => ({
                text: t.textContent,
                stroke: t.getAttribute('stroke') || getComputedStyle(t).stroke,
                strokeWidth: t.getAttribute('stroke-width'),
            })));
        const noteLabels = tieLabels.filter((t) => /worked together|met once|knew at school/.test(t.text || ''));
        check('network: a link label is filled, not stroked',
            noteLabels.length > 0
            && noteLabels.every((t) => !t.strokeWidth && (!t.stroke || t.stroke === 'none' || t.stroke === 'rgb(0, 0, 0)')),
            JSON.stringify(noteLabels));
        // And the plate under it, which is what stops the connector running through
        // the text. It has to be BEHIND the label, so it is emitted first.
        const plates = await page.$$eval('#attributes .chart svg rect.mark',
            (rs) => rs.map((r) => ({
                w: +r.getAttribute('width'), h: +r.getAttribute('height'),
                op: r.getAttribute('fill-opacity'),
            })));
        check('network: labelBackground draws one plate per labelled connector',
            plates.length === 2 && plates.every((p) => p.w > 0 && p.h > 0),
            JSON.stringify(plates));
        check('network: the plate is translucent, so the connector reads through it',
            plates.every((p) => +p.op > 0 && +p.op < 1), JSON.stringify(plates.map((p) => p.op)));
        const plateBehind = await page.$eval('#attributes .chart svg',
            (svg) => {
                const kids = [...svg.querySelectorAll('rect.mark, text.mark')];
                const rect = kids.findIndex((n) => n.tagName.toLowerCase() === 'rect');
                const text = kids.findIndex((n) => n.tagName.toLowerCase() === 'text');
                return rect < text;
            });
        check('network: the plate paints beneath its label', plateBehind);

        const tiePts = await nwBodies('attributes');
        await page.mouse.dblclick(tiePts[0].x, tiePts[0].y);
        await page.waitForTimeout(300);
        check('network: double-clicking a connector opens its label editor',
            !!(await page.$('#attributes .chart svg foreignObject.text-editor')));
        // WHERE it opened. A path node carries no x/y, so the renderer's label-shaped
        // fallback produced x="NaN" and the editor was unplaceable — the page still
        // rendered and the typing still committed, so only reading the attribute sees
        // it. `link` states an `editBox` at the label's midpoint instead.
        const tieEditor = await page.$eval('#attributes .chart svg foreignObject.text-editor',
            (n) => ({ x: +n.getAttribute('x'), y: +n.getAttribute('y'), w: +n.getAttribute('width') }))
            .catch(() => null);
        check('network: the editor is placed on the connector, not at NaN',
            !!tieEditor && Number.isFinite(tieEditor.x) && Number.isFinite(tieEditor.y) && tieEditor.w > 0,
            JSON.stringify(tieEditor));
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('knew at school');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        const tiesTyped = await nwData('attributes');
        check('network: the typed label lands in the link row',
            tiesTyped.ties[0].note === 'knew at school', JSON.stringify(tiesTyped.ties[0]));


        // ---- gallery-findings features --------------------------------------
        /** Drag from (x0,y0) to (x1,y1) in page coordinates. */
        const dragPage = async (x0, y0, x1, y1, steps = 10) => {
            await page.mouse.move(x0, y0);
            await page.mouse.down();
            await page.mouse.move(x1, y1, { steps });
            await page.mouse.up();
            await page.waitForTimeout(150);
        };
        /** Centre of a locator's box. */
        const boxCentre = async (loc) => {
            await loc.scrollIntoViewIfNeeded();
            const b = await loc.boundingBox();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
        };

        // A band sweep paints ONE edge: the one whose handle was nearest at dragstart.
        console.log('\nBand sweep, edge by edge (/editing/sweep)');
        await open('/editing/sweep', '#band svg path.mark-line');
        const bsEl = '#band .chart > div';
        const bsBefore = await page.$eval(bsEl, (e) => e.getData());
        const topHandles = page.locator('#band svg circle[data-channel="y2"]');
        const t0 = await boxCentre(topHandles.nth(1));
        const t3 = await boxCentre(topHandles.nth(4));
        // Hovering just above the top edge outlines a TOP handle — the edge a press
        // there would paint — not the row's first node (its lower edge).
        await page.mouse.move(t0.x, t0.y - 6);
        await page.waitForTimeout(150);
        const outlineY = await page.locator('#band svg circle.effect:not([stroke-dasharray])').first()
            .evaluate((c) => c.getBoundingClientRect().y + c.getBoundingClientRect().height / 2).catch(() => null);
        check('band sweep: hover over the top edge outlines a top handle',
            outlineY != null && Math.abs(outlineY - t0.y) < 3, `outline y ${outlineY}, top handle y ${t0.y}`);
        await dragPage(t0.x, t0.y, t3.x, t0.y - 30, 16);
        const bsAfter = await page.$eval(bsEl, (e) => e.getData());
        const hiMoved = bsAfter.filter((d, i) => Math.abs(d.hi - bsBefore[i].hi) > 0.5).length;
        check('band sweep: dragging along the top edge repaints several highs', hiMoved >= 2, `${hiMoved} highs moved`);
        check('band sweep: every low is untouched', bsAfter.every((d, i) => d.lo === bsBefore[i].lo),
            bsAfter.map((d) => d.lo).join(','));

        // Context rows are drawn, read-only, and not part of the answer.
        console.log('\nContext rows (/editing/existence)');
        await open('/editing/existence', '#context svg path.mark-line');
        const ctxEl = '#context .chart > div';
        const ctxData = await page.$eval(ctxEl, (e) => e.getData());
        check('context: getData() is the bare array of answers', Array.isArray(ctxData) && ctxData.length === 4
            && ctxData.every((d) => d.year > 2020), JSON.stringify(ctxData).slice(0, 80));
        check('context: one line draws record and forecast', (await page.locator('#context svg path.mark-line').count()) === 1);
        // Drag the first record point: it is locked, so the answer is unchanged.
        // A handle draws only where a drag can move its row: the four answers, not
        // the six context rows (`node.rowHandle`, dropped on a locked row).
        const ctxDots = page.locator('#context svg circle.mark:not([data-hit])');
        check('context: only the answer rows draw a handle', (await ctxDots.count()) === 4, `${await ctxDots.count()} handles`);
        // Drag the line where the first record point sits: the answer is unchanged.
        const rec = await page.locator('#context svg path.mark-line').first().evaluate((path) => {
            const p = path.getPointAtLength(0);
            const m = path.getScreenCTM();
            return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
        });
        await dragPage(rec.x, rec.y, rec.x, rec.y - 40);
        const ctxAfterRec = await page.$eval(ctxEl, (e) => e.getData());
        check('context: a record point does not move', JSON.stringify(ctxAfterRec) === JSON.stringify(ctxData));
        // Drag a forecast point: getData() reports it.
        const fc = await boxCentre(ctxDots.nth(1));
        await dragPage(fc.x, fc.y, fc.x, fc.y - 40);
        const ctxAfterFc = await page.$eval(ctxEl, (e) => e.getData());
        check('context: a forecast drag is reported', ctxAfterFc.length === 4 && ctxAfterFc[1].rate > ctxData[1].rate + 0.5,
            `${ctxData[1].rate} -> ${ctxAfterFc[1] && ctxAfterFc[1].rate}`);

        // follow: dragging the mean carries the interval.
        console.log('\nfollow (/constraints)');
        await open('/constraints', '#follow svg circle.mark');
        const flEl = '#follow .chart > div';
        const flBefore = (await page.$eval(flEl, (e) => e.getData()))[0];
        const meanDot = await boxCentre(page.locator('#follow svg circle.mark:not([data-hit])').first());
        await dragPage(meanDot.x, meanDot.y, meanDot.x, meanDot.y - 30);
        const flAfter = (await page.$eval(flEl, (e) => e.getData()))[0];
        const dMean = flAfter.mean - flBefore.mean;
        check('follow: the mean rose', dMean > 0.3, `${flBefore.mean} -> ${flAfter.mean}`);
        check('follow: lo and hi moved by the same delta',
            Math.abs((flAfter.lo - flBefore.lo) - dMean) < 1e-6 && Math.abs((flAfter.hi - flBefore.hi) - dMean) < 1e-6,
            JSON.stringify(flAfter));

        // A tip shows the row under the pointer and never blocks the drag beneath it.
        console.log('\nTips (/guides)');
        await open('/guides', '#tips svg rect.mark');
        const tipBar = await boxCentre(page.locator('#tips svg rect.mark').nth(1));
        await page.mouse.move(tipBar.x, tipBar.y + tipBar.b.height / 4);
        await page.waitForTimeout(200);
        const tipText = await page.locator('#tips svg .guide-front-layer text').allTextContents();
        check('tip: hovering a bar shows its row', tipText.some((t) => /rain/.test(t)), tipText.join(' | '));
        check('tip: its box paints above the marks',
            (await page.locator('#tips svg .guide-front-layer rect.guide-rect').count()) === 1);
        const tipEl = '#tips .chart > div';
        const rainBefore = (await page.$eval(tipEl, (e) => e.getData()))[1].rain;
        await dragPage(tipBar.x, tipBar.b.y + 2, tipBar.x, tipBar.b.y + 40);
        const rainAfter = (await page.$eval(tipEl, (e) => e.getData()))[1].rain;
        check('tip: a drag under the tip still edits', rainAfter < rainBefore, `${rainBefore} -> ${rainAfter}`);

        // A rose's rim: radius is a polar position a move inverts.
        console.log('\nRose plot rim (/marks/arc)');
        await open('/marks/arc', '#radius svg path.mark-line');
        const roseEl = '#radius .chart > div';
        const roseBefore = (await page.$eval(roseEl, (e) => e.getData()))[5].speed;
        const roseSvg = await boxCentre(page.locator('#radius svg').first());
        const slice = await boxCentre(page.locator('#radius svg path.mark-line').nth(5));
        const vx = slice.x - roseSvg.x, vy = slice.y - roseSvg.y, vl = Math.hypot(vx, vy) || 1;
        await dragPage(slice.x, slice.y, slice.x + (vx / vl) * 40, slice.y + (vy / vl) * 40);
        const roseAfter = (await page.$eval(roseEl, (e) => e.getData()))[5].speed;
        check('rose: dragging a slice outward raises its value', roseAfter > roseBefore, `${roseBefore} -> ${roseAfter}`);

        // The wheel zooms the DOMAIN about the pointer, without scrolling the page.
        console.log('\nWheel zoom (/editing/zoom)');
        await open('/editing/zoom', '#wheel svg circle.mark');
        const zEl = '#wheel .chart > div';
        const zBefore = await page.$eval(zEl, (e) => e.getSchema());
        const zc = await boxCentre(page.locator('#wheel svg rect.plane').first());
        await page.mouse.move(zc.x, zc.y);
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, -240);
        await page.waitForTimeout(250);
        const zAfter = await page.$eval(zEl, (e) => e.getSchema());
        const span = (s) => { const d = s.x.domain; return Number(d[1]) - Number(d[0]); };
        check('zoom: a wheel-up narrows the domain', span(zAfter) < span(zBefore), `${span(zBefore)} -> ${span(zAfter)}`);
        check('zoom: the page did not scroll', (await page.evaluate(() => window.scrollY)) === scrollBefore);

        // Pan: a drag on empty plot slides the zoomed domain; a press on a point
        // still edits the point; the buttons zoom from outside; the marks clip.
        console.log('\nPan (/editing/zoom)');
        await open('/editing/zoom', '#pan svg circle.mark');
        const pEl = '#pan .chart > div';
        const pDom = async () => (await page.$eval(pEl, (e) => e.getSchema())).week.domain.map(Number);
        check('pan: the marks clip to the plot by default',
            /^url\(#/.test((await page.locator('#pan svg g.mark-layer').getAttribute('clip-path')) || ''));
        await page.locator('#pan button', { hasText: 'Zoom in' }).click();
        await page.waitForTimeout(150);
        const pz = await pDom();
        check('pan: the Zoom in button narrows the domain', pz[1] - pz[0] < 52, pz.join(' – '));
        const plane = await boxCentre(page.locator('#pan svg rect.plane').first());
        // Near the top of the plot, above every point (rain stays under 80 of 100).
        const topY = plane.b.y + plane.b.height * 0.06;
        const pDataBefore = await page.$eval(pEl, (e) => JSON.stringify(e.getData()));
        await dragPage(plane.x, topY, plane.x - 80, topY);
        const pp = await pDom();
        check('pan: dragging the plot left moves the window right', pp[0] > pz[0] + 1, `${pz[0]} -> ${pp[0]}`);
        check('pan: the span is kept', Math.abs((pp[1] - pp[0]) - (pz[1] - pz[0])) < 1e-6);
        check('pan: the data is untouched', (await page.$eval(pEl, (e) => JSON.stringify(e.getData()))) === pDataBefore);
        // A point inside the plot is still grabbed by its own move().
        const inside = await page.$$eval('#pan svg g.mark-layer circle.mark', (cs, box) => {
            const c = cs.map((el) => el.getBoundingClientRect())
                .find((r) => r.x > box.x + 20 && r.right < box.x + box.width - 20);
            return c ? { x: c.x + c.width / 2, y: c.y + c.height / 2 } : null;
        }, plane.b);
        if (inside) {
            const rainBefore = (await page.$eval(pEl, (e) => e.getData())).map((d) => d.rain).join();
            await dragPage(inside.x, inside.y, inside.x, inside.y + 30);
            const rainAfter = (await page.$eval(pEl, (e) => e.getData())).map((d) => d.rain).join();
            const pAfter = await pDom();
            check('pan: a press on a point edits it rather than panning', rainAfter !== rainBefore && pAfter[0] === pp[0]);
        } else check('pan: a point is visible inside the zoomed plot', false);

        // clip: { pad } grows the clip rect; clip: false on a mark paints it in
        // the margin, where it still follows its row.
        console.log('\nClip pad + per-mark opt-out (/editing/zoom#clip)');
        await open('/editing/zoom', '#clip svg circle.mark');
        const cEl = '#clip .chart > div';
        check('clip: pad grows the clip rect past the plot',
            (await page.locator('#clip svg clipPath rect').first().getAttribute('x')) === '-6');
        const cPlane = (await boxCentre(page.locator('#clip svg rect.plane').first())).b;
        const label = () => page.$eval('#clip svg', (svg) => {
            const t = [...svg.querySelectorAll('text')].find((n) => /today/.test(n.textContent || ''));
            if (!t) return null;
            const r = t.getBoundingClientRect();
            return { chrome: !!t.closest('g.chrome-layer'), x: r.x, y: r.y + r.height / 2 };
        });
        const l0 = await label();
        check('clip: a clip:false label paints in the margin, outside the clip',
            !!l0 && l0.chrome && l0.x > cPlane.x + cPlane.width, JSON.stringify(l0));
        const last = await page.$$eval('#clip svg circle.mark', (cs) => {
            const r = cs.map((c) => c.getBoundingClientRect()).sort((a, b) => b.x - a.x)[0];
            return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
        });
        if (last && l0) {
            const highBefore = (await page.$eval(cEl, (e) => e.getData())).at(-1).high;
            await dragPage(last.x, last.y, last.x, last.y + (last.y < cPlane.y + cPlane.height / 2 ? 40 : -40));
            const highAfter = (await page.$eval(cEl, (e) => e.getData())).at(-1).high;
            const l1 = await label();
            check('clip: the edge point is grabbed and its margin label follows',
                highAfter !== highBefore && !!l1 && Math.abs(l1.y - l0.y) > 10, `${highBefore} -> ${highAfter}`);
        } else check('clip: the last point and its label render', false);

        // A shape is a mark: picked inside its body and moved by move().
        console.log('\nShape mark (/marks/shape)');
        await open('/marks/shape', '#named svg path.mark-line');
        const shEl = '#named .chart > div';
        const shBefore = await page.$eval(shEl, (e) => JSON.stringify(e.getData()));
        const sh = await boxCentre(page.locator('#named svg path.mark-line').first());
        await dragPage(sh.x, sh.y, sh.x + 30, sh.y - 20);
        const shAfter = await page.$eval(shEl, (e) => JSON.stringify(e.getData()));
        check('shape: dragging a shape by its body moves its row', shAfter !== shBefore);

        // Titles reserve space: the chart keeps its declared size.
        console.log('\nTitles (/theming)');
        await open('/theming', '#titles svg');
        const ttTexts = await page.locator('#titles svg text').allTextContents();
        check('titles: the title, subtitle and caption draw',
            ttTexts.includes('How will the vote split?') && ttTexts.some((t) => /percent/.test(t)), ttTexts.slice(0, 4).join(' | '));
        check('titles: the chart keeps its declared height',
            (await page.locator('#titles svg').first().getAttribute('height')) === '260');

        // ---- Named themes and chrome tokens reach the pixels ----------------
        // A theme is resolved per chart, so every check reads an SVG attribute
        // the theme put there — a token that never reached a node is invisible
        // to typecheck and to the warnings gate alike.
        console.log('\nNamed themes (/theming/themes)');
        await open('/theming/themes', '#newsroom svg');
        const thmHeadFont = await page.$$eval('#newsroom svg text', (ts) => {
            const t = ts.find((n) => n.textContent === 'nyt');
            return t ? t.getAttribute('font-family') : null;
        });
        check('themes: nyt sets its headline in Georgia', thmHeadFont === 'Georgia, serif', `font-family=${thmHeadFont}`);
        const thmMatRx = await page.$$eval('#product svg', (svgs) => {
            const bar = svgs[svgs.length - 1].querySelector('rect.mark');
            return bar ? bar.getAttribute('rx') : null;
        });
        check('themes: material rounds its bars', thmMatRx === '4', `rx=${thmMatRx}`);
        const thmPbBg = await page.$$eval('#business svg', (svgs) => svgs[svgs.length - 1].style.background);
        check('themes: powerbi paints its own canvas', /rgb\(27,\s*26,\s*25\)|#1b1a19/i.test(thmPbBg), `bg=${thmPbBg}`);
        const thmNytGrid = await page.$$eval('#newsroom svg', (svgs) => {
            const lines = [...svgs[0].querySelectorAll('line')];
            const horizontal = lines.filter((l) => l.getAttribute('y1') === l.getAttribute('y2') && +l.getAttribute('x2') - +l.getAttribute('x1') > 100);
            return { grid: horizontal.filter((l) => l.getAttribute('stroke') === '#e4e4e4').length, zero: horizontal.filter((l) => l.getAttribute('stroke') === '#121212').length };
        });
        check('themes: nyt grids its value axis and rules zero', thmNytGrid.grid >= 3 && thmNytGrid.zero >= 1, JSON.stringify(thmNytGrid));
        // A theme is paint only: the same drag still writes the row.
        await page.locator('#extends .chart svg').scrollIntoViewIfNeeded();
        const thmExEl = '#extends .chart > div';
        const thmExBefore = await page.$eval(thmExEl, (e) => e.getData()[0].v);
        const thmExBar = await boxCentre(page.locator('#extends svg rect.mark').first());
        await dragPage(thmExBar.x, thmExBar.y, thmExBar.x, thmExBar.y - 30);
        const thmExAfter = await page.$eval(thmExEl, (e) => e.getData()[0].v);
        // `move()` is absolute: the value becomes the pointer's height, so only "it changed" is asserted.
        check('themes: a drag on a themed (extends) chart writes its row', Math.abs(thmExAfter - thmExBefore) > 1, `${thmExBefore} -> ${thmExAfter}`);

        console.log('\nChrome tokens (/theming, /marks/axes)');
        await open('/theming', '#chrome svg');
        const thmPanelFill = await page.$eval('#chrome svg rect.bg-rect', (r) => r.getAttribute('fill'));
        check('theme.panel paints the plot area first', thmPanelFill === '#ebebeb', `fill=${thmPanelFill}`);
        await open('/marks/axes', '#styling svg');
        const thmTurned = await page.$$eval('#styling svg text', (ts) => ts.filter((t) => /rotate\(-40/.test(t.getAttribute('transform') || '')).length);
        check('axis: labelAngle turns the tick labels', thmTurned === 5, `thmTurned=${thmTurned}`);
        const thmTwoLine = await page.$$eval('#styling svg text', (ts) => ts.filter((t) => t.querySelectorAll('tspan').length === 2).length);
        check('axis: a "\\n" in a tick label paints two lines', thmTwoLine >= 2, `two-line labels=${thmTwoLine}`);
        // The space-saving axis: labels left-anchored INSIDE the plot (past the
        // first band-edge gridline), above their bars.
        const thmInside = await page.$$eval('#styling svg', (svgs) => {
            const svg = svgs[svgs.length - 1];
            const label = [...svg.querySelectorAll('text')].find((t) => t.textContent === 'Engineering');
            const bars = [...svg.querySelectorAll('rect.mark')].map((r) => r.getBoundingClientRect());
            if (!label || !bars.length) return null;
            const lb = label.getBoundingClientRect();
            const left = Math.min(...bars.map((b) => b.left));
            return { anchor: label.getAttribute('text-anchor'), inside: lb.left >= left, above: bars.some((b) => lb.bottom <= b.top + 1 && b.top - lb.bottom < 12) };
        });
        check('axis: labelAlign + negative tickPadding put labels inside the plot, above their bars',
            !!thmInside && thmInside.anchor === 'start' && thmInside.inside && thmInside.above, JSON.stringify(thmInside));

        check('no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
        await browser.close();
        stopNext();
    }

    console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} passed, ${failures.length} failed`);
    if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
