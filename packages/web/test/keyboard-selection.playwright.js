// A long press on the screen selects text natively and the system keyboard goes away with it; the symbol
// keyboard must go too, or it would be left standing over the Copy menu.
// Run the console: npm run dev --workspace @arrrank/web, then:
//   playwright-cli open http://localhost:5173/console.html
//   playwright-cli run-code --filename packages/web/test/keyboard-selection.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    try {
        const mobile = await context.newPage();
        await mobile.goto(page.url());
        await mobile.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({
            cells: [], draft: 'Numbers = array 1 2 3\nNumbers sum',
        })));
        await mobile.reload();
        const keyboard = mobile.locator('#keyboard');
        await mobile.waitForFunction(() => { const keyboard = document.querySelector('#keyboard'); return keyboard && !keyboard.hidden; }, null, { timeout: 5000 });
        check(await keyboard.isVisible(), 'the symbol keyboard is shown to begin with');
        // The range a native long press makes in the notebook text.
        await mobile.evaluate(() => {
            const row = document.querySelector('#screen .terminal-row');
            const text = [...row.querySelectorAll('*')].find(element => element.firstChild?.nodeType === 3)?.firstChild ?? row.firstChild;
            getSelection().setBaseAndExtent(text, 0, text, Math.min(4, text.textContent.length));
        });
        await mobile.waitForFunction(() => document.querySelector('#keyboard').hidden, null, { timeout: 3000 });
        check(!(await keyboard.isVisible()), 'the symbol keyboard stays up over a native selection');
        check((await mobile.evaluate(() => getSelection().toString())).length > 0, 'the selection survived hiding the keyboard');
        return { hidden: true };
    } finally { await context.close(); }
}
