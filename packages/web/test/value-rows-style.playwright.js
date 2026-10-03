// Results, values and errors, are drawn a little smaller than code on a touch console, in the same row height,
// with the marker where it was and the text starting where the code starts.
// Run the console: npm run dev --workspace @arrrank/web, then:
//   playwright-cli open http://localhost:5173/console.html
//   playwright-cli run-code --filename packages/web/test/value-rows-style.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const context = await page.context().browser().newContext({ viewport: { width: 411, height: 800 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 });
    try {
        const mobile = await context.newPage();
        await mobile.goto(page.url());
        await mobile.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' })));
        await mobile.reload();
        const input = mobile.locator('#input');
        const settled = () => mobile.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
        for (const source of ['A = array 1 2 3 4 5 6', '40 + 2', '1 / 0']) {
            await input.fill(source);
            await input.press('Enter');
            await settled();
        }
        await mobile.waitForFunction(() => document.querySelectorAll('#screen .terminal-result').length >= 4);
        const measured = await mobile.evaluate(() => {
            const rows = [...document.querySelectorAll('#screen .terminal-row')];
            // Left edge of the character at a linear text offset of a row, across its spans.
            const charLeft = (row, offset) => {
                const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
                let left = offset;
                for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                    if (left < node.length) {
                        const range = document.createRange();
                        range.setStart(node, left);
                        range.setEnd(node, left + 1);
                        return range.getBoundingClientRect().left;
                    }
                    left -= node.length;
                }
                return NaN;
            };
            const code = rows.find(row => row.textContent.includes('A = array 1 2 3 4 5 6'));
            const values = rows.filter(row => row.classList.contains('terminal-result'));
            const scalar = values.find(row => row.textContent.trim() === '42');
            const gutter = code.textContent.indexOf('A = array');
            const size = element => parseFloat(getComputedStyle(element).fontSize);
            const failure = rows.find(row => row.classList.contains('terminal-result') && row.textContent.trimStart().startsWith('!'));
            const failureSize = failure ? size(failure) : NaN;
            return {
                failureSize, failureHeight: failure?.getBoundingClientRect().height,
                failureText: failure ? charLeft(failure, gutter) : NaN,
                failureMarker: failure ? charLeft(failure, failure.textContent.indexOf('!')) : NaN,
                failureMarkerAt: failure ? charLeft(code, failure.textContent.indexOf('!')) : NaN,
                failureStart: failure?.textContent.trimStart().slice(0, 2),
                codeSize: size(code), valueSize: size(values[0]), codeHeight: code.getBoundingClientRect().height,
                valueHeights: values.map(row => row.getBoundingClientRect().height),
                codeLeft: charLeft(code, gutter), valueLeft: charLeft(scalar, gutter),
                classes: values.map(row => row.textContent.trim().slice(0, 14)),
                codeIsValue: code.classList.contains('terminal-result'),
            };
        });
        check(measured.valueSize < measured.codeSize, `a value is not smaller than code: ${measured.valueSize} vs ${measured.codeSize}`);
        check(measured.valueSize > measured.codeSize * 0.8, `a value is much smaller than code: ${measured.valueSize}`);
        check(measured.valueHeights.every(height => Math.abs(height - measured.codeHeight) < 0.6), `value rows changed the row height: ${measured.valueHeights} vs ${measured.codeHeight}`);
        check(Math.abs(measured.valueLeft - measured.codeLeft) < 1.5, `a value starts at ${measured.valueLeft}, code at ${measured.codeLeft}`);
        check(!measured.codeIsValue, 'a code row is drawn as a value');
        check(measured.failureSize < measured.codeSize, `an error is not smaller than code: ${measured.failureSize}`);
        check(Math.abs(measured.failureHeight - measured.codeHeight) < 0.6, `an error row changed the row height: ${measured.failureHeight}`);
        check(measured.failureStart === '! ', `the error marker is missing: ${JSON.stringify(measured.failureStart)}`);
        check(Math.abs(measured.failureMarker - measured.failureMarkerAt) < 1.5, `the error marker moved: ${measured.failureMarker} vs ${measured.failureMarkerAt}`);
        check(Math.abs(measured.failureText - measured.codeLeft) < 1.5, `an error starts at ${measured.failureText}, code at ${measured.codeLeft}`);
        return measured;
    } finally { await context.close(); }
}
