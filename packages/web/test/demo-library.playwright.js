// Start the mobile Vite console, then run with playwright-cli run-code --filename this file.
async page => {
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const tree = [
        { path: 'demos/README.md', type: 'blob' },
        { path: 'demos/contest', type: 'tree' },
        { path: 'demos/contest/README.md', type: 'blob' },
        { path: 'demos/contest/year', type: 'tree' },
        { path: 'demos/contest/year/README.md', type: 'blob' },
        { path: 'demos/contest/year/example.ra', type: 'blob' },
        { path: 'demos/contest/year/example_test.ra', type: 'blob' },
        { path: 'demos/contest/year/data.csv', type: 'blob' },
        { path: 'demos/fallback', type: 'tree' },
    ];
    let sourceRequests = 0;
    let fail = true;
    await page.route('https://api.github.com/repos/kmmbvnr/rank/**', route => {
        if (fail) return route.fulfill({ status: 429, body: '' });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(
            route.request().url().includes('/commits/') ? { sha: 'commit123' } : { sha: 'tree123', tree, truncated: false }) });
    });
    await page.route('https://raw.githubusercontent.com/kmmbvnr/rank/**', route => {
        const url = route.request().url();
        check(url.includes('/commit123/'), 'source must use commit SHA, not tree SHA');
        let body = url.endsWith('/contest/README.md') ? '# Contest\n- [Year **2026**](./year/) — problems by year.' : '# Library\n- [Example Competition](contest/) — example contest.\n- [External source](https://example.org/contest/)';
        if (url.endsWith('.ra')) { sourceRequests++; body = 'rem Library example\nValue = 42'; }
        return route.fulfill({ contentType: 'text/plain', body });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(async () => {
        const db = await new Promise(resolve => { const request = indexedDB.open('rank-notebooks-v1'); request.onsuccess = () => resolve(request.result); });
        await new Promise((resolve, reject) => { const tx = db.transaction(['meta', 'source'], 'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('source').clear(); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
        db.close(); localStorage.clear();
    });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    const menu = page.locator('#notebook-panel');
    const library = page.locator('.library-view');
    const input = page.locator('#input');
    const enter = async () => {
        await page.getByRole('button', { name: 'Open notebook history', exact: true }).click();
        await menu.getByRole('button', { name: 'Library', exact: true }).click();
    };
    await input.fill('rem Original draft');
    await enter();
    await library.getByRole('button', { name: 'Retry', exact: true }).waitFor();
    check((await library.textContent()).includes('request limit'), 'rate limit error missing');
    check(await input.inputValue() === 'rem Original draft', 'loading error changed editor');
    fail = false;
    await library.getByRole('button', { name: 'Retry', exact: true }).click();
    await library.getByRole('button', { name: 'Example Competition ›', exact: true }).waitFor();
    check(!await menu.getByRole('button', { name: 'New notebook', exact: true }).isVisible(), 'notebook history not replaced');
    await library.getByRole('button', { name: 'fallback ›', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.library-view [role=status]').textContent === 'No examples in this folder.');
    await library.getByRole('button', { name: 'Back', exact: true }).click();
    await library.getByRole('button', { name: 'Example Competition ›', exact: true }).click();
    await library.getByRole('button', { name: 'Year 2026 ›', exact: true }).click();
    await library.getByRole('button', { name: 'example.ra', exact: true }).waitFor();
    check(await library.locator('button').count() === 2, 'non-ra/test files leaked into Library');
    check(!await library.getByRole('button', { name: 'Year 2026 ›', exact: true }).isVisible(), 'parent folder still visible');
    await library.getByRole('button', { name: 'Back', exact: true }).click();
    await library.getByRole('button', { name: 'Year 2026 ›', exact: true }).click();
    await library.getByRole('button', { name: 'example.ra', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    check((await page.locator('#screen').textContent()).includes('Value = 42'), 'example source missing');
    check(!(await page.locator('#screen').textContent()).includes('42\n'), 'example automatically executed');
    await input.fill('rem My local changes');
    await page.getByRole('button', { name: 'Open notebook history' }).click();
    await page.getByRole('dialog', { name: 'Notebook history' }).getByRole('button', { name: 'Original draft', exact: true }).click();
    await page.getByRole('dialog', { name: 'Notebook history' }).waitFor({ state: 'hidden' });
    check(await input.inputValue() === 'rem Original draft', 'opening example lost previous draft');
    await enter();
    await library.getByRole('button', { name: 'Example Competition ›', exact: true }).click();
    await library.getByRole('button', { name: 'Year 2026 ›', exact: true }).click();
    await library.getByRole('button', { name: 'example.ra', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    check(await input.inputValue() === 'rem My local changes', 'repeat open overwrote local edits');
    check(sourceRequests === 1, 'repeat open downloaded source again');
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    check(await input.inputValue() === 'rem My local changes', 'restart lost edits');
    await enter();
    await library.getByRole('button', { name: 'Example Competition ›', exact: true }).waitFor();
    await library.getByRole('button', { name: 'Back', exact: true }).click();
    check(await menu.getByRole('button', { name: 'Library', exact: true }).isVisible(), 'root Back did not return to notebook history');
    const active = menu.locator('.history-row[data-active]');
    check(await active.count() === 1, 'active notebook missing or duplicated');
    check(await active.evaluate(row => {
        const style = getComputedStyle(row);
        const panel = row.closest('dialog').getBoundingClientRect();
        const rect = row.getBoundingClientRect();
        return style.backgroundColor === 'rgb(36, 36, 36)' && style.boxShadow === 'none'
            && style.borderRadius === '0px' && Math.abs(rect.left - panel.left) < 1
            && Math.abs(rect.right - (panel.right - 1)) < 1
            && row.querySelector('.history-options').getBoundingClientRect().right <= rect.right;
    }), 'active notebook highlight does not cover the full panel row');
    check(await menu.locator('.history-shortcut svg').count() === 2, 'notebook and Library icons missing');
    check(await menu.locator('footer').count() === 0, 'Fixed footer still appears');
    check(await menu.locator('.history-library-row').getByRole('button', { name: 'Import .ra', exact: true }).count() === 1, 'Import icon is not next to Library');
    const activeId = await page.evaluate(() => localStorage.getItem('rank-active-notebook-v1'));
    const original = menu.locator('.history-row').filter({ has: page.getByRole('button', { name: 'Original draft', exact: true }) });
    await original.getByRole('button', { name: 'Notebook options' }).click();
    const downloaded = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export', exact: true }).click();
    const download = await downloaded;
    const stream = await download.createReadStream();
    let exported = '';
    for await (const chunk of stream) exported += chunk.toString();
    check(exported === 'rem Original draft', 'Export used active notebook instead of selected notebook');
    check(await input.inputValue() === 'rem My local changes' && await page.evaluate(() => localStorage.getItem('rank-active-notebook-v1')) === activeId, 'Export switched the active notebook');
    await page.keyboard.press('Escape');
    await page.evaluate(async () => {
        const { BrowserNotebookStore } = await import('/src/notebook-store.ts');
        const store = new BrowserNotebookStore();
        for (let index = 0; index < 30; index++) await store.save({ id: crypto.randomUUID(), title: `Scroll notebook ${index}`,
            manual: true, created: Date.now(), updated: Date.now(), snapshot: { cells: [], draft: '' } });
    });
    await page.getByRole('button', { name: 'Open notebook history', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 25);
    const headerTop = await menu.locator('header').evaluate(header => header.getBoundingClientRect().top);
    await menu.locator('.library-home').evaluate(home => { home.scrollTop = home.scrollHeight; });
    await page.waitForFunction(() => document.querySelectorAll('.history-row').length === 32);
    check(await menu.locator('.library-home').evaluate(home => {
        const top = home.getBoundingClientRect().top;
        return [...home.querySelectorAll('.history-shortcut')].every(button => button.getBoundingClientRect().bottom < top);
    }), 'New notebook and Library do not scroll away with notebook history');
    check(await menu.locator('header').evaluate((header, top) => header.getBoundingClientRect().top === top && getComputedStyle(header).backdropFilter === 'blur(14px)', headerTop), 'RANK header moved or blur is missing');
    await menu.locator('.library-home').evaluate(home => { home.scrollTop = 0; });
    await page.evaluate(() => {
        window.originalLibraryInputClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function() {
            if (this.type !== 'file') return window.originalLibraryInputClick.call(this);
            Object.defineProperty(this, 'files', { value: [new File(['rem Imported from Library row\nValue = 7'], 'imported.ra', { type: 'text/plain' })] });
            this.dispatchEvent(new Event('change'));
        };
    });
    await menu.getByRole('button', { name: 'Import .ra', exact: true }).click();
    await menu.waitFor({ state: 'hidden' });
    await page.evaluate(() => { HTMLInputElement.prototype.click = window.originalLibraryInputClick; });
    check((await page.locator('#screen').textContent()).includes('Value = 7'), 'Import icon did not open the selected file');
    await page.unroute('https://api.github.com/repos/kmmbvnr/rank/**');
    await page.unroute('https://raw.githubusercontent.com/kmmbvnr/rank/**');
    return 'Library navigation, README titles, filtering, retry, local edits and restart passed';
}
