import type { NotebookRepl } from './repl.js';
import { editableRows, textColumns } from './screen.js';

const HISTORY_LIMIT = 500;

export interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }
export interface KeyResult { exit: boolean; pageDelta?: number }
export interface Clipboard {
    read(): Promise<string>;
    write(text: string): Promise<void>;
}

/** Routes keys while the notebook or a live-function example field has focus. */
export class KeyRouter {
    private historyIndex = -1;
    private historyDraft = '';
    private copiedText = '';
    private clipboardPending?: Promise<void>;
    private pendingInput?: Promise<void>;

    constructor(
        readonly repl: NotebookRepl,
        readonly history: string[] = [],
        private readonly columns = () => 80,
        private readonly clipboard?: Clipboard,
    ) {}

    async press(text: string, key: Key = {}): Promise<KeyResult> {
        // Preserve input order while an example or live preview is awaiting
        // the worker. Running-code controls must remain immediately available.
        if (this.repl.running) return this.pressNow(text, key);
        const result = this.pendingInput
            ? this.pendingInput.then(() => this.pressNow(text, key)) : this.pressNow(text, key);
        const pending = result.then(() => {}, () => {});
        this.pendingInput = pending;
        void pending.then(() => { if (this.pendingInput === pending) this.pendingInput = undefined; });
        return result;
    }

    private async pressNow(text: string, key: Key): Promise<KeyResult> {
        while (this.clipboardPending) await this.clipboardPending;
        try { return await this.route(text, key); }
        finally { this.repl.notebook.discardEmptyLine(); }
    }

