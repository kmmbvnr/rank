import './styles.css';
import { MobileGuidance } from './mobile-guidance.js';
import { Capacitor } from '@capacitor/core';
import { ManualViewer, manualKey } from './manual-viewer.js';
import { ValueOverlay } from './value-overlay.js';
import type { PauseSnapshot } from '@arrrank/interpreter';
import { NotebookRepl } from '@arrrank/common/repl';
import { KeyRouter, type Key } from '@arrrank/common/key-router';
import { importPosition } from '@arrrank/common/import-fix';
import { TerminalModeRouter } from '@arrrank/common/terminal-modes';
import { fixAt, notebookFrame, helpFrame, pauseFrame, viewerFrame, type ScreenFrame } from '@arrrank/common/screen';
import { keyAvailable, keyboardModules, keyboardTabs, keyText } from '@arrrank/common/symbol-keyboard';
import { textEdit } from '@arrrank/common/input-edit';
import { moveParen, parenPartner, parenSnaps } from '@arrrank/common/paren-drag';
import { browserSession } from './session.js';
import { paintLine } from './terminal-colors.js';
import { sourceSelection } from './source-selection.js';
import { wrapCommentLines } from '@arrrank/common/comment-wrap';
import { VoiceDictation, isVoiceSupported } from './voice-dictation.js';
import { NotebookHistory } from './notebook-history.js';
import { libraryNotebookId } from './demo-library.js';
import { NotebookPanel } from './notebook-panel.js';
import { notebookStore, notebookSource, validDraft, type NotebookDraft } from './notebook-store.js';
import { splitSource } from '@arrrank/common/notebook';

const terminal = document.querySelector<HTMLElement>('#terminal')!;
const screen = document.querySelector<HTMLElement>('#screen')!;

const input = document.querySelector<HTMLTextAreaElement>('#input')!;
const caret = document.querySelector<HTMLElement>('#caret')!;
const measure = document.querySelector<HTMLElement>('#measure')!;
const chrome = document.querySelector<HTMLElement>('#chrome')!;
const menuToggle = document.querySelector<HTMLButtonElement>('#menu-toggle')!;
const commands = document.querySelector<HTMLElement>('#commands')!;
const voiceIndicator = document.querySelector<HTMLButtonElement>('#voice-indicator')!;
const runButton = document.querySelector<HTMLButtonElement>('#run-button')!;
const turboButton = document.querySelector<HTMLButtonElement>('#turbo-button')!;
const iterationControls = document.querySelector<HTMLElement>('#iteration-controls')!;
const iterationPrev = document.querySelector<HTMLButtonElement>('#iteration-prev')!;
const iterationNext = document.querySelector<HTMLButtonElement>('#iteration-next')!;
const keyboard = document.querySelector<HTMLElement>('#keyboard')!;
const keyboardKeys = document.querySelector<HTMLElement>('#keyboard-keys')!;
const keyboardTabList = document.querySelector<HTMLElement>('#keyboard-tabs')!;
const keyboardHide = document.querySelector<HTMLButtonElement>('#keyboard-hide')!;
const keyboardLetters = document.querySelector<HTMLButtonElement>('#keyboard-letters')!;
const compact = () => import.meta.env.MODE === 'mobile' || matchMedia('(max-width: 800px)').matches;
/** Keyboard shortcut hints only help with a keyboard; a touch console runs through its buttons. */
const keyHints = () => !touchConsole && !compact();
const stoppedMessage = () => keyHints() ? 'Stopped · Ctrl-L restart' : 'Stopped';
function haptic(kind: 'tap' | 'step' | 'hold' = 'tap'): void {
    const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
    if (capacitor?.getPlatform() === 'android') {
        void fetch('/__rank_haptic?kind=' + kind, { cache: 'no-store' }).catch(() => {});
    } else navigator.vibrate?.(kind === 'hold' ? 25 : kind === 'step' ? 5 : 10);
}
function reportExecution(state: 'running' | 'paused' | 'turbo' | 'idle'): void {
    const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
    if (capacitor?.getPlatform() === 'android') {
        void fetch('/__rank_execution?state=' + state, { cache: 'no-store' }).catch(() => {});
    }
}
if (import.meta.env.MODE === 'mobile') document.documentElement.classList.add('mobile');
/** How much smaller than code a result is drawn on a touch console; the same number is in the stylesheet as `--result-scale`. */
const RESULT_SCALE = 0.88;
document.documentElement.style.setProperty('--result-scale', String(RESULT_SCALE));
const example = new URLSearchParams(location.search).get('example') === 'fibonacci';
// A phone browser needs the command menu and the symbol keyboard as much as the app does.
const touchConsole = import.meta.env.MODE === 'mobile' || !example && matchMedia('(pointer: coarse)').matches;
const androidKeyboard = Capacitor.getPlatform() === 'android';
if (!touchConsole) {
    chrome.hidden = true;
    document.documentElement.style.setProperty('--chrome-height', '0px');
}
const compactResults = touchConsole;
const notebookGutter = 6;
let columns = 47;
let rows = 24;
let cellWidth = 8;
let cellHeight = 22;
let top = 0;
let scrollFraction = 0;
let follow = true;
// Screen row of the cursor when the layout was last stable; a keyboard swap resizes the viewport
// through transient heights, and the cursor must come back to this row, not stay where they pushed it.
let scrollWindow = false;
let windowedFrame = false;
let restingCursorRow: number | undefined;
let anchorCursor = false;
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
repl.rows = () => rows;
const keys = new KeyRouter(repl, [], () => columns, {
    read: () => navigator.clipboard.readText(),
    write: text => navigator.clipboard.writeText(text),
}, notebookGutter);
const modes = new TerminalModeRouter(repl, () => rows);
/** The keyboard as it was when a value opened, so closing the viewer brings back the same one. */
let keyboardBeforeViewer: { enabled: boolean; soft: boolean } | undefined;
const valueOverlay = new ValueOverlay(message => {
    repl.closeViewer(message);
    restoreKeyboardAfterViewer();
    render();
});
// The website example must never overwrite a user's main notebook (including on Android).
const storageKey = example ? 'rank-example-fibonacci-v1' : 'rank-notebook-v1';
let historyReady = example;
let changingNotebook = false;
let legacyDraft: NotebookDraft | undefined;
let notebookHistory: NotebookHistory | undefined;
let notebookPanel: NotebookPanel | undefined;

try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (validDraft({ ...saved, draft: typeof saved?.draft === 'string' ? saved.draft : '' })) {
        legacyDraft = { cells: saved.cells, draft: typeof saved.draft === 'string' ? saved.draft : '' };
        for (const source of saved.cells) repl.notebook.restore(source);
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

let lastExecutionState: 'running' | 'paused' | 'turbo' | 'idle' = 'idle';
let runningStartedAt: number | undefined;
let turboTimer: ReturnType<typeof setTimeout> | undefined;

let activeVoiceDictation: VoiceDictation | undefined;
let voiceContext: {
    cellId: number;
    prefixBefore: string;
    suffixAfter: string;
    indent: string;
} | undefined;

function startVoiceDictation(): void {
    if (!isVoiceSupported()) return;
    if (activeVoiceDictation) {
        stopVoiceDictation();
    }
    const book = editor();
    const source = book.current.source;
    const cursor = book.cursor;
    const prefix = source.slice(0, cursor);
    const lineStart = prefix.lastIndexOf('\n') + 1;
    const currentLine = prefix.slice(lineStart);
    const match = /^(\s*)rem\s*$/.exec(currentLine);
    const indent = match ? match[1] : '';
    const prefixBefore = source.slice(0, lineStart);
    let suffixAfter = source.slice(cursor);
    if (suffixAfter && !suffixAfter.startsWith('\n')) {
        suffixAfter = '\n' + suffixAfter;
    }

    voiceContext = {
        cellId: book.current.id,
        prefixBefore,
        suffixAfter,
        indent,
    };

    activeVoiceDictation = new VoiceDictation({
        lang: 'en-US',
        onResult: (transcript) => {
            if (!voiceContext) return;
            const targetCell = repl.notebook.cells.find(c => c.id === voiceContext!.cellId);
            if (!targetCell) return;
            const wrapped = wrapCommentLines(transcript, 40, voiceContext.indent);
            targetCell.source = voiceContext.prefixBefore + wrapped + voiceContext.suffixAfter;
            if (repl.notebook.current.id === voiceContext.cellId) {
                const ed = editor();
                ed.cursor = voiceContext.prefixBefore.length + wrapped.length;
            }
            render();
        },
        onEnd: () => {
            activeVoiceDictation = undefined;
            voiceContext = undefined;
            render();
        },
    });

    if (!activeVoiceDictation.start()) {
        activeVoiceDictation = undefined;
        voiceContext = undefined;
    }
    render();
}

function stopVoiceDictation(): void {
    if (activeVoiceDictation) {
        const dictation = activeVoiceDictation;
        activeVoiceDictation = undefined;
        voiceContext = undefined;
        dictation.stop();
    }
    voiceIndicator.hidden = true;
    render();
}

repl.notebook.onVoiceComment = startVoiceDictation;

voiceIndicator.addEventListener('pointerdown', event => event.preventDefault());
voiceIndicator.onclick = event => {
    event.preventDefault();
    event.stopPropagation();
    stopVoiceDictation();
    focusInput();
};

(globalThis as typeof globalThis & { rankBack?: () => boolean }).rankBack = () => notebookPanel?.close() || valueOverlay.back();

document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeVoiceDictation) {
        stopVoiceDictation();
    }
});

