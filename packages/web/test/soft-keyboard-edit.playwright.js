// Run against a local console with: playwright-cli run-code --filename packages/web/test/soft-keyboard-edit.playwright.js
async page => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    await page.evaluate(() => {
        localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: [], draft: '' }));
    });
    await page.reload();
    // A soft keyboard edits the field and reports only an input event, with no Backspace keydown.
    const softEdit = (value, caret) => page.evaluate(([value, caret]) => {
        const input = document.querySelector('#input');
        input.value = value;
        input.setSelectionRange(caret, caret);
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return { value: input.value, caret: input.selectionStart };
    }, [value, caret]);
    let state = await softEdit('aa', 2);
    check(state.value === 'aa' && state.caret === 2, `typing: ${JSON.stringify(state)}`);
    // Backspace between the two letters removes the first; the caret must stay at 0, not jump to 1.
    state = await softEdit('a', 0);
    check(state.value === 'a' && state.caret === 0, `deletion among repeats: ${JSON.stringify(state)}`);
    state = await softEdit('aa', 1);
    check(state.value === 'aa' && state.caret === 1, `insertion among repeats: ${JSON.stringify(state)}`);
    // Moving the cursor (e.g. by swiping on the spacebar) updates selection without an input event.
    const moveCaret = caret => page.evaluate(caret => {
        const input = document.querySelector('#input');
        input.setSelectionRange(caret, caret);
        document.dispatchEvent(new Event('selectionchange'));
        return { value: input.value, caret: input.selectionStart };
    }, caret);
    state = await moveCaret(0);
    check(state.caret === 0, `caret move via selectionchange: ${JSON.stringify(state)}`);
}
