// Checks touch event policy and native-range copying in mobile Chromium emulation.
// Desktop Chromium does not emulate Android/iOS text handles or the system Copy menu.
async page => {
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    try {
        const mobile = await context.newPage();
        await mobile.goto(page.url());
        await mobile.evaluate(() => localStorage.setItem('rank-notebook-v1', JSON.stringify({
            cells: [], draft: 'Numbers = array 1 2 3\nNumbers sum',
        })));
        await mobile.reload();
        const first = await mobile.locator('.terminal-row').first().boundingBox();
        const client = await context.newCDPSession(mobile);
        const x = first.x + 90, y = first.y + first.height / 2;
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        await mobile.waitForTimeout(900);
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const policy = await mobile.evaluate(() => {
            const screen = document.querySelector('#screen');
            const event = new Event('contextmenu', { bubbles: true, cancelable: true });
            screen.dispatchEvent(event);
            return { blocked: event.defaultPrevented, selectable: getComputedStyle(screen).userSelect,
                editing: document.activeElement === document.querySelector('#input'),
                source: JSON.parse(localStorage.getItem('rank-notebook-v1')).draft };
        });
        if (policy.blocked || policy.selectable !== 'text' || policy.editing
            || policy.source !== 'Numbers = array 1 2 3\nNumbers sum')
            throw new Error(`long press must leave native selection available: ${JSON.stringify(policy)}`);
        // Install the range that a native mobile text selector supplies.
        await mobile.locator('.terminal-row').first().evaluate(row => {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const at = node.textContent.indexOf('Numbers');
                if (at < 0) continue;
                const range = document.createRange();
                range.setStart(node, at);
                range.setEnd(node, at + 'Numbers'.length);
                getSelection().removeAllRanges();
                getSelection().addRange(range);
                break;
            }
        });
        const copied = await mobile.evaluate(() => {
            const data = new DataTransfer();
            document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, cancelable: true }));
            return data.getData('text/plain');
        });
        if (copied !== 'Numbers') throw new Error(`touch copy must contain only source: ${JSON.stringify(copied)}`);
        await mobile.screenshot({ path: 'output/playwright/selection-touch.png' });
        return 'PASS: long press is not converted to editing, native selection is enabled, native range copies Numbers';
    } finally { await context.close(); }
}
