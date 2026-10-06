// Start the mobile Vite console, then run with playwright-cli run-code --filename this file.
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(async () => {
        const { notebookTitle } = await import('/src/notebook-store.ts');
        const title = source => notebookTitle({ cells: [], draft: source });
        if (title('use sequences\nuse math\nTotal = 42') !== 'Total = 42'
            || title('use sequences\nrem Grid products\nTotal = 42') !== 'Grid products'
            || title('use sequences\nuse math') !== 'New notebook'
            || title('useful = 42') !== 'useful = 42') throw new Error('use lines polluted notebook title');
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { if (window.originalNotebookPost) Worker.prototype.postMessage = window.originalNotebookPost; });
    await page.getByRole('button', { name: 'Open notebook history' }).waitFor({ state: 'visible' });
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('rank-notebooks-v1');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['meta', 'source'], 'readwrite');
            tx.objectStore('meta').clear(); tx.objectStore('source').clear();
            tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
        });
        db.close(); localStorage.clear();
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['rem Grid products', 'Count = 7'], draft: 'for i in ' }));
    });
    await page.reload();
    const brand = page.getByRole('button', { name: 'Open notebook history' });
    const panel = page.getByRole('dialog', { name: 'Notebook history' });
    const source = () => page.locator('#input').inputValue();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    check(await source() === 'for i in ', 'migration lost unfinished draft');
    await brand.click();
    await panel.getByRole('button', { name: 'Grid products', exact: true }).waitFor();
    check(await panel.locator('.history-row').count() === 1, 'migration duplicated notebook');
    check(await panel.locator('.history-date').textContent() === 'Today', 'date label missing');
    await panel.getByRole('button', { name: 'New notebook', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    check(await source() === '', 'new notebook retained old draft');
    // Execute a value in the new document, then ensure switching clears the interpreter too.
    await page.locator('#input').fill('Other = 99');
    await page.locator('#input').press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await page.locator('#input').fill('rem Second notebook');
    await brand.click();
    await panel.getByRole('button', { name: 'Second notebook', exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Grid products', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    check(await source() === 'for i in ', 'switch lost previous draft');
    check(!(await page.locator('#screen').textContent()).includes('99'), 'results leaked between documents');
    check(!(await page.locator('#screen').textContent()).includes('7\n'), 'opening automatically executed source');
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    check(await source() === 'for i in ', 'restart lost active notebook/draft');
    await brand.click();
    const grid = panel.locator('.history-row').filter({ has: page.getByRole('button', { name: 'Grid products', exact: true }) });
    await grid.getByRole('button', { name: 'Notebook options' }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'Rename notebook', exact: true });
    await rename.getByRole('textbox', { name: 'Notebook title' }).fill('My grid');
    await rename.getByRole('button', { name: 'Save', exact: true }).click();
    await rename.waitFor({ state: 'hidden' });
    await panel.getByRole('button', { name: 'My grid', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
    await page.locator('#input').fill('Changed = 5');
    await brand.click();
    await panel.getByRole('button', { name: 'My grid', exact: true }).waitFor();
    // A failed interpreter reset must not attach the old text to the target notebook.
    await page.evaluate(() => {
        window.originalNotebookPost = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function(message, ...args) {
            if (message.method === 'resetExecution') throw new Error('simulated reset failure');
            return window.originalNotebookPost.call(this, message, ...args);
        };
    });
    await panel.getByRole('button', { name: 'Second notebook', exact: true }).click();
    check(await panel.isVisible(), 'reset failure silently switched notebooks');
    await page.waitForFunction(() => document.querySelector('.history-status').textContent.includes('simulated reset failure'));
    await page.evaluate(() => { Worker.prototype.postMessage = window.originalNotebookPost; });
    await panel.getByRole('button', { name: 'Second notebook', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    check(await source() === 'rem Second notebook', 'failed reset overwrote target notebook');
    await brand.click();
    await panel.getByRole('button', { name: 'My grid', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    check(await source() === 'Changed = 5', 'failed reset lost original notebook');
    await brand.click();
    // A failed write must retain the active document and keep switching blocked.
    await page.getByRole('button', { name: 'Close notebook history' }).click();
    await page.evaluate(() => {
        window.originalNotebookPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(...args) {
            if (this.name === 'source') { this.transaction.abort(); throw new Error('simulated disk failure'); }
            return window.originalNotebookPut.apply(this, args);
        };
    });
    await page.locator('#input').fill('Unsaved = 8');
    await brand.click();
    await panel.getByRole('button', { name: 'New notebook', exact: true }).click();
    check(await panel.isVisible(), 'save failure silently switched notebook');
    check((await panel.getByRole('status').textContent()).includes('simulated disk failure'), 'save failure missing');
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalNotebookPut; });
    await panel.getByRole('button', { name: 'New notebook', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    await brand.click();
    await panel.getByRole('button', { name: 'My grid', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    check(await source() === 'Unsaved = 8', 'retry lost failed-save draft');
    // Seed many notebooks with tied timestamps; paging must not skip or duplicate IDs.
    await page.evaluate(async () => {
        const { BrowserNotebookStore } = await import('/src/notebook-store.ts');
        const store = new BrowserNotebookStore();
        const now = Date.now() - 86400000;
        for (let index = 0; index < 61; index++) {
            const id = 'fixture-' + String(index).padStart(3, '0');
            await store.save({ id, title: 'Notebook ' + index, manual: false, created: now, updated: now,
                snapshot: { cells: [], draft: 'Value = ' + index } });
        }
        const seen = [];
        let before;
        do { const page = await store.list(before); seen.push(...page.items.map(book => book.id)); before = page.next; } while (before);
        if (seen.length !== new Set(seen).size || seen.filter(id => id.startsWith('fixture-')).length !== 61)
            throw new Error('pagination skipped or duplicated notebooks');
    });
    await brand.click();
    await panel.locator('.history-row').first().waitFor();
    check(await panel.locator('.history-row').count() === 25, 'panel eagerly loaded all history');
    await panel.getByRole('button', { name: 'Load more', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length >= 50);
    check((await panel.locator('.history-date').allTextContents()).includes('Yesterday'), 'date groups missing');
    // Backdrop click closes the drawer, including native Back via the same hook.
    check(await page.evaluate(() => window.rankBack()), 'Android Back did not close drawer');
    await panel.waitFor({ state: 'hidden' });
    await brand.click();
    await page.mouse.click(385, 100); await panel.waitFor({ state: 'hidden' });
    // Deleting the migrated notebook must not resurrect the old localStorage draft.
    await brand.click();
    const current = panel.locator('.history-row').filter({ has: page.getByRole('button', { name: 'My grid', exact: true }) });
    await current.getByRole('button', { name: 'Notebook options' }).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Delete notebook', exact: true });
    await deletion.getByRole('button', { name: 'Delete', exact: true }).click();
    await deletion.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('.history-row[data-id="legacy"]'));
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await brand.click();
    check(await panel.getByRole('button', { name: 'Grid products', exact: true }).count() === 0, 'deleted migration resurrected');
    check(await panel.getByRole('button', { name: 'My grid', exact: true }).count() === 0, 'deleted notebook survived');
    return 'Notebook history: migration, draft preservation, switching, restart, rename, write-failure retry, pagination and deletion passed';
}
