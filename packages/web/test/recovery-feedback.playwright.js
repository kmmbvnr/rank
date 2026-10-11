// Start the mobile Vite console, then use playwright-cli run-code --filename this file.
async original => {
    const browser = original.context().browser();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const recoveryContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const feedbackContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
    try {
        await recoveryContext.addInitScript(() => {
            if (!sessionStorage.getItem('failed-once')) {
                sessionStorage.setItem('failed-once', 'true');
                localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['rem Keep my notebook'], draft: 'Draft = ' }));
                IDBFactory.prototype.open = () => { throw new Error('simulated storage failure'); };
            }
            IDBFactory.prototype.deleteDatabase = () => { throw new Error('Recovery must never delete storage'); };
        });
        const recovery = await recoveryContext.newPage();
        await recovery.goto(original.url());
        await recovery.getByRole('heading', { name: 'Cannot open your notebooks' }).waitFor();
        check(await recovery.locator('#history-recovery').textContent().then(text => text.includes('simulated storage failure')), 'missing error details');
        await recovery.locator('#history-feedback').click();
        await recovery.getByRole('dialog', { name: 'Send feedback' }).waitFor();
        await recovery.getByRole('button', { name: 'Cancel', exact: true }).click();
        await recovery.getByRole('button', { name: 'Retry', exact: true }).click();
        await recovery.waitForLoadState('domcontentloaded');
        await recovery.waitForFunction(() => !document.querySelector('#brand').disabled);
        check(await recovery.locator('#history-recovery').isHidden(), 'recovery panel remained after retry');
        check(await recovery.locator('#input').inputValue() === 'Draft = ', 'retry lost unfinished draft');
        check((await recovery.locator('#screen').textContent()).includes('Keep my notebook'), 'retry lost existing cells');

        await feedbackContext.addInitScript(() => localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' })));
        const page = await feedbackContext.newPage();
        await page.goto(original.url());
        await page.waitForFunction(() => !document.querySelector('#brand').disabled);
        await page.locator('#input').fill('Secret = 1234567');
        await page.getByRole('button', { name: 'Terminal commands' }).click();
        await page.getByRole('button', { name: 'Send feedback', exact: true }).filter({ visible: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Send feedback' });
        await page.waitForFunction(() => document.querySelector('#feedback a').hasAttribute('href'));
        await dialog.getByRole('textbox').fill('Scrolling stopped working');
        const url = await dialog.getByRole('link', { name: 'Open GitHub' }).evaluate(link => {
            const url = new URL(link.href);
            return { origin: url.origin, pathname: url.pathname, body: url.searchParams.get('body') };
        });
        check(url.origin === 'https://github.com' && url.pathname === '/kmmbvnr/rank/issues/new', 'wrong feedback destination');
        const body = url.body;
        check(body.includes('Scrolling stopped working') && body.includes('Revision:') && body.includes('WebView/browser:'), 'missing report or diagnostics');
        check(!body.includes('Secret') && !body.includes('1234567'), 'notebook source leaked into diagnostics');
        check(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth), 'feedback exceeds small viewport');
        await page.keyboard.press('Escape');
        check(await dialog.isHidden(), 'Escape did not close feedback');
        check(await page.locator('#input').inputValue() === 'Secret = 1234567', 'feedback changed editor contents');
        return 'Retry preserved cells and draft, feedback works during storage failure, diagnostics exclude notebook contents, small viewport and dismissal passed';
    } finally { await recoveryContext.close(); await feedbackContext.close(); }
}
