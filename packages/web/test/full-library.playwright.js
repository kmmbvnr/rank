// Run against the development mobile console.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    let revision = 0;
    const tree = [
        { path: 'demos/README.md', type: 'blob' },
        { path: 'demos/classic', type: 'tree' },
        { path: 'demos/classic/README.md', type: 'blob' },
        { path: 'demos/classic/queens.ra', type: 'blob' },
        { path: 'demos/classic/queens_permutations.ra', type: 'blob' },
        { path: 'demos/classic/queens_test.ra', type: 'blob' },
    ];
    try {
        await page.addInitScript(() => localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' })));
        await page.route('https://api.github.com/repos/kmmbvnr/rank/**', route => {
            if (route.request().url().includes('/commits/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sha: `revision${++revision}` }) });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ tree: revision === 1 ? [] : tree, truncated: false }) });
        });
        await page.route('https://raw.githubusercontent.com/kmmbvnr/rank/**', route => {
            const url = route.request().url();
            check(url.includes(`/revision${revision}/`), 'Source must match the refreshed catalog revision');
            const body = url.endsWith('/demos/README.md') ? '[Classic Problems](classic/)'
                : url.endsWith('/README.md') ? '# Classic problems' : 'rem N-Queens\nSize = 8';
            return route.fulfill({ contentType: 'text/plain', body });
        });
        await page.goto(original.url());
        await page.waitForFunction(() => !document.querySelector('#brand').disabled);
        const panel = page.locator('#notebook-panel');
        const library = page.locator('.library-view');
        const enter = async () => {
            await page.locator('#brand').click();
            await panel.getByRole('button', { name: 'Library', exact: true }).click();
        };
        await enter();
        await page.waitForFunction(() => document.querySelector('.library-view [role=status]').textContent === 'No examples in this folder.');
        await panel.getByRole('button', { name: 'Close notebook history' }).click();
        await enter();
        await library.getByRole('button', { name: 'Classic Problems ›', exact: true }).click();
        await library.getByRole('button', { name: 'queens.ra', exact: true }).waitFor();
        check(await library.getByRole('button', { name: 'queens_permutations.ra', exact: true }).isVisible(), 'Permutation example missing');
        check(await library.getByRole('button', { name: 'queens_test.ra', exact: true }).count() === 0, 'Test file leaked');
        await library.getByRole('button', { name: 'queens.ra', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        check((await page.locator('#screen').textContent()).includes('Size = 8'), 'Queens example did not open');
        check(revision === 2, 'Reentering Library must refresh once; folder navigation must keep the revision');
        return 'Full Library refreshes without restarting, lists both Queens demos, and opens the refreshed source';
    } finally { await context.close(); }
}
