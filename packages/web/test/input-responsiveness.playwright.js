// Run against the mobile console with playwright-cli run-code --filename.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
            localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' }));
            localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['A = 1 to 5', 'A * 10'], draft: '' }));
        });
        await page.goto(original.url());
        await page.waitForFunction(() => document.querySelector('#brand')?.disabled === false);
        const input = page.getByRole('textbox');
        await input.fill('arr');
        await input.press('Tab');
        if (await input.inputValue() !== 'array ') throw new Error('Complete the prefix to array');
        const timings = await page.evaluate(async () => {
            const input = document.querySelector('textarea');
            const timings = [];
            // Native Android deletion arrives through input, not necessarily keydown.
            for (const expected of ['array', 'arra', 'arr', 'ar', 'a', '']) {
                const start = performance.now();
                input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                input.value = input.value.slice(0, -1);
                input.setSelectionRange(input.value.length, input.value.length);
                input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
                if (input.value !== expected || input.selectionStart !== expected.length)
                    throw new Error('Every deletion must immediately update the draft and cursor');
                timings.push(performance.now() - start);
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            return timings;
        });
        await input.fill('array ');
        await input.press('Backspace');
        await input.press('Backspace');
        if (await input.inputValue() !== 'arra') throw new Error('Keep both rapid Backspace presses');
        if (errors.length) throw new Error(errors.join('\n'));
        return { result: 'Autocomplete and every native/key deletion update the draft and cursor', nativeDeleteMs: timings };
    } finally { await context.close(); }
}
