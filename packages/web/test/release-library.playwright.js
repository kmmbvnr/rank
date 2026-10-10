// Run against either mobile Vite (Release preview) or the production mobile preview.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    let remoteRequests = 0;
    await context.route(/https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//, route => {
        remoteRequests++;
        return route.abort();
    });
    const ready = () => page.waitForFunction(() => !document.querySelector('#brand')?.disabled);
    try {
        await page.goto(original.url()); await ready();
        await page.locator('#menu-toggle').click();
        const preview = page.getByRole('button', { name: 'Release preview', exact: true });
        if (await preview.isVisible()) {
            await Promise.all([page.waitForEvent('load'), preview.click()]);
            await page.waitForFunction(() => localStorage.getItem('rank-debug-beginner-v1') === 'true'
                && !document.querySelector('#brand')?.disabled);
        } else await page.keyboard.press('Escape');
        await ready();
        await page.evaluate(() => window.rankSoftKeyboard(false));
        await page.locator('#input').fill('rem Keep this draft');
        await page.locator('#brand').click();
        const panel = page.locator('#notebook-panel');
        await panel.getByRole('button', { name: 'Library', exact: true }).click();
        const library = page.locator('.library-view');
        await library.getByRole('button', { name: 'Project Euler ›', exact: true }).waitFor();
        check(await library.getByRole('button').count() === 2, 'Release root contains only Back and Project Euler');
        await library.getByRole('button', { name: 'Project Euler ›', exact: true }).click();
        await library.getByRole('button', { name: '014_collatz.ra', exact: true }).waitFor();
        const titles = await library.getByRole('button').allTextContents();
        check(titles.length === 15, 'Exactly 14 tasks plus Back');
        check(titles.slice(1).every((name, index) => name.startsWith(String(index + 1).padStart(3, '0') + '_')), 'Only tasks 1 through 14, in order');
        await library.getByRole('button', { name: '001_multiples.ra', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        check((await page.locator('#screen').textContent()).includes('Multiples of 3 or 5'), 'Bundled source opens offline');
        check(!(await page.locator('#screen').textContent()).includes('AI-generated'), 'Curated source has no unreviewed note');
        check(remoteRequests === 0, 'Restricted Library must not request GitHub');
        return 'Release Library: only Euler 1–14; bundled source opens without GitHub';
    } finally { await context.close(); }
}
