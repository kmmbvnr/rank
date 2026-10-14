// Run against the local mobile console with playwright-cli run-code --filename this file.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await context.newPage();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    let step = 'initialize';
    try {
        await page.addInitScript(() => {
            localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' }));
            localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['use io', 'for N in 1 to 100\n  N print\nend'], draft: '' }));
        });
        await page.goto(original.url());
        await page.waitForFunction(() => !document.querySelector('#brand').disabled);
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'Run program', exact: true }).click();
        const marker = page.locator('#screen .terminal-openable').filter({ hasText: '… · full output' });
        step = 'preview';
        await marker.waitFor();
        check(await page.locator('#screen .terminal-openable').count() === 5, 'Print preview must occupy exactly five rows');
        await marker.tap();
        step = 'viewer';
        const viewer = page.locator('#value-viewer');
        await viewer.waitFor({ state: 'visible' });
        check(await viewer.locator('h2').textContent() === 'Printed output', 'Print viewer title missing');
        check((await viewer.locator('.viewer-name p').textContent()).includes('100 lines'), 'Full line count missing');
        await page.waitForFunction(() => document.querySelector('#value-viewer tbody td')?.textContent === '1');
        step = 'scroll';
        await page.waitForFunction(() => {
            const table = document.querySelector('#value-viewer regular-table');
            table.scrollTop = table.scrollHeight;
            return [...table.querySelectorAll('tbody td')].some(cell => cell.textContent === '100');
        });
        await viewer.getByRole('button', { name: 'Close viewer' }).click();
        step = 'close';
        await viewer.waitFor({ state: 'hidden' });
        await marker.waitFor({ state: 'visible' });
        check(await marker.isVisible(), 'Closing viewer lost compact output');
        return 'Print preview: five rows; tap opens complete output; viewer scrolls to line 100 and returns to editor';
    } catch (error) {
        throw new Error(`${step}: ${error.message}; screen=${await page.locator('#screen').textContent()}; viewer=${await page.locator('#value-viewer').textContent()}`);
    } finally { await context.close(); }
}
