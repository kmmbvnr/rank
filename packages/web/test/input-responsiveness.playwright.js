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
        await input.fill('0123456789abcdef');
        await input.press('End');
        const burst = async (key, count, shiftKey = false) => page.evaluate(({ key, count, shiftKey }) => {
            const input = document.querySelector('textarea');
            for (let i = 0; i < count; i++) input.dispatchEvent(new KeyboardEvent('keydown', {
                key, shiftKey, bubbles: true, cancelable: true, repeat: i > 0,
            }));
        }, { key, count, shiftKey });
        await burst('ArrowLeft', 8);
        await page.waitForFunction(() => document.querySelector('textarea').selectionStart === 8);
        await page.evaluate(() => {
            for (const animation of document.querySelector('#caret').getAnimations()) animation.currentTime = 600;
        });
        await burst('ArrowRight', 8);
        await page.waitForFunction(() => document.querySelector('textarea').selectionStart === 16);
        if (await page.locator('#caret').evaluate(caret => getComputedStyle(caret).opacity) !== '1')
            throw new Error('Moving the cursor must reveal it immediately during the invisible blink phase');
        await input.fill('ab\ncd\nef');
        await input.press('End');
        await burst('ArrowUp', 2);
        await page.waitForFunction(() => document.querySelector('textarea').selectionStart === 2);
        await burst('ArrowDown', 2);
        await page.waitForFunction(() => document.querySelector('textarea').selectionStart === 8);
        await burst('ArrowLeft', 3, true);
        await page.waitForFunction(() => {
            const input = document.querySelector('textarea');
            return input.selectionStart === 5 && input.selectionEnd === 8;
        });
        if (errors.length) throw new Error(errors.join('\n'));
        return { result: 'Autocomplete, native deletion and rapid arrow/selection bursts preserve every input', nativeDeleteMs: timings };
    } finally { await context.close(); }
}
