// Run against a local console with: playwright-cli run-code --filename packages/web/test/module-picker.playwright.js
async existingPage => {
    const context = await existingPage.context().browser().newContext();
    const page = await context.newPage();
    try {
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
            const match = window.matchMedia.bind(window);
            window.matchMedia = query => match(query === '(pointer: coarse)' ? '(min-width: 0px)' : query);
            localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: 'X = ' }));
        });
        await page.goto(existingPage.url());
        await page.waitForFunction(() => !document.querySelector('#input').readOnly);
        const coreKeys = await page.locator('#keyboard-keys button').allTextContents();
        for (const key of ['args', 'argument', 'flag', 'option', 'new', 'push', 'stdin', 'test',
            'sort by', 'argsort by', 'group by', 'leftjoin by', 'innerjoin by', 'leftjoin on',
            'innerjoin on', 'select', 'ascending', 'descending', 'index', 'first where', 'first index where', 'true', 'false'])
            check(!coreKeys.includes(key), `Core must not offer ${key}`);
        check(JSON.stringify(coreKeys) === JSON.stringify([...coreKeys].sort()), 'Sort Core keys alphabetically');
        const picker = page.getByRole('tab', { name: 'Import a module' });
        await picker.click();
        const keys = page.locator('#keyboard-keys');
        if (await page.evaluate(() => document.documentElement.classList.contains('mobile')))
            check(await keys.locator('strong').filter({ hasText: /^cli$/ }).count() === 0, 'Hide CLI on Android');
        check(await keys.getByRole('button', { name: /^numbers Arithmetic/ }).isEnabled(), 'Picker must work in an unfinished expression');
        await keys.getByRole('button', { name: /^numbers Arithmetic/ }).click();
        await page.getByRole('tab', { name: 'numbers', exact: true }).waitFor();
        check(await page.getByRole('tab', { name: 'numbers', exact: true }).getAttribute('aria-selected') === 'true', 'Select the imported tab');
        check(await page.getByRole('textbox').inputValue() === 'X = ', 'Preserve the unfinished draft');
        await picker.click();
        check(await keys.getByRole('button', { name: /^numbers Arithmetic/ }).count() === 0, 'Hide imported modules');
        await keys.getByRole('button', { name: /^text Splitting/ }).click();
        await page.getByRole('tab', { name: 'text', exact: true }).waitFor();
        check(await page.getByRole('tab', { name: 'numbers', exact: true }).count() === 1, 'Keep earlier imports active');
        check(await page.getByRole('tab', { name: 'text', exact: true }).getAttribute('aria-selected') === 'true', 'Select the second import');
        check(await page.getByRole('textbox').inputValue() === 'X = ', 'Second import must preserve the draft');
        const source = await page.locator('#screen').textContent();
        check(/use numbers.*use text.*X = /s.test(source), 'Keep imports above the unfinished draft');
        await picker.click();
        await keys.getByRole('button', { name: /^tables CSV/ }).click();
        await page.getByRole('tab', { name: 'tables', exact: true }).waitFor();
        check(await keys.getByRole('button', { name: 'innerjoin by', exact: true }).count() === 1, 'Offer joins after use tables');
        await picker.click();
        await keys.getByRole('button', { name: /^testing Test/ }).click();
        await page.getByRole('tab', { name: 'testing', exact: true }).waitFor();
        check(await keys.getByRole('button', { name: 'test', exact: true }).count() === 1, 'Offer the imported test statement');
        await picker.click();
        check(await keys.getByRole('button', { name: /^testing Test/ }).count() === 0, 'Hide the imported testing module');
        await page.getByRole('tab', { name: 'core', exact: true }).click();
        await page.getByRole('textbox').fill('');
        for (const key of ['default', 'break', 'continue', 'return', 'yield'])
            check(await page.locator('#keyboard-keys').getByRole('button', { name: key, exact: true }).getAttribute('aria-disabled') === 'true', `Disable ${key} at the start of a top-level line`);
    } finally {
        await context.close();
    }
}
