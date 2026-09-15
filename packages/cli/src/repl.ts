import * as readline from 'node:readline';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { EMPTY_CELL, addLine, cellSource, closeCell, isComplete, isEmpty } from './repl-input.js';
import { createWorkerSession } from './worker-session.js';
import { Notebook, splitSource } from './notebook.js';
import { KeyRouter, type Key } from './key-router.js';
import { LiveFunctionController } from './live-function-controller.js';
import { createReplSession, type OutputLine, type ProgramFile } from './repl-session.js';
import type { ReplSession } from './repl-types.js';
import { TerminalModeRouter } from './terminal-modes.js';
import { TerminalRenderer } from './terminal-renderer.js';
import { TerminalInputDecoder } from './terminal-input.js';

const HISTORY_LIMIT = 500;
const historyFile = (): string => path.join(os.homedir(), '.rank_history');

/** Coordinates explicit execution. Navigation never calls into the interpreter. */
export class NotebookRepl {
    readonly notebook = new Notebook();
    running = false;
    private startedAt?: number;
    private stopping = false;
    pauseTop = 0;
    pauseStatus = '';
    readonly breakpoints = new Map<number, Set<number>>();
    private readonly liveFunction: LiveFunctionController;

    get examplePrompt(): { name: string; parameter?: string; index: number; count: number } | undefined {
        return this.liveFunction.prompt;
    }

    get promptLabel(): string {
        return 'rank> ';
    }

    get liveOutputs(): ReadonlyMap<number, OutputLine[]> | undefined { return this.liveFunction.outputs; }
    get liveEditing(): boolean { return this.liveFunction.editing; }
    get exampleEditor(): Notebook | undefined { return this.liveFunction.editor; }
    get exampleFields(): { name: string; source: string; cursor: number; active: boolean; error?: string }[] | undefined {
        return this.liveFunction.fields;
    }

    get pauseSnapshot(): import('@arrrank/interpreter').PauseSnapshot | undefined {
        const pause = this.session.pauseState;
        if (!pause?.source || pause.line === undefined || !this.session.savedFile) return pause;
        const cells = this.notebook.cells.slice(0, -1).filter(cell => !cell.command);
        // Prefer the running cell when identical statements appear more than once.
        const current = this.notebook.current;
        const cell = current.source === pause.source && cells.includes(current)
            ? current : cells.find(item => item.source === pause.source);
        if (!cell) return pause;
        const offset = cells.slice(0, cells.indexOf(cell))
            .reduce((lines, item) => lines + item.source.split('\n').length, 0);
        const line = offset + pause.line;
        return { ...pause, source: cells.map(item => item.source).join('\n'), line,
            activity: pause.activity === `before line ${pause.line}` ? `before line ${line}` : pause.activity };
    }

    toggleBreakpoint(): void {
        const book = this.notebook;
        const line = book.current.source.slice(0, book.cursor).split('\n').length;
        const lines = this.breakpoints.get(book.current.id) ?? new Set<number>();
        if (lines.has(line)) lines.delete(line); else lines.add(line);
        this.breakpoints.set(book.current.id, lines);
        this.suggestion = `Breakpoint ${lines.has(line) ? 'set' : 'removed'}: cell ${book.active + 1}, line ${line}`;
    }

    async debug(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        this.pauseStatus = '';
        if (this.liveFunction.reopenArguments()) return false;
        if (!this.notebook.atPrompt) this.notebook.replayFrom = this.notebook.active;
        this.session.debugNext?.();
        return this.submit(true);
    }

    togglePause(): void {
        this.pauseStatus = '';
        if (this.session.pauseRequested) this.session.resume?.();
        else if (!this.stopping) { this.pauseTop = 0; this.session.pause?.(); }
        this.render();
    }

    get runningStatus(): string {
        if (this.startedAt === undefined) return 'Running…';
        return `${this.stopping ? 'Stopping…' : this.session.pauseRequested ? 'Pausing…' : 'Running…'} ${((performance.now() - this.startedAt) / 1000).toFixed(1)}s · ^C stop · ^P pause`;
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
    private preparation: Promise<void> = Promise.resolve();

    constructor(
        readonly session: ReplSession,
        readonly render: () => void = () => {},
        readonly columns = () => 80,
        functionExamples = false,
    ) {
        this.liveFunction = new LiveFunctionController(
            this.notebook, session, columns, text => { this.suggestion = text; }, render, functionExamples,
        );
    }

    dismiss(): void { this.suggestion = ''; this.completion = undefined; }

    cancelExample(): void { this.liveFunction.cancelExample(); }

    cancelLiveFunction(): void {
        this.liveFunction.cancel();
        this.completion = undefined;
    }

    cycleExampleCandidate(): void {
        this.liveFunction.cycleCandidate();
    }

    moveExampleField(direction: number): void {
        this.liveFunction.moveField(direction);
    }

    focusExampleFromBody(): boolean {
        return this.liveFunction.focusExampleFromBody();
    }

    async rerun(): Promise<boolean> {
        if (this.running || this.help || this.savePrompt) return false;
        if (await this.liveFunction.rerun()) return false;
        return this.submit(true);
    }

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
        this.breakpoints.clear();
        this.liveFunction.clear();
        for (const source of parts) this.notebook.enqueue(source, true);
        this.preparation = this.prepareFunctions();
        this.help = undefined;
        this.dismiss();
    }

