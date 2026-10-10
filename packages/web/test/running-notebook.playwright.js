// Run against the mobile Vite console.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
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
            await page.waitForFunction(() => /Running.*\d/.test(document.querySelector('#screen').textContent));
        };
        await start();
        const before = await page.locator('#screen').textContent();
        await page.locator('#terminal').hover(); await page.mouse.wheel(0, -800);
        await page.waitForTimeout(150);
        check(await page.locator('#screen').textContent() !== before, 'Actually scroll the running source');
        const footer = page.locator('#screen .terminal-facts').last();
        check(/Running.*\d/.test(await footer.textContent()), 'Running timer must stay visible after scrolling');
        const firstTime = await footer.textContent();
        await page.waitForTimeout(1100);
        check(await footer.textContent() !== firstTime, 'Running timer must keep advancing while scrolled');
        for (const paused of [false, true]) {
            if (paused) {
                await page.locator('#brand').click();
                await page.getByRole('button', { name: 'Running notebook', exact: true }).click();
                await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
                await start();
                await page.evaluate(() => window.rankPause());
                await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('Paused'));
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