/** Positions the already painted rows, caret and input for the current sub-row scroll offset. */
function placeScreen(): void {
    // A windowed frame holds several screens of rows; `top` slides inside it without another layout.
    const shift = windowedFrame ? top - frame.top : 0;
    const shiftedTop = shift * cellHeight + scrollFraction;
    screen.style.transform = shiftedTop ? `translateY(${-shiftedTop}px)` : '';
    const caretRow = windowedFrame && frame.caretRow !== undefined ? frame.caretRow - top : frame.cursor.row;
    if (windowedFrame) caret.hidden = caretRow < 0 || caretRow >= rows || !!repl.help || Boolean(activeVoiceDictation);
    const left = frame.cursor.column * cellWidth;
    const y = caretRow * cellHeight - scrollFraction;
    const inputY = windowedFrame ? Math.max(0, Math.min(rows - 1, caretRow)) * cellHeight - (caretRow >= 0 && caretRow < rows ? scrollFraction : 0) : y;
    caret.style.transform = `translate(${left}px, ${y}px)`;
    if (activeVoiceDictation && frame.cursorVisible && !repl.help) {
        voiceIndicator.hidden = false;
        voiceIndicator.style.transform = `translate(${left}px, ${y}px)`;
    } else {
        voiceIndicator.hidden = true;
    }
    input.style.left = left + 'px';
    input.style.top = inputY + 'px';
}

/**
 * A smaller result keeps its marker (`!`, `~`) and the spaces that indent it at the size of code, so the marker
 * stays in its column and the text starts where the code above it starts.
 */
function keepMarkerFullSize(row: HTMLElement): void {
    const lead = /^ *[!~]? */.exec(row.textContent ?? '')?.[0].length ?? 0;
    const first = row.firstChild?.firstChild;
    if (!lead || !first || first.nodeType !== Node.TEXT_NODE || (first as Text).length < lead) return;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(first, lead);
    const marker = document.createElement('span');
    marker.className = 'terminal-marker';
    range.surroundContents(marker);
}

/** A viewer takes no typing, so neither keyboard stays up while it is open. */
function showViewer(): void {
    const viewer = repl.help?.viewer;
    if (!viewer) {
        if (valueOverlay.isOpen) valueOverlay.hide();
        restoreKeyboardAfterViewer();
        return;
    }
    if (!keyboardBeforeViewer) keyboardBeforeViewer = { enabled: keyboardEnabled, soft: softKeyboard };
    // Held down on every render, so nothing that runs while the viewer is open can bring a keyboard back.
    if (keyboardEnabled || keyboardOpening) {
        keyboardEnabled = false;
        keyboardOpening = false;
        awaitingSoftKeyboard = false;
        clearTimeout(keyboardOpeningTimer);
        input.blur();
    }
    valueOverlay.show(viewer);
}
function restoreKeyboardAfterViewer(): void {
    const before = keyboardBeforeViewer;
    keyboardBeforeViewer = undefined;
    if (!before?.enabled) return;
    // The system keyboard comes back through the usual path, which keeps the symbol keyboard hidden
    // until the system one has arrived; showing it first would let it slide up above the incoming one.
    if (before.soft) {
        keyboardEnabled = false;
        focusInput();
    } else keyboardEnabled = true;
}

function render(): void {
    // The first frame must contain the restored notebook, not its migration draft or reset state.
    if (!historyReady && !failure) return;
    showViewer();
    const paused = session.pauseState;
    modes.allowRender();
    if (paused) lastPause = paused;
    if (!repl.running) lastPause = undefined;
    if (repl.running) {
        if (runningStartedAt === undefined) {
            runningStartedAt = performance.now();
            turboTimer = setTimeout(() => { render(); }, 1500);
        }
    } else {
        runningStartedAt = undefined;
        if (turboTimer !== undefined) {
            clearTimeout(turboTimer);
            turboTimer = undefined;
        }
    }
    const runningElapsed = runningStartedAt !== undefined ? performance.now() - runningStartedAt : 0;
    const shownPause = paused ?? (modes.waitingForPause ? lastPause : undefined);
    const currentExecutionState: 'running' | 'paused' | 'turbo' | 'idle' = shownPause
        ? 'paused'
        : repl.running
            ? (session.turboActive ? 'turbo' : 'running')
            : 'idle';
    if (currentExecutionState !== lastExecutionState) {
        lastExecutionState = currentExecutionState;
        reportExecution(currentExecutionState);
    }
    runButton.dataset.state = currentExecutionState === 'turbo' ? 'running' : currentExecutionState;
    runButton.classList.toggle('turbo', !!session.turboActive && repl.running);
    runButton.setAttribute('aria-label', shownPause ? 'Step into line; hold to continue execution'
        : repl.running ? (session.turboActive ? 'Stop execution' : 'Pause and debug; hold to stop') : 'Run through selected line; hold to run all from start');
    runButton.disabled = modes.waitingForPause || !!session.pauseRequested && !paused;
    // After half a second of work the caret breathes instead of blinking, so a long run reads as busy.
    terminal.classList.toggle('working', repl.running && !shownPause && runningElapsed >= 500);
    turboButton.hidden = !repl.running || runningElapsed < 1500 || !!shownPause || !!session.turboActive;
    turboButton.disabled = modes.waitingForPause;
    // The steppers only make sense while the cursor sits on a loop being previewed.
    iterationControls.hidden = !!shownPause || repl.running || !repl.liveIterationAvailable;
    iterationPrev.disabled = iterationNext.disabled = busy;
    for (const button of commands.querySelectorAll<HTMLElement>('[data-debug]')) button.hidden = !shownPause;
    renderKeyboard();
    for (const button of commands.querySelectorAll<HTMLButtonElement>('button[data-key]')) {
        button.disabled = repl.running && button.dataset.key !== 'c'
            && !(paused && (button.hasAttribute('data-debug') || ['up', 'down'].includes(button.dataset.key!)));
    }
    const turboRun = commands.querySelector<HTMLButtonElement>('button[data-action="turbo-run"]');
    if (turboRun) turboRun.disabled = repl.running;
    // Replacing the DOM would destroy the phone's selection handles and Copy menu.
    if (nativeSelection()) return;
    if (shownPause) {
        scrollFraction = 0;
        frame = pauseFrame(shownPause, columns, rows, repl.pauseTop,
            keyHints() ? modes.pauseStatus : 'Paused');
        repl.pauseTop = frame.top;
        top = frame.top;
    } else if (repl.help?.viewer) {
        scrollFraction = 0;
        frame = viewerFrame(repl.help.viewer, columns, rows);
    } else if (repl.help) {
        scrollFraction = 0;
        frame = helpFrame(repl.help.text, columns, rows, repl.help.top);
        repl.help.top = frame.top;
    } else {
        const showShortcutHints = keyHints();
        const nameFacts = repl.nameFacts;
        const shownFailure = failure === 'Stopped' ? stoppedMessage() : failure;
        // Flinging re-laid out and repainted the notebook at every row; a few screens of rows turn that into a slide.
        windowedFrame = scrollWindow && !follow && !shownFailure && !repl.running && !showShortcutHints;
        if (follow || shownFailure || repl.running) scrollFraction = 0;
        frame = notebookFrame(repl.notebook, columns, rows, windowedFrame ? Math.max(0, top - rows) : top,
            shownFailure || (showShortcutHints ? repl.suggestion : repl.runTime), busy || repl.running, follow, '',
            shownFailure || (repl.running ? showShortcutHints ? repl.runningStatus : repl.runningStatus.split(' · ')[0] : 'Running…'),
            repl.breakpoints, repl.promptLabel, repl.liveOutputs, repl.exampleFields,
            repl.liveIterationFocus, repl.stepping,
            anchorCursor && restingCursorRow !== undefined ? Math.min(restingCursorRow, rows - 1) : undefined, showShortcutHints,
            windowedFrame ? rows * 3 : !keyHints() && !shownFailure && !repl.running && !nameFacts ? 1 : 0, repl.diagnosticOutputs, repl.importFixFocus, nameFacts, repl.valueFocus, notebookGutter);
        if (windowedFrame) top = Math.min(top, frame.maxTop ?? 0);
        else { top = frame.top; scrollWindow = false; }
        if (!follow && top >= (frame.maxTop ?? 0)) scrollFraction = 0;
        if (!anchorCursor && !windowedFrame) restingCursorRow = frame.cursor.row >= 0 && frame.cursor.row < rows ? frame.cursor.row : undefined;
    }
    if (screen.children.length !== frame.lines.length) {
        screen.replaceChildren(...frame.lines.map(() => {
            const row = document.createElement('div');
            row.className = 'terminal-row';
            return row;
        }));
        paintedLines = [];
    }
    const resultRows = new Set(frame.resultRows);
    const painted: string[] = [];
    frame.lines.forEach((line, index) => {
        const element = screen.children[index] as HTMLElement;
        element.classList.toggle('terminal-facts', frame.factsRow !== undefined && index >= frame.factsRow
            && index < frame.factsRow + (frame.factsRowCount ?? 1) || index === frame.statusRow);
        // Results, values and errors, are drawn a little smaller than code on a phone.
        const compact = compactResults && resultRows.has(index);
        element.classList.toggle('terminal-result', compact);
        const key = (compact ? '\u0001' : '') + line;
        painted[index] = key;
        if (paintedLines[index] === key) return;
        element.replaceChildren();
        paintLine(element, line);
        if (compact) keepMarkerFullSize(element);
    });
    paintedLines = painted;
    caret.style.width = (frame.cursorStyle === 6 ? 2 : cellWidth) + 'px';
    caret.hidden = !frame.cursorVisible || !!repl.help || Boolean(activeVoiceDictation);
    placeScreen();
    guidance?.update();
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
        if (!example && historyReady && !changingNotebook) notebookHistory?.schedule(JSON.parse(savedNotebook));
        if (example && savedNotebook !== storedNotebook) {
            localStorage.setItem(storageKey, savedNotebook);
            storedNotebook = savedNotebook;
        }
    } catch { failure = 'Cannot save local draft'; }
}

