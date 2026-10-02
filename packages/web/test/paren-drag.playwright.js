// Checks that a finger can drag a bracket to a new grouping: a ghost bracket shows the landing,
// the source stays untouched while dragging, and the edit is made on release.
async page => {
    const context = await page.context().browser().newContext({ viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    try {
        const mobile = await context.newPage();
        await mobile.goto(page.url());
        const draft = 'A = 1\nB = 2\nTotal = A + (B * 3)';
        await mobile.evaluate(draft => localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft })), draft);
        await mobile.reload();
        const source = () => mobile.evaluate(() => JSON.parse(localStorage.getItem('rank-notebook-v1')).draft);
        const row = mobile.locator('.terminal-row', { hasText: 'Total = A + (B * 3)' }).first();
        const box = await row.boundingBox();
        const cell = await mobile.evaluate(() => document.querySelector('#measure').getBoundingClientRect().width / 10);
        const y = box.y + box.height / 2;
        const open = 'Total = A + '.length;
        const startX = box.x + (open + 0.5) * cell;
        const client = await context.newCDPSession(mobile);
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y }] });
        // Left over `A`, the nearest landing that takes it into the group.
        const targetX = box.x + ('Total = '.length + 0.5) * cell;
        for (let step = 1; step <= 6; step++) {
            const x = startX + (targetX - startX) * step / 6;
            await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        const during = await mobile.evaluate(() => {
            const ghost = document.querySelector('#paren-ghost');
            return { shown: !ghost.hidden, text: ghost.textContent };
        });
        if (!during.shown || during.text !== '(') throw new Error(`ghost bracket must show while dragging: ${JSON.stringify(during)}`);
        if (await source() !== draft) throw new Error('the source must not change while dragging');
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await mobile.waitForTimeout(200);
        const after = await source();
        if (after !== 'A = 1\nB = 2\nTotal = (A + B * 3)') throw new Error(`release must move the bracket: ${JSON.stringify(after)}`);
        if (await mobile.evaluate(() => !document.querySelector('#paren-ghost').hidden)) throw new Error('ghost must go away on release');
        return 'PASS: dragging ( over A shows a ghost, leaves the text alone, and regroups on release';
    } finally { await context.close(); }
}
