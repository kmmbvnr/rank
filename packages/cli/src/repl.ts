import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { Notebook, splitSource } from './notebook.js';
import { createReplSession, type ProgramFile } from './repl-session.js';
import { drawFrame, saveFrame, helpFrame, notebookFrame, textColumns } from './screen.js';

const HISTORY_LIMIT = 500;
const historyFile = (): string => path.join(os.homedir(), '.rank_history');
type Session = Omit<ReturnType<typeof createReplSession>, 'snapshot'> & {
    interrupt?: () => void;
    pause?: () => void;
    resume?: () => void;
    readonly pauseRequested?: boolean;
    readonly pauseState?: import('@rank/interpreter').PauseSnapshot;
};

/** Coordinates explicit execution. Navigation never calls into the interpreter. */
export class NotebookRepl {
    readonly notebook = new Notebook();
    running = false;
    private startedAt?: number;
    private stopping = false;
    pauseTop = 0;

    togglePause(): void {
        if (this.session.pauseRequested) this.session.resume?.();
        else if (!this.stopping) { this.pauseTop = 0; this.session.pause?.(); }
        this.render();
    }

    get runningStatus(): string {
        if (this.startedAt === undefined) return 'Running…';
        return `${this.stopping ? 'Stopping…' : this.session.pauseRequested ? 'Pausing…' : 'Running…'} ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s · Ctrl-C stop · Ctrl-P pause`;
    }

    interrupt(): void {
        if (this.startedAt === undefined || !this.session.interrupt) return;
        this.stopping = true;
        this.session.interrupt();
        this.render();
    }

    suggestion = '';
    help?: { text: string; top: number };
    savePrompt?: { choosing: boolean; exitAfterSave: boolean; loadFile?: ProgramFile; filename: Notebook; error: string };
    private completion?: { candidates: string[]; from: number; to: number; index: number };

    constructor(readonly session: Session, readonly render: () => void = () => {}, readonly columns = () => 80) {}

    dismiss(): void { this.suggestion = ''; this.completion = undefined; }

    private saveLines(): string[] {
        const lines = this.notebook.fileLines();
        const draft = this.notebook.cells.at(-1)!.source;
        if (draft !== '' && !this.session.isCommand(draft.trim())) lines.push(...draft.split('\n'));
        return lines;
    }

    get unsaved(): boolean {
        const lines = this.saveLines();
        const source = lines.join('\n') + (lines.length ? '\n' : '');
        return source !== (this.session.savedFile?.source ?? '');
    }

    get fileStatus(): string {
        const file = this.session.savedFile;
        return `${file ? path.basename(file.path) : 'Untitled'} · ${this.unsaved ? 'unsaved' : 'saved'}`;
    }

    private openSavePrompt(exitAfterSave: boolean, loadFile?: ProgramFile): void {
        const filename = new Notebook();
        filename.replace(this.session.savedFile?.path ?? '');
        this.savePrompt = { choosing: exitAfterSave || !!loadFile, exitAfterSave, loadFile, filename, error: '' };
        this.render();
    }

    requestExit(): boolean {
        if (!this.unsaved) return true;
        this.openSavePrompt(true);
        return false;
    }

    async requestSave(): Promise<void> {
        if (this.running || this.savePrompt) return;
        this.openSavePrompt(false);
        if (this.session.savedFile) await this.savePromptFile();
    }

    private openFile(file: ProgramFile): void {
        const parts = splitSource(file.source);
        this.session.replaceFile(file);
        this.notebook.clear();
        for (const source of parts) this.notebook.enqueue(source, true);
        this.help = undefined;
        this.dismiss();
    }

    discardChanges(): boolean {
        const prompt = this.savePrompt;
        if (!prompt) return false;
        if (prompt.loadFile) this.openFile(prompt.loadFile);
        this.savePrompt = undefined;
        this.render();
        return prompt.exitAfterSave;
    }