async function press(key: Key, text = ''): Promise<void> {
    if (!historyReady || changingNotebook || notebookPanel?.dialog.open && !(key.ctrl && key.name === 'c')) return;
    stopMomentum();
    if (activeVoiceDictation) stopVoiceDictation();
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
    } finally {
        busy = false;
        if (!failure && !needsRestart && (key.name === 'return' || key.ctrl && ['r', 'l'].includes(key.name ?? ''))
            && !repl.notebook.cells.some(cell => cell.status === 'error' || cell.status === 'interrupted')
            && repl.notebook.cells.some(cell => cell.status === 'ok'))
            guidance?.executed(repl.notebook.cells.some(cell => cell.source === 'A * 10' && cell.status === 'ok'));
        render();
    }
}

(globalThis as typeof globalThis & {
    rankPause?: () => void;
    rankResume?: () => void;
    rankStop?: () => void;
}).rankPause = () => { session.pause?.(); render(); };
(globalThis as typeof globalThis & {
    rankPause?: () => void;
    rankResume?: () => void;
    rankStop?: () => void;
}).rankResume = () => { session.resume?.(); render(); };
(globalThis as typeof globalThis & {
    rankPause?: () => void;
    rankResume?: () => void;
    rankStop?: () => void;
}).rankStop = () => { void press({ name: 'c', ctrl: true }); };

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        const state: 'running' | 'paused' | 'turbo' | 'idle' = session.pauseState
            ? 'paused'
            : repl.running
                ? (session.turboActive ? 'turbo' : 'running')
                : 'idle';
        if (state !== 'idle') reportExecution(state);
    }
});

function applyInput(): void {
    stopMomentum();
    if (activeVoiceDictation) stopVoiceDictation();
    if (busy || repl.running || repl.help || repl.liveIterationFocused) { render(); return; }
    const book = editor();
    const previous = book.current.source;
    const value = input.value;
    if (value !== previous) guidance?.edited();
    // Keep native IME composition intact; ordinary insertions use CLI auto-pairing and aliases.
    if (composing || previous === value) book.replace(value, input.selectionStart);
    else {
        const edit = textEdit(previous, value, input.selectionEnd);
        if (edit.to > edit.from) book.replace(previous.slice(0, edit.from) + previous.slice(edit.to), edit.from);
        else book.cursor = edit.from;
        if (edit.text) book.insert(edit.text, true);
        // A soft keyboard deletes through input events, not Backspace keydowns.
        else if (edit.to > edit.from) book.dropClearedLine(previous);
    }
    repl.dismiss();
    follow = true;
    render();
}

