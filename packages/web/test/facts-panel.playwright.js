// A tap on the footer opens its full text in a panel; the next tap closes it.
// Run the console on port 5199: npm run dev --workspace @arrrank/web -- --port 5199, then:
//   playwright-cli open http://localhost:5199/console.html
//   playwright-cli run-code --filename packages/web/test/facts-panel.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    const settle = () => page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.fill('use sequences');
    await input.press('Enter');
    await settle();
    await input.fill('F = 1 to 9');
    await input.press('Enter');
    await settle();
    await input.fill('F F outer *');
    await input.press('Home');
    for (let step = 0; step < 4; step++) await input.press('ArrowRight');
    const footer = page.locator('.terminal-facts');
    await footer.waitFor({ timeout: 5000 });
    const panel = page.locator('#facts-panel');
    check(await panel.isHidden(), 'the panel starts closed');
    await footer.click();
    await panel.waitFor({ state: 'visible' });
    check((await panel.textContent()).includes('outer'), `panel text is ${await panel.textContent()}`);
    await footer.click();
    await panel.waitFor({ state: 'hidden' });
    return { ok: true };
}
