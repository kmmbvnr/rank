// Run against a production mobile build (vite preview --outDir dist-mobile).
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const check = (value, message) => { if (!value) throw new Error(message); };
    try {
        await context.addInitScript(() => {
            if (!localStorage.getItem('release-fixture')) {
                localStorage.setItem('release-fixture', 'true');
                localStorage.setItem('rank-debug-beginner-v1', 'true');
                localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['rem Real user notebook'], draft: 'Unfinished = ' }));
                localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' }));
            }
        });
        await page.goto(original.url());
        const ready = () => page.waitForFunction(() => !document.querySelector('#brand')?.disabled);
        await ready();
        check(await page.locator('#input').inputValue() === 'Unfinished = ', 'stale debug flag broke normal migration');
        await page.locator('#menu-toggle').click();
        check(await page.getByRole('button', { name: 'Beginner mode', exact: true }).count() === 0, 'debug menu visible in production');
        await page.keyboard.press('Escape');
        await page.locator('#input').fill('User draft = 42');
        await page.waitForTimeout(250);
        await page.reload(); await ready();
        check(await page.locator('#input').inputValue() === 'User draft = 42', 'normal user history did not persist');
        check(await page.evaluate(() => !!localStorage.getItem('rank-active-notebook-v1') && !localStorage.getItem('rank-beginner-active-notebook-v1')), 'production selected sandbox');
        return 'Production: no preview menu, stale debug flag ignored, normal migration and history persistence passed';
    } finally { await context.close(); }
}
