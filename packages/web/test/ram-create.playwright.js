// Run against the Android WebView; uses a new GPU Hello World notebook.
async page => {
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'GPU Hello World', exact: true }).click();
    const terminal = page.getByRole('textbox', { name: 'Rank terminal input' });
    await terminal.fill('rem unfinished draft');
    await page.getByRole('button', { name: 'Add RAM module', exact: true }).click();
    await page.getByRole('textbox', { name: 'Module name' }).fill('created');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    if (await terminal.inputValue() !== 'rem unfinished draft\nX created') throw Error('Missing call or lost draft');
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('use "created.ram"'));
    // Inspect the durable snapshot as well as the rendered terminal.
    await page.waitForFunction(async () => {
        const native = window.Capacitor;
        const { items } = await native.nativePromise('Notebooks', 'list', {});
        const { book } = await native.nativePromise('Notebooks', 'get', { id: items[0].id });
        const snapshot = book.snapshot;
        return snapshot.cells[0] === 'use "created.ram"'
            && snapshot.draft === 'rem unfinished draft\nX created';
    });
}
