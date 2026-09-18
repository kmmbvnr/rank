import './styles.css';
import type { PauseSnapshot } from '@arrrank/interpreter';
import { NotebookRepl } from '@arrrank/common/repl';
import { KeyRouter, type Key } from '@arrrank/common/key-router';
import { TerminalModeRouter } from '@arrrank/common/terminal-modes';
import { notebookFrame, helpFrame, pauseFrame, type ScreenFrame } from '@arrrank/common/screen';
import { browserSession } from './session.js';
import { paintLine } from './terminal-colors.js';
import { sourceSelection } from './source-selection.js';

const terminal = document.querySelector<HTMLElement>('#terminal')!;
const screen = document.querySelector<HTMLElement>('#screen')!;
const input = document.querySelector<HTMLTextAreaElement>('#input')!;
const caret = document.querySelector<HTMLElement>('#caret')!;
const measure = document.querySelector<HTMLElement>('#measure')!;
const chrome = document.querySelector<HTMLElement>('#chrome')!;
const menuToggle = document.querySelector<HTMLButtonElement>('#menu-toggle')!;
const commands = document.querySelector<HTMLElement>('#commands')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-button')!;
const iterationControls = document.querySelector<HTMLElement>('#iteration-controls')!;
const iterationPrev = document.querySelector<HTMLButtonElement>('#iteration-prev')!;
const iterationNext = document.querySelector<HTMLButtonElement>('#iteration-next')!;
const compact = () => import.meta.env.MODE === 'mobile' || matchMedia('(max-width: 800px)').matches;
const stoppedMessage = () => compact() ? 'Stopped' : 'Stopped · Ctrl-L restart';
function haptic(kind: 'tap' | 'step' | 'hold' = 'tap'): void {
    const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
    if (capacitor?.getPlatform() === 'android') {
        void fetch('/__rank_haptic?kind=' + kind, { cache: 'no-store' }).catch(() => {});
    } else navigator.vibrate?.(kind === 'hold' ? 25 : kind === 'step' ? 5 : 10);
}
if (import.meta.env.MODE === 'mobile') document.documentElement.classList.add('mobile');
if (import.meta.env.MODE !== 'mobile') {
    chrome.hidden = true;
    document.documentElement.style.setProperty('--chrome-height', '0px');
}
let columns = 47;
let rows = 24;
let cellWidth = 8;
let cellHeight = 22;
let top = 0;
let scrollFraction = 0;
let follow = true;
let busy = false;
let composing = false;
let failure = '';
let needsRestart = false;
let frame: ScreenFrame;
let storedNotebook = '';
let lastPause: PauseSnapshot | undefined;
let paintedLines: string[] = [];
const session = browserSession(message => { failure = message; needsRestart = true; render(); }, () => render());
const repl = new NotebookRepl(session, () => render(), () => columns, true);
const keys = new KeyRouter(repl, [], () => columns, {
    read: () => navigator.clipboard.readText(),
    write: text => navigator.clipboard.writeText(text),
});
const modes = new TerminalModeRouter(repl, () => rows);
const example = new URLSearchParams(location.search).get('example') === 'fibonacci';
// The website example must never overwrite a user's main notebook (including on Android).
const storageKey = example ? 'rank-example-fibonacci-v1' : 'rank-notebook-v1';

try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved && Array.isArray(saved.cells) && saved.cells.every((s: unknown) => typeof s === 'string')) {
        for (const source of saved.cells) repl.notebook.enqueue(source);
        repl.notebook.toPrompt();
        repl.notebook.replace(typeof saved.draft === 'string' ? saved.draft : '');
    }
} catch { /* An unavailable draft must not prevent opening the terminal. */ }

function editor() { return repl.exampleEditor ?? repl.notebook; }

function nativeSelection(): boolean {
    const selection = getSelection();
    return !!selection && !selection.isCollapsed
        && (screen.contains(selection.anchorNode) || screen.contains(selection.focusNode));
}