input.addEventListener('compositionstart', () => { guidance?.edited(); composing = true; });
input.addEventListener('compositionend', () => { composing = false; applyInput(); });
input.addEventListener('input', applyInput);
input.addEventListener('beforeinput', event => {
    guidance?.edited();
    if (activeVoiceDictation) stopVoiceDictation();
    if (!event.isComposing && (event.inputType === 'insertLineBreak' || event.inputType === 'insertParagraph')) {
        event.preventDefault(); void press({ name: 'return' }); return;
    }
    if (busy || repl.running || repl.liveIterationFocused || repl.help) { event.preventDefault(); return; }
    // Nothing precedes the caret, so the field cannot delete: let Backspace
    // join the line or cell above instead of leaving an empty one behind.
    if (event.inputType === 'deleteContentBackward' && input.selectionStart === 0 && input.selectionEnd === 0) {
        event.preventDefault(); void press({ name: 'backspace' }); return;
    }
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
let keyboardEnabled = touchConsole;
let keyboardOpening = touchConsole;
let keyboardOpeningTimer: ReturnType<typeof setTimeout> | undefined;
if (touchConsole && !androidKeyboard) {
    keyboardOpeningTimer = setTimeout(() => {
        keyboardOpening = false;
        render();
    }, 500);
}
/**
 * Set while the system keyboard has been asked for but has not reported itself. The symbol keyboard
 * lies behind the system one, so showing it early lets it slide into view above the incoming keyboard.
 */
let awaitingSoftKeyboard = androidKeyboard;
function finishKeyboardOpening(): void {
    keyboardOpening = false;
    awaitingSoftKeyboard = false;
    render();
}
function startKeyboardOpening(): void {
    keyboardOpening = true;
    // Android says when the system keyboard shows; a browser cannot, so it keeps the fixed wait.
    awaitingSoftKeyboard = nativeSoftKeyboard !== undefined;
    clearTimeout(keyboardOpeningTimer);
    // Native startup waits for an actual IME report, even when notebook restoration is slow.
    if (!awaitingSoftKeyboard) keyboardOpeningTimer = setTimeout(finishKeyboardOpening, 450);
}
const manualViewer = new ManualViewer();
let keyboardModule = 'core';
let keyboardLayout = '';
let keyboardSize = '';
let tallestViewport = 0;
let viewportWidth = 0;
/** Android reports the soft keyboard itself; a browser only shows it by shrinking the viewport. */
let nativeSoftKeyboard: boolean | undefined = androidKeyboard ? false : undefined;
const softKeyboardHeightKey = 'rank-soft-keyboard-height-v1';
let softKeyboardHeight = 0;
try { softKeyboardHeight = Number(localStorage.getItem(softKeyboardHeightKey)) || 0; } catch { /* Measured again when it opens. */ }
(globalThis as typeof globalThis & { rankSoftKeyboard?: (visible: boolean, height?: number, navigation?: number) => void })
    .rankSoftKeyboard = (visible, height = 0, navigation = 0) => {
        document.documentElement.style.setProperty('--keyboard-bottom', navigation + 'px');
        const waitingForFirstReport = awaitingSoftKeyboard && nativeSoftKeyboard !== true;
        const changed = nativeSoftKeyboard !== visible;
        nativeSoftKeyboard = visible;
        // Closed/zero-height reports during startup must not blur the field opening the IME.
        if (waitingForFirstReport && !visible) return;
        const wasSoftKeyboard = softKeyboard;
        softKeyboard = visible;
        if (visible) {
            softKeyboardWantedUntil = 0;
            if (touchConsole) keyboardEnabled = true;
            // The symbol keyboard reappears only once the system keyboard has finished arriving.
            if (awaitingSoftKeyboard) {
                clearTimeout(keyboardOpeningTimer);
                keyboardOpeningTimer = setTimeout(finishKeyboardOpening, 400);
            }
        }
        if (changed) beginKeyboardTransition();
        // Remember the portrait soft keyboard's height to take exactly its place.
        if (visible && height > 100 && innerHeight > innerWidth) {
            softKeyboardHeight = height;
            try { localStorage.setItem(softKeyboardHeightKey, String(height)); } catch { /* This visit only. */ }
        }
        if (wasSoftKeyboard && !visible) {
            keyboardOpening = false;
            awaitingSoftKeyboard = false;
            clearTimeout(keyboardOpeningTimer);
            if (busy || repl.running) keyboardEnabled = false;
            input.blur();
        }
        if (!changed) render();
    };
/**
 * While the system keyboard slides, the viewport height jumps through values far from the final one,
 * which threw the run button around. The final height is known, so the layout uses it meanwhile.
 */
let transitionUntil = 0;
/** Exact portrait viewport heights with and without the system keyboard, so the layout can hold still between them. */
const settledHeightsKey = 'rank-settled-heights-v1';
const settledHeights: { open?: number; closed?: number } = {};
try { Object.assign(settledHeights, JSON.parse(localStorage.getItem(settledHeightsKey) ?? '{}')); } catch { /* Measured on first use. */ }
function beginKeyboardTransition(): void {
    transitionUntil = Date.now() + 450;
    resize();
    setTimeout(resize, 500);
}
/**
 * The symbol keyboard replaces the soft keyboard rather than stacking with it:
 * closing the soft keyboard shows the symbols, ABC brings the soft keyboard back.
 */
function softKeyboardOpen(height: number): boolean {
    if (awaitingSoftKeyboard) return true;
    if (Date.now() < softKeyboardWantedUntil) return true;
    if (nativeSoftKeyboard !== undefined) return nativeSoftKeyboard;
    if (innerWidth !== viewportWidth) { viewportWidth = innerWidth; tallestViewport = 0; }
    // The app may open with the soft keyboard already up, so the screen is the reference too.
    tallestViewport = Math.max(tallestViewport, height, Math.min(window.screen.height, innerHeight + 200));
    return height < tallestViewport * 0.8;
}
let softKeyboard = false;
/** After ABC the system keyboard needs a moment to report itself, and must not be taken for closed. */
let softKeyboardWantedUntil = 0;
/** Android requests the IME only after the restored notebook accepts text input. */
(globalThis as typeof globalThis & { rankShowKeyboard?: () => boolean }).rankShowKeyboard = () => {
    if (!historyReady || input.readOnly || changingNotebook || document.querySelector('dialog[open]')) return false;
    if (!keyboardOpening) startKeyboardOpening();
    keyboardEnabled = true;
    softKeyboard = true;
    input.focus({ preventScroll: true });
    render();
    return true;
};
/**
 * A tap on a WebView with a focused text field reopens the system keyboard, so while the symbol
 * keyboard is up the field is left unfocused; keys edit the notebook directly.
 */
function symbolKeyboardShown(): boolean { return keyboardEnabled && !softKeyboard; }
function focusInput(): void {
    if (!historyReady || changingNotebook || notebookPanel?.dialog.open) return;
    if (touchConsole && !keyboardEnabled) {
        startKeyboardOpening();
        keyboardEnabled = true;
        softKeyboard = true;
        softKeyboardWantedUntil = Date.now() + 1500;
        beginKeyboardTransition();
        input.focus({ preventScroll: true });
        return;
    }
    if (!symbolKeyboardShown()) input.focus({ preventScroll: true });
}
const floatingKeyboard = matchMedia('(orientation: landscape) and (min-width: 640px)');
floatingKeyboard.addEventListener('change', () => render());
function renderKeyboard(): void {
    const floating = floatingKeyboard.matches;
    const tabs = keyboardTabs(repl.session.modules);
    if (keyboardModule !== '+' && !tabs.some(tab => tab.module === keyboardModule)) keyboardModule = 'core';
    const modules = tabs.map(tab => tab.module).join(',');
    if (modules !== keyboardTabList.dataset.modules) {
        keyboardTabList.dataset.modules = modules;
        keyboardTabList.replaceChildren(...[...tabs, { module: '+' }].map(tab => {
            const button = document.createElement('button');
            button.type = 'button';
            button.role = 'tab';
            button.tabIndex = -1;
            button.textContent = tab.module;
            if (tab.module === '+') button.setAttribute('aria-label', 'Import a module');
            button.onclick = () => {
                if (tab.module === '+') guidance?.discovered('modules');
                haptic(); keyboardModule = tab.module; keyboardKeys.scrollTop = 0; render();
            };
            return button;
        }));
    }
    for (const button of keyboardTabList.children)
        button.setAttribute('aria-selected', String(button.textContent === keyboardModule));
    const layout = keyboardModule === '+' ? '+' + repl.session.modules.join(',') : keyboardModule;
    if (layout !== keyboardLayout) {
        keyboardLayout = layout;
        keyboardKeys.classList.toggle('module-picker', keyboardModule === '+');
        keyboardKeys.replaceChildren(...(keyboardModule === '+'
            ? keyboardModules(repl.session.modules).map(module => {
                const button = document.createElement('button');
                button.type = 'button';
                button.tabIndex = -1;
                const name = document.createElement('strong');
                name.textContent = module.name;
                const summary = document.createElement('span');
                summary.textContent = module.summary;
                button.append(name, summary);
                button.onclick = () => { void importKeyboardModule(module.name); };
                return button;
            })
            : tabs.find(tab => tab.module === keyboardModule)!.keys.map(key => {
                const button = document.createElement('button');
                button.type = 'button';
                button.tabIndex = -1;
                button.textContent = key;
                manualKey(button, () => {
                    haptic('hold'); manualViewer.open(key, button); guidance?.discovered('documentation');
                }, () => typeKey(key));
                return button;
            })));
    }
    keyboard.hidden = !keyboardEnabled || keyboardOpening || (floating && softKeyboard);
    if (!keyboardEnabled || keyboardOpening) return setKeyboardSize(0, 0);
    const book = editor();
    const before = book.current.source.slice(0, book.cursor);
    const locked = busy || repl.running || !!repl.help || repl.liveIterationFocused;
    for (const button of keyboardKeys.children as HTMLCollectionOf<HTMLButtonElement>) {
        if (keyboardModule === '+') button.disabled = locked || needsRestart;
        else button.setAttribute('aria-disabled', String(locked || needsRestart || !keyAvailable(button.textContent!, before)));
    }
    // Landscape leaves the narrow code on the left and floats the keyboard on the right.
    keyboard.classList.toggle('floating', floating);
    const sized = !floating && softKeyboardHeight > 0;
    keyboard.classList.toggle('sized', sized);
    keyboard.style.height = sized ? softKeyboardHeight + 'px' : '';
    const height = softKeyboard || keyboardOpening || floating ? 0 : keyboard.offsetHeight;
    const width = softKeyboard || keyboardOpening || !floating ? 0 : keyboard.offsetWidth + 16;
    setKeyboardSize(height, width);
}
async function importKeyboardModule(module: string): Promise<void> {
    if (busy || repl.running || repl.help || repl.liveIterationFocused || needsRestart
        || !keyboardModules(repl.session.modules).some(item => item.name === module)) return;
    haptic();
    if (activeVoiceDictation) stopVoiceDictation();
    const book = repl.notebook;
    const current = book.current;
    const cursor = book.cursor;
    // Imports stay together and sorted, below any leading comments: Ctrl-R resets and evaluates the cell.
    const { index, line } = importPosition(book.cells, module, book.cells.length - 1);
    if (line === undefined) book.insertCell(index, `use ${module}`);
    else {
        const lines = book.cells[index].source.split('\n');
        lines.splice(line, 0, `use ${module}`);
        book.cells[index].source = lines.join('\n');
    }
    book.selectTo(index, book.cells[index].source.length);
    await press({ name: 'r', ctrl: true });
    book.selectTo(book.cells.indexOf(current), cursor);
    if (repl.session.modules.includes(module)) {
        keyboardModule = module;
        keyboardKeys.scrollTop = 0;
    }
    render();
}

function setKeyboardSize(height: number, width: number): void {
    const size = height + 'x' + width;
    if (size === keyboardSize) return;
    keyboardSize = size;
    document.documentElement.style.setProperty('--keyboard-height', height + 'px');
    document.documentElement.style.setProperty('--keyboard-width', width + 'px');
    requestAnimationFrame(resize);
}
function typeKey(key: string): void {
    if (activeVoiceDictation) stopVoiceDictation();
    if (busy || repl.running || repl.help || repl.liveIterationFocused) return;
    haptic();
    guidance?.edited();
    const book = editor();
    book.insert(keyText(key, book.current.source.slice(0, book.cursor)), true);
    repl.dismiss();
    follow = true;
    render();
}
function setKeyboard(enabled: boolean): void {
    keyboardEnabled = enabled;
    keyboardOpening = false;
    awaitingSoftKeyboard = false;
    clearTimeout(keyboardOpeningTimer);
    if (!enabled) input.blur();
    render();
}
// Tapping a key must not move focus, or the soft keyboard would come back over it.
// Android follows a touch with a compatibility mousedown, whose default action focuses the button.
keyboard.addEventListener('pointerdown', event => event.preventDefault());
keyboard.addEventListener('mousedown', event => event.preventDefault());
// A field that kept focus after Back does not summon the soft keyboard again until it refocuses.
keyboardLetters.onclick = () => {
    guidance?.discovered('letters');
    // Hide at once so the two keyboards never share the screen while the soft one slides in.
    softKeyboard = true;
    softKeyboardWantedUntil = Date.now() + 1500;
    beginKeyboardTransition();
    input.blur();
    input.focus({ preventScroll: true });
    setTimeout(resize, 1600);
};
keyboardHide.onclick = () => { haptic(); setKeyboard(false); };
function closeMenu(): void { commands.hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); }
chrome.addEventListener('pointerdown', event => event.preventDefault());
menuToggle.onclick = () => {
    haptic();
    commands.hidden = !commands.hidden;
    menuToggle.setAttribute('aria-expanded', String(!commands.hidden));
};
commands.onclick = event => {
    if ((event.target as HTMLElement).closest('[data-action=walkthrough]')) {
        closeMenu(); keyboardKeys.scrollTop = 0; setKeyboard(true); guidance?.replay(); return;
    }
    const turboRun = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action="turbo-run"]');
    if (turboRun && !turboRun.disabled) {
        haptic('tap');
        closeMenu();
        setKeyboard(false);
        session.requestTurbo?.();
        void press({ name: 'l', ctrl: true });
        return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-key]');
    if (!button || button.disabled) return;
    haptic(button.dataset.key === 't' && !!session.pauseState ? 'step' : 'tap');
    closeMenu();
    focusInput();
    void press({ name: button.dataset.key, ctrl: button.dataset.ctrl === 'true' });
};
turboButton.addEventListener('pointerdown', event => event.preventDefault());
turboButton.onclick = () => {
    if (turboButton.disabled || !repl.running || !!session.pauseState) return;
    haptic('tap');
    session.turbo?.();
    render();
};
function runAction(): void {
    if (activeVoiceDictation) stopVoiceDictation();
    if (runButton.disabled || busy && !repl.running) return;
    haptic(session.pauseState ? 'step' : 'tap');
    if (session.pauseState) void press({ name: 't' });
    else if (repl.running) {
        if (session.turboActive) void press({ name: 'c', ctrl: true });
        else { session.pause?.(); render(); }
    }
    else void press({ name: 'r', ctrl: true });
}
async function moveIteration(direction: -1 | 1): Promise<void> {
    if (busy || repl.running || !repl.liveIterationAvailable) return;
    haptic('step');
    // Arrows only step the iteration once the loop line is focused and being selected.
    if (!repl.liveIterationFocus?.active) await press({ name: 'g', ctrl: true });
    await press({ name: direction < 0 ? 'left' : 'right' });
    focusInput();
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
    const wasTurbo = session.turboActive;
    hold = undefined;
    runButton.classList.remove('holding', 'hold-complete');
    if (step && (!wasLong || wasTurbo) && wasRunning === repl.running) runAction();
}
runButton.addEventListener('pointerdown', event => {
    if (!event.isPrimary || hold || busy && !repl.running) return;
    event.preventDefault();
    rippleRunButton(event.clientX, event.clientY);
    runButton.setPointerCapture(event.pointerId);
    if (session.turboActive && repl.running) {
        hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, long: false, running: repl.running, action: 'stop' };
        return;
    }
    runButton.classList.add('holding');
    hold = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, long: false, running: repl.running,
        action: session.pauseState ? 'continue' : repl.running ? 'stop' : 'restart',
        timer: setTimeout(() => {
            if (!hold || hold.pointerId !== event.pointerId) return;
            hold.long = true;
            runButton.classList.add('hold-complete');
            const action = hold.action;
            if (action === 'stop' && !repl.running || action === 'continue' && !session.pauseState
                || action === 'restart' && repl.running) return;
            haptic('hold');
            if (action === 'stop') void press({ name: 'c', ctrl: true });
            else if (action === 'continue') { session.resume?.(); render(); }
            else { guidance?.discovered('hold'); void press({ name: 'l', ctrl: true }); }
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
    guidance?.edited();
    (selected ? repl.notebook : editor()).insert(event.clipboardData?.getData('text/plain').replace(/\r\n?/g, '\n') ?? '');
    follow = true; render(); focusInput();
});
input.addEventListener('focus', () => {
    terminal.classList.add('focused');
    if (touchConsole) {
        if (!keyboardEnabled) startKeyboardOpening();
        keyboardEnabled = true;
        softKeyboard = true;
        softKeyboardWantedUntil = Date.now() + 1500;
    }
});
input.addEventListener('blur', () => terminal.classList.toggle('focused', symbolKeyboardShown()));

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
    focusInput();
});
function syncInputSelection(): void {
    if (document.activeElement !== input || composing) return;
    if (busy || repl.running || repl.help || repl.liveIterationFocused) return;
    const book = editor();
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const selected = book.selection;
    const from = selected?.start === book.active ? selected.from : book.cursor;
    const to = selected?.end === book.active ? selected.to : book.cursor;
    if (start === from && end === to) return;
    if (start === end && touchConsole) {
        // A space-bar swipe reports coarse jumps across the whole cell: take only its direction, one character per event, never leaving the line.
        const source = book.current.source;
        const origin = book.cursor;
        const next = start > origin
            ? (source[origin] === '\n' || origin >= source.length ? origin : origin + 1)
            : (origin === 0 || source[origin - 1] === '\n' ? origin : origin - 1);
        book.selectTo(book.active, next);
        input.setSelectionRange(next, next);
        follow = true;
        render();
        return;
    }
    if (start === end) {
        book.selectTo(book.active, start);
    } else {
        const backward = input.selectionDirection === 'backward';
        book.selectTo(book.active, backward ? end : start, false);
        book.selectTo(book.active, backward ? start : end, true);
    }
    follow = true;
    render();
}
let hadNativeSelection = false;
document.addEventListener('selectionchange', () => {
    syncInputSelection();
    const selected = nativeSelection();
    if (hadNativeSelection && !selected) requestAnimationFrame(() => render());
    // A long press selects text natively and the system keyboard goes away with it; the symbol keyboard
    // would be left standing over the Copy menu, so it goes too. The next tap brings a keyboard back.
    if (selected && !hadNativeSelection && touchConsole && keyboardEnabled) setKeyboard(false);
    hadNativeSelection = selected;
});
// A long press anywhere on the screen, with text under it or on the empty prompt, ends in a context menu
// and Android drops the system keyboard for it. The symbol keyboard goes with it, not left standing alone.
terminal.addEventListener('contextmenu', () => { if (touchConsole && keyboardEnabled) setKeyboard(false); });
input.addEventListener('select', syncInputSelection);
input.addEventListener('selectionchange', syncInputSelection);

