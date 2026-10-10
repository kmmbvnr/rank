// Run against the mobile console: playwright-cli run-code --filename packages/web/test/mobile-guidance.playwright.js
async original => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const browser = original.context().browser();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(original.url());
        const card = page.locator('#mobile-guidance');
        const play = page.locator('#run-button');
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('rank-mobile-guidance-v1')));
        const step = async name => {
            await page.waitForFunction(name => {
                const card = document.querySelector('#mobile-guidance');
                return card && !card.hidden && card.dataset.step === name;
            }, name, { timeout: 8000 });
            check(await card.locator('strong, h1, h2, h3').count() === 0, 'Guidance must have no heading');
            check(await card.getByRole('button', { name: 'Skip', exact: true }).count() === 0, 'Guidance must have no Skip button');
            check(((await card.locator('p').textContent()).match(/[.!?]/g) ?? []).length === 1, 'One sentence per step');
        };
        const touch = async locator => {
            const box = await locator.boundingBox();
            await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        };
        const geometry = async target => {
            const hint = await card.boundingBox();
            const button = await target.boundingBox();
            check(hint && hint.x >= 0 && hint.y >= 0 && hint.x + hint.width <= 390 && hint.y + hint.height <= 844,
                'Hint must fit the viewport');
            check(hint.y + hint.height <= button.y || hint.y >= button.y + button.height, 'Hint must not cover its action');
        };
        const padding = selector => page.evaluate(selector => {
            const target = document.querySelector(selector);
            let box = target.getBoundingClientRect();
            if (selector === '#brand') {
                const range = document.createRange(); range.selectNodeContents(target); box = range.getBoundingClientRect();
            }
            const outline = document.querySelector('#guidance-spotlight').getBoundingClientRect();
            return [box.left - outline.left, outline.right - box.right, box.top - outline.top, outline.bottom - box.bottom];
        }, selector);
        await step('offer');
        await page.evaluate(() => window.rankSoftKeyboard(true, 280));
        check(await page.locator('#guidance-spotlight').isHidden(), 'Do not outline the whole editor');
        check((await card.boundingBox()).y + (await card.boundingBox()).height < (await play.boundingBox()).y,
            'The offer must leave Play clear');
        // Native IME input, paste and hardware keys cannot rewrite or skip the example.
        await page.getByRole('textbox').fill('X = 42');
        await page.keyboard.type('bad code');
        check(await page.getByRole('textbox').inputValue() === '', 'Ignore edits until the script ends: ' + await page.getByRole('textbox').inputValue());
        check((await saved()).step === 'offer', 'Typing must not skip the introduction');
        await page.screenshot({ path: 'output/playwright/mobile-guidance-offer.png' });
        await touch(page.locator('#menu-toggle'));
        await step('run');
        check(await page.locator('#commands').isHidden(), 'A wrong tap must start the example instead of opening a menu');
        check(!(await page.locator('#notebook-panel').isVisible()), 'Keep notebook history closed');
        check(await page.getByRole('textbox').inputValue() === 'A * 10', 'Select the final example line');
        check(!(await page.locator('#screen').textContent()).includes('10 20 30 40 50'), 'Insertion must not execute');
        check((await padding('#run-button')).every(value => Math.abs(value - 4) < .25), 'Play must have equal outline padding');
        await geometry(play);
        await page.screenshot({ path: 'output/playwright/mobile-guidance-run.png' });
        // Even holding RANK follows the run step, rather than leaving beginner mode or opening history.
        const brandBox = await page.locator('#brand').boundingBox();
        await page.mouse.move(brandBox.x + 10, brandBox.y + 10);
        await page.mouse.down(); await page.waitForTimeout(2150); await page.mouse.up();
        await step('hold');
        check(!(await page.locator('#notebook-panel').isVisible()), 'Long pressing the wrong control must not leave the script');
        check((await page.locator('#screen').textContent()).includes('10 20 30 40 50'), 'Run must evaluate both array lines');
        await page.evaluate(() => {
            window.guidedRestartClearedOutput = false;
            const screen = document.querySelector('#screen');
            const observer = new MutationObserver(() => {
                if (!screen.textContent.includes('10 20 30 40 50')) {
                    window.guidedRestartClearedOutput = true; observer.disconnect();
                }
            });
            observer.observe(screen, { childList: true, subtree: true, characterData: true });
        });
        await touch(page.locator('#menu-toggle'));
        check(await play.evaluate(button => button.classList.contains('holding')), 'Any tap in the hold step must animate the ring');
        check(!(await saved()).hold, 'Wait for the hold animation');
        await page.waitForTimeout(200);
        check(await play.locator('.run-progress-ring').evaluate(ring => getComputedStyle(ring).opacity === '1'), 'Show the hold ring');
        await page.screenshot({ path: 'output/playwright/mobile-guidance-assisted-hold.png' });
        await page.locator('#brand').click();
        check(!(await page.locator('#notebook-panel').isVisible()), 'Repeated taps during the ring must not open history');
        await step('keyboard');
        check(await page.evaluate(() => window.guidedRestartClearedOutput), 'The hold step must clear output for a full restart');
        check((await page.locator('#screen').textContent()).includes('10 20 30 40 50'), 'Restart must evaluate the whole notebook');
        check((await saved()).hold, 'Remember completed restart');
        check(await page.locator('#guidance-spotlight').isHidden(), 'Keyboard dismissal needs no editor frame');
        check(await card.locator('.guidance-hide-key svg').count() === 1, 'Show the hide-key chevron');
        await page.screenshot({ path: 'output/playwright/mobile-guidance-hide-key.png' });
        const source = await page.locator('#screen').textContent();
        await touch(page.locator('#menu-toggle'));
        check((await saved()).step === 'keyboard', 'Wait for the actual keyboard dismissal report');
        check(await page.locator('#commands').isHidden(), 'Keyboard dismissal must not open a menu');
        check(await page.locator('#screen').textContent() === source, 'Keep example source intact');
        await page.evaluate(() => window.rankSoftKeyboard(false));
        await step('commands');
        await page.setViewportSize({ width: 844, height: 390 });
        await page.waitForTimeout(500);
        const landscape = await card.boundingBox();
        check(landscape && landscape.y >= 0 && landscape.y + landscape.height <= 390, 'Hint must fit landscape');
        await page.setViewportSize({ width: 390, height: 844 });
        // Tapping + must open the highlighted command's documentation, without inserting it or choosing modules.
        const draftBeforeManual = await page.getByRole('textbox').inputValue();
        await page.getByRole('tab', { name: 'Import a module' }).click();
        await page.locator('#key-manual').waitFor({ state: 'visible' });
        check(await card.isHidden(), 'The manual takes the current script step');
        check(await page.getByRole('textbox').inputValue() === draftBeforeManual, 'Short command taps must not insert text during learning');
        check(!(await page.locator('#keyboard-keys').evaluate(element => element.classList.contains('module-picker'))), 'Do not open module picker');
        await page.getByRole('button', { name: 'Close manual' }).click();
        await step('letters');
        await geometry(page.locator('#keyboard-letters'));
        await play.click();
        await step('autocomplete');
        await page.evaluate(() => window.rankSoftKeyboard(true, 280));
        check((await saved()).letters, 'A wrong Play tap must perform the system-keyboard step');
        check(await page.getByRole('textbox').inputValue() === 'arr', 'Prepare a real word prefix for the swipe lesson');
        check(await page.locator('#guidance-spotlight').isHidden(), 'The swipe lesson needs no editor frame');
        await page.reload();
        await step('autocomplete');
        check(await page.getByRole('textbox').inputValue() === 'arr', 'Resume the unfinished autocomplete lesson');
        await page.screenshot({ path: 'output/playwright/mobile-guidance-autocomplete.png' });
        const cdp = await context.newCDPSession(page);
        const swipe = async (from, to) => {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 230 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to, y: 230 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await swipe(230, 90);
        check((await saved()).step === 'autocomplete', 'A left swipe must not complete the word');
        await swipe(90, 230);
        await cdp.detach();
        await step('notebooks');
        check(await page.getByRole('textbox').inputValue() === 'array ', 'A right swipe must use real autocomplete');
        // Android can emit a zero-detail click after touchend; it belongs to the same gesture.
        await page.evaluate(() => {
            for (const detail of [0, 1]) document.querySelector('#terminal').dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
        });
        await page.waitForTimeout(1000);
        check((await saved()).step === 'notebooks', 'One swipe must perform only the autocomplete step');
        check(!(await page.locator('#notebook-panel').isVisible()), 'Keep the completion visible until a separate tap');
        check(await page.getByRole('textbox').inputValue() === 'array ', 'Keep the completed word visible');
        check((await page.locator('#screen').textContent()).includes('A * 10'), 'Autocomplete must preserve the example source');
        check((await padding('#brand')).every(value => Math.abs(value - 4) < .25), 'RANK must have equal outline padding');
        await page.screenshot({ path: 'output/playwright/mobile-guidance-rank.png' });
        await page.locator('#menu-toggle').click();
        await step('new-notebook');
        check(await card.evaluate(element => element.closest('dialog')?.id) === 'notebook-panel', 'Show the final hint in the modal top layer');
        await page.waitForTimeout(250);
        await page.evaluate(() => {
            document.documentElement.style.setProperty('--safe-top', '48px'); window.dispatchEvent(new Event('resize'));
        });
        check((await card.boundingBox()).y >= 56, 'Keep drawer guidance below the camera');
        await geometry(page.locator('#new-notebook'));
        await page.screenshot({ path: 'output/playwright/mobile-guidance-safe-top.png' });
        // The tempting Library row still performs New notebook and finishes the script.
        await touch(page.locator('[data-action="library"]'));
        await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
        check((await saved()).step === 'done', 'Create the empty notebook and finish');
        check(await page.getByRole('textbox').inputValue() === '', 'Finish in an empty notebook');
        check(await card.isHidden(), 'No more hints after finishing');
        // Unlock immediately: the first real tap after completion must work normally.
        await page.locator('#menu-toggle').click();
        check(await page.locator('#commands').isVisible(), 'Unlock menu immediately after the last step');
        await page.locator('#menu-toggle').click();
        await page.getByRole('textbox').fill('X = 42');
        check(await page.getByRole('textbox').inputValue() === 'X = 42', 'Unlock ordinary edits');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#brand')?.disabled === false);
        check(await card.isHidden(), 'A completed walkthrough must stay finished after reopening');
        await page.locator('#brand').click();
        await page.locator('.history-title').filter({ hasText: /^A = 1 to 5$/ }).click();
        await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
        check((await page.locator('#screen').textContent()).includes('A * 10'), 'Keep the saved example');
        check(errors.length === 0, errors.join('\n'));
    } finally { await context.close(); }

    // Resume a partially completed script, including a keyboard dismissed too early.
    const resumed = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
        const page = await resumed.newPage();
        await page.addInitScript(() => {
            if (!localStorage.getItem('rank-mobile-guidance-v1')) {
                localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'keyboard', hold: true }));
                localStorage.setItem('rank-notebook-v1', JSON.stringify({ cells: ['A = 1 to 5', 'A * 10'], draft: '' }));
            }
        });
        await page.goto(original.url());
        await page.waitForFunction(() => document.querySelector('#brand')?.disabled === false);
        await page.waitForTimeout(600);
        check(JSON.parse(await page.evaluate(() => localStorage.getItem('rank-mobile-guidance-v1'))).step === 'keyboard',
            'A closed keyboard must not skip its demonstration on resume');
        await page.evaluate(() => window.rankSoftKeyboard(true, 280));
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'keyboard');
        check(await page.evaluate(() => window.rankBack()), 'Back must remain inside the script');
        await page.evaluate(() => window.rankSoftKeyboard(false));
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'commands');
        await page.evaluate(() => window.rankSoftKeyboard(true, 280));
        check(await page.locator('#mobile-guidance').isHidden(), 'Restore the Rank keyboard when Android reopens its IME on resume');
        await page.evaluate(() => window.rankSoftKeyboard(false));
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'commands'
            && !document.querySelector('#mobile-guidance').hidden);
        check(await page.evaluate(() => window.rankBack()), 'Back must perform the documentation step');
        await page.locator('#key-manual').waitFor({ state: 'visible' });
        check(await page.evaluate(() => window.rankBack()), 'Back must close the manual and continue');
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'letters');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('#brand')?.disabled === false);
        check(JSON.parse(await page.evaluate(() => localStorage.getItem('rank-mobile-guidance-v1'))).step === 'letters',
            'Reopening must resume the saved step');
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'letters'
            && !document.querySelector('#mobile-guidance').hidden);
        await page.locator('#run-button').click();
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'autocomplete');
        await page.locator('#menu-toggle').click();
        check(await page.getByRole('textbox').inputValue() === 'array ', 'A wrong tap must assist the autocomplete lesson');
        check(await page.locator('#commands').isHidden(), 'Assisted autocomplete must not open the menu');
        await page.evaluate(() => localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'new-notebook', hold: true })));
        await page.reload();
        await page.locator('#notebook-panel').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.querySelector('#mobile-guidance')?.dataset.step === 'new-notebook'
            && !document.querySelector('#mobile-guidance').hidden, undefined, { timeout: 8000 });
        check(await page.evaluate(() => window.rankBack()), 'Back on the restored final step must finish instead of closing history');
        await page.locator('#notebook-panel').waitFor({ state: 'hidden' });
        check(JSON.parse(await page.evaluate(() => localStorage.getItem('rank-mobile-guidance-v1'))).step === 'done',
            'The restored final step must complete normally');
    } finally { await resumed.close(); }
    return 'Scripted tour follows wrong taps, blocks edits and detours, handles Back, resumes and unlocks after completion';
}
