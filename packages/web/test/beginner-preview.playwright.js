// Run against the mobile Vite console with playwright-cli run-code --filename this file.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const check = (value, message) => { if (!value) throw new Error(message); };
    const ready = () => page.waitForFunction(() => !document.querySelector('#brand')?.disabled);
    const input = page.locator('#input');
    const enter = async () => {
        await page.locator('#menu-toggle').click();
        await Promise.all([page.waitForEvent('load'),
            page.getByRole('button', { name: 'Release preview', exact: true }).click()]);
        await page.waitForFunction(() => localStorage.getItem('rank-debug-beginner-v1') === 'true'
            && !document.querySelector('#brand')?.disabled).catch(async error => {
                throw new Error(`${await page.evaluate(() => localStorage.getItem('rank-debug-beginner-v1'))}: ${await page.locator('#screen').textContent()} / ${error.message}`);
            });
        await ready();
    };
    const leave = async () => {
        check(await page.locator('#brand').evaluate(brand => {
            const style = getComputedStyle(brand);
            return style.userSelect === 'none' && style.touchAction === 'none'
                && !brand.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        }), 'RANK must reserve long press instead of selecting text or opening a copy menu');
        const box = await page.locator('#brand').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.waitForTimeout(2200); await page.mouse.up();
        await page.waitForFunction(() => localStorage.getItem('rank-debug-beginner-v1') === 'false'
            && !document.querySelector('#brand')?.disabled).catch(async error => {
                throw new Error(`${await page.evaluate(() => localStorage.getItem('rank-debug-beginner-v1'))}: ${await page.locator('#screen').textContent()} / ${error.message}`);
            });
        await ready();
    };
    try {
        await page.goto(original.url()); await ready();
        await input.fill('rem My work\nUnfinished = ');
        // Switching immediately must flush the draft before resetting the interpreter/page.
        await enter();
        check(await input.inputValue() === '', 'developer draft leaked into preview');
        await page.locator('#mobile-guidance[data-step="offer"]').waitFor();
        await input.fill('rem Sandbox only');
        await page.locator('#brand').click();
        await page.locator('#notebook-panel').waitFor();
        for (const title of ['1. Arrays and matrices', '2. Sequences and pipelines', '3. Your own functions'])
            await page.getByRole('button', { name: title, exact: true }).waitFor();
        check(await page.getByRole('button', { name: 'My work', exact: true }).count() === 0, 'developer history leaked');
        await page.getByRole('button', { name: 'Close notebook history' }).click();
        await page.waitForTimeout(250);
        await page.reload(); await ready();
        check(await input.inputValue() === 'rem Sandbox only', 'preview did not survive restart');
        await leave();
        check(await input.inputValue() === 'rem My work\nUnfinished = ', 'return lost original draft');
        await page.locator('#brand').click();
        await page.getByRole('button', { name: 'My work', exact: true }).waitFor();
        check(await page.getByRole('button', { name: 'Sandbox only', exact: true }).count() === 0, 'sandbox leaked into real history');
        await page.getByRole('button', { name: 'Close notebook history' }).click();
        await enter();
        check(await input.inputValue() === '', 'second entry did not reset sandbox');
        await page.locator('#mobile-guidance[data-step="offer"]').waitFor();
        await input.fill('Another preview');
        await leave();
        check(await input.inputValue() === 'rem My work\nUnfinished = ', 'repeated entry changed real draft');
        // Failed saves must block entry and preserve the real notebook.
        await page.evaluate(() => {
            window.originalPreviewPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(...args) {
                if (this.name === 'source') { this.transaction.abort(); throw new Error('preview save failure'); }
                return window.originalPreviewPut.apply(this, args);
            };
        });
        await input.fill('Unsaved = 42');
        await page.locator('#menu-toggle').click();
        await page.getByRole('button', { name: 'Release preview', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('preview save failure'));
        check(await input.inputValue() === 'Unsaved = 42', 'failed save lost draft');
        check(await page.evaluate(() => localStorage.getItem('rank-debug-beginner-v1')) === 'false', 'failed save switched sandbox');
        await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPreviewPut; });
        return 'Debug beginner preview: isolated history, draft flush, restart, secret return, repeat entry and failed-save protection passed';
    } finally { await context.close(); }
}