    private async route(text: string, key: Key): Promise<KeyResult> {
        const repl = this.repl;
        const book = repl.notebook;
        const editor = repl.exampleEditor ?? book;
        const navigation = ['left', 'right', 'up', 'down', 'home', 'end'].includes(key.name ?? '');
        if (key.shift && navigation && !key.ctrl && !key.meta) {
            if (editor === book) repl.editSource();
            editor.selectMove(key.name!, textColumns(this.columns()));
            repl.dismiss();
            return { exit: false };
        }
        if (key.ctrl && (key.name === 'v' || (key.name === 'c' || key.name === 'x') && editor.selection)) {
            this.clipboardPending = (async () => {
                try {
                    if (key.name === 'v') {
                        const text = await this.clipboard?.read() ?? this.copiedText;
                        if (text) {
                            if (editor === book) repl.editSource();
                            editor.insert(text.replace(/\r\n?/g, '\n'));
                        }
                    } else {
                        const text = editor.selectedText;
                        await this.clipboard?.write(text);
                        this.copiedText = text;
                        if (key.name === 'x') editor.replaceSelection('');
                    }
                    repl.dismiss();
                } catch {
                    repl.suggestion = 'Clipboard unavailable · use system Copy/Paste';
                }
            })();
            try { await this.clipboardPending; }
            finally { this.clipboardPending = undefined; }
            return { exit: false };
        }
        if (editor.selection && !key.ctrl && !key.meta && (navigation || key.name === 'escape')) {
            const range = editor.selection;
            editor.clearSelection();
            if (key.name === 'left' || key.name === 'right') {
                editor.active = key.name === 'left' ? range.start : range.end;
                editor.cursor = key.name === 'left' ? range.from : range.to;
            } else if (key.name === 'up' || key.name === 'down') {
                editor.vertical(key.name === 'up' ? -1 : 1, textColumns(this.columns()));
            } else if (key.name === 'home' || key.name === 'end') editor.lineEdge(key.name === 'end');
            repl.dismiss();
            return { exit: false };
        }
        if (editor.selection && (key.name === 'return' || key.name === 'enter') && !key.ctrl && !key.meta) {
            editor.replaceSelection('\n');
            return { exit: false };
        }
        if (key.ctrl || key.meta || key.name === 'tab' || navigation && !key.shift) editor.clearSelection();
        if ((key.name === 'return' || key.name === 'enter') && !key.meta
            && repl.advancing && !repl.exampleEditor && !repl.liveIterationFocused
            && !repl.completingLiveFunction) {
            repl.insertEvaluationLine();
            return { exit: false };
        }
        if (key.ctrl && key.name === 'r' && repl.advancing) {
            key = { name: 'return' };
            text = '\r';
        }
        if (key.ctrl && key.name === 'l') return { exit: await repl.restart() };
        if (key.ctrl && key.name === 'g') {
            if (repl.liveIterationFocused && repl.iterationSelecting) repl.editSource();
            else if (repl.liveIterationFocused || repl.focusLiveIterationFromBody()) repl.iterationSelecting = true;
            else await repl.selectIteration();
            return { exit: false };
        }
        const example = repl.exampleEditor;
        if (example) {
            if (key.name === 'escape' || key.ctrl && key.name === 'c') repl.cancelExample();
            else if (key.name === 'return' || key.name === 'enter') return { exit: await repl.submit() };
            else if (key.name === 'tab') repl.cycleExampleCandidate();
            else if (key.name === 'up' || key.name === 'down') repl.moveExampleField(key.name === 'up' ? -1 : 1);
            else if (key.name === 'backspace' || key.name === 'delete') example.erase(key.name === 'backspace');
            else if (key.name === 'left' || key.name === 'right') example.horizontal(key.name === 'left' ? -1 : 1);
            else if (key.name === 'home' || key.ctrl && key.name === 'a') example.lineEdge(false);
            else if (key.name === 'end' || key.ctrl && key.name === 'e') example.lineEdge(true);
            else if (key.ctrl && key.name === 'u') example.replace('');
            else if (!key.ctrl && !key.meta && text && text >= ' ') example.insert(text, true);
            return { exit: false };
        }

        if (repl.liveIterationFocused) {
            if (key.name === 'up' || key.name === 'down') {
                const line = repl.liveIterationFocus!.line;
                repl.releaseLiveIteration();
                const lines = book.current.source.split('\n');
                book.cursor = lines.slice(0, key.name === 'up' ? line : Math.min(line + 1, lines.length)).join('\n').length;
                return { exit: false };
            }
            if (key.name === 'return' || key.name === 'enter') {
                if (repl.iterationSelecting) {
                    const line = repl.liveIterationFocus!.line;
                    const lines = book.current.source.split('\n');
                    const headerEnd = lines.slice(0, line).join('\n').length;
                    repl.releaseLiveIteration();
                    if (book.cursor <= headerEnd)
                        book.cursor = lines.slice(0, Math.min(line + 1, lines.length)).join('\n').length;
                } else repl.iterationSelecting = true;
                return { exit: false };
            }
            if (key.name === 'escape') {
                repl.editSource();
                return { exit: false };
            }
            if (key.name === 'left' || key.name === 'right') {
                if (repl.iterationSelecting) await repl.moveLiveIteration(key.name === 'left' ? -1 : 1);
                return { exit: false };
            }
            if (!key.ctrl && !key.meta && text && text >= ' ') return { exit: false };
            repl.releaseLiveIteration();
        }

        if (key.ctrl && (key.name === 'q' || key.name === 'd' && book.current.source === ''))
            return { exit: repl.requestExit() };
        if (key.ctrl && key.name === 's') {
            await repl.requestSave();
            return { exit: false };
        }
        if (key.ctrl && key.name === 'b') repl.toggleBreakpoint();
        else if (key.ctrl && key.name === 't') return { exit: await repl.debug() };
        else if (key.name === 'tab') repl.complete();
        else if (key.name === 'escape') {
            if (repl.editSource()) repl.dismiss();
            else if (repl.suggestion) repl.dismiss();
            else book.toPrompt();
        } else {
            repl.dismiss();
            if (key.name === 'return' || key.name === 'enter' || key.ctrl && key.name === 'r') {
                const source = book.current.source;
                if (book.atPrompt && source.trim()) {
                    const unique = this.history.filter(item => item !== source);
                    this.history.splice(0, this.history.length, ...unique, source);
                    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
                    this.historyIndex = -1;
                }
                const exit = await (key.ctrl && key.name === 'r' ? repl.rerun() : repl.submit(Boolean(key.meta)));
                return { exit };
            }
            if (key.ctrl && key.name === 'c') {
                if (repl.liveEditing) repl.cancelLiveFunction();
                else { book.toPrompt(); book.replace(''); }
            }
            else if (key.ctrl && key.name === 'z') book.undo();
            else if (key.ctrl && key.name === 'y') book.undo(true);
            else if (key.ctrl && key.name === 'p') {
                if (this.historyIndex < 0) this.historyDraft = book.current.source;
                this.historyIndex = Math.min(this.history.length - 1, this.historyIndex + 1);
                if (this.historyIndex >= 0) book.replace(this.history[this.history.length - 1 - this.historyIndex]);
            } else if (key.ctrl && key.name === 'n') {
                this.historyIndex = Math.max(-1, this.historyIndex - 1);
                book.replace(this.historyIndex < 0 ? this.historyDraft
                    : this.history[this.history.length - 1 - this.historyIndex]);
            } else if (key.name === 'up' || key.name === 'down') {
                const fromPrompt = book.atPrompt;
                const line = book.current.source.slice(0, book.cursor).split('\n').length;
                const header = key.name === 'up' ? line - 1 : line;
                const rows = editableRows(book.current.source, textColumns(this.columns()));
                const row = rows.findIndex(row => row.points.some(point => point.offset === book.cursor));
                const neighbor = rows[row + (key.name === 'up' ? -1 : 1)];
                const nextLine = neighbor?.points[0] === undefined ? undefined
                    : book.current.source.slice(0, neighbor.points[0].offset).split('\n').length;
                if (key.name === 'up' && line === 2 && nextLine === 1
                    && repl.reopenExample(true)) return { exit: false };
                if (key.name === 'down' && line === 1 && nextLine === 2
                    && repl.reopenExample()) return { exit: false };
                if (nextLine !== line && repl.focusLiveIterationFromBody(header)) return { exit: false };
                book.vertical(key.name === 'up' ? -1 : 1, textColumns(this.columns()), true);
                if (fromPrompt && !book.atPrompt) repl.editSource();
            } else if (key.name === 'pageup' || key.name === 'pagedown') {
                return { exit: false, pageDelta: key.name === 'pageup' ? -1 : 1 };
            } else if (key.name === 'left' || key.name === 'right') {
                const direction = key.name === 'left' ? -1 : 1;
                if (!await repl.moveLiveIteration(direction)) book.horizontal(direction);
            }
            else if (key.name === 'home' || key.ctrl && key.name === 'a') book.lineEdge(false);
            else if (key.name === 'end' || key.ctrl && key.name === 'e') {
                if (key.ctrl && key.name === 'end') book.toPrompt(); else book.lineEdge(true);
            } else if (key.name === 'backspace' || key.name === 'delete') book.erase(key.name === 'backspace');
            else if (key.ctrl && key.name === 'u') book.replace(book.current.source.slice(book.cursor), 0);
            else if (key.ctrl && key.name === 'k') {
                const end = book.current.source.indexOf('\n', book.cursor);
                book.replace(book.current.source.slice(0, book.cursor)
                    + book.current.source.slice(end < 0 ? book.current.source.length : end), book.cursor);
            } else if (!key.ctrl && !key.meta && text && text >= ' ') book.insert(text, true);
        }
        return { exit: false };
    }
}
