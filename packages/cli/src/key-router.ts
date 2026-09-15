import type { NotebookRepl } from './repl.js';
import { textColumns } from './screen.js';

const HISTORY_LIMIT = 500;

export interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }
export interface KeyResult { exit: boolean; pageDelta?: number }

/** Routes keys while the notebook or a live-function example field has focus. */
export class KeyRouter {
    private historyIndex = -1;
    private historyDraft = '';

    constructor(
        readonly repl: NotebookRepl,
        readonly history: string[] = [],
        private readonly columns = () => 80,
    ) {}

    async press(text: string, key: Key = {}): Promise<KeyResult> {
        const repl = this.repl;
        const book = repl.notebook;
        if (key.ctrl && key.name === 'l') return { exit: await repl.restart() };
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
            if (key.name === 'up') {
                const line = repl.liveIterationFocus!.line;
                repl.releaseLiveIteration();
                const lines = book.current.source.split('\n');
                book.cursor = lines.slice(0, line).join('\n').length;
                return { exit: false };
            }
            if (key.name === 'return' || key.name === 'enter' || key.name === 'down' || key.name === 'escape') {
                repl.releaseLiveIteration();
                return { exit: false };
            }
            if (key.name === 'left' || key.name === 'right') {
                await repl.moveLiveIteration(key.name === 'left' ? -1 : 1);
                return { exit: false };
            }
            if (!key.ctrl && !key.meta && text && text >= ' ') return { exit: false };
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
            if (repl.suggestion) repl.dismiss();
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
                if (key.name !== 'up' || !repl.focusExampleFromBody() && !repl.focusLiveIterationFromBody())
                    book.vertical(key.name === 'up' ? -1 : 1, textColumns(this.columns()), true);
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
