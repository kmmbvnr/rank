// Run against a local console with: playwright-cli run-code --filename packages/web/test/selection.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(() => {
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' }));
    });
    await page.reload();
    const input = page.getByRole('textbox', { name: 'Rank terminal input' });
    for (const source of ['A = 1', 'A + 2']) {
        await input.fill(source);
        await input.press('Enter');
        await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    }
    const positions = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.terminal-row')];
        const first = rows.find(row => row.textContent.includes('A = 1')).getBoundingClientRect();
        const last = rows.find(row => row.textContent.includes('A + 2')).getBoundingClientRect();
        const width = document.querySelector('#measure').getBoundingClientRect().width / 10;
        return { x1: first.x + width * 6, y1: first.y + first.height / 2,
            x2: last.x + width * 11, y2: last.y + last.height / 2 };
    });
    await page.mouse.move(positions.x1, positions.y1);
    await page.mouse.down();
    await page.mouse.move(positions.x2, positions.y2, { steps: 10 });
    await page.mouse.up();
    check(await page.evaluate(() => !getSelection().isCollapsed), 'mouse drag must create a native selection');
    const copied = await page.evaluate(() => {
        const data = new DataTransfer();
        document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, cancelable: true }));
        return data.getData('text/plain');
    });
    check(copied === 'A = 1\nA + 2', `copy must exclude prompts and results: ${JSON.stringify(copied)}`);
    const before = await page.evaluate(() => getSelection().toString());
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => getSelection().toString()) === before, 'resize must preserve native selection');
    await page.evaluate(() => getSelection().removeAllRanges());
    await input.focus();
    await input.fill('abcdef');
    await input.press('Shift+Home');
    await input.press('Z');
    check(await input.inputValue() === 'Z', 'typing must replace Shift selection');
    await input.press('Control+z');
    check(await input.inputValue() === 'abcdef', 'undo must restore selection replacement');
    for (const modifier of ['metaKey', 'ctrlKey']) {
        await input.press('End');
        await input.press('Shift+Home');
        for (const [key, type] of [['c', 'copy'], ['x', 'cut'], ['v', 'paste']]) {
            const result = await input.evaluate((element, { modifier, key, type }) => {
                const shortcut = new KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true });
                element.dispatchEvent(shortcut);
                const data = new DataTransfer();
                if (type === 'paste') data.setData('text/plain', 'abcdef');
                element.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true }));
                return { intercepted: shortcut.defaultPrevented, text: data.getData('text/plain') };
            }, { modifier, key, type });
            check(!result.intercepted, `${modifier}+${key} must allow the native clipboard event`);
            check(result.text === 'abcdef', `${modifier}+${key} must transfer only the selected source`);
            check(await input.inputValue() === (type === 'cut' ? '' : 'abcdef'), `${modifier}+${key} must update the draft correctly`);
        }
    }
    await input.press('Meta+c');
    check(await input.inputValue() === 'abcdef', 'Command-C without selection must not cancel the draft');
    await input.press('End');
    await input.press('Shift+Home');
    await input.evaluate(element => {
        const data = new DataTransfer();
        data.setData('text/plain', '1 + 2\n3 + 4');
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true, bubbles: true }));
    });
    check(await input.inputValue() === '1 + 2\n3 + 4', 'paste must replace selection without executing');
    const sourceRows = page.locator('.terminal-row');
    const firstRow = sourceRows.first();
    await firstRow.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
    });
    const native = await firstRow.evaluate(element => {
        const before = getSelection().toString();
        const event = new Event('contextmenu', { bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return { allowed: !event.defaultPrevented, selected: before,
            selectable: getComputedStyle(document.querySelector('#screen')).userSelect };
    });
    check(native.allowed && native.selected && native.selectable === 'text', 'native touch Copy menu must remain enabled');
    await page.screenshot({ path: 'output/playwright/selection-mobile.png' });
    return 'PASS: Command/Control clipboard events, mouse source copy, selection preservation, Shift replacement/undo, paste, native context-menu policy';
}
