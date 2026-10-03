// Run the console: npm run dev --workspace @arrrank/web   (add `-- --mode mobile` to check the phone keyboard)
// Then: playwright-cli open http://localhost:5173/console.html
//       playwright-cli run-code --filename packages/web/test/value-viewer.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    const settled = () => page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.fill('use sequences');
    await input.press('Enter');
    await settled();
    await input.fill('T = (1 to 3000000) (array 1000000 3) reshape');
    await input.press('Enter');
    await settled();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('integer [1000000 3]'));

    // A result row is a stop; Enter opens the viewer over the notebook.
    await input.press('ArrowUp');
    await input.press('Enter');
    const dialog = page.locator('#value-viewer');
    await dialog.waitFor({ state: 'visible' });
    check((await dialog.locator('h2').textContent()) === 'T', 'the title is the name');
    check((await dialog.locator('.viewer-name p').textContent()).includes('[1000000 3]'), 'the type line shows the shape');
    const keyboardHidden = await page.evaluate(() => document.querySelector('#keyboard')?.hidden ?? true);
    check(keyboardHidden, 'the keyboard stays up under the viewer');

    // The first window shows the first rows, and the grid never holds more than the screen.
    const cells = () => dialog.locator('tbody td').count();
    await page.waitForFunction(() => document.querySelector('#value-viewer tbody td')?.textContent === '1');
    check(await cells() < 600, 'rendered cells are not bounded');
    // The first draw fills the screen without a touch: a 844 px phone shows more than the 22 rows of a cold start.
    await page.waitForFunction(() => document.querySelectorAll('#value-viewer tbody tr').length >= 30, null, { timeout: 5000 });
    check((await dialog.locator('thead th').count()) >= 3, 'column headers missing');

    // Scrolling is smooth: a few pixels move the rows by pixels, not by a whole row.
    const firstRowTop = () => page.evaluate(() => document.querySelector('#value-viewer tbody tr').getBoundingClientRect().top);
    const restingTop = await firstRowTop();
    await page.evaluate(() => { document.querySelector('regular-table').scrollTop = 3; });
    await page.waitForFunction(top => document.querySelector('#value-viewer tbody tr').getBoundingClientRect().top !== top, restingTop, { timeout: 3000 });
    const moved = restingTop - await firstRowTop();
    check(moved > 1 && moved < 20, `three pixels of scroll moved the first row by ${moved}px`);
    await page.evaluate(() => { document.querySelector('regular-table').scrollTop = 0; });

    // Scroll to the end: the last row shows the last values, still with a bounded number of cells.
    await page.evaluate(() => { const table = document.querySelector('regular-table'); table.scrollTop = table.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('#value-viewer tbody tr:last-child td')?.textContent === '2999998', null, { timeout: 15000 });
    const last = await page.evaluate(() => {
        const row = document.querySelector('#value-viewer tbody tr:last-child');
        return { header: row.querySelector('th').textContent, cells: [...row.querySelectorAll('td')].map(cell => cell.textContent) };
    });
    check(last.header === '999999', `last row label is ${last.header}`);
    check(JSON.stringify(last.cells) === JSON.stringify(['2999998', '2999999', '3000000']), `last row is ${last.cells}`);
    check(await cells() < 600, 'rendered cells grew while scrolling');
    const numbersAligned = await page.evaluate(() => getComputedStyle(document.querySelector('#value-viewer tbody td')).textAlign);
    check(numbersAligned === 'right', 'numbers are not right-aligned');

    // Escape closes the viewer and returns to the result row.
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    // The close event reaches the notebook a moment later; the result row is highlighted once it has.
    await page.waitForFunction(() => document.querySelectorAll('#screen span[style*="background-color"]').length > 0, null, { timeout: 5000 });

    // Android's Back reaches the page as rankBack(): it closes an open viewer, and answers false when none is open.
    await input.press('Enter');
    await dialog.waitFor({ state: 'visible' });
    check(await page.evaluate(() => window.rankBack()) === true, 'Back did not take the press');
    await dialog.waitFor({ state: 'hidden' });
    check(await page.evaluate(() => window.rankBack()) === false, 'Back claimed a press with no viewer open');
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('integer [1000000 3]'), null, { timeout: 5000 });
    // Opened from the focused row, closing returns to it (highlighted); opened by a tap, the row stays unselected.
    const highlighted = () => page.locator('#screen span[style*="background-color"]').count();
    await page.waitForFunction(() => document.querySelectorAll('#screen span[style*="background-color"]').length > 0, null, { timeout: 5000 });
    await page.locator('#screen .terminal-row', { hasText: 'integer [1000000 3]' }).first().click();
    await dialog.waitFor({ state: 'visible' });
    check(await page.evaluate(() => window.rankBack()) === true, 'Back did not take the press after a tap');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('integer [1000000 3]'), null, { timeout: 5000 });
    check(await highlighted() === 0, 'a tap left the result row selected after closing');
    return { bounded: true, lastRow: last, keyboardHidden };
}