    async savePromptFile(): Promise<boolean> {
        const prompt = this.savePrompt;
        if (!prompt || this.running) return false;
        this.running = true;
        this.render();
        try {
            const result = await this.session.saveFile(this.saveLines(), prompt.filename.current.source);
            if (result.ok) {
                if (prompt.loadFile?.path === this.session.savedFile?.path) prompt.loadFile = this.session.savedFile;
                return this.discardChanges();
            }
            prompt.error = result.output.filter(line => line.error).map(line => line.text).join('\n');
            return false;
        } finally { this.running = false; this.render(); }
    }

    complete(): void {
        const book = this.notebook;
        if (this.completion) {
            const item = this.completion;
            item.index = (item.index + 1) % item.candidates.length;
            const candidate = item.candidates[item.index];
            book.replace(book.current.source.slice(0, item.from) + candidate + book.current.source.slice(item.to),
                item.from + candidate.length);
            item.to = book.cursor;
            this.suggestion = `Tab: ${candidate.trim()} (${item.index + 1}/${item.candidates.length}) · Esc close`;
            return;
        }
        const prefix = book.current.source.slice(0, book.cursor);
        const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
        const [candidates, word] = this.session.complete(line);
        if (!candidates.length) { this.suggestion = 'No completions'; return; }
        const from = book.cursor - word.length;
        const candidate = candidates[0];
        book.replace(prefix.slice(0, from) + candidate + book.current.source.slice(book.cursor), from + candidate.length);
        if (candidates.length > 1) {
            this.completion = { candidates, from, to: book.cursor, index: 0 };
            this.suggestion = `Tab: ${candidate.trim()} (1/${candidates.length}) · Esc close`;
        }
    }

    /** Enter in the draft resumes the edited suffix, then evaluates the new statement. */
    async submit(force = false): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        this.dismiss();
        const book = this.notebook;
        if (!book.atPrompt && !force) { book.newline(); return false; }
        if (force) {
            if (book.current.status === 'interrupted') book.replayFrom = book.active;
            book.toPrompt();
        }
        const raw = book.current.source.trim();
        const draft = this.session.isCommand(raw) ? raw : book.preparePrompt(line => this.session.format(line));
        if (draft === undefined) return false;
        // Commit input before replay: even if an earlier instruction fails, this text stays in the document.
        const command = draft.trim() !== '' && this.session.isCommand(draft);
        if (command && (draft === 'exit' || draft === 'quit')) {
            book.replace('');
            return this.requestExit();
        }
        if (command && draft.split(/\s+/)[0] === 'help') {
            this.running = true;
            try {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                book.replace('');
                this.help = { text: result.output.map(line => line.text).join('\n'), top: 0 };
                return false;
            } finally {
                this.running = false;
                this.render();
            }
        }
        if (command && draft.split(/\s+/)[0] === 'load') {
            this.running = true;
            try {
                const result = await this.session.execute(draft, book.current.id, book.fileLines(), this.columns());
                if (result.loadedFile === undefined) {
                    book.enqueue(draft);
                    book.finish(book.cells.length - 2, result);
                    return false;
                }
                if (this.unsaved) this.openSavePrompt(false, result.loadedFile);
                else this.openFile(result.loadedFile);
                return false;
            } finally {
                this.running = false;
                this.render();
            }
        }
        if (draft.trim() !== '' || !force && book.dirtyFrom < 0) book.enqueue(draft);
        if (command) book.cells[book.cells.length - 2].command = true;
        const start = book.dirtyFrom;
        if (start < 0 && !command) return false;
        this.running = true;
        try {
            if (command) {
                const index = book.cells.length - 2;
                const exit = await this.run(index, draft);
                const cell = book.cells[index];
                if (!cell.command && cell.status === 'error') {
                    book.replayFrom = Math.min(book.dirtyFrom < 0 ? index : book.dirtyFrom, index);
                    book.focusError(index);
                } else book.toPrompt();
                return exit;
            }
            this.session.rewind(book.cells[start].id);
            const end = book.cells.length - 1;
            for (let index = start; index < end; index++) {
                const cell = book.cells[index];
                if (cell.command) continue;
                if (cell.source.trim() === '') {
                    cell.executed = cell.source;
                    cell.output = [];
                    cell.errorOffset = undefined;
                    cell.status = 'idle';
                    continue;
                }
                book.replayFrom = index;
                if (await this.run(index, cell.source)) return true;
                if (cell.status === 'interrupted') {
                    book.replayFrom = index + 1 < end ? index + 1 : undefined;
                    book.toPrompt();
                    return false;
                }
                if (cell.status === 'error') {
                    book.focusError(index);
                    return false;
                }
            }
            book.replayFrom = undefined;
            book.toPrompt();
            return false;
        } finally {
            this.running = false;
            this.render();
        }
    }

    private async run(index: number, source: string): Promise<boolean> {
        const book = this.notebook;
        const cell = book.cells[index];
        book.active = index;
        book.cursor = cell.source.length;
        cell.status = 'running';
        cell.output = [];
        this.startedAt = performance.now();
        this.stopping = false;
        this.render();
        const timer = setInterval(() => this.render(), 100);
        try {
            await new Promise<void>(resolve => setImmediate(resolve));
            const pending = this.session.execute(source, cell.id, book.fileLines(), this.columns(), cell.fileSource);
            if (this.stopping) this.session.interrupt?.();
            const result = await pending;
            if (result.exit) return true;
            if (result.interrupted) result.output.unshift({
                text: `Stopped after ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s`, error: false,
            });
            book.finish(index, result);
            this.render();
            return false;
        } finally {
            clearInterval(timer);
            this.startedAt = undefined;
            this.stopping = false;
        }
    }
}

