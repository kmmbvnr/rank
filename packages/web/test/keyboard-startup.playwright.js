// Run against the mobile console: playwright-cli run-code --filename packages/web/test/keyboard-startup.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
        localStorage.removeItem('rank-history-migrated-v1');
        localStorage.removeItem('rank-active-notebook-v1');
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['rem Migration draft'], draft: '' }));
        const book = { id: 'startup', title: 'Startup', manual: false, created: 1, updated: 1,
            snapshot: { cells: Array.from({ length: 120 }, (_, i) => `rem Saved line ${i + 1}`), draft: 'rem Last line' } };
        window.androidBridge = {};
        window.Capacitor = {
            PluginHeaders: [{ name: 'Notebooks', methods: ['list', 'get', 'save'].map(name => ({ name, rtype: 'promise' })) }],
            nativePromise: async (_plugin, method) => {
                if (method === 'list') {
                    await new Promise(resolve => setTimeout(resolve, 2200));
                    return { items: [book] };
                }
                if (method === 'get') return { book };
                return {};
            },
        };
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.rankShowKeyboard === 'function');
    check(await page.evaluate(() => !window.rankShowKeyboard()), 'IME requested before notebook restoration');
    await page.waitForTimeout(1900);
    check(await page.locator('#keyboard').isHidden(), 'startup timeout exposed symbols before the IME');
    check(await page.locator('#screen').textContent() === '', 'startup painted a temporary notebook');
    await page.waitForFunction(() => !document.querySelector('#input').readOnly);
    const firstFrame = await page.locator('#screen').textContent();
    const firstRows = await page.locator('#screen .terminal-row').allTextContents();
    check(firstFrame.includes('Last line') && !firstFrame.includes('Migration draft')
        && !firstRows.some(row => /Saved line 1\s*$/.test(row)), 'first notebook frame did not start at the current line');
    check(await page.evaluate(() => window.rankShowKeyboard()), 'ready notebook did not request the IME');
    await page.evaluate(() => { window.rankSoftKeyboard(false); window.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(1700);
    check(await page.locator('#keyboard').isHidden(), 'closed report exposed symbols during IME opening');
    check(await page.evaluate(() => document.activeElement.id === 'input'), 'closed report blurred the input');
    await page.evaluate(() => window.rankSoftKeyboard(true, 280));
    check(await page.locator('#keyboard').isHidden(), 'symbols appeared before the IME animation settled');
    await page.waitForTimeout(500);
    check(await page.locator('#keyboard').isVisible(), 'symbols were not prepared after the IME settled');
    check(await page.evaluate(() => document.activeElement.id === 'input'), 'preparing symbols dismissed the IME');
    await page.evaluate(() => window.rankSoftKeyboard(false));
    check(await page.locator('#keyboard').isVisible(), 'dismissing IME did not expose symbols');
    check(await page.evaluate(() => document.activeElement.id !== 'input'), 'symbol input kept reopening the IME');
    // Resuming the native app requests the system keyboard again, even if symbols were shown.
    await page.evaluate(() => window.rankShowKeyboard());
    check(await page.locator('#keyboard').isHidden(), 'resume exposed symbols before the IME');
    await page.evaluate(() => window.rankSoftKeyboard(true, 280));
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.activeElement.id === 'input'), 'resume lost IME focus');
}