async function locate(x: number, y: number): Promise<void> {
    stopMomentum();
    if (activeVoiceDictation) stopVoiceDictation();
    repl.dismiss();
    if (busy || repl.running || repl.help) { if (!keyboardEnabled) return; focusInput(); return; }
    const rect = terminal.getBoundingClientRect();
    const row = Math.floor((y - rect.top + scrollFraction) / cellHeight) + (windowedFrame ? top - frame.top : 0);
    const column = Math.round((x - rect.left) / cellWidth);
    const target = frame.targets?.[row];
    repl.releaseValue();
    repl.notebook.clearSelection();
    repl.exampleEditor?.clearSelection();
    const fix = fixAt(target, column);
    if (fix) {
        repl.editSource();
        repl.notebook.focusError(target!.cell);
        // Enter on the focused suggestion runs the fix through the usual key path.
        repl.focusImportFix();
        repl.moveImportFix(fix.index);
        focusInput();
        await press({ name: 'return' });
        return;
    }
    if (target?.kind === 'source') {
        repl.editSource();
        repl.notebook.active = target.cell;
        const point = target.points.reduce((best, point) =>
            Math.abs(point.column - column) < Math.abs(best.column - column) ? point : best);
        repl.notebook.cursor = point.offset;
    } else if (target?.kind === 'example') {
        // A tapped example value is usually a closed, greyed field: reopen the editor on it.
        if (repl.exampleEditor || repl.reopenExample()) {
            repl.moveExampleField(target.field! - (repl.examplePrompt?.index ?? 0));
            const point = target.points.reduce<typeof target.points[number] | undefined>((best, point) =>
                !best || Math.abs(point.column - column) < Math.abs(best.column - column) ? point : best, undefined);
            if (point && repl.exampleEditor) repl.exampleEditor.cursor = point.offset;
        }
    } else if (target?.kind === 'value') {
        // The viewer takes no typing: opening it must not raise a keyboard, as the end of this function would.
        await repl.openValue(repl.notebook.cells[target.cell].id);
        render();
        return;
    } else if (target?.kind === 'iteration') {
        repl.notebook.active = target.cell;
        if (!repl.liveIterationFocused) repl.focusLiveIterationFromBody(target.line);
        repl.iterationSelecting = true;
    } else if (touchConsole && frame.lines[row]?.trim()) {
        // Output and markers are read-only: a touch there neither edits nor scrolls away from what is being read.
        if (keyboardEnabled) focusInput();
        return;
    } else if (row < rows - 1) {
        repl.editSource(); repl.notebook.toPrompt();
    }
    // Placing the cursor in a visible row must not shift the screen; typing brings the cursor into view later.
    follow = !(touchConsole && target?.kind === 'source');
    scrollWindow = false;
    render();
    focusInput();
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
    const nextTop = Math.floor(limited / cellHeight);
    const sameRows = !follow && !repl.help && !nativeSelection() && (nextTop === top && !windowedFrame
        || windowedFrame && nextTop >= frame.top && nextTop + rows <= frame.top + frame.lines.length);
    follow = false;
    top = nextTop;
    scrollFraction = limited - top * cellHeight;
    // Pausing the caret blink while moving keeps the blended caret from repainting the screen every half second.
    terminal.classList.add('scrolling');
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(() => {
        terminal.classList.remove('scrolling');
        // The sliding window has no footer; once the scroll settles, draw an ordinary frame so the type under the cursor returns.
        if (windowedFrame && momentumFrame === undefined) { scrollWindow = false; render(); }
    }, 150);
    // Sliding inside one row only moves layers; re-laying out the notebook per touch event made scrolling stutter.
    if (sameRows) placeScreen(); else { scrollWindow = touchConsole; render(); }
    return limited !== position;
}
let scrollIdle: ReturnType<typeof setTimeout> | undefined;
let pendingScroll: number | undefined;
let scrollFrame: number | undefined;
/** Touch events arrive faster than frames; only the latest finger position is worth drawing. */
function scrollSoon(position: number): void {
    pendingScroll = position;
    scrollFrame ??= requestAnimationFrame(() => {
        scrollFrame = undefined;
        if (pendingScroll !== undefined) scrollToPixels(pendingScroll);
        pendingScroll = undefined;
    });
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
let touchStart: { x: number; y: number; time: number } | undefined;
let swipe: { y: number; pixels: number; time: number; lastY: number; lastTime: number;
    velocity: number; scrolling: boolean } | undefined;
function onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 1) { swipe = undefined; touchStart = undefined; return; }
    stopMomentum();
    const now = performance.now();
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, time: now };
    if (event.target === input) { swipe = undefined; return; }
    swipe = { y: event.touches[0].clientY, pixels: top * cellHeight + scrollFraction,
        time: now, lastY: event.touches[0].clientY, lastTime: now, velocity: 0, scrolling: false };
    followTouchTarget(event.target);
}
terminal.addEventListener('touchstart', onTouchStart, { passive: true });
// Scrolling repaints the rows, which detaches the element under the finger; its touch events then no longer
// bubble to the terminal and the gesture would die, so the handlers also listen on that element until it ends.
let touchTarget: EventTarget | undefined;
let lastTouchEvent: Event | undefined;
function followTouchTarget(target: EventTarget | null): void {
    releaseTouchTarget();
    if (!target || target === terminal || target === input) return;
    touchTarget = target;
    target.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
    target.addEventListener('touchend', onTouchEnd as EventListener);
    target.addEventListener('touchcancel', onTouchCancel);
}
function releaseTouchTarget(): void {
    if (!touchTarget) return;
    touchTarget.removeEventListener('touchmove', onTouchMove as EventListener);
    touchTarget.removeEventListener('touchend', onTouchEnd as EventListener);
    touchTarget.removeEventListener('touchcancel', onTouchCancel);
    touchTarget = undefined;
}
function onTouchMove(event: TouchEvent): void {
    if (lastTouchEvent === event) return;
    lastTouchEvent = event;
    if (event.touches.length !== 1 || nativeSelection()) return;
    const now = performance.now();
    const touch = event.touches[0];
    const y = touch.clientY;
    const x = touch.clientX;
    const distanceY = swipe ? swipe.y - y : (touchStart ? touchStart.y - y : 0);
    const distanceX = touchStart ? x - touchStart.x : 0;
    if (!swipe?.scrolling) {
        if (Math.abs(distanceX) > Math.abs(distanceY) * 1.5 && Math.abs(distanceX) > 10) {
            // Horizontal swipe gesture in progress: prevent native horizontal gesture navigation
            event.preventDefault();
            return;
        }
        if (!swipe || now - swipe.time > 350 || Math.abs(distanceY) < 10) return;
        swipe.scrolling = true;
    }
    event.preventDefault();
    const speed = (swipe.lastY - y) / Math.max(1, now - swipe.lastTime);
    swipe.velocity = 0.65 * swipe.velocity + 0.35 * speed;
    swipe.lastY = y;
    swipe.lastTime = now;
    scrollSoon(swipe.pixels + distanceY);
}
terminal.addEventListener('touchmove', onTouchMove, { passive: false });
function onTouchEnd(event: TouchEvent): void {
    if (lastTouchEvent === event) return;
    lastTouchEvent = event;
    releaseTouchTarget();
    if (swipe?.scrolling) {
        if (performance.now() - swipe.lastTime < 80) coast(swipe.velocity);
    } else if (touchStart && event.changedTouches.length === 1 && !nativeSelection()) {
        const touch = event.changedTouches[0];
        const dx = touch.clientX - touchStart.x;
        const dy = touch.clientY - touchStart.y;
        const dt = performance.now() - touchStart.time;
        if (dt < 500 && Math.abs(dx) >= 30 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
            tapped = false;
            if (!busy && !repl.running) {
                if (dx > 0) {
                    repl.complete(true);
                    render();
                    haptic('step');
                } else if (repl.hasCompletion) {
                    repl.cancelCompletion();
                    render();
                    haptic('tap');
                }
            }
        }
    }
    swipe = undefined;
    touchStart = undefined;
}
terminal.addEventListener('touchend', onTouchEnd);
function onTouchCancel(): void {
    releaseTouchTarget();
    swipe = undefined;
    touchStart = undefined;
}
terminal.addEventListener('touchcancel', onTouchCancel);
// A finger on a bracket drags a ghost of it between valid landings; the text stays put until release.
const ghost = document.createElement('div');
ghost.id = 'paren-ghost';
ghost.setAttribute('aria-hidden', 'true');
ghost.hidden = true;
const scope = document.createElement('div');
scope.id = 'paren-scope';
scope.setAttribute('aria-hidden', 'true');
scope.hidden = true;
caret.after(scope, ghost);
interface ParenDrag {
    readonly cell: number;
    readonly lineStart: number;
    readonly line: string;
    readonly offset: number;
    readonly row: number;
    readonly startX: number;
    readonly startY: number;
    readonly snaps: readonly { offset: number; column: number }[];
    readonly column: number;
    readonly partner?: number;
    grabbed: boolean;
    active: boolean;
    timer?: ReturnType<typeof setTimeout>;
    choice?: { offset: number; column: number };
}
let parenDrag: ParenDrag | undefined;
/** The bracket under a fingertip, when it can be dragged: 72px wide, as a finger needs. */
function parenUnder(x: number, y: number): ParenDrag | undefined {
    if (busy || repl.running || repl.help || repl.liveIterationFocused || repl.exampleEditor) return undefined;
    const rect = terminal.getBoundingClientRect();
    const row = Math.floor((y - rect.top + scrollFraction) / cellHeight) + (windowedFrame ? top - frame.top : 0);
    const target = frame.targets?.[row];
    if (target?.kind !== 'source') return undefined;
    const source = repl.notebook.cells[target.cell]?.source;
    if (source === undefined) return undefined;
    const reach = (x - rect.left) / cellWidth - 0.5;
    const hit = target.points.filter(point => '()'.includes(source[point.offset] ?? ''))
        .filter(point => Math.abs(point.column - reach) * cellWidth <= 36)
        .sort((a, b) => Math.abs(a.column - reach) - Math.abs(b.column - reach))[0];
    if (!hit) return undefined;
    const lineStart = source.lastIndexOf('\n', hit.offset - 1) + 1;
    const end = source.indexOf('\n', hit.offset);
    const line = source.slice(lineStart, end < 0 ? source.length : end);
    const columns = new Map(target.points.map(point => [point.offset, point.column]));
    const snaps = parenSnaps(line, hit.offset - lineStart).flatMap(offset => {
        const column = columns.get(lineStart + offset);
        return column === undefined ? [] : [{ offset, column }];
    });
    if (snaps.length === 0) return undefined;
    const partner = parenPartner(line, hit.offset - lineStart);
    return { cell: target.cell, lineStart, line, offset: hit.offset - lineStart, row, startX: x, startY: y,
        snaps, column: hit.column, partner: partner === undefined ? undefined : columns.get(lineStart + partner),
        grabbed: false, active: false };
}
/** Draws the bracket at `column` and tints the group it would enclose, from there to its partner. */
function drawGhost(drag: ParenDrag, column: number): void {
    const y = drag.row * cellHeight - scrollFraction;
    ghost.hidden = false;
    ghost.textContent = drag.line[drag.offset];
    ghost.style.width = cellWidth + 'px';
    ghost.style.transform = `translate(${column * cellWidth}px, ${y}px)`;
    if (drag.partner === undefined) { scope.hidden = true; return; }
    const from = Math.min(column, drag.partner);
    const to = Math.max(column, drag.partner);
    scope.hidden = false;
    scope.style.width = (to - from + 1) * cellWidth + 'px';
    scope.style.transform = `translate(${from * cellWidth}px, ${y}px)`;
}
function showGhost(drag: ParenDrag, x: number, y: number): void {
    const rect = terminal.getBoundingClientRect();
    const reach = (x - rect.left) / cellWidth - 0.5;
    const away = Math.abs(y - drag.startY) > 3 * cellHeight;
    const near = away ? undefined : drag.snaps.reduce((best, snap) =>
        Math.abs(snap.column - reach) < Math.abs(best.column - reach) ? snap : best);
    if (near?.offset !== drag.choice?.offset) haptic('tap');
    drag.choice = near;
    if (near) drawGhost(drag, near.column);
    else { ghost.hidden = true; scope.hidden = true; }
}
/** Marks the bracket as picked up, before it moves: it lights up where it stands, with its group. */
function grabParen(drag: ParenDrag): void {
    if (parenDrag !== drag || drag.grabbed || drag.active || nativeSelection()) return;
    drag.grabbed = true;
    haptic('hold');
    drawGhost(drag, drag.column);
}
function endParenDrag(commit: boolean): void {
    const drag = parenDrag;
    parenDrag = undefined;
    ghost.hidden = true;
    scope.hidden = true;
    if (drag) clearTimeout(drag.timer);
    if (!drag?.active || !commit || !drag.choice) return;
    const moved = moveParen(drag.line, drag.offset, drag.choice.offset);
    const source = repl.notebook.cells[drag.cell]?.source;
    if (!moved || source === undefined) return;
    repl.editSource();
    repl.notebook.active = drag.cell;
    const end = drag.lineStart + drag.line.length;
    repl.notebook.replace(source.slice(0, drag.lineStart) + moved.line + source.slice(end),
        drag.lineStart + moved.offset + 1);
    repl.dismiss();
    haptic('step');
    follow = true;
    render();
}
terminal.addEventListener('touchstart', event => {
    parenDrag = event.touches.length === 1 && event.target !== input
        ? parenUnder(event.touches[0].clientX, event.touches[0].clientY) : undefined;
    const drag = parenDrag;
    if (drag) drag.timer = setTimeout(() => grabParen(drag), 90);
}, { passive: true });
terminal.addEventListener('touchmove', event => {
    if (!parenDrag || event.touches.length !== 1 || nativeSelection()) return;
    const touch = event.touches[0];
    if (!parenDrag.active) {
        const dx = touch.clientX - parenDrag.startX;
        const dy = touch.clientY - parenDrag.startY;
        if (Math.hypot(dx, dy) < 4) return;
        // A mostly vertical start is a scroll, not a drag.
        if (Math.abs(dx) < Math.abs(dy)) { endParenDrag(false); return; }
        clearTimeout(parenDrag.timer);
        parenDrag.active = true;
        swipe = undefined;
        touchStart = undefined;
        tapped = false;
    }
    event.preventDefault();
    showGhost(parenDrag, touch.clientX, touch.clientY);
}, { passive: false });
terminal.addEventListener('touchend', () => endParenDrag(true));
terminal.addEventListener('touchcancel', () => endParenDrag(false));
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
    let height = viewport?.height ?? innerHeight;
    const wasSoftKeyboard = softKeyboard;
    softKeyboard = softKeyboardOpen(height);
    if (wasSoftKeyboard && !softKeyboard) {
        if (busy || repl.running) keyboardEnabled = false;
        input.blur();
    }
    if (innerHeight > innerWidth) {
        const state = softKeyboard ? 'open' : 'closed';
        if (Date.now() >= transitionUntil) {
            if (settledHeights[state] !== height) {
                settledHeights[state] = height;
                try { localStorage.setItem(settledHeightsKey, JSON.stringify(settledHeights)); } catch { /* Predicted from the keyboard height instead. */ }
            }
        } else if (settledHeights[state]) height = settledHeights[state]!;
        else if (softKeyboardHeight > 0 && tallestViewport > 0) height = tallestViewport - (softKeyboard ? softKeyboardHeight : 0);
    }
    document.documentElement.style.setProperty('--height', height + 'px');
    document.documentElement.style.setProperty('--top', (viewport?.offsetTop ?? 0) + 'px');
    cellWidth = measure.getBoundingClientRect().width / 10;
    cellHeight = measure.getBoundingClientRect().height;
    columns = Math.max(12, Math.floor(terminal.clientWidth / cellWidth));
    rows = Math.max(2, Math.floor(terminal.clientHeight / cellHeight));
    follow = true;
    anchorCursor = true;
    try { render(); } finally { anchorCursor = false; }
}
window.visualViewport?.addEventListener('resize', resize);
window.visualViewport?.addEventListener('scroll', resize);
window.addEventListener('resize', resize);
const guidance = touchConsole && !example ? new MobileGuidance(() => ({
    ready: historyReady && !changingNotebook,
    empty: repl.notebook.cells.every(cell => !cell.source.trim()),
    codeLines: repl.notebook.cells.filter(cell => !cell.command).flatMap(cell => cell.source.split('\n'))
        .filter(line => line.trim() && !/^\s*rem(?:\s|$)/.test(line)).length,
    unavailable: busy || repl.running || composing || !!activeVoiceDictation || !!failure || needsRestart
        || !!repl.help || !!session.pauseState || nativeSelection() || !commands.hidden
        || !!document.querySelector('dialog[open]:not(#notebook-panel)')
        || repl.notebook.cells.some(cell => cell.status === 'error'),
    softKeyboard,
    notebookPanelOpen: notebookPanel?.dialog.open ?? false,
    rankKeyboard: symbolKeyboardShown() && !keyboard.hidden && !keyboardOpening,
    targets: { notebook: terminal, play: runButton, newNotebook: document.querySelector<HTMLElement>('#new-notebook') ?? undefined, brand: document.querySelector<HTMLElement>('#brand')!,
        commands: keyboardKeys.querySelector<HTMLElement>('button:not([aria-disabled="true"])') ?? undefined,
        letters: keyboardLetters, modules: keyboardTabList.querySelector<HTMLElement>('[aria-label="Import a module"]') ?? undefined },
}), () => {
    // Enqueue creates real editable cells and a trailing prompt, without evaluation.
    if (!historyReady || busy || repl.running || repl.notebook.cells.some(cell => cell.source.trim())) return;
    repl.notebook.enqueue('A = 1 to 5');
    repl.notebook.enqueue('A * 10');
    repl.notebook.selectTo(1, 'A * 10'.length);
    follow = true;
    render();
}, () => {
    input.blur();
    const capacitor = (globalThis as typeof globalThis & { Capacitor?: { getPlatform(): string } }).Capacitor;
    if (capacitor?.getPlatform() === 'android')
        void fetch('/__rank_keyboard_hide', { cache: 'no-store' }).catch(() => {});
}) : undefined;
document.querySelector<HTMLButtonElement>('[data-action="walkthrough"]')!.hidden = !guidance;
document.querySelector('#key-manual')?.addEventListener('close', () => guidance?.update());

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

