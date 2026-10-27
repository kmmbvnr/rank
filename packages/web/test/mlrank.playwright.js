// Run against the local GPU-enabled Vite server with playwright-cli run-code.
async page => {
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'GPU Hello World', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.includes('GPU Hello World'));
    await page.getByRole('button', { name: 'Terminal commands' }).click();
    await page.getByRole('button', { name: 'Run program', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#screen').textContent.replace(/\s/g, '').includes('293031'));
    await page.getByRole('button', { name: 'hello.ram', exact: true }).click();
    const ram = page.getByRole('textbox', { name: 'RAM module source' });
    const source = await ram.inputValue();
    await ram.fill(source + 'rem saved RAM draft\n');
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    await page.getByRole('textbox', { name: 'Rank terminal input' }).fill('rem unfinished main');
    await page.getByRole('button', { name: 'hello.ram', exact: true }).click();
    // Wait for the durable snapshot, rather than racing IndexedDB with reload.
    await page.waitForFunction(async () => {
        const { notebookStore } = await import('/src/notebook-store.ts');
        const store = notebookStore();
        const recent = (await store.list()).items[0];
        const book = await store.get(recent.id);
        return book.snapshot.draft === 'rem unfinished main'
            && book.snapshot.modules?.[0].source.includes('saved RAM draft');
    });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    if (!(await ram.inputValue()).includes('saved RAM draft')) throw new Error('RAM draft lost');
    await page.getByRole('button', { name: 'Program', exact: true }).click();
    if (await page.getByRole('textbox', { name: 'Rank terminal input' }).inputValue() !== 'rem unfinished main')
        throw new Error('Main draft lost');
    await page.evaluate(async () => {
        const { notebookArchive, readNotebookArchive } = await import('/src/notebook-archive.ts');
        const { notebookStore } = await import('/src/notebook-store.ts');
        const store = notebookStore();
        const recent = (await store.list()).items[0];
        const { snapshot } = await store.get(recent.id);
        const imported = readNotebookArchive(notebookArchive(snapshot));
        if (imported.draft !== snapshot.draft || imported.modules[0].source !== snapshot.modules[0].source)
            throw new Error('ZIP roundtrip lost source');
    });
}
