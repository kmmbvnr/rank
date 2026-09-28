// Run against a local console with: playwright-cli run-code --filename packages/web/test/live-preview-caret.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(() => {
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' }));
    });
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    const idle = () => page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.pressSequentially('fun f N');
    await input.press('Enter');
    await idle();
    await input.pressSequentially('1');
    await input.press('Enter');
    await idle();
    await input.pressSequentially('return N');
    await input.press('Enter');
    await idle();
    await input.pressSequentially('end');
    await idle();
    // The live preview must not shift the row: the caret sits right after the last glyph of `end`.
    const caret = await page.evaluate(() => {
        const screen = document.querySelector('#screen').getBoundingClientRect();
        const cell = document.querySelector('#measure').getBoundingClientRect().width / 10;
        const row = [...document.querySelectorAll('#screen > *')].find(row => /\bend$/.test(row.textContent.trimEnd()));
        return { caret: (document.querySelector('#caret').getBoundingClientRect().left - screen.left) / cell,
            text: [...row.textContent.trimEnd()].length };
    });
    check(Math.abs(caret.caret - caret.text) < 0.5, `the caret must sit after the last glyph: ${JSON.stringify(caret)}`);
}
