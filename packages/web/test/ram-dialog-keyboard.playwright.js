// Run on the Android WebView with playwright-cli run-code --filename this file.
async page => {
    await page.waitForFunction(() => !document.querySelector('#brand').disabled);
    await page.getByRole('button', { name: 'Program', exact: true }).evaluate(button => button.click());
    await page.evaluate(async () => {
        document.querySelector('#keyboard-hide').click();
        await fetch('/__rank_keyboard_hide');
    });
    await page.waitForFunction(() => visualViewport.height > screen.height * 0.8);
    const closedHeight = await page.evaluate(() => visualViewport.height);
    await page.evaluate(() => {
        const dialog = document.querySelector('dialog[aria-label="Add RAM module"]');
        window.ramDialogOpeningFrames = [];
        const observer = new MutationObserver(() => {
            if (!dialog.open) return;
            observer.disconnect();
            const sample = () => {
                if (!dialog.open) return;
                window.ramDialogOpeningFrames.push({ height: visualViewport.height, top: dialog.getBoundingClientRect().top });
                requestAnimationFrame(sample);
            };
            sample();
        });
        observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    });
    await page.getByRole('button', { name: 'Add RAM module', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add RAM module' }).waitFor();
    await page.waitForFunction(height => visualViewport.height < height - 80, closedHeight);
    await page.waitForTimeout(200);
    await page.evaluate(() => {
        window.ramCancelKeyboardFrames = [];
        window.ramCancelRecording = true;
        const sample = () => {
            const keyboard = document.querySelector('#keyboard');
            window.ramCancelKeyboardFrames.push(!keyboard.hidden && getComputedStyle(keyboard).display !== 'none');
            if (window.ramCancelRecording) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(height => visualViewport.height >= height - 20, closedHeight);
    // Cover the 450 ms keyboard transition and its final resize callback.
    await page.waitForTimeout(600);
    const frames = await page.evaluate(() => {
        window.ramCancelRecording = false;
        return window.ramCancelKeyboardFrames;
    });
    if (!frames.length || frames.some(Boolean)) throw new Error('Cancel exposed the symbol keyboard from a hidden state');
    const opening = await page.evaluate(() => window.ramDialogOpeningFrames);
    if (!opening.length || opening.some(frame => frame.height >= closedHeight - 80)
        || Math.max(...opening.map(frame => frame.top)) - Math.min(...opening.map(frame => frame.top)) > 2)
        throw new Error('Dialog appeared before the keyboard settled: ' + JSON.stringify(opening));
    if (await page.getByRole('dialog', { name: 'Add RAM module' }).isVisible()) throw new Error('Cancel left the dialog open');

    // An already open IME must remain open while focus moves through the dialog.
    await page.evaluate(async () => {
        document.querySelector('#input').focus();
        await fetch('/__rank_keyboard_show');
    });
    await page.waitForFunction(height => visualViewport.height < height - 80, closedHeight);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
        window.ramDialogImeReports = [];
        window.ramDialogOriginalImeReport = window.rankSoftKeyboard;
        window.rankSoftKeyboard = (visible, ...args) => {
            window.ramDialogImeReports.push(visible);
            window.ramDialogOriginalImeReport(visible, ...args);
        };
    });
    await page.getByRole('button', { name: 'Add RAM module', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(800);
    const restored = await page.evaluate(() => {
        window.rankSoftKeyboard = window.ramDialogOriginalImeReport;
        return { reports: window.ramDialogImeReports, focused: document.activeElement === document.querySelector('#input'),
            height: visualViewport.height };
    });
    if (!restored.focused || restored.height >= closedHeight - 80 || restored.reports.includes(false))
        throw new Error('Cancel dismissed and reopened an already visible system keyboard: ' + JSON.stringify(restored));
}
