// Run against a local console with: playwright-cli run-code --filename packages/web/test/grid-alignment.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(() => {
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' }));
    });
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    await input.fill('A = 1');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    await input.fill('Text = "привет мир"');
    // A phone picks a fallback font for markers and Cyrillic; the row must keep its grid anyway.
    await page.addStyleTag({ content: '#screen span span span { font-family: serif; font-size: 200%; }' });
    const drift = await page.evaluate(() => {
        const screen = document.querySelector('#screen');
        const cell = document.querySelector('#measure').getBoundingClientRect().width / 10;
        const left = screen.getBoundingClientRect().left;
        let worst = 0;
        for (const row of screen.children) {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let column = 0;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                for (let index = 0; index < node.textContent.length; index++, column++) {
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const x = range.getBoundingClientRect().left - left;
                    worst = Math.max(worst, Math.abs(x / cell - column));
                }
            }
        }
        return worst;
    });
    check(drift < 0.2, `every glyph must sit in its own cell: drifted ${drift.toFixed(2)} cells`);
    const caret = await page.evaluate(() => {
        const screen = document.querySelector('#screen').getBoundingClientRect();
        const cell = document.querySelector('#measure').getBoundingClientRect().width / 10;
        const row = [...document.querySelectorAll('.terminal-row')].find(row => row.textContent.includes('привет'));
        return { caret: (document.querySelector('#caret').getBoundingClientRect().left - screen.left) / cell,
            text: [...row.textContent.trimEnd()].length };
    });
    check(Math.abs(caret.caret - caret.text) < 0.5, `the caret must follow the text it edits: ${JSON.stringify(caret)}`);
}