function render(): void {
    const paused = session.pauseState;
    modes.allowRender();
    if (paused) lastPause = paused;
    if (!repl.running) lastPause = undefined;
    const shownPause = paused ?? (modes.waitingForPause ? lastPause : undefined);
    runButton.dataset.state = shownPause ? 'paused' : repl.running ? 'running' : 'idle';
    runButton.setAttribute('aria-label', shownPause ? 'Step into line; hold to continue execution'
        : repl.running ? 'Pause and debug; hold to stop' : 'Run through selected line; hold to run all from start');
    runButton.disabled = modes.waitingForPause || !!session.pauseRequested && !paused;
    // The steppers only make sense while the cursor sits on a loop being previewed.
    iterationControls.hidden = !!shownPause || repl.running || !repl.liveIterationAvailable;
    iterationPrev.disabled = iterationNext.disabled = busy;
    for (const button of commands.querySelectorAll<HTMLElement>('[data-debug]')) button.hidden = !shownPause;
    for (const button of commands.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
        button.disabled = repl.running && button.dataset.key !== 'c'
            && !(paused && (button.hasAttribute('data-debug') || ['up', 'down'].includes(button.dataset.key!)));
    }
    // Replacing the DOM would destroy the phone's selection handles and Copy menu.
    if (nativeSelection()) return;
    if (shownPause) {
        scrollFraction = 0;
        frame = pauseFrame(shownPause, columns, rows, repl.pauseTop,
            compact() ? 'Paused' : modes.pauseStatus);
        repl.pauseTop = frame.top;
        top = frame.top;
    } else if (repl.help) {
        scrollFraction = 0;
        frame = helpFrame(repl.help.text, columns, rows, repl.help.top);
        repl.help.top = frame.top;
    } else {
        const showShortcutHints = !compact();
        const shownFailure = failure === 'Stopped' ? stoppedMessage() : failure;
        if (follow || shownFailure || repl.running) scrollFraction = 0;
        frame = notebookFrame(repl.notebook, columns, rows, top,
            shownFailure || (showShortcutHints ? repl.suggestion : ''), busy || repl.running, follow, '',
            shownFailure || (repl.running ? showShortcutHints ? repl.runningStatus : repl.runningStatus.split(' · ')[0] : 'Running…'),
            repl.breakpoints, repl.promptLabel, repl.liveOutputs, repl.exampleFields,
            repl.liveIterationFocus, repl.stepping, undefined, showShortcutHints,
            compact() && !shownFailure && !repl.running ? 1 : 0);
        top = frame.top;
        if (!follow && top >= (frame.maxTop ?? 0)) scrollFraction = 0;
    }
    if (screen.children.length !== frame.lines.length) {
        screen.replaceChildren(...frame.lines.map(() => {
            const row = document.createElement('div');
            row.className = 'terminal-row';
            return row;
        }));
        paintedLines = [];
    }
    frame.lines.forEach((line, index) => {
        if (paintedLines[index] === line) return;
        const row = screen.children[index] as HTMLElement;
        row.replaceChildren();
        paintLine(row, line);
    });
    paintedLines = [...frame.lines];
    screen.style.transform = scrollFraction ? `translateY(${-scrollFraction}px)` : '';
    const left = frame.cursor.column * cellWidth;
    const y = frame.cursor.row * cellHeight - scrollFraction;
    caret.style.transform = `translate(${left}px, ${y}px)`;
    caret.style.width = (frame.cursorStyle === 6 ? 2 : cellWidth) + 'px';
    caret.hidden = !frame.cursorVisible || !!repl.help;
    input.style.left = left + 'px';
    input.style.top = y + 'px';
    input.setAttribute('aria-busy', String(busy || repl.running));
    if (!composing) {
        const book = editor();
        if (input.value !== book.current.source) input.value = book.current.source;
        const selected = book.selection;
        const from = selected?.start === book.active ? selected.from : book.cursor;
        const to = selected?.end === book.active ? selected.to : book.cursor;
        if (input.selectionStart !== from || input.selectionEnd !== to)
            input.setSelectionRange(from, to, book.cursor === from ? 'backward' : 'forward');
    }
    try {
        const savedNotebook = JSON.stringify({
            cells: repl.notebook.cells.slice(0, -1).filter(cell => !cell.command).map(cell => cell.source),
            draft: repl.notebook.cells.at(-1)!.source,
        });
        if (savedNotebook !== storedNotebook) {
            localStorage.setItem(storageKey, savedNotebook);
            storedNotebook = savedNotebook;
        }
    } catch { failure = 'Cannot save local draft'; }
}