export async function startRepl(): Promise<void> {
    const terminal = process.stdin.isTTY && process.stdout.isTTY;
    const session = terminal ? await createWorkerSession() : createReplSession();
    try {
        if (terminal) await terminalRepl(session);
        else await streamRepl(session);
    } finally { await session.dispose(); }
}

/** Piped programs retain statement-oriented input without any screen escape codes. */
async function streamRepl(session: Session): Promise<void> {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    let state = EMPTY_CELL;
    const file: string[] = [];
    let id = 0;
    const execute = async (source: string): Promise<boolean> => {
        const result = await session.execute(source, id++, file);
        if (result.loadedFile !== undefined) {
            const parts = splitSource(result.loadedFile.source);
            session.replaceFile(result.loadedFile);
            file.length = 0;
            file.push(...parts.flatMap(part => part.split('\n')));
            for (const part of parts) {
                if (part.trim() === '') continue;
                const loaded = await session.execute(part, id++, file, 80, true);
                for (const line of loaded.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
                if (!loaded.ok) break;
            }
        }
        for (const line of result.output) (line.error ? process.stderr : process.stdout).write(line.text + '\n');
        if (!result.command && !result.exit) file.push(...result.source.split('\n'));
        return result.exit;
    };
    try {
        for await (const raw of input) {
            const text = raw.trim();
            if (text === '') { if (isEmpty(state)) file.push(''); continue; }
            if (isEmpty(state) && session.isCommand(text)) {
                if (await execute(text)) return;
                continue;
            }
            state = addLine(state, session.format(text));
            if (!isComplete(state)) continue;
            const source = cellSource(state);
            state = EMPTY_CELL;
            if (await execute(source)) return;
        }
        if (!isEmpty(state)) await execute(cellSource(closeCell(state)));
    } finally { input.close(); }
}

interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean; sequence?: string }

