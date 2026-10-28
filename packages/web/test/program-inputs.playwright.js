// Start the Vite console, then run with playwright-cli run-code --filename this file.
async page => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.evaluate(async () => {
        const { notebookStore } = await import('/src/notebook-store.ts');
        const id = 'program-input-test-' + crypto.randomUUID(), now = Date.now();
        await notebookStore().save({ id, title: 'Program input test', manual: true, created: now, updated: now,
            snapshot: { cells: [
                'use cli', 'use io', 'use numbers', 'arg Input path', 'arg Limit integer = 3',
                'arg Numbers integer array = array 1 2 3', 'flag Verbose',
                'Input read print', 'Limit print', 'Numbers sum print', 'Verbose print',
            ], draft: '' } });
        localStorage.setItem('rank-active-notebook-v1', id);
    });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    // Supply the system picker's change event without opening an OS modal in this browser test.
    await page.evaluate(() => {
        const click = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (this.type !== 'file') return click.call(this);
            const transfer = new DataTransfer();
            transfer.items.add(new File(['selected file contents'], 'numbers.txt', { type: 'text/plain' }));
            this.files = transfer.files;
            this.dispatchEvent(new Event('change'));
            HTMLInputElement.prototype.click = click;
        };
    });
    await page.getByRole('button', { name: 'Choose file for Input', exact: true }).click();
    await page.getByText('numbers.txt', { exact: true }).waitFor();
    const open = async () => {
        await page.getByRole('button', { name: 'Terminal commands' }).click();
        await page.getByRole('button', { name: 'Run program', exact: true }).click();
    };
    await open();
    const dialog = page.getByRole('dialog', { name: 'Run program', exact: true });
    await dialog.waitFor();
    if (await dialog.getByRole('textbox', { name: 'Input', exact: true }).inputValue() !== 'numbers.txt')
        throw new Error('Selected path should display its filename');
    await dialog.getByLabel('Use default: 3', { exact: true }).uncheck();
    await dialog.getByRole('textbox', { name: 'Limit', exact: true }).fill('5');
    await dialog.getByLabel('Use default: array 1 2 3', { exact: true }).uncheck();
    await dialog.getByRole('textbox', { name: 'Numbers', exact: true }).fill('4\n5');
    await dialog.getByLabel('Use default: false', { exact: true }).uncheck();
    await dialog.getByRole('textbox', { name: 'Verbose', exact: true }).fill('true');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    let output = await page.locator('#screen').innerText();
    if (!output.includes('selected file contents') || !output.includes('5') || !output.includes('9') || !output.includes('true'))
        throw new Error('Inputs did not reach interpreter: ' + output);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await open();
    if (await dialog.getByRole('textbox', { name: 'Limit', exact: true }).inputValue() !== '5'
        || await dialog.getByRole('textbox', { name: 'Numbers', exact: true }).inputValue() !== '4\n5')
        throw new Error('Previous arguments were lost on reload');
    await dialog.getByRole('textbox', { name: 'Limit', exact: true }).fill('bad integer');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await dialog.getByRole('alert').filter({ hasText: 'expected integer' }).waitFor();
    await dialog.getByRole('textbox', { name: 'Limit', exact: true }).fill('6');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    output = await page.locator('#screen').innerText();
    if (!output.includes('selected file contents') || !output.includes('6')) throw new Error('Saved file cannot be reopened: ' + output);
    const isolationTitle = await page.evaluate(async () => {
        const { notebookStore } = await import('/src/notebook-store.ts');
        const now = Date.now(), title = 'Input isolation test ' + crypto.randomUUID();
        await notebookStore().save({ id: 'input-isolation-' + crypto.randomUUID(), title,
            manual: true, created: now, updated: now,
            snapshot: { cells: ['use cli', 'use io', 'arg Limit integer = 33', 'Limit print'], draft: '' } });
        return title;
    });
    await page.getByRole('button', { name: 'Open notebook history' }).click();
    await page.getByRole('dialog', { name: 'Notebook history' }).getByRole('button', { name: isolationTitle, exact: true }).click();
    await open();
    if (!await dialog.getByLabel('Use default: 33', { exact: true }).isChecked())
        throw new Error('Inputs leaked between notebooks');
    await dialog.getByRole('button', { name: 'Run', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#input').getAttribute('aria-busy') === 'false');
    const results = await page.locator('#screen .terminal-row').allTextContents();
    if (!results.some(line => line.trim() === '33')) throw new Error('Notebook retained the previous input: ' + results.join('\n'));
    return { fileRead: true, savedArguments: true, savedFile: true, arrays: true, flags: true,
        invalidInteger: true, notebookIsolation: true };
}