async function press(key: Key, text = ''): Promise<void> {
    stopMomentum();
    if (repl.running) {
        await modes.press(text, key);
        render();
        return;
    }
    if (busy) {
        if (key.ctrl && key.name === 'c') session.interrupt?.();
        return;
    }
    if (needsRestart && (key.name === 'return' || key.ctrl && key.name === 'r')) {
        failure = 'Stopped'; render(); return;
    }
    const command = repl.notebook.current.source.trim();
    if (session.isCommand(command) && /^(save|load|exit|quit)(?:\s|$)/.test(command)
        && (key.name === 'return' || key.ctrl && key.name === 'r')) {
        failure = 'This command is available in CLI only'; render(); return;
    }
    if (key.ctrl && ['s', 'q', 'd'].includes(key.name ?? '')) return;
    follow = key.name !== 'pageup' && key.name !== 'pagedown';
    failure = '';
    busy = true;
    input.setAttribute('aria-busy', 'true');
    try {
        if (key.ctrl && key.name === 'l') needsRestart = false;
        const mode = await modes.press(text, key);
        if (!mode.handled) {
            const result = await keys.press(text, key);
            if (result.pageDelta) top = Math.max(0, top + result.pageDelta * Math.max(1, rows - 2));
        }
    } catch (error) {
        failure = needsRestart ? 'Stopped' : String(error);
        for (const cell of repl.notebook.cells) if (cell.status === 'running') cell.status = 'interrupted';
    } finally { busy = false; render(); }
}

function applyInput(): void {
    stopMomentum();
    if (busy || repl.running || repl.help || repl.liveIterationFocused) { render(); return; }
    const book = editor();
    const previous = book.current.source;
    const value = input.value;
    // Keep native IME composition intact; ordinary insertions use CLI auto-pairing and aliases.
    if (composing || previous === value) book.replace(value, input.selectionStart);
    else {
        let start = 0;
        while (start < previous.length && start < value.length && previous[start] === value[start]) start++;
        let end = previous.length;
        let nextEnd = value.length;
        while (end > start && nextEnd > start && previous[end - 1] === value[nextEnd - 1]) { end--; nextEnd--; }
        if (end > start) book.replace(previous.slice(0, start) + previous.slice(end), start);
        else book.cursor = start;
        if (nextEnd > start) book.insert(value.slice(start, nextEnd), true);
    }
    repl.dismiss();
    follow = true;
    render();
}

