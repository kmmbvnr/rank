// Run against a local console with: playwright-cli run-code --filename packages/web/test/module-picker.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        const match = window.matchMedia.bind(window);
        window.matchMedia = query => match(query === '(pointer: coarse)' ? '(min-width: 0px)' : query);
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: 'X = ' }));
    });
    await page.reload();
    const picker = page.getByRole('tab', { name: 'Import a module' });
    await picker.click();
    const keys = page.locator('#keyboard-keys');
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
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rank-notebook-v1')));
    check(saved.cells.join('\n') === 'use text\nuse numbers', 'Persist imports at the top');
    await picker.click();
    await keys.getByRole('button', { name: /^testing Test/ }).click();
    await page.getByRole('tab', { name: 'core', exact: true }).waitFor();
    await picker.click();
    check(await keys.getByRole('button', { name: /^testing Test/ }).count() === 0, 'Hide imported modules without operator tabs');
}
