// Run against the mobile Vite console.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const ready = () => page.waitForFunction(() => !document.querySelector('#brand')?.disabled);
    try {
        await page.goto(original.url()); await ready();
        await page.evaluate(async () => {
            const { seedStarterNotebooks } = await import('/src/starter-notebooks.ts');
            const ids = [];
            const store = {
                get: async id => {
                    if (!/^[a-fA-F0-9-]{36}$/.test(id)) throw new Error('Invalid native notebook ID');
                    return undefined;
                },
                save: async book => { ids.push(book.id); },
            };
            await seedStarterNotebooks(store);
            if (new Set(ids).size !== 3) throw new Error('Three distinct native-compatible IDs required');
        });
        check(await page.locator('#input').inputValue() === '', 'Start with an empty notebook');
        await page.locator('#mobile-guidance[data-step="offer"]').waitFor();
        await page.evaluate(() => localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done', hold: true })));
        await page.reload(); await ready();
        for (const [title, output] of [
            ['1. Arrays and matrices', '101 102 103'],
            ['2. Sequences and pipelines', '44'],
            ['3. Your own functions', '42'],
        ]) {
            await page.locator('#brand').click();
            await page.getByRole('button', { name: title, exact: true }).waitFor();
            check(await page.locator('.history-row').count() === 4, 'Three starters and the initial blank notebook');
            await page.getByRole('button', { name: title, exact: true }).click();
            await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
            check(await page.locator('#screen').locator('.status-error').count() === 0, 'Opening must not fail');
            const button = await page.locator('#run-button').boundingBox();
            await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
            await page.mouse.down(); await page.waitForTimeout(850); await page.mouse.up();
            await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
            check((await page.locator('#screen').textContent()).includes(output), `Expected result in ${title}`);
        }
        await page.locator('#input').fill('rem My addition');
        await page.waitForTimeout(250);
        await page.evaluate(async () => {
            const { BrowserNotebookStore } = await import('/src/notebook-store.ts');
            await new BrowserNotebookStore().remove('00000000-0000-4000-8000-000000000001');
        });
        await page.reload(); await ready();
        check(await page.locator('#input').inputValue() === 'rem My addition', 'Preserve edits on restart');
        await page.locator('#brand').click();
        await page.getByRole('button', { name: '2. Sequences and pipelines', exact: true }).waitFor();
        check(await page.locator('.history-row').count() === 3, 'Deleted starters must stay deleted');
        return 'Three saved runnable examples, empty walkthrough, persistent edits and deletion passed';
    } finally { await context.close(); }
}
