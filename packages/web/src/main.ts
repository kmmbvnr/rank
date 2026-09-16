import './styles.css';
import { NotebookRepl } from '@arrrank/common/repl';
import { KeyRouter, type Key } from '@arrrank/common/key-router';
import { TerminalModeRouter } from '@arrrank/common/terminal-modes';
import { notebookFrame, helpFrame, type ScreenFrame } from '@arrrank/common/screen';
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
if (import.meta.env.MODE !== 'mobile') {
    chrome.hidden = true;
    document.documentElement.style.setProperty('--chrome-height', '0px');
}
let columns = 47;
let rows = 24;
let cellWidth = 8;
let cellHeight = 22;
let top = 0;
let follow = true;
let busy = false;
let composing = false;
let failure = '';
let needsRestart = false;
let frame: ScreenFrame;
const session = browserSession(message => { failure = message; needsRestart = true; render(); });
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
    // Replacing the DOM would destroy the phone's selection handles and Copy menu.
    if (nativeSelection()) return;
    if (repl.help) {
        frame = helpFrame(repl.help.text, columns, rows, repl.help.top);
        repl.help.top = frame.top;
    } else {
        frame = notebookFrame(repl.notebook, columns, rows, top,
            failure || repl.suggestion, busy || repl.running, follow, '',
            failure || (repl.running ? repl.runningStatus : 'Running… · ^C stop'),
            repl.breakpoints, repl.promptLabel, repl.liveOutputs, repl.exampleFields,
            repl.liveIterationFocus, repl.stepping);
        top = frame.top;
    }
    screen.replaceChildren(...frame.lines.map(line => {
        const row = document.createElement('div');
        row.className = 'terminal-row';
        paintLine(row, line);
        return row;
    }));
    const left = frame.cursor.column * cellWidth;
    const y = frame.cursor.row * cellHeight;
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
        localStorage.setItem(storageKey, JSON.stringify({
            cells: repl.notebook.cells.slice(0, -1).filter(cell => !cell.command).map(cell => cell.source),
            draft: repl.notebook.cells.at(-1)!.source,
        }));
    } catch { failure = 'Cannot save local draft'; }
}

async function press(key: Key, text = ''): Promise<void> {
    if (busy || repl.running) {
        if (key.ctrl && key.name === 'c') session.interrupt?.();
        return;
    }
    if (needsRestart && (key.name === 'return' || key.ctrl && key.name === 'r')) {
        failure = 'Stopped · Ctrl-L restart'; render(); return;
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
        failure = needsRestart ? 'Stopped · Ctrl-L restart' : String(error);
        for (const cell of repl.notebook.cells) if (cell.status === 'running') cell.status = 'interrupted';
    } finally { busy = false; render(); }
}

function applyInput(): void {
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
    if (names[event.key] || event.ctrlKey) {
        event.preventDefault();
        void press({ name: names[event.key] ?? event.key.toLowerCase(), ctrl: event.ctrlKey,
            meta: event.metaKey, shift: event.shiftKey }, event.key.length === 1 ? event.key : '');
    }
});
function closeMenu(): void { commands.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); }
chrome.addEventListener('pointerdown', event => event.preventDefault());
menuToggle.onclick = () => {
    commands.hidden = !commands.hidden;
    menuToggle.setAttribute('aria-expanded', String(!commands.hidden));
};
commands.onclick = event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
    if (!button) return;
    closeMenu();
    input.focus({ preventScroll: true });
    void press({ name: button.dataset.key, ctrl: button.dataset.ctrl === 'true' });
};
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
    if (busy || repl.running || repl.help) { input.focus({ preventScroll: true }); return; }
    const rect = terminal.getBoundingClientRect();
    const row = Math.floor((y - rect.top) / cellHeight);
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
terminal.addEventListener('pointerdown', event => {
    closeMenu();
    if (event.target === input) return;
    pointer = { x: event.clientX, y: event.clientY, moved: false, time: performance.now() };
});
terminal.addEventListener('pointermove', event => {
    if (!pointer || Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 10) return;
    pointer.moved = true;
});
terminal.addEventListener('pointerup', event => {
    if (pointer && !pointer.moved && !nativeSelection() && performance.now() - pointer.time < 350)
        void locate(event.clientX, event.clientY);
    pointer = undefined;
});
terminal.addEventListener('pointercancel', () => { pointer = undefined; });
let swipe: { y: number; top: number; time: number; scrolling: boolean } | undefined;
terminal.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target === input) { swipe = undefined; return; }
    swipe = { y: event.touches[0].clientY, top, time: performance.now(), scrolling: false };
}, { passive: true });
terminal.addEventListener('touchmove', event => {
    if (!swipe || event.touches.length !== 1 || nativeSelection()) return;
    const distance = swipe.y - event.touches[0].clientY;
    if (!swipe.scrolling) {
        if (performance.now() - swipe.time > 350 || Math.abs(distance) < 10) return;
        swipe.scrolling = true;
    }
    event.preventDefault();
    follow = false;
    top = Math.max(0, swipe.top + Math.round(distance / cellHeight));
    render();
}, { passive: false });
terminal.addEventListener('touchend', () => { swipe = undefined; });
terminal.addEventListener('touchcancel', () => { swipe = undefined; });
terminal.addEventListener('wheel', event => {
    event.preventDefault();
    follow = false;
    top = Math.max(0, top + Math.sign(event.deltaY) * 3);
    render();
}, { passive: false });

function resize(): void {
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