async function terminalRepl(session: Session): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const decoder = new StringDecoder('utf8');
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let top = 0;
    let followCursor = true;
    let closing = false;
    let history: string[] = [];
    let historyIndex = -1;
    let historyDraft = '';
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    const render = (): void => {
        if (closing) return;
        if (repl.savePrompt) {
            const prompt = repl.savePrompt;
            output.write(drawFrame(saveFrame(prompt.choosing ? undefined : prompt.filename,
                prompt.error, output.columns || 80, output.rows || 24, prompt.exitAfterSave, repl.running, !!prompt.loadFile)));
            return;
        }
        if (repl.running && session.pauseState) {
            const pause = session.pauseState;
            const details = Object.entries(pause.details ?? {}).map(([key, value]) => `${key}: ${value}`).join('\n');
            const frame = helpFrame(`Paused · ${pause.activity ?? 'evaluating'}\n${details}\n\n${pause.state ?? ''}`,
                output.columns || 80, output.rows || 24, repl.pauseTop);
            repl.pauseTop = frame.top;
            frame.lines[frame.lines.length - 1] = 'Ctrl-P / Enter continue · Ctrl-C stop · ↑/↓ scroll'.slice(0, (output.columns || 80) - 1);
            output.write(drawFrame(frame));
            return;
        }
        if (repl.help) {
            const frame = helpFrame(repl.help.text, output.columns || 80, output.rows || 24, repl.help.top);
            repl.help.top = frame.top;
            output.write(drawFrame(frame));
            return;
        }
        const frame = notebookFrame(repl.notebook, output.columns || 80, output.rows || 24,
            top, repl.suggestion, repl.running, followCursor, repl.fileStatus, repl.runningStatus);
        top = frame.top;
        output.write(drawFrame(frame));
    };
    const repl = new NotebookRepl(session, render, () => output.columns || 80);
    const book = repl.notebook;
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { closing = true; finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (closing) return;
        if (repl.running) {
            if (key.ctrl && key.name === 'c') repl.interrupt();
            else if (key.ctrl && key.name === 'p') repl.togglePause();
            else if (session.pauseState) {
                if (key.name === 'return' || key.name === 'enter') session.resume?.();
                else if (key.name === 'up') repl.pauseTop--;
                else if (key.name === 'down') repl.pauseTop++;
                else if (key.name === 'pageup') repl.pauseTop -= Math.max(1, (output.rows || 24) - 2);
                else if (key.name === 'pagedown') repl.pauseTop += Math.max(1, (output.rows || 24) - 2);
                render();
            }
            return;
        }
        try {
            followCursor = key.name !== 'pageup' && key.name !== 'pagedown';
            if (repl.savePrompt) {
                const prompt = repl.savePrompt;
                if (key.name === 'escape' || key.ctrl && key.name === 'c') repl.savePrompt = undefined;
                else if (prompt.choosing) {
                    if (key.name === 'return' || key.name === 'enter' || !key.ctrl && /^[sy]$/i.test(text)) {
                        prompt.choosing = false;
                        if (repl.session.savedFile) void repl.savePromptFile().then(exit => { if (exit) leave(); }, fail);
                    }
                    else if (!key.ctrl && /^[dn]$/i.test(text)) {
                        if (repl.discardChanges()) leave();
                        return;
                    }
                } else {
                    const file = prompt.filename;
                    if (key.name === 'return' || key.name === 'enter') {
                        void repl.savePromptFile().then(exit => { if (exit) leave(); }, fail);
                    } else if (key.name === 'backspace' || key.name === 'delete') file.erase(key.name === 'backspace');
                    else if (key.name === 'left' || key.name === 'right') file.horizontal(key.name === 'left' ? -1 : 1);
                    else if (key.name === 'home' || key.ctrl && key.name === 'a') file.lineEdge(false);
                    else if (key.name === 'end' || key.ctrl && key.name === 'e') file.lineEdge(true);
                    else if (key.ctrl && key.name === 'u') file.replace('');
                    else if (!key.ctrl && !key.meta && text && text >= ' ') file.insert(text);
                }
                render();
                return;
            }
            if (key.ctrl && (key.name === 'q' || key.name === 'd' && book.current.source === '')) {
                if (repl.requestExit()) leave();
                return;
            }
            if (key.ctrl && key.name === 's') {
                void repl.requestSave().catch(fail);
                return;
            }
            if (repl.help) {
                if (key.name === 'escape') repl.help = undefined;
                else if (key.name === 'up') repl.help.top -= 1;
                else if (key.name === 'down') repl.help.top += 1;
                else if (key.name === 'pageup') repl.help.top -= Math.max(1, (output.rows || 24) - 1);
                else if (key.name === 'pagedown') repl.help.top += Math.max(1, (output.rows || 24) - 1);
                else if (key.name === 'home') repl.help.top = 0;
                else if (key.name === 'end') repl.help.top = Number.MAX_SAFE_INTEGER;
                render();
                return;
            }
            if (key.name === 'tab') repl.complete();
            else if (key.name === 'escape') {
                if (repl.suggestion) repl.dismiss();
                else book.toPrompt();
            } else {
                repl.dismiss();
                if (key.name === 'return' || key.name === 'enter' || key.ctrl && key.name === 'r') {
                    const source = book.current.source;
                    if (book.atPrompt && source.trim()) {
                        history = [...history.filter(item => item !== source), source].slice(-HISTORY_LIMIT);
                        historyIndex = -1;
                    }
                    void repl.submit(Boolean(key.ctrl && key.name === 'r' || key.meta)).then(exit => {
                        if (exit) leave(); else render();
                    }, fail);
                } else if (key.ctrl && key.name === 'c') { book.toPrompt(); book.replace(''); }
                else if (key.ctrl && key.name === 'z') book.undo();
                else if (key.ctrl && key.name === 'y') book.undo(true);
                else if (key.ctrl && key.name === 'p') {
                    if (historyIndex < 0) historyDraft = book.current.source;
                    historyIndex = Math.min(history.length - 1, historyIndex + 1);
                    if (historyIndex >= 0) book.replace(history[history.length - 1 - historyIndex]);
                } else if (key.ctrl && key.name === 'n') {
                    historyIndex = Math.max(-1, historyIndex - 1);
                    book.replace(historyIndex < 0 ? historyDraft : history[history.length - 1 - historyIndex]);
                } else if (key.name === 'up' || key.name === 'down') {
                    book.vertical(key.name === 'up' ? -1 : 1, textColumns(output.columns || 80));
                } else if (key.name === 'pageup' || key.name === 'pagedown') {
                    top = Math.max(0, top + (key.name === 'pageup' ? -1 : 1) * Math.max(1, (output.rows || 24) - 2));
                } else if (key.name === 'left' || key.name === 'right') book.horizontal(key.name === 'left' ? -1 : 1);
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
            render();
        } catch (error) { fail(error); }
    };
    // Bracketed paste is data, including its newlines. It must never execute commands.
    let pending = '';
    let paste: string | undefined;
    const onData = (chunk: Buffer): void => {
        pending += decoder.write(chunk);
        for (;;) {
            const marker = paste === undefined ? '\x1b[200~' : '\x1b[201~';
            const at = pending.indexOf(marker);
            if (at >= 0) {
                const before = pending.slice(0, at);
                pending = pending.slice(at + marker.length);
                if (paste === undefined) { keyInput.write(before); paste = ''; }
                else {
                    if (!repl.running) {
                        if (repl.savePrompt) {
                            if (!repl.savePrompt.choosing) repl.savePrompt.filename.insert((paste + before).replace(/[\r\n]/g, ''));
                        } else if (!repl.help) book.insert((paste + before).replace(/\r\n?/g, '\n'));
                    }
                    paste = undefined;
                    repl.dismiss();
                    render();
                }
                continue;
            }
            // Keep a possible split marker until the next chunk, but deliver ordinary Esc promptly.
            let tail = 0;
            for (let size = 2; size < marker.length; size++) {
                if (pending.endsWith(marker.slice(0, size))) tail = size;
            }
            const ready = tail ? pending.slice(0, -tail) : pending;
            pending = tail ? pending.slice(-tail) : '';
            if (paste === undefined) keyInput.write(ready); else paste += ready;
            break;
        }
    };
    const wasRaw = input.isRaw;
    const onEnd = (): void => leave();
    keyInput.on('keypress', onKey);
    output.on('resize', render);
    input.on('data', onData);
    input.on('end', onEnd);
    process.on('SIGTERM', leave);
    process.on('SIGHUP', leave);
    try {
        input.setRawMode(true);
        input.resume();
        output.write('\x1b[?1049h\x1b[?2004h\x1b[2J');
        render();
        await ended;
    } finally {
        closing = true;
        input.off('data', onData);
        input.off('end', onEnd);
        output.off('resize', render);
        keyInput.off('keypress', onKey);
        keyInput.destroy();
        process.off('SIGTERM', leave);
        process.off('SIGHUP', leave);
        input.setRawMode(wasRaw);
        input.pause();
        output.write('\x1b[?2004l\x1b[?25h\x1b[?1049l');
        try { await fs.writeFile(historyFile(), history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
