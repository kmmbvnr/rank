// While a run takes longer than half a second the caret stops blinking and breathes instead.
// Run the console: npm run dev --workspace @arrrank/web, then:
//   playwright-cli open http://localhost:5173/console.html
//   playwright-cli run-code --filename packages/web/test/working-caret.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    const animation = () => page.evaluate(() => getComputedStyle(document.querySelector('#caret')).animationName);
    const working = () => page.evaluate(() => document.querySelector('#terminal').classList.contains('working'));
    await input.fill('use sequences');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.fill('F = 1 to 4000');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    check(!await working(), 'idle caret should not be working');
    await input.fill('F F outer * sum rank 2');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#terminal').classList.contains('working'), null, { timeout: 5000 });
    check(await animation() === 'caret-working', `caret animation while working is ${await animation()}`);
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false', null, { timeout: 60000 });
    check(!await working(), 'the caret should go back to blinking when the run ends');
    check(await animation() === 'caret-blink', `caret animation after the run is ${await animation()}`);
    return { ok: true };
}
