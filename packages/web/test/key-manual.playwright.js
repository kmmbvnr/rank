// Run the mobile console: npm run dev --workspace @arrrank/web -- --mode mobile
// Then: playwright-cli run-code --filename packages/web/test/key-manual.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    const keys = page.locator('#keyboard-keys');
    await keys.waitFor({ state: 'visible' });
    const source = () => page.locator('#input').inputValue();
    const key = name => keys.getByRole('button', { name, exact: true });
    const dialog = page.locator('#key-manual');
    const hold = async name => {
        const button = key(name);
        await button.scrollIntoViewIfNeeded();
        const rect = await button.boundingBox();
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await page.mouse.down();
        await dialog.waitFor({ state: 'visible' });
        await page.mouse.up();
    };
    // Native-disabled buttons swallow gestures; aria-disabled keys must still open help.
    check(await key('to').getAttribute('aria-disabled') === 'true', 'to should be unavailable');
    await key('to').evaluate(button => button.click());
    check(await source() === '', 'disabled tap inserted text');
    await hold('to');
    check(await source() === '', 'disabled hold inserted text');
    check(await dialog.locator('.manual-example pre').count() > 0, 'missing example');
    for (const heading of ['Usage', 'See also'])
        check(await dialog.getByRole('heading', { name: heading, exact: true }).count() === 1, `missing ${heading}`);
    check((await dialog.textContent()).includes('Both ends are included'), 'range semantics missing');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const example = await dialog.locator('.manual-example pre').first().textContent();
    await dialog.getByRole('button', { name: 'Copy example' }).first().click();
    check(await page.evaluate(() => navigator.clipboard.readText()) === example, 'copy did not preserve example');
    await dialog.getByRole('button', { name: 'Close manual' }).click();
    check(await keys.isVisible(), 'closing manual hid keyboard');
    check(await source() === '', 'closing manual changed draft');
    await hold('for');
    check(await source() === '', 'enabled hold inserted text');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await hold('for');
    const bounds = await dialog.boundingBox();
    await page.mouse.click(bounds.x + 20, bounds.y - 20);
    await dialog.waitFor({ state: 'hidden' });
    // Movement and pointer cancellation must abandon a pending hold.
    const rect = await key('for').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2);
    await page.waitForTimeout(600);
    check(!await dialog.isVisible(), 'drag opened manual');
    await page.mouse.up();
    check(await source() === '', 'drag inserted text');
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await key('for').evaluate(button => button.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
    await page.waitForTimeout(600);
    check(!await dialog.isVisible(), 'cancelled pointer opened manual');
    await page.mouse.up();
    check(await source() === '', 'cancelled pointer inserted text');
    await page.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
    await page.reload();
    await key('for').click();
    check(await source() === 'for ', 'normal tap no longer inserts');
    await page.locator('#input').fill('use numbers');
    await page.locator('#input').press('Enter');
    // Model dismissing the system keyboard after entering the import in the mobile shell.
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await page.evaluate(() => { window.rankSoftKeyboard(true, 280); window.rankSoftKeyboard(false); });
    await page.getByRole('tab', { name: 'numbers', exact: true }).click();
    await hold('sqrt');
    check((await dialog.textContent()).includes('Number sqrt'), 'module usage missing');
    check((await dialog.textContent()).includes('zero or positive'), 'module domain missing');
    check(await dialog.locator('.manual-result').textContent() === '3', 'example result missing');
    check(await dialog.getByRole('button', { name: 'Back' }).isHidden(), 'back shown on first page');
    // See also links open the related page; Back and Escape return before closing.
    await dialog.getByRole('button', { name: 'isqrt', exact: true }).click();
    check(await dialog.locator('#key-manual-title').textContent() === 'isqrt', 'see also link did not open isqrt');
    await dialog.getByRole('button', { name: 'Back' }).click();
    check(await dialog.locator('#key-manual-title').textContent() === 'sqrt', 'back did not return to sqrt');
    await dialog.getByRole('button', { name: 'isqrt', exact: true }).click();
    await page.keyboard.press('Escape');
    check(await dialog.isVisible() && await dialog.locator('#key-manual-title').textContent() === 'sqrt', 'escape did not step back');
    await dialog.getByRole('button', { name: 'Close manual' }).click();
    check(await page.getByRole('tab', { name: 'numbers', exact: true }).getAttribute('aria-selected') === 'true', 'manual changed module tab');
    await page.setViewportSize({ width: 844, height: 390 });
    await hold('sqrt');
    check(await dialog.isVisible(), 'landscape hold did not open manual');
    // Only core language pages link the beginner guide.
    check(await dialog.getByRole('button', { name: 'Rank basics' }).count() === 0, 'module page links Rank basics');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'core', exact: true }).click();
    await hold('for');
    await dialog.getByRole('button', { name: 'Rank basics' }).click();
    check((await dialog.textContent()).includes('the data comes first'), 'offline beginner guide missing');
    // The summary spans the sheet even when the back arrow is shown.
    const left = async selector => (await dialog.locator(selector).boundingBox()).x;
    check(Math.abs(await left('#key-manual-summary') - await left('.manual-body > p >> nth=0')) < 1, 'summary indented by back arrow');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Every key has a complete bundled page and an explained example.
    const coverage = await page.evaluate(async () => {
        const { keyManual } = await import('/src/key-manual.ts');
        // Resolve workspace imports through Vite's transformed source, independent of checkout path.
        const main = await (await fetch('/src/main.ts')).text();
        const keyboardUrl = main.match(/from "([^"]+symbol-keyboard\.js[^"]*)"/)[1];
        const { keyboardTabs, keyboardModules } = await import(keyboardUrl);
        const entries = keyboardTabs(keyboardModules([]).map(module => module.name)).flatMap(tab => tab.keys.map(key => keyManual(key, tab.module)));
        const text = entry => entry.sections.flatMap(section => section.paragraphs).join(' ');
        if (!text(keyManual('default')).includes('division by zero')) throw new Error('default edge cases missing');
        if (!keyManual('memo').sections[0].code.startsWith('memo name')) throw new Error('memo usage incorrect');
        // SQL examples need a real database, so only they may lack a result.
        const sql = ['sqlite', 'sqlquery', 'sql', 'explain'];
        return { count: entries.length, missing: entries.filter(entry => !entry.summary || !entry.example
            || entry.sections[0]?.heading !== 'Usage' || !entry.sections[0].code
            || (!entry.result && !sql.includes(entry.name) && entry.module !== 'cli' && entry.name !== 'test')).map(entry => entry.name) };
    });
    check(coverage.count > 200 && coverage.missing.length === 0, `manual coverage: ${JSON.stringify(coverage)}`);
}