function notebookSnapshot(): NotebookDraft {
    return {
        cells: repl.notebook.cells.slice(0, -1).filter(cell => !cell.command).map(cell => cell.source),
        draft: repl.notebook.cells.at(-1)!.source,
    };
}
function rememberNotebook(): void {
    try { localStorage.setItem('rank-active-notebook-v1', notebookHistory!.current!.id); } catch { /* History still survives. */ }
}
async function changeNotebook(id?: string): Promise<void> {
    if (busy || repl.running || repl.evaluating) throw new Error('Stop execution before switching notebooks');
    changingNotebook = true;
    input.readOnly = true;
    try {
        stopVoiceDictation();
        notebookHistory!.schedule(notebookSnapshot());
        valueOverlay.back();
        await notebookHistory!.open(id, snapshot => repl.restoreNotebook(snapshot.cells, snapshot.draft));
        failure = ''; needsRestart = false; lastPause = undefined;
        top = 0; scrollFraction = 0; restingCursorRow = undefined; follow = true;
        rememberNotebook();
    } finally { changingNotebook = false; input.readOnly = false; render(); }
}
async function importNotebook(): Promise<void> {
    let source: string | undefined;
    if (notebookHistory!.store.importFile) source = (await notebookHistory!.store.importFile!()).source;
    else source = await new Promise<string | undefined>((resolve, reject) => {
        const picker = document.createElement('input');
        picker.type = 'file'; picker.accept = '.ra,text/plain';
        picker.oncancel = () => resolve(undefined);
        picker.onchange = () => { void picker.files?.[0]?.text().then(resolve, reject); };
        picker.click();
    });
    if (source === undefined) return;
    await changeNotebook();
    await repl.restoreNotebook(splitSource(source.replace(/\r\n?/g, '\n')), '');
    notebookHistory!.schedule(notebookSnapshot());
    await notebookHistory!.flush();
    render();
}
async function exportNotebook(id: string): Promise<void> {
    notebookHistory!.schedule(notebookSnapshot());
    await notebookHistory!.flush();
    const book = await notebookHistory!.store.get(id);
    if (!book) throw new Error('Notebook is no longer available');
    if (notebookHistory!.store.exportFile) await notebookHistory!.store.exportFile(book.id);
    else {
        const url = URL.createObjectURL(new Blob([notebookSource(book.snapshot)], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url; link.download = book.title.replace(/[\\/:*?"<>|]/g, '_') + '.ra'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
if (!example) {
    input.readOnly = true;
    const brand = document.querySelector<HTMLButtonElement>('#brand')!;
    brand.disabled = true;
    notebookHistory = new NotebookHistory(notebookStore(), error => {
        failure = 'Cannot save notebook: ' + String(error); render();
    }, rememberNotebook);
    notebookPanel = new NotebookPanel(notebookHistory, async id => {
        await changeNotebook(id);
        if (id === undefined) guidance?.discovered('newNotebook');
    }, importNotebook, exportNotebook, async (path, source) => {
        if (busy || repl.running || repl.evaluating) throw new Error('Stop execution before opening an example');
        const id = await libraryNotebookId(path);
        if (!await notebookHistory!.store.get(id)) {
            const text = await source();
            const now = Date.now();
            await notebookHistory!.store.save({ id, title: path.split('/').at(-1)!, manual: true,
                created: now, updated: now, snapshot: { cells: splitSource(text.replace(/\r\n?/g, '\n')), draft: '' } });
        }
        await changeNotebook(id);
    },
        () => { closeMenu(); stopVoiceDictation(); setKeyboard(false); },
        () => { brand.setAttribute('aria-expanded', 'false'); render(); });
    brand.onclick = async () => {
        brand.setAttribute('aria-expanded', 'true');
        await notebookPanel!.show();
        guidance?.discovered('notebooks');
    };
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && historyReady) {
            notebookHistory!.schedule(notebookSnapshot());
            void notebookHistory!.flush().catch(error => { failure = 'Cannot save notebook: ' + String(error); render(); });
        }
    });
    void (async () => {
        try {
            const snapshot = await notebookHistory!.initialize(localStorage.getItem('rank-history-migrated-v1') ? undefined : legacyDraft,
                localStorage.getItem('rank-active-notebook-v1'));
            await repl.restoreNotebook(snapshot.cells, snapshot.draft);
            rememberNotebook();
            localStorage.setItem('rank-history-migrated-v1', 'true');
            // Keep the original draft as a migration backup; never overwrite it with another notebook.
            historyReady = true;
            input.readOnly = false;
            brand.disabled = false;
            top = 0; scrollFraction = 0; restingCursorRow = undefined; follow = true;
            render();
        } catch (error) {
            failure = 'Cannot open notebook history: ' + String(error);
            // Leave the existing draft visible and untouched if storage cannot be opened.
            render();
        }
    })();
}
