// Run against the Vite console with playwright-cli run-code --filename this file.
async page => {
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    const url = 'https://input.test/data-' + Date.now() + '.txt';
    await page.evaluate(async url => {
        const { notebookStore } = await import('/src/notebook-store.ts');
        const id = 'url-input-test-' + crypto.randomUUID(), now = Date.now();
        await notebookStore().save({ id, title: 'URL input test', manual: true, created: now, updated: now,
            snapshot: { cells: ['use cli', 'use io', `arg File path = "${url}"`, 'File read print'], draft: '' } });
        localStorage.setItem('rank-active-notebook-v1', id);
    }, url);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.evaluate(url => {
        const original = window.fetch;
        window.inputDownloadCalls = 0; window.inputDownloadStatuses = [];
        const observer = new MutationObserver(() => {
            const status = document.querySelector('#program-inputs [data-input-status]')?.textContent;
            if (status?.includes('Downloading')) window.inputDownloadStatuses.push(status);
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
        window.fetch = async (request, options) => {
            if (String(request) !== url) return original(request, options);
            window.inputDownloadCalls++;
            const stream = new ReadableStream({ async start(controller) {
                for (const text of ['alpha', ' beta', ' gamm', 'a end']) {
                    await new Promise(resolve => setTimeout(resolve, 150));
                    controller.enqueue(new TextEncoder().encode(text));
                }
                controller.close();
            } });
            return new Response(stream, { headers: { 'Content-Length': '20' } });
        };
    }, url);
    const open = async () => {
        await page.getByRole('button', { name: 'Terminal commands' }).click();
        await page.getByRole('button', { name: 'Run program', exact: true }).click();
    };
    const dialog = page.getByRole('dialog', { name: 'Run program', exact: true });
    const run = async () => {
        await dialog.getByRole('button', { name: 'Run', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    };
    await open(); await run();
    let rows = await page.locator('#screen .terminal-row').allTextContents();
    if (!rows.some(row => row.trim() === 'alpha beta gamma end')) throw Error('Downloaded file was not read: ' + rows.join('\n'));
    const first = await page.evaluate(() => ({ calls: window.inputDownloadCalls, statuses: window.inputDownloadStatuses }));
    if (first.calls !== 1 || !first.statuses.some(status => /(?:25|50|75)%/.test(status))) throw Error('No download progress: ' + JSON.stringify(first));
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.evaluate(url => {
        const original = window.fetch; window.inputDownloadCalls = 0;
        window.fetch = (request, options) => {
            if (String(request) !== url) return original(request, options);
            window.inputDownloadCalls++; throw Error('Offline');
        };
    }, url);
    await open(); await run();
    rows = await page.locator('#screen .terminal-row').allTextContents();
    if (!rows.some(row => row.trim() === 'alpha beta gamma end') || await page.evaluate(() => window.inputDownloadCalls) !== 0)
        throw Error('Cached URL input needs network');
    const retryUrl = url + '?retry=1';
    await page.evaluate(retryUrl => {
        const original = window.fetch; window.inputDownloadCalls = 0;
        window.fetch = async (request, options) => {
            if (String(request) !== retryUrl) return original(request, options);
            window.inputDownloadCalls++;
            return window.inputDownloadCalls === 1 ? new Response('error', { status: 503 }) : new Response('retry worked');
        };
    }, retryUrl);
    await open();
    await dialog.locator('input[type=checkbox]').uncheck();
    await dialog.getByRole('textbox', { name: 'File', exact: true }).fill(retryUrl);
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'HTTP 503' }).waitFor();
    await run();
    rows = await page.locator('#screen .terminal-row').allTextContents();
    if (!rows.some(row => row.trim() === 'retry worked') || await page.evaluate(() => window.inputDownloadCalls) !== 2)
        throw Error('Failed download was cached or could not be retried');
    return { defaultUrl: true, progress: first.statuses, offlineCache: true, failedDownloadRetry: true };
}