    private async prepareFunctions(start = 0): Promise<void> {
        const cells = this.notebook.cells.slice(start, -1).filter(cell => !cell.command);
        const results = await this.session.prepareFunctions(cells.map(({ id, source }) => ({ id, source })));
        for (const result of results) {
            const cell = cells.find(cell => cell.id === result.id)!;
            cell.output = result.output;
            cell.errorOffset = result.errorOffset;
            cell.status = result.output.some(line => line.error) ? 'error' : 'idle';
        }
        this.render();
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
        if (this.examplePrompt) return this.liveFunction.acceptExample();
        await this.preparation;
        if (force && await this.liveFunction.forcePreview()) return false;
        this.dismiss();
        const book = this.notebook;
        const currentRaw = book.current.source.trim();
        if (this.liveFunction.begin(currentRaw)) {
            this.render();
            return false;
        }
        if (!book.atPrompt && !force && !this.liveFunction.editing) { book.newline(); return false; }
        if (force) {
            if (book.current.status === 'interrupted') book.replayFrom = book.active;
            book.toPrompt();
        }
        const raw = book.current.source.trim();
        const liveResult = await this.liveFunction.submit();
        if (liveResult === 'handled') return false;
        if (liveResult === 'replay') return this.submit(true);
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
                else { this.openFile(result.loadedFile); await this.preparation; }
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
            await this.prepareFunctions(start);
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
            this.session.endDebugRun?.();
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
            this.session.setDebugBreakpoints?.(book.cells.flatMap(item =>
                [...(this.breakpoints.get(item.id) ?? [])].map(line => ({ source: item.source, line }))));
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
async function streamRepl(session: ReplSession): Promise<void> {
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

async function terminalRepl(session: ReplSession): Promise<void> {
    const input = process.stdin;
    const output = process.stdout;
    const keyInput = new (await import('node:stream')).PassThrough();
    readline.emitKeypressEvents(keyInput);
    let history: string[] = [];
    try { history = (await fs.readFile(historyFile(), 'utf8')).split('\n').filter(Boolean).slice(-HISTORY_LIMIT); }
    catch { /* A new session has no history yet. */ }
    let renderer: TerminalRenderer;
    const render = (): void => renderer?.render();
    const repl = new NotebookRepl(session, render, () => output.columns || 80, true);
    const book = repl.notebook;
    const keyRouter = new KeyRouter(repl, history, () => output.columns || 80);
    const modeRouter = new TerminalModeRouter(repl, () => output.rows || 24);
    renderer = new TerminalRenderer(repl, modeRouter, output);
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const leave = (): void => { renderer.close(); finish(); };
    const onKey = (text: string, key: Key = {}): void => {
        if (renderer.closed) return;
        try {
            renderer.followKey(key.name);
            if (!modeRouter.active) {
                void keyRouter.press(text, key).then(result => {
                    if (result.pageDelta) renderer.page(result.pageDelta);
                    if (result.exit) leave(); else render();
                }, fail);
                return;
            }
            void modeRouter.press(text, key).then(mode => {
                if (mode.exit) leave(); else if (mode.render) render();
            }, fail);
        } catch (error) { fail(error); }
    };
    const inputDecoder = new TerminalInputDecoder(
        text => { keyInput.write(text); },
        value => {
            if (!modeRouter.paste(value)) book.insert(value.replace(/\r\n?/g, '\n'));
            repl.dismiss();
            render();
        },
    );
    const onData = (chunk: Buffer): void => { inputDecoder.write(chunk); };
    const wasRaw = input.isRaw;
    const onEnd = (): void => { inputDecoder.end(); leave(); };
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
        renderer.close();
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
        try { await fs.writeFile(historyFile(), keyRouter.history.map(item => item.replace(/\n/g, ' ')).join('\n') + '\n'); }
        catch { /* A read-only home does not prevent using the REPL. */ }
    }
}
