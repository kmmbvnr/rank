// Run against the mobile Vite console.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const ready = () => page.waitForFunction(() => !document.querySelector('#brand')?.disabled);
    const runningId = '10000000-0000-4000-8000-000000000001';
    const targetId = '10000000-0000-4000-8000-000000000002';
    try {
        await page.goto(original.url()); await ready();
        await page.evaluate(async ({ runningId, targetId }) => {
            const { BrowserNotebookStore } = await import('/src/notebook-store.ts');
            const store = new BrowserNotebookStore();
            for (const book of (await store.list()).items) await store.remove(book.id);
            const source = ['rem Running notebook', ...Array.from({ length: 80 }, (_, i) => `rem Scroll line ${i}`),
                'I = 0', 'for', '  I += 1', 'end'].join('\n');
            for (const [id, title, code] of [[runningId, 'Running notebook', source], [targetId, 'Destination', 'rem Destination\nValue = 42']])
                await store.save({ id, title, manual: true, created: 1, updated: 1, snapshot: { cells: [code], draft: '' } });
            localStorage.setItem('rank-active-notebook-v1', runningId);
            localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done', hold: true, modules: true }));
        }, { runningId, targetId });
        await page.reload(); await ready();
        await page.evaluate(() => window.rankSoftKeyboard(false));
        const play = page.locator('#run-button');
        const start = async () => {
            const box = await play.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down(); await page.waitForTimeout(850); await page.mouse.up();
            await page.waitForFunction(() => /Running.*\d/.test(document.querySelector('#terminal').textContent));
        };
        await start();
        const before = await page.locator('#screen').textContent();
        await page.locator('#terminal').hover(); await page.mouse.wheel(0, -800);
        await page.waitForTimeout(150);
        check(await page.locator('#screen').textContent() !== before, 'Actually scroll the running source');
        const footer = page.locator('#terminal-footer');
        check(/Running.*\d/.test(await footer.textContent()), 'Running timer must stay visible after scrolling');
        // Fractional wheel movement must survive clock ticks and settling the sliding window.
        await page.mouse.wheel(0, 3.25);
        const position = () => page.evaluate(() => {
            const screen = document.querySelector('#screen');
            const row = [...screen.children].find(row => /Scroll line \d+/.test(row.textContent));
            return Number(row.textContent.match(/Scroll line (\d+)/)[1]) * parseFloat(getComputedStyle(row).height)
                - (row.getBoundingClientRect().top - document.querySelector('#terminal').getBoundingClientRect().top);
        });
        const resting = await position();
        const footerY = (await footer.boundingBox()).y;
        const firstTime = await footer.textContent();
        await page.waitForTimeout(1100);
        check(await footer.textContent() !== firstTime, 'Running timer must keep advancing while scrolled');
        const afterTicks = await position();
        check(Math.abs(afterTicks - resting) < 0.1, `Timer ticks must preserve the fractional source position: ${resting} -> ${afterTicks}`);
        check(Math.abs((await footer.boundingBox()).y - footerY) < 0.1, 'The footer must be fixed to the viewport');
        const gesture = await page.evaluate(async () => {
            const terminal = document.querySelector('#terminal');
            const screen = document.querySelector('#screen');
            const rect = terminal.getBoundingClientRect();
            const samples = [];
            const sample = () => {
                const first = [...screen.children].find(row => /Scroll line \d+/.test(row.textContent));
                const match = first?.textContent.match(/Scroll line (\d+)/);
                if (match) samples.push({
                    position: Number(match[1]) * parseFloat(getComputedStyle(first).height)
                        - (first.getBoundingClientRect().top - rect.top),
                    footer: document.querySelector('#terminal-footer').getBoundingClientRect().top,
                });
            };
            let y = rect.top + rect.height * .7;
            const touch = type => {
                const point = new Touch({ identifier: 1, target: terminal, clientX: rect.left + 100, clientY: y });
                terminal.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
            };
            touch('touchstart');
            for (let i = 0; i < 45; i++) {
                y -= 3.25; touch('touchmove');
                await new Promise(requestAnimationFrame); sample();
            }
            const caretAnimation = getComputedStyle(document.querySelector('#caret')).animationName;
            touch('touchend');
            for (let i = 0; i < 45; i++) { await new Promise(requestAnimationFrame); sample(); }
            return { samples: samples.length,
                reversed: samples.slice(1).some((next, i) => next.position < samples[i].position - .1),
                footerRange: Math.max(...samples.map(s => s.footer)) - Math.min(...samples.map(s => s.footer)),
                distance: samples.at(-1).position - samples[0].position, caretAnimation };
        });
        check(gesture.samples > 60 && gesture.distance > 100, `Exercise touch scrolling and momentum: ${JSON.stringify(gesture)}`);
        check(!gesture.reversed, 'Touch scrolling and settling must never jump backwards');
        check(gesture.footerRange < .1, 'The running footer must not move during a touch gesture');
        check(gesture.caretAnimation === 'none', 'Caret animation must remain off while scrolling');
        for (const paused of [false, true]) {
            if (paused) {
                await page.locator('#brand').click();
                await page.getByRole('button', { name: 'Running notebook', exact: true }).click();
                await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
                await start();
                await page.evaluate(() => window.rankPause());
                await page.waitForFunction(() => document.querySelector('#terminal').textContent.includes('Paused'));
            }
            await page.locator('#brand').click();
            await page.getByRole('button', { name: 'Destination', exact: true }).click();
            await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
            check((await page.locator('#screen').textContent()).includes('Value = 42'), 'Selected notebook must open');
            check(await page.locator('#input').getAttribute('aria-busy') === 'false', 'Old execution must finish before opening');
            check(await page.evaluate(() => localStorage.getItem('rank-active-notebook-v1')) === targetId, 'Remember the selected notebook');
        }
        return 'Running timer survives scrolling; notebook selection stops running and paused programs';
    } finally { await context.close(); }
}
