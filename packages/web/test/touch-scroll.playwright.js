// Run against the mobile console with playwright-cli run-code --filename.
async original => {
    const context = await original.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    try {
        const page = await context.newPage();
        await page.addInitScript(() => {
            localStorage.setItem('rank-mobile-guidance-v1', JSON.stringify({ step: 'done' }));
            localStorage.setItem('rank-notebook-v1', JSON.stringify({
                cells: [...Array.from({ length: 100 }, (_, i) => `rem Scroll line ${i}`), 'Value = 42'], draft: '',
            }));
        });
        await page.goto(original.url());
        await page.waitForFunction(() => document.querySelector('#brand')?.disabled === false);
        await page.evaluate(() => window.rankSoftKeyboard(true, 280));
        await page.getByRole('textbox').press('ArrowUp');
        await page.getByRole('textbox').press('Home');
        await page.waitForTimeout(1300);
        const gesture = await page.evaluate(async () => {
            const terminal = document.querySelector('#terminal');
            const screen = document.querySelector('#screen');
            const footer = document.querySelector('#terminal-footer');
            const rect = terminal.getBoundingClientRect();
            const initialFooter = { text: footer.textContent, top: footer.getBoundingClientRect().top, height: footer.getBoundingClientRect().height };
            if (footer.hidden || !/Value.*integer/.test(initialFooter.text)) throw new Error('Start with the current variable type visible');
            const position = () => {
                const row = [...screen.children].find(row => /Scroll line \d+/.test(row.textContent)
                    && row.getBoundingClientRect().top >= rect.top + 20);
                return Number(row.textContent.match(/Scroll line (\d+)/)[1]) * parseFloat(getComputedStyle(row).height)
                    - (row.getBoundingClientRect().top - rect.top);
            };
            let y = rect.top + 100;
            const touch = type => {
                const point = new Touch({ identifier: 1, target: terminal, clientX: rect.left + 150, clientY: y });
                terminal.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                    touches: type === 'touchend' ? [] : [point], changedTouches: [point] }));
            };
            const frames = async count => { for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame); };
            touch('touchstart');
            const samples = [];
            const footers = [];
            const sample = () => {
                samples.push(position());
                footers.push({ text: footer.textContent, top: footer.getBoundingClientRect().top, height: footer.getBoundingClientRect().height,
                    hidden: footer.hidden, visibility: getComputedStyle(footer).visibility,
                    scrolling: terminal.classList.contains('scrolling') });
            };
            for (let i = 0; i < 20; i++) {
                y += 3.25; touch('touchmove');
                if (i === 10) window.dispatchEvent(new Event('resize'));
                await frames(1); sample();
            }
            const beforePause = { position: position(), rows: screen.children.length };
            // Pause without releasing the finger: no idle redraw or caret blink yet.
            await new Promise(resolve => setTimeout(resolve, 250));
            const afterPause = { position: position(), rows: screen.children.length,
                scrolling: terminal.classList.contains('scrolling'),
                caretAnimation: getComputedStyle(document.querySelector('#caret')).animationName };
            for (let i = 0; i < 10; i++) {
                y += 3.25; touch('touchmove'); await frames(1); sample();
            }
            touch('touchend');
            for (let i = 0; i < 80; i++) {
                // A repeated keyboard/viewport report must preserve inertia, too.
                if (i === 5) window.dispatchEvent(new Event('resize'));
                await frames(1); sample();
            }
            const settled = position();
            window.dispatchEvent(new Event('resize'));
            await frames(2);
            const afterResize = position();
            const returnStart = samples.length;
            // Return to the editing cursor: restore its type hint without changing the layout.
            y = rect.top + rect.height * .75;
            touch('touchstart');
            sample();
            for (let i = 0; i < 35; i++) {
                y -= 3.25; touch('touchmove'); await frames(1); sample();
            }
            touch('touchend');
            for (let i = 0; i < 80; i++) { await frames(1); sample(); }
            return { beforePause, afterPause, settled, afterResize,
                stableFooter: footers.every(next => !next.hidden && next.text === initialFooter.text
                    && Math.abs(next.top - initialFooter.top) < .1 && Math.abs(next.height - initialFooter.height) < .1),
                factsHiddenAway: footers.slice(0, returnStart).some(next => next.visibility === 'hidden'),
                factsHiddenDuringScroll: footers.filter(next => next.scrolling).every(next => next.visibility === 'hidden'),
                factsRestored: footers.at(-1).visibility === 'visible',
                reversed: samples.slice(1, returnStart).some((next, i) => next > samples[i] + .1),
                reversedOnReturn: samples.slice(returnStart + 1).some((next, i) => next < samples[returnStart + i] - .1),
                scrollingAfterSettle: terminal.classList.contains('scrolling'),
                distance: samples[0] - settled };
        });
        check(gesture.beforePause.rows === gesture.afterPause.rows, 'Do not rebuild the row window while a finger is resting');
        check(Math.abs(gesture.beforePause.position - gesture.afterPause.position) < .1, 'A stationary finger must keep the source still');
        check(gesture.afterPause.scrolling && gesture.afterPause.caretAnimation === 'none', 'Keep caret animation off throughout the gesture');
        check(!gesture.reversed, 'Dragging, inertia and settling must never jump back toward the cursor');
        check(!gesture.reversedOnReturn, 'Returning to the cursor must not jump when the gesture settles');
        check(gesture.stableFooter, 'Type hints must keep their text, position and reserved height throughout scrolling and settling');
        check(gesture.factsHiddenAway, 'Hide type hints when their source cursor leaves the viewport');
        check(gesture.factsHiddenDuringScroll, 'Keep type hints hidden throughout dragging, inertia and settling');
        check(gesture.factsRestored, 'Restore type hints when their source cursor returns to the viewport');
        check(gesture.distance > 90, 'Exercise both dragging and inertia');
        check(!gesture.scrollingAfterSettle, 'Restore idle rendering once the gesture and inertia finish');
        check(Math.abs(gesture.afterResize - gesture.settled) < .1, 'Unchanged viewport geometry must preserve fractional scroll position');
        await page.getByRole('textbox').fill('VariableWithANameLongEnoughToWrapTheTypeHint = array shape 100 200 fill 1');
        await page.getByRole('textbox').press('Home');
        await page.waitForFunction(() => !document.querySelector('#terminal-footer').hidden
            && document.querySelector('#terminal-footer').children.length > 1);
        const multiline = await page.locator('#terminal-footer').evaluate(footer => {
            const height = document.querySelector('#measure').getBoundingClientRect().height;
            const rows = [...footer.children].map(row => row.getBoundingClientRect());
            return Math.abs(footer.getBoundingClientRect().height - rows.length * height) < .1
                && rows.every((row, i) => Math.abs(row.top - rows[0].top - i * height) < .1);
        });
        check(multiline, 'A wrapped type hint must reserve and paint every footer row at the terminal line height');
        return gesture;
    } finally { await context.close(); }
}
