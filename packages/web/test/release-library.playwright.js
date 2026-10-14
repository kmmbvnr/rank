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
        await page.addInitScript(() => {
            for (const key of ['rank-mobile-guidance-v1', 'rank-beginner-mobile-guidance-v1'])
                localStorage.setItem(key, JSON.stringify({ step: 'done' }));
        });
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
        await library.getByRole('button', { name: '015_latticepaths.ra', exact: true }).waitFor();
        const titles = await library.getByRole('button').allTextContents();
        check(titles.length === 16, 'Exactly 15 tasks plus Back');
        check(titles.slice(1).every((name, index) => name.startsWith(String(index + 1).padStart(3, '0') + '_')), 'Only tasks 1 through 15, in order');
        await library.getByRole('button', { name: '015_latticepaths.ra', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        check((await page.locator('#screen').textContent()).includes('Lattice Paths'), 'Bundled Euler 15 opens offline');
        check((await page.locator('#screen').textContent()).includes('Answer = Num // Den'), 'Bundle contains the simplified solution');
        check(!(await page.locator('#screen').textContent()).includes('AI-generated'), 'Curated source has no unreviewed note');
        await page.locator('#input').fill('rem Edited offline example');
        await page.locator('#brand').click();
        await page.waitForFunction(() => document.querySelector('#notebook-panel').getAttribute('aria-busy') === 'false');
        const editedId = await panel.locator('.history-row[data-active]').getAttribute('data-id');
        await panel.getByRole('button', { name: 'Library', exact: true }).click();
        await library.getByRole('button', { name: 'Project Euler ›', exact: true }).click();
        await library.getByRole('button', { name: '015_latticepaths.ra', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        check(await page.locator('#input').inputValue() === '', 'Offline Library reused edited draft');
        check((await page.locator('#screen').textContent()).includes('Answer = Num // Den'), 'Offline Library did not reload original source');
        await page.locator('#brand').click();
        await page.waitForFunction(() => document.querySelector('#notebook-panel').getAttribute('aria-busy') === 'false');
        check(await panel.locator('.history-row[data-active]').getAttribute('data-id') !== editedId, 'Offline Library reused notebook identity');
        await panel.locator(`.history-row[data-id="${editedId}"] .history-title`).click();
        await panel.waitFor({ state: 'hidden' });
        check((await page.locator('#screen').textContent()).includes('rem Edited offline example'), 'Offline Library lost edited copy: ' + await page.locator('#screen').textContent());
        check(remoteRequests === 0, 'Restricted Library must not request GitHub');
        return 'Release Library: only Euler 1–15; fresh offline copies preserve edits in history';
    } finally { await context.close(); }
}
