// Run in an isolated local browser session with playwright-cli run-code --filename this-file.
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    await input.fill('Count = 1');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.fill('Count = "wrong"');
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('cannot receive text'));
    check((await page.locator('#screen').textContent()).includes('TypeError'), 'expected a type diagnostic before Enter');
    await input.fill('Count + 2');
    await page.waitForFunction(() => !document.querySelector('#screen').textContent.includes('TypeError'));
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    check((await page.locator('#screen').textContent()).includes('3'), 'the erroneous draft must not change Count');
    return { diagnosticBeforeEnter: true, withdrawnAfterEdit: true, originalValuePreserved: true };
}