input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionend', () => { composing = false; applyInput(); });
input.addEventListener('input', applyInput);
input.addEventListener('beforeinput', event => {
    if (!event.isComposing && (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph')) {
        event.preventDefault(); void press({ name: 'return' }); return;
    }
    if (busy || repl.running || repl.liveIterationFocused || repl.help) { event.preventDefault(); return; }
    if (!event.isComposing && editor().selection && event.inputType === 'insertText' && event.data !== null) {
        event.preventDefault();
        editor().insert(event.data, true);
        repl.dismiss(); render();
    }
});
input.addEventListener('keydown', event => {
    if (event.isComposing || event.key === 'Process') return;
    // Use native clipboard events for Command on macOS and Control elsewhere.
    // Keep Ctrl-C without selection available for REPL cancellation.
    if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase())
        && (event.metaKey || nativeSelection() || editor().selection)) return;
    // Let the browser deliver paste data, without requesting clipboard-read permission.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
    const names: Record<string, string> = {
        Enter: 'return', Escape: 'escape', Tab: 'tab', Backspace: 'backspace', Delete: 'delete',
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    };
    if (session.pauseState && ['t', 'n', 'g'].includes(event.key)) {
        event.preventDefault(); void press({ name: event.key }); return;
    }
    if (names[event.key] || event.ctrlKey) {
        event.preventDefault();
        void press({ name: names[event.key] ?? event.key.toLowerCase(), ctrl: event.ctrlKey,
            meta: event.metaKey, shift: event.shiftKey }, event.key.length === 1 ? event.key : '');
    }
});
function closeMenu(): void { commands.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); }
chrome.addEventListener('pointerdown', event => event.preventDefault());
menuToggle.onclick = () => {
    haptic();
    commands.hidden = !commands.hidden;
    menuToggle.setAttribute('aria-expanded', String(!commands.hidden));
};
commands.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
    if (!button || button.disabled) return;
    haptic(button.dataset.key === 't' && !!session.pauseState ? 'step' : 'tap');
    closeMenu();
    input.focus({ preventScroll: true });
    void press({ name: button.dataset.key, ctrl: button.dataset.ctrl === 'true' });
};
function runAction(): void {
    if (runButton.disabled || busy && !repl.running) return;
    haptic(session.pauseState ? 'step' : 'tap');
    if (session.pauseState) void press({ name: 't' });
    else if (repl.running) { session.pause?.(); render(); }
    else void press({ name: 'r', ctrl: true });
}
async function moveIteration(direction: -1 | 1): Promise<void> {
    if (busy || repl.running || !repl.liveIterationAvailable) return;
    haptic('step');
    // Arrows only step the iteration once the loop line is focused and being selected.
    if (!repl.liveIterationFocus?.active) await press({ name: 'g', ctrl: true });
    await press({ name: direction < 0 ? 'left' : 'right' });
    input.focus({ preventScroll: true });
}
// Tapping a stepper must not move the keyboard focus out of the terminal input.
iterationControls.addEventListener('pointerdown', event => event.preventDefault());
iterationPrev.onclick = () => { void moveIteration(-1); };
iterationNext.onclick = () => { void moveIteration(1); };
let hold: { pointerId: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; long: boolean; running: boolean; action: 'stop' | 'continue' | 'restart' } | undefined;
function rippleRunButton(x: number, y: number): void {
    const box = runButton.getBoundingClientRect();
    runButton.style.setProperty('--ripple-x', `${x - box.left}px`);
    runButton.style.setProperty('--ripple-y', `${y - box.top}px`);
    runButton.classList.remove('rippling');
    void runButton.offsetWidth;
    runButton.classList.add('rippling');
}
runButton.addEventListener('animationend', event => {
    if (event.animationName === 'run-ripple') runButton.classList.remove('rippling');
});
function endHold(pointerId: number, step: boolean): void {
    if (!hold || hold.pointerId !== pointerId) return;
    const wasLong = hold.long;
    const wasRunning = hold.running;
    clearTimeout(hold.timer);
    hold = undefined;
    runButton.classList.remove('holding');
    if (step && !wasLong && wasRunning === repl.running) runAction();
}
runButton.addEventListener('pointerdown', event => {
    if (!event.isPrimary || hold || busy && !repl.running) return;
    event.preventDefault();
    rippleRunButton(event.clientX, event.clientY);
    runButton.setPointerCapture(event.pointerId);
    runButton.classList.add('holding');
    hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, long: false, running: repl.running,
        action: session.pauseState ? 'continue' : repl.running ? 'stop' : 'restart',
        timer: setTimeout(() => {
            if (!hold || hold.pointerId !== event.pointerId) return;
            hold.long = true;
            const action = hold.action;
            if (action === 'stop' && !repl.running || action === 'continue' && !session.pauseState
                || action === 'restart' && repl.running) return;
            haptic('hold');
            if (action === 'stop') void press({ name: 'c', ctrl: true });
            else if (action === 'continue') { session.resume?.(); render(); }
            else void press({ name: 'l', ctrl: true });
        }, 700) };
});
runButton.addEventListener('pointermove', event => {
    if (hold?.pointerId === event.pointerId && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 16)
        endHold(event.pointerId, false);
});
runButton.addEventListener('pointerup', event => endHold(event.pointerId, true));
runButton.addEventListener('pointercancel', event => endHold(event.pointerId, false));
runButton.addEventListener('lostpointercapture', event => endHold(event.pointerId, false));
runButton.addEventListener('contextmenu', event => event.preventDefault());
runButton.addEventListener('click', event => {
    if (event.detail === 0) {
        const box = runButton.getBoundingClientRect();
        rippleRunButton(box.left + box.width / 2, box.top + box.height / 2);
        runAction();
    }
});
document.addEventListener('paste', event => {
    const selected = sourceSelection(screen, frame.targets ?? [], repl.notebook, getSelection());
    if (!selected && event.target !== input) return;
    event.preventDefault();
    if (busy || repl.running || repl.liveIterationFocused || repl.help) return;
    if (selected) {
        repl.editSource();
        repl.notebook.selectTo(selected.start.cell, selected.start.offset);
        repl.notebook.selectTo(selected.end.cell, selected.end.offset, true);
        getSelection()?.removeAllRanges();
    }
    (selected ? repl.notebook : editor()).insert(event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n') ?? '');
    follow = true; render(); input.focus({ preventScroll: true });
});
input.addEventListener('focus', () => terminal.classList.add('focused'));
input.addEventListener('blur', () => terminal.classList.remove('focused'));

document.addEventListener('copy', event => {
    const selected = sourceSelection(screen, frame.targets ?? [], repl.notebook, getSelection());
    const text = selected?.text ?? editor().selectedText;
    if (!text || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
});
document.addEventListener('cut', event => {
    if (busy || repl.running || repl.help) return;
    const selected = sourceSelection(screen, frame.targets ?? [], repl.notebook, getSelection());
    const text = selected?.text ?? editor().selectedText;
    if (!text || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', text);
    if (selected) {
        repl.editSource();
        repl.notebook.selectTo(selected.start.cell, selected.start.offset);
        repl.notebook.selectTo(selected.end.cell, selected.end.offset, true);
    }
    (selected ? repl.notebook : editor()).replaceSelection('');
    getSelection()?.removeAllRanges();
    render();
    input.focus({ preventScroll: true });
});
let hadNativeSelection = false;
document.addEventListener('selectionchange', () => {
    const selected = nativeSelection();
    if (hadNativeSelection && !selected) requestAnimationFrame(() => render());
    hadNativeSelection = selected;
});

async function locate(x: number, y: number): Promise<void> {
    stopMomentum();
    if (busy || repl.running || repl.help) { input.focus({ preventScroll: true }); return; }
    const rect = terminal.getBoundingClientRect();
    const row = Math.floor((y - rect.top + scrollFraction) / cellHeight);
    const column = Math.round((x - rect.left) / cellWidth);
    const target = frame.targets?.[row];
    repl.notebook.clearSelection();
    repl.exampleEditor?.clearSelection();
    if (target?.kind === 'source') {
        repl.editSource();
        repl.notebook.active = target.cell;
        const point = target.points.reduce((best, point) =>
            Math.abs(point.column - column) < Math.abs(best.column - column) ? point : best);
        repl.notebook.cursor = point.offset;
    } else if (target?.kind === 'example') {
        const active = repl.exampleFields?.findIndex(field => field.active) ?? 0;
        repl.moveExampleField(target.field! - active);
        const point = target.points.reduce<typeof target.points[number] | undefined>((best, point) =>
            !best || Math.abs(point.column - column) < Math.abs(best.column - column) ? point : best, undefined);
        if (point && repl.exampleEditor) repl.exampleEditor.cursor = point.offset;
    } else if (target?.kind === 'iteration') {
        repl.notebook.active = target.cell;
        if (!repl.liveIterationFocused) repl.focusLiveIterationFromBody(target.line);
        repl.iterationSelecting = true;
    } else if (row < rows - 1) {
        repl.editSource(); repl.notebook.toPrompt();
    }
    follow = true;
    render();
    input.focus({ preventScroll: true });
}

let pointer: { x: number; y: number; moved: boolean; time: number } | undefined;
let tapped = false;
terminal.addEventListener('pointerdown', event => {
    closeMenu();
    tapped = false;
    if (event.target === input) return;
    pointer = { x: event.clientX, y: event.clientY, moved: false, time: performance.now() };
});
terminal.addEventListener('pointermove', event => {
    if (!pointer || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 10) return;
    pointer.moved = true;
});
terminal.addEventListener('pointerup', event => {
    tapped = !!pointer && !pointer.moved && !nativeSelection() && performance.now() - pointer.time < 350;
    pointer = undefined;
});
terminal.addEventListener('mousedown', event => {
    // Android sends a compatibility mousedown after touch pointerup. Its default
    // action blurs the textarea and dismisses the keyboard before click arrives.
    if (tapped) event.preventDefault();
});
terminal.addEventListener('click', event => {
    if (tapped) {
        event.preventDefault();
        void locate(event.clientX, event.clientY);
    }
    tapped = false;
});
terminal.addEventListener('pointercancel', () => { pointer = undefined; tapped = false; });
let momentumFrame: number | undefined;
function stopMomentum(): void {
    if (momentumFrame !== undefined) cancelAnimationFrame(momentumFrame);
    momentumFrame = undefined;
}
function scrollToPixels(position: number): boolean {
    if (session.pauseState) {
        repl.pauseTop = Math.floor(position / cellHeight);
        render();
        return false;
    }
    const limited = Math.max(0, Math.min(position, (frame.maxTop ?? 0) * cellHeight));
    follow = false;
    top = Math.floor(limited / cellHeight);
    scrollFraction = limited - top * cellHeight;
    render();
    return limited !== position;
}
function coast(velocity: number): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(velocity) < 0.05) return;
    let previous = performance.now();
    const step = (now: number) => {
        const elapsed = Math.min(32, now - previous);
        previous = now;
        const edge = scrollToPixels(top * cellHeight + scrollFraction + velocity * elapsed);
        velocity *= Math.exp(-elapsed / 180);
        momentumFrame = !edge && Math.abs(velocity) >= 0.02 ? requestAnimationFrame(step) : undefined;
    };
    momentumFrame = requestAnimationFrame(step);
}
let swipe: { y: number; pixels: number; time: number; lastY: number; lastTime: number;
    velocity: number; scrolling: boolean } | undefined;
terminal.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target === input) { swipe = undefined; return; }
    stopMomentum();
    const now = performance.now();
    swipe = { y: event.touches[0].clientY, pixels: top * cellHeight + scrollFraction,
        time: now, lastY: event.touches[0].clientY, lastTime: now, velocity: 0, scrolling: false };
}, { passive: true });
terminal.addEventListener('touchmove', event => {
    if (!swipe || event.touches.length !== 1 || nativeSelection()) return;
    const now = performance.now();
    const y = event.touches[0].clientY;
    const distance = swipe.y - y;
    if (!swipe.scrolling) {
        if (now - swipe.time > 350 || Math.abs(distance) < 10) return;
        swipe.scrolling = true;
    }
    event.preventDefault();
    const speed = (swipe.lastY - y) / Math.max(1, now - swipe.lastTime);
    swipe.velocity = 0.65 * swipe.velocity + 0.35 * speed;
    swipe.lastY = y;
    swipe.lastTime = now;
    scrollToPixels(swipe.pixels + distance);
}, { passive: false });
terminal.addEventListener('touchend', () => {
    if (swipe?.scrolling && performance.now() - swipe.lastTime < 80) coast(swipe.velocity);
    swipe = undefined;
});
terminal.addEventListener('touchcancel', () => { swipe = undefined; });
terminal.addEventListener('wheel', event => {
    event.preventDefault();
    stopMomentum();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? cellHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rows * cellHeight : 1;
    scrollToPixels(top * cellHeight + scrollFraction + event.deltaY * scale);
}, { passive: false });

function resize(): void {
    stopMomentum();
    scrollFraction = 0;
    const viewport = window.visualViewport;
    const height = viewport?.height ?? innerHeight;
    document.documentElement.style.setProperty('--height', height + 'px');
    document.documentElement.style.setProperty('--top', (viewport?.offsetTop ?? 0) + 'px');
    cellWidth = measure.getBoundingClientRect().width / 10;
    cellHeight = measure.getBoundingClientRect().height;
    columns = Math.max(12, Math.floor(terminal.clientWidth / cellWidth));
    rows = Math.max(2, Math.floor(terminal.clientHeight / cellHeight));
    follow = true;
    render();
}
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
window.addEventListener('resize', resize);
resize();

if (example) {
    if (repl.notebook.cells.length === 1 && !repl.notebook.current.source) {
        for (const source of ['use sequences', 'use numbers', 'Limit = 100',
            'Fib = fibonacci to Limit', 'Fib even sum']) {
            repl.notebook.enqueue(source);
        }
        repl.notebook.toPrompt();
    }
    // All displayed values come from the same execution path as Ctrl-L in the CLI.
    void press({ name: 'l', ctrl: true });
}
