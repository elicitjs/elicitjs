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
            '/', '/overview', '/concepts', '/concepts/contracts', '/sizing', '/renderers', '/authoring',
            '/marks/bar', '/marks/rect', '/marks/area', '/marks/tick', '/marks/point',
            '/marks/ellipse', '/marks/curve',
            '/marks/symbol', '/marks/face', '/marks/text', '/marks/line', '/marks/composite',
            '/marks/dotstack', '/marks/waffle', '/marks/needle',
            '/marks/axis-radial', '/marks/arc', '/marks/geo', '/marks/network', '/marks/trend', '/marks/axes',
            '/marks/legend',
            '/editing', '/editing/gestures', '/editing/sweep', '/editing/lock',
            '/editing/existence', '/editing/probe', '/editing/stages', '/editing/axis',
            '/editing/external-controls',
            '/editing/history', '/widgets', '/scales', '/schema', '/constraints',
            '/effects', '/guides', '/theming', '/playground',
        ];
        for (const r of routes) await visit(r);

        // ---- Playground: Build dashboard (reactive) -------------------------
        // The builder serialises form state to a spec on every change (every
        // other route just evaluates a hand-written .example.txt), so this is
        // the one new code path that can emit broken JS. Add a constraint
        // through the secondary rail and confirm the chart re-renders itself
        // — no Generate step — then read the generated source back.
        console.log('\nPlayground Build dashboard (/playground)');
        await open('/playground', '.area-viz svg');
        await page.locator('.area-secondary select').first().selectOption('clamp');
        await page.waitForTimeout(600); // debounce (250ms) + re-eval + redraw
        const builderErrs = await page.locator('.area-viz .live-error').allTextContents();
        check('playground: adding a constraint re-renders with no error', builderErrs.length === 0, builderErrs.join(' | '));
        const builderChartCount = await page.locator('.area-viz svg').count();
        check('playground: the live spec mounts a chart', builderChartCount === 1, `svg=${builderChartCount}`);
        await page.getByRole('button', { name: 'Show code' }).click();
        await page.waitForTimeout(150);
        const generatedCode = await page.locator('.area-viz .readonly-code').textContent();
        check('playground: generated code includes the added constraint', (generatedCode || '').includes('clamp('), (generatedCode || '').slice(0, 120));

        // Switching to a line mark carries the x/y bindings over, so the chart
        // stays populated — and line-scoped edits appear only now.
        await page.locator('.mark-card', { hasText: 'Line' }).first().click();
        await page.waitForTimeout(600);
        const lineErrs = await page.locator('.area-viz .live-error').allTextContents();
        check('playground: switching to line keeps the chart rendering', lineErrs.length === 0, lineErrs.join(' | '));
        const lineEditOptions = await page.locator('.area-edits select option').allTextContents();
        check('playground: line-scoped edits offered on a line mark', lineEditOptions.some((o) => o.includes('edit.line.draw')), lineEditOptions.join(','));

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
            (el) => el.childElementCount).catch(() => 0);
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
        console.log('\nArc: value channel + edge drag (/marks/arc)');
        await open('/marks/arc', '#edit svg path');

        const arcSvg = page.locator('#edit svg').first();
        const sliceCount = await arcSvg.locator('path').count();
        check('arc: value channel drives slices', sliceCount >= 3, `${sliceCount} slice paths`);
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
        await open('/marks/trend', '#inert .chart svg circle');
        const inertChart = page.locator('#inert .chart').first();
        const inertRows = () => inertChart.locator(':scope > div').first().evaluate((e) => e.getData());
        const inertBefore = await inertRows();
        const inertHandles = await inertChart.locator('svg circle').count();
        check('trend (no edit): the handles are still drawn', inertHandles >= 2, `${inertHandles} circles`);
        for (const nth of [0, 1]) {
            const h = inertChart.locator('svg circle').nth(nth);
            await h.scrollIntoViewIfNeeded();
            const hb = await h.boundingBox();
            if (!hb) continue;
            await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
            await page.mouse.down();
            await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 45, { steps: 6 });
            await page.mouse.up();
        }
        await page.waitForTimeout(150);
        const inertAfter = await inertRows();
        check('trend (no edit): dragging both handles writes NOTHING',
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
        const caps = await page.locator('#ordering svg line[stroke="#64748b"]').all();
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
        const spTicks = await page.locator('#spacing svg line[stroke="#2563eb"]').all();
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
        // Node circles carry the point mark's fill; a link's endpoint handle is a
        // circle too, so index alone would not tell them apart.
        const nodeAt = (i) => page.$$eval('#draw .chart svg circle', (cs, k) => {
            const c = cs.filter((n) => (n.getAttribute('fill') || '').toLowerCase() === '#4e79a7')[k];
            if (!c) return null;
            const b = c.getBoundingClientRect();
            return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }, i);
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
            (cs) => cs.filter((c) => (c.getAttribute('fill') || '').toLowerCase() === '#4e79a7').length);
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
            await page.mouse.move(h0.x, h0.y);
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

        check('no page/console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
        await browser.close();
        stopNext();
    }

    console.log(`\n${failures.length ? '✗ FAIL' : '✓ PASS'} — ${passed} passed, ${failures.length} failed`);
    if (failures.length) { for (const f of failures) console.log('  - ' + f); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
